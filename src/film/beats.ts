/**
 * Beats of the music, and the film edited onto them (« Caler sur le rythme »).
 *
 * - Detection (`detectBeats`), once per sound file when it is read (`readAudio`), kept in its entry of the media
 *   table (`MediaAsset.beats`; a file read before is analysed on demand): the decoded file, downmixed, in frames of
 *   about 10 ms; its onsets are the rises of the loudness of its low band and of the rest (`onsetEnvelope`); the
 *   tempo, 60–180 BPM, is the lag at which that envelope best matches itself (autocorrelation, a tempo near 120 BPM
 *   preferred to its half or its double, `tempoOf`); the beats are the onsets that best follow that tempo, found by
 *   dynamic programming (`trackBeats`, after D. Ellis, 2007: on the strongest onsets, free to drift a little with the
 *   music); a bar starts every 4th beat, from the one whose beats are the strongest. On silence or a barely periodic
 *   sound the tempo is not confident (`MIN_TEMPO_CONFIDENCE`): no beats then.
 * - Snapping (`snapFilmToBeats`): the start of each title card (film time) and of each stop's hold (a stop is placed
 *   in metres: moved along the track through the film clock, `stopPositionAt`) onto the nearest bar start within
 *   `BEAT_SNAP_S`, else the nearest beat; never over another text, never past another stop. The start of each speed
 *   portion (slow motion or fast forward, placed in metres like the stops) is moved first, its length kept, never
 *   past a neighbouring portion: it shifts the times of what follows it.
 *
 * Pure module.
 */
import type { FilmClock } from './clock'
import type { Film, FilmAudio, FilmSpeed, FilmStop, FilmText } from './model'
import { positionAtTime, stopPositionAt } from './timeline'
import type { ClockOfStops } from './timeline'

/** Tempo and beats of a sound file, as kept in its entry of the media table. */
export interface MusicBeats {
  /** tempo (beats per minute, at 1/10) */
  bpm: number
  /** how periodic its onsets are (0–1, at 1/100); below `MIN_TEMPO_CONFIDENCE` it has no beats */
  confidence: number
  /** beats in the file (seconds, at 1/1000), sorted */
  times: number[]
  /** index in `times` of the first bar start (0–3): every `BEATS_PER_BAR`th beat from it starts a bar */
  downbeat: number
}

/** Frames of the onset envelope per second (about 10 ms each). */
export const ENVELOPE_RATE = 100
/** Tempo range searched (beats per minute). */
export const TEMPO_RANGE = { min: 60, max: 180 } as const
/** Between a tempo and its half or double, the one nearer this wins (150 BPM over 75 BPM, 90 over 180). */
const PREFERRED_BPM = 120
const TEMPO_SPREAD_OCTAVES = 1
/** Below this autocorrelation of the onsets at the tempo (0–1), the tempo is not trusted. */
export const MIN_TEMPO_CONFIDENCE = 0.15
export const BEATS_PER_BAR = 4
/** Most beats kept for a file (a 30 MB file at 180 BPM stays far below). */
export const MAX_BEATS = 20_000
/** The low band (kick, bass) ends there (Hz). */
const LOW_BAND_HZ = 200
/** Loudness of a frame: log(1 + gain × energy / loudest energy of the file), so quiet noise barely counts. */
const LOUDNESS_GAIN = 1000
/** How strongly the beats keep to the tempo (`trackBeats`): a gap 10 % off the period costs about 1. */
const TIGHTNESS = 100

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Onset strength of each frame of a sound, and the length of a frame (seconds). */
export interface OnsetEnvelope {
  strength: Float32Array
  frameS: number
}

/**
 * How much the loudness of the low band and of the rest rises from one frame to the next (rises only, both bands
 * added), all channels mixed down.
 */
export function onsetEnvelope(channels: readonly Float32Array[], sampleRate: number): OnsetEnvelope {
  const hop = Math.max(1, Math.round(sampleRate / ENVELOPE_RATE))
  const frames = Math.floor((channels[0]?.length ?? 0) / hop)
  const low = new Float64Array(frames)
  const high = new Float64Array(frames)
  // one-pole low-pass: the low band; what it leaves out: the rest
  const a = 1 - Math.exp((-2 * Math.PI * LOW_BAND_HZ) / sampleRate)
  let lp = 0
  for (let i = 0; i < frames * hop; i++) {
    let x = 0
    for (const ch of channels) x += ch[i]
    x /= channels.length
    lp += a * (x - lp)
    const f = Math.floor(i / hop)
    low[f] += lp * lp
    high[f] += (x - lp) * (x - lp)
  }
  const strength = new Float32Array(frames)
  for (const band of [low, high]) {
    const loudest = band.reduce((max, e) => Math.max(max, e), 0)
    if (!(loudest > 0)) continue
    let previous = 0
    for (let f = 0; f < frames; f++) {
      const loud = Math.log1p((LOUDNESS_GAIN * band[f]) / loudest)
      if (f > 0) strength[f] += Math.max(0, loud - previous)
      previous = loud
    }
  }
  return { strength, frameS: hop / sampleRate }
}

const tempoPreference = (bpm: number) => Math.exp(-0.5 * (Math.log2(bpm / PREFERRED_BPM) / TEMPO_SPREAD_OCTAVES) ** 2)

/**
 * Tempo of an onset envelope: its period (frames, between frames by a parabola through the peak) and the confidence
 * (autocorrelation there, 0–1); period 0 for a flat or too short envelope.
 */
export function tempoOf({ strength, frameS }: OnsetEnvelope): { periodFrames: number; confidence: number } {
  const n = strength.length
  const mean = strength.reduce((sum, v) => sum + v, 0) / (n || 1)
  const d = Float64Array.from(strength, (v) => v - mean)
  const autocorrelation = (lag: number) => {
    let sum = 0
    for (let i = 0; i + lag < n; i++) sum += d[i] * d[i + lag]
    return sum
  }
  const energy = autocorrelation(0)
  const minLag = Math.floor(60 / TEMPO_RANGE.max / frameS)
  const maxLag = Math.ceil(60 / TEMPO_RANGE.min / frameS)
  if (!(energy > 0) || n <= 2 * maxLag) return { periodFrames: 0, confidence: 0 }

  const ac = new Float64Array(maxLag + 2)
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) ac[lag] = autocorrelation(lag) / energy
  const weighted = (lag: number) => ac[lag] * tempoPreference(60 / (lag * frameS))
  let best = minLag
  for (let lag = minLag + 1; lag <= maxLag; lag++) if (weighted(lag) > weighted(best)) best = lag
  const [l, c, r] = [ac[best - 1], ac[best], ac[best + 1]]
  const curve = l - 2 * c + r
  const shift = curve < 0 ? Math.min(0.5, Math.max(-0.5, (0.5 * (l - r)) / curve)) : 0
  return { periodFrames: best + shift, confidence: Math.min(1, Math.max(0, c)) }
}

/**
 * Frames of the beats: the chain of frames that best follows `periodFrames`, each beat scoring its onset strength
 * (in units of the spread of the envelope) and each gap off the period costing `TIGHTNESS` × log(gap / period)²;
 * a chain starts where nothing worth linking comes before (no beats made up in a silent intro). Dynamic
 * programming, from the best frame of the last period back.
 */
export function trackBeats(strength: Float32Array, periodFrames: number): number[] {
  const n = strength.length
  if (!(periodFrames > 0) || n === 0) return []
  const mean = strength.reduce((sum, v) => sum + v, 0) / n
  const spread = Math.sqrt(strength.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n) || 1
  const shortest = Math.max(1, Math.round(periodFrames / 2))
  const longest = Math.round(2 * periodFrames)
  const cost = Float64Array.from({ length: longest + 1 }, (_, gap) => TIGHTNESS * Math.log(gap / periodFrames) ** 2)
  const score = new Float64Array(n)
  const back = new Int32Array(n).fill(-1)
  for (let t = 0; t < n; t++) {
    let best = 0
    for (let p = Math.max(0, t - longest); p <= t - shortest; p++) {
      const linked = score[p] - cost[t - p]
      if (linked > best) {
        best = linked
        back[t] = p
      }
    }
    score[t] = strength[t] / spread + best
  }
  let last = n - 1
  for (let t = Math.max(0, n - Math.round(periodFrames)); t < n; t++) if (score[t] > score[last]) last = t
  const beats: number[] = []
  for (let t = last; t >= 0; t = back[t]) beats.push(t)
  return beats.reverse()
}

/** Which of the first `BEATS_PER_BAR` beats starts the bars: the one whose beats, bar after bar, have the strongest onsets. */
function barStart(strength: Float32Array, frames: readonly number[]): number {
  const sums = new Array<number>(BEATS_PER_BAR).fill(0)
  frames.forEach((f, i) => (sums[i % BEATS_PER_BAR] += strength[f]))
  return sums.indexOf(Math.max(...sums))
}

/** Tempo and beats of a decoded sound (see the module comment). */
export function detectBeats(channels: readonly Float32Array[], sampleRate: number): MusicBeats {
  const envelope = onsetEnvelope(channels, sampleRate)
  const { periodFrames, confidence } = tempoOf(envelope)
  const bpm = periodFrames > 0 ? Math.round(600 / (periodFrames * envelope.frameS)) / 10 : 0
  const rounded = Math.round(confidence * 100) / 100
  if (confidence < MIN_TEMPO_CONFIDENCE) return { bpm, confidence: rounded, times: [], downbeat: 0 }
  const frames = trackBeats(envelope.strength, periodFrames).slice(0, MAX_BEATS)
  // the middle of the frame where the loudness rose
  const times = frames.map((f) => Math.round((f + 0.5) * envelope.frameS * 1000) / 1000)
  return { bpm, confidence: rounded, times, downbeat: barStart(envelope.strength, frames) }
}

export function isValidBeats(v: unknown): v is MusicBeats {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const b = v as Record<string, unknown>
  return (
    typeof b.bpm === 'number' &&
    b.bpm >= 0 &&
    b.bpm <= 1000 &&
    typeof b.confidence === 'number' &&
    b.confidence >= 0 &&
    b.confidence <= 1 &&
    Array.isArray(b.times) &&
    b.times.length <= MAX_BEATS &&
    b.times.every((t) => typeof t === 'number' && t >= 0 && Number.isFinite(t)) &&
    Number.isInteger(b.downbeat) &&
    (b.downbeat as number) >= 0 &&
    (b.downbeat as number) < BEATS_PER_BAR
  )
}

const isBarStart = (beats: Pick<MusicBeats, 'downbeat'>, index: number) => (index - beats.downbeat) % BEATS_PER_BAR === 0

/**
 * SVG path of the beat marks of a clip, in the viewBox of `waveformPath` (`0 0 lengthS 1`, x in seconds of the clip
 * playing the file from `inS`): a short mark from the top at each beat, a longer one at each bar start.
 */
export function beatTicksPath(beats: MusicBeats, inS: number, lengthS: number): string {
  return beats.times
    .map((t, i) => (t >= inS && t < inS + lengthS ? `M${(t - inS).toFixed(3)} 0V${isBarStart(beats, i) ? 0.3 : 0.12}` : ''))
    .join('')
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

/** Farthest an item moves to land on a beat (seconds of film time). */
export const BEAT_SNAP_S = 0.4
/** An item this close to its beat is on it (seconds): left as it is; a moved stop must land this close, else it stays. */
export const ON_BEAT_S = 0.02

/** A beat of the film's music in film time. */
export interface FilmBeat {
  timeS: number
  /** it starts a bar */
  bar: boolean
}

/**
 * Beats of the film's music in film time, sorted: those of each clip's file while the clip plays it (from `inS` for
 * `lengthS(clip)`), shifted to its start; a file without confident beats gives none.
 */
export function filmBeats(
  audio: readonly FilmAudio[],
  beatsOf: (src: string) => MusicBeats | undefined,
  lengthS: (clip: FilmAudio) => number,
): FilmBeat[] {
  const out: FilmBeat[] = []
  for (const clip of audio) {
    const beats = beatsOf(clip.src)
    if (!beats) continue
    const end = clip.inS + lengthS(clip)
    beats.times.forEach((t, i) => {
      if (t >= clip.inS && t < end) out.push({ timeS: clip.startS + t - clip.inS, bar: isBarStart(beats, i) })
    })
  }
  return out.sort((a, b) => a.timeS - b.timeS)
}

/** The beat to move `timeS` onto: the nearest bar start within `toleranceS`, else the nearest beat; null when none is that close. */
export function beatNear(beats: readonly FilmBeat[], timeS: number, toleranceS = BEAT_SNAP_S): number | null {
  let beat: number | null = null
  let bar: number | null = null
  for (const b of beats) {
    const d = Math.abs(b.timeS - timeS)
    if (d > toleranceS) continue
    if (beat === null || d < Math.abs(beat - timeS)) beat = b.timeS
    if (b.bar && (bar === null || d < Math.abs(bar - timeS))) bar = b.timeS
  }
  return bar ?? beat
}

const overlaps = (a: Pick<FilmText, 'startS' | 'durationS'>, b: Pick<FilmText, 'startS' | 'durationS'>) =>
  a.startS < b.startS + b.durationS && b.startS < a.startS + a.durationS

/** Texts with each start moved onto its beat, unless it would then overlap a text it did not overlap. */
function snapTexts(texts: readonly FilmText[], beats: readonly FilmBeat[]): { texts: FilmText[]; moved: number } {
  let out = [...texts]
  let moved = 0
  for (const text of texts) {
    const target = beatNear(beats, text.startS)
    if (target === null || Math.abs(target - text.startS) < ON_BEAT_S) continue
    const next = { ...text, startS: Math.round(target * 100) / 100 }
    if (out.some((o) => o.id !== text.id && overlaps(next, o) && !overlaps(text, o))) continue
    out = out.map((t) => (t.id === text.id ? next : t))
    moved++
  }
  return { texts: out, moved }
}

/**
 * How a stop is placed: the clock of the film with other stops, the length of the first track (metres); and, to snap
 * the speed portions too, the clock with other portions (the stops already snapped).
 */
export interface StopPlacement {
  clockOf: ClockOfStops
  lengthM: number
  clockOfSpeeds?: (stops: Film['stops'], speeds: readonly FilmSpeed[]) => FilmClock
}

/**
 * Stops with each hold start moved onto its beat, by position along the track: the position found on the clock
 * (`stopPositionAt`, at 1/10 m); a stop stays where it is when it would pass or land on another one, or when its hold
 * cannot start on the beat (the beat falls in another stop, or past an end of the track).
 */
function snapStops(film: Film, beats: readonly FilmBeat[], { clockOf, lengthM }: StopPlacement): { stops: Film['stops']; moved: number } {
  let stops = film.stops
  let moved = 0
  for (const { id, atM: fromM } of [...film.stops].sort((a, b) => a.atM - b.atM)) {
    const placed = clockOf(stops).stops.find((s) => s.id === id)
    const target = placed ? beatNear(beats, placed.holdStartS) : null
    if (!placed || target === null || Math.abs(target - placed.holdStartS) < ON_BEAT_S) continue
    const atM = Math.round(stopPositionAt(clockOf, stops, id, target, lengthM) * 10) / 10
    const [lo, hi] = [Math.min(fromM, atM), Math.max(fromM, atM)]
    if (atM === fromM || stops.some((s) => s.id !== id && s.atM >= lo && s.atM <= hi)) continue
    const next = stops.map((s) => (s.id === id ? { ...s, atM } : s))
    const landed = clockOf(next).stops.find((s) => s.id === id)
    if (!landed || Math.abs(landed.holdStartS - target) > ON_BEAT_S) continue
    stops = next
    moved++
  }
  return { stops, moved }
}

/**
 * Speed portions with each start moved onto its beat, its length kept (whole metres), between its neighbours; a
 * portion stays where it is when its start cannot land on the beat.
 */
function snapSpeeds(
  film: Film,
  stops: Film['stops'],
  beats: readonly FilmBeat[],
  clockOfSpeeds: NonNullable<StopPlacement['clockOfSpeeds']>,
  lengthM: number,
): { speeds: FilmSpeed[]; moved: number } {
  let speeds = [...film.speeds].sort((a, b) => a.fromM - b.fromM)
  let moved = 0
  for (let i = 0; i < speeds.length; i++) {
    const own = speeds[i]
    const span = own.toM - own.fromM
    const at = (fromM: number) => speeds.map((s) => (s.id === own.id ? { ...s, fromM, toM: fromM + span } : s))
    const startS = (fromM: number) => clockOfSpeeds(stops, at(fromM)).timeAtProgress(fromM / lengthM)
    const now = startS(own.fromM)
    const target = beatNear(beats, now)
    if (target === null || Math.abs(target - now) < ON_BEAT_S) continue
    const lo = i > 0 ? speeds[i - 1].toM : 0
    const hi = (i + 1 < speeds.length ? speeds[i + 1].fromM : lengthM) - span
    if (!(hi > lo)) continue
    const fromM = Math.round(positionAtTime(startS, target, lo, hi))
    if (fromM === own.fromM || fromM < lo || fromM > hi || Math.abs(startS(fromM) - target) > BEAT_SNAP_S / 4) continue
    speeds = at(fromM)
    moved++
  }
  return { speeds, moved }
}

/**
 * `film` (its stops written out) with its title cards, its stops and its speed portions moved onto the beats (`beatNear`); `moved`: how
 * many items moved (`film` itself when none did). The same film and beats always give the same result, and snapping
 * again moves nothing.
 */
export function snapFilmToBeats(film: Film, beats: readonly FilmBeat[], placement: StopPlacement): { film: Film; moved: number } {
  const texts = snapTexts(film.texts, beats)
  // the speed portions first: moving one moves the times of what follows it, stops included, which are then placed on
  // the clock with the portions where they now are
  const { clockOfSpeeds } = placement
  const speeds = clockOfSpeeds ? snapSpeeds(film, film.stops, beats, clockOfSpeeds, placement.lengthM) : { speeds: film.speeds, moved: 0 }
  const clockOf = clockOfSpeeds ? (s: readonly FilmStop[]) => clockOfSpeeds([...s], speeds.speeds) : placement.clockOf
  const stops = snapStops(film, beats, { ...placement, clockOf })
  const moved = texts.moved + stops.moved + speeds.moved
  return { film: moved > 0 ? { ...film, texts: texts.texts, stops: stops.stops, speeds: speeds.speeds } : film, moved }
}

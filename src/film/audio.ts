/**
 * Music of the film (« Musique » lane): reading a sound file into the media table, its waveform, the volume of a
 * clip over time, the playback along the preview and the mix of the exported film, the sound of the video clips
 * included.
 *
 * - `readAudio(file)`: MP3, M4A / AAC, OGG / Opus, WAV or FLAC of `MAX_AUDIO_BYTES` at most, kept as is (the project
 *   stays one file), decoded once by the Web Audio API to check it, draw its waveform (`peaks`) and find its beats
 *   (`beats`, `film/beats.ts`).
 * - « Caler sur le rythme » (`snapFilmToMusic`): the stops and the title cards moved onto those beats.
 * - Volume of a clip (`musicEnvelope`): its volume with a linear fade in and out, the same breakpoints for the
 *   preview (`musicGainAt`) and the export (gain automation), so both sound alike.
 * - Video clips with sound (`clipSounds`): their file played from `inS` while the clip shows it, with fades of a few
 *   milliseconds at both edges so they never click; « Baisser la musique sous les vidéos » (`film.duckMusic`) lowers
 *   the music by `DUCK_DB` under them, with short ramps (`duckEnvelope`).
 * - Preview (`startMusicPreview`): one HTMLAudioElement per clip, playing along while the film plays (speed,
 *   volume, fades and ducking followed, seeked again past `MUSIC_DRIFT_S` of drift), paused otherwise; muted on
 *   demand. The sound of the video clips comes from their own elements (`film/video.ts`).
 * - Export (`mixFilmAudio`): deterministic, never real time: every music clip and every video clip with sound is
 *   decoded and mixed by an OfflineAudioContext over the exact length of the exported film (opening, stops,
 *   closing and the held frames at both ends included), then handed to the video encoder.
 *
 * Browser module (Web Audio, media elements); the waveform, the volume, the mix plan, the preview logic over
 * injected elements and the film length fitted to the music are pure and tested.
 */
import { create } from 'zustand'
import { clamp } from '../core/math'
import { FLYOVER_DURATION_RANGE } from '../flyover/cameraSettings'
import { getSettingsHistory } from '../project/history'
import { editFilm, getFilmSource, setFlightTiming } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { formatFilmTime } from './timeline'
import { materializeStops } from './assemble'
import { detectBeats, filmBeats, snapFilmToBeats } from './beats'
import type { MusicBeats } from './beats'
import { buildFilmClock, filmClockFor, filmClockInputFor } from './clock'
import { AUDIO_TYPES, MAX_AUDIO_BYTES, MAX_PEAKS, dataUrlToBlob, useMediaStore } from './media'
import type { MediaAsset } from './media'
import { clipHasSound } from './model'
import type { Film, FilmAudio, FilmMedia, FilmSpeed, FilmStop } from './model'
import { blobToDataUrl, decodeClipSound } from './video'

type AudioType = (typeof AUDIO_TYPES)[number]

/** File extensions of sound files, as the type kept in the table. */
const AUDIO_EXTENSIONS: Record<string, AudioType> = {
  mp3: 'mpeg',
  m4a: 'mp4',
  aac: 'aac',
  ogg: 'ogg',
  oga: 'ogg',
  opus: 'ogg',
  wav: 'wav',
  flac: 'flac',
}
/** Subtypes of `audio/…` given by the browsers or the systems, as the type kept in the table. */
const AUDIO_SUBTYPES: Record<string, AudioType> = {
  mpeg: 'mpeg',
  mp3: 'mpeg',
  mp4: 'mp4',
  m4a: 'mp4',
  'x-m4a': 'mp4',
  aac: 'aac',
  'x-aac': 'aac',
  ogg: 'ogg',
  opus: 'ogg',
  vorbis: 'ogg',
  wav: 'wav',
  wave: 'wav',
  'x-wav': 'wav',
  'vnd.wave': 'wav',
  flac: 'flac',
  'x-flac': 'flac',
  webm: 'webm',
}

/** Type of a sound file (by its type, else its extension), null for any other file. */
export function audioTypeOf(file: { type: string; name?: string }): AudioType | null {
  const subtype = /^audio\/([\w.+-]+)/i.exec(file.type)?.[1].toLowerCase()
  if (subtype && AUDIO_SUBTYPES[subtype]) return AUDIO_SUBTYPES[subtype]
  // some systems type every unknown file so: the extension decides
  if (file.type && !subtype && file.type !== 'application/octet-stream') return null
  const ext = /\.([^.]+)$/.exec(file.name ?? '')?.[1].toLowerCase()
  return (ext && AUDIO_EXTENSIONS[ext]) || null
}

/** The file can go on the music lane. */
export function isAudioFile(file: { type: string; name?: string }): boolean {
  return audioTypeOf(file) !== null
}

/** Extensions offered by the « Ajouter une musique » picker. */
export const AUDIO_FILE_EXTENSIONS = Object.keys(AUDIO_EXTENSIONS)

// ---------------------------------------------------------------------------
// Waveform (pure)
// ---------------------------------------------------------------------------

/** Waveform values per second of file (fewer for files longer than `MAX_PEAKS / PEAKS_PER_S`). */
export const PEAKS_PER_S = 10

export function peakCount(durationS: number): number {
  return Math.max(1, Math.min(MAX_PEAKS, Math.round(durationS * PEAKS_PER_S)))
}

/** Loudest absolute level (0–1, at 1/100) of `count` even slices of the samples, all channels together. */
export function computePeaks(channels: readonly Float32Array[], count: number): number[] {
  const n = channels[0]?.length ?? 0
  const out = new Array<number>(count).fill(0)
  if (n === 0) return out
  for (let b = 0; b < count; b++) {
    const from = Math.floor((b * n) / count)
    const to = Math.min(n, Math.max(from + 1, Math.floor(((b + 1) * n) / count)))
    let max = 0
    for (const ch of channels) {
      for (let i = from; i < to; i++) {
        const v = Math.abs(ch[i])
        if (v > max) max = v
      }
    }
    out[b] = Math.round(Math.min(1, max) * 100) / 100
  }
  return out
}

/**
 * SVG path of the waveform of a clip: the part of the file from `inS` played for `lengthS`, as a band mirrored
 * around the middle, in a viewBox `0 0 lengthS 1` (x in seconds of the clip), louder slices taller (scaled to
 * the loudest slice of the file).
 */
export function waveformPath(peaks: readonly number[], fileS: number, inS: number, lengthS: number): string {
  if (peaks.length === 0 || !(fileS > 0) || !(lengthS > 0)) return ''
  const sliceS = fileS / peaks.length
  const loudest = Math.max(...peaks) || 1
  const first = Math.max(0, Math.floor(inS / sliceS))
  const last = Math.min(peaks.length - 1, Math.ceil((inS + lengthS) / sliceS))
  const top: string[] = []
  const bottom: string[] = []
  for (let i = first; i <= last; i++) {
    const x = Math.min(lengthS, Math.max(0, i * sliceS - inS)).toFixed(3)
    const h = (0.45 * peaks[i]) / loudest
    top.push(`${x} ${(0.5 - h).toFixed(3)}`)
    bottom.push(`${x} ${(0.5 + h).toFixed(3)}`)
  }
  return `M${top.join('L')}L${bottom.reverse().join('L')}Z`
}

// ---------------------------------------------------------------------------
// Volume of a clip (pure)
// ---------------------------------------------------------------------------

/** A breakpoint of the volume of a clip: gain at `t` seconds, linear between breakpoints. */
export interface GainPoint {
  t: number
  gain: number
}

/** Length a clip plays: its duration, never past the end of its file (`fileS`, when known). */
export function musicLengthS(clip: Pick<FilmAudio, 'durationS' | 'inS'>, fileS?: number): number {
  return Math.max(0, fileS === undefined ? clip.durationS : Math.min(clip.durationS, fileS - clip.inS))
}

/**
 * Volume of a clip over its `lengthS` (seconds from its start): 0 → volume over the fade in, volume, volume → 0
 * over the fade out; fades longer than the clip together are shortened in proportion.
 */
export function musicEnvelope(clip: Pick<FilmAudio, 'volume' | 'fadeInS' | 'fadeOutS'>, lengthS: number): GainPoint[] {
  const length = Math.max(0, lengthS)
  let fadeIn = Math.max(0, clip.fadeInS)
  let fadeOut = Math.max(0, clip.fadeOutS)
  if (fadeIn + fadeOut > length) {
    const k = length / (fadeIn + fadeOut)
    fadeIn *= k
    fadeOut *= k
  }
  const v = clip.volume
  return [
    { t: 0, gain: fadeIn > 0 ? 0 : v },
    { t: fadeIn, gain: v },
    { t: length - fadeOut, gain: v },
    { t: length, gain: fadeOut > 0 ? 0 : v },
  ]
}

/** Gain of an envelope at `t` (0 outside it). */
export function envelopeAt(points: readonly GainPoint[], t: number): number {
  if (points.length === 0 || t < points[0].t || t > points[points.length - 1].t) return 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (t <= b.t) return b.t > a.t ? a.gain + ((b.gain - a.gain) * (t - a.t)) / (b.t - a.t) : b.gain
  }
  return points[points.length - 1].gain
}

/** Gain of a clip at film time `timeS` (0 when it does not play then). */
export function musicGainAt(clip: FilmAudio, timeS: number, fileS?: number): number {
  const length = musicLengthS(clip, fileS)
  const local = timeS - clip.startS
  return local < 0 || local >= length ? 0 : envelopeAt(musicEnvelope(clip, length), local)
}

/** End of the music in film time (0 without music). */
export function musicEndS(clips: readonly FilmAudio[], fileS: (src: string) => number | undefined): number {
  return clips.reduce((end, c) => Math.max(end, c.startS + musicLengthS(c, fileS(c.src))), 0)
}

/** A clip placed in the exported film: plays its file from `fromS` for `lengthS` at output time `atS`. */
export interface MixEntry {
  src: string
  atS: number
  fromS: number
  lengthS: number
  /** volume breakpoints in output time */
  points: GainPoint[]
}

/**
 * Clips of the exported film: film time + `offsetS` (frames held before the film) = output time; clips starting
 * at or after `totalS`, without their file or past its end are left out.
 */
export function musicMixPlan(
  clips: readonly FilmAudio[],
  fileS: (src: string) => number | undefined,
  offsetS: number,
  totalS: number,
): MixEntry[] {
  const plan: MixEntry[] = []
  for (const clip of clips) {
    const length = fileS(clip.src)
    if (length === undefined) continue
    const lengthS = musicLengthS(clip, length)
    const atS = offsetS + clip.startS
    if (!(lengthS > 0) || atS >= totalS) continue
    const points = musicEnvelope(clip, lengthS).map((p) => ({ t: atS + p.t, gain: p.gain }))
    plan.push({ src: clip.src, atS, fromS: clip.inS, lengthS, points })
  }
  return plan
}

// ---------------------------------------------------------------------------
// Sound of the video clips, music lowered under them (pure)
// ---------------------------------------------------------------------------

/** Fade at both edges of a clip's sound (seconds): too short to be heard, long enough to avoid a click. */
export const CLIP_EDGE_FADE_S = 0.02
/** How much the music is lowered under a clip with sound (dB), and how long it takes to go down or back up (seconds). */
export const DUCK_DB = -10
export const DUCK_RAMP_S = 0.3
export const DUCK_GAIN = 10 ** (DUCK_DB / 20)

/** The sound of a video clip in the film: its file played from `fromS` for `lengthS`, from film time `startS`. */
export interface ClipSound {
  src: string
  startS: number
  fromS: number
  lengthS: number
  volume: number
}

/**
 * The clips heard in the film (`clipHasSound`), for as long as their file runs: past `outS` or the end of the file
 * the last frame is held, silent. Clips without their file are left out.
 */
export function clipSounds(media: readonly FilmMedia[], fileS: (src: string) => number | undefined): ClipSound[] {
  const sounds: ClipSound[] = []
  for (const m of media) {
    const file = fileS(m.src)
    if (!clipHasSound(m) || file === undefined) continue
    const fromS = m.inS ?? 0
    const lengthS = Math.min(m.durationS, Math.min(m.outS ?? Infinity, file) - fromS)
    if (lengthS > 0) sounds.push({ src: m.src, startS: m.startS, fromS, lengthS, volume: m.volume ?? 1 })
  }
  return sounds
}

/** Volume of a clip's sound over its length: its volume, faded over `CLIP_EDGE_FADE_S` at both edges. */
export function clipSoundEnvelope(sound: Pick<ClipSound, 'volume' | 'lengthS'>): GainPoint[] {
  return musicEnvelope({ volume: sound.volume, fadeInS: CLIP_EDGE_FADE_S, fadeOutS: CLIP_EDGE_FADE_S }, sound.lengthS)
}

/**
 * Gain of the music under the clips with sound, in film time: 1, down to `DUCK_GAIN` over the `DUCK_RAMP_S` before a
 * clip starts (so its first words are not covered), back up over the `DUCK_RAMP_S` after it ends; clips closer than
 * two ramps are one (no bounce in between); a clip at the very start finds the music already lowered. [] without
 * clips: the music is left alone.
 */
export function duckEnvelope(sounds: readonly Pick<ClipSound, 'startS' | 'lengthS'>[]): GainPoint[] {
  const spans = sounds.map((s) => ({ from: s.startS, to: s.startS + s.lengthS })).sort((a, b) => a.from - b.from)
  const merged: { from: number; to: number }[] = []
  for (const span of spans) {
    const last = merged[merged.length - 1]
    if (last && span.from - last.to < 2 * DUCK_RAMP_S) last.to = Math.max(last.to, span.to)
    else merged.push({ ...span })
  }
  const points: GainPoint[] = []
  for (const { from, to } of merged) {
    if (from <= 0) points.push({ t: 0, gain: DUCK_GAIN })
    else points.push({ t: Math.max(0, from - DUCK_RAMP_S), gain: 1 }, { t: from, gain: DUCK_GAIN })
    points.push({ t: to, gain: DUCK_GAIN }, { t: to + DUCK_RAMP_S, gain: 1 })
  }
  return points
}

/** Gain of a ducking envelope at `t`: its first value before it, its last one after it, 1 without points. */
export function duckGainAt(points: readonly GainPoint[], t: number): number {
  if (points.length === 0) return 1
  if (t <= points[0].t) return points[0].gain
  if (t >= points[points.length - 1].t) return points[points.length - 1].gain
  return envelopeAt(points, t)
}

const shifted = (points: readonly GainPoint[], byS: number) => points.map((p) => ({ t: p.t + byS, gain: p.gain }))

/** Everything the exported soundtrack plays, in output time (see `filmMixPlan`). */
export interface FilmMixPlan {
  music: MixEntry[]
  /** video clips with sound (`src`: the clip's file) */
  clips: MixEntry[]
  /** gain of the music bus (the ducking), [] to leave it at 1 */
  duck: GainPoint[]
}

/**
 * The soundtrack of the exported film: its music (`musicMixPlan`), its video clips with sound, each at film time +
 * `offsetS` with its trim and its edge fades, and the music lowered under them when `duckMusic` is set; whatever
 * starts at or after `totalS` is left out.
 */
export function filmMixPlan(
  film: Pick<Film, 'audio' | 'media' | 'duckMusic'>,
  fileS: (src: string) => number | undefined,
  offsetS: number,
  totalS: number,
): FilmMixPlan {
  const music = musicMixPlan(film.audio, fileS, offsetS, totalS)
  const sounds = clipSounds(film.media, fileS).filter((s) => offsetS + s.startS < totalS)
  const clips = sounds.map((s) => {
    const atS = offsetS + s.startS
    return { src: s.src, atS, fromS: s.fromS, lengthS: s.lengthS, points: shifted(clipSoundEnvelope(s), atS) }
  })
  const duck = film.duckMusic && music.length > 0 ? shifted(duckEnvelope(sounds), offsetS) : []
  return { music, clips, duck }
}

/**
 * Flyover duration (seconds at ×1, within `range`, at 1/100) at which the film lasts `endS`: `totalFor(d)` is the
 * length of the film for a flyover duration `d` (stops, speed portions and shots included, increasing with `d`).
 * Found by the secant method from `current`; the nearest end of the range when `endS` is out of reach.
 */
export function durationForFilmEnd(endS: number, totalFor: (durationS: number) => number, current: number, range: { min: number; max: number }): number {
  const inRange = (d: number) => clamp(d, range.min, range.max)
  let d0 = inRange(current)
  let t0 = totalFor(d0)
  let d1 = inRange(d0 + endS - t0)
  let t1 = totalFor(d1)
  for (let k = 0; k < 12 && Math.abs(t1 - endS) > 0.005; k++) {
    const slope = d1 !== d0 ? (t1 - t0) / (d1 - d0) : 1
    const next = inRange(d1 + (endS - t1) / (slope > 0 ? slope : 1))
    if (next === d1) break
    d0 = d1
    t0 = t1
    d1 = next
    t1 = totalFor(d1)
  }
  return Math.round(d1 * 100) / 100
}

/**
 * « Caler la durée du film sur la musique »: sets the flyover duration at which the film ends with the music (one
 * undo step, within the range of the duration); the message saying what was done.
 */
export function fitFilmToMusic(): { kind: 'success' | 'info'; text: string } {
  const source = getFilmSource()
  const table = useMediaStore.getState().table
  const endS = musicEndS(source.film.audio, (src) => table[src]?.durationS)
  if (!source.track || !(endS > 0)) return { kind: 'info', text: 'Pas de musique dans le film.' }
  const totalFor = (durationS: number) => filmClockFor({ ...source, durationS }).totalTime()
  const durationS = durationForFilmEnd(endS, totalFor, source.durationS, FLYOVER_DURATION_RANGE)
  if (durationS !== source.durationS) getSettingsHistory().transaction(() => setFlightTiming({ durationS }))
  const total = totalFor(durationS)
  if (Math.abs(total - endS) < 0.5) return { kind: 'success', text: `Le film dure maintenant ${formatFilmTime(total)} : il finit avec la musique.` }
  return {
    kind: 'info',
    text: `Le film dure ${formatFilmTime(total)} et la musique ${formatFilmTime(endS)} : la durée du survol va de ${FLYOVER_DURATION_RANGE.min} s à ${FLYOVER_DURATION_RANGE.max / 60} min.`,
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** Rate at which a file is decoded for its waveform and its beats (enough for both, light in memory). */
const PEAKS_SAMPLE_RATE = 22050

const megabytes = (bytes: number) => Math.ceil(bytes / (1024 * 1024))

/**
 * A sound file -> its entry of the media table: the file as it is, its length and waveform. Throws a French message
 * when it is not a sound file, too large or not decoded by the browser.
 */
export async function readAudio(file: Blob & { name?: string }, name = file.name): Promise<{ asset: MediaAsset }> {
  const type = audioTypeOf({ type: file.type, name })
  if (!type) throw new Error('format non pris en charge (MP3, M4A, AAC, OGG, Opus, WAV ou FLAC).')
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error(
      `fichier audio trop lourd (${megabytes(file.size)} Mo) : ${megabytes(MAX_AUDIO_BYTES)} Mo au plus, car il est enregistré dans le projet. Préférez un MP3 ou un M4A à un WAV ou un FLAC.`,
    )
  }
  let decoded: AudioBuffer
  try {
    decoded = await decodeForAnalysis(await file.arrayBuffer())
  } catch {
    throw new Error('ce navigateur ne sait pas lire ce fichier audio (essayez un MP3).')
  }
  const durationS = Math.round(decoded.duration * 1000) / 1000
  if (!(durationS > 0)) throw new Error('fichier audio vide.')
  const channels = channelsOf(decoded)
  const peaks = computePeaks(channels, peakCount(durationS))
  const beats = detectBeats(channels, decoded.sampleRate)
  return { asset: { data: await blobToDataUrl(file, `audio/${type}`), name, durationS, peaks, beats } }
}

const decodeForAnalysis = (bytes: ArrayBuffer) => new OfflineAudioContext(1, 1, PEAKS_SAMPLE_RATE).decodeAudioData(bytes)
const channelsOf = (decoded: AudioBuffer) => Array.from({ length: decoded.numberOfChannels }, (_, c) => decoded.getChannelData(c))

// ---------------------------------------------------------------------------
// Beats: « Caler sur le rythme »
// ---------------------------------------------------------------------------

/**
 * Beats of sound file `src` of the media table; for a file read before they were, found first and kept in its entry
 * (saved with the project). Undefined without the file or when it cannot be decoded.
 */
async function musicBeats(src: string): Promise<MusicBeats | undefined> {
  const asset = useMediaStore.getState().table[src]
  if (!asset || asset.beats) return asset?.beats
  let decoded: AudioBuffer
  try {
    decoded = await decodeForAnalysis(await dataUrlToBlob(asset.data).arrayBuffer())
  } catch {
    return undefined
  }
  const beats = detectBeats(channelsOf(decoded), decoded.sampleRate)
  // unless another project was opened meanwhile
  useMediaStore.setState(({ table }) => (table[src] === asset ? { table: { ...table, [src]: { ...asset, beats } } } : {}))
  return beats
}

/**
 * « Caler sur le rythme »: the title cards and the stops of the film moved onto the beats of its music
 * (`snapFilmToBeats`: titles, stops and speed portions; one undo step, the generated stops written out); nothing done when no music has a confident
 * tempo. The message saying what was done.
 */
export async function snapFilmToMusic(): Promise<{ kind: 'success' | 'info'; text: string }> {
  const files = [...new Set(getFilmSource().film.audio.map((a) => a.src))]
  if (files.length === 0) return { kind: 'info', text: 'Pas de musique dans le film.' }
  const found = new Map<string, MusicBeats | undefined>()
  for (const src of files) found.set(src, await musicBeats(src))

  // the film as it is once the music is analysed
  const source = getFilmSource()
  const table = useMediaStore.getState().table
  const beats = filmBeats(source.film.audio, (src) => found.get(src), (clip) => musicLengthS(clip, table[clip.src]?.durationS))
  if (beats.length === 0) return { kind: 'info', text: 'Rythme de la musique trop incertain : rien n’a été calé.' }
  const tempos = [...found.values()].flatMap((b) => (b && b.times.length > 0 ? [Math.round(b.bpm)] : []))
  const tempo = `≈ ${[...new Set(tempos)].join(' / ')} BPM`

  const { track, landmarks, pacing } = source
  const film = track ? materializeStops(source.film, { track, landmarks, pacing }) : source.film
  const input = filmClockInputFor({ ...source, film })
  const clockOf = (stops: readonly FilmStop[]) => buildFilmClock({ ...input, stops })
  const clockOfSpeeds = (stops: readonly FilmStop[], speeds: readonly FilmSpeed[]) => buildFilmClock({ ...input, stops, speeds })
  const snapped = snapFilmToBeats(film, beats, { clockOf, clockOfSpeeds, lengthM: input.lengthM })
  if (snapped.moved === 0) return { kind: 'info', text: `Arrêts, titres et portions de vitesse déjà sur le rythme, ou trop loin d’un temps (${tempo}).` }
  editFilm(() => ({ film: snapped.film }))
  const n = snapped.moved
  return { kind: 'success', text: `${n} élément${n > 1 ? 's' : ''} calé${n > 1 ? 's' : ''} sur le rythme (${tempo}).` }
}

// ---------------------------------------------------------------------------
// Export: mix
// ---------------------------------------------------------------------------

export const MIX_SAMPLE_RATE = 48000
export const MIX_CHANNELS = 2

/** The soundtrack of an exported film: one array of samples per channel, from its first frame. */
export interface MixedAudio {
  sampleRate: number
  channels: Float32Array[]
}

/** Gain automation of `param` along `points` (linear between them; before the first, the param's own value). */
function automate(param: AudioParam, points: readonly GainPoint[]) {
  const [first, ...rest] = points
  if (!first) return
  param.setValueAtTime(first.gain, first.t)
  for (const p of rest) param.linearRampToValueAtTime(p.gain, p.t)
}

/** Play `buffer` from `fromS` for `entry.lengthS` at `entry.atS`, its volume automated, into `out`. */
function schedule(ctx: OfflineAudioContext, out: AudioNode, buffer: AudioBuffer, entry: MixEntry, fromS: number) {
  const node = ctx.createBufferSource()
  node.buffer = buffer
  const gain = ctx.createGain()
  automate(gain.gain, entry.points)
  node.connect(gain).connect(out)
  node.start(entry.atS, fromS, entry.lengthS)
}

/**
 * The soundtrack of the film mixed over `lengthS` seconds of output (`offsetS`: frames held before the film): its
 * music (volume, fades, lowered under the clips when `duckMusic` is set) and the sound of its video clips; null
 * when nothing is heard. Throws a French message for a file that cannot be decoded.
 */
export async function mixFilmAudio(
  film: Pick<Film, 'audio' | 'media' | 'duckMusic'>,
  source: (src: string) => MediaAsset | undefined,
  { offsetS, lengthS }: { offsetS: number; lengthS: number },
): Promise<MixedAudio | null> {
  const plan = filmMixPlan(film, (src) => source(src)?.durationS, offsetS, lengthS)
  if (plan.music.length === 0 && plan.clips.length === 0) return null
  const ctx = new OfflineAudioContext({
    numberOfChannels: MIX_CHANNELS,
    length: Math.max(1, Math.ceil(lengthS * MIX_SAMPLE_RATE)),
    sampleRate: MIX_SAMPLE_RATE,
  })
  // the music goes through one bus, lowered under the clips; the clips straight to the output
  const musicBus = ctx.createGain()
  automate(musicBus.gain, plan.duck)
  musicBus.connect(ctx.destination)
  let heard = 0
  const decoded = new Map<string, Promise<AudioBuffer>>()
  for (const entry of plan.music) {
    const asset = source(entry.src)!
    let pending = decoded.get(entry.src)
    if (!pending) {
      pending = dataUrlToBlob(asset.data)
        .arrayBuffer()
        .then((bytes) => ctx.decodeAudioData(bytes))
      decoded.set(entry.src, pending)
    }
    let buffer: AudioBuffer
    try {
      buffer = await pending
    } catch {
      throw new Error(`Musique « ${asset.name ?? entry.src} » illisible pendant l'export.`)
    }
    schedule(ctx, musicBus, buffer, entry, entry.fromS)
    heard++
  }
  for (const entry of plan.clips) {
    const asset = source(entry.src)!
    let buffer: AudioBuffer | null
    try {
      buffer = await decodeClipSound(asset, entry.fromS, entry.lengthS)
    } catch {
      throw new Error(`Son de la vidéo « ${asset.name ?? entry.src} » illisible pendant l'export : coupez-le dans l'inspecteur de la vidéo.`)
    }
    // a clip without sound track stays silent; its buffer starts at its trim already
    if (!buffer) continue
    schedule(ctx, ctx.destination, buffer, entry, 0)
    heard++
  }
  if (heard === 0) return null
  const rendered = await ctx.startRendering()
  return {
    sampleRate: rendered.sampleRate,
    channels: Array.from({ length: rendered.numberOfChannels }, (_, c) => rendered.getChannelData(c)),
  }
}

// ---------------------------------------------------------------------------
// Preview: audio elements
// ---------------------------------------------------------------------------

/** What the preview needs of an audio element (an HTMLAudioElement; a fake in the tests). */
export interface MusicElement {
  currentTime: number
  playbackRate: number
  volume: number
  muted: boolean
  readonly paused: boolean
  readonly seeking: boolean
  readonly readyState: number
  play(): Promise<void>
  pause(): void
}

/** Drift tolerated between the music and the film while playing (seconds). */
export const MUSIC_DRIFT_S = 0.25
/** HTMLMediaElement.HAVE_FUTURE_DATA: playing, its time can be trusted */
const HAVE_FUTURE_DATA = 3

export interface MusicPlayback {
  playing: boolean
  /** film time (null: not known, e.g. at the end) */
  timeS: number | null
  speed: number
  muted: boolean
}

export interface MusicPreview {
  /**
   * play, pause or seek the element of each clip for this state of the playback, lowered along `duck` (film time,
   * `duckEnvelope`); drop those of removed clips
   */
  update(clips: readonly FilmAudio[], playback: MusicPlayback, duck?: readonly GainPoint[]): void
  dispose(): void
}

/** Audio elements of the preview, one per clip, over the media table (`source`). */
export function createMusicPreview(
  source: (src: string) => MediaAsset | undefined,
  create: (asset: MediaAsset) => { el: MusicElement; release(): void },
): MusicPreview {
  const entries = new Map<string, { asset: MediaAsset; el: MusicElement; release(): void }>()
  const drop = (id: string) => {
    const entry = entries.get(id)
    if (!entry) return
    entry.el.pause()
    entry.release()
    entries.delete(id)
  }
  return {
    update(clips, { playing, timeS, speed, muted }, duck = []) {
      const ids = new Set(clips.map((c) => c.id))
      for (const id of [...entries.keys()]) if (!ids.has(id)) drop(id)
      for (const clip of clips) {
        const asset = source(clip.src)
        if (!asset) {
          drop(clip.id)
          continue
        }
        let entry = entries.get(clip.id)
        if (!entry || entry.asset !== asset) {
          drop(clip.id)
          // made before it plays: the file loads meanwhile
          entry = { asset, ...create(asset) }
          entries.set(clip.id, entry)
        }
        const el = entry.el
        const length = musicLengthS(clip, asset.durationS)
        const local = timeS === null ? -1 : timeS - clip.startS
        if (!playing || local < 0 || local >= length) {
          if (!el.paused) el.pause()
          continue
        }
        const fileS = clip.inS + local
        el.muted = muted
        el.volume = Math.min(1, Math.max(0, musicGainAt(clip, timeS!, asset.durationS) * duckGainAt(duck, timeS!)))
        if (el.playbackRate !== speed) el.playbackRate = speed
        if (el.paused) {
          el.currentTime = fileS
          el.play().catch(() => undefined)
        } else if (!el.seeking && el.readyState >= HAVE_FUTURE_DATA && Math.abs(el.currentTime - fileS) > MUSIC_DRIFT_S) {
          el.currentTime = fileS
        }
      }
    },
    dispose() {
      for (const id of [...entries.keys()]) drop(id)
    },
  }
}

/** An audio element playing a sound file of the media table. */
function musicElement(asset: MediaAsset) {
  const url = URL.createObjectURL(dataUrlToBlob(asset.data))
  const el = new Audio()
  el.preload = 'auto'
  el.src = url
  return {
    el,
    release() {
      el.removeAttribute('src')
      el.load()
      URL.revokeObjectURL(url)
    },
  }
}

/** Sound of the preview (music and video clips) cut by the button of the timeline (not saved: the export keeps it). */
export const useMusicPreview = create<{ muted: boolean; setMuted(muted: boolean): void }>()((set) => ({
  muted: false,
  setMuted: (muted) => set({ muted }),
}))

/** Play the music along the preview from now on (stores followed); returns the function that stops it. */
export function startMusicPreview(): () => void {
  const preview = createMusicPreview((id) => useMediaStore.getState().table[id], musicElement)
  const sync = () => {
    const { settings, playback } = useAppStore.getState()
    const { playing, timeS, speed } = playback
    const { film } = settings
    const table = useMediaStore.getState().table
    const duck = film.duckMusic ? duckEnvelope(clipSounds(film.media, (src) => table[src]?.durationS)) : []
    preview.update(film.audio, { playing, timeS, speed, muted: useMusicPreview.getState().muted }, duck)
  }
  const unsubscribe = [useAppStore.subscribe(sync), useMediaStore.subscribe(sync), useMusicPreview.subscribe(sync)]
  sync()
  return () => {
    for (const u of unsubscribe) u()
    preview.dispose()
  }
}

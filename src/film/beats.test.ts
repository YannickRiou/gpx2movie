import { describe, expect, it } from 'vitest'
import { DEFAULT_PACING } from '../flyover/pacing'
import { BEAT_SNAP_S, MIN_TEMPO_CONFIDENCE, ON_BEAT_S, beatNear, beatTicksPath, detectBeats, filmBeats, isValidBeats, snapFilmToBeats } from './beats'
import type { FilmBeat, MusicBeats } from './beats'
import { buildFilmClock } from './clock'
import type { FilmClockInput } from './clock'
import { AUDIO_DEFAULTS, DEFAULT_FILM } from './model'
import type { Film, FilmAudio, FilmSpeed, FilmStop, FilmText } from './model'

const RATE = 22050

/** Seeded noise in [-1, 1]. */
function noiseSource(seed: number): () => number {
  let s = seed
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return (s / 2 ** 32) * 2 - 1
  }
}

/** `seconds` of background noise with a short noise burst on each beat from `offsetS` (every 4th from `accent` louder when set). */
function clickTrack(bpm: number, seconds: number, { offsetS = 0.37, noise = 0.05, accent = -1 } = {}): { samples: Float32Array; clicks: number[] } {
  const random = noiseSource(bpm)
  const samples = Float32Array.from({ length: RATE * seconds }, () => noise * random())
  const clicks: number[] = []
  for (let k = 0; offsetS + (k * 60) / bpm < seconds - 0.1; k++) clicks.push(offsetS + (k * 60) / bpm)
  clicks.forEach((t, k) => {
    const gain = accent < 0 || k % 4 === accent ? 0.8 : 0.3
    const at = Math.round(t * RATE)
    for (let i = 0; i < 0.03 * RATE; i++) samples[at + i] += gain * Math.exp(-i / (0.005 * RATE)) * random()
  })
  return { samples, clicks }
}

const nearest = (times: readonly number[], t: number) => Math.min(...times.map((b) => Math.abs(b - t)))

describe('beat detection', () => {
  for (const bpm of [90, 120, 150]) {
    it(`finds the tempo and the clicks of a click track at ${bpm} BPM with noise`, () => {
      const { samples, clicks } = clickTrack(bpm, 30)
      const beats = detectBeats([samples], RATE)
      expect(Math.abs(beats.bpm - bpm)).toBeLessThanOrEqual(1)
      expect(beats.confidence).toBeGreaterThanOrEqual(MIN_TEMPO_CONFIDENCE)
      const inside = clicks.filter((t) => t > 1 && t < 29)
      const hit = inside.filter((t) => nearest(beats.times, t) <= 0.025)
      expect(hit.length).toBeGreaterThanOrEqual(0.95 * inside.length)
      // one beat per click, none made up between them
      expect(beats.times.length).toBeLessThanOrEqual(clicks.length + 1)
      expect(isValidBeats(beats)).toBe(true)
    })
  }

  it('starts the bars on the accented beat', () => {
    const { samples, clicks } = clickTrack(120, 30, { accent: 1 })
    const beats = detectBeats([samples], RATE)
    const accented = clicks.filter((_, k) => k % 4 === 1)
    const bars = beats.times.filter((_, i) => (i - beats.downbeat) % 4 === 0)
    expect(bars.length).toBeGreaterThan(10)
    for (const t of bars) expect(nearest(accented, t)).toBeLessThanOrEqual(0.025)
  })

  it('mixes the channels down', () => {
    const { samples } = clickTrack(120, 20)
    const beats = detectBeats([samples, new Float32Array(samples.length)], RATE)
    expect(Math.abs(beats.bpm - 120)).toBeLessThanOrEqual(1)
  })

  it('is not confident on silence or on noise alone: no beats', () => {
    const silence = detectBeats([new Float32Array(RATE * 10)], RATE)
    expect(silence).toEqual({ bpm: 0, confidence: 0, times: [], downbeat: 0 })
    const random = noiseSource(7)
    const noise = detectBeats([Float32Array.from({ length: RATE * 20 }, () => 0.3 * random())], RATE)
    expect(noise.confidence).toBeLessThan(MIN_TEMPO_CONFIDENCE)
    expect(noise.times).toEqual([])
    expect(detectBeats([], RATE).times).toEqual([])
  })

  it('checks beats read from a project', () => {
    expect(isValidBeats({ bpm: 112.4, confidence: 0.4, times: [0.5, 1.03], downbeat: 1 })).toBe(true)
    expect(isValidBeats({ bpm: 112, confidence: 0.4, times: [-1], downbeat: 0 })).toBe(false)
    expect(isValidBeats({ bpm: 112, confidence: 2, times: [], downbeat: 0 })).toBe(false)
    expect(isValidBeats({ bpm: 112, confidence: 0.4, times: [], downbeat: 4 })).toBe(false)
    expect(isValidBeats(null)).toBe(false)
  })
})

const fileBeats: MusicBeats = { bpm: 120, confidence: 0.6, times: Array.from({ length: 400 }, (_, i) => i * 0.5), downbeat: 0 }
const clip = (patch: Partial<FilmAudio> = {}): FilmAudio => ({ id: 'music-1', src: 'audio-1', startS: 0, durationS: 200, inS: 0, ...AUDIO_DEFAULTS, ...patch })
const beatsOfFile = (src: string) => (src === 'audio-1' ? fileBeats : undefined)

describe('beats of the film', () => {
  it('shifts the beats of each clip to its start, while it plays', () => {
    const beats = filmBeats([clip({ startS: 10, inS: 1, durationS: 2 })], beatsOfFile, (c) => c.durationS)
    expect(beats).toEqual([
      { timeS: 10, bar: false },
      { timeS: 10.5, bar: false },
      { timeS: 11, bar: true },
      { timeS: 11.5, bar: false },
    ])
    expect(filmBeats([clip({ src: 'audio-2' })], beatsOfFile, (c) => c.durationS)).toEqual([])
  })

  it('draws a mark per beat, longer at a bar start', () => {
    expect(beatTicksPath(fileBeats, 1.2, 1)).toBe('M0.300 0V0.12M0.800 0V0.3')
  })

  it('picks the nearest bar start within the tolerance, else the nearest beat', () => {
    const beats: FilmBeat[] = [
      { timeS: 10, bar: true },
      { timeS: 10.5, bar: false },
      { timeS: 11, bar: false },
    ]
    expect(beatNear(beats, 10.3)).toBe(10)
    expect(beatNear(beats, 10.6)).toBe(10.5)
    expect(beatNear(beats, 11.3)).toBe(11)
    expect(beatNear(beats, 11 + BEAT_SNAP_S + 0.01)).toBeNull()
  })
})

describe('snapping the film onto the beats', () => {
  const L = 10_000
  const text = (id: string, startS: number, durationS = 4): FilmText => ({ id, startS, durationS, text: id, anchor: 'center', size: 1 })
  const stop = (id: string, atM: number): FilmStop => ({ id, atM, durationS: 4, camera: 'orbite' })
  const beats = filmBeats([clip()], beatsOfFile, (c) => c.durationS)

  function placementOf(film: Film) {
    const input: FilmClockInput = {
      opening: film.opening,
      closing: film.closing,
      stops: film.stops,
      lengthM: L,
      highlightsM: [],
      durationS: 60,
      pacing: { ...DEFAULT_PACING, keepDuration: false },
    }
    return { clockOf: (stops: readonly FilmStop[]) => buildFilmClock({ ...input, stops }), lengthM: L }
  }

  const film: Film = {
    ...DEFAULT_FILM,
    autoStops: false,
    stops: [stop('stop-1', 2000), stop('stop-2', 7130)],
    texts: [text('text-1', 10.3), text('text-2', 30.77, 2), text('text-3', 150)],
  }

  it('moves the title cards and the stops onto the beats, once', () => {
    const placement = placementOf(film)
    const { film: snapped, moved } = snapFilmToBeats(film, beats, placement)
    expect(snapped.texts.map((t) => t.startS)).toEqual([10, 31, 150])
    const holds = placement.clockOf(snapped.stops).stops.map((s) => s.holdStartS)
    for (const h of holds) expect(nearest(beats.map((b) => b.timeS), h)).toBeLessThanOrEqual(ON_BEAT_S)
    expect(moved).toBe(2 + snapped.stops.filter((s, i) => s.atM !== film.stops[i].atM).length)
    expect(snapped.stops.some((s, i) => s.atM !== film.stops[i].atM)).toBe(true)

    // the same film gives the same result; snapping again moves nothing
    expect(snapFilmToBeats(film, beats, placement)).toEqual({ film: snapped, moved })
    const again = snapFilmToBeats(snapped, beats, placementOf(snapped))
    expect(again.moved).toBe(0)
    expect(again.film).toBe(snapped)
  })

  it('moves a stop by at most the tolerance in film time', () => {
    const placement = placementOf(film)
    const before = placement.clockOf(film.stops).stops
    const after = placement.clockOf(snapFilmToBeats(film, beats, placement).film.stops).stops
    before.forEach((s, i) => expect(Math.abs(after[i].holdStartS - s.holdStartS)).toBeLessThanOrEqual(BEAT_SNAP_S + ON_BEAT_S))
  })

  it('creates no overlap, leaves items far from a beat, and passes no stop', () => {
    const touching: Film = { ...film, stops: [], texts: [text('text-a', 10, 4.2), text('text-b', 14.3, 2)] }
    expect(snapFilmToBeats(touching, beats, placementOf(touching)).film.texts.map((t) => t.startS)).toEqual([10, 14.3])
    const late: Film = { ...film, stops: [], texts: [text('text-1', 250)] }
    expect(snapFilmToBeats(late, beats, placementOf(late))).toEqual({ film: late, moved: 0 })
    const together: Film = { ...film, texts: [], stops: [stop('stop-1', 2000), stop('stop-2', 2000)] }
    expect(snapFilmToBeats(together, beats, placementOf(together)).moved).toBe(0)
  })

  it('moves the start of a speed portion onto a beat, its length kept, once', () => {
    const slow: Film = { ...film, stops: [], texts: [], speeds: [{ id: 'speed-1', fromM: 3420, toM: 3820, factor: 0.5 }] }
    const base = placementOf(slow)
    const clockOfSpeeds = (stops: readonly FilmStop[], speeds: readonly FilmSpeed[]) =>
      buildFilmClock({ opening: slow.opening, closing: slow.closing, stops, speeds, lengthM: L, highlightsM: [], durationS: 60, pacing: { ...DEFAULT_PACING, keepDuration: false } })
    const placement = { ...base, clockOfSpeeds }
    const { film: snapped, moved } = snapFilmToBeats(slow, beats, placement)
    expect(moved).toBe(1)
    const [portion] = snapped.speeds
    expect(portion.toM - portion.fromM).toBe(400)
    const startS = clockOfSpeeds([], snapped.speeds).timeAtProgress(portion.fromM / L)
    expect(nearest(beats.map((b) => b.timeS), startS)).toBeLessThanOrEqual(BEAT_SNAP_S / 4)
    expect(snapFilmToBeats(snapped, beats, placement).moved).toBe(0)
    // without the clock of the portions, they stay where they are
    expect(snapFilmToBeats(slow, beats, base).moved).toBe(0)
  })

  it('places a stop inside a moved portion on the clock with the portion moved: snapping again moves nothing', () => {
    const clockOfSpeeds = (stops: readonly FilmStop[], speeds: readonly FilmSpeed[]) =>
      buildFilmClock({ opening: film.opening, closing: film.closing, stops, speeds, lengthM: L, highlightsM: [], durationS: 60, pacing: { ...DEFAULT_PACING, keepDuration: false } })
    const inside: Film = { ...film, texts: [], stops: [stop('stop-1', 3700)], speeds: [{ id: 'speed-1', fromM: 3420, toM: 3920, factor: 0.25 }] }
    const placementWith = (f: Film) => ({ clockOf: (s: readonly FilmStop[]) => clockOfSpeeds(s, f.speeds), clockOfSpeeds, lengthM: L })
    const { film: snapped } = snapFilmToBeats(inside, beats, placementWith(inside))
    const hold = clockOfSpeeds(snapped.stops, snapped.speeds).stops[0].holdStartS
    expect(nearest(beats.map((b) => b.timeS), hold)).toBeLessThanOrEqual(ON_BEAT_S)
    expect(snapFilmToBeats(snapped, beats, placementWith(snapped)).moved).toBe(0)
  })
})

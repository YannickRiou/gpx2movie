import { describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import { buildPacing, DEFAULT_PACING, PAUSE_EASE_S } from '../flyover/pacing'
import type { PacingSettings } from '../flyover/pacing'
import { buildTrack } from '../import/stats'
import type { Landmark } from '../osm/landmarks'
import { buildFilmClock, filmClockFor } from './clock'
import type { FilmClock, FilmClockInput } from './clock'
import { DEFAULT_FILM } from './model'
import type { Film, FilmShot, FilmStop } from './model'

const L = 10_000
const D = 60
const OFF: PacingSettings = { ...DEFAULT_PACING, keepDuration: false }
const NONE: FilmShot = { style: 'aucune', durationS: 5 }
const OPEN: FilmShot = { style: 'descente', durationS: 6 }
const CLOSE: FilmShot = { style: 'saut', durationS: 4 }

const clockOf = (patch: Partial<FilmClockInput>): FilmClock =>
  buildFilmClock({ opening: OPEN, closing: CLOSE, stops: [], lengthM: L, highlightsM: [], durationS: D, pacing: OFF, ...patch })
const stop = (id: string, atM: number, durationS: number, camera: FilmStop['camera'] = 'fixe'): FilmStop => ({ id, atM, durationS, camera })

describe('film clock — phases', () => {
  const clock = clockOf({ stops: [stop('b', 7000, 4, 'orbite'), stop('a', 2000, 2)] })

  it('opening, flight with its stops, closing; total = sum', () => {
    expect(clock.openingS).toBe(6)
    expect(clock.closingS).toBe(4)
    expect(clock.flightS).toBeCloseTo(D + 6, 9)
    expect(clock.totalTime()).toBeCloseTo(6 + D + 6 + 4, 9)
    // stops sorted by position, placed in film time (opening included)
    expect(clock.stops.map((s) => s.id)).toEqual(['a', 'b'])
    expect(clock.stops[0].holdStartS).toBeCloseTo(6 + 2000 / L * D + PAUSE_EASE_S / 2, 9)
  })

  it('states: progress 0 in the opening, 1 in the closing, the stop window as its own phase', () => {
    expect(clock.stateAt(-1)).toMatchObject({ phase: 'opening', timeS: 0, progress: 0, localS: 0, lengthS: 6 })
    expect(clock.stateAt(3)).toMatchObject({ phase: 'opening', progress: 0, flightTimeS: 0, localS: 3 })
    expect(clock.stateAt(6)).toMatchObject({ phase: 'flight', progress: 0, flightTimeS: 0 })
    const [a, b] = clock.stops
    const inA = clock.stateAt((a.holdStartS + a.holdEndS) / 2)
    expect(inA.phase).toBe('stop')
    expect(inA.stop?.id).toBe('a')
    expect(inA.progress).toBeCloseTo(0.2, 12)
    expect(inA.lengthS).toBeCloseTo(2 + PAUSE_EASE_S, 9)
    expect(clock.stateAt(a.startS).localS).toBe(0)
    expect(clock.stateAt(a.endS).phase).toBe('flight')
    expect(clock.stateAt(b.startS + 0.01).stop?.camera).toBe('orbite')
    const end = clock.stateAt(6 + clock.flightS)
    expect(end).toMatchObject({ phase: 'closing', progress: 1, localS: 0, lengthS: 4 })
    expect(end.flightTimeS).toBeCloseTo(clock.flightS, 9)
    expect(clock.stateAt(1e9)).toMatchObject({ phase: 'closing', progress: 1, localS: 4 })
  })

  it('progress from time: constant during the shots, continuous and non-decreasing', () => {
    let previous = 0
    for (let t = 0; t <= clock.totalTime(); t += 0.05) {
      const p = clock.progressAtTime(t)
      expect(p).toBeGreaterThanOrEqual(previous)
      expect(p - previous).toBeLessThanOrEqual(0.05 / D + 1e-12)
      expect(p).toBe(clock.stateAt(t).progress)
      previous = p
    }
    expect(clock.progressAtTime(5.9)).toBe(0)
    expect(clock.progressAtTime(clock.totalTime() - 1)).toBe(1)
  })

  it('time from a scrubbed progress: the flight (after the opening), the end of the film at 1', () => {
    expect(clock.timeAtProgress(0)).toBe(6)
    expect(clock.timeAtProgress(0.1)).toBeCloseTo(12, 9)
    expect(clock.timeAtProgress(0.2)).toBeCloseTo(clock.stops[0].holdStartS, 9)
    expect(clock.timeAtProgress(1)).toBe(clock.totalTime())
    expect(clock.positionAt(0.5)).toEqual({ timeS: clock.timeAtProgress(0.5), progress: 0.5 })
  })

  it('advance: plays the opening, the stops and the closing, then ends at the total time', () => {
    let position = { timeS: 0, progress: 0 }
    let frames = 0
    while (position.timeS < clock.totalTime() && frames < 100_000) {
      position = clock.advance(position, 1 / 30, 1)
      frames++
    }
    expect(position.progress).toBe(1)
    expect(frames / 30).toBeCloseTo(clock.totalTime(), 1)
    expect(clock.advance({ timeS: 1, progress: 0 }, 1, 2)).toEqual({ timeS: 3, progress: 0 })
  })
})

describe('film clock — equivalence with the pacing', () => {
  const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180
  const points = []
  for (let d = 0; d <= 5000; d += 10) {
    const ele = d < 1000 ? 1000 : d < 3000 ? 1000 + ((d - 1000) / 2000) * 200 : 1200
    points.push({ lon: 6.8, lat: 45.8 + d / M_PER_DEG_LAT, ele })
  }
  const track: Track = buildTrack({ name: 'test', source: 'gpx', segments: [{ points }] })
  const landmarks: Landmark[] = [
    { id: 'node/1', kind: 'pass', name: 'Col', lon: 6.8, lat: 45.8, distanceM: 20, alongM: 1500, priority: 10, text: 'Col' },
  ]
  const noShots: Film = { ...DEFAULT_FILM, opening: NONE, closing: NONE }

  it('without shots, the generated stops replay the pacing exactly (pauses and slow-downs)', () => {
    for (const pacing of [DEFAULT_PACING, { ...DEFAULT_PACING, enabled: true }, { ...DEFAULT_PACING, enabled: true, keepDuration: false, pauseS: 4 }]) {
      const before = buildPacing({ track, durationS: D, settings: pacing, landmarks })
      const clock = filmClockFor({ track, film: noShots, durationS: D, pacing, landmarks })
      expect(clock.totalTime()).toBeCloseTo(before.totalTime(), 9)
      expect(clock.highlights).toEqual(before.highlights)
      expect(clock.stops.map((s) => s.holdStartS)).toEqual(before.pauses.map((p) => p.holdStartS))
      for (let t = 0; t <= before.totalTime(); t += 0.25) expect(clock.progressAtTime(t)).toBeCloseTo(before.progressAtTime(t), 12)
      for (let i = 0; i <= 100; i++) expect(clock.timeAtProgress(i / 100)).toBeCloseTo(before.timeAtProgress(i / 100), 9)
    }
  })

  it('with the default shots: the same flight, shifted by the opening', () => {
    const pacing = { ...DEFAULT_PACING, enabled: true }
    const before = buildPacing({ track, durationS: D, settings: pacing, landmarks })
    const clock = filmClockFor({ track, film: DEFAULT_FILM, durationS: D, pacing, landmarks })
    const O = DEFAULT_FILM.opening.durationS
    expect(clock.totalTime()).toBeCloseTo(O + before.totalTime() + DEFAULT_FILM.closing.durationS, 9)
    for (let t = 0; t <= before.totalTime(); t += 0.5) expect(clock.progressAtTime(O + t)).toBeCloseTo(before.progressAtTime(t), 12)
  })

  it('own stops replace the generated ones; no track: the bare flight duration and shots', () => {
    const pacing = { ...DEFAULT_PACING, enabled: true }
    const own: Film = { ...noShots, autoStops: false, stops: [stop('stop-1', 2500, 7, 'orbite')] }
    const clock = filmClockFor({ track, film: own, durationS: D, pacing, landmarks })
    expect(clock.stops.map((s) => s.id)).toEqual(['stop-1'])
    expect(clock.totalTime()).toBeCloseTo(D, 9)

    const empty = filmClockFor({ track: undefined, film: DEFAULT_FILM, durationS: D, pacing })
    expect(empty.stops).toEqual([])
    expect(empty.totalTime()).toBe(D + 11)
  })
})

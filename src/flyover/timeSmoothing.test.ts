import { describe, expect, it } from 'vitest'
import type { Vector3 } from 'three'
import { buildFilmClock } from '../film/clock'
import type { FilmShot, FilmStop } from '../film/model'
import { createLocalFrame } from '../geo/ellipsoid'
import { buildTrack } from '../import/stats'
import { DEFAULT_CAMERA, type CameraSettings } from './cameraSettings'
import { computeFilmView, type FilmViewOptions } from './filmCamera'
import { DEFAULT_PACING } from './pacing'
import { buildTrackPath } from './path'
import { easedEndTimeS, TIME_SMOOTHING_SAMPLES, timeSmoothing, windowAverage } from './timeSmoothing'

const frame = createLocalFrame(6.85, 45.9)
/** ~4.4 km straight north at 1000 m */
const path = buildTrackPath(
  buildTrack({
    name: 't',
    source: 'gpx',
    segments: [{ points: [{ lon: 6.85, lat: 45.88, ele: 1000 }, { lon: 6.85, lat: 45.92, ele: 1000 }] }],
  }),
)
const flat = () => 1000
const NONE: CameraSettings = { ...DEFAULT_CAMERA, aimSmoothingS: 0, cameraSmoothingS: 0, endingS: 0 }

const clockOf = (opening: FilmShot, closing: FilmShot, stops: FilmStop[] = []) =>
  buildFilmClock({
    opening,
    closing,
    stops,
    lengthM: path.lengthM,
    highlightsM: [],
    durationS: 60,
    pacing: { ...DEFAULT_PACING, keepDuration: false },
  })
const NO_SHOT: FilmShot = { style: 'aucune', durationS: 0 }

const viewAt = (clock: ReturnType<typeof clockOf>, t: number, camera: CameraSettings) => {
  const options: FilmViewOptions = { exaggeration: 1, liftM: 3, camera, durationS: 60, aspect: 16 / 9 }
  return computeFilmView(path, clock, t, clock.progressAtTime(t), frame, flat, options)
}

/** Camera positions frame by frame at 30 i/s over [fromS, toS]. */
function positions(clock: ReturnType<typeof clockOf>, camera: CameraSettings, fromS: number, toS: number): Vector3[] {
  const out: Vector3[] = []
  for (let i = 0; fromS + i / 30 <= toS; i++) out.push(viewAt(clock, fromS + i / 30, camera).position)
  return out
}

/** Largest change of the per-frame step (metres per frame²): the jerk a viewer sees. */
function maxAcceleration(points: Vector3[]): number {
  let max = 0
  for (let i = 2; i < points.length; i++) {
    const a = points[i].clone().sub(points[i - 1]).sub(points[i - 1].clone().sub(points[i - 2]))
    max = Math.max(max, a.length())
  }
  return max
}

describe('window average', () => {
  it('a fixed number of samples whatever the window; linear motion unchanged, a constant kept', () => {
    let calls = 0
    const linear = (t: number) => {
      calls++
      return 3 * t + 1
    }
    expect(windowAverage(linear, 10, 7.5)).toBeCloseTo(31, 9)
    expect(calls).toBe(TIME_SMOOTHING_SAMPLES)
    expect(windowAverage(() => 0.4, 5, 2)).toBeCloseTo(0.4, 12)
    expect(windowAverage(linear, 10, 0)).toBe(31)
  })

  it('pure: the same time gives the same value, whatever was computed before', () => {
    const clock = clockOf(NO_SHOT, NO_SHOT, [{ id: 's', atM: 2000, durationS: 4, camera: 'fixe' }])
    const smoothed = { ...NONE, aimSmoothingS: 2, cameraSmoothingS: 5, endingS: 3 }
    const first = timeSmoothing(clock, 30, 30, smoothed)
    for (const t of [59, 0, 12.3]) timeSmoothing(clock, t, t, smoothed)
    expect(timeSmoothing(clock, 30, 30, smoothed)).toEqual(first)
    const view = viewAt(clock, 30, smoothed)
    viewAt(clock, 3, smoothed)
    expect(viewAt(clock, 30, smoothed).position.equals(view.position)).toBe(true)
  })
})

describe('ending ease', () => {
  it('unchanged before, then slowing down to a stop half the ease short of the end, held after', () => {
    expect(easedEndTimeS(10, 20, 4)).toBe(10)
    expect(easedEndTimeS(16, 20, 4)).toBe(16)
    expect(easedEndTimeS(20, 20, 4)).toBeCloseTo(18, 12)
    expect(easedEndTimeS(25, 20, 4)).toBeCloseTo(18, 12)
    expect(easedEndTimeS(25, 20, 0)).toBe(25)
    // speed 1 where it starts, 0 at the end, never backwards
    expect((easedEndTimeS(16.001, 20, 4) - 16) / 0.001).toBeCloseTo(1, 3)
    expect((easedEndTimeS(20, 20, 4) - easedEndTimeS(19.999, 20, 4)) / 0.001).toBeCloseTo(0, 3)
    for (let t = 16; t < 21; t += 0.1) expect(easedEndTimeS(t + 0.1, 20, 4)).toBeGreaterThanOrEqual(easedEndTimeS(t, 20, 4))
  })

  it('the camera comes to rest at the end of the flight while the aim follows the marker to the finish', () => {
    const clock = clockOf(NO_SHOT, NO_SHOT)
    const camera = { ...NONE, endingS: 3 }
    const end = clock.totalTime()
    const last = positions(clock, camera, end - 3, end)
    const step = (i: number) => last[i].distanceTo(last[i - 1])
    const cruising = positions(clock, NONE, 20, 20 + 1 / 30)
    expect(step(1)).toBeCloseTo(cruising[1].distanceTo(cruising[0]), 0)
    expect(step(last.length - 1)).toBeLessThan(0.05 * step(1))
    expect(viewAt(clock, end, camera).target.distanceTo(viewAt(clock, end, NONE).target)).toBeLessThan(1e-6)
    // the orbit style stops turning too
    const orbit = { ...camera, style: 'orbit' as const }
    expect(viewAt(clock, end, orbit).position.distanceTo(viewAt(clock, end - 1 / 30, orbit).position)).toBeLessThan(0.05 * step(1))
  })
})

describe('film camera smoothed in time', () => {
  it('constant speed: the same view as without smoothing, away from the edges of the flight', () => {
    const clock = clockOf(NO_SHOT, NO_SHOT)
    const smoothed = { ...NONE, aimSmoothingS: 2, cameraSmoothingS: 7.5 }
    for (const t of [10, 30, 50]) {
      const a = viewAt(clock, t, smoothed)
      const b = viewAt(clock, t, NONE)
      expect(a.position.distanceTo(b.position)).toBeLessThan(1e-3)
      expect(a.target.distanceTo(b.target)).toBeLessThan(1e-3)
    }
  })

  it('a stop does not jerk: the camera slows down and moves off smoothly, its acceleration bounded', () => {
    const clock = clockOf(NO_SHOT, NO_SHOT, [{ id: 's', atM: 2000, durationS: 4, camera: 'fixe' }])
    const [stop] = clock.stops
    const raw = maxAcceleration(positions(clock, NONE, stop.startS - 5, stop.endS + 5))
    const smoothed = maxAcceleration(positions(clock, DEFAULT_CAMERA, stop.startS - 5, stop.endS + 5))
    const smoother = maxAcceleration(positions(clock, { ...NONE, cameraSmoothingS: 7.5, aimSmoothingS: 2 }, stop.startS - 5, stop.endS + 5))
    // the default 3 s nearly halves the jerk of a stop entered over 1.5 s, 7.5 s divide it by four
    expect(smoothed).toBeLessThan(0.6 * raw)
    expect(smoother).toBeLessThan(0.3 * raw)
  })

  it('the edges: the flight starts and ends without a jump, continuous over a film with shots and stops', () => {
    const clock = clockOf({ style: 'descente', durationS: 6 }, { style: 'situation', durationS: 6 }, [
      { id: 'o', atM: 1500, durationS: 5, camera: 'orbite' },
      { id: 'w', atM: 3000, durationS: 5, camera: 'large' },
    ])
    const camera = { ...NONE, aimSmoothingS: 2, cameraSmoothingS: 7.5, endingS: 3 }
    const flightEnd = clock.openingS + clock.flightS
    // the windows reach past the film's edges (the clock clamps them): progress within [0, 1], the camera held at rest
    // from the end of the flight
    for (const t of [0, clock.totalTime()]) {
      const { aimProgress, cameraProgress } = timeSmoothing(clock, t, 0, camera)
      for (const p of [aimProgress, cameraProgress]) expect(p).toBeGreaterThanOrEqual(0)
      for (const p of [aimProgress, cameraProgress]) expect(p).toBeLessThanOrEqual(1)
    }
    const rest = timeSmoothing(clock, flightEnd, 0, camera).cameraProgress
    expect(timeSmoothing(clock, clock.totalTime(), 0, camera).cameraProgress).toBe(rest)
    // continuous over the whole film; at the start and the end of the flight, the step changes much less than without
    const all = positions(clock, camera, 0, clock.totalTime())
    for (let i = 1; i < all.length; i++) expect(all[i].distanceTo(all[i - 1])).toBeLessThan(1000)
    for (const t of [clock.openingS, flightEnd]) {
      const raw = maxAcceleration(positions(clock, NONE, t - 1, t + 1))
      const smoothed = maxAcceleration(positions(clock, camera, t - 1, t + 1))
      // the velocity jump of the raw flight view (still during the shots, its corners rounded over half a second) is
      // gone; what is left is the shot's own move
      expect(smoothed).toBeLessThan(0.75 * raw)
    }
  })

  it('the dive of a situation shot still closes in at every frame', () => {
    const clock = clockOf({ style: 'situation', durationS: 8 }, NO_SHOT)
    const range = (view: { position: Vector3; target: Vector3 }) => view.position.distanceTo(view.target)
    let previous = viewAt(clock, 0, DEFAULT_CAMERA)
    for (let t = 1 / 30; t <= 8; t += 1 / 30) {
      const view = viewAt(clock, t, DEFAULT_CAMERA)
      expect(range(view)).toBeLessThan(range(previous))
      previous = view
    }
  })
})

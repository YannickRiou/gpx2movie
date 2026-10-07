import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { buildFilmClock } from '../film/clock'
import type { FilmClockInput } from '../film/clock'
import type { FilmShot, FilmStop } from '../film/model'
import { createLocalFrame } from '../geo/ellipsoid'
import { buildTrack } from '../import/stats'
import { computeCameraView, MIN_GROUND_CLEARANCE_M } from './camera'
import { DEFAULT_CAMERA } from './cameraSettings'
import {
  blendViews,
  computeFilmView,
  filmViewMovesWithTime,
  JUMP_S,
  OVERVIEW_DISTANCE_FACTOR,
  overviewView,
  shotBlend,
  smootherstep,
  stopOrbitRad,
  type FilmViewOptions,
} from './filmCamera'
import { DEFAULT_PACING } from './pacing'
import { buildTrackPath } from './path'

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
const options: FilmViewOptions = { exaggeration: 1, liftM: 3, camera: DEFAULT_CAMERA, durationS: 60, aspect: 16 / 9 }

const clockOf = (opening: FilmShot, closing: FilmShot, stops: FilmStop[] = []) =>
  buildFilmClock({
    opening,
    closing,
    stops,
    lengthM: path.lengthM,
    highlightsM: [],
    durationS: 60,
    pacing: { ...DEFAULT_PACING, keepDuration: false },
  } satisfies FilmClockInput)

const flightAt = (progress: number, timeS: number) =>
  computeCameraView(path, progress, frame, flat, { ...options, timeS })

function expectSameView(a: { position: Vector3; target: Vector3 }, b: { position: Vector3; target: Vector3 }, tolerance = 1e-6) {
  expect(a.position.distanceTo(b.position)).toBeLessThan(tolerance)
  expect(a.target.distanceTo(b.target)).toBeLessThan(tolerance)
}

describe('easing', () => {
  it('smootherstep: 0 → 1, symmetric, flat ends', () => {
    expect(smootherstep(-1)).toBe(0)
    expect(smootherstep(0.5)).toBe(0.5)
    expect(smootherstep(2)).toBe(1)
    expect(smootherstep(0.01)).toBeLessThan(1e-4)
  })

  it('descente eases over the whole shot, saut moves in JUMP_S at the end of the opening / start of the closing', () => {
    expect(shotBlend('descente', 'opening', 3, 6)).toBe(0.5)
    expect(shotBlend('saut', 'opening', 6 - JUMP_S - 0.01, 6)).toBe(0)
    expect(shotBlend('saut', 'opening', 6 - JUMP_S / 2, 6)).toBeCloseTo(0.5, 12)
    expect(shotBlend('saut', 'closing', JUMP_S / 2, 4)).toBeCloseTo(0.5, 12)
    expect(shotBlend('saut', 'closing', JUMP_S, 4)).toBe(1)
    expect(shotBlend('saut', 'opening', 0.25, 0.5)).toBe(0.5)
  })

  it('stop orbit: still at both ends of the window, out at the middle, bounded', () => {
    expect(stopOrbitRad(4, 0, 5.5)).toBe(0)
    expect(stopOrbitRad(4, 5.5, 5.5)).toBeCloseTo(0, 12)
    expect(stopOrbitRad(4, 2.75, 5.5)).toBeCloseTo((24 * Math.PI) / 180, 12)
    expect(stopOrbitRad(60, 30, 60)).toBeCloseTo((120 * Math.PI) / 180, 12)
  })
})

describe('overview', () => {
  const joined = flightAt(0, 0)

  it('frames the whole track from the side of the flight camera, farther for a tall frame', () => {
    const view = overviewView(path, frame, flat, 1, 16 / 9, joined)
    // centre of the track at ground height
    expect(view.target.x).toBeCloseTo(0, 0)
    expect(view.target.y).toBeCloseTo(frame.toLocal(6.85, 45.9, 1000).y, 0)
    const diagonal = path.lengthM
    expect(view.position.distanceTo(view.target)).toBeCloseTo(OVERVIEW_DISTANCE_FACTOR * diagonal, -1)
    // the chase camera of a northbound track is south of the marker: the overview too
    expect(view.position.z).toBeGreaterThan(view.target.z)
    const tall = overviewView(path, frame, flat, 1, 9 / 16, joined)
    expect(tall.position.distanceTo(tall.target)).toBeCloseTo((16 / 9) * view.position.distanceTo(view.target), 3)
  })

  it('blend: the end views exactly, geometric distance in between, never under the clearance', () => {
    const a = overviewView(path, frame, flat, 1, 16 / 9, joined)
    expect(blendViews(a, joined, 0, frame, flat, 1)).toBe(a)
    expect(blendViews(a, joined, 1, frame, flat, 1)).toBe(joined)
    const mid = blendViews(a, joined, 0.5, frame, flat, 1)
    const da = a.position.distanceTo(a.target)
    const db = joined.position.distanceTo(joined.target)
    expect(mid.position.distanceTo(mid.target)).toBeCloseTo(Math.sqrt(da * db), 3)
    const high = () => 1e9
    const low = { target: new Vector3(0, 0, 0), position: new Vector3(0, 10, 100) }
    const clamped = blendViews(low, { target: new Vector3(0, 0, 0), position: new Vector3(0, 20, 200) }, 0.5, frame, high, 1)
    const at = frame.toLonLat(clamped.position)
    expect(clamped.position.y).toBeCloseTo(frame.toLocal(at.lon, at.lat, 1e9 + MIN_GROUND_CLEARANCE_M).y, 0)
  })
})

describe('computeFilmView', () => {
  const descent = clockOf({ style: 'descente', durationS: 6 }, { style: 'descente', durationS: 5 })

  it('opening: the overview first, the flight view where the flight starts, the marker on the track', () => {
    const start = computeFilmView(path, descent, 0, 0, frame, flat, options)
    expectSameView(start, overviewView(path, frame, flat, 1, 16 / 9, flightAt(0, 0)))
    expect(start.marker.distanceTo(flightAt(0, 0).target)).toBeLessThan(1e-9)
    const handOver = computeFilmView(path, descent, 6 - 1e-6, 0, frame, flat, options)
    expectSameView(handOver, flightAt(0, 0), 1e-3)
    expectSameView(computeFilmView(path, descent, 6, 0, frame, flat, options), flightAt(0, 0))
  })

  it('closing: from the flight view at the end to the overview', () => {
    const t = descent.openingS + descent.flightS
    expectSameView(computeFilmView(path, descent, t, 1, frame, flat, options), flightAt(1, descent.flightS))
    const end = computeFilmView(path, descent, descent.totalTime(), 1, frame, flat, options)
    expectSameView(end, overviewView(path, frame, flat, 1, 16 / 9, flightAt(1, descent.flightS)))
  })

  it('continuous over the whole film (no jump between frames at 30 i/s)', () => {
    const clock = clockOf({ style: 'saut', durationS: 3 }, { style: 'descente', durationS: 4 }, [
      { id: 's', atM: 2000, durationS: 6, camera: 'orbite' },
    ])
    let previous = computeFilmView(path, clock, 0, 0, frame, flat, options)
    for (let t = 1 / 30; t <= clock.totalTime(); t += 1 / 30) {
      const view = computeFilmView(path, clock, t, clock.progressAtTime(t), frame, flat, options)
      // the fastest motion: the 0.6 s jump from a ~7 km overview
      expect(view.position.distanceTo(previous.position)).toBeLessThan(1000)
      previous = view
    }
  })

  it('stops: « orbite » turns around the held marker and comes back, « fixe » holds', () => {
    const stops: FilmStop[] = [
      { id: 'o', atM: 1000, durationS: 6, camera: 'orbite' },
      { id: 'f', atM: 3000, durationS: 6, camera: 'fixe' },
    ]
    const clock = clockOf({ style: 'aucune', durationS: 1 }, { style: 'aucune', durationS: 1 }, stops)
    const [orbit, fixed] = clock.stops
    const at = (t: number) => computeFilmView(path, clock, t, clock.progressAtTime(t), frame, flat, options)
    const middle = (orbit.holdStartS + orbit.holdEndS) / 2
    const held = flightAt(orbit.progress, middle)
    expect(at(middle).target.distanceTo(held.target)).toBeLessThan(1e-9)
    expect(at(middle).position.distanceTo(held.position)).toBeGreaterThan(100)
    expectSameView(at(orbit.endS), flightAt(clock.progressAtTime(orbit.endS), orbit.endS))
    expectSameView(at(fixed.holdStartS + 1), at(fixed.holdEndS - 1))
  })

  it('moves with time: shots and orbiting stops, the flight only for orbit / cinema', () => {
    const clock = clockOf({ style: 'descente', durationS: 6 }, { style: 'saut', durationS: 4 }, [
      { id: 'o', atM: 1000, durationS: 6, camera: 'orbite' },
      { id: 'f', atM: 3000, durationS: 6, camera: 'fixe' },
    ])
    const [orbit, fixed] = clock.stops
    expect(filmViewMovesWithTime(clock.stateAt(1), 'chase')).toBe(true)
    expect(filmViewMovesWithTime(clock.stateAt(clock.totalTime()), 'chase')).toBe(true)
    expect(filmViewMovesWithTime(clock.stateAt(orbit.holdStartS), 'chase')).toBe(true)
    expect(filmViewMovesWithTime(clock.stateAt(fixed.holdStartS), 'chase')).toBe(false)
    expect(filmViewMovesWithTime(clock.stateAt(fixed.holdStartS), 'orbit')).toBe(true)
    expect(filmViewMovesWithTime(clock.stateAt(40), 'sway')).toBe(false)
  })
})

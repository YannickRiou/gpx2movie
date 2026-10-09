import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { buildFilmClock } from '../film/clock'
import type { FilmClockInput } from '../film/clock'
import type { FilmCameraKey, FilmShot, FilmStop } from '../film/model'
import { createLocalFrame } from '../geo/ellipsoid'
import { buildTrack } from '../import/stats'
import { computeCameraView, MIN_GROUND_CLEARANCE_M } from './camera'
import { DEFAULT_CAMERA } from './cameraSettings'
import {
  blendViews,
  CAMERA_KEY_EASE_S,
  cameraKeyEaseM,
  computeFilmView,
  filmViewMovesWithTime,
  groundReach,
  heldMotionTimeS,
  JUMP_S,
  keyedCamera,
  OVERVIEW_DISTANCE_FACTOR,
  OVERVIEW_PITCH_DEG,
  overviewDistanceM,
  overviewView,
  COUNTRY_DISTANCE_FACTOR,
  REGION_DISTANCE_FACTOR,
  REGION_FIT_MARGIN,
  REGION_MAX_DISTANCE_M,
  REGION_MIN_DISTANCE_M,
  REGION_PITCH_DEG,
  REGION_REACH_M,
  regionDistanceM,
  regionView,
  shotBlend,
  shotWeight,
  smootherstep,
  stopOrbitRad,
  STOP_WIDE_DISTANCE_FACTOR,
  SWEEP_DEG,
  SWEEP_SHARE,
  sweepRad,
  turnedView,
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

const clockOf = (opening: FilmShot, closing: FilmShot, stops: FilmStop[] = [], cameraKeys: FilmCameraKey[] = []) =>
  buildFilmClock({
    opening,
    closing,
    stops,
    cameraKeys,
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

  it('cut: the wide view over the whole shot, the weight jumping at the boundary; « Enchaîné » is the shot blend', () => {
    for (const transition of ['coupe', 'fondu-noir', 'fondu-blanc'] as const) {
      const shot: FilmShot = { style: 'descente', durationS: 6, transition }
      for (const localS of [0, 3, 6 - 1e-9]) expect(shotWeight(shot, 'opening', localS, 6)).toBe(0)
      for (const localS of [0, 2.5, 5]) expect(shotWeight(shot, 'closing', localS, 5)).toBe(1)
    }
    for (const shot of [{ style: 'saut', durationS: 6 }, { style: 'saut', durationS: 6, transition: 'enchaine' }] as FilmShot[]) {
      for (const localS of [0, 5.6, 5.8, 6]) expect(shotWeight(shot, 'opening', localS, 6)).toBe(shotBlend('saut', 'opening', localS, 6))
    }
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

describe('region view (« Depuis la région »)', () => {
  const joined = flightAt(0, 0)
  const pitchDeg = (view: { position: Vector3; target: Vector3 }) => {
    const from = view.position.clone().sub(view.target)
    return (Math.asin(from.y / from.length()) * 180) / Math.PI
  }

  it('ground reach: the farthest frame corner on flat ground, as a camera of the scene sees it', () => {
    for (const [pitch, aspect] of [[REGION_PITCH_DEG, 16 / 9], [OVERVIEW_PITCH_DEG, 16 / 9], [REGION_PITCH_DEG, 9 / 16]]) {
      const camera = new PerspectiveCamera(50, aspect)
      camera.position.set(0, Math.sin((pitch * Math.PI) / 180), Math.cos((pitch * Math.PI) / 180))
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      let farthest = 0
      for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const ray = new Vector3(x, y, 0.5).unproject(camera).sub(camera.position)
        const hit = camera.position.clone().addScaledVector(ray, -camera.position.y / ray.y)
        farthest = Math.max(farthest, hit.length())
      }
      expect(groundReach(pitch, aspect)).toBeCloseTo(farthest, 9)
    }
  })

  it('distance: ×8 the diagonal within 55–165 km, « Pays » farther, a region box filling the frame, within reach, never under the overview', () => {
    // start altitude of the region view: a short outing from the minimum, a medium one ×8 its diagonal, a long one capped
    expect(regionDistanceM(1_000, 300, 16 / 9)).toBeCloseTo(REGION_MIN_DISTANCE_M, 6)
    expect(regionDistanceM(10_000, 3_000, 16 / 9)).toBeCloseTo(REGION_DISTANCE_FACTOR * 10_000, 6)
    expect(regionDistanceM(50_000, 15_000, 16 / 9)).toBeCloseTo(REGION_MAX_DISTANCE_M, 6)
    expect(regionDistanceM(10_000, 3_000, 16 / 9, 'pays')).toBeCloseTo(COUNTRY_DISTANCE_FACTOR * REGION_DISTANCE_FACTOR * 10_000, 6)
    // a highlighted region: its larger side fills the frame height, with the margin
    const fitted = regionDistanceM(10_000, 3_000, 16 / 9, 'region', { widthM: 120_000, heightM: 80_000 })
    expect(fitted).toBeCloseTo((REGION_FIT_MARGIN * 120_000) / (2 * Math.tan((25 * Math.PI) / 180)), 6)
    // the frame reaches no farther than REGION_REACH_M beyond the track's box
    const far = regionDistanceM(10_000, 3_000, 16 / 9, 'pays', { widthM: 2_000_000, heightM: 1_000_000 })
    expect(far * groundReach(REGION_PITCH_DEG, 16 / 9)).toBeCloseTo(3_000 + REGION_REACH_M, 6)
    for (const [diagonal, halfSide, aspect] of [[100, 0, 16 / 9], [4_400, 0, 9 / 16], [300_000, 100_000, 1]]) {
      expect(regionDistanceM(diagonal, halfSide, aspect)).toBeGreaterThanOrEqual(overviewDistanceM(diagonal, aspect))
    }
  })

  it('the overview target and side, farther and steeper', () => {
    const overview = overviewView(path, frame, flat, 1, 16 / 9, joined)
    const region = regionView(path, frame, flat, 1, 16 / 9, joined)
    expect(region.target.distanceTo(overview.target)).toBeLessThan(1e-9)
    expect(region.position.distanceTo(region.target)).toBeCloseTo(regionDistanceM(path.lengthM, 0, 16 / 9), -1)
    expect(pitchDeg(region)).toBeCloseTo(REGION_PITCH_DEG, 6)
    expect(pitchDeg(overview)).toBeCloseTo(OVERVIEW_PITCH_DEG, 6)
    expect(region.position.z).toBeGreaterThan(region.target.z)
  })

  it('opening from the region view to the flight, closing back up to it, smooth and always closing in at 30 i/s', () => {
    const clock = clockOf({ style: 'situation', durationS: 8 }, { style: 'situation', durationS: 6 })
    expectSameView(computeFilmView(path, clock, 0, 0, frame, flat, options), regionView(path, frame, flat, 1, 16 / 9, flightAt(0, 0)))
    expectSameView(computeFilmView(path, clock, 8, 0, frame, flat, options), flightAt(0, 0))
    const end = computeFilmView(path, clock, clock.totalTime(), 1, frame, flat, options)
    expectSameView(end, regionView(path, frame, flat, 1, 16 / 9, flightAt(1, clock.flightS)))

    const range = (view: { position: Vector3; target: Vector3 }) => view.position.distanceTo(view.target)
    let previous = computeFilmView(path, clock, 0, 0, frame, flat, options)
    let previousStep = 0
    // the dive in 8 s from the region view (about 55 km up for this short track), frame by frame at 30 i/s
    const dive = range(previous)
    const meanStep = dive / (8 * 30)
    for (let t = 1 / 30; t <= 8; t += 1 / 30) {
      const view = computeFilmView(path, clock, t, 0, frame, flat, options)
      const step = view.position.distanceTo(previous.position)
      expect(range(view)).toBeLessThan(range(previous))
      // the eased dive peaks at 3 × its mean speed (688 m per frame for 55 km in 8 s), with no jolt between frames
      expect(step).toBeLessThan(3.2 * meanStep)
      expect(Math.abs(step - previousStep)).toBeLessThan(0.1 * meanStep)
      previous = view
      previousStep = step
    }
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

  it('cut: the overview held until the flight starts, the flight view held until the closing, then the overview', () => {
    const clock = clockOf({ style: 'descente', durationS: 6, transition: 'fondu-noir' }, { style: 'descente', durationS: 5, transition: 'coupe' })
    const overview = overviewView(path, frame, flat, 1, 16 / 9, flightAt(0, 0))
    for (const t of [0, 3, 6 - 1e-6]) expectSameView(computeFilmView(path, clock, t, 0, frame, flat, options), overview)
    expectSameView(computeFilmView(path, clock, 6, 0, frame, flat, options), flightAt(0, 0))
    const closingS = clock.openingS + clock.flightS
    expectSameView(computeFilmView(path, clock, closingS - 1e-6, 1, frame, flat, options), flightAt(1, clock.flightS - 1e-6), 1e-2)
    const end = overviewView(path, frame, flat, 1, 16 / 9, flightAt(1, clock.flightS))
    for (const t of [closingS, closingS + 2.5, clock.totalTime()]) expectSameView(computeFilmView(path, clock, t, 1, frame, flat, options), end)
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

describe('camera keys', () => {
  const key = (id: string, atM: number, distance: number, pitchDeg: number, headingOffsetDeg = 0): FilmCameraKey => ({
    id,
    atM,
    distance,
    pitchDeg,
    headingOffsetDeg,
  })
  const keys = [key('camera-1', 1000, 2, 60), key('camera-2', 3000, 3, 70, 90)]
  const framing = (atM: number) => keyedCamera(DEFAULT_CAMERA, keys, atM, 500)

  it('the film settings far from the keys, each key at its place, eased in between', () => {
    expect(keyedCamera(DEFAULT_CAMERA, [], 1000, 500)).toBe(DEFAULT_CAMERA)
    expect(framing(400)).toEqual(DEFAULT_CAMERA)
    expect(framing(500)).toEqual(DEFAULT_CAMERA)
    expect(framing(750).distance).toBeCloseTo(1.5, 12)
    expect(framing(1000)).toEqual({ ...DEFAULT_CAMERA, distance: 2, pitchDeg: 60, headingOffsetDeg: 0 })
    expect(framing(2000)).toMatchObject({ distance: 2.5, pitchDeg: 65, headingOffsetDeg: 45 })
    expect(framing(3000)).toMatchObject({ distance: 3, pitchDeg: 70, headingOffsetDeg: 90 })
    expect(framing(3500)).toEqual(DEFAULT_CAMERA)
    // the style and the smoothing stay those of the film
    expect(keyedCamera({ ...DEFAULT_CAMERA, style: 'sway' }, keys, 2000, 500).style).toBe('sway')
  })

  it('no jerk: still at each key and at both ends of the eases', () => {
    const e = 1
    for (const atM of [500, 1000, 3000, 3500]) {
      for (const field of ['distance', 'pitchDeg', 'headingOffsetDeg'] as const) {
        const slope = (framing(atM + e)[field] - framing(atM - e)[field]) / (2 * e)
        expect(Math.abs(slope)).toBeLessThan(1e-4)
      }
    }
  })

  it('heading: the shorter way round', () => {
    const turn = [key('a', 0, 1, 30, 170), key('b', 1000, 1, 30, -170)]
    expect(keyedCamera(DEFAULT_CAMERA, turn, 500, 500).headingOffsetDeg).toBeCloseTo(180, 9)
  })

  it('ease: CAMERA_KEY_EASE_S of flight at the base speed', () => {
    expect(cameraKeyEaseM(6000, 60)).toBeCloseTo((6000 * CAMERA_KEY_EASE_S) / 60, 9)
  })

  it('the film view follows the keys (placed on the clock by position), a film without keys is unchanged', () => {
    const none = { style: 'aucune', durationS: 1 } as const
    const clock = clockOf(none, none, [], [key('camera-2', 3000, 3, 70), key('camera-1', 1000, 2, 60)])
    expect(clock.cameraKeys.map((k) => k.id)).toEqual(['camera-1', 'camera-2'])
    expect(clock.cameraKeys[0].timeS).toBeCloseTo(clock.timeAtProgress(1000 / path.lengthM), 9)
    const t = clock.timeAtProgress(1000 / path.lengthM)
    const keyed = computeFilmView(path, clock, t, 1000 / path.lengthM, frame, flat, options)
    const wanted = computeCameraView(path, 1000 / path.lengthM, frame, flat, { ...options, camera: { ...DEFAULT_CAMERA, distance: 2, pitchDeg: 60 }, timeS: t })
    expectSameView(keyed, wanted)
    const plain = clockOf(none, none)
    expectSameView(computeFilmView(path, plain, 10, plain.progressAtTime(10), frame, flat, options), flightAt(plain.progressAtTime(10), 10))
  })

  it('continuous over a film with keys and every stop camera', () => {
    const none = { style: 'aucune', durationS: 1 } as const
    const clock = clockOf(
      none,
      none,
      [
        { id: 'o', atM: 800, durationS: 4, camera: 'orbite' },
        { id: 'l', atM: 1800, durationS: 4, camera: 'large' },
        { id: 'f', atM: 2600, durationS: 4, camera: 'fixe' },
        { id: 'c', atM: 3400, durationS: 4, camera: 'film' },
      ],
      [key('camera-1', 1500, 2.5, 70, 40), key('camera-2', 3000, 0.5, 15, -60)],
    )
    for (const style of ['chase', 'orbit'] as const) {
      const opts = { ...options, camera: { ...DEFAULT_CAMERA, style } }
      let previous = computeFilmView(path, clock, 0, 0, frame, flat, opts)
      for (let t = 1 / 30; t <= clock.totalTime(); t += 1 / 30) {
        const view = computeFilmView(path, clock, t, clock.progressAtTime(t), frame, flat, opts)
        // the fastest move: the ease into the first key (600 m to 1.5 km away in 3 s)
        expect(view.position.distanceTo(previous.position)).toBeLessThan(50)
        previous = view
      }
    }
  })
})

describe('stop cameras', () => {
  const none = { style: 'aucune', durationS: 1 } as const
  const stopsOf = (camera: FilmStop['camera']) => clockOf(none, none, [{ id: 's', atM: 2000, durationS: 6, camera }])
  const viewAt = (clock: ReturnType<typeof stopsOf>, t: number, style: 'chase' | 'orbit' = 'chase') =>
    computeFilmView(path, clock, t, clock.progressAtTime(t), frame, flat, { ...options, camera: { ...DEFAULT_CAMERA, style } })
  const distance = (view: { position: Vector3; target: Vector3 }) => view.position.distanceTo(view.target)

  it('« Vue large »: farther and higher at the middle, the flight view at both ends', () => {
    const wide = stopsOf('large')
    const plain = stopsOf('film')
    const [s] = wide.stops
    const middle = (s.startS + s.endS) / 2
    expect(distance(viewAt(wide, middle))).toBeCloseTo(STOP_WIDE_DISTANCE_FACTOR * distance(viewAt(plain, middle)), 0)
    expect(viewAt(wide, middle).position.y).toBeGreaterThan(viewAt(plain, middle).position.y)
    expectSameView(viewAt(wide, s.startS), viewAt(plain, s.startS))
    expectSameView(viewAt(wide, s.endS), viewAt(plain, s.endS))
    expect(filmViewMovesWithTime(wide.stateAt(middle), 'chase')).toBe(true)
  })

  it('« Fixe » holds the orbit style, « Comme le film » lets it turn; both the same with the chase style', () => {
    const held = stopsOf('fixe')
    const plain = stopsOf('film')
    const [s] = held.stops
    expectSameView(viewAt(held, s.holdStartS + 0.1, 'orbit'), viewAt(held, s.holdEndS - 0.1, 'orbit'))
    expect(viewAt(plain, s.holdStartS + 0.1, 'orbit').position.distanceTo(viewAt(plain, s.holdEndS - 0.1, 'orbit').position)).toBeGreaterThan(10)
    expectSameView(viewAt(held, s.startS, 'orbit'), viewAt(plain, s.startS, 'orbit'))
    expectSameView(viewAt(held, s.endS, 'orbit'), viewAt(plain, s.endS, 'orbit'))
    expectSameView(viewAt(held, s.holdStartS + 1, 'chase'), viewAt(plain, s.holdStartS + 1, 'chase'))
  })

  it('held motion time: never backwards, the middle of the window during the hold', () => {
    const window = { startS: 10, holdStartS: 11.5, holdEndS: 14.5, endS: 16 }
    let previous = heldMotionTimeS(window, 9)
    expect(previous).toBe(9)
    for (let t = 9; t <= 17; t += 0.01) {
      const motion = heldMotionTimeS(window, t)
      expect(motion).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = motion
    }
    expect(heldMotionTimeS(window, 12)).toBe(13)
    expect(heldMotionTimeS(window, 16)).toBe(16)
  })
})

describe('balayage shot', () => {
  it('turns the overview first, then glides, and plays the closing backwards', () => {
    const L = 10
    expect(sweepRad('opening', 0, L)).toBeCloseTo((SWEEP_DEG * Math.PI) / 180)
    expect(sweepRad('opening', SWEEP_SHARE * L, L)).toBe(0)
    expect(shotBlend('balayage', 'opening', SWEEP_SHARE * L, L)).toBe(0)
    expect(shotBlend('balayage', 'opening', L, L)).toBe(1)
    expect(shotBlend('balayage', 'closing', 0, L)).toBe(0)
    expect(shotBlend('balayage', 'closing', (1 - SWEEP_SHARE) * L, L)).toBe(1)
    expect(sweepRad('closing', (1 - SWEEP_SHARE) * L, L)).toBe(0)
    expect(sweepRad('closing', L, L)).toBeCloseTo((SWEEP_DEG * Math.PI) / 180)
  })

  it('turns a view around the vertical through its target, keeping its distance and height', () => {
    const view = { target: new Vector3(10, 5, 0), position: new Vector3(110, 105, 0) }
    const turned = turnedView(view, Math.PI / 2)
    expect(turned.target).toEqual(view.target)
    expect(turned.position.distanceTo(view.target)).toBeCloseTo(view.position.distanceTo(view.target))
    expect(turned.position.y).toBeCloseTo(105)
    expect(turned.position.x).toBeCloseTo(10)
    expect(turnedView(view, 0)).toBe(view)
  })
})

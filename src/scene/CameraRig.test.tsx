import { describe, expect, it, vi } from 'vitest'
import { Box3, Vector3 } from 'three'
import type { Track } from '../core/types'
import { createLocalFrame } from '../geo/ellipsoid'

vi.mock('@react-three/fiber', () => ({ useFrame: vi.fn(), useThree: vi.fn() }))
vi.mock('@react-three/drei', () => ({ OrbitControls: () => null }))
vi.mock('../terrain/engine', () => ({ createTerrainEngine: vi.fn() }))

const {
  computeFitView,
  easeInOutCubic,
  fitViewDirection,
  meanTrackElevation,
  FIT_MIN_DISTANCE_M,
  FIT_DISTANCE_FACTOR,
  FIT_PITCH_RAD,
  MAX_POLAR_ANGLE_RAD,
} = await import('./CameraRig')

describe('fitViewDirection', () => {
  it('points south-east (+X, +Z) and 40° above the horizon, unit length', () => {
    const d = fitViewDirection()
    expect(d.length()).toBeCloseTo(1, 9)
    expect(d.x).toBeGreaterThan(0)
    expect(d.z).toBeGreaterThan(0)
    expect(d.x).toBeCloseTo(d.z, 9)
    expect(Math.asin(d.y)).toBeCloseTo(FIT_PITCH_RAD, 9)
  })

  it('stays inside the orbit limits so OrbitControls.update() does not move the fitted camera', () => {
    const d = fitViewDirection()
    // polar angle measured from +Y (zenith): 90° - pitch = 50°, under the 85° ceiling
    expect(Math.acos(d.y)).toBeLessThan(MAX_POLAR_ANGLE_RAD)
  })
})

describe('computeFitView', () => {
  const frame = createLocalFrame(6.5, 45.5)

  it('targets the centre of the box at ground height and backs off along the fit direction', () => {
    // ~ 7.8 km x 11 km box centred on the frame origin
    const bounds = { west: 6.45, south: 45.45, east: 6.55, north: 45.55 }
    const view = computeFitView(bounds, frame, 1500)

    // centre: horizontally at the origin (a metre or two off along z: the meridian arc per degree grows
    // with latitude, so the box is not exactly symmetric), vertically at ground height
    expect(Math.abs(view.target.x)).toBeLessThan(1)
    expect(Math.abs(view.target.z)).toBeLessThan(5)
    expect(view.target.y).toBeCloseTo(1500, -1)

    // distance = 1.4 x diagonal of the local box spanned by the four corners, above the 2 km floor here
    const box = new Box3()
    for (const [lon, lat] of [
      [bounds.west, bounds.south],
      [bounds.east, bounds.south],
      [bounds.east, bounds.north],
      [bounds.west, bounds.north],
    ]) {
      box.expandByPoint(frame.toLocal(lon, lat, 1500))
    }
    const diagonal = box.getSize(new Vector3()).length()
    expect(view.distance).toBeGreaterThan(FIT_MIN_DISTANCE_M)
    expect(view.distance).toBeCloseTo(FIT_DISTANCE_FACTOR * diagonal, 6)

    // position = target + direction * distance
    const offset = new Vector3().subVectors(view.position, view.target)
    expect(offset.length()).toBeCloseTo(view.distance, 6)
    const dir = offset.clone().normalize()
    const expected = fitViewDirection()
    expect(dir.x).toBeCloseTo(expected.x, 9)
    expect(dir.y).toBeCloseTo(expected.y, 9)
    expect(dir.z).toBeCloseTo(expected.z, 9)
  })

  it('never gets closer than the minimum fit distance', () => {
    const tiny = { west: 6.4999, south: 45.4999, east: 6.5001, north: 45.5001 }
    const view = computeFitView(tiny, frame, 0)
    expect(view.distance).toBe(FIT_MIN_DISTANCE_M)
  })
})

describe('easeInOutCubic', () => {
  it('is clamped, symmetric and monotonic', () => {
    expect(easeInOutCubic(-1)).toBe(0)
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 9)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(2)).toBe(1)
    let previous = 0
    for (let t = 0.05; t <= 1; t += 0.05) {
      const v = easeInOutCubic(t)
      expect(v).toBeGreaterThan(previous)
      previous = v
    }
    expect(easeInOutCubic(0.25) + easeInOutCubic(0.75)).toBeCloseTo(1, 9)
  })
})

describe('meanTrackElevation', () => {
  const track = (minEle?: number, maxEle?: number): Track => ({
    id: 'id',
    name: 'n',
    source: 'gpx',
    segments: [],
    stats: { distanceM: 0, ascentM: 0, descentM: 0, pointCount: 0, minEle, maxEle },
    bounds: { west: 0, south: 0, east: 0, north: 0 },
    color: '#000',
  })

  it('averages the mid-range of each track that has elevation data', () => {
    expect(meanTrackElevation([track(1000, 2000), track(500, 700)])).toBe((1500 + 600) / 2)
  })
  it('ignores tracks without elevation and returns undefined when none has it', () => {
    expect(meanTrackElevation([track(), track(100, 300)])).toBe(200)
    expect(meanTrackElevation([track()])).toBeUndefined()
    expect(meanTrackElevation([])).toBeUndefined()
  })
})

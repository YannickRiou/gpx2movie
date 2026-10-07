import { describe, expect, it, vi } from 'vitest'
import type { TrackPoint } from '../core/types'
import { createLocalFrame } from '../geo/ellipsoid'
import { buildTrack } from '../import/stats'
import { buildTrackPath } from '../flyover/path'

vi.mock('@react-three/fiber', () => ({ useFrame: vi.fn(), useThree: vi.fn() }))
vi.mock('../terrain/engine', () => ({ createTerrainEngine: vi.fn() }))

const {
  advanceProgress,
  computeChaseView,
  CHASE_DISTANCE_MIN_M,
  CHASE_PITCH_RAD,
  FLYOVER_BASE_DURATION_S,
  MIN_GROUND_CLEARANCE_M,
} = await import('./FlyoverRig')
const { LINE_LIFT_M } = await import('./TrackLines')

const frame = createLocalFrame(6.85, 45.9)
/** ~4.4 km straight north at 1000 m */
const northbound: TrackPoint[] = [
  { lon: 6.85, lat: 45.88, ele: 1000 },
  { lon: 6.85, lat: 45.92, ele: 1000 },
]
const path = buildTrackPath(buildTrack({ name: 'n', source: 'gpx', segments: [{ points: northbound }] }))

describe('advanceProgress', () => {
  it('covers the whole track in the base duration at speed x1 and scales with speed', () => {
    expect(advanceProgress(0, FLYOVER_BASE_DURATION_S / 2, 1)).toBeCloseTo(0.5, 9)
    expect(advanceProgress(0, FLYOVER_BASE_DURATION_S / 4, 2)).toBeCloseTo(0.5, 9)
    expect(advanceProgress(0.9, FLYOVER_BASE_DURATION_S, 1)).toBe(1)
  })
})

describe('computeChaseView', () => {
  it('targets the draped marker and sits behind it (south for a northbound track), pitched up', () => {
    const view = computeChaseView(path, 0.5, frame, null, 1)
    // recorded elevation is used when the terrain is unknown
    const expected = frame.toLocal(6.85, 45.9, 1000 + LINE_LIFT_M)
    expect(view.target.distanceTo(expected)).toBeLessThan(0.01)

    const offset = view.position.clone().sub(view.target)
    expect(offset.z).toBeGreaterThan(0) // +Z = south
    expect(Math.abs(offset.x)).toBeLessThan(1)
    expect(offset.length()).toBeCloseTo(CHASE_DISTANCE_MIN_M, 3)
    expect(Math.asin(offset.y / offset.length())).toBeCloseTo(CHASE_PITCH_RAD, 6)
  })

  it('is deterministic for a given progress', () => {
    const a = computeChaseView(path, 0.3, frame, null, 1)
    const b = computeChaseView(path, 0.3, frame, null, 1)
    expect(a.position.equals(b.position)).toBe(true)
  })

  it('applies the exaggeration to the terrain height', () => {
    const view = computeChaseView(path, 0.5, frame, () => 2000, 2)
    expect(view.target.distanceTo(frame.toLocal(6.85, 45.9, 4000 + LINE_LIFT_M))).toBeLessThan(0.01)
  })

  it('keeps the camera above the terrain behind the marker', () => {
    // a wall south of the marker, much higher than the chase height
    const sample = (_lon: number, lat: number) => (lat < 45.899 ? 3000 : 1000)
    const view = computeChaseView(path, 0.5, frame, sample, 1)
    const below = frame.toLonLat(view.position)
    expect(below.height).toBeGreaterThanOrEqual(3000 + MIN_GROUND_CLEARANCE_M - 0.5)
  })

  it('raises the camera until the sight line clears a ridge between it and the marker', () => {
    // ~140 m wide ridge south of the marker, not under the camera
    const onRidge = (lat: number) => lat > 45.8965 && lat < 45.8978
    const sample = (_lon: number, lat: number) => (onRidge(lat) ? 2000 : 1000)
    const view = computeChaseView(path, 0.5, frame, sample, 1)
    expect(frame.toLonLat(view.position).lat).toBeLessThan(45.8965)
    for (let f = 0; f <= 1; f += 0.01) {
      const at = frame.toLonLat(view.position.clone().lerp(view.target, f))
      if (onRidge(at.lat)) expect(at.height).toBeGreaterThan(2000)
    }
  })
})

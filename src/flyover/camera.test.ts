import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import type { TrackPoint } from '../core/types'
import { createLocalFrame } from '../geo/ellipsoid'
import { buildTrack } from '../import/stats'
import {
  CHASE_DISTANCE_MIN_M,
  CINEMATIC_DISTANCE_FACTOR,
  CINEMATIC_PITCH_FACTOR,
  computeCameraView,
  MIN_GROUND_CLEARANCE_M,
  MIN_TERRAIN_CLEARANCE_M,
  movesWithTime,
  smoothedTurn,
  TOP_DISTANCE_FACTOR,
  TOP_MIN_PITCH_DEG,
  type CameraView,
  type CameraViewOptions,
} from './camera'
import { CAMERA_STYLES, DEFAULT_CAMERA, type CameraSettings, type CameraStyle } from './cameraSettings'
import { buildTrackPath, type TrackPath } from './path'

const LIFT = 3
const frame = createLocalFrame(6.85, 45.9)
const M_PER_DEG_LAT = 111_320
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((45.9 * Math.PI) / 180)

function pathOf(points: TrackPoint[]): TrackPath {
  return buildTrackPath(buildTrack({ name: 't', source: 'gpx', segments: [{ points }] }))
}

/** Points from east / north offsets in metres around (6.85, 45.9). */
function fromMetres(xy: [number, number][]): TrackPoint[] {
  return xy.map(([x, y]) => ({ lon: 6.85 + x / M_PER_DEG_LON, lat: 45.9 + y / M_PER_DEG_LAT, ele: 1000 }))
}

/** ~4.4 km straight north at 1000 m */
const northbound = pathOf([
  { lon: 6.85, lat: 45.88, ele: 1000 },
  { lon: 6.85, lat: 45.92, ele: 1000 },
])
/** ~3 km straight east at 1000 m */
const eastbound = pathOf(fromMetres([[-1500, 0], [1500, 0]]))

/** Circle arc of radius 800 m around the origin, three quarters, clockwise (right turns) or not; 10 m steps. */
function arc(clockwise: boolean): TrackPath {
  const xy: [number, number][] = []
  const n = Math.round((1.5 * Math.PI * 800) / 10)
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 1.5 * Math.PI
    xy.push([800 * Math.sin(a) * (clockwise ? 1 : -1), 800 * Math.cos(a)])
  }
  return pathOf(fromMetres(xy))
}

/** Square corners, a hairpin and a switchback series, every 10 m with ±2 m of deterministic GPS jitter. */
function twisty(): TrackPath {
  const corners: [number, number][] = [
    [0, 0], [1500, 0], [1500, 1000], [900, 1000], [900, 1200], [1500, 1200],
    [1500, 1300], [1300, 1400], [1500, 1500], [1300, 1600], [1500, 1700], [2500, 2500],
  ]
  const xy: [number, number][] = []
  let seed = 1
  const jitter = () => {
    seed = (seed * 16807) % 2147483647
    return (seed / 2147483647 - 0.5) * 4
  }
  for (let c = 0; c + 1 < corners.length; c++) {
    const [x0, y0] = corners[c]
    const [x1, y1] = corners[c + 1]
    const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 10))
    for (let i = 0; i < steps; i++) {
      xy.push([x0 + ((x1 - x0) * i) / steps + jitter(), y0 + ((y1 - y0) * i) / steps + jitter()])
    }
  }
  xy.push(corners[corners.length - 1])
  return pathOf(fromMetres(xy))
}

/** Smooth hills (~1.5 km wavelength, ±300 m, slopes up to ~50°) that make the clearance rules act. */
const hills = (lon: number, lat: number) => 1000 + 300 * Math.sin(lon * 330) * Math.cos(lat * 240)

function options(camera: Partial<CameraSettings> = {}, durationS = 60): CameraViewOptions {
  return { exaggeration: 1, liftM: LIFT, camera: { ...DEFAULT_CAMERA, ...camera }, durationS }
}

/** Horizontal angle (radians, clockwise from north) of the camera seen from the marker. */
function azimuthFromTarget(position: Vector3, target: Vector3): number {
  return Math.atan2(position.x - target.x, -(position.z - target.z))
}

function pitchDeg(position: Vector3, target: Vector3): number {
  const offset = position.clone().sub(target)
  return (Math.asin(offset.y / offset.length()) * 180) / Math.PI
}

describe('smoothedTurn', () => {
  // 1 km north then 1 km east: one right-angle right turn at 1000 m
  const corner = pathOf(fromMetres([[0, -1000], [0, 0], [1000, 0]]))
  const leftCorner = pathOf(fromMetres([[0, -1000], [0, 0], [-1000, 0]]))

  it('weights the turning angles with a tent: full at the vertex, half at half the window, none outside', () => {
    const at = corner.dist[1]
    expect(smoothedTurn(corner, at, 200)).toBeCloseTo(Math.PI / 2, 2)
    expect(smoothedTurn(corner, at - 100, 200)).toBeCloseTo(Math.PI / 4, 2)
    expect(smoothedTurn(corner, at - 300, 200)).toBe(0)
  })

  it('is positive for right turns and negative for left turns', () => {
    expect(smoothedTurn(leftCorner, leftCorner.dist[1], 200)).toBeCloseTo(-Math.PI / 2, 2)
  })

  it('cancels out a switchback series', () => {
    const zigzag = pathOf(fromMetres([[0, 0], [0, 100], [100, 200], [0, 300], [100, 400], [0, 500], [0, 600]]))
    const total = smoothedTurn(zigzag, 300, 1000)
    expect(Math.abs(total)).toBeLessThan(0.3)
  })
})

describe('computeCameraView — chase (default)', () => {
  it('targets the draped marker and sits behind it (south for a northbound track), pitched up', () => {
    const view = computeCameraView(northbound, 0.5, frame, null, options())
    // recorded elevation is used when the terrain is unknown
    const expected = frame.toLocal(6.85, 45.9, 1000 + LIFT)
    expect(view.target.distanceTo(expected)).toBeLessThan(0.01)

    const offset = view.position.clone().sub(view.target)
    expect(offset.z).toBeGreaterThan(0) // +Z = south
    expect(Math.abs(offset.x)).toBeLessThan(1)
    expect(offset.length()).toBeCloseTo(CHASE_DISTANCE_MIN_M, 3)
    expect(pitchDeg(view.position, view.target)).toBeCloseTo(30, 6)
  })

  it('is deterministic for a given progress', () => {
    const a = computeCameraView(northbound, 0.3, frame, null, options())
    const b = computeCameraView(northbound, 0.3, frame, null, options())
    expect(a.position.equals(b.position)).toBe(true)
  })

  it('applies the exaggeration to the terrain height', () => {
    const view = computeCameraView(northbound, 0.5, frame, () => 2000, { ...options(), exaggeration: 2 })
    expect(view.target.distanceTo(frame.toLocal(6.85, 45.9, 4000 + LIFT))).toBeLessThan(0.01)
  })

  it('scales the distance, sets the pitch and turns the viewing direction by the heading offset', () => {
    const view = computeCameraView(northbound, 0.5, frame, null, options({ distance: 2, pitchDeg: 45, headingOffsetDeg: 90 }))
    const offset = view.position.clone().sub(view.target)
    expect(offset.length()).toBeCloseTo(2 * CHASE_DISTANCE_MIN_M, 3)
    expect(pitchDeg(view.position, view.target)).toBeCloseTo(45, 6)
    // looking east (90° right of north): the camera is west of the marker
    expect(offset.x).toBeLessThan(-800)
    expect(Math.abs(offset.z)).toBeLessThan(1)
  })

  it('keeps the camera above the terrain behind the marker', () => {
    // a wall south of the marker, much higher than the chase height
    const sample = (_lon: number, lat: number) => (lat < 45.899 ? 3000 : 1000)
    const view = computeCameraView(northbound, 0.5, frame, sample, options())
    const below = frame.toLonLat(view.position)
    expect(below.height).toBeGreaterThanOrEqual(3000 + MIN_GROUND_CLEARANCE_M - 0.5)
  })

  it('raises the camera until the sight line clears a ridge between it and the marker', () => {
    // ~140 m wide ridge south of the marker, not under the camera
    const onRidge = (lat: number) => lat > 45.8965 && lat < 45.8978
    const sample = (_lon: number, lat: number) => (onRidge(lat) ? 2000 : 1000)
    const view = computeCameraView(northbound, 0.5, frame, sample, options())
    expect(frame.toLonLat(view.position).lat).toBeLessThan(45.8965)
    // the ground grid (37.5 m cells here) softens the cliffs over a cell: the line clears the ridge inside them
    const cell = 37.5 / M_PER_DEG_LAT
    for (let f = 0; f <= 1; f += 0.01) {
      const at = frame.toLonLat(view.position.clone().lerp(view.target, f))
      if (onRidge(at.lat - cell) && onRidge(at.lat + cell)) expect(at.height).toBeGreaterThan(2000)
    }
  })
})

describe('computeCameraView — styles', () => {
  it('sway equals chase on a straight track', () => {
    const chase = computeCameraView(northbound, 0.5, frame, null, options())
    const sway = computeCameraView(northbound, 0.5, frame, null, options({ style: 'sway' }))
    expect(sway.position.distanceTo(chase.position)).toBeLessThan(1e-6)
  })

  it.each([true, false])('sway swings the camera to the outside of the bend (clockwise %s)', (clockwise) => {
    const path = arc(clockwise)
    const center = frame.toLocal(6.85, 45.9, 0)
    const radial = (p: Vector3) => Math.hypot(p.x - center.x, p.z - center.z)
    const chase = computeCameraView(path, 0.5, frame, null, options())
    const sway = computeCameraView(path, 0.5, frame, null, options({ style: 'sway' }))
    expect(radial(sway.position)).toBeGreaterThan(radial(chase.position) + 80)
    expect(sway.position.distanceTo(sway.target)).toBeCloseTo(chase.position.distanceTo(chase.target), 3)
  })

  it('orbit turns around the marker at a constant angular speed, whatever the track direction', () => {
    const start = computeCameraView(northbound, 0, frame, null, options({ style: 'orbit' }))
    expect(azimuthFromTarget(start.position, start.target)).toBeCloseTo(Math.PI, 3) // behind = south
    // 6°/s over 60 s: a quarter of the flyover = 90° → looking east from the west
    const quarter = computeCameraView(northbound, 0.25, frame, null, options({ style: 'orbit' }))
    expect(azimuthFromTarget(quarter.position, quarter.target)).toBeCloseTo(-Math.PI / 2, 3)
    // twice the duration: twice the angle at the same progress
    const slow = computeCameraView(northbound, 0.25, frame, null, options({ style: 'orbit' }, 120))
    expect(azimuthFromTarget(slow.position, slow.target)).toBeCloseTo(0, 3)
  })

  it('top is high and nearly vertical, north-up or heading-up', () => {
    const north = computeCameraView(eastbound, 0.5, frame, null, options({ style: 'top', northUp: true }))
    const offset = north.position.clone().sub(north.target)
    expect(offset.length()).toBeCloseTo(CHASE_DISTANCE_MIN_M * TOP_DISTANCE_FACTOR, 3)
    expect(pitchDeg(north.position, north.target)).toBeCloseTo(TOP_MIN_PITCH_DEG, 6) // 30° asked, 70° minimum
    expect(azimuthFromTarget(north.position, north.target)).toBeCloseTo(Math.PI, 3) // south of the marker: north up

    const headingUp = computeCameraView(eastbound, 0.5, frame, null, options({ style: 'top', pitchDeg: 85 }))
    expect(pitchDeg(headingUp.position, headingUp.target)).toBeCloseTo(85, 6)
    expect(azimuthFromTarget(headingUp.position, headingUp.target)).toBeCloseTo(-Math.PI / 2, 3) // west: heading up
  })

  it('cinematic is farther and lower, with a slow lateral swing', () => {
    const start = computeCameraView(northbound, 0, frame, null, options({ style: 'cinematic' }))
    const offset = start.position.clone().sub(start.target)
    expect(offset.length()).toBeCloseTo(CHASE_DISTANCE_MIN_M * CINEMATIC_DISTANCE_FACTOR, 3)
    expect(pitchDeg(start.position, start.target)).toBeCloseTo(30 * CINEMATIC_PITCH_FACTOR, 6)
    expect(azimuthFromTarget(start.position, start.target)).toBeCloseTo(Math.PI, 3)
    // a quarter period (10 s of 60) later: swung by the full amplitude
    const later = computeCameraView(northbound, 10 / 60, frame, null, options({ style: 'cinematic' }))
    expect(Math.abs(Math.abs(azimuthFromTarget(later.position, later.target)) - Math.PI)).toBeCloseTo((35 * Math.PI) / 180, 3)
  })

  it('orbit and cinematic follow the film time when given: they keep moving while the progress is held', () => {
    for (const style of CAMERA_STYLES) {
      const at = (timeS?: number) => computeCameraView(northbound, 0.25, frame, null, { ...options({ style }), timeS })
      // default film time = progress × duration
      expect(at(15).position.distanceTo(at().position)).toBeCloseTo(0, 6)
      const moved = at(20).position.distanceTo(at(15).position)
      expect(moved > 1).toBe(movesWithTime(style))
    }
    // 5 s more of film at 6°/s: 30° further around the marker
    const held = computeCameraView(northbound, 0.25, frame, null, { ...options({ style: 'orbit' }), timeS: 20 })
    expect(azimuthFromTarget(held.position, held.target)).toBeCloseTo(-Math.PI / 3, 3)
  })

  it('turn smoothing in metres: the automatic window given in metres is the same view', () => {
    const path = twisty()
    const auto = 2 * Math.min(1500, Math.max(150, path.lengthM * 0.02)) * 1.5
    for (const progress of [0.2, 0.5, 0.8]) {
      const a = computeCameraView(path, progress, frame, hills, options({ style: 'sway', smoothing: 1.5 }))
      const b = computeCameraView(path, progress, frame, hills, options({ style: 'sway', smoothing: 1, turnSmoothingM: auto }))
      expect(a.position.distanceTo(b.position)).toBeLessThan(1e-6)
    }
  })

  it('time smoothing: the aim and the camera on their own progress, the marker on its own', () => {
    const at = (aimProgress?: number, cameraProgress?: number) =>
      computeCameraView(northbound, 0.5, frame, null, { ...options(), aimProgress, cameraProgress })
    const plain = at()
    expect(at(0.5, 0.5).position.distanceTo(plain.position)).toBeLessThan(1e-6)
    const behind = at(0.48, 0.45)
    expect(behind.marker.distanceTo(plain.marker)).toBe(0)
    // northbound: the aim 2% of the track (88 m) and the camera 5% (220 m) further south
    expect(plain.target.z - behind.target.z).toBeCloseTo(-0.02 * northbound.lengthM, 0)
    expect(plain.position.z - behind.position.z).toBeCloseTo(-0.05 * northbound.lengthM, 0)
  })
})

describe('computeCameraView — continuity and clearance (every style)', () => {
  const path = twisty()
  const STEPS = 4000
  const viewsAt = (style: CameraStyle, steps: number) =>
    Array.from({ length: steps + 1 }, (_, i) => computeCameraView(path, i / steps, frame, hills, options({ style })))
  const maxStep = (views: CameraView[]) => {
    let max = 0
    for (let i = 1; i < views.length; i++) max = Math.max(max, views[i].position.distanceTo(views[i - 1].position))
    return max
  }

  it.each(CAMERA_STYLES)('%s never jumps between close progress values', (style) => {
    // ~6.3 km track, the marker moves ~1.6 m per step; a camera jump would be hundreds of metres
    const fine = viewsAt(style, STEPS)
    expect(maxStep(fine)).toBeLessThan(30)
    // continuous: halving the progress step halves the largest movement (a jump would keep its size)
    expect(maxStep(fine)).toBeLessThan(0.6 * maxStep(viewsAt(style, STEPS / 2)))
  })

  it.each(CAMERA_STYLES)('%s keeps the ground clearance under the camera', (style) => {
    for (const view of viewsAt(style, 80)) {
      const at = frame.toLonLat(view.position)
      // above the ground grid, which follows these smooth hills within a metre
      expect(at.height).toBeGreaterThanOrEqual(hills(at.lon, at.lat) + MIN_GROUND_CLEARANCE_M - 1)
    }
  })
})

describe('computeCameraView — rough terrain (every style)', () => {
  // ±15 m bumps about 30 m wide, on flat ground or on the hills
  const BUMP = 15
  const bumps = (lon: number, lat: number) =>
    BUMP * Math.sin(((lon - 6.85) * M_PER_DEG_LON) / 4.3 + 0.7) * Math.sin(((lat - 45.9) * M_PER_DEG_LAT) / 5.7 + 0.3)
  const flatBumpy = (lon: number, lat: number) => 1000 + bumps(lon, lat)
  const hillsBumpy = (lon: number, lat: number) => hills(lon, lat) + bumps(lon, lat)
  // 60 s at 30 fps over 80% of the 4.4 km track: the marker moves ~2 m per frame
  const FRAMES = 1800
  const heights = (sample: (lon: number, lat: number) => number, style: CameraStyle) =>
    Array.from({ length: FRAMES + 1 }, (_, i) => {
      const view = computeCameraView(northbound, 0.1 + (0.8 * i) / FRAMES, frame, sample, options({ style }))
      const at = frame.toLonLat(view.position)
      // never below the actual terrain, whatever the smoothing
      expect(at.height).toBeGreaterThanOrEqual(sample(at.lon, at.lat) + MIN_TERRAIN_CLEARANCE_M - 0.01)
      return view.position.y
    })

  it.each(CAMERA_STYLES)('%s does not ride the bumps', (style) => {
    // flat ground: the camera height barely moves from frame to frame (the point samples gave 3–35 m)
    const flat = heights(flatBumpy, style)
    for (let i = 1; i <= FRAMES; i++) expect(Math.abs(flat[i] - flat[i - 1])).toBeLessThan(BUMP / 20)
    // hills: the vertical speed changes gently from frame to frame (the point samples gave 1–70 m)
    const hilly = heights(hillsBumpy, style)
    for (let i = 1; i < FRAMES; i++) expect(Math.abs(hilly[i + 1] - 2 * hilly[i] + hilly[i - 1])).toBeLessThan(BUMP / 4)
  })

  it('keeps the marker on the draped track and is deterministic', () => {
    const at = (p: number) => computeCameraView(northbound, p, frame, hillsBumpy, options({ style: 'cinematic' }))
    const view = at(0.4)
    const below = frame.toLonLat(view.marker)
    expect(below.height).toBeCloseTo(hillsBumpy(below.lon, below.lat) + LIFT, 3)
    // no state from one call to the next: the same inputs give the same view after other frames
    at(0.7)
    const again = at(0.4)
    expect(again.position.equals(view.position)).toBe(true)
    expect(again.target.equals(view.target)).toBe(true)
  })
})

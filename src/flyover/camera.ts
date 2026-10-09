/**
 * Flyover camera: the view (camera position, look-at target = marker) as a pure function of the progress, the
 * film time, the camera settings and the terrain sampler. No smoothing state from frame to frame, so a given
 * progress and film time always give the same image: the video export can render any frame on its own.
 *
 * Every style places the camera on a sphere around the aim point (above the marker, at the smoothed ground
 * height), then raises it to keep MIN_GROUND_CLEARANCE_M above the smoothed ground and the sight line to the aim
 * above the relief. The heights are read from terrain samples that stay put while the marker moves (fixed track
 * distances, a fixed grid), so the camera follows the relief without riding each bump. Each term is continuous in
 * the progress and the film time, so the camera never jumps. The time-based motions (orbit, cinematic swing)
 * follow the film time, so they keep moving while the pacing holds the progress.
 */
import { Vector3 } from 'three'
import { clamp, lastIndexAtOrBelow } from '../core/math'
import type { LocalFrame } from '../core/types'
import type { HeightSampler } from '../scene/TrackLines'
import { DEFAULT_CAMERA, DEFAULT_FLYOVER_DURATION_S, turnSmoothingM, type CameraSettings, type CameraStyle } from './cameraSettings'
import { samplePath, type TrackPath } from './path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Automatic camera distance = this fraction of the track, clamped; times the `distance` setting. */
export const CHASE_DISTANCE_FRACTION = 0.04
export const CHASE_DISTANCE_MIN_M = 600
export const CHASE_DISTANCE_MAX_M = 4_000
/** Pitch limits whatever the settings: under 2° the sight line grazes the relief, at 90° lookAt is undefined. */
export const PITCH_MIN_DEG = 2
export const PITCH_MAX_DEG = 88
/** The camera never goes closer than this to the smoothed (exaggerated) ground below it (metres). */
export const MIN_GROUND_CLEARANCE_M = 80
/** Whatever the smoothing, the camera never goes closer than this to the actual (exaggerated) terrain below it. */
export const MIN_TERRAIN_CLEARANCE_M = 40
/** The clearance floor takes over from the free height over this band (smooth maximum, at most a quarter above). */
export const CLEARANCE_EASE_M = 80
/**
 * Ground smoothing radius = this fraction of the heading window, at most GROUND_WINDOW_MAX_M:
 * the aim height is the tent-weighted mean of the terrain along the track over ± this radius, and the clearance
 * rules read the terrain on a grid of this cell size. Scaled like the heading window, so with the track length and
 * the marker's step per frame: a frame slides the weights by the same small share (37.5 m for a track under
 * 7.5 km at smoothing 1). Capped so a valley or a ridge narrower than a cell does not shift the ground much; the
 * tracks that reach the cap (over 30 km) are seen from 1.2 km or more, where a few metres of bobbing no longer show.
 */
export const GROUND_WINDOW_FRACTION = 0.25
export const GROUND_WINDOW_MAX_M = 150
/** Aim height: terrain samples on each side of the marker, at multiples of radius / this along the track. */
export const GROUND_SAMPLES_PER_SIDE = 4
/**
 * Terrain samples along the sight line camera → aim (fractions 0 .. LINE_OF_SIGHT_MAX_FRACTION); the
 * clearance tapers from MIN_GROUND_CLEARANCE_M under the camera to 0 at the aim.
 */
export const LINE_OF_SIGHT_SAMPLES = 12
export const LINE_OF_SIGHT_MAX_FRACTION = 0.9

/** 'sway': swing (radians) = SWAY_MAX_RAD · tanh(SWAY_GAIN · turn / SWAY_MAX_RAD), turn measured over ±2w. */
export const SWAY_GAIN = 0.8
export const SWAY_MAX_RAD = (50 * Math.PI) / 180
/** 'orbit': angular speed around the marker, in degrees per second of flyover at speed x1. */
export const ORBIT_DEG_PER_S = 6
/** 'top': farther and nearly vertical. */
export const TOP_DISTANCE_FACTOR = 2.5
export const TOP_MIN_PITCH_DEG = 70
/** 'cinematic': farther, half the pitch, calmer heading, slow lateral swing of the viewing direction. */
export const CINEMATIC_DISTANCE_FACTOR = 1.6
export const CINEMATIC_PITCH_FACTOR = 0.5
export const CINEMATIC_WINDOW_FACTOR = 2
export const CINEMATIC_SWING_RAD = (35 * Math.PI) / 180
export const CINEMATIC_PERIOD_S = 40

const DEG = Math.PI / 180
const NORTH = new Vector3(0, 0, -1)
/** Scratch vectors of the per-frame helpers (never returned). */
const _behind = new Vector3()
const _ahead = new Vector3()
const _sight = new Vector3()
const _corner = new Vector3()

// ---------------------------------------------------------------------------
// Path measures
// ---------------------------------------------------------------------------

/** Heading window (half chord length) for `path` with the « Lissage des virages » of `camera`. */
export function headingWindowM(path: TrackPath, camera: CameraSettings): number {
  return turnSmoothingM(camera, path.lengthM) / 2
}

/** Automatic camera distance for `path`, before the distance multiplier. */
export function autoDistanceM(path: TrackPath): number {
  return clamp(path.lengthM * CHASE_DISTANCE_FRACTION, CHASE_DISTANCE_MIN_M, CHASE_DISTANCE_MAX_M)
}

/**
 * Horizontal unit direction of travel at `d`: the chord [d - w, d + w], wide enough to ignore GPS jitter and
 * switchbacks. North when the chord is shorter than 1 m (no motion).
 */
export function headingAt(path: TrackPath, d: number, w: number, frame: LocalFrame): Vector3 {
  const behind = samplePath(path, d - w)
  const ahead = samplePath(path, d + w)
  const a = frame.toLocal(behind.lon, behind.lat, 0, _behind)
  const b = frame.toLocal(ahead.lon, ahead.lat, 0, _ahead)
  const heading = new Vector3(b.x - a.x, 0, b.z - a.z)
  if (heading.lengthSq() < 1) return NORTH.clone()
  return heading.normalize()
}

/**
 * Signed turn of the path around `d` (radians, > 0 = to the right, clockwise seen from above): the turning
 * angles of the vertices within ]d - window, d + window[ weighted by the tent max(0, 1 - |s - d| / window).
 * A vertex enters and leaves the window with a zero weight, so the result is continuous in `d`; GPS jitter and
 * switchback series (left, right, left…) cancel out. Zero-length steps (duplicates, segment joins) are skipped.
 */
export function smoothedTurn(path: TrackPath, d: number, window: number): number {
  const { count, lon, lat, dist } = path
  if (count < 3 || window <= 0) return 0
  const cosLat = Math.cos(lat[0] * DEG)

  // start one non-empty step before the window, for the direction coming into its first vertex
  let k = Math.max(0, lastIndexAtOrBelow(dist, d - window))
  while (k > 0 && dist[k] - dist[k - 1] <= 0) k--
  k = Math.max(0, k - 1)

  let total = 0
  let hasPrev = false
  let px = 0
  let py = 0
  for (; k < count - 1 && dist[k] < d + window; k++) {
    if (dist[k + 1] - dist[k] <= 0) continue
    // east / north components, planar approximation (only angles are used)
    const x = (lon[k + 1] - lon[k]) * cosLat
    const y = lat[k + 1] - lat[k]
    if (hasPrev) {
      const weight = 1 - Math.abs(dist[k] - d) / window
      // cross < 0 for a clockwise (right) turn in east / north axes
      if (weight > 0) total += weight * -Math.atan2(px * y - py * x, px * x + py * y)
    }
    px = x
    py = y
    hasPrev = true
  }
  return total
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export interface CameraView {
  /** look-at point, local frame (flight: above the marker, at the smoothed ground height) */
  target: Vector3
  position: Vector3
}

export interface FlightView extends CameraView {
  /** marker position on the draped track, local frame */
  marker: Vector3
}

export interface CameraViewOptions {
  exaggeration: number
  /** height of the marker above the ground (the track line lift) */
  liftM: number
  camera?: CameraSettings
  /** flyover duration at speed x1 (seconds): film time = progress × durationS when `timeS` is absent */
  durationS?: number
  /** film time (seconds at x1, pacing included) of the time-based motions (orbit, cinematic swing) */
  timeS?: number
  /** extra rotation of the viewing direction around the marker (radians, > 0 = right): orbit of a film stop */
  orbitRad?: number
  /** progress of the aim point (time smoothing, `timeSmoothing.ts`); the marker's when absent */
  aimProgress?: number
  /** progress the camera is placed from (place along the track, heading); the marker's when absent */
  cameraProgress?: number
}

/** Styles whose view also moves with the film time (they keep moving during a pause of the pacing). */
export function movesWithTime(style: CameraStyle): boolean {
  return style === 'orbit' || style === 'cinematic'
}

/** Horizontal reference direction, viewing angle relative to it (radians, > 0 = right), pitch and distance. */
interface Placement {
  reference: Vector3
  viewAngle: number
  pitchDeg: number
  distance: number
}

function placement(
  path: TrackPath,
  d: number,
  timeS: number,
  frame: LocalFrame,
  camera: CameraSettings,
): Placement {
  const w = headingWindowM(path, camera)
  const distance = autoDistanceM(path) * camera.distance
  const offset = camera.headingOffsetDeg * DEG

  switch (camera.style) {
    case 'sway': {
      const turn = smoothedTurn(path, d, 2 * w)
      // to the outside of the bend: a right turn swings the view to the right (camera on the left)
      const swing = SWAY_MAX_RAD * Math.tanh((SWAY_GAIN * turn) / SWAY_MAX_RAD)
      return { reference: headingAt(path, d, w, frame), viewAngle: offset + swing, pitchDeg: camera.pitchDeg, distance }
    }
    case 'orbit':
      // absolute rotation from the start heading: independent of the bends of the track
      return {
        reference: headingAt(path, 0, w, frame),
        viewAngle: offset + timeS * ORBIT_DEG_PER_S * DEG,
        pitchDeg: camera.pitchDeg,
        distance,
      }
    case 'top':
      return {
        reference: camera.northUp ? NORTH.clone() : headingAt(path, d, w, frame),
        viewAngle: offset,
        pitchDeg: Math.max(camera.pitchDeg, TOP_MIN_PITCH_DEG),
        distance: distance * TOP_DISTANCE_FACTOR,
      }
    case 'cinematic':
      return {
        reference: headingAt(path, d, w * CINEMATIC_WINDOW_FACTOR, frame),
        viewAngle: offset + CINEMATIC_SWING_RAD * Math.sin((2 * Math.PI * timeS) / CINEMATIC_PERIOD_S),
        pitchDeg: camera.pitchDeg * CINEMATIC_PITCH_FACTOR,
        distance: distance * CINEMATIC_DISTANCE_FACTOR,
      }
    case 'chase':
    default:
      return { reference: headingAt(path, d, w, frame), viewAngle: offset, pitchDeg: camera.pitchDeg, distance }
  }
}

/**
 * Camera view at `progress` along `path` and film time `options.timeS`. The camera looks at the aim point along
 * the reference direction rotated by the view angle, from `distance` away at `pitch` above the horizon; it is then
 * raised (pitch steepens) to stay MIN_GROUND_CLEARANCE_M above the smoothed terrain (MIN_TERRAIN_CLEARANCE_M above
 * the actual terrain) and until the sight line to the aim clears the terrain between.
 * Aim = marker x / z at the smoothed ground height (`trackGround`, at least the grid ground the clearance reads,
 * so the sight line ends above it) + `liftM`. Heights: terrain sample, else recorded elevation, else 0; times
 * `exaggeration`. Time smoothing (`aimProgress`, `cameraProgress`, see `timeSmoothing.ts`): the aim point and the
 * camera follow their own progress; the camera then stands around its own point of the track, at the aim's height.
 */
export function computeCameraView(
  path: TrackPath,
  progress: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  options: CameraViewOptions,
): FlightView {
  const { exaggeration, liftM, camera = DEFAULT_CAMERA, durationS = DEFAULT_FLYOVER_DURATION_S } = options
  const p = clamp(progress, 0, 1)
  const timeS = options.timeS ?? p * durationS
  const d = p * path.lengthM

  const groundAt = (at: { lon: number; lat: number; ele?: number }) => (sample?.(at.lon, at.lat) ?? at.ele ?? 0) * exaggeration
  const at = samplePath(path, d)
  const marker = frame.toLocal(at.lon, at.lat, groundAt(at) + liftM)
  // time smoothing: the aim and the camera may follow their own progress along the track
  const dAim = options.aimProgress === undefined ? d : clamp(options.aimProgress, 0, 1) * path.lengthM
  const dCamera = options.cameraProgress === undefined ? d : clamp(options.cameraProgress, 0, 1) * path.lengthM
  const aimAt = dAim === d ? at : samplePath(path, dAim)
  const aim = dAim === d ? marker : frame.toLocal(aimAt.lon, aimAt.lat, groundAt(aimAt) + liftM)
  const cellM = Math.min(headingWindowM(path, camera) * GROUND_WINDOW_FRACTION, GROUND_WINDOW_MAX_M)
  const gridAtAim = sample ? gridGround(aim.x, aim.z, cellM, frame, sample) : undefined
  const aimGround = Math.max(trackGround(path, dAim, cellM, sample), gridAtAim ?? -Infinity) * exaggeration
  const target = frame.toLocal(aimAt.lon, aimAt.lat, aimGround + liftM)

  const place = placement(path, dCamera, timeS, frame, camera)
  place.viewAngle += options.orbitRad ?? 0
  // placed around its own point of the track, at the aim's height
  const from = dCamera === dAim ? target : anchorAt(path, dCamera, aimGround + liftM, frame)
  const position = positionAround(from, place)
  if (sample) position.y = lowestClearY(position, target, frame, sample, exaggeration, cellM)
  return { target, position, marker }
}

/**
 * Ground height (metres, not exaggerated) under the track around `d`: the tent-weighted mean over
 * ]d - radiusM, d + radiusM[ of the terrain at fixed track distances (multiples of radiusM / GROUND_SAMPLES_PER_SIDE).
 * The samples stay put while the marker moves, only their weights slide: the mean follows the relief, not the
 * bumps under the marker, and a finer tile arriving shifts it by a fraction. Terrain, else recorded elevation, else 0.
 */
function trackGround(path: TrackPath, d: number, radiusM: number, sample: HeightSampler | null): number {
  const step = radiusM / GROUND_SAMPLES_PER_SIDE
  let sum = 0
  let weight = 0
  for (let k = Math.floor((d - radiusM) / step) + 1; k * step < d + radiusM; k++) {
    const w = 1 - Math.abs(k * step - d) / radiusM
    const at = samplePath(path, k * step)
    sum += w * (sample?.(at.lon, at.lat) ?? at.ele ?? 0)
    weight += w
  }
  return sum / weight
}

/**
 * Ground height (metres, not exaggerated) at local (x, z), bilinear between the terrain at the corners of its cell
 * in a fixed `cellM` grid of the local frame: the corners stay put while the camera moves, so the height follows
 * the relief with a bounded slope, never each bump. Exact on a plane; a bump narrower than the cell can rise above
 * it (hence MIN_TERRAIN_CLEARANCE_M), a cliff is softened over a cell. Undefined without terrain there.
 */
function gridGround(x: number, z: number, cellM: number, frame: LocalFrame, sample: HeightSampler): number | undefined {
  const i = Math.floor(x / cellM)
  const j = Math.floor(z / cellM)
  const tx = x / cellM - i
  const tz = z / cellM - j
  let sum = 0
  let weight = 0
  for (let ci = 0; ci <= 1; ci++) {
    for (let cj = 0; cj <= 1; cj++) {
      const w = (ci ? tx : 1 - tx) * (cj ? tz : 1 - tz)
      if (w <= 0) continue
      const at = frame.toLonLat(_corner.set((i + ci) * cellM, 0, (j + cj) * cellM))
      const h = sample(at.lon, at.lat)
      if (h === undefined) continue
      sum += w * h
      weight += w
    }
  }
  return weight > 0 ? sum / weight : undefined
}

/** Point of the track at `d` (local frame), `heightM` above the ellipsoid. */
function anchorAt(path: TrackPath, d: number, heightM: number, frame: LocalFrame): Vector3 {
  const at = samplePath(path, d)
  return frame.toLocal(at.lon, at.lat, heightM)
}

/** max(a, b) eased over a band of `k`: never below the larger, at most k / 4 above it, with no kink. */
function smoothMax(a: number, b: number, k: number): number {
  const h = Math.max(0, k - Math.abs(a - b)) / k
  return Math.max(a, b) + (h * h * k) / 4
}

/** Camera on the sphere around `target` given by the placement (pitch clamped to PITCH_MIN_DEG..PITCH_MAX_DEG). */
function positionAround(target: Vector3, { reference, viewAngle, pitchDeg, distance }: Placement): Vector3 {
  const pitch = clamp(pitchDeg, PITCH_MIN_DEG, PITCH_MAX_DEG) * DEG
  // viewing direction = reference turned clockwise (seen from above) by viewAngle; right = (-z, 0, x)
  const cos = Math.cos(viewAngle)
  const sin = Math.sin(viewAngle)
  const look = new Vector3(reference.x * cos - reference.z * sin, 0, reference.z * cos + reference.x * sin)
  return target
    .clone()
    .addScaledVector(look, -distance * Math.cos(pitch))
    .setY(target.y + distance * Math.sin(pitch))
}

/**
 * Lowest camera height (local y, at least `position.y`) that keeps the sight line to `target` above the
 * (exaggerated) grid ground (`gridGround`): the line at fraction f (0 = camera) has height y + (target.y - y) · f
 * and must clear the ground there by MIN_GROUND_CLEARANCE_M · (1 - f). The floor is eased in (`smoothMax`), then
 * the camera is kept MIN_TERRAIN_CLEARANCE_M above the actual terrain below it.
 */
function lowestClearY(
  position: Vector3,
  target: Vector3,
  frame: LocalFrame,
  sample: HeightSampler,
  exaggeration: number,
  cellM: number,
): number {
  let floor = -Infinity
  for (let i = 0; i <= LINE_OF_SIGHT_SAMPLES; i++) {
    const f = (i / LINE_OF_SIGHT_SAMPLES) * LINE_OF_SIGHT_MAX_FRACTION
    _sight.lerpVectors(position, target, f).setY(target.y)
    const ground = gridGround(_sight.x, _sight.z, cellM, frame, sample)
    if (ground === undefined) continue
    const at = frame.toLonLat(_sight)
    const clearance = MIN_GROUND_CLEARANCE_M * (1 - f)
    const floorY = frame.toLocal(at.lon, at.lat, ground * exaggeration + clearance, _sight).y
    floor = Math.max(floor, (floorY - target.y * f) / (1 - f))
  }
  let y = smoothMax(position.y, floor, CLEARANCE_EASE_M)
  // a bump narrower than the grid cell
  const below = frame.toLonLat(_sight.set(position.x, y, position.z))
  const ground = sample(below.lon, below.lat)
  if (ground !== undefined) {
    y = Math.max(y, frame.toLocal(below.lon, below.lat, ground * exaggeration + MIN_TERRAIN_CLEARANCE_M, _sight).y)
  }
  return y
}

/**
 * Flyover camera: the view (camera position, look-at target = marker) as a pure function of the progress, the
 * film time, the camera settings and the terrain sampler. No smoothing state from frame to frame, so a given
 * progress and film time always give the same image: the video export can render any frame on its own.
 *
 * Every style places the camera on a sphere around the marker (horizontal direction, pitch, distance), then
 * raises it to keep MIN_GROUND_CLEARANCE_M above the ground and the sight line to the marker above the relief.
 * Each term is continuous in the progress and the film time, so the camera never jumps. The time-based motions
 * (orbit, cinematic swing) follow the film time, so they keep moving while the pacing holds the progress.
 */
import { Vector3 } from 'three'
import { clamp, lastIndexAtOrBelow } from '../core/math'
import type { LocalFrame } from '../core/types'
import type { HeightSampler } from '../scene/TrackLines'
import { DEFAULT_CAMERA, DEFAULT_FLYOVER_DURATION_S, type CameraSettings, type CameraStyle } from './cameraSettings'
import { samplePath, type TrackPath } from './path'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Heading = direction of the chord [d - w, d + w]; w = this fraction of the track, clamped, times `smoothing`. */
export const HEADING_WINDOW_FRACTION = 0.02
export const HEADING_WINDOW_MIN_M = 150
export const HEADING_WINDOW_MAX_M = 1_500
/** Automatic camera distance = this fraction of the track, clamped; times the `distance` setting. */
export const CHASE_DISTANCE_FRACTION = 0.04
export const CHASE_DISTANCE_MIN_M = 600
export const CHASE_DISTANCE_MAX_M = 4_000
/** Pitch limits whatever the settings: under 2° the sight line grazes the relief, at 90° lookAt is undefined. */
export const PITCH_MIN_DEG = 2
export const PITCH_MAX_DEG = 88
/** The camera never goes closer than this to the (exaggerated) ground below it (metres). */
export const MIN_GROUND_CLEARANCE_M = 80
/**
 * Terrain samples along the sight line camera → marker (fractions 0 .. LINE_OF_SIGHT_MAX_FRACTION); the
 * clearance tapers from MIN_GROUND_CLEARANCE_M under the camera to 0 at the marker.
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

// ---------------------------------------------------------------------------
// Path measures
// ---------------------------------------------------------------------------

/** Heading window (half chord length) for `path`, before the smoothing multiplier. */
export function headingWindowM(path: TrackPath): number {
  return clamp(path.lengthM * HEADING_WINDOW_FRACTION, HEADING_WINDOW_MIN_M, HEADING_WINDOW_MAX_M)
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
  /** marker position on the draped track, local frame */
  target: Vector3
  position: Vector3
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
  const w = headingWindowM(path) * camera.smoothing
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
 * Camera view at `progress` along `path` and film time `options.timeS`. The camera looks along the reference
 * direction rotated by the view angle, from `distance` away at `pitch` above the horizon; it is then raised
 * (pitch steepens) to stay MIN_GROUND_CLEARANCE_M above the terrain and until the sight line to the marker clears
 * the terrain between.
 * Heights: terrain sample, else recorded elevation, else 0; times `exaggeration`.
 */
export function computeCameraView(
  path: TrackPath,
  progress: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  options: CameraViewOptions,
): CameraView {
  const { exaggeration, liftM, camera = DEFAULT_CAMERA, durationS = DEFAULT_FLYOVER_DURATION_S } = options
  const p = clamp(progress, 0, 1)
  const timeS = options.timeS ?? p * durationS
  const d = p * path.lengthM

  const at = samplePath(path, d)
  const ground = (sample?.(at.lon, at.lat) ?? at.ele ?? 0) * exaggeration
  const target = frame.toLocal(at.lon, at.lat, ground + liftM)

  const place = placement(path, d, timeS, frame, camera)
  place.viewAngle += options.orbitRad ?? 0
  const position = positionAround(target, place)
  if (sample) position.y = lowestClearY(position, target, frame, sample, exaggeration)
  return { target, position }
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
 * (exaggerated) terrain: the line at fraction f (0 = camera) has height y + (target.y - y) · f and must clear the
 * ground there by MIN_GROUND_CLEARANCE_M · (1 - f).
 */
function lowestClearY(position: Vector3, target: Vector3, frame: LocalFrame, sample: HeightSampler, exaggeration: number): number {
  let minY = position.y
  for (let i = 0; i <= LINE_OF_SIGHT_SAMPLES; i++) {
    const f = (i / LINE_OF_SIGHT_SAMPLES) * LINE_OF_SIGHT_MAX_FRACTION
    _sight.lerpVectors(position, target, f).setY(target.y)
    const at = frame.toLonLat(_sight)
    const ground = sample(at.lon, at.lat)
    if (ground === undefined) continue
    const clearance = MIN_GROUND_CLEARANCE_M * (1 - f)
    const floorY = frame.toLocal(at.lon, at.lat, ground * exaggeration + clearance, _sight).y
    minY = Math.max(minY, (floorY - target.y * f) / (1 - f))
  }
  return minY
}

/**
 * Camera of the film: the flight camera (`computeCameraView`) during the flight, with the framing of the camera
 * keys (`keyedCamera`), an overview of the whole track for the opening and closing shots, the camera of each stop
 * ('orbite', 'large', 'fixe'). A pure function of the film time, the progress, the settings and the terrain sampler,
 * like the flight camera: the export renders any frame alone.
 *
 * Overview: target = centre of the track's box in the local frame (ground height there), distance =
 * OVERVIEW_DISTANCE_FACTOR × box diagonal (more for a frame taller than wide, so 9:16 keeps the whole track),
 * OVERVIEW_PITCH_DEG above the horizon, on the side the flight camera looks from where the shot joins the flight
 * (no turn during the transition). Transition between the overview and the flight view: target lerped,
 * direction nlerped, distance interpolated geometrically, eased by smootherstep, kept MIN_GROUND_CLEARANCE_M
 * above the ground. 'descente' eases over the whole shot; 'saut' holds the overview and moves in JUMP_S.
 */
import { Vector3 } from 'three'
import { clamp, smootherstep } from '../core/math'
import type { LocalFrame } from '../core/types'
import type { ClockStop, FilmClock, FilmState } from '../film/clock'
import type { ShotStyle } from '../film/model'
import type { HeightSampler } from '../scene/TrackLines'
import { MIN_GROUND_CLEARANCE_M, computeCameraView, movesWithTime, type CameraView, type CameraViewOptions } from './camera'
import { DEFAULT_CAMERA, DEFAULT_FLYOVER_DURATION_S, type CameraSettings, type CameraStyle } from './cameraSettings'
import type { TrackPath } from './path'
import { cameraKeyEaseM, keyedCamera } from './cameraKeys'

export { smootherstep }
export { CAMERA_KEY_EASE_S, cameraKeyEaseM, keyedCamera } from './cameraKeys'

/** Overview distance = this × diagonal of the track's box (landscape frames), at least OVERVIEW_MIN_DISTANCE_M. */
export const OVERVIEW_DISTANCE_FACTOR = 1.6
export const OVERVIEW_MIN_DISTANCE_M = 2_000
export const OVERVIEW_PITCH_DEG = 40
/** Length of the quick move of a 'saut' shot (seconds). */
export const JUMP_S = 0.6
/** 'orbite' stop: the camera turns out by STOP_ORBIT_DEG_PER_S × stop duration (at most STOP_ORBIT_MAX_DEG) and back. */
export const STOP_ORBIT_DEG_PER_S = 6
export const STOP_ORBIT_MAX_DEG = 120
/** 'large' stop: at the middle of its window, the camera is this much farther and this much higher (degrees of pitch). */
export const STOP_WIDE_DISTANCE_FACTOR = 2.5
export const STOP_WIDE_PITCH_DEG = 20
const DEG = Math.PI / 180
const UP = new Vector3(0, 1, 0)

/** Fraction (0 = first view, 1 = second) of a shot `localS` seconds into it: opening overview → flight, closing flight → overview. */
export function shotBlend(style: ShotStyle, phase: 'opening' | 'closing', localS: number, lengthS: number): number {
  if (!(lengthS > 0)) return 1
  if (style !== 'saut') return smootherstep(localS / lengthS)
  const jump = Math.min(JUMP_S, lengthS)
  return smootherstep((phase === 'opening' ? localS - (lengthS - jump) : localS) / jump)
}

/** 0 → 1 → 0 over a stop window `lengthS` long, `localS` seconds into it (raised cosine: still at both ends). */
export function stopBump(localS: number, lengthS: number): number {
  if (!(lengthS > 0)) return 0
  return (1 - Math.cos(2 * Math.PI * clamp(localS / lengthS, 0, 1))) / 2
}

/** Orbit angle (radians) `localS` seconds into a stop window `lengthS` long: out and back, still at both ends. */
export function stopOrbitRad(addedS: number, localS: number, lengthS: number): number {
  return Math.min(STOP_ORBIT_MAX_DEG, STOP_ORBIT_DEG_PER_S * addedS) * DEG * stopBump(localS, lengthS)
}

/** Camera of a 'large' stop: farther and higher by `k` (0 = the flight camera, 1 = the widest). */
export function widenedCamera(camera: CameraSettings, k: number): CameraSettings {
  return {
    ...camera,
    distance: camera.distance * (1 + (STOP_WIDE_DISTANCE_FACTOR - 1) * k),
    pitchDeg: camera.pitchDeg + STOP_WIDE_PITCH_DEG * k,
  }
}

/** 0 → 1 by smootherstep over `lengthS` (a step when it is 0). */
const ramp = (s: number, lengthS: number) => (lengthS > 0 ? smootherstep(s / lengthS) : s >= 0 ? 1 : 0)

/**
 * Film time driving the time-based motions (orbit and cinema styles) at `timeS` during a 'fixe' stop: eased to the
 * middle of the window over the ease-in, held there, eased back over the ease-out. The camera slows down, holds and
 * moves on where it would have been, without a jump (never backwards).
 */
export function heldMotionTimeS(stop: Pick<ClockStop, 'startS' | 'holdStartS' | 'holdEndS' | 'endS'>, timeS: number): number {
  const middle = (stop.startS + stop.endS) / 2
  const weight = Math.min(ramp(timeS - stop.startS, stop.holdStartS - stop.startS), ramp(stop.endS - timeS, stop.endS - stop.holdEndS))
  return timeS + (middle - timeS) * weight
}

/** True when the view changes with the film time alone (progress unchanged): shots, orbiting or widening stops, orbit / cinema. */
export function filmViewMovesWithTime(state: FilmState, style: CameraStyle): boolean {
  if (state.phase === 'opening' || state.phase === 'closing') return true
  if (state.phase === 'stop' && (state.stop?.camera === 'orbite' || state.stop?.camera === 'large')) return true
  return movesWithTime(style)
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

interface TrackBox {
  /** horizontal box of the track in the local frame (height 0) */
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  /** recorded elevations (NaN when none) */
  minEle: number
  maxEle: number
}

const boxes = new WeakMap<TrackPath, WeakMap<LocalFrame, TrackBox>>()

/** Box of the track in the local frame (cached per path and frame). */
export function trackBox(path: TrackPath, frame: LocalFrame): TrackBox {
  let perFrame = boxes.get(path)
  if (!perFrame) boxes.set(path, (perFrame = new WeakMap()))
  const cached = perFrame.get(frame)
  if (cached) return cached
  const box: TrackBox = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, minEle: NaN, maxEle: NaN }
  const p = new Vector3()
  for (let i = 0; i < path.count; i++) {
    frame.toLocal(path.lon[i], path.lat[i], 0, p)
    box.minX = Math.min(box.minX, p.x)
    box.maxX = Math.max(box.maxX, p.x)
    box.minZ = Math.min(box.minZ, p.z)
    box.maxZ = Math.max(box.maxZ, p.z)
    const ele = path.ele[i]
    if (Number.isNaN(ele)) continue
    if (!(ele >= box.minEle)) box.minEle = ele
    if (!(ele <= box.maxEle)) box.maxEle = ele
  }
  perFrame.set(frame, box)
  return box
}

/** Raise `position` to MIN_GROUND_CLEARANCE_M above the (exaggerated) ground under it. */
function keepAboveGround(position: Vector3, frame: LocalFrame, sample: HeightSampler | null, exaggeration: number): Vector3 {
  if (!sample) return position
  const at = frame.toLonLat(position)
  const ground = sample(at.lon, at.lat)
  if (ground === undefined) return position
  const floorY = frame.toLocal(at.lon, at.lat, ground * exaggeration + MIN_GROUND_CLEARANCE_M).y
  if (position.y < floorY) position.y = floorY
  return position
}

/**
 * Overview of the whole track for a frame of `aspect` (width / height), seen from the side the `joined` flight
 * view looks from.
 */
export function overviewView(
  path: TrackPath,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
  aspect: number,
  joined: CameraView,
): CameraView {
  const box = trackBox(path, frame)
  const centre = new Vector3((box.minX + box.maxX) / 2, 0, (box.minZ + box.maxZ) / 2)
  const at = frame.toLonLat(centre)
  const recorded = Number.isNaN(box.minEle) ? 0 : (box.minEle + box.maxEle) / 2
  const target = frame.toLocal(at.lon, at.lat, (sample?.(at.lon, at.lat) ?? recorded) * exaggeration)

  const relief = Number.isNaN(box.minEle) ? 0 : (box.maxEle - box.minEle) * exaggeration
  const diagonal = Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ, relief)
  const portrait = aspect > 0 && aspect < 1 ? 1 / aspect : 1
  const distance = Math.max(OVERVIEW_MIN_DISTANCE_M, OVERVIEW_DISTANCE_FACTOR * diagonal * portrait)

  const back = joined.position.clone().sub(joined.target).setY(0)
  if (back.lengthSq() < 1e-12) back.set(1, 0, 1)
  back.normalize().multiplyScalar(Math.cos(OVERVIEW_PITCH_DEG * DEG)).addScaledVector(UP, Math.sin(OVERVIEW_PITCH_DEG * DEG))
  const position = target.clone().addScaledVector(back, distance)
  return { target, position: keepAboveGround(position, frame, sample, exaggeration) }
}

/** View `k` of the way from `a` to `b` (exactly `a` at 0 and `b` at 1). */
export function blendViews(
  a: CameraView,
  b: CameraView,
  k: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
): CameraView {
  if (k <= 0) return a
  if (k >= 1) return b
  const target = a.target.clone().lerp(b.target, k)
  const fromA = a.position.clone().sub(a.target)
  const fromB = b.position.clone().sub(b.target)
  const da = Math.max(1, fromA.length())
  const db = Math.max(1, fromB.length())
  const direction = fromA.divideScalar(da).lerp(fromB.divideScalar(db), k)
  if (direction.lengthSq() < 1e-12) direction.copy(UP)
  const distance = da ** (1 - k) * db ** k
  const position = target.clone().addScaledVector(direction.normalize(), distance)
  return { target, position: keepAboveGround(position, frame, sample, exaggeration) }
}

// ---------------------------------------------------------------------------
// Film view
// ---------------------------------------------------------------------------

export interface FilmViewOptions extends Omit<CameraViewOptions, 'timeS' | 'orbitRad'> {
  /** width / height of the frame (overview framing) */
  aspect: number
}

export interface FilmView extends CameraView {
  /** marker position on the draped track (the target only during the flight) */
  marker: Vector3
}

/**
 * Camera at film time `timeS` and `progress` (the store's: the export nudges it to re-place the camera). The
 * time-based flight styles follow the flight time, so they start where the opening hands over. The camera keys
 * set the framing along the track, a stop's camera adds its own move.
 */
export function computeFilmView(
  path: TrackPath,
  clock: FilmClock,
  timeS: number,
  progress: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  options: FilmViewOptions,
): FilmView {
  const state = clock.stateAt(timeS)
  const { aspect, ...flightOptions } = options
  const stop = state.stop
  const easeM = cameraKeyEaseM(path.lengthM, options.durationS ?? DEFAULT_FLYOVER_DURATION_S)
  const keyed = keyedCamera(options.camera ?? DEFAULT_CAMERA, clock.cameraKeys, progress * path.lengthM, easeM)
  const camera = stop?.camera === 'large' ? widenedCamera(keyed, stopBump(state.localS, state.lengthS)) : keyed
  const orbitRad = stop?.camera === 'orbite' ? stopOrbitRad(stop.addedS, state.localS, state.lengthS) : 0
  const motionS = stop?.camera === 'fixe' ? heldMotionTimeS(stop, state.timeS) - clock.openingS : state.flightTimeS
  const flight = computeCameraView(path, progress, frame, sample, { ...flightOptions, camera, timeS: motionS, orbitRad })
  if (state.phase !== 'opening' && state.phase !== 'closing') return { ...flight, marker: flight.target }

  const overview = overviewView(path, frame, sample, options.exaggeration, aspect, flight)
  const shot = state.phase === 'opening' ? clock.opening : clock.closing
  const k = shotBlend(shot.style, state.phase, state.localS, state.lengthS)
  const view =
    state.phase === 'opening'
      ? blendViews(overview, flight, k, frame, sample, options.exaggeration)
      : blendViews(flight, overview, k, frame, sample, options.exaggeration)
  return { ...view, marker: flight.target }
}

/**
 * Smoothing of the flight camera in film time (`settings.camera`): the aim point (« Lissage de la visée ») and the
 * camera (« Lissage de la caméra ») follow the marker's progress averaged over a window of film time, so speed changes,
 * pauses and stops ease the view instead of jerking it; « Fin en douceur » slows the camera to a stop at the end.
 * See ARCHITECTURE.md "Flyover", Smoothing in film time.
 *
 * The progress is averaged rather than the placements: at constant speed the average is the progress itself, the
 * averaged point stays on the track (no corner cut), and a sample costs a clock look-up instead of a camera placement.
 * Raised-cosine weights over TIME_SMOOTHING_SAMPLES fixed offsets keep it a pure function of the film time (the export
 * renders any frame alone). The clock holds the progress outside the flight, so the windows reach across its edges
 * without a jump.
 */
import type { FilmClock } from '../film/clock'
import type { CameraViewOptions } from './camera'
import type { CameraSettings } from './cameraSettings'

/** Samples of a smoothing window (fixed: the cost does not grow with the window). */
export const TIME_SMOOTHING_SAMPLES = 21

/** Offsets in the window (share of its length, centred: the middle sample at 0) and their raised-cosine weights (sum 1). */
const OFFSETS = Array.from({ length: TIME_SMOOTHING_SAMPLES }, (_, i) => (i + 0.5) / TIME_SMOOTHING_SAMPLES - 0.5)
const RAW_WEIGHTS = OFFSETS.map((u) => 1 + Math.cos(2 * Math.PI * u))
const WEIGHT_SUM = RAW_WEIGHTS.reduce((sum, w) => sum + w, 0)
const WEIGHTS = RAW_WEIGHTS.map((w) => w / WEIGHT_SUM)

type Smoothing = Pick<CameraSettings, 'aimSmoothingS' | 'cameraSmoothingS' | 'endingS'>

/** True when the camera moves with the film time while the marker holds still (a stop's hold). */
export function smoothsInTime(camera: Smoothing): boolean {
  return camera.aimSmoothingS > 0 || camera.cameraSmoothingS > 0 || camera.endingS > 0
}

/**
 * Raised-cosine average of `f` over the `windowS` seconds centred on `timeS` (`f(timeS)` without a window); exact where
 * `f` is constant (a stop's hold longer than the window holds the camera still).
 */
export function windowAverage(f: (timeS: number) => number, timeS: number, windowS: number): number {
  const centre = f(timeS)
  if (!(windowS > 0)) return centre
  let sum = 0
  for (let i = 0; i < TIME_SMOOTHING_SAMPLES; i++) {
    if (OFFSETS[i] !== 0) sum += WEIGHTS[i] * (f(timeS + OFFSETS[i] * windowS) - centre)
  }
  return centre + sum
}

/**
 * Time eased to a stop at `endS`: unchanged until `easeS` before it, then slowing down at a constant rate (speed 1 → 0,
 * no kink where it starts), held after `endS` at `endS - easeS / 2`.
 */
export function easedEndTimeS(timeS: number, endS: number, easeS: number): number {
  if (!(easeS > 0) || timeS <= endS - easeS) return timeS
  const u = Math.min(1, (timeS - (endS - easeS)) / easeS)
  return endS - easeS + easeS * (u - (u * u) / 2)
}

/**
 * Time-smoothing options of the flight camera at film time `timeS`: progress of the aim point and of the camera
 * (absent: the marker's), time of the time-based motions (`motionS`, flight time; orbit and cinema styles) with the
 * ending ease. The aim keeps following the marker to the end of the flight: the camera stops and turns to watch it.
 */
export function timeSmoothing(
  clock: Pick<FilmClock, 'progressAtTime' | 'openingS' | 'flightS'>,
  timeS: number,
  motionS: number,
  camera: Smoothing,
): Pick<CameraViewOptions, 'aimProgress' | 'cameraProgress' | 'timeS'> {
  const progressAt = (t: number) => clock.progressAtTime(t)
  const easeS = Math.min(camera.endingS, clock.flightS)
  const cameraTimeS = easedEndTimeS(timeS, clock.openingS + clock.flightS, easeS)
  return {
    aimProgress: camera.aimSmoothingS > 0 ? windowAverage(progressAt, timeS, camera.aimSmoothingS) : undefined,
    cameraProgress:
      camera.cameraSmoothingS > 0 || cameraTimeS !== timeS ? windowAverage(progressAt, cameraTimeS, camera.cameraSmoothingS) : undefined,
    timeS: easedEndTimeS(motionS, clock.flightS, easeS),
  }
}

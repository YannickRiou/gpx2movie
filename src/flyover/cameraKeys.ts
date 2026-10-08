/**
 * Camera keys of the film: framings (distance, pitch, heading) pinned along the track, eased from one to the next.
 * Pure module without three.js, so the camera panel can use it without loading the 3D engine.
 */
import { smootherstep } from '../core/math'
import type { FilmCameraKey } from '../film/model'
import type { CameraSettings } from './cameraSettings'

/** The camera eases into the first camera key and back out of the last one over this (seconds at the base speed). */
export const CAMERA_KEY_EASE_S = 3

type Framing = Pick<CameraSettings, 'distance' | 'pitchDeg' | 'headingOffsetDeg'>

/** `a` → `b` at `k` (0..1): linear, the heading the shorter way round. */
function blendFraming(a: Framing, b: Framing, k: number): Framing {
  const turn = ((((b.headingOffsetDeg - a.headingOffsetDeg) % 360) + 540) % 360) - 180
  return {
    distance: a.distance + (b.distance - a.distance) * k,
    pitchDeg: a.pitchDeg + (b.pitchDeg - a.pitchDeg) * k,
    headingOffsetDeg: a.headingOffsetDeg + turn * k,
  }
}

/** Length of the ease into the first camera key and out of the last (metres): CAMERA_KEY_EASE_S at the base speed. */
export function cameraKeyEaseM(lengthM: number, durationS: number): number {
  return Math.max(1, (lengthM * CAMERA_KEY_EASE_S) / Math.max(1, durationS))
}

/**
 * Camera settings at `atM` metres along the track with the camera keys (`keys` sorted by position): between two
 * keys, eased from one to the next by smootherstep (still at each key: no jerk); over `easeM` before the first key,
 * from the film's settings to it, and over `easeM` after the last one back to them; elsewhere the film's settings.
 */
export function keyedCamera(camera: CameraSettings, keys: readonly FilmCameraKey[], atM: number, easeM: number): CameraSettings {
  if (keys.length === 0) return camera
  const first = keys[0]
  const last = keys[keys.length - 1]
  const next = keys.findIndex((k) => k.atM > atM)
  let framing: Framing
  if (next === 0) framing = blendFraming(camera, first, smootherstep(1 - (first.atM - atM) / easeM))
  else if (next === -1) framing = blendFraming(last, camera, smootherstep((atM - last.atM) / easeM))
  else {
    const a = keys[next - 1]
    const b = keys[next]
    framing = blendFraming(a, b, smootherstep((atM - a.atM) / (b.atM - a.atM)))
  }
  return { ...camera, ...framing }
}

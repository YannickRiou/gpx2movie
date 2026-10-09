/**
 * Flyover camera settings and pacing: camera styles, the `camera` settings sub-object, its named presets and
 * the progress advance for a given flyover duration.
 *
 * Pure values and functions (no DOM, no React, no Three); the view itself is computed in `camera.ts`.
 */
import { clamp } from '../core/math'
import { withDefaults } from '../core/guards'

export const CAMERA_STYLES = ['chase', 'sway', 'orbit', 'top', 'cinematic'] as const
export type CameraStyle = (typeof CAMERA_STYLES)[number]

/** French labels (style select). */
export const CAMERA_STYLE_LABELS: Record<CameraStyle, string> = {
  chase: 'Poursuite',
  sway: 'Balancement (extérieur des virages)',
  orbit: 'Orbite autour du marqueur',
  top: 'Vue du dessus',
  cinematic: 'Plan cinématique',
}

export interface CameraSettings {
  style: CameraStyle
  /** multiplier of the automatic distance (a fraction of the track length, clamped) */
  distance: number
  /** angle above the horizon, degrees (style 'top' never goes below TOP_MIN_PITCH_DEG) */
  pitchDeg: number
  /** viewing direction relative to the travel direction (north for 'top' north-up), degrees, > 0 = to the right */
  headingOffsetDeg: number
  /** multiplier of the automatic window over which the travel direction is measured: larger = calmer */
  smoothing: number
  /** style 'top' only: north at the top of the image instead of the travel direction */
  northUp: boolean
  /** « Lissage des virages »: length of track the travel direction is measured over (metres), 0 = automatic × `smoothing` */
  turnSmoothingM: number
  /** « Lissage de la visée »: the aim point follows the marker's progress averaged over this much film time (s), 0 = none */
  aimSmoothingS: number
  /** « Lissage de la caméra »: the camera follows the marker's progress averaged over this much film time (s), 0 = none */
  cameraSmoothingS: number
  /** « Fin en douceur »: the camera slows down to a stop over the last seconds of the flight (s), 0 = none */
  endingS: number
}

/** Default camera: the chase view. */
export const DEFAULT_CAMERA: CameraSettings = {
  style: 'chase',
  distance: 1,
  pitchDeg: 30,
  headingOffsetDeg: 0,
  smoothing: 1,
  northUp: false,
  turnSmoothingM: 0,
  aimSmoothingS: 0,
  cameraSmoothingS: 3,
  endingS: 0,
}

/** Fields missing from a camera saved before they were added, taken from `DEFAULT_CAMERA` (`SETTING_UPGRADES`). */
export const withCameraDefaults = withDefaults(DEFAULT_CAMERA)

/** Slider ranges (also the validity ranges of a loaded project). */
export const CAMERA_RANGES = {
  distance: { min: 0.3, max: 4, step: 0.1 },
  pitchDeg: { min: 5, max: 85, step: 1 },
  headingOffsetDeg: { min: -180, max: 180, step: 5 },
  smoothing: { min: 0.25, max: 4, step: 0.25 },
  turnSmoothingM: { min: 0, max: 6_000, step: 50 },
  aimSmoothingS: { min: 0, max: 5, step: 0.5 },
  cameraSmoothingS: { min: 0, max: 10, step: 0.5 },
  endingS: { min: 0, max: 5, step: 0.5 },
} as const satisfies Partial<Record<keyof CameraSettings, { min: number; max: number; step: number }>>

/** Heading = direction of the chord [d - w, d + w]; automatic w = this fraction of the track, clamped, times `smoothing`. */
export const HEADING_WINDOW_FRACTION = 0.02
export const HEADING_WINDOW_MIN_M = 150
export const HEADING_WINDOW_MAX_M = 1_500

/**
 * Length of track (metres, the chord 2w) over which the travel direction is measured: `turnSmoothingM` when set, else
 * the automatic window of a track `lengthM` long times the `smoothing` multiplier (projects saved before keep it).
 */
export function turnSmoothingM(camera: Pick<CameraSettings, 'turnSmoothingM' | 'smoothing'>, lengthM: number): number {
  if (camera.turnSmoothingM > 0) return camera.turnSmoothingM
  return 2 * clamp(lengthM * HEADING_WINDOW_FRACTION, HEADING_WINDOW_MIN_M, HEADING_WINDOW_MAX_M) * camera.smoothing
}

export interface CameraPreset {
  name: string
  camera: CameraSettings
}

export const CAMERA_PRESETS: readonly CameraPreset[] = [
  { name: 'Poursuite', camera: DEFAULT_CAMERA },
  { name: 'Hélicoptère', camera: { ...DEFAULT_CAMERA, style: 'sway', distance: 1.3, pitchDeg: 25, smoothing: 1.5 } },
  { name: 'Drone haut', camera: { ...DEFAULT_CAMERA, distance: 1.8, pitchDeg: 55, smoothing: 1.5 } },
  { name: 'Vue du dessus', camera: { ...DEFAULT_CAMERA, style: 'top', distance: 1.5, pitchDeg: 85, smoothing: 2, northUp: true } },
  { name: 'Orbite', camera: { ...DEFAULT_CAMERA, style: 'orbit', distance: 1.2 } },
  { name: 'Cinéma', camera: { ...DEFAULT_CAMERA, style: 'cinematic', smoothing: 2 } },
]

/** The preset whose camera equals `camera`, if any. */
export function findCameraPreset(camera: CameraSettings): CameraPreset | undefined {
  const keys = Object.keys(DEFAULT_CAMERA) as (keyof CameraSettings)[]
  return CAMERA_PRESETS.find((p) => keys.every((k) => p.camera[k] === camera[k]))
}

/** Known style and every number inside its slider range. */
export function isValidCamera(camera: CameraSettings): boolean {
  if (!CAMERA_STYLES.includes(camera.style)) return false
  return (Object.keys(CAMERA_RANGES) as (keyof typeof CAMERA_RANGES)[]).every((k) => {
    const { min, max } = CAMERA_RANGES[k]
    return camera[k] >= min && camera[k] <= max
  })
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

/** Flyover duration at speed x1, whatever the track length (seconds); the timeline speed applies on top. */
export const DEFAULT_FLYOVER_DURATION_S = 60
export const FLYOVER_DURATION_RANGE = { min: 15, max: 600, step: 5 } as const

/** Progress after `deltaS` seconds of playback at `speed`, for a flyover lasting `durationS` at x1; clamped to 1. */
export function advanceProgress(progress: number, deltaS: number, speed: number, durationS: number): number {
  return Math.min(1, progress + (deltaS * speed) / durationS)
}

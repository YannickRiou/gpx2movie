/** « Objectif » setting (`settings.lens`) and the pure parts of its effects (ARCHITECTURE.md, « Objectif »). */
import { withDefaults } from '../core/guards'
import { clamp } from '../core/math'
import type { FilmClock } from '../film/clock'

export interface LensSettings {
  /** motion blur: fraction of the frame interval the shutter stays open, 0 (off) .. 1 */
  shutter: number
  /** bloom amount, 0 (off) .. 1 */
  bloom: number
  /** bloom radius, 0 (tight) .. 1 (wide) */
  bloomRadius: number
  /** lens flare amount when the sun is in the frame, 0 (off) .. 1 (atmosphere only) */
  flare: number
  /** depth of field amount, 0 (off) .. 1: sharp on the marker, blurred in front of and behind it */
  depthOfField: number
}

export const DEFAULT_LENS: LensSettings = { shutter: 0, bloom: 0, bloomRadius: 0.6, flare: 0, depthOfField: 0 }

/** Slider bounds of each value (also the validation of saved projects). */
export const LENS_RANGES: Record<keyof LensSettings, { min: number; max: number; step: number }> = {
  shutter: { min: 0, max: 1, step: 0.05 },
  bloom: { min: 0, max: 1, step: 0.05 },
  bloomRadius: { min: 0, max: 1, step: 0.05 },
  flare: { min: 0, max: 1, step: 0.05 },
  depthOfField: { min: 0, max: 1, step: 0.05 },
}

const LENS_KEYS = Object.keys(LENS_RANGES) as (keyof LensSettings)[]

export function isValidLens(v: LensSettings): boolean {
  return LENS_KEYS.every((key) => v[key] >= LENS_RANGES[key].min && v[key] <= LENS_RANGES[key].max)
}

/** Fields added after a project was saved take their default. */
export const withLensDefaults = withDefaults(DEFAULT_LENS)

/** True when an effect of the lens is on (the flare only counts with the atmosphere): a composer is needed. */
export function lensActive(lens: LensSettings, atmosphere: boolean): boolean {
  return lens.shutter > 0 || lens.bloom > 0 || lens.depthOfField > 0 || (atmosphere && lens.flare > 0)
}

// ---------------------------------------------------------------------------
// Effect parameters
// ---------------------------------------------------------------------------

/** Bloom: linear luminance (after the tone mapping) above which the image glows: sun, snow, glittering water. */
export const BLOOM_THRESHOLD = 0.6
export const BLOOM_SMOOTHING = 0.3
const BLOOM_MAX_INTENSITY = 2.5

export function bloomParams(amount: number, radius: number): { intensity: number; radius: number } {
  return { intensity: BLOOM_MAX_INTENSITY * clamp(amount, 0, 1), radius: 0.2 + 0.75 * clamp(radius, 0, 1) }
}

/** Bokeh scale (pixels at the 1080p reference) at amount 1. */
const DOF_MAX_BOKEH = 6
/** Distance from the focus, as a fraction of it, at which the blur is full (amount 0 and 1). */
const DOF_RANGE = { weak: 2, strong: 0.5 }

export function depthOfFieldParams(amount: number, focusM: number): { focusRange: number; bokehScale: number } {
  const a = clamp(amount, 0, 1)
  return {
    focusRange: Math.max(1, focusM) * (DOF_RANGE.weak + (DOF_RANGE.strong - DOF_RANGE.weak) * a),
    bokehScale: DOF_MAX_BOKEH * a,
  }
}

// ---------------------------------------------------------------------------
// Motion blur
// ---------------------------------------------------------------------------

/** Renders averaged per exported frame with the shutter open (the clouds share their noise slices among them). */
export const SHUTTER_SUBFRAMES = 8

export interface ShutterSample {
  progress: number
  timeS: number
}

/** `values` at the fractional frame index `f` (linear between neighbouring frames, clamped to the film). */
function valueAt(values: readonly number[], f: number): number {
  const last = values.length - 1
  const x = clamp(f, 0, last)
  const i = Math.floor(x)
  const t = x - i
  return t === 0 ? values[i] : values[i] + (values[Math.min(i + 1, last)] - values[i]) * t
}

/**
 * `count` renders of frame `index`, stratified over ± shutter / 2 frame intervals around it. An instant that `keep`
 * rejects (other side of a cut) is replaced by the frame itself.
 */
export function shutterSamples(
  times: readonly number[],
  progress: readonly number[],
  index: number,
  shutter: number,
  count: number,
  keep: (timeS: number) => boolean = () => true,
): ShutterSample[] {
  const own = { progress: progress[index], timeS: times[index] }
  const s = clamp(shutter, 0, 1)
  if (s === 0 || count <= 1) return [own]
  const samples: ShutterSample[] = []
  for (let j = 0; j < count; j++) {
    const f = index + s * ((j + 0.5) / count - 0.5)
    const timeS = valueAt(times, f)
    samples.push(keep(timeS) ? { progress: valueAt(progress, f), timeS } : own)
  }
  return samples
}

/**
 * Weight of the previous output in the preview trail: the lag of the exponential average, Δt · w / (1 − w), matches
 * the centre of the exported shutter (shutter / fps / 2) at any preview frame rate.
 */
export function previewShutterWeight(shutter: number, fps: number, deltaS: number): number {
  const lagS = (clamp(shutter, 0, 1) / Math.max(1, fps)) / 2
  if (lagS <= 0 || !(deltaS > 0)) return 0
  return lagS / (deltaS + lagS)
}

/** Radial speed blur: streak length (fraction of the distance to the centre) per unit of relative speed (1/s). */
const RADIAL_GAIN_S = 0.1
const RADIAL_MAX = 0.15
/** Below this relative speed (1/s) the camera counts as still: no radial blur. */
const RADIAL_MIN_SPEED = 0.02

/**
 * Length of the radial speed blur, from the camera placements of the film `intervalS` apart: the camera moved
 * `movedM` while aiming `aimDistanceM` away, so the scene sweeps the frame at movedM / aimDistanceM per interval.
 */
export function radialBlurLength(shutter: number, movedM: number, aimDistanceM: number, intervalS: number): number {
  // a jump longer than the aim distance in one interval is a cut (stage, leader), not a move
  if (!(intervalS > 0) || movedM > aimDistanceM) return 0
  const speed = movedM / Math.max(1, aimDistanceM) / intervalS
  return speed < RADIAL_MIN_SPEED ? 0 : clamp(shutter, 0, 1) * Math.min(RADIAL_MAX, RADIAL_GAIN_S * speed)
}

/** Sub-frame being rendered by the export: `index` of `count` (count 1: no motion blur). */
export interface ShutterSubFrame {
  index: number
  count: number
}

let subFrame: ShutterSubFrame = { index: 0, count: 1 }

/** Set by the export before each render of a motion-blurred frame, back to { 0, 1 } afterwards. */
export function setShutterSubFrame(index: number, count: number): void {
  subFrame = { index, count }
}

export function shutterSubFrame(): ShutterSubFrame {
  return subFrame
}

/** The cloud noise slices of a frame split among its sub-frames, so the blur does not multiply their cost. */
export function subFrameSlices(slices: number, { index, count }: ShutterSubFrame): { first: number; count: number } {
  const per = Math.max(1, Math.round(slices / Math.max(1, count)))
  return { first: index * per, count: per }
}

/** `aS` and `bS` belong to the same continuous shot: same phase and no stage cut « À la suite » between them. */
export function sameShot(clock: FilmClock, aS: number, bS: number): boolean {
  const [from, to] = aS <= bS ? [aS, bS] : [bS, aS]
  return clock.stateAt(aS).phase === clock.stateAt(bS).phase && !clock.cuts.some((c) => c.timeS > from && c.timeS <= to)
}

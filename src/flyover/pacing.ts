/**
 * Variable pacing of the flyover: slow-downs and pauses at the highlights of the first track.
 *
 * The playback progress stays the fraction of the track distance (camera, atmosphere, overlay and labels are
 * still pure functions of it); pacing only changes the mapping between the film time and the progress.
 *
 * Model, with L the track length and D = `settings.flyoverDurationS` (base ground speed v0 = L / D at ×1):
 *
 * 1. Highlights (metres along the track): tops of the detected climbs (`climbsOf`) and, from the landmarks
 *    passed in (the module never reads a store), passes crossed by the track (≤ `CROSSED_PASS_M`) and peaks
 *    within `PEAK_NEAR_M`.
 * 2. Relative speed r(x) = 1 − (1 − slowFactor) · max_h c(|x − h| / windowM), with the raised cosine
 *    c(u) = (1 + cos πu) / 2 for u < 1, else 0: smooth dip down to `slowFactor` at each highlight over
 *    ±`windowM`. Overlapping windows take the deepest dip (never slower than `slowFactor`, no compounding).
 * 3. Moving time u(x) = c · ∫₀ˣ dx / (v0 · r(x)), tabulated on a grid that is regular inside every window
 *    (`WINDOW_SAMPLES` steps) and has the highlights as nodes; the speed is constant on each grid step, so
 *    u ↔ x is piecewise linear and exactly invertible.
 * 4. Pauses: highlights closer than `windowM` form one cluster, paused once at its highlight nearest its
 *    middle. A pause adds exactly `pauseS` to the film: in film time, the moving clock du/dτ eases from 1 to 0
 *    over E (raised cosine), holds 0 for `pauseS` − E, eases back to 1 over E; E = min(`PAUSE_EASE_S`, pauseS,
 *    room before / after the neighbouring pauses and the ends), so the marker never stops abruptly.
 * 5. Duration: `keepDuration` scales the base speed (factor c) so that the film lasts D at ×1 whatever the
 *    highlights; pauses then take at most `MAX_PAUSE_SHARE` of D (shortened evenly beyond). Without it,
 *    c = 1: slow-downs and pauses lengthen the film.
 *
 * No highlight (or pacing disabled, or nothing to slow down nor pause) gives the identity pacing, exactly the
 * constant ground speed of `advanceProgress`. Pure functions (no DOM, no React, no Three, no store).
 */
import type { Track } from '../core/types'
import { CROSSED_PASS_M } from '../osm/landmarks'
import type { Landmark } from '../osm/landmarks'
import { advanceProgress } from './cameraSettings'
import { climbsOf } from './climbs'

export interface PacingSettings {
  /** slow down (and pause) at the highlights; off = constant ground speed */
  enabled: boolean
  /** tops of the detected climbs are highlights */
  climbs: boolean
  /** passes crossed and peaks next to the track (OpenStreetMap landmarks) are highlights */
  landmarks: boolean
  /** relative speed at a highlight (0.35 = 35 % of the normal speed; 1 = no slow-down) */
  slowFactor: number
  /** half-width of the slow-down on each side of a highlight (metres) */
  windowM: number
  /** time added to the film by the pause at each highlight (seconds, 0 = no pause) */
  pauseS: number
  /** keep the film at `flyoverDurationS` (the base speed rises) instead of lengthening it */
  keepDuration: boolean
}

export const DEFAULT_PACING: PacingSettings = {
  enabled: false,
  climbs: true,
  landmarks: true,
  slowFactor: 0.35,
  windowM: 1000,
  pauseS: 2,
  keepDuration: true,
}

/** Slider ranges (also the validity ranges of a loaded project). */
export const PACING_RANGES = {
  slowFactor: { min: 0.1, max: 1, step: 0.05 },
  windowM: { min: 100, max: 10000, step: 100 },
  pauseS: { min: 0, max: 10, step: 0.5 },
} as const satisfies Partial<Record<keyof PacingSettings, { min: number; max: number; step: number }>>

/** A peak at most this far from the track is a highlight (metres). */
export const PEAK_NEAR_M = 300
/** Longest ease into and out of a pause (film seconds at ×1). */
export const PAUSE_EASE_S = 1.5
/** With `keepDuration`, the pauses take at most this share of the flyover duration. */
export const MAX_PAUSE_SHARE = 0.5
/** Grid steps across the window (±windowM) of each highlight. */
export const WINDOW_SAMPLES = 64

/** Every number inside its slider range. */
export function isValidPacing(pacing: PacingSettings): boolean {
  return (Object.keys(PACING_RANGES) as (keyof typeof PACING_RANGES)[]).every((k) => {
    const { min, max } = PACING_RANGES[k]
    return pacing[k] >= min && pacing[k] <= max
  })
}

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

/** Positions (metres along the track) of the landmarks that are highlights: passes crossed, peaks nearby. */
export function landmarkHighlights(landmarks: readonly Landmark[]): number[] {
  return landmarks
    .filter((l) => (l.kind === 'pass' && l.distanceM <= CROSSED_PASS_M) || (l.kind === 'peak' && l.distanceM <= PEAK_NEAR_M))
    .map((l) => l.alongM)
}

/** Sorted highlight positions (metres along the track) selected by the settings. */
export function pacingHighlights(track: Track, settings: PacingSettings, landmarks: readonly Landmark[] = []): number[] {
  const out: number[] = []
  if (settings.climbs) for (const climb of climbsOf(track)) out.push(climb.endDistM)
  if (settings.landmarks) out.push(...landmarkHighlights(landmarks))
  return out.sort((a, b) => a - b)
}

/** Relative speed r(x) at `x` metres (1 = normal speed), for sorted or unsorted highlights. */
export function relativeSpeed(x: number, highlightsM: readonly number[], slowFactor: number, windowM: number): number {
  let dip = 0
  for (const h of highlightsM) {
    const u = Math.abs(x - h) / windowM
    if (u < 1) dip = Math.max(dip, (1 + Math.cos(Math.PI * u)) / 2)
  }
  return 1 - (1 - slowFactor) * dip
}

// ---------------------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------------------

/** Playback position: film time (seconds at ×1) and the progress it maps to. */
export interface PacingPosition {
  timeS: number
  progress: number
}

export interface PacingPause {
  progress: number
  /** film time (seconds at ×1) when the marker stops and starts again */
  holdStartS: number
  holdEndS: number
}

export interface Pacing {
  /** false for the identity pacing (constant ground speed) */
  active: boolean
  /** highlight positions as progress values, sorted */
  highlights: readonly number[]
  pauses: readonly PacingPause[]
  /** film length at ×1 (seconds) */
  totalTime(): number
  /** progress at film time `tS` (clamped to [0, totalTime()]); continuous and non-decreasing */
  progressAtTime(tS: number): number
  /**
   * first film time at which the progress reaches `progress` (start of the hold for a paused highlight); 1 is the
   * end of the film, after a final pause
   */
  timeAtProgress(progress: number): number
  /** position of a progress set from outside (scrub, rewind) */
  positionAt(progress: number): PacingPosition
  /** position after `dtS` seconds of playback at `speed` (the film time is clamped to [0, totalTime()]) */
  advance(from: PacingPosition, dtS: number, speed: number): PacingPosition
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Constant ground speed: the film lasts `durationS`, `advance` is `advanceProgress`. */
function identityPacing(durationS: number): Pacing {
  const progressAtTime = (tS: number) => clamp(tS / durationS, 0, 1)
  const timeAtProgress = (progress: number) => clamp(progress, 0, 1) * durationS
  return {
    active: false,
    highlights: [],
    pauses: [],
    totalTime: () => durationS,
    progressAtTime,
    timeAtProgress,
    positionAt: (progress) => ({ timeS: timeAtProgress(progress), progress }),
    advance: (from, dtS, speed) => ({
      timeS: clamp(from.timeS + dtS * speed, 0, durationS),
      progress: advanceProgress(from.progress, dtS, speed, durationS),
    }),
  }
}

/** Index of the last element of the sorted `values` that is ≤ `v` (-1 when none). */
function lastAtOrBelow(values: ArrayLike<number>, v: number): number {
  let lo = 0
  let hi = values.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (values[mid] <= v) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** Linear interpolation of the piecewise-linear table (from → to) at `v` (clamped to the table). */
function interpolate(from: Float64Array, to: Float64Array, v: number): number {
  const n = from.length
  if (v <= from[0]) return to[0]
  if (v >= from[n - 1]) return to[n - 1]
  const i = Math.min(n - 2, lastAtOrBelow(from, v))
  const span = from[i + 1] - from[i]
  return span > 0 ? to[i] + ((to[i + 1] - to[i]) * (v - from[i])) / span : to[i]
}

/** Moving time covered `s` seconds into an ease-in of length `e` (clock 1 → 0); ease-in(e) = e / 2. */
function easeIn(s: number, e: number): number {
  return e > 0 ? s / 2 + (e / (2 * Math.PI)) * Math.sin((Math.PI * s) / e) : 0
}

/** Same for an ease-out (clock 0 → 1); ease-out(e) = e / 2. */
function easeOut(s: number, e: number): number {
  return e > 0 ? s / 2 - (e / (2 * Math.PI)) * Math.sin((Math.PI * s) / e) : 0
}

/** s in [0, e] with ease(s, e) = target (both eases are non-decreasing), by bisection. */
function invertEase(ease: (s: number, e: number) => number, target: number, e: number): number {
  let lo = 0
  let hi = e
  for (let k = 0; k < 60 && hi - lo > 1e-12; k++) {
    const mid = (lo + hi) / 2
    if (ease(mid, e) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Highlights closer than `gapM` to the previous one form a cluster; each cluster's member nearest its middle. */
function pausePositions(sorted: readonly number[], gapM: number): number[] {
  const out: number[] = []
  let start = 0
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] - sorted[i - 1] <= gapM) continue
    const middle = (sorted[start] + sorted[i - 1]) / 2
    let best = sorted[start]
    for (let k = start; k < i; k++) if (Math.abs(sorted[k] - middle) < Math.abs(best - middle)) best = sorted[k]
    out.push(best)
    start = i
  }
  return out
}

/**
 * Pacing of a track `lengthM` long with highlights at `highlightsM` (metres along it), for a flyover of
 * `durationS` at ×1. The identity pacing when disabled, without length or highlight, or with nothing to do.
 */
export function pacingFromHighlights(
  lengthM: number,
  highlightsM: readonly number[],
  durationS: number,
  settings: PacingSettings,
): Pacing {
  const slows = settings.slowFactor < 1
  const pausesOn = settings.pauseS > 0
  if (!settings.enabled || !(lengthM > 0) || !(durationS > 0) || highlightsM.length === 0 || (!slows && !pausesOn)) {
    return identityPacing(durationS > 0 ? durationS : 1)
  }
  const L = lengthM
  const W = settings.windowM
  const highlights = [...new Set(highlightsM.map((h) => clamp(h, 0, L)))].sort((a, b) => a - b)
  const pauseAt = pausesOn ? pausePositions(highlights, W) : []

  // grid: track ends, highlights, regular steps across every window
  const nodes = [0, L, ...highlights]
  if (slows) {
    const half = WINDOW_SAMPLES / 2
    for (const h of highlights) {
      for (let j = -half; j <= half; j++) {
        const x = h + (j * W) / half
        if (x > 0 && x < L) nodes.push(x)
      }
    }
  }
  nodes.sort((a, b) => a - b)
  const xs: number[] = []
  for (const x of nodes) if (xs.length === 0 || x > xs[xs.length - 1]) xs.push(x)

  // moving time at ×1 before scaling: speed v0 · r(midpoint) on each step
  const n = xs.length
  const raw = new Float64Array(n)
  for (let i = 1; i < n; i++) {
    const r = slows ? relativeSpeed((xs[i - 1] + xs[i]) / 2, highlights, settings.slowFactor, W) : 1
    raw[i] = raw[i - 1] + ((xs[i] - xs[i - 1]) * durationS) / (L * r)
  }
  const moving = raw[n - 1]
  const pauseS =
    settings.keepDuration && pauseAt.length > 0 ? Math.min(settings.pauseS, (MAX_PAUSE_SHARE * durationS) / pauseAt.length) : settings.pauseS
  const scale = settings.keepDuration ? (durationS - pauseAt.length * pauseS) / moving : 1

  const xTable = Float64Array.from(xs)
  const uTable = raw.map((u) => u * scale)
  const U = uTable[n - 1]

  // pauses: moving time of the paused node, eases limited by the neighbours and the ends
  const pu = pauseAt.map((x) => uTable[lastAtOrBelow(xTable, x)])
  const ease = pu.map((u, k) =>
    Math.min(PAUSE_EASE_S, pauseS, 2 * u, 2 * (U - u), k > 0 ? u - pu[k - 1] : Infinity, k < pu.length - 1 ? pu[k + 1] - u : Infinity),
  )
  /** film time at which each pause starts easing in, and its moving time then */
  const startT = pu.map((u, k) => u - ease[k] / 2 + k * pauseS)
  const startU = pu.map((u, k) => u - ease[k] / 2)
  const total = U + pauseAt.length * pauseS

  const progressOfU = (u: number) => clamp(interpolate(uTable, xTable, u) / L, 0, 1)
  const uOfProgress = (progress: number) => interpolate(xTable, uTable, clamp(progress, 0, 1) * L)

  const movingTimeAt = (tS: number): number => {
    const t = clamp(tS, 0, total)
    const k = lastAtOrBelow(startT, t)
    if (k < 0) return t
    const e = ease[k]
    const hold = pauseS - e
    const s = t - startT[k]
    if (s < e) return startU[k] + easeIn(s, e)
    if (s < e + hold) return pu[k]
    if (s < 2 * e + hold) return pu[k] + easeOut(s - e - hold, e)
    return t - (k + 1) * pauseS
  }

  const timeAtProgress = (progress: number): number => {
    if (progress >= 1) return total
    const u = uOfProgress(progress)
    const k = lastAtOrBelow(startU, u)
    if (k < 0) return u
    const e = ease[k]
    const d = u - startU[k]
    if (d <= e / 2) return startT[k] + (d >= e / 2 ? e : invertEase(easeIn, d, e))
    if (d < e) return startT[k] + pauseS + invertEase(easeOut, d - e / 2, e)
    return u + (k + 1) * pauseS
  }

  const progressAtTime = (tS: number) => progressOfU(movingTimeAt(tS))

  return {
    active: true,
    highlights: highlights.map((h) => h / L),
    pauses: pauseAt.map((x, k) => ({
      progress: x / L,
      holdStartS: startT[k] + ease[k],
      holdEndS: startT[k] + pauseS,
    })),
    totalTime: () => total,
    progressAtTime,
    timeAtProgress,
    positionAt: (progress) => ({ timeS: timeAtProgress(progress), progress }),
    advance: (from, dtS, speed) => {
      const timeS = clamp(from.timeS + dtS * speed, 0, total)
      return { timeS, progress: progressAtTime(timeS) }
    },
  }
}

export interface PacingInput {
  /** first track (none: identity pacing) */
  track: Track | undefined
  /** `settings.flyoverDurationS`: film length at ×1 without pacing */
  durationS: number
  settings: PacingSettings
  /** OpenStreetMap landmarks of the track (from the landmark store), used when `settings.landmarks` */
  landmarks?: readonly Landmark[]
}

/** Pacing of the flyover of `track`. */
export function buildPacing({ track, durationS, settings, landmarks = [] }: PacingInput): Pacing {
  if (!track || !settings.enabled) return pacingFromHighlights(0, [], durationS, settings)
  return pacingFromHighlights(track.stats.distanceM, pacingHighlights(track, settings, landmarks), durationS, settings)
}

/**
 * Climb detection from the recorded elevation profile of a track.
 *
 * 1. The recorded elevations are resampled every `RESAMPLE_STEP_M` of ground distance (points without an
 *    elevation are bridged linearly) and smoothed by a centred moving average over `SMOOTHING_WINDOW_M`.
 * 2. Turning points: zig-zag with hysteresis — a low or high point is only confirmed once the profile has
 *    moved back by `HYSTERESIS_M`, so GPS / barometer jitter never splits a climb.
 * 3. Each low → high pair is a candidate climb. Consecutive candidates are merged when the dip between them
 *    is small (≤ `MERGE_MAX_DIP_M` and ≤ `MERGE_MAX_DIP_FRACTION` of the gain so far, over at most
 *    `MERGE_MAX_GAP_M`) and the second one ends higher: a short false flat does not end a col.
 * 4. Flat approaches and plateaus are trimmed (gradient below `TRIM_MIN_GRADIENT` over `TRIM_WINDOW_M`).
 * 5. Climbs shorter than `MIN_CLIMB_LENGTH_M`, gaining less than `MIN_CLIMB_GAIN_M` or flatter than
 *    `MIN_CLIMB_GRADIENT` on average are dropped.
 *
 * Category: the usual cycling "climb score" = length (m) × average gradient (%) — i.e. 100 × gain, the
 * scale used by Strava — mapped to catégorie 4 / 3 / 2 / 1 / HC by `CATEGORY_THRESHOLDS`. It depends on
 * the terrain only (not on the sport); climbs below catégorie 4 are kept but not classified.
 *
 * Pure functions (no DOM, no React, no Three). `climbsOf` caches the result per track object.
 */
import type { Track } from '../core/types'
import { buildTrackPath, samplePath, type TrackPath } from './path'

/** Spacing of the regular distance grid the profile is analysed on (metres). */
export const RESAMPLE_STEP_M = 20
/** Width of the centred moving average applied to the resampled elevations (metres). */
export const SMOOTHING_WINDOW_M = 100
/** Reversal (metres) needed to confirm a high or low point. */
export const HYSTERESIS_M = 10
/** Two climbs separated by a dip of at most this many metres can be merged… */
export const MERGE_MAX_DIP_M = 40
/** …if the dip is also at most this fraction of the gain of the first climb… */
export const MERGE_MAX_DIP_FRACTION = 0.25
/** …and the descent between them is at most this long (metres). */
export const MERGE_MAX_GAP_M = 1500
/** Flat ends are trimmed while the gradient over this distance (metres) stays below `TRIM_MIN_GRADIENT`. */
export const TRIM_WINDOW_M = 200
export const TRIM_MIN_GRADIENT = 0.02
/** Minimum length, gain and average gradient of a reported climb. */
export const MIN_CLIMB_LENGTH_M = 500
export const MIN_CLIMB_GAIN_M = 50
export const MIN_CLIMB_GRADIENT = 0.03
/** Distance over which the maximum gradient is measured (metres). */
export const MAX_GRADIENT_WINDOW_M = 100

export type ClimbCategory = '4' | '3' | '2' | '1' | 'HC'

/** Minimum climb score (length m × average gradient %) of each category, hardest first. */
export const CATEGORY_THRESHOLDS: readonly (readonly [ClimbCategory, number])[] = [
  ['HC', 80_000],
  ['1', 64_000],
  ['2', 32_000],
  ['3', 16_000],
  ['4', 8_000],
]

export interface Climb {
  /** distance along the track (metres, same scale as `buildTrackPath`) */
  startDistM: number
  endDistM: number
  lengthM: number
  /** smoothed elevation at the bottom and at the top (metres) */
  startEleM: number
  endEleM: number
  /** net gain = endEleM - startEleM (metres) */
  gainM: number
  /** average gradient (fraction, 0.08 = 8 %) */
  avgGradient: number
  /** steepest gradient over `MAX_GRADIENT_WINDOW_M` (fraction) */
  maxGradient: number
  /** length (m) × average gradient (%) */
  score: number
  /** null when the climb is below catégorie 4 */
  category: ClimbCategory | null
  /** highest recorded (unsmoothed) elevation of the climb, for labels (metres) */
  topEleM: number
  /** position of the top */
  top: { lon: number; lat: number }
}

/** Category of a climb score, null below catégorie 4. */
export function climbCategory(score: number): ClimbCategory | null {
  for (const [category, min] of CATEGORY_THRESHOLDS) if (score >= min) return category
  return null
}

/**
 * Recorded elevation every `step` metres from 0 to the end of the path (last sample at lengthM), points
 * without elevation bridged linearly. Undefined when fewer than two points have an elevation.
 */
export function resampleElevation(path: TrackPath, step: number): Float64Array | undefined {
  const known: number[] = []
  for (let i = 0; i < path.count; i++) if (!Number.isNaN(path.ele[i])) known.push(i)
  if (known.length < 2 || path.lengthM <= 0) return undefined
  const n = Math.max(2, Math.ceil(path.lengthM / step) + 1)
  const out = new Float64Array(n)
  let k = 0
  for (let s = 0; s < n; s++) {
    const d = Math.min(path.lengthM, s * step)
    while (k < known.length - 2 && path.dist[known[k + 1]] <= d) k++
    const a = known[k]
    const b = known[k + 1]
    const span = path.dist[b] - path.dist[a]
    const t = span > 0 ? Math.min(1, Math.max(0, (d - path.dist[a]) / span)) : 0
    out[s] = path.ele[a] + (path.ele[b] - path.ele[a]) * t
  }
  return out
}

/** Centred moving average of half-width `radius` samples (window shrinks symmetrically at the ends). */
export function movingAverage(values: ArrayLike<number>, radius: number): Float64Array {
  const n = values.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const r = Math.min(radius, i, n - 1 - i)
    let sum = 0
    for (let j = i - r; j <= i + r; j++) sum += values[j]
    out[i] = sum / (2 * r + 1)
  }
  return out
}

/**
 * Alternating low / high turning points (indices) of a series: an extreme is confirmed once the series has
 * moved back by at least `hysteresis`. The first and last extremes are included. A low takes the last index
 * of a flat bottom, a high the first index of a flat top.
 */
export function turningPoints(values: ArrayLike<number>, hysteresis: number): number[] {
  const n = values.length
  const pivots: number[] = []
  if (n === 0) return pivots
  let trend = 0
  let lo = 0
  let hi = 0
  let candidate = 0
  for (let i = 1; i < n; i++) {
    const v = values[i]
    if (trend === 0) {
      if (v > values[hi]) hi = i
      if (v <= values[lo]) lo = i
      if (values[hi] - values[lo] < hysteresis) continue
      if (hi > lo) {
        pivots.push(lo)
        trend = 1
        candidate = hi
      } else {
        pivots.push(hi)
        trend = -1
        candidate = lo
      }
    } else if (trend > 0) {
      if (v > values[candidate]) candidate = i
      else if (values[candidate] - v >= hysteresis) {
        pivots.push(candidate)
        trend = -1
        candidate = i
      }
    } else if (v <= values[candidate]) candidate = i
    else if (v - values[candidate] >= hysteresis) {
      pivots.push(candidate)
      trend = 1
      candidate = i
    }
  }
  if (trend !== 0) pivots.push(candidate)
  return pivots
}

interface Span {
  start: number
  end: number
}

/** Low → high pairs of the turning points, merged across small dips (indices on the grid). */
function climbSpans(ele: Float64Array, pivots: number[], step: number): Span[] {
  const spans: Span[] = []
  for (let k = 0; k + 1 < pivots.length; k++) {
    const start = pivots[k]
    const end = pivots[k + 1]
    if (ele[end] <= ele[start]) continue
    const previous = spans[spans.length - 1]
    if (previous) {
      const dip = ele[previous.end] - ele[start]
      const gain = ele[previous.end] - ele[previous.start]
      if (
        ele[end] > ele[previous.end] &&
        dip <= MERGE_MAX_DIP_M &&
        dip <= MERGE_MAX_DIP_FRACTION * gain &&
        (start - previous.end) * step <= MERGE_MAX_GAP_M
      ) {
        previous.end = end
        continue
      }
    }
    spans.push({ start, end })
  }
  return spans
}

/** Move the ends of a span inwards while the gradient over `TRIM_WINDOW_M` is below `TRIM_MIN_GRADIENT`. */
function trimSpan(ele: Float64Array, span: Span, step: number): Span {
  const w = Math.max(1, Math.round(TRIM_WINDOW_M / step))
  let { start, end } = span
  while (start + w < end && ele[start + w] - ele[start] < TRIM_MIN_GRADIENT * w * step) start++
  while (end - w > start && ele[end] - ele[end - w] < TRIM_MIN_GRADIENT * w * step) end--
  return { start, end }
}

/** Steepest gradient over `window` samples inside [start, end] (average gradient when shorter). */
function maxGradientIn(ele: Float64Array, start: number, end: number, window: number, step: number): number {
  const w = Math.min(window, end - start)
  let best = -Infinity
  for (let i = start; i + w <= end; i++) best = Math.max(best, (ele[i + w] - ele[i]) / (w * step))
  return best
}

/** Climbs of a track, in order along it; empty when the track has no recorded elevation. */
export function detectClimbs(track: Track): Climb[] {
  const path = buildTrackPath(track)
  const step = RESAMPLE_STEP_M
  const raw = resampleElevation(path, step)
  if (!raw) return []
  const ele = movingAverage(raw, Math.round(SMOOTHING_WINDOW_M / step / 2))
  const pivots = turningPoints(ele, HYSTERESIS_M)
  const gradientWindow = Math.max(1, Math.round(MAX_GRADIENT_WINDOW_M / step))
  const climbs: Climb[] = []
  for (const span of climbSpans(ele, pivots, step)) {
    const { start, end } = trimSpan(ele, span, step)
    const startDistM = Math.min(path.lengthM, start * step)
    const endDistM = Math.min(path.lengthM, end * step)
    const lengthM = endDistM - startDistM
    const gainM = ele[end] - ele[start]
    if (lengthM < MIN_CLIMB_LENGTH_M || gainM < MIN_CLIMB_GAIN_M) continue
    const avgGradient = gainM / lengthM
    if (avgGradient < MIN_CLIMB_GRADIENT) continue
    let topEleM = -Infinity
    for (let i = start; i <= end; i++) topEleM = Math.max(topEleM, raw[i])
    const score = lengthM * avgGradient * 100
    const top = samplePath(path, endDistM)
    climbs.push({
      startDistM,
      endDistM,
      lengthM,
      startEleM: ele[start],
      endEleM: ele[end],
      gainM,
      avgGradient,
      maxGradient: Math.max(avgGradient, maxGradientIn(ele, start, end, gradientWindow, step)),
      score,
      category: climbCategory(score),
      topEleM,
      top: { lon: top.lon, lat: top.lat },
    })
  }
  return climbs
}

const cache = new WeakMap<Track, Climb[]>()

/** `detectClimbs`, cached per track object (tracks are immutable in the store). */
export function climbsOf(track: Track): Climb[] {
  let climbs = cache.get(track)
  if (!climbs) {
    climbs = detectClimbs(track)
    cache.set(track, climbs)
  }
  return climbs
}

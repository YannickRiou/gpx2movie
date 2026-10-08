/**
 * Small numeric helpers shared by the pure modules (flyover, weather…): clamping and binary searches on sorted
 * arrays (cumulative distances, times, film-time tables).
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Index of the last element of the ascending `sorted` that is ≤ `value`; -1 when none (or `value` is NaN). */
export function lastIndexAtOrBelow(sorted: ArrayLike<number>, value: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] <= value) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** Index of the first element of the ascending `sorted` that is ≥ `value`; `sorted.length` when none (or NaN). */
export function firstIndexAtOrAbove(sorted: ArrayLike<number>, value: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid] >= value) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** 0 → 1 with zero first and second derivatives at both ends. */
export function smootherstep(x: number): number {
  const t = clamp(x, 0, 1)
  return t * t * t * (t * (6 * t - 15) + 10)
}

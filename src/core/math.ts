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

/** 53-bit string hash (cyrb53), as a number below 2^53: cache keys and stored file names. */
export function cyrb53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * Flyover path: a track flattened into one polyline indexed by cumulative ground distance, so the
 * playback can map a progress (0..1) to a position at constant ground speed.
 *
 * Pure functions (no DOM, no React, no Three).
 */
import type { Track } from '../core/types'
import { haversineM } from '../geo/ellipsoid'

export interface TrackPath {
  count: number
  lon: Float64Array
  lat: Float64Array
  /** recorded elevation, NaN when the point has none */
  ele: Float64Array
  /** cumulative ground distance at each point (metres), non-decreasing */
  dist: Float64Array
  /** total length (metres) = dist[count - 1]; equals track.stats.distanceM */
  lengthM: number
}

export interface PathSample {
  lon: number
  lat: number
  /** interpolated recorded elevation, undefined when unknown */
  ele?: number
}

/**
 * Concatenate the segments of a track. The jump between two segments adds no distance (same rule as
 * `computeStats`), so the playback crosses a recording gap instantly.
 */
export function buildTrackPath(track: Track): TrackPath {
  let count = 0
  for (const segment of track.segments) count += segment.points.length
  const path: TrackPath = {
    count,
    lon: new Float64Array(count),
    lat: new Float64Array(count),
    ele: new Float64Array(count),
    dist: new Float64Array(count),
    lengthM: 0,
  }
  let i = 0
  let total = 0
  for (const segment of track.segments) {
    const points = segment.points
    for (let k = 0; k < points.length; k++) {
      const p = points[k]
      if (k > 0) total += haversineM(points[k - 1], p)
      path.lon[i] = p.lon
      path.lat[i] = p.lat
      path.ele[i] = p.ele !== undefined && Number.isFinite(p.ele) ? p.ele : Number.NaN
      path.dist[i] = total
      i++
    }
  }
  path.lengthM = total
  return path
}

/** Position at `distanceM` along the path (clamped to [0, lengthM]), linearly interpolated. */
export function samplePath(path: TrackPath, distanceM: number): PathSample {
  const { count, lon, lat, ele, dist } = path
  if (count === 0) throw new RangeError('samplePath : chemin vide')
  const d = Math.min(path.lengthM, Math.max(0, distanceM))

  // last index whose distance is <= d (binary search)
  let lo = 0
  let hi = count - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (dist[mid] <= d) lo = mid
    else hi = mid - 1
  }
  const a = lo
  const b = Math.min(count - 1, a + 1)
  const span = dist[b] - dist[a]
  const t = span > 0 ? (d - dist[a]) / span : 0

  const sample: PathSample = { lon: lon[a] + (lon[b] - lon[a]) * t, lat: lat[a] + (lat[b] - lat[a]) * t }
  const ea = ele[a]
  const eb = ele[b]
  if (!Number.isNaN(ea) && !Number.isNaN(eb)) sample.ele = ea + (eb - ea) * t
  return sample
}

export interface ElevationProfile {
  /** recorded elevation at evenly spaced distances from 0 to lengthM, NaN where unknown */
  ele: Float64Array
  minEle: number
  maxEle: number
}

/** Elevation at `samples` (≥ 2) evenly spaced distances; undefined when the path has no recorded elevation. */
export function elevationProfile(path: TrackPath, samples: number): ElevationProfile | undefined {
  if (path.count === 0) return undefined
  const ele = new Float64Array(samples)
  let minEle = Infinity
  let maxEle = -Infinity
  for (let i = 0; i < samples; i++) {
    const h = samplePath(path, (i / (samples - 1)) * path.lengthM).ele
    ele[i] = h ?? Number.NaN
    if (h === undefined) continue
    minEle = Math.min(minEle, h)
    maxEle = Math.max(maxEle, h)
  }
  return minEle <= maxEle ? { ele, minEle, maxEle } : undefined
}

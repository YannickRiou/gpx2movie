/**
 * Flyover path: a track flattened into one polyline indexed by cumulative ground distance, so the
 * playback can map a progress (0..1) to a position at constant ground speed.
 *
 * Pure functions (no DOM, no React, no Three).
 */
import { lastIndexAtOrBelow } from '../core/math'
import type { LonLat, Track } from '../core/types'
import { haversineM } from '../geo/lonLat'

export interface TrackPath {
  count: number
  lon: Float64Array
  lat: Float64Array
  /** recorded elevation, NaN when the point has none */
  ele: Float64Array
  /** recorded time (ms since epoch), NaN when the point has none */
  time: Float64Array
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
  /** interpolated recorded time (ms since epoch), undefined when unknown */
  time?: number
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
    time: new Float64Array(count),
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
      path.time[i] = p.time !== undefined && Number.isFinite(p.time) ? p.time : Number.NaN
      path.dist[i] = total
      i++
    }
  }
  path.lengthM = total
  return path
}

const paths = new WeakMap<Track, TrackPath>()

/** `buildTrackPath`, cached per track object (tracks are immutable in the store; the path must not be mutated). */
export function trackPathOf(track: Track): TrackPath {
  let path = paths.get(track)
  if (!path) {
    path = buildTrackPath(track)
    paths.set(track, path)
  }
  return path
}

/** Points a, b = a + 1 around `distanceM` (clamped) and the fraction t between them. */
function locate(path: TrackPath, distanceM: number): { d: number; a: number; b: number; t: number } {
  const { count, dist } = path
  if (count === 0) throw new RangeError('samplePath : chemin vide')
  const d = Math.min(path.lengthM, Math.max(0, distanceM))
  const a = Math.max(0, lastIndexAtOrBelow(dist, d))
  const b = Math.min(count - 1, a + 1)
  const span = dist[b] - dist[a]
  const t = span > 0 ? (d - dist[a]) / span : 0
  return { d, a, b, t }
}

/** Position at `distanceM` along the path (clamped to [0, lengthM]), linearly interpolated. */
export function samplePath(path: TrackPath, distanceM: number): PathSample {
  const { lon, lat, ele, time } = path
  const { a, b, t } = locate(path, distanceM)
  const sample: PathSample = { lon: lon[a] + (lon[b] - lon[a]) * t, lat: lat[a] + (lat[b] - lat[a]) * t }
  const ea = ele[a]
  const eb = ele[b]
  if (!Number.isNaN(ea) && !Number.isNaN(eb)) sample.ele = ea + (eb - ea) * t
  const ta = time[a]
  const tb = time[b]
  if (!Number.isNaN(ta) && !Number.isNaN(tb)) sample.time = ta + (tb - ta) * t
  return sample
}

/**
 * Recorded time at `distanceM`, bridging points without time: interpolated by distance between the nearest
 * timed points on each side, or the time of the only side that has one. Undefined when no point has a time.
 * A pause (time passes, distance does not) is crossed instantly, like a recording gap between segments.
 */
export function recordedTimeAt(path: TrackPath, distanceM: number): number | undefined {
  const { count, time, dist } = path
  const { d, a, b, t } = locate(path, distanceM)
  if (!Number.isNaN(time[a]) && !Number.isNaN(time[b])) return time[a] + (time[b] - time[a]) * t
  let before = a
  while (before >= 0 && Number.isNaN(time[before])) before--
  let after = b
  while (after < count && Number.isNaN(time[after])) after++
  if (before < 0) return after < count ? time[after] : undefined
  if (after >= count) return time[before]
  const span = dist[after] - dist[before]
  return span > 0 ? time[before] + (time[after] - time[before]) * ((d - dist[before]) / span) : time[after]
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

/**
 * Point of the path nearest to `at`: its distance along the path and how far `at` is from it (metres). With a
 * recorded instant `timeMs`, the timed point recorded closest to it among those about as near (within 50 m or
 * 1.5 × the nearest distance: an out-and-back passes twice). Undefined for an empty path.
 */
export function nearestOnPath(path: TrackPath, at: LonLat, timeMs?: number): { distanceM: number; offM: number } | undefined {
  const { count, lon, lat, time, dist } = path
  if (count === 0) return undefined
  const off = new Float64Array(count)
  let best = 0
  for (let i = 0; i < count; i++) {
    off[i] = haversineM(at, { lon: lon[i], lat: lat[i] })
    if (off[i] < off[best]) best = i
  }
  if (timeMs !== undefined) {
    const near = Math.max(50, 1.5 * off[best])
    let closest = -1
    for (let i = 0; i < count; i++) {
      if (off[i] > near || Number.isNaN(time[i])) continue
      if (closest < 0 || Math.abs(time[i] - timeMs) < Math.abs(time[closest] - timeMs)) closest = i
    }
    if (closest >= 0) best = closest
  }
  return { distanceM: dist[best], offM: off[best] }
}

/**
 * Distance along the path at which the recorded time reaches `timeMs` (interpolated between timed points; during a
 * pause, where it stopped). Instants up to `toleranceMs` before the first or after the last recorded time give the
 * ends; undefined further out or without time.
 */
export function distanceAtTime(path: TrackPath, timeMs: number, toleranceMs = 0): number | undefined {
  const { count, time, dist } = path
  let previous = -1
  for (let i = 0; i < count; i++) {
    if (Number.isNaN(time[i])) continue
    if (previous < 0 && timeMs < time[i]) return timeMs >= time[i] - toleranceMs ? dist[i] : undefined
    if (time[i] >= timeMs && previous >= 0) {
      const span = time[i] - time[previous]
      return span > 0 ? dist[previous] + (dist[i] - dist[previous]) * ((timeMs - time[previous]) / span) : dist[i]
    }
    if (time[i] === timeMs) return dist[i]
    previous = i
  }
  return previous >= 0 && timeMs <= time[previous] + toleranceMs ? dist[previous] : undefined
}

/**
 * Distance along the path (metres) of the point of its on-screen polyline nearest to the pointer (`px`, `py`), within
 * `maxPx`; undefined when none (click on the track in the 3D view). `screen` holds x, y per sample in pixels (NaN for a
 * sample behind the camera), `distM` the distance of each sample along the path. The segments between two visible
 * samples are tested, so a click between two samples gives an interpolated distance.
 */
export function pickProjectedPath(screen: ArrayLike<number>, distM: ArrayLike<number>, px: number, py: number, maxPx: number): number | undefined {
  const visible = (i: number) => i < distM.length && !Number.isNaN(screen[2 * i]) && !Number.isNaN(screen[2 * i + 1])
  let best: number | undefined
  let bestD2 = maxPx * maxPx
  for (let i = 0; i < distM.length; i++) {
    if (!visible(i)) continue
    const ax = screen[2 * i]
    const ay = screen[2 * i + 1]
    let t = 0
    let bx = ax
    let by = ay
    if (visible(i + 1)) {
      bx = screen[2 * i + 2]
      by = screen[2 * i + 3]
      const len2 = (bx - ax) ** 2 + (by - ay) ** 2
      t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2)) : 0
    }
    const d2 = (ax + t * (bx - ax) - px) ** 2 + (ay + t * (by - ay) - py) ** 2
    if (d2 <= bestD2) {
      bestD2 = d2
      best = t > 0 ? distM[i] + t * (distM[i + 1] - distM[i]) : distM[i]
    }
  }
  return best
}

/**
 * Values shown by the film overlay at a flyover progress: distance covered, altitude, cumulative D+,
 * elapsed recorded time, speed, heart rate, and the whole-track figures of the closing card.
 *
 * `prepareOverlayTrack` does the per-track work once (path, cumulative ascent, smoothed speed and heart
 * rate per point); `overlayFrameAt` is then a cheap pure function of the progress, so the export can
 * compute any frame on its own. Pure functions (no DOM, no React, no Three).
 */
import type { Track } from '../core/types'
import { buildTrackPath, elevationProfile, recordedTimeAt, samplePath } from '../flyover/path'
import type { ElevationProfile, TrackPath } from '../flyover/path'
import { metricValues } from '../flyover/trackColor'
import { ELEVATION_HYSTERESIS_M, smoothElevations } from '../import/stats'

/** Samples of the overlay elevation profile over the track. */
export const OVERLAY_PROFILE_SAMPLES = 240

export interface OverlayTrackStats {
  distanceM: number
  /** undefined when the track has no elevation */
  ascentM?: number
  maxEleM?: number
  /** elapsed recorded time, start to end (seconds) */
  durationS?: number
  /** highest smoothed speed (km/h) */
  maxSpeedKmh?: number
  /** recorded time of the start (ms since epoch) */
  startTime?: number
}

export interface OverlayTrack {
  name: string
  path: TrackPath
  /** cumulative D+ at each path point (metres); NaN everywhere when the track has no elevation */
  ascent: Float64Array
  /** smoothed speed at each path point (km/h), NaN when unknown */
  speed: Float64Array
  /** heart rate averaged over a few seconds at each path point (bpm), NaN when unknown */
  heartRate: Float64Array
  profile?: ElevationProfile
  stats: OverlayTrackStats
}

/** Everything the overlay shows at one progress. */
export interface OverlayFrame {
  /** 0 = start of the flyover, 1 = end */
  progress: number
  track: OverlayTrack
  distanceM: number
  ele?: number
  ascentM?: number
  elapsedS?: number
  speedKmh?: number
  heartRate?: number
}

/**
 * Cumulative ascent at each point of the flattened track, with the rule of `computeStats` (moving average,
 * then a climb only counts once it exceeds the hysteresis since the last accepted elevation, per segment):
 * the last value equals `track.stats.ascentM`. Points without elevation keep the running total.
 */
export function cumulativeAscent(track: Track): Float64Array {
  const out = new Float64Array(track.segments.reduce((n, s) => n + s.points.length, 0))
  let total = 0
  let offset = 0
  for (const segment of track.segments) {
    const points = segment.points
    const indices: number[] = []
    const elevations: number[] = []
    points.forEach((p, i) => {
      if (p.ele !== undefined && Number.isFinite(p.ele)) {
        indices.push(i)
        elevations.push(p.ele)
      }
    })
    const smoothed = smoothElevations(elevations)
    let reference = smoothed[0]
    let k = 0
    for (let i = 0; i < points.length; i++) {
      if (k < indices.length && indices[k] === i) {
        const delta = smoothed[k] - reference
        if (Math.abs(delta) > ELEVATION_HYSTERESIS_M) {
          if (delta > 0) total += delta
          reference = smoothed[k]
        }
        k++
      }
      out[offset + i] = total
    }
    offset += points.length
  }
  return out
}

function concat(parts: readonly Float64Array[], count: number): Float64Array {
  const out = new Float64Array(count)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function maxOf(values: Float64Array): number | undefined {
  let max = -Infinity
  for (const v of values) if (v > max) max = v
  return max > -Infinity ? max : undefined
}

export function prepareOverlayTrack(track: Track): OverlayTrack {
  const path = buildTrackPath(track)
  const hasEle = track.stats.maxEle !== undefined
  const speed = concat(
    track.segments.map((s) => metricValues(s.points, 'speed')),
    path.count,
  )
  const heartRate = concat(
    track.segments.map((s) => metricValues(s.points, 'heartRate')),
    path.count,
  )
  const ascent = hasEle ? cumulativeAscent(track) : new Float64Array(path.count).fill(Number.NaN)
  return {
    name: track.name,
    path,
    ascent,
    speed,
    heartRate,
    profile: path.count > 0 ? elevationProfile(path, OVERLAY_PROFILE_SAMPLES) : undefined,
    stats: {
      distanceM: path.lengthM,
      ascentM: hasEle ? track.stats.ascentM : undefined,
      maxEleM: track.stats.maxEle,
      durationS: track.stats.durationS,
      maxSpeedKmh: maxOf(speed),
      startTime: track.stats.startTime,
    },
  }
}

/** Last index whose distance is <= d (binary search), the next one and the fraction between them. */
function locate(dist: Float64Array, d: number): { a: number; b: number; t: number } {
  let lo = 0
  let hi = dist.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (dist[mid] <= d) lo = mid
    else hi = mid - 1
  }
  const b = Math.min(dist.length - 1, lo + 1)
  const span = dist[b] - dist[lo]
  return { a: lo, b, t: span > 0 ? (d - dist[lo]) / span : 0 }
}

/** Linear interpolation; the known side when the other one is NaN; undefined when both are. */
function lerpKnown(values: Float64Array, a: number, b: number, t: number): number | undefined {
  const va = values[a]
  const vb = values[b]
  if (Number.isNaN(va)) return Number.isNaN(vb) ? undefined : vb
  if (Number.isNaN(vb)) return va
  return va + (vb - va) * t
}

/** Overlay values at `progress` (clamped to [0, 1]) of the flyover, which runs at constant ground speed. */
export function overlayFrameAt(data: OverlayTrack, progress: number): OverlayFrame {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0))
  const { path } = data
  const distanceM = p * path.lengthM
  const frame: OverlayFrame = { progress: p, track: data, distanceM }
  if (path.count === 0) return frame

  const { a, b, t } = locate(path.dist, distanceM)
  frame.ele = samplePath(path, distanceM).ele
  frame.ascentM = lerpKnown(data.ascent, a, b, t)
  frame.speedKmh = lerpKnown(data.speed, a, b, t)
  frame.heartRate = lerpKnown(data.heartRate, a, b, t)
  if (data.stats.startTime !== undefined) {
    const start = recordedTimeAt(path, 0)
    const now = recordedTimeAt(path, distanceM)
    if (start !== undefined && now !== undefined) frame.elapsedS = Math.max(0, (now - start) / 1000)
  }
  return frame
}

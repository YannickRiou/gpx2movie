/**
 * Track smoothing (`settings.trackStyle.smoothingM`): GPS jitter averaged out of the positions, for the drawn line
 * (TrackLines) and the path the marker and the camera follow (FlyoverRig, export). Pure functions.
 */
import type { Track, TrackPoint, TrackSegment } from '../core/types'
import { haversineM } from '../geo/lonLat'
import { buildTrackPath, trackPathOf, type TrackPath } from './path'

/**
 * Moving average of the positions (lon, lat and ele when present) over a window of `windowM` metres of
 * recorded distance centred on each point; the first and last points are kept exactly; every other field
 * (time, hr, cad, power, temp) is kept from the original point. windowM <= 0 or fewer than 3 points → the
 * same array instance is returned. Weights: triangular (tent) over the window, so the result is calm. Near the
 * ends the window shrinks so that it stays centred on the point (no drift along the line, continuous ramp
 * towards the untouched end points). The window bounds only move forward (two pointers): O(n · k) with k the
 * points inside one window.
 */
export function smoothPoints(points: readonly TrackPoint[], windowM: number): TrackPoint[] {
  const n = points.length
  if (windowM <= 0 || n < 3) return points as TrackPoint[]

  // cumulative recorded distance (metres) along the polyline
  const dist = new Float64Array(n)
  for (let i = 1; i < n; i++) dist[i] = dist[i - 1] + haversineM(points[i - 1], points[i])

  const half = windowM / 2
  const out: TrackPoint[] = new Array(n)
  out[0] = { ...points[0] }
  out[n - 1] = { ...points[n - 1] }

  let lo = 0
  let hi = 0
  for (let i = 1; i < n - 1; i++) {
    const p = points[i]
    const d = dist[i]
    const h = Math.min(half, d, dist[n - 1] - d)
    if (h <= 0) {
      out[i] = { ...p }
      continue
    }
    while (dist[lo] < d - h) lo++
    while (hi + 1 < n && dist[hi + 1] <= d + h) hi++

    let wSum = 0
    let lon = 0
    let lat = 0
    let wEle = 0
    let ele = 0
    for (let j = lo; j <= hi; j++) {
      const w = 1 - Math.abs(dist[j] - d) / h
      // the tolerance keeps points exactly on the window edge out despite rounding of the distances
      if (w <= 1e-9) continue
      const q = points[j]
      wSum += w
      lon += w * q.lon
      lat += w * q.lat
      if (q.ele !== undefined) {
        wEle += w
        ele += w * q.ele
      }
    }

    const next: TrackPoint = { ...p, lon: lon / wSum, lat: lat / wSum }
    if (p.ele !== undefined) next.ele = ele / wEle
    out[i] = next
  }
  return out
}

/** The track with every segment smoothed (same id, name, stats, bounds, colour); the same track when windowM <= 0. */
export function smoothTrack(track: Track, windowM: number): Track {
  if (windowM <= 0) return track
  const segments: TrackSegment[] = track.segments.map((s) => ({ ...s, points: smoothPoints(s.points, windowM) }))
  return { ...track, segments }
}

/**
 * Path followed by the marker and the camera: smoothed positions, but the recorded distances (and times), so the
 * progress, the film stops, the climbs and the draw-on cut keep their scale and the marker stays on the smoothed
 * line. `trackPathOf(track)` itself when windowM <= 0. Not cached: the callers keep it (useMemo, one export).
 */
export function smoothedTrackPath(track: Track, windowM: number): TrackPath {
  const recorded = trackPathOf(track)
  if (windowM <= 0) return recorded
  return { ...buildTrackPath(smoothTrack(track, windowM)), dist: recorded.dist, lengthM: recorded.lengthM }
}

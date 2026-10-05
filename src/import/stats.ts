/**
 * Track statistics, bounds, densification and track assembly.
 * Pure functions (no DOM, no React) so everything is unit-testable under jsdom.
 */
import type { LonLatBounds, Track, TrackPoint, TrackSegment, TrackStats } from '../core/types'
import { haversineM } from '../geo/ellipsoid'

/** Width (in points) of the centred moving average applied to elevations before counting D+/D-. */
export const ELEVATION_SMOOTHING_WINDOW = 5
/** Elevation move (metres) below which a change is treated as GPS noise and not accumulated. */
export const ELEVATION_HYSTERESIS_M = 3

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Centred moving average. Near the ends the window shrinks symmetrically
 * (radius = min(i, n-1-i, floor(window/2))) so a monotonic ramp keeps its first and last values.
 */
export function smoothElevations(values: readonly number[], window = ELEVATION_SMOOTHING_WINDOW): number[] {
  const n = values.length
  const maxRadius = Math.max(0, Math.floor(window / 2))
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const radius = Math.min(maxRadius, i, n - 1 - i)
    let sum = 0
    for (let j = i - radius; j <= i + radius; j++) sum += values[j]
    out[i] = sum / (2 * radius + 1)
  }
  return out
}

/**
 * Cumulative ascent / descent of an elevation series.
 * Elevations are smoothed first, then a change is only accumulated when the move since the
 * last accepted elevation exceeds `hysteresisM`, which keeps metre-level GPS jitter out of D+.
 */
export function computeElevationGain(
  elevations: readonly number[],
  options: { window?: number; hysteresisM?: number } = {},
): { ascentM: number; descentM: number } {
  const hysteresisM = options.hysteresisM ?? ELEVATION_HYSTERESIS_M
  const smoothed = smoothElevations(elevations, options.window ?? ELEVATION_SMOOTHING_WINDOW)
  let ascentM = 0
  let descentM = 0
  if (smoothed.length === 0) return { ascentM, descentM }
  let reference = smoothed[0]
  for (let i = 1; i < smoothed.length; i++) {
    const delta = smoothed[i] - reference
    if (Math.abs(delta) <= hysteresisM) continue
    if (delta > 0) ascentM += delta
    else descentM -= delta
    reference = smoothed[i]
  }
  return { ascentM, descentM }
}

export function computeStats(segments: readonly TrackSegment[]): TrackStats {
  let distanceM = 0
  let ascentM = 0
  let descentM = 0
  let pointCount = 0
  let minEle: number | undefined
  let maxEle: number | undefined
  let startTime: number | undefined
  let endTime: number | undefined

  for (const segment of segments) {
    const points = segment.points
    pointCount += points.length
    const elevations: number[] = []
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      if (i > 0) distanceM += haversineM(points[i - 1], p)
      if (p.ele !== undefined && Number.isFinite(p.ele)) {
        elevations.push(p.ele)
        minEle = minEle === undefined ? p.ele : Math.min(minEle, p.ele)
        maxEle = maxEle === undefined ? p.ele : Math.max(maxEle, p.ele)
      }
      if (p.time !== undefined && Number.isFinite(p.time)) {
        startTime = startTime === undefined ? p.time : Math.min(startTime, p.time)
        endTime = endTime === undefined ? p.time : Math.max(endTime, p.time)
      }
    }
    const gain = computeElevationGain(elevations)
    ascentM += gain.ascentM
    descentM += gain.descentM
  }

  const durationS = startTime !== undefined && endTime !== undefined ? (endTime - startTime) / 1000 : undefined

  return { distanceM, ascentM, descentM, durationS, minEle, maxEle, startTime, endTime, pointCount }
}

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** Axis-aligned lon/lat box of every point. Throws when there is no point at all. */
export function computeBounds(segments: readonly TrackSegment[]): LonLatBounds {
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const segment of segments) {
    for (const p of segment.points) {
      if (p.lon < west) west = p.lon
      if (p.lon > east) east = p.lon
      if (p.lat < south) south = p.lat
      if (p.lat > north) north = p.lat
    }
  }
  if (!Number.isFinite(west)) throw new Error('Impossible de calculer les bornes : aucun point')
  return { west, south, east, north }
}

// ---------------------------------------------------------------------------
// Densification
// ---------------------------------------------------------------------------

const INTERPOLATED_FIELDS = ['ele', 'time', 'hr', 'cad', 'power', 'temp'] as const

function lerpPoint(a: TrackPoint, b: TrackPoint, t: number): TrackPoint {
  const point: TrackPoint = { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t }
  for (const field of INTERPOLATED_FIELDS) {
    const va = a[field]
    const vb = b[field]
    if (va !== undefined && vb !== undefined) point[field] = va + (vb - va) * t
  }
  return point
}

/**
 * Insert linearly interpolated points so that no consecutive step exceeds `maxStepM`.
 * Original points are kept (same object references), in order.
 */
export function densify(points: readonly TrackPoint[], maxStepM: number): TrackPoint[] {
  if (!(maxStepM > 0)) throw new RangeError('densify : maxStepM doit être strictement positif')
  if (points.length < 2) return points.slice()
  const out: TrackPoint[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const steps = Math.ceil(haversineM(a, b) / maxStepM)
    for (let k = 1; k < steps; k++) out.push(lerpPoint(a, b, k / steps))
    out.push(b)
  }
  return out
}

// ---------------------------------------------------------------------------
// Track assembly (shared by the GPX and FIT parsers)
// ---------------------------------------------------------------------------

export interface TrackInit {
  name: string
  source: Track['source']
  segments: TrackSegment[]
  activityType?: string
}

/** Build a complete Track (id, stats, bounds). Colour is left empty: `importFile` assigns it. */
export function buildTrack(init: TrackInit): Track {
  const track: Track = {
    id: crypto.randomUUID(),
    name: init.name,
    source: init.source,
    segments: init.segments,
    stats: computeStats(init.segments),
    bounds: computeBounds(init.segments),
    color: '',
  }
  if (init.activityType) track.activityType = init.activityType
  return track
}

/** "dossier/trace.GPX" -> "trace"; names without an extension are returned unchanged. */
export function stripExtension(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base).trim()
}

/**
 * Track colouring by a recorded quantity: per-point values (speed, slope, elevation, sensors), a robust
 * value range shared by every track, and a perceptually uniform sequential colormap.
 *
 * Pure functions (no DOM, no React, no Three). Colours are sRGB components in [0, 1]; the scene converts
 * them to the linear working space.
 */
import type { Track, TrackPoint } from '../core/types'
import { haversineM } from '../geo/lonLat'

export const TRACK_COLOR_MODES = [
  'none',
  'speed',
  'slope',
  'elevation',
  'heartRate',
  'cadence',
  'power',
  'temperature',
] as const
/** 'none' = the track's own colour. */
export type TrackColorBy = (typeof TRACK_COLOR_MODES)[number]
export type TrackMetric = Exclude<TrackColorBy, 'none'>

/** Colour stops evenly spaced from the low to the high end of the range. */
export type Colormap = readonly string[]

/** matplotlib viridis sampled every 0.1. */
export const VIRIDIS: Colormap = [
  '#440154', '#482475', '#414487', '#355f8d', '#2a788e', '#21918c',
  '#22a884', '#44bf70', '#7ad151', '#bddf26', '#fde725',
]
/** matplotlib magma sampled every 0.1 from 0.2: its near-black start would vanish on dark imagery. */
export const MAGMA: Colormap = [
  '#3b0f70', '#641a80', '#8c2981', '#b73779', '#de4968',
  '#f7705c', '#fe9f6d', '#fecf92', '#fcfdbf',
]

/**
 * Colour of the points without a value (charte « ink-soft »): a neutral grey that no colormap above contains.
 * Gaps are shown, not interpolated: bridging a sensor dropout or a point without time would invent data.
 */
export const MISSING_COLOR = '#55626b'

export interface MetricInfo {
  /** French label (select option, legend title) */
  label: string
  unit: string
  fractionDigits: number
  colormap: Colormap
}

export const TRACK_METRICS: Record<TrackMetric, MetricInfo> = {
  speed: { label: 'Vitesse', unit: 'km/h', fractionDigits: 1, colormap: VIRIDIS },
  slope: { label: 'Pente', unit: '%', fractionDigits: 0, colormap: VIRIDIS },
  elevation: { label: 'Altitude', unit: 'm', fractionDigits: 0, colormap: VIRIDIS },
  heartRate: { label: 'Fréquence cardiaque', unit: 'bpm', fractionDigits: 0, colormap: MAGMA },
  cadence: { label: 'Cadence', unit: 'tr/min', fractionDigits: 0, colormap: VIRIDIS },
  power: { label: 'Puissance', unit: 'W', fractionDigits: 0, colormap: MAGMA },
  temperature: { label: 'Température', unit: '°C', fractionDigits: 0, colormap: MAGMA },
}

/**
 * Speed window: centred, it grows until each half covers at least SPEED_HALF_WINDOW_M of path and
 * SPEED_HALF_WINDOW_S of time (the distance bound keeps GPS jitter at walking pace out), but never beyond
 * SPEED_MAX_HALF_WINDOW_S (bounds the cost and keeps a long stop local).
 */
export const SPEED_HALF_WINDOW_M = 25
export const SPEED_HALF_WINDOW_S = 15
export const SPEED_MAX_HALF_WINDOW_S = 300
/** Slope: elevation change over a centred window of ±SLOPE_HALF_WINDOW_M (elevation noise averages out). */
export const SLOPE_HALF_WINDOW_M = 50
/** Shortest run a slope is computed over (metres); below it the slope is unknown. */
export const SLOPE_MIN_RUN_M = 20
/** Sensor channels (heart rate, cadence, power, temperature) are averaged over ±this many seconds. */
export const SENSOR_HALF_WINDOW_S = 5
/** Percentiles bounding the colour range: outliers saturate instead of squeezing the scale. */
export const RANGE_LOW_PERCENTILE = 0.02
export const RANGE_HIGH_PERCENTILE = 0.98

const SENSOR_FIELDS = { heartRate: 'hr', cadence: 'cad', power: 'power', temperature: 'temp' } as const

function finiteOrNaN(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : Number.NaN
}

function cumulativeDistances(points: readonly TrackPoint[]): Float64Array {
  const d = new Float64Array(points.length)
  for (let i = 1; i < points.length; i++) d[i] = d[i - 1] + haversineM(points[i - 1], points[i])
  return d
}

function speedKmh(points: readonly TrackPoint[]): Float64Array {
  const n = points.length
  const out = new Float64Array(n).fill(Number.NaN)
  const d = cumulativeDistances(points)
  const t = Float64Array.from(points, (p) => finiteOrNaN(p.time) / 1000)
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(t[i])) continue
    let a = i
    while (
      a > 0 &&
      !Number.isNaN(t[a - 1]) &&
      t[i] - t[a - 1] <= SPEED_MAX_HALF_WINDOW_S &&
      (d[i] - d[a] < SPEED_HALF_WINDOW_M || t[i] - t[a] < SPEED_HALF_WINDOW_S)
    )
      a--
    let b = i
    while (
      b < n - 1 &&
      !Number.isNaN(t[b + 1]) &&
      t[b + 1] - t[i] <= SPEED_MAX_HALF_WINDOW_S &&
      (d[b] - d[i] < SPEED_HALF_WINDOW_M || t[b] - t[i] < SPEED_HALF_WINDOW_S)
    )
      b++
    const dt = t[b] - t[a]
    if (dt > 0) out[i] = ((d[b] - d[a]) / dt) * 3.6
  }
  return out
}

function slopePercent(points: readonly TrackPoint[]): Float64Array {
  const n = points.length
  const out = new Float64Array(n).fill(Number.NaN)
  const d = cumulativeDistances(points)
  const e = Float64Array.from(points, (p) => finiteOrNaN(p.ele))
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(e[i])) continue
    let a = i
    while (a > 0 && !Number.isNaN(e[a - 1]) && d[i] - d[a] < SLOPE_HALF_WINDOW_M) a--
    let b = i
    while (b < n - 1 && !Number.isNaN(e[b + 1]) && d[b] - d[i] < SLOPE_HALF_WINDOW_M) b++
    const run = d[b] - d[a]
    if (run >= SLOPE_MIN_RUN_M) out[i] = ((e[b] - e[a]) / run) * 100
  }
  return out
}

/** Mean of the known values within ±SENSOR_HALF_WINDOW_S; a point without value stays unknown. */
function sensorValues(
  points: readonly TrackPoint[],
  field: (typeof SENSOR_FIELDS)[keyof typeof SENSOR_FIELDS],
): Float64Array {
  const n = points.length
  const raw = Float64Array.from(points, (p) => finiteOrNaN(p[field]))
  const t = Float64Array.from(points, (p) => finiteOrNaN(p.time) / 1000)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = raw[i]
    if (Number.isNaN(raw[i]) || Number.isNaN(t[i])) continue
    let sum = raw[i]
    let count = 1
    for (let j = i - 1; j >= 0 && t[i] - t[j] <= SENSOR_HALF_WINDOW_S; j--) {
      if (!Number.isNaN(raw[j])) {
        sum += raw[j]
        count++
      }
    }
    for (let j = i + 1; j < n && t[j] - t[i] <= SENSOR_HALF_WINDOW_S; j++) {
      if (!Number.isNaN(raw[j])) {
        sum += raw[j]
        count++
      }
    }
    out[i] = sum / count
  }
  return out
}

/** Value of `metric` at each point of one segment, in display units (see TRACK_METRICS); NaN when unknown. */
export function metricValues(points: readonly TrackPoint[], metric: TrackMetric): Float64Array {
  switch (metric) {
    case 'speed':
      return speedKmh(points)
    case 'slope':
      return slopePercent(points)
    case 'elevation':
      return Float64Array.from(points, (p) => finiteOrNaN(p.ele))
    default:
      return sensorValues(points, SENSOR_FIELDS[metric])
  }
}

/** Per-segment values of a whole track (same order as track.segments). */
export function trackMetricValues(track: Track, metric: TrackMetric): Float64Array[] {
  return track.segments.map((segment) => metricValues(segment.points, metric))
}

/** Whether the track records what `metric` needs (speed and slope need two points with time / elevation). */
export function hasMetric(track: Track, metric: TrackMetric): boolean {
  const needed = metric === 'speed' || metric === 'slope' ? 2 : 1
  let count = 0
  for (const segment of track.segments) {
    for (const p of segment.points) {
      const value =
        metric === 'speed' ? p.time : metric === 'slope' || metric === 'elevation' ? p.ele : p[SENSOR_FIELDS[metric]]
      if (value !== undefined && Number.isFinite(value) && ++count >= needed) return true
    }
  }
  return false
}

export interface ValueRange {
  min: number
  max: number
}

/** [low, high] percentiles of every known value (nearest rank); null when there is none. */
export function robustRange(
  series: Iterable<ArrayLike<number>>,
  low = RANGE_LOW_PERCENTILE,
  high = RANGE_HIGH_PERCENTILE,
): ValueRange | null {
  const known: number[] = []
  for (const values of series) {
    for (let i = 0; i < values.length; i++) if (!Number.isNaN(values[i])) known.push(values[i])
  }
  if (known.length === 0) return null
  const sorted = Float64Array.from(known).sort()
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]
  return { min: at(low), max: at(high) }
}

/**
 * Values of the original points carried over to their densified copy (see `densify`, which keeps the
 * original points as the same objects, in order): inserted points are linearly interpolated, and stay
 * unknown when either neighbour is.
 */
export function resampleValues(
  points: readonly TrackPoint[],
  values: ArrayLike<number>,
  densified: readonly TrackPoint[],
): Float64Array {
  const out = new Float64Array(densified.length).fill(Number.NaN)
  if (points.length === 0) return out
  out[0] = values[0]
  let k = 0
  for (let i = 1; i < points.length; i++) {
    let j = k + 1
    while (j < densified.length && densified[j] !== points[i]) j++
    if (j === densified.length) break
    const steps = j - k
    for (let s = 1; s < steps; s++) out[k + s] = values[i - 1] + (values[i] - values[i - 1]) * (s / steps)
    out[j] = values[i]
    k = j
  }
  return out
}

function hexToRgb(hex: string, out: Float32Array | number[], offset: number): void {
  const n = Number.parseInt(hex.slice(1), 16)
  out[offset] = ((n >> 16) & 255) / 255
  out[offset + 1] = ((n >> 8) & 255) / 255
  out[offset + 2] = (n & 255) / 255
}

/**
 * sRGB colour (rgb per value) of each value: position in `range` (clamped; the middle when the range is
 * empty) mapped through `colormap`, MISSING_COLOR for unknown values.
 */
export function colorizeValues(
  values: ArrayLike<number>,
  range: ValueRange,
  colormap: Colormap,
  out = new Float32Array(values.length * 3),
): Float32Array {
  const stops = new Float32Array(colormap.length * 3)
  colormap.forEach((hex, i) => hexToRgb(hex, stops, i * 3))
  const missing = [0, 0, 0]
  hexToRgb(MISSING_COLOR, missing, 0)
  const span = range.max - range.min
  const last = colormap.length - 1
  for (let i = 0; i < values.length; i++) {
    const o = i * 3
    const v = values[i]
    if (Number.isNaN(v)) {
      out[o] = missing[0]
      out[o + 1] = missing[1]
      out[o + 2] = missing[2]
      continue
    }
    const t = span > 0 ? Math.min(1, Math.max(0, (v - range.min) / span)) : 0.5
    const x = t * last
    const a = Math.min(Math.floor(x), last - 1)
    const f = x - a
    for (let c = 0; c < 3; c++) out[o + c] = stops[a * 3 + c] + (stops[(a + 1) * 3 + c] - stops[a * 3 + c]) * f
  }
  return out
}

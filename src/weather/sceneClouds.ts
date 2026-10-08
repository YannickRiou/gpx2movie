/**
 * Volumetric clouds of the scene (`@takram/three-clouds`): the setting, the cloud cover per layer (weather of the
 * outing or manual), the parameters of the three cloud layers and the drift of the clouds with the wind.
 *
 * Everything is a pure function of (setting, conditions, film time): the video export renders the same clouds for
 * the same frame. The wind is the one at the start of the outing, constant for the film, so the drift is a
 * plain product (wind × film time), never an accumulation over frames.
 *
 * Pure functions (no DOM, no React, no Three).
 */
import { clamp } from '../core/math'
import { weatherAt, type WeatherSeries } from './series'
import type { SceneConditions } from './sceneWeather'

export const CLOUD_MODES = ['meteo', 'manuel', 'aucun'] as const
export type CloudMode = (typeof CLOUD_MODES)[number]

/** Quality of the exported frames (the preview always uses the cheapest one). */
export const CLOUD_QUALITIES = ['low', 'medium', 'high'] as const
export type CloudQuality = (typeof CLOUD_QUALITIES)[number]

/** The user setting (`settings.clouds`, atmosphere only). */
export interface CloudSettings {
  /** 'meteo': cover of the outing (Open-Meteo, low / mid / high); 'manuel': `coverage`; 'aucun': no clouds */
  mode: CloudMode
  /** manual cover of the low layer, 0..1 (the mid and high layers follow at 60 % and 40 %) */
  coverage: number
  /** base of the low layer above the lowest point of the first track (metres) */
  altitudeM: number
  /** quality of the exported frames */
  quality: CloudQuality
}

export const DEFAULT_CLOUDS: CloudSettings = { mode: 'meteo', coverage: 0.4, altitudeM: 1200, quality: 'medium' }

export const CLOUD_ALTITUDE_RANGE = { min: 200, max: 4000, step: 100 } as const

export function isValidClouds(v: CloudSettings): boolean {
  return (
    (CLOUD_MODES as readonly string[]).includes(v.mode) &&
    (CLOUD_QUALITIES as readonly string[]).includes(v.quality) &&
    v.coverage >= 0 &&
    v.coverage <= 1 &&
    v.altitudeM >= CLOUD_ALTITUDE_RANGE.min &&
    v.altitudeM <= CLOUD_ALTITUDE_RANGE.max
  )
}

/** Cloud cover of the three layers, fractions in [0, 1]. */
export interface CloudCovers {
  low: number
  mid: number
  high: number
}

/** Below this cover a layer is not rendered (and no clouds at all below it everywhere). */
export const MIN_CLOUD_COVER = 0.02
/** Manual mode: the mid and high layers relative to the low one. */
const MANUAL_MID = 0.6
const MANUAL_HIGH = 0.4

/**
 * Cover of each layer: null for 'aucun', or in 'meteo' without conditions (no weather loaded) or without any
 * cloud value. A missing layer counts as the total cover.
 */
export function cloudCoversAt(settings: CloudSettings, conditions: SceneConditions | undefined): CloudCovers | null {
  if (settings.mode === 'aucun') return null
  if (settings.mode === 'manuel') {
    const c = clamp(settings.coverage, 0, 1)
    return { low: c, mid: MANUAL_MID * c, high: MANUAL_HIGH * c }
  }
  if (!conditions) return null
  const total = conditions.cloudCover
  const layer = (percent: number) => (Number.isNaN(percent) ? total : percent)
  const covers = [layer(conditions.cloudCoverLow), layer(conditions.cloudCoverMid), layer(conditions.cloudCoverHigh)]
  if (covers.every((c) => Number.isNaN(c))) return null
  const [low, mid, high] = covers.map((c) => (Number.isNaN(c) ? 0 : clamp(c / 100, 0, 1)))
  return { low, mid, high }
}

/** One cloud layer of the scene (`CloudLayer` of three-clouds); heightM 0 = layer off. */
export interface CloudLayerParams {
  /** base above sea level, terrain exaggeration applied (metres); CloudsLayer adds the geoid undulation */
  altitudeM: number
  heightM: number
  densityScale: number
  /** local weather^exponent: > 1 thins the layer out relative to the dominant one */
  weatherExponent: number
}

export interface SceneClouds {
  /** global `coverage` of three-clouds, [0, 0.55] */
  coverage: number
  /** low (channel r), mid (g), high (b) */
  layers: [CloudLayerParams, CloudLayerParams, CloudLayerParams]
}

export interface CloudGeometry {
  /** lowest recorded elevation of the first track (metres), the ground the low clouds stand above */
  groundM: number
  /** `CloudSettings.altitudeM` */
  altitudeM: number
  exaggeration: number
}

/** Layer thickness and density, low / mid / high (three-clouds defaults for cumulus, a thinner mid layer, cirrus). */
const LAYER_HEIGHTS_M = [900, 1000, 500] as const
const DENSITY = [0.2, 0.12, 0.003] as const
/** Mid layer base above the low one; cirrus base at max(HIGH_MIN_ALTITUDE_M, ground + HIGH_ABOVE_GROUND_M) (metres). */
const MID_GAP_M = 2000
const HIGH_MIN_ALTITUDE_M = 7000
const HIGH_ABOVE_GROUND_M = 5500
const MAX_EXPONENT = 8
/** Coverage of three-clouds above which every texel is cloudy (default coverage filter width 0.6). */
const FULL_COVERAGE = 0.4
const MAX_COVERAGE = 0.55

/**
 * `coverage` of three-clouds giving a cloudy fraction 0, 0.1, …, 1 of the sky, per channel of its weather texture
 * (r: low, g: mid, b: high), measured on `local_weather.png` of @takram/three-clouds 0.7.6. A texel w is cloudy at
 * the middle of a layer when w > 1 − 2.5·coverage, so coverage = (1 − Q(1 − f)) / 2.5 with Q the quantiles of the
 * channel; beyond its share of non-zero texels (74 % r, 58 % g), coverage goes from 0.4 to 0.55 (zeros cloudy too).
 */
const COVERAGE_FOR_FRACTION: readonly (readonly number[])[] = [
  [0, 0.129, 0.187, 0.232, 0.273, 0.31, 0.347, 0.384, 0.434, 0.492, 0.55],
  [0, 0.191, 0.267, 0.32, 0.359, 0.386, 0.408, 0.444, 0.479, 0.515, 0.55],
  [0, 0.091, 0.127, 0.154, 0.179, 0.201, 0.223, 0.246, 0.273, 0.308, 0.4],
]

/** Coverage for a cloudy fraction `f` of layer `i` (linear between the measured tenths). */
function coverageFor(i: number, f: number): number {
  const table = COVERAGE_FOR_FRACTION[i]
  const x = clamp(f, 0, 1) * 10
  const k = Math.min(9, Math.floor(x))
  return table[k] + (table[k + 1] - table[k]) * (x - k)
}

/**
 * Parameters of the three layers for `covers`, null when no layer reaches MIN_CLOUD_COVER.
 *
 * three-clouds has a single `coverage` C: the layer that needs the most sets it (COVERAGE_FOR_FRACTION). A layer
 * needing less, C_i, is thinned by its exponent: w^e > t ⇔ w > t^(1/e) with t = 1 − 2.5·C, so e = ln t / ln t_i
 * (t_i = 1 − 2.5·C_i, e ≥ 1, ≤ 8) keeps its own cloudy fraction. Past C = 0.4 (t ≤ 0, near overcast) exponents no
 * longer thin: the density of the other layers is scaled by C_i / C instead. Altitudes: low base `altitudeM` above
 * the ground, mid 2 km higher, cirrus at max(7 km, ground + 5.5 km); all × exaggeration like the relief
 * (thicknesses unchanged).
 */
export function sceneCloudsFrom(covers: CloudCovers | null, geometry: CloudGeometry): SceneClouds | null {
  if (!covers) return null
  const c = [covers.low, covers.mid, covers.high].map((v) => (Number.isFinite(v) ? clamp(v, 0, 1) : 0))
  if (Math.max(...c) < MIN_CLOUD_COVER) return null
  const k = Number.isFinite(geometry.exaggeration) && geometry.exaggeration > 0 ? geometry.exaggeration : 1
  const bases = layerBasesM(geometry)
  const needed = c.map((cover, i) => (cover < MIN_CLOUD_COVER ? 0 : coverageFor(i, cover)))
  const coverage = Math.min(MAX_COVERAGE, Math.max(...needed))
  const t = 1 - coverage / FULL_COVERAGE
  const layers = c.map((cover, i): CloudLayerParams => {
    const altitudeM = bases[i] * k
    if (cover < MIN_CLOUD_COVER) return { altitudeM, heightM: 0, densityScale: 0, weatherExponent: 1 }
    const ti = 1 - needed[i] / FULL_COVERAGE
    const thin = t > 0 && ti > t
    return {
      altitudeM,
      heightM: LAYER_HEIGHTS_M[i],
      densityScale: t > 0 ? DENSITY[i] : (DENSITY[i] * needed[i]) / coverage,
      weatherExponent: thin ? clamp(Math.log(t) / Math.log(ti), 1, MAX_EXPONENT) : 1,
    }
  })
  return { coverage, layers: layers as SceneClouds['layers'] }
}

/** Base of the low, mid and high layers above sea level, before the exaggeration (metres). */
function layerBasesM(geometry: CloudGeometry): number[] {
  const ground = Number.isFinite(geometry.groundM) ? geometry.groundM : 0
  const lowBase = ground + geometry.altitudeM
  return [lowBase, lowBase + MID_GAP_M, Math.max(HIGH_MIN_ALTITUDE_M, ground + HIGH_ABOVE_GROUND_M)]
}

// ---------------------------------------------------------------------------
// Wind
// ---------------------------------------------------------------------------

/** Horizontal velocity (m/s), towards east and north. */
export interface Wind {
  east: number
  north: number
}

/** Without weather: a light westerly breeze (m/s). */
export const DEFAULT_WIND: Readonly<Wind> = Object.freeze({ east: 4, north: 0 })
/** Wind at the cloud levels relative to the 10 m wind of the archive. */
const ALOFT_FACTOR = 2
/**
 * Clouds drift this many times faster than the real wind: the film shows hours in minutes, at the real speed
 * the drift would not be seen.
 */
export const CLOUD_TIMELAPSE = 20

/**
 * Wind of the film: the 10 m wind of the series at `timeMs` and (lon, lat) (start of the outing), as a velocity
 * towards east / north; DEFAULT_WIND without series or value. Meteorological direction: where it blows from.
 */
export function filmWind(series: WeatherSeries | null, timeMs: number, lon: number, lat: number): Wind {
  const sample = series ? weatherAt(series, timeMs, lon, lat) : undefined
  if (!sample || !Number.isFinite(sample.windSpeed) || !Number.isFinite(sample.windDirection)) return { ...DEFAULT_WIND }
  const speed = Math.max(0, sample.windSpeed) / 3.6
  const toward = ((sample.windDirection + 180) * Math.PI) / 180
  return { east: speed * Math.sin(toward), north: speed * Math.cos(toward) }
}

/** Displacement of the clouds (metres east / north) after `filmTimeS` of film. */
export function cloudDrift(wind: Wind, filmTimeS: number): Wind {
  const t = Number.isFinite(filmTimeS) ? filmTimeS * ALOFT_FACTOR * CLOUD_TIMELAPSE : 0
  return { east: wind.east * t, north: wind.north * t }
}

type Vec3 = readonly [number, number, number]

/** Cube-sphere UV of an ECEF position, as sampled by the three-clouds shaders (`getCubeSphereUv`). */
export function cubeSphereUv(p: Vec3): [number, number] {
  const len = Math.hypot(p[0], p[1], p[2])
  const n = [p[0] / len, p[1] / len, p[2] / len]
  const f = n.map(Math.abs)
  const max = Math.max(f[0], f[1], f[2])
  const c = n.map((v) => v / max)
  let m: [number, number]
  if (f[1] > f[0] && f[1] > f[2]) m = c[1] > 0 ? [-n[0], n[2]] : [n[0], n[2]]
  else if (f[0] > f[1] && f[0] > f[2]) m = c[0] > 0 ? [n[1], n[2]] : [-n[1], n[2]]
  else m = c[2] > 0 ? [n[0], n[1]] : [n[0], -n[1]]
  const m2 = [m[0] * m[0], m[1] * m[1]]
  const q = -2 * m2[0] + 2 * m2[1] - 3
  const q2 = q * q
  const ux = Math.sqrt(Math.max(0, 1.5 + m2[0] - m2[1] - 0.5 * Math.sqrt(-24 * m2[0] + q2))) * (m[0] > 0 ? 1 : -1)
  const uy = Math.sqrt(6 / (3 - ux * ux)) * m[1]
  return [ux * 0.5 + 0.5, uy * 0.5 + 0.5]
}

/** Step of the finite differences of the UV Jacobian (metres). */
const JACOBIAN_STEP_M = 1000

/**
 * Offset of the local weather texture (`localWeatherOffset`, in tiles) that moves the cloud cover by `drift`
 * (metres east / north) around `origin` (ECEF), with `east` / `north` the ECEF unit vectors there and `repeat`
 * the tiles per cube face edge (`localWeatherRepeat`). The shader samples uv·repeat + offset, so the pattern
 * moves by D when offset = −J·D·repeat (J: UV Jacobian at the origin, linear in the drift).
 */
export function weatherOffsetFor(origin: Vec3, east: Vec3, north: Vec3, drift: Wind, repeat: number): [number, number] {
  const at = (v: Vec3, s: number) => cubeSphereUv([origin[0] + v[0] * s, origin[1] + v[1] * s, origin[2] + v[2] * s])
  const e1 = at(east, JACOBIAN_STEP_M)
  const e0 = at(east, -JACOBIAN_STEP_M)
  const n1 = at(north, JACOBIAN_STEP_M)
  const n0 = at(north, -JACOBIAN_STEP_M)
  const s = repeat / (2 * JACOBIAN_STEP_M)
  return [
    -((e1[0] - e0[0]) * drift.east + (n1[0] - n0[0]) * drift.north) * s,
    -((e1[1] - e0[1]) * drift.east + (n1[1] - n0[1]) * drift.north) * s,
  ]
}

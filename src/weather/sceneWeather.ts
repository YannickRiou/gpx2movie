/**
 * Weather of the outing → parameters of the 3D scene: sun and sky dimmed by the clouds, softer shadows,
 * extra haze (low clouds, precipitation, fog), veiled sky, exposure compensation and a slight desaturation.
 *
 * A pure function of (series, instant, place, setting): the video export renders the same image for the same
 * frame, there is no smoothing state. Every output is clamped and equals CLEAR_SCENE_WEATHER (identity) for a
 * clear sky, without data or with the setting off.
 *
 * Pure functions (no DOM, no React, no Three).
 */
import { weatherAt, type WeatherSeries } from './series'

/** Scene parameters applied by AtmosphereLayer (identity: CLEAR_SCENE_WEATHER). */
export interface SceneWeather {
  /** factor on the direct sun light, (0, 1] */
  sunScale: number
  /** factor on the sky light, (0, 1] */
  skyScale: number
  /** visibility divided by this factor (>= 1), see hazeExtinction */
  hazeScale: number
  /** scale height of the extra haze above the ground under the marker (metres) */
  hazeHeightM: number
  /** opacity of the cast shadows, [0, 1] */
  shadowStrength: number
  /** stops added to the exposure, >= 0 */
  exposureCompensationEv: number
  /** fraction of the colour saturation removed, [0, 1) */
  desaturation: number
  /** fraction of the clear sky hidden behind the cloud deck, [0, 1) */
  skyVeil: number
}

/** Weather inputs of the scene, smoothed in time (see sceneConditionsAt). NaN where unknown. */
export interface SceneConditions {
  /** cloud cover, % (total, low < 2 km, mid 2–6 km, high > 6 km) */
  cloudCover: number
  cloudCoverLow: number
  cloudCoverMid: number
  cloudCoverHigh: number
  /** rate over the hour (mm/h of water, snow included) */
  precipitationMm: number
  /** snowfall rate (cm/h) */
  snowfallCm: number
  /** 1 under a fog weather code (WMO 45, 48), 0 otherwise, smoothed in time */
  fog: number
}

/** The user setting (`settings.weatherScene`). */
export interface WeatherSceneSettings {
  enabled: boolean
  /** 0 = no effect, 1 = full effect */
  strength: number
}

export const DEFAULT_WEATHER_SCENE: WeatherSceneSettings = { enabled: true, strength: 1 }

/** Haze height when there is no fog: a cloudy or rainy boundary layer (metres). */
const HAZE_HEIGHT_M = 1500
/** Haze height in fog: valley fog or a cloud sitting on the ground, peaks emerge above it (metres). */
const FOG_HEIGHT_M = 400

export const CLEAR_SCENE_WEATHER: Readonly<SceneWeather> = Object.freeze({
  sunScale: 1,
  skyScale: 1,
  hazeScale: 1,
  hazeHeightM: HAZE_HEIGHT_M,
  shadowStrength: 1,
  exposureCompensationEv: 0,
  desaturation: 0,
  skyVeil: 0,
})

/** Meteorological visibility of a clear day, the reference of hazeScale (metres). */
export const CLEAR_VISIBILITY_M = 60_000
/** Koschmieder: visibility = 3.912 / extinction (2 % contrast threshold). */
const KOSCHMIEDER = 3.912
const MAX_HAZE_SCALE = 30

const HOUR_MS = 3_600_000

const FOG_CODES: ReadonlySet<number> = new Set([45, 48])

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** NaN-safe value in [0, 1] from a percentage (NaN → `fallback`). */
function fraction(percent: number, fallback: number): number {
  return Number.isNaN(percent) ? fallback : clamp(percent / 100, 0, 1)
}

/**
 * Conditions at `timeMs` and (lon, lat). Cloud covers are instantaneous values, already continuous in time
 * (`weatherAt`). Precipitation, snowfall and the weather code are hourly totals that `weatherAt` holds for
 * the whole hour: here each hour's value is placed at the middle of its hour and interpolated linearly, so
 * the scene does not jump at the top of the hour. Undefined when the series is empty.
 */
export function sceneConditionsAt(series: WeatherSeries, timeMs: number, lon: number, lat: number): SceneConditions | undefined {
  const now = weatherAt(series, timeMs, lon, lat)
  if (!now) return undefined
  // the value of hour k (ending at time[k]) stands at time[k] − 30 min
  const u = (timeMs - series.time[0]) / HOUR_MS + 0.5
  const k = Math.floor(u)
  const w = u - k
  const a = weatherAt(series, series.time[0] + k * HOUR_MS, lon, lat)!
  const b = weatherAt(series, series.time[0] + (k + 1) * HOUR_MS, lon, lat)!
  const lerp = (x: number, y: number) => (Number.isNaN(x) ? y : Number.isNaN(y) ? x : x + (y - x) * w)
  const isFog = (code: number) => (Number.isNaN(code) ? Number.NaN : FOG_CODES.has(code) ? 1 : 0)
  return {
    cloudCover: now.cloudCover,
    cloudCoverLow: now.cloudCoverLow,
    cloudCoverMid: now.cloudCoverMid,
    cloudCoverHigh: now.cloudCoverHigh,
    precipitationMm: lerp(a.precipitation, b.precipitation),
    snowfallCm: lerp(a.snowfall, b.snowfall),
    fog: lerp(isFog(a.weatherCode), isFog(b.weatherCode)),
  }
}

/**
 * Scene parameters for `conditions`, blended towards the identity by `strength` (0..1).
 *
 * With c, l, m, h the total / low / mid / high cloud cover in [0, 1] (a missing layer counts as the total):
 * - cloud opacity o = min(c, l + 0.6·m + 0.25·h): thick low clouds block the sun, cirrus barely do;
 * - precipitation p = 1 − e^(−mm/h ÷ 2), snow s = 1 − e^(−cm/h), fog f ∈ [0, 1], wet w = max(p, s);
 * - sunScale = (1 − 0.8·o^1.5) · (1 − 0.5·max(w, f))            → 0.1 under a rainy overcast;
 * - skyScale = (1 − 0.35·o^1.5) · (1 − 0.25·w)                  → about 0.5 at worst (the sky stays bright);
 * - hazeScale = 1 + 2·l² + 8·p + 12·s + 16·f, ≤ 30              → visibility 60 km ÷ hazeScale;
 * - hazeHeightM = 1500 m, down to 400 m in fog;
 * - shadowStrength = (1 − 0.9·o^1.5) · (1 − 0.7·max(w, f));
 * - exposureCompensationEv = 0.5·log2(1 / max(0.25, 0.75·sunScale + 0.25·skyScale)), ≤ 1 stop: half of the
 *   lost light is given back, so an overcast day stays readable but darker than a sunny one;
 * - desaturation = min(0.5, 0.35·w + 0.2·f);
 * - skyVeil = min(0.95, 0.95·o^1.2 + 0.5·w).
 */
export function sceneWeatherFrom(conditions: SceneConditions | undefined, strength = 1): SceneWeather {
  const k = Number.isFinite(strength) ? clamp(strength, 0, 1) : 0
  if (!conditions || k === 0) return { ...CLEAR_SCENE_WEATHER }
  const c = fraction(conditions.cloudCover, 0)
  const total = Number.isNaN(conditions.cloudCover) ? Infinity : c
  const l = fraction(conditions.cloudCoverLow, c)
  const m = fraction(conditions.cloudCoverMid, c)
  const h = fraction(conditions.cloudCoverHigh, c)
  const o = clamp(Math.min(total, l + 0.6 * m + 0.25 * h), 0, 1)
  const mm = Number.isNaN(conditions.precipitationMm) ? 0 : Math.max(0, conditions.precipitationMm)
  const cm = Number.isNaN(conditions.snowfallCm) ? 0 : Math.max(0, conditions.snowfallCm)
  const p = 1 - Math.exp(-mm / 2)
  const s = 1 - Math.exp(-cm)
  const f = Number.isNaN(conditions.fog) ? 0 : clamp(conditions.fog, 0, 1)
  const wet = Math.max(p, s)
  const o15 = o ** 1.5

  const sunScale = (1 - 0.8 * o15) * (1 - 0.5 * Math.max(wet, f))
  const skyScale = (1 - 0.35 * o15) * (1 - 0.25 * wet)
  const hazeScale = Math.min(MAX_HAZE_SCALE, 1 + 2 * l * l + 8 * p + 12 * s + 16 * f)
  const shadowStrength = (1 - 0.9 * o15) * (1 - 0.7 * Math.max(wet, f))
  const light = Math.max(0.25, 0.75 * sunScale + 0.25 * skyScale)
  const exposureCompensationEv = 0.5 * Math.log2(1 / light)
  const desaturation = Math.min(0.5, 0.35 * wet + 0.2 * f)
  const skyVeil = Math.min(0.95, 0.95 * o ** 1.2 + 0.5 * wet)

  const id = CLEAR_SCENE_WEATHER
  const mix = (identity: number, value: number) => identity + (value - identity) * k
  return {
    sunScale: mix(id.sunScale, sunScale),
    skyScale: mix(id.skyScale, skyScale),
    hazeScale: mix(id.hazeScale, hazeScale),
    hazeHeightM: HAZE_HEIGHT_M + (FOG_HEIGHT_M - HAZE_HEIGHT_M) * f,
    shadowStrength: mix(id.shadowStrength, clamp(shadowStrength, 0, 1)),
    exposureCompensationEv: mix(id.exposureCompensationEv, exposureCompensationEv),
    desaturation: mix(id.desaturation, desaturation),
    skyVeil: mix(id.skyVeil, skyVeil),
  }
}

/**
 * Scene parameters at the sun date `timeMs` under the marker (lon, lat): identity without series or with the
 * setting off.
 */
export function sceneWeatherAt(
  series: WeatherSeries | null,
  timeMs: number,
  lon: number,
  lat: number,
  settings: WeatherSceneSettings,
): SceneWeather {
  if (!series || !settings.enabled) return { ...CLEAR_SCENE_WEATHER }
  return sceneWeatherFrom(sceneConditionsAt(series, timeMs, lon, lat), settings.strength)
}

/** Extra extinction coefficient of the haze at the ground (1/m): Koschmieder with visibility 60 km ÷ hazeScale. */
export function hazeExtinction(hazeScale: number): number {
  return (KOSCHMIEDER * Math.max(0, hazeScale - 1)) / CLEAR_VISIBILITY_M
}

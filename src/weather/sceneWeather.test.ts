import { describe, expect, it } from 'vitest'
import {
  CLEAR_SCENE_WEATHER,
  CLEAR_VISIBILITY_M,
  hazeExtinction,
  withManualHaze,
  sceneConditionsAt,
  sceneWeatherAt,
  sceneWeatherFrom,
  type SceneConditions,
} from './sceneWeather'
import { WEATHER_VARIABLES, type WeatherSeries, type WeatherVariable } from './series'

const HOUR = 3_600_000
const T0 = Date.UTC(2025, 6, 12, 6)

const CLEAR: SceneConditions = {
  cloudCover: 0,
  cloudCoverLow: 0,
  cloudCoverMid: 0,
  cloudCoverHigh: 0,
  precipitationMm: 0,
  snowfallCm: 0,
  fog: 0,
}

const OVERCAST: SceneConditions = { ...CLEAR, cloudCover: 100, cloudCoverLow: 100, cloudCoverMid: 80, cloudCoverHigh: 50 }

function series(values: Partial<Record<WeatherVariable, number[]>>, hours: number): WeatherSeries {
  const full = {} as Record<WeatherVariable, number[]>
  for (const v of WEATHER_VARIABLES) full[v] = values[v] ?? new Array<number>(hours).fill(Number.NaN)
  return { time: Array.from({ length: hours }, (_, h) => T0 + h * HOUR), stations: [{ lon: 6.8, lat: 45.9, values: full }] }
}

function expectInRange(w: ReturnType<typeof sceneWeatherFrom>) {
  expect(w.sunScale).toBeGreaterThan(0)
  expect(w.sunScale).toBeLessThanOrEqual(1)
  expect(w.skyScale).toBeGreaterThan(0)
  expect(w.skyScale).toBeLessThanOrEqual(1)
  expect(w.hazeScale).toBeGreaterThanOrEqual(1)
  expect(w.hazeScale).toBeLessThanOrEqual(30)
  expect(w.shadowStrength).toBeGreaterThanOrEqual(0)
  expect(w.shadowStrength).toBeLessThanOrEqual(1)
  expect(w.exposureCompensationEv).toBeGreaterThanOrEqual(0)
  expect(w.exposureCompensationEv).toBeLessThanOrEqual(1)
  expect(w.desaturation).toBeGreaterThanOrEqual(0)
  expect(w.desaturation).toBeLessThanOrEqual(0.5)
  expect(w.skyVeil).toBeGreaterThanOrEqual(0)
  expect(w.skyVeil).toBeLessThan(1)
}

describe('sceneWeatherFrom', () => {
  it('is the identity for a clear sky, without data or at zero strength', () => {
    expect(sceneWeatherFrom(CLEAR)).toEqual(CLEAR_SCENE_WEATHER)
    expect(sceneWeatherFrom(undefined)).toEqual(CLEAR_SCENE_WEATHER)
    expect(sceneWeatherFrom(OVERCAST, 0)).toEqual(CLEAR_SCENE_WEATHER)
    expect(sceneWeatherFrom(OVERCAST, Number.NaN)).toEqual(CLEAR_SCENE_WEATHER)
    const unknown = sceneWeatherFrom({ ...CLEAR, cloudCover: Number.NaN, cloudCoverLow: Number.NaN, cloudCoverMid: Number.NaN, cloudCoverHigh: Number.NaN, precipitationMm: Number.NaN, snowfallCm: Number.NaN, fog: Number.NaN })
    expect(unknown).toEqual(CLEAR_SCENE_WEATHER)
  })

  it('dims the sun much more than the sky under a low overcast, fades the shadows and opens the exposure', () => {
    const w = sceneWeatherFrom(OVERCAST)
    expectInRange(w)
    expect(w.sunScale).toBeCloseTo(0.2, 6)
    expect(w.skyScale).toBeCloseTo(0.65, 6)
    expect(w.shadowStrength).toBeCloseTo(0.1, 6)
    expect(w.hazeScale).toBeCloseTo(3, 6)
    expect(w.exposureCompensationEv).toBeCloseTo(0.5 * Math.log2(1 / (0.75 * 0.2 + 0.25 * 0.65)), 6)
    expect(w.skyVeil).toBeCloseTo(0.95, 6)
    expect(w.desaturation).toBe(0)
  })

  it('barely dims the sun under high cirrus', () => {
    const w = sceneWeatherFrom({ ...CLEAR, cloudCover: 100, cloudCoverHigh: 100 })
    expect(w.sunScale).toBeGreaterThan(0.85)
    expect(w.hazeScale).toBe(1)
  })

  it('thickens the haze near the ground in fog', () => {
    const w = sceneWeatherFrom({ ...OVERCAST, fog: 1 })
    expectInRange(w)
    expect(w.hazeScale).toBe(19)
    expect(w.hazeHeightM).toBe(400)
    expect(w.sunScale).toBeCloseTo(0.1, 6)
    expect(w.desaturation).toBeCloseTo(0.2, 6)
  })

  it('adds haze, darkness and desaturation with the rain, and more with snow', () => {
    const dry = sceneWeatherFrom(OVERCAST)
    const rain = sceneWeatherFrom({ ...OVERCAST, precipitationMm: 4 })
    const snow = sceneWeatherFrom({ ...OVERCAST, precipitationMm: 4, snowfallCm: 3 })
    expectInRange(rain)
    expectInRange(snow)
    expect(rain.hazeScale).toBeGreaterThan(dry.hazeScale)
    expect(rain.sunScale).toBeLessThan(dry.sunScale)
    expect(rain.skyScale).toBeLessThan(dry.skyScale)
    expect(rain.desaturation).toBeGreaterThan(0.25)
    expect(snow.hazeScale).toBeGreaterThan(rain.hazeScale)
  })

  it('is monotonic in the cloud cover', () => {
    let prev = sceneWeatherFrom(CLEAR)
    for (let c = 5; c <= 100; c += 5) {
      const w = sceneWeatherFrom({ ...CLEAR, cloudCover: c, cloudCoverLow: c, cloudCoverMid: c / 2, cloudCoverHigh: c / 4 })
      expectInRange(w)
      expect(w.sunScale).toBeLessThan(prev.sunScale)
      expect(w.skyScale).toBeLessThan(prev.skyScale)
      expect(w.shadowStrength).toBeLessThan(prev.shadowStrength)
      expect(w.hazeScale).toBeGreaterThan(prev.hazeScale)
      expect(w.skyVeil).toBeGreaterThan(prev.skyVeil)
      expect(w.exposureCompensationEv).toBeGreaterThanOrEqual(prev.exposureCompensationEv)
      prev = w
    }
  })

  it('never lets the cloud opacity exceed the total cover', () => {
    const w = sceneWeatherFrom({ ...CLEAR, cloudCover: 30, cloudCoverLow: 30, cloudCoverMid: 30, cloudCoverHigh: 30 })
    expect(w.sunScale).toBeCloseTo(1 - 0.8 * 0.3 ** 1.5, 6)
  })

  it('blends linearly towards the identity with the strength', () => {
    const full = sceneWeatherFrom(OVERCAST, 1)
    const half = sceneWeatherFrom(OVERCAST, 0.5)
    expect(half.sunScale).toBeCloseTo((1 + full.sunScale) / 2, 9)
    expect(half.hazeScale).toBeCloseTo((1 + full.hazeScale) / 2, 9)
    expect(sceneWeatherFrom(OVERCAST, 7)).toEqual(full)
  })
})

describe('sceneConditionsAt', () => {
  const s = series(
    {
      cloudCover: [0, 100, 100],
      precipitation: [0, 2, 0],
      weatherCode: [0, 45, 3],
    },
    3,
  )

  it('interpolates the cloud cover and centres the hourly totals on their hour', () => {
    const c = sceneConditionsAt(s, T0 + 0.5 * HOUR, 6.8, 45.9)!
    expect(c.cloudCover).toBeCloseTo(50, 9)
    // hour 1 (06:00–07:00) stands at 06:30 with its total
    expect(c.precipitationMm).toBeCloseTo(2, 9)
    expect(c.fog).toBeCloseTo(1, 9)
    // half-way between the middles of hours 1 and 2
    const at7 = sceneConditionsAt(s, T0 + HOUR, 6.8, 45.9)!
    expect(at7.precipitationMm).toBeCloseTo(1, 9)
    expect(at7.fog).toBeCloseTo(0.5, 9)
  })

  it('does not jump at the top of the hour', () => {
    const before = sceneConditionsAt(s, T0 + HOUR - 1, 6.8, 45.9)!
    const after = sceneConditionsAt(s, T0 + HOUR + 1, 6.8, 45.9)!
    expect(Math.abs(after.precipitationMm - before.precipitationMm)).toBeLessThan(1e-3)
    expect(Math.abs(after.fog - before.fog)).toBeLessThan(1e-3)
  })

  it('is undefined for an empty series', () => {
    expect(sceneConditionsAt({ time: [], stations: [] }, T0, 6.8, 45.9)).toBeUndefined()
  })
})

describe('sceneWeatherAt', () => {
  const s = series({ cloudCover: [100, 100], cloudCoverLow: [100, 100] }, 2)

  it('is the identity without series or with the setting off', () => {
    expect(sceneWeatherAt(null, T0, 6.8, 45.9, { enabled: true, strength: 1 })).toEqual(CLEAR_SCENE_WEATHER)
    expect(sceneWeatherAt(s, T0, 6.8, 45.9, { enabled: false, strength: 1 })).toEqual(CLEAR_SCENE_WEATHER)
  })

  it('follows the weather of the series', () => {
    expect(sceneWeatherAt(s, T0, 6.8, 45.9, { enabled: true, strength: 1 }).sunScale).toBeCloseTo(0.2, 6)
  })
})

describe('hazeExtinction', () => {
  it('adds no extinction at scale 1 and follows Koschmieder', () => {
    expect(hazeExtinction(1)).toBe(0)
    expect(hazeExtinction(0.5)).toBe(0)
    expect(hazeExtinction(11)).toBeCloseTo((3.912 * 10) / CLEAR_VISIBILITY_M, 12)
  })
})

describe('withManualHaze', () => {
  it('adds the haze set by hand to the weather, within the bound', () => {
    expect(withManualHaze(1, 0)).toBe(1)
    // at 1 on a clear day: visibility 60 km ÷ 20 = 3 km
    expect(withManualHaze(1, 1)).toBe(20)
    expect(withManualHaze(25, 1)).toBe(30)
    expect(withManualHaze(1, 2)).toBe(20)
  })
})

import { describe, expect, it } from 'vitest'
import { buildTrackPath } from '../flyover/path'
import { buildTrack } from '../import/stats'
import {
  WEATHER_VARIABLES,
  describeWeatherCode,
  summarizeOuting,
  weatherAt,
  weatherWidgetData,
  windFromLabel,
  type WeatherSeries,
  type WeatherStation,
  type WeatherVariable,
} from './series'

const HOUR = 3_600_000
const T0 = Date.UTC(2025, 6, 12, 6)

function station(lon: number, lat: number, hours: number, values: Partial<Record<WeatherVariable, number[]>>): WeatherStation {
  const full = {} as Record<WeatherVariable, number[]>
  for (const v of WEATHER_VARIABLES) full[v] = values[v] ?? new Array<number>(hours).fill(Number.NaN)
  return { lon, lat, values: full }
}

function series(hours: number, stations: WeatherStation[]): WeatherSeries {
  return { time: Array.from({ length: hours }, (_, h) => T0 + h * HOUR), stations }
}

describe('weatherAt', () => {
  const s = series(3, [
    station(6.8, 45.9, 3, {
      temperature: [10, 20, 30],
      precipitation: [0, 1, 2],
      weatherCode: [0, 61, 63],
      windSpeed: [10, 10, 10],
      windDirection: [350, 10, 10],
    }),
  ])

  it('interpolates instantaneous values between hours and clamps outside the series', () => {
    expect(weatherAt(s, T0 + 0.5 * HOUR, 6.8, 45.9)!.temperature).toBeCloseTo(15)
    expect(weatherAt(s, T0 - 5 * HOUR, 6.8, 45.9)!.temperature).toBe(10)
    expect(weatherAt(s, T0 + 9 * HOUR, 6.8, 45.9)!.temperature).toBe(30)
  })

  it('takes hourly totals and the weather code from the hour ending at or after the instant', () => {
    const w = weatherAt(s, T0 + 0.25 * HOUR, 6.8, 45.9)!
    expect(w.precipitation).toBe(1)
    expect(w.weatherCode).toBe(61)
    expect(weatherAt(s, T0 + HOUR, 6.8, 45.9)!.precipitation).toBe(1)
  })

  it('interpolates the wind direction through north', () => {
    const dir = weatherAt(s, T0 + 0.5 * HOUR, 6.8, 45.9)!.windDirection
    expect(Math.min(dir, 360 - dir)).toBeLessThan(1e-6)
  })

  it('weights stations by inverse squared distance, weather code from the nearest', () => {
    const two = series(1, [
      station(6.8, 45.9, 1, { temperature: [10], weatherCode: [0] }),
      station(6.9, 45.9, 1, { temperature: [20], weatherCode: [71] }),
    ])
    expect(weatherAt(two, T0, 6.85, 45.9)!.temperature).toBeCloseTo(15, 3)
    const nearSecond = weatherAt(two, T0, 6.89, 45.9)!
    expect(nearSecond.temperature).toBeGreaterThan(19.5)
    expect(nearSecond.weatherCode).toBe(71)
    expect(weatherAt(two, T0, 6.8, 45.9)!.temperature).toBeCloseTo(10, 2)
  })

  it('skips missing values and returns undefined for an empty series', () => {
    const gap = series(2, [station(6.8, 45.9, 2, { temperature: [Number.NaN, 12] })])
    expect(weatherAt(gap, T0 + 0.5 * HOUR, 6.8, 45.9)!.temperature).toBe(12)
    expect(Number.isNaN(weatherAt(gap, T0, 6.8, 45.9)!.cloudCover)).toBe(true)
    expect(weatherAt({ time: [], stations: [] }, T0, 6.8, 45.9)).toBeUndefined()
  })
})

describe('describeWeatherCode / windFromLabel', () => {
  it('labels WMO codes in French with an icon id', () => {
    expect(describeWeatherCode(0)).toEqual({ label: 'Ciel dégagé', icon: 'clear' })
    expect(describeWeatherCode(3).label).toBe('Couvert')
    expect(describeWeatherCode(61)).toEqual({ label: 'Pluie faible', icon: 'rain' })
    expect(describeWeatherCode(73).icon).toBe('snow')
    expect(describeWeatherCode(95).icon).toBe('thunderstorm')
    expect(describeWeatherCode(Number.NaN).icon).toBe('unknown')
  })

  it('names the direction the wind blows from', () => {
    expect(windFromLabel(0)).toBe('N')
    expect(windFromLabel(359)).toBe('N')
    expect(windFromLabel(225)).toBe('SO')
    expect(windFromLabel(-45)).toBe('NO')
    expect(windFromLabel(Number.NaN)).toBe('')
  })
})

describe('along the track', () => {
  // three hours due east, a one-hour pause in the middle point
  const track = buildTrack({
    name: 't',
    source: 'gpx',
    segments: [
      {
        points: [
          { lon: 6.8, lat: 45.9, ele: 1000, time: T0 },
          { lon: 6.85, lat: 45.9, ele: 1200, time: T0 + HOUR },
          { lon: 6.85, lat: 45.9, ele: 1200, time: T0 + 2 * HOUR },
          { lon: 6.9, lat: 45.9, ele: 1000, time: T0 + 3 * HOUR },
        ],
      },
    ],
  })
  const path = buildTrackPath(track)
  const s = series(4, [
    station(6.85, 45.9, 4, {
      temperature: [8, 12, 16, 14],
      apparentTemperature: [6, 11, 15, 13],
      precipitation: [0, 2, 2, 2],
      snowfall: [0, 0, 0, 0],
      windSpeed: [5, 10, 20, 15],
      windGusts: [10, 20, 40, 30],
      windDirection: [270, 270, 270, 270],
      cloudCover: [0, 50, 100, 100],
      weatherCode: [0, 61, 61, 61],
    }),
  ])

  it('gives the widget data under the marker', () => {
    const w = weatherWidgetData(s, path, 0)!
    expect(w.timeMs).toBe(T0)
    expect(w.temperatureC).toBe(8)
    expect(w.condition.label).toBe('Ciel dégagé')
    expect(w.windFrom).toBe('O')
    const end = weatherWidgetData(s, path, 1)!
    expect(end.timeMs).toBe(T0 + 3 * HOUR)
    expect(end.condition.label).toBe('Pluie faible')
    expect(weatherWidgetData(s, buildTrackPath(buildTrack({ name: 'u', source: 'gpx', segments: [{ points: [{ lon: 6.8, lat: 45.9 }] }] })), 0)).toBeUndefined()
  })

  it('summarises the outing, totals weighted by the recorded time (pause included)', () => {
    const summary = summarizeOuting(s, path)!
    // 2 mm/h during the three hours of the outing
    expect(summary.precipitationMm).toBeCloseTo(6, 1)
    expect(summary.snowfallCm).toBe(0)
    expect(summary.minTemperatureC).toBe(8)
    // the sample right after the pause is at T0 + 2 h
    expect(summary.maxTemperatureC).toBeCloseTo(16, 1)
    expect(summary.maxWindKmh).toBeCloseTo(20, 1)
    expect(summary.maxGustsKmh).toBe(40)
    expect(summary.dominant.label).toBe('Pluie faible')
  })
})

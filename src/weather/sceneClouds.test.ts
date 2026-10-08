import { describe, expect, it } from 'vitest'
import {
  CLOUD_TIMELAPSE,
  DEFAULT_CLOUDS,
  DEFAULT_WIND,
  cloudCoversAt,
  cloudDrift,
  cubeSphereUv,
  filmWind,
  isValidClouds,
  sceneCloudsFrom,
  weatherOffsetFor,
} from './sceneClouds'
import type { SceneConditions } from './sceneWeather'
import { WEATHER_VARIABLES, type WeatherSeries, type WeatherVariable } from './series'

const CONDITIONS: SceneConditions = {
  cloudCover: 70,
  cloudCoverLow: 60,
  cloudCoverMid: 30,
  cloudCoverHigh: 0,
  precipitationMm: 0,
  snowfallCm: 0,
  fog: 0,
}
const GEOMETRY = { groundM: 1000, altitudeM: 1200, exaggeration: 1 }

describe('settings', () => {
  it('accepts the defaults and rejects out-of-range values', () => {
    expect(isValidClouds(DEFAULT_CLOUDS)).toBe(true)
    expect(isValidClouds({ ...DEFAULT_CLOUDS, mode: 'brouillard' as never })).toBe(false)
    expect(isValidClouds({ ...DEFAULT_CLOUDS, quality: 'ultra' as never })).toBe(false)
    expect(isValidClouds({ ...DEFAULT_CLOUDS, coverage: 1.2 })).toBe(false)
    expect(isValidClouds({ ...DEFAULT_CLOUDS, altitudeM: 50 })).toBe(false)
  })
})

describe('cloudCoversAt', () => {
  it('gives no clouds when switched off or without weather', () => {
    expect(cloudCoversAt({ ...DEFAULT_CLOUDS, mode: 'aucun' }, CONDITIONS)).toBeNull()
    expect(cloudCoversAt(DEFAULT_CLOUDS, undefined)).toBeNull()
    const unknown = { ...CONDITIONS, cloudCover: NaN, cloudCoverLow: NaN, cloudCoverMid: NaN, cloudCoverHigh: NaN }
    expect(cloudCoversAt(DEFAULT_CLOUDS, unknown)).toBeNull()
  })

  it('follows the layers of the weather, a missing layer counting as the total', () => {
    expect(cloudCoversAt(DEFAULT_CLOUDS, CONDITIONS)).toEqual({ low: 0.6, mid: 0.3, high: 0 })
    expect(cloudCoversAt(DEFAULT_CLOUDS, { ...CONDITIONS, cloudCoverMid: NaN })!.mid).toBeCloseTo(0.7, 9)
  })

  it('derives the three layers from the manual cover, whatever the weather', () => {
    const covers = cloudCoversAt({ ...DEFAULT_CLOUDS, mode: 'manuel', coverage: 0.5 }, undefined)!
    expect(covers.low).toBe(0.5)
    expect(covers.mid).toBeCloseTo(0.3, 9)
    expect(covers.high).toBeCloseTo(0.2, 9)
  })
})

describe('sceneCloudsFrom', () => {
  it('renders nothing for a clear sky', () => {
    expect(sceneCloudsFrom(null, GEOMETRY)).toBeNull()
    expect(sceneCloudsFrom({ low: 0.01, mid: 0, high: 0.01 }, GEOMETRY)).toBeNull()
  })

  it('gives the dominant layer exponent 1, thins the others and switches empty layers off', () => {
    const clouds = sceneCloudsFrom({ low: 0.6, mid: 0.3, high: 0 }, GEOMETRY)!
    const [low, mid, high] = clouds.layers
    // measured coverage of a 60 % low layer, a 30 % mid layer needs 0.32
    expect(clouds.coverage).toBeCloseTo(0.347, 9)
    expect(low.weatherExponent).toBe(1)
    expect(mid.weatherExponent).toBeCloseTo(Math.log(1 - 0.347 / 0.4) / Math.log(1 - 0.32 / 0.4), 9)
    expect(mid.weatherExponent).toBeGreaterThan(1)
    expect(mid.densityScale).toBe(low.densityScale * 0.6)
    expect(high.heightM).toBe(0)
    expect(high.densityScale).toBe(0)
    expect(low.heightM).toBeGreaterThan(0)
  })

  it('increases the coverage with the cover, up to a closed deck under an overcast', () => {
    let previous = 0
    for (let c = 0.05; c <= 1.0001; c += 0.05) {
      const { coverage } = sceneCloudsFrom({ low: c, mid: 0, high: 0 }, GEOMETRY)!
      expect(coverage).toBeGreaterThan(previous)
      previous = coverage
    }
    expect(previous).toBeCloseTo(0.55, 9)
  })

  it('scales the density of the other layers when the overcast leaves no room for thinning', () => {
    const [low, mid] = sceneCloudsFrom({ low: 1, mid: 0.1, high: 0 }, GEOMETRY)!.layers
    expect(low.densityScale).toBeCloseTo(0.2, 9)
    expect(mid.weatherExponent).toBe(1)
    expect(mid.densityScale).toBeCloseTo((0.12 * 0.191) / 0.55, 9)
  })

  it('places the layers above the ground of the track, exaggerated like the relief', () => {
    const covers = { low: 0.5, mid: 0.5, high: 0.5 }
    const flat = sceneCloudsFrom(covers, GEOMETRY)!.layers
    expect(flat.map((l) => l.altitudeM)).toEqual([2200, 4200, 7000])
    const tall = sceneCloudsFrom(covers, { ...GEOMETRY, exaggeration: 2 })!.layers
    expect(tall.map((l) => l.altitudeM)).toEqual([4400, 8400, 14000])
    expect(tall[0].heightM).toBe(flat[0].heightM)
    expect(sceneCloudsFrom(covers, { ...GEOMETRY, groundM: 3000 })!.layers[2].altitudeM).toBe(8500)
  })
})

function windSeries(speedKmh: number, fromDeg: number): WeatherSeries {
  const values = {} as Record<WeatherVariable, number[]>
  for (const v of WEATHER_VARIABLES) values[v] = [NaN, NaN]
  values.windSpeed = [speedKmh, speedKmh]
  values.windDirection = [fromDeg, fromDeg]
  return { time: [0, 3_600_000], stations: [{ lon: 6.8, lat: 45.9, values }] }
}

describe('wind and drift', () => {
  it('blows towards the opposite of the meteorological direction', () => {
    const westerly = filmWind(windSeries(36, 270), 0, 6.8, 45.9)
    expect(westerly.east).toBeCloseTo(10, 9)
    expect(westerly.north).toBeCloseTo(0, 9)
    const northerly = filmWind(windSeries(18, 0), 0, 6.8, 45.9)
    expect(northerly.north).toBeCloseTo(-5, 9)
    expect(filmWind(null, 0, 6.8, 45.9)).toEqual(DEFAULT_WIND)
    expect(filmWind(windSeries(NaN, 0), 0, 6.8, 45.9)).toEqual(DEFAULT_WIND)
  })

  it('drifts linearly with the film time (no state between frames)', () => {
    expect(cloudDrift({ east: 3, north: -1 }, 0).east).toBe(0)
    const d = cloudDrift({ east: 3, north: -1 }, 10)
    expect(d.east).toBeCloseTo(3 * 10 * 2 * CLOUD_TIMELAPSE, 9)
    expect(d.north).toBeCloseTo(-1 * 10 * 2 * CLOUD_TIMELAPSE, 9)
    expect(cloudDrift({ east: 3, north: -1 }, NaN).east).toBe(0)
  })
})

describe('cubeSphereUv and weatherOffsetFor', () => {
  // a point of the Alps at cloud height, with its local east / north unit vectors
  const lon = (6.8 * Math.PI) / 180
  const lat = (45.9 * Math.PI) / 180
  const r = 6_371_000 + 3000
  const origin = [r * Math.cos(lat) * Math.cos(lon), r * Math.cos(lat) * Math.sin(lon), r * Math.sin(lat)] as const
  const east = [-Math.sin(lon), Math.cos(lon), 0] as const
  const north = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)] as const

  it('stays in [0, 1] and is continuous', () => {
    const [u, v] = cubeSphereUv(origin)
    for (const x of [u, v]) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(1)
    }
    const near = cubeSphereUv([origin[0] + 10, origin[1], origin[2]])
    expect(Math.abs(near[0] - u) + Math.abs(near[1] - v)).toBeLessThan(1e-5)
  })

  it('moves the sampled pattern by the drift', () => {
    const repeat = 100
    const drift = { east: 4000, north: -2500 }
    const offset = weatherOffsetFor(origin, east, north, drift, repeat)
    const p = [origin[0] + 500, origin[1] - 300, origin[2] + 200] as const
    const moved = [
      p[0] + east[0] * drift.east + north[0] * drift.north,
      p[1] + east[1] * drift.east + north[1] * drift.north,
      p[2] + east[2] * drift.east + north[2] * drift.north,
    ] as const
    // the texel seen at p without drift is seen at p + D with the offset
    const before = cubeSphereUv(p).map((x) => x * repeat)
    const after = cubeSphereUv(moved).map((x, i) => x * repeat + offset[i])
    expect(after[0]).toBeCloseTo(before[0], 3)
    expect(after[1]).toBeCloseTo(before[1], 3)
    expect(weatherOffsetFor(origin, east, north, { east: 0, north: 0 }, repeat).map(Math.abs)).toEqual([0, 0])
  })
})

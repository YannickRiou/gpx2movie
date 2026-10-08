import { describe, expect, it, vi } from 'vitest'
import type { TrackPoint } from '../core/types'
import { buildTrackPath } from '../flyover/path'
import { buildTrack } from '../import/stats'
import {
  WeatherError,
  buildArchiveUrl,
  createWeatherCache,
  fetchOutingWeather,
  outingDays,
  parseArchiveResponse,
  sampleLocations,
  weatherCacheKey,
} from './openMeteo'

const HOUR = 3_600_000
const START = Date.UTC(2025, 6, 12, 7)
const NOW = Date.UTC(2026, 9, 7, 8)

function pathOf(points: TrackPoint[]) {
  return buildTrackPath(buildTrack({ name: 't', source: 'gpx', segments: [{ points }] }))
}

/** ~8 km eastwards over 5 h 50, climbing then descending. */
const outing = pathOf([
  { lon: 6.7986, lat: 45.8911, ele: 1004, time: START },
  { lon: 6.85, lat: 45.8911, ele: 1653, time: START + 3 * HOUR },
  { lon: 6.9012, lat: 45.8911, ele: 1166, time: START + 5 * HOUR + 50 * 60_000 },
])

/** Archive-shaped body for `places` places over whole days from `startDay`. */
function archiveBody(places: number, startDay: string, days: number, temperature = 20): unknown[] {
  const t0 = Date.parse(`${startDay}T00:00:00Z`) / 1000
  const n = days * 24
  const column = (v: number | null) => new Array<number | null>(n).fill(v)
  return Array.from({ length: places }, () => ({
    latitude: 45.9,
    longitude: 6.8,
    hourly: {
      time: Array.from({ length: n }, (_, h) => t0 + h * 3600),
      temperature_2m: column(temperature),
      apparent_temperature: column(temperature - 1),
      precipitation: column(0),
      rain: column(0),
      snowfall: column(0),
      cloud_cover: column(40),
      cloud_cover_low: column(10),
      cloud_cover_mid: column(20),
      cloud_cover_high: column(null),
      wind_speed_10m: column(5),
      wind_direction_10m: column(300),
      wind_gusts_10m: column(20),
      weather_code: column(2),
    },
  }))
}

function memoryStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  }
}

describe('sampleLocations', () => {
  it('keeps start and end of a short track, rounded, at the recorded elevation', () => {
    expect(sampleLocations(outing)).toEqual([
      { lon: 6.8, lat: 45.89, ele: 1000 },
      { lon: 6.9, lat: 45.89, ele: 1170 },
    ])
  })

  it('samples a long track every ~10 km and drops places in the same cell and elevation band', () => {
    const long = pathOf([
      { lon: 6, lat: 45.9, ele: 500 },
      { lon: 6.65, lat: 45.9, ele: 500 },
    ])
    expect(sampleLocations(long)).toHaveLength(7)
    const loop = pathOf([
      { lon: 6.8, lat: 45.9, ele: 1000 },
      { lon: 6.82, lat: 45.9, ele: 1050 },
      { lon: 6.8, lat: 45.9, ele: 1000 },
    ])
    expect(sampleLocations(loop)).toHaveLength(1)
  })

  it('leaves the elevation to the provider when the track has none', () => {
    expect(sampleLocations(pathOf([{ lon: 6.8, lat: 45.9 }, { lon: 6.9, lat: 45.9 }]))[0]).toEqual({ lon: 6.8, lat: 45.9 })
  })
})

describe('outingDays', () => {
  it('spans the UTC days of the outing with an hour of margin, clamped to today', () => {
    expect(outingDays(START, START + 6 * HOUR, NOW)).toEqual({ startDay: '2025-07-12', endDay: '2025-07-12' })
    expect(outingDays(Date.UTC(2025, 6, 12, 0, 30), Date.UTC(2025, 6, 12, 23, 30), NOW)).toEqual({
      startDay: '2025-07-11',
      endDay: '2025-07-13',
    })
    expect(outingDays(NOW - 2 * HOUR, NOW + 20 * HOUR, NOW).endDay).toBe('2026-10-07')
  })

  it('refuses dates outside the archive and very long spans', () => {
    const reason = (start: number, end: number) => {
      try {
        outingDays(start, end, NOW)
      } catch (e) {
        return e instanceof WeatherError ? `${e.kind}: ${e.message}` : 'other'
      }
      return 'ok'
    }
    expect(reason(NOW + 48 * HOUR, NOW + 50 * HOUR)).toMatch(/^unavailable: .*futur/)
    expect(reason(Date.UTC(1939, 5, 1), Date.UTC(1939, 5, 1, 5))).toMatch(/^unavailable: .*1940/)
    expect(reason(START, START + 40 * 24 * HOUR)).toMatch(/^unavailable: .*31 jours/)
  })
})

describe('buildArchiveUrl', () => {
  it('asks for UTC unix times, all places in one request, elevations when all known', () => {
    const url = new URL(buildArchiveUrl([{ lon: 6.8, lat: 45.89, ele: 1000 }, { lon: 6.9, lat: 45.89, ele: 1170 }], '2025-07-12', '2025-07-13'))
    expect(url.origin + url.pathname).toBe('https://archive-api.open-meteo.com/v1/archive')
    expect(url.searchParams.get('latitude')).toBe('45.89,45.89')
    expect(url.searchParams.get('longitude')).toBe('6.80,6.90')
    expect(url.searchParams.get('elevation')).toBe('1000,1170')
    expect(url.searchParams.get('timezone')).toBe('GMT')
    expect(url.searchParams.get('timeformat')).toBe('unixtime')
    expect(url.searchParams.get('start_date')).toBe('2025-07-12')
    expect(url.searchParams.get('end_date')).toBe('2025-07-13')
    expect(url.searchParams.get('hourly')).toContain('weather_code')
    expect(new URL(buildArchiveUrl([{ lon: 6.8, lat: 45.89 }], '2025-07-12', '2025-07-12')).searchParams.has('elevation')).toBe(false)
  })
})

describe('parseArchiveResponse', () => {
  it('splits each place into days, missing values as null', () => {
    const days = parseArchiveResponse(archiveBody(2, '2025-07-12', 2), 2, '2025-07-12', '2025-07-13')
    expect(days).toHaveLength(2)
    expect(days[0]).toHaveLength(2)
    expect(days[1][1].temperature).toHaveLength(24)
    expect(days[0][0].cloudCoverHigh[0]).toBeNull()
    // a single place comes back as a bare object
    expect(parseArchiveResponse(archiveBody(1, '2025-07-12', 1)[0], 1, '2025-07-12', '2025-07-12')).toHaveLength(1)
  })

  it('rejects an unexpected shape', () => {
    expect(() => parseArchiveResponse(archiveBody(1, '2025-07-12', 1), 2, '2025-07-12', '2025-07-12')).toThrow('Réponse météo illisible.')
    expect(() => parseArchiveResponse(archiveBody(1, '2025-07-13', 1), 1, '2025-07-12', '2025-07-12')).toThrow(WeatherError)
    expect(() => parseArchiveResponse({ error: true }, 1, '2025-07-12', '2025-07-12')).toThrow(WeatherError)
  })
})

describe('fetchOutingWeather', () => {
  it('builds the hourly series and fetches a track only once', async () => {
    const fetchMock = vi.fn(async () => Response.json(archiveBody(2, '2025-07-12', 1)))
    const cache = createWeatherCache(null)
    const s = await fetchOutingWeather(outing, { fetch: fetchMock, cache, now: NOW })
    expect(s.time).toHaveLength(24)
    expect(s.time[0]).toBe(Date.UTC(2025, 6, 12))
    expect(s.stations).toHaveLength(2)
    expect(s.stations[0]).toMatchObject({ lon: 6.8, lat: 45.89, ele: 1000 })
    expect(s.stations[1].values.temperature[10]).toBe(20)
    expect(Number.isNaN(s.stations[1].values.cloudCoverHigh[10])).toBe(true)

    await fetchOutingWeather(outing, { fetch: fetchMock, cache, now: NOW })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('persists old days only, and reads them back in a new session', async () => {
    const storage = memoryStorage()
    const fetchMock = vi.fn(async () => Response.json(archiveBody(2, '2025-07-12', 1)))
    await fetchOutingWeather(outing, { fetch: fetchMock, cache: createWeatherCache(storage), now: NOW })
    expect(storage.data.size).toBe(1)
    await fetchOutingWeather(outing, { fetch: fetchMock, cache: createWeatherCache(storage), now: NOW })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const recent = pathOf([
      { lon: 6.8, lat: 45.9, ele: 1000, time: NOW - 30 * HOUR },
      { lon: 6.9, lat: 45.9, ele: 1100, time: NOW - 28 * HOUR },
    ])
    const recentStorage = memoryStorage()
    const recentFetch = vi.fn(async () => Response.json(archiveBody(2, '2026-10-06', 1)))
    await fetchOutingWeather(recent, { fetch: recentFetch, cache: createWeatherCache(recentStorage), now: NOW })
    expect(recentStorage.data.size).toBe(0)
  })

  it('reports errors in French', async () => {
    const run = (fetchFn: typeof fetch) => fetchOutingWeather(outing, { fetch: fetchFn, cache: createWeatherCache(null), now: NOW })
    await expect(run(async () => new Response('{}', { status: 429 }))).rejects.toThrow('Trop de requêtes')
    await expect(
      run(async () => Response.json({ error: true, reason: 'Parameter x is invalid' }, { status: 400 })),
    ).rejects.toThrow('Open-Meteo a refusé la requête (Parameter x is invalid).')
    await expect(run(async () => new Response('oops', { status: 502 }))).rejects.toThrow('erreur 502')
    await expect(
      run(async () => {
        throw new TypeError('Failed to fetch')
      }),
    ).rejects.toThrow('Impossible de joindre Open-Meteo')
    const untimed = pathOf([{ lon: 6.8, lat: 45.9 }, { lon: 6.9, lat: 45.9 }])
    await expect(fetchOutingWeather(untimed, { fetch: vi.fn(), now: NOW })).rejects.toMatchObject({ kind: 'unavailable' })
  })
})

describe('createWeatherCache', () => {
  const day = parseArchiveResponse(archiveBody(1, '2025-07-12', 1), 1, '2025-07-12', '2025-07-12')[0][0]

  it('survives a corrupt or failing storage', () => {
    const storage = memoryStorage()
    storage.setItem('openflyover.weather.v1', '{not json')
    const cache = createWeatherCache(storage)
    expect(cache.get('x')).toBeUndefined()
    storage.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError')
    }
    cache.set('x', day, true)
    expect(cache.get('x')).toBe(day)
  })

  it('evicts the least recently stored days beyond the limit, written once after a burst', async () => {
    const storage = memoryStorage()
    const cache = createWeatherCache(storage, 2)
    const now = vi.spyOn(Date, 'now')
    for (let i = 0; i < 3; i++) {
      now.mockReturnValue(1000 + i)
      cache.set(weatherCacheKey({ lon: 6.8, lat: 45.9 }, `2025-07-1${i}`), day, true)
    }
    now.mockRestore()
    expect(storage.getItem('openflyover.weather.v1')).toBeNull()
    await Promise.resolve()
    const stored = JSON.parse(storage.getItem('openflyover.weather.v1')!) as Record<string, unknown>
    expect(Object.keys(stored)).toEqual(['45.90,6.80,@2025-07-11', '45.90,6.80,@2025-07-12'])
  })

  it('persists in the platform storage by default, under the localStorage key of before', async () => {
    localStorage.setItem('openflyover.weather.v1', JSON.stringify({ old: { at: 1, day } }))
    const cache = createWeatherCache()
    expect(cache.get('old')).toEqual(day)
    cache.set('new', day, true)
    await Promise.resolve()
    const stored = JSON.parse(localStorage.getItem('openflyover.weather.v1')!) as Record<string, unknown>
    expect(Object.keys(stored)).toEqual(['old', 'new'])
    localStorage.removeItem('openflyover.weather.v1')
  })
})

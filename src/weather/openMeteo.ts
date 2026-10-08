/**
 * Historical weather of an outing from the Open-Meteo archive (https://open-meteo.com, no key, CC BY 4.0,
 * free tier non commercial; see docs/sources.md). A few places are sampled along the track, the hourly
 * values of the recorded days are fetched in one request and cached per place and UTC day, in memory and in
 * the platform storage (localStorage), so a track is fetched once.
 *
 * No DOM beyond `fetch` and an optional `Storage`; no React, no Three.
 */
import { samplePath, type TrackPath } from '../flyover/path'
import { getPlatform } from '../platform'
import { WEATHER_VARIABLES, type WeatherSeries, type WeatherStation, type WeatherVariable } from './series'

export const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
export const OPEN_METEO_ATTRIBUTION = 'Données météo : Open-Meteo.com (CC BY 4.0)'

/** Open-Meteo hourly variable of each series variable (`visibility` is always null in the archive). */
const API_VARIABLES: Record<WeatherVariable, string> = {
  temperature: 'temperature_2m',
  apparentTemperature: 'apparent_temperature',
  precipitation: 'precipitation',
  rain: 'rain',
  snowfall: 'snowfall',
  cloudCover: 'cloud_cover',
  cloudCoverLow: 'cloud_cover_low',
  cloudCoverMid: 'cloud_cover_mid',
  cloudCoverHigh: 'cloud_cover_high',
  windSpeed: 'wind_speed_10m',
  windDirection: 'wind_direction_10m',
  windGusts: 'wind_gusts_10m',
  weatherCode: 'weather_code',
}

/** First day of the archive (ERA5); the last one is today (recent days come from forecasts, revised later). */
export const ARCHIVE_FIRST_DAY = '1940-01-01'
/** Longer outings are not fetched (a stray timestamp would otherwise ask for decades). */
export const MAX_SPAN_DAYS = 31
/** About the model grid (~9 km): one place every 10 km along the track, start and end included. */
const SAMPLE_STEP_M = 10_000
const MAX_LOCATIONS = 12
/** Places in the same 0.05° cell and 200 m elevation band are fetched once. */
const DEDUP_CELL_DEG = 0.05
const DEDUP_ELE_M = 200
/** Days more recent than this are only cached in memory: the archive still revises them. */
const PERSIST_AFTER_DAYS = 7
const STORAGE_KEY = 'openflyover.weather.v1'
const MAX_STORED_DAYS = 300

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** A sampled place: rounded to 0.01° (~1 km), elevation (track altitude, 10 m) the temperature is downscaled to. */
export interface WeatherLocation {
  lon: number
  lat: number
  ele?: number
}

export type WeatherErrorKind = 'unavailable' | 'error'

/** Failure with a French message; `unavailable` = nothing to fetch for this outing (date out of range…). */
export class WeatherError extends Error {
  kind: WeatherErrorKind
  constructor(kind: WeatherErrorKind, message: string) {
    super(message)
    this.name = 'WeatherError'
    this.kind = kind
  }
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

function round(value: number, step: number): number {
  return Math.round(value / step) * step
}

/**
 * Places along the track: evenly spaced, ~10 km apart (2 to 12, start and end included), at the recorded
 * elevation when the track has one everywhere sampled; places in the same grid cell and elevation band dropped.
 */
export function sampleLocations(path: TrackPath): WeatherLocation[] {
  if (path.count === 0) return []
  const count = Math.min(MAX_LOCATIONS, Math.max(2, Math.ceil(path.lengthM / SAMPLE_STEP_M) + 1))
  const raw = []
  for (let i = 0; i < count; i++) raw.push(samplePath(path, (i / (count - 1)) * path.lengthM))
  const withEle = raw.every((p) => p.ele !== undefined)
  const seen = new Set<string>()
  const out: WeatherLocation[] = []
  for (const p of raw) {
    const ele = withEle ? round(p.ele!, 10) : undefined
    const cell = `${Math.round(p.lat / DEDUP_CELL_DEG)},${Math.round(p.lon / DEDUP_CELL_DEG)},${ele === undefined ? '' : Math.round(ele / DEDUP_ELE_M)}`
    if (seen.has(cell)) continue
    seen.add(cell)
    const location: WeatherLocation = { lon: Number(p.lon.toFixed(2)), lat: Number(p.lat.toFixed(2)) }
    if (ele !== undefined) location.ele = ele
    out.push(location)
  }
  return out
}

/** UTC day 'YYYY-MM-DD' of an instant. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`)
}

/** First and last recorded time of the path, undefined when it has none. */
export function recordedSpan(path: TrackPath): { startMs: number; endMs: number } | undefined {
  let startMs = Infinity
  let endMs = -Infinity
  for (let i = 0; i < path.count; i++) {
    const t = path.time[i]
    if (Number.isNaN(t)) continue
    if (t < startMs) startMs = t
    if (t > endMs) endMs = t
  }
  return startMs <= endMs ? { startMs, endMs } : undefined
}

/**
 * UTC days to fetch: from the day of the start minus one hour to the day of the end plus one hour (so the
 * interpolation has an hour on each side), the end clamped to today. Throws `unavailable` with a French
 * reason when the outing is outside the archive or too long.
 */
export function outingDays(startMs: number, endMs: number, nowMs: number): { startDay: string; endDay: string } {
  const today = utcDay(nowMs)
  const startDay = utcDay(startMs - HOUR_MS)
  let endDay = utcDay(endMs + HOUR_MS)
  if (startDay > today) throw new WeatherError('unavailable', 'Sortie datée dans le futur : pas encore de météo à cette date.')
  if (startDay < ARCHIVE_FIRST_DAY) throw new WeatherError('unavailable', 'Pas d’archive météo avant 1940.')
  if (endDay > today) endDay = today
  if ((dayStartMs(endDay) - dayStartMs(startDay)) / DAY_MS + 1 > MAX_SPAN_DAYS) {
    throw new WeatherError('unavailable', `Sortie de plus de ${MAX_SPAN_DAYS} jours : météo non chargée.`)
  }
  return { startDay, endDay }
}

/** Archive request for several places over whole UTC days, times as Unix seconds in UTC. */
export function buildArchiveUrl(locations: readonly WeatherLocation[], startDay: string, endDay: string): string {
  const params = new URLSearchParams({
    latitude: locations.map((l) => l.lat.toFixed(2)).join(','),
    longitude: locations.map((l) => l.lon.toFixed(2)).join(','),
    start_date: startDay,
    end_date: endDay,
    hourly: WEATHER_VARIABLES.map((v) => API_VARIABLES[v]).join(','),
    timezone: 'GMT',
    timeformat: 'unixtime',
  })
  if (locations.length > 0 && locations.every((l) => l.ele !== undefined)) {
    params.set('elevation', locations.map((l) => String(l.ele)).join(','))
  }
  return `${OPEN_METEO_ARCHIVE_URL}?${params.toString()}`
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/** 24 hourly values of each variable for one place and UTC day (null = missing), as cached. */
export type WeatherDay = Record<WeatherVariable, (number | null)[]>

const BAD_RESPONSE = 'Réponse météo illisible.'

/**
 * Split an archive response (one object per place, or a bare object for a single place) into
 * `WeatherDay`s: `days[place][day]`. Throws a French `WeatherError` when the shape is not the expected one.
 */
export function parseArchiveResponse(json: unknown, placeCount: number, startDay: string, endDay: string): WeatherDay[][] {
  const list = Array.isArray(json) ? json : [json]
  if (list.length !== placeCount) throw new WeatherError('error', BAD_RESPONSE)
  const dayCount = (dayStartMs(endDay) - dayStartMs(startDay)) / DAY_MS + 1
  const firstHour = dayStartMs(startDay) / 1000
  return list.map((entry) => {
    const hourly = (entry as { hourly?: Record<string, unknown> } | null)?.hourly
    const time = hourly?.time
    if (!Array.isArray(time) || time.length !== dayCount * 24 || time[0] !== firstHour) {
      throw new WeatherError('error', BAD_RESPONSE)
    }
    const columns = {} as Record<WeatherVariable, (number | null)[]>
    for (const v of WEATHER_VARIABLES) {
      const column = hourly?.[API_VARIABLES[v]]
      if (!Array.isArray(column) || column.length !== time.length) throw new WeatherError('error', BAD_RESPONSE)
      columns[v] = column.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : null))
    }
    const days: WeatherDay[] = []
    for (let d = 0; d < dayCount; d++) {
      const day = {} as WeatherDay
      for (const v of WEATHER_VARIABLES) day[v] = columns[v].slice(d * 24, d * 24 + 24)
      days.push(day)
    }
    return days
  })
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

export interface WeatherCache {
  get(key: string): WeatherDay | undefined
  /** `persist`: also keep it in storage (days old enough not to be revised) */
  set(key: string, day: WeatherDay, persist: boolean): void
}

/** Cache key of one place and UTC day. */
export function weatherCacheKey(location: WeatherLocation, day: string): string {
  return `${location.lat.toFixed(2)},${location.lon.toFixed(2)},${location.ele ?? ''}@${day}`
}

interface StoredEntry {
  /** last use (ms since epoch), for the eviction of the oldest entries */
  at: number
  day: WeatherDay
}

type CacheStorage = Pick<Storage, 'getItem' | 'setItem'>

/** The platform storage (same key as when it was localStorage directly: the days already cached are kept). */
function platformStorage(): CacheStorage {
  const storage = getPlatform().storage
  return { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) }
}

/**
 * Memory cache backed by `storage` (the platform storage by default; null = memory only). The stored map holds at
 * most `maxStored` days (~1.5 kB each), the least recently used ones evicted. Every storage access is guarded:
 * a full, blocked or corrupt storage only loses persistence.
 */
export function createWeatherCache(storage: CacheStorage | null = platformStorage(), maxStored = MAX_STORED_DAYS): WeatherCache {
  const memory = new Map<string, WeatherDay>()
  let stored: Record<string, StoredEntry> | null = null

  function load(): Record<string, StoredEntry> {
    if (stored) return stored
    stored = {}
    try {
      const raw = storage?.getItem(STORAGE_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : null
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed as Record<string, StoredEntry>
    } catch {
      // unreadable: start empty
    }
    return stored
  }

  function save(): void {
    if (!storage || !stored) return
    const keys = Object.keys(stored)
    if (keys.length > maxStored) {
      keys.sort((a, b) => stored![a].at - stored![b].at)
      for (const key of keys.slice(0, keys.length - maxStored)) delete stored[key]
    }
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(stored))
    } catch {
      // quota or blocked storage: keep the memory cache only
    }
  }

  return {
    get(key) {
      const hit = memory.get(key)
      if (hit) return hit
      const entry = load()[key]
      if (!entry?.day) return undefined
      memory.set(key, entry.day)
      return entry.day
    },
    set(key, day, persist) {
      memory.set(key, day)
      if (!persist) return
      load()[key] = { at: Date.now(), day }
      save()
    },
  }
}

let sharedCache: WeatherCache | null = null

function getSharedCache(): WeatherCache {
  sharedCache ??= createWeatherCache()
  return sharedCache
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

export interface FetchWeatherOptions {
  fetch?: typeof fetch
  cache?: WeatherCache
  signal?: AbortSignal
  /** current time (ms), for the archive range and the persistence rule */
  now?: number
}

function listDays(startDay: string, endDay: string): string[] {
  const days = []
  for (let t = dayStartMs(startDay); t <= dayStartMs(endDay); t += DAY_MS) days.push(utcDay(t))
  return days
}

async function requestArchive(fetchFn: typeof fetch, url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetchFn(url, { signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new WeatherError('error', 'Impossible de joindre Open-Meteo : vérifiez la connexion.')
  }
  if (response.status === 429) {
    throw new WeatherError('error', 'Trop de requêtes vers Open-Meteo : réessayez dans quelques minutes.')
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new WeatherError('error', response.ok ? BAD_RESPONSE : `Open-Meteo a répondu par une erreur ${response.status}.`)
  }
  if (!response.ok) {
    const reason = (body as { reason?: unknown } | null)?.reason
    throw new WeatherError(
      'error',
      typeof reason === 'string' ? `Open-Meteo a refusé la requête (${reason}).` : `Open-Meteo a répondu par une erreur ${response.status}.`,
    )
  }
  return body
}

/**
 * Hourly weather of the recorded days of `path` at a few places along it. Days already cached are not
 * requested again; the missing places are fetched in a single request. Throws `WeatherError` (French
 * message; `unavailable` for an untimed track or a date outside the archive) or an `AbortError`.
 */
export async function fetchOutingWeather(path: TrackPath, opts: FetchWeatherOptions = {}): Promise<WeatherSeries> {
  const span = recordedSpan(path)
  if (!span) throw new WeatherError('unavailable', 'Trace sans horodatage : impossible de dater la météo.')
  const now = opts.now ?? Date.now()
  const { startDay, endDay } = outingDays(span.startMs, span.endMs, now)
  const days = listDays(startDay, endDay)
  const locations = sampleLocations(path)
  const cache = opts.cache ?? getSharedCache()

  const missing = locations.filter((l) => days.some((d) => !cache.get(weatherCacheKey(l, d))))
  if (missing.length > 0) {
    const json = await requestArchive(opts.fetch ?? fetch, buildArchiveUrl(missing, startDay, endDay), opts.signal)
    const parsed = parseArchiveResponse(json, missing.length, startDay, endDay)
    const persistBefore = utcDay(now - PERSIST_AFTER_DAYS * DAY_MS)
    missing.forEach((location, i) => {
      days.forEach((day, d) => cache.set(weatherCacheKey(location, day), parsed[i][d], day < persistBefore))
    })
  }

  const time: number[] = []
  for (let h = 0; h < days.length * 24; h++) time.push(dayStartMs(startDay) + h * HOUR_MS)
  const stations: WeatherStation[] = locations.map((location) => {
    const values = {} as Record<WeatherVariable, number[]>
    for (const v of WEATHER_VARIABLES) values[v] = []
    for (const day of days) {
      const cached = cache.get(weatherCacheKey(location, day))
      if (!cached) throw new WeatherError('error', BAD_RESPONSE)
      for (const v of WEATHER_VARIABLES) for (const x of cached[v]) values[v].push(x ?? Number.NaN)
    }
    const station: WeatherStation = { lon: location.lon, lat: location.lat, values }
    if (location.ele !== undefined) station.ele = location.ele
    return station
  })
  return { time, stations }
}

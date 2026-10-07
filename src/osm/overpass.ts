/**
 * OpenStreetMap landmarks near a track, through the public Overpass API (no key, ODbL data).
 *
 * One bounded query per track: every kind is searched with `around:<radius>` on the track simplified to a
 * polyline of at most `MAX_QUERY_VERTICES` points (Douglas-Peucker). The radius is the largest distance the
 * UI offers plus the simplification tolerance, so changing the kinds or the distance later only filters the
 * cached result (`landmarks.ts`) and never sends a new query.
 *
 * Usage policy (docs/sources.md): requests are sent one at a time (module queue), results are cached in
 * memory and in `localStorage` keyed by a hash of the query, a busy server (HTTP 429 / 504) is retried once
 * after a delay and then the next endpoint of `OVERPASS_ENDPOINTS` is tried.
 *
 * The POST body is form-encoded so the browser sends a "simple" CORS request: overpass-api.de answers the
 * OPTIONS preflight with 406.
 */
import type { LonLat, Track } from '../core/types'

/** Main public instance, then VK Maps (no rate limit stated, listed on the OSM wiki); both send CORS headers. */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
] as const

export const OSM_ATTRIBUTION = '© contributeurs OpenStreetMap (ODbL)'

/** Largest landmark distance offered by the UI (metres): the query covers it once and for all. */
export const MAX_LANDMARK_DISTANCE_M = 3000
/** Upper bound on the polyline sent to Overpass (keeps the request body around 20 kB). */
export const MAX_QUERY_VERTICES = 200
/** Smallest simplification tolerance (metres); raised until the polyline fits `MAX_QUERY_VERTICES`. */
export const MIN_SIMPLIFY_TOLERANCE_M = 100
/** Server-side time limit of the query (seconds). */
export const QUERY_TIMEOUT_S = 60
/** Wait before retrying a busy server when it sends no Retry-After (milliseconds). */
export const BUSY_RETRY_DELAY_MS = 15_000
/** Persistent cache lifetime (milliseconds): OSM names and summits change slowly. */
export const CACHE_TTL_MS = 30 * 24 * 3600 * 1000

const CACHE_PREFIX = 'openflyover.osm.v1.'

export type OsmKind = 'peak' | 'pass' | 'hut' | 'lake' | 'waterfall' | 'place' | 'viewpoint' | 'glacier'

export const OSM_KINDS: readonly OsmKind[] = ['peak', 'pass', 'hut', 'lake', 'waterfall', 'place', 'viewpoint', 'glacier']

/** A named OSM element, reduced to what the landmarks need. */
export interface OsmFeature {
  /** "node/123", "way/45", "relation/6" */
  id: string
  kind: OsmKind
  /** French name when tagged (`name:fr`), else `name` */
  name: string
  /** node position, or the centre of the bounding box of a way / relation (`out center`) */
  lon: number
  lat: number
  /** raw `ele` tag (parsed by `landmarks.ts`) */
  ele?: string
  /** finer type: `place` value (town / village / hamlet), `volcano`, `wilderness_hut`… */
  detail?: string
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const M_PER_DEG = 111_320

/** Perpendicular distance (metres) of p to segment ab, equirectangular around a. */
function segmentDistanceM(p: LonLat, a: LonLat, b: LonLat): number {
  const k = Math.cos((a.lat * Math.PI) / 180)
  const bx = (b.lon - a.lon) * k
  const by = b.lat - a.lat
  const px = (p.lon - a.lon) * k
  const py = p.lat - a.lat
  const len2 = bx * bx + by * by
  const t = len2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / len2)) : 0
  return Math.hypot(px - t * bx, py - t * by) * M_PER_DEG
}

/** Douglas-Peucker simplification (iterative); keeps the first and last points. */
export function simplifyLine(points: readonly LonLat[], toleranceM: number): LonLat[] {
  if (points.length <= 2) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    let maxD = -1
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistanceM(points[i], points[first], points[last])
      if (d > maxD) {
        maxD = d
        index = i
      }
    }
    if (index >= 0 && maxD > toleranceM) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  return points.filter((_, i) => keep[i] === 1)
}

/** The track (segments joined) simplified to at most `maxVertices` points, and the tolerance used. */
export function corridorLine(track: Track, maxVertices = MAX_QUERY_VERTICES): { line: LonLat[]; toleranceM: number } {
  const points: LonLat[] = track.segments.flatMap((s) => s.points)
  let toleranceM = MIN_SIMPLIFY_TOLERANCE_M
  let line = simplifyLine(points, toleranceM)
  while (line.length > maxVertices) {
    toleranceM *= 1.5
    line = simplifyLine(points, toleranceM)
  }
  return { line, toleranceM }
}

/** One Overpass statement per kind; every one requires a name. */
const STATEMENTS: readonly string[] = [
  'node["natural"~"^(peak|volcano|saddle)$"]["name"]',
  'node["mountain_pass"="yes"]["name"]',
  'nwr["tourism"~"^(alpine_hut|wilderness_hut)$"]["name"]',
  'nwr["natural"="water"]["name"]["water"!~"^(river|stream|canal|ditch|drain|wastewater|moat)$"]',
  'node["waterway"="waterfall"]["name"]',
  'node["place"~"^(town|village|hamlet)$"]["name"]',
  'node["tourism"="viewpoint"]["name"]',
  'nwr["natural"="glacier"]["name"]',
]

/** Overpass QL query for the landmarks within `radiusM` of the polyline `line`. */
export function buildOverpassQuery(line: readonly LonLat[], radiusM: number): string {
  const coords = line.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(',')
  const around = `(around:${Math.ceil(radiusM)},${coords})`
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];\n(\n${STATEMENTS.map((s) => `  ${s}${around};`).join('\n')}\n);\nout center tags qt;\n`
}

/** The query of a track: corridor of `MAX_LANDMARK_DISTANCE_M` plus the simplification tolerance. */
export function trackQuery(track: Track): string {
  const { line, toleranceM } = corridorLine(track)
  return buildOverpassQuery(line, MAX_LANDMARK_DISTANCE_M + toleranceM)
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

function classify(tags: Record<string, string>): { kind: OsmKind; detail?: string } | null {
  const natural = tags.natural
  if (tags.mountain_pass === 'yes' || natural === 'saddle') return { kind: 'pass' }
  if (natural === 'peak') return { kind: 'peak' }
  if (natural === 'volcano') return { kind: 'peak', detail: 'volcano' }
  if (tags.tourism === 'alpine_hut' || tags.tourism === 'wilderness_hut') return { kind: 'hut', detail: tags.tourism }
  if (natural === 'water') return { kind: 'lake', detail: tags.water }
  if (tags.waterway === 'waterfall') return { kind: 'waterfall' }
  if (natural === 'glacier') return { kind: 'glacier' }
  if (tags.tourism === 'viewpoint') return { kind: 'viewpoint' }
  if (tags.place === 'town' || tags.place === 'village' || tags.place === 'hamlet') return { kind: 'place', detail: tags.place }
  return null
}

/** Named, classified features of an Overpass JSON response; throws on a server-side error. */
export function parseOverpass(json: unknown): OsmFeature[] {
  const record = json as { elements?: unknown; remark?: unknown }
  if (typeof record?.remark === 'string' && /error/i.test(record.remark)) throw new OverpassError(record.remark, 0)
  if (!Array.isArray(record?.elements)) throw new OverpassError('réponse Overpass inattendue', 0)
  const out: OsmFeature[] = []
  for (const element of record.elements as OverpassElement[]) {
    const tags = element.tags
    if (!tags) continue
    const name = (tags['name:fr'] ?? tags.name ?? '').trim()
    const lat = element.lat ?? element.center?.lat
    const lon = element.lon ?? element.center?.lon
    if (!name || lat === undefined || lon === undefined) continue
    const type = classify(tags)
    if (!type) continue
    const feature: OsmFeature = { id: `${element.type}/${element.id}`, kind: type.kind, name, lon, lat }
    if (tags.ele) feature.ele = tags.ele
    if (type.detail) feature.detail = type.detail
    out.push(feature)
  }
  return out
}

// ---------------------------------------------------------------------------
// Fetch, queue, cache
// ---------------------------------------------------------------------------

export class OverpassError extends Error {
  /** HTTP status, 0 for a network or server-side error */
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'OverpassError'
    this.status = status
  }
}

export interface OverpassDeps {
  fetch: typeof fetch
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> | null
  now(): number
}

function abortError(): Error {
  return new DOMException('Aborted', 'AbortError')
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(abortError())
    })
  })
}

function defaultStorage(): OverpassDeps['storage'] {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

const defaultDeps = (): OverpassDeps => ({
  fetch: (...args) => globalThis.fetch(...args),
  sleep: defaultSleep,
  storage: defaultStorage(),
  now: () => Date.now(),
})

/** 53-bit string hash (cyrb53), as hex: the cache key of a query. */
export function hashQuery(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get('Retry-After'))
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 120) * 1000 : BUSY_RETRY_DELAY_MS
}

/**
 * POST `query` to the endpoints in turn: a busy answer (429 / 504) is retried once on the same endpoint
 * after the Retry-After delay (else `BUSY_RETRY_DELAY_MS`), then the next endpoint is tried; a network error
 * moves to the next endpoint at once. Other HTTP errors are final.
 */
export async function runOverpassQuery(
  query: string,
  signal?: AbortSignal,
  deps: OverpassDeps = defaultDeps(),
  endpoints: readonly string[] = OVERPASS_ENDPOINTS,
): Promise<OsmFeature[]> {
  let lastError: unknown = new OverpassError('aucun serveur Overpass', 0)
  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw abortError()
      let response: Response
      try {
        response = await deps.fetch(endpoint, { method: 'POST', body: new URLSearchParams({ data: query }), signal })
      } catch (e) {
        if (signal?.aborted) throw abortError()
        lastError = e
        break
      }
      if (response.ok) {
        const features = parseOverpass(await response.json())
        return features
      }
      lastError = new OverpassError(`HTTP ${response.status}`, response.status)
      if (response.status !== 429 && response.status !== 504) throw lastError
      if (attempt === 0) await deps.sleep(retryAfterMs(response), signal)
    }
  }
  throw lastError
}

/** One request at a time for the whole application (usage policy: no parallel queries). */
let queue: Promise<unknown> = Promise.resolve()
const memoryCache = new Map<string, Promise<OsmFeature[]>>()

function readCache(storage: OverpassDeps['storage'], key: string, now: number): OsmFeature[] | null {
  try {
    const raw = storage?.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw) as { t: number; features: OsmFeature[] }
    if (!Array.isArray(entry.features) || !(now - entry.t < CACHE_TTL_MS)) return null
    return entry.features
  } catch {
    return null
  }
}

function writeCache(storage: OverpassDeps['storage'], key: string, features: OsmFeature[], now: number): void {
  if (!storage) return
  const value = JSON.stringify({ t: now, features })
  try {
    storage.setItem(CACHE_PREFIX + key, value)
  } catch {
    // quota: drop our older entries and try once more
    try {
      const keys: string[] = []
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i)
        if (k?.startsWith(CACHE_PREFIX)) keys.push(k)
      }
      for (const k of keys) storage.removeItem(k)
      storage.setItem(CACHE_PREFIX + key, value)
    } catch {
      // storage unavailable: the memory cache still avoids repeated queries in this session
    }
  }
}

/**
 * Landmarks near `track` (all kinds, `MAX_LANDMARK_DISTANCE_M` corridor), from the memory cache, the
 * persistent cache or one queued Overpass query. A failed or aborted query is not cached.
 */
export function fetchTrackFeatures(track: Track, signal?: AbortSignal, deps: OverpassDeps = defaultDeps()): Promise<OsmFeature[]> {
  const query = trackQuery(track)
  const key = hashQuery(query)
  const cached = memoryCache.get(key)
  if (cached) return cached
  const stored = readCache(deps.storage, key, deps.now())
  if (stored) {
    const promise = Promise.resolve(stored)
    memoryCache.set(key, promise)
    return promise
  }
  const promise = queue
    .catch(() => undefined)
    .then(() => runOverpassQuery(query, signal, deps))
    .then((features) => {
      writeCache(deps.storage, key, features, deps.now())
      return features
    })
  queue = promise.catch(() => undefined)
  memoryCache.set(key, promise)
  promise.catch(() => memoryCache.delete(key))
  return promise
}

/** Forget the memory cache (tests). */
export function clearOverpassMemoryCache(): void {
  memoryCache.clear()
  queue = Promise.resolve()
}

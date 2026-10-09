/**
 * OpenStreetMap landmarks near a track, through the public Overpass API (no key, ODbL data).
 *
 * One bounded query per track (a bounding box, or a few along it past `MAX_BOX_SPAN_M`): a plain box is by far the
 * cheapest Overpass form, where `around:` on a polyline times out on the public server (docs/sources.md); the exact
 * distance to the track is computed here (`landmarks.ts`). Changing the kinds or the distance only filters the cache.
 *
 * Usage policy: one request at a time, cached in memory and in the platform storage, one retry on HTTP 429 / 504 then
 * the next of `OVERPASS_ENDPOINTS`. The POST body is form-encoded so the browser sends a "simple" CORS request:
 * overpass-api.de answers the OPTIONS preflight with 406.
 */
import { cyrb53 } from '../core/math'
import type { LonLat, LonLatBounds, Track } from '../core/types'
import { getPlatform, type KeyValueStore } from '../platform'

/** Main public instance, then VK Maps (no rate limit stated, listed on the OSM wiki); both send CORS headers. */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
] as const

export const OSM_ATTRIBUTION = '© contributeurs OpenStreetMap (ODbL)'

/** Largest landmark distance offered by the UI (metres): the query covers it once and for all. */
export const MAX_LANDMARK_DISTANCE_M = 3000
/** Largest side of one query box before the margin (metres): a longer track gets several boxes along it. */
export const MAX_BOX_SPAN_M = 40_000
/** Simplification tolerance of the track before chunking it into boxes (metres). */
const SIMPLIFY_TOLERANCE_M = 200
/** Server-side time limit of the query (seconds). */
export const QUERY_TIMEOUT_S = 60
/** Wait before retrying a busy server when it sends no Retry-After (milliseconds). */
export const BUSY_RETRY_DELAY_MS = 15_000
/** Persistent cache lifetime (milliseconds): OSM names and summits change slowly. */
export const CACHE_TTL_MS = 30 * 24 * 3600 * 1000

const CACHE_PREFIX = 'openflyover.osm.v1.'

export type OsmKind = 'peak' | 'pass' | 'hut' | 'lake' | 'waterfall' | 'place' | 'viewpoint' | 'glacier' | 'waterPoint'

export const OSM_KINDS: readonly OsmKind[] = [
  'peak',
  'pass',
  'hut',
  'lake',
  'waterfall',
  'place',
  'viewpoint',
  'glacier',
  'waterPoint',
]

/** Name of a drinking water point without one (most fountains and taps have none). */
export const UNNAMED_DRINKING_WATER = 'Eau potable'

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
  /** finer type: `place` value (town / village / hamlet), `volcano`, `wilderness_hut`, `water` value… */
  detail?: string
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/** Metres per degree of latitude (and of longitude at the equator), for the planar approximations below. */
export const M_PER_DEG = 111_320

/** Distance (metres) between two nearby points, equirectangular around `a`. */
export function planarDistanceM(a: LonLat, b: LonLat): number {
  const k = Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot((b.lon - a.lon) * k, b.lat - a.lat) * M_PER_DEG
}

/** Perpendicular distance (metres) of p to segment ab, equirectangular around a. */
export function segmentDistanceM(p: LonLat, a: LonLat, b: LonLat): number {
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

/** Insert points so that no segment is longer than `stepM` (a straight track still gets several boxes). */
function subdivide(points: readonly LonLat[], stepM: number): LonLat[] {
  const out: LonLat[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (i > 0) {
      const a = points[i - 1]
      const n = Math.ceil(planarDistanceM(a, p) / stepM)
      for (let k = 1; k < n; k++) out.push({ lon: a.lon + ((p.lon - a.lon) * k) / n, lat: a.lat + ((p.lat - a.lat) * k) / n })
    }
    out.push(p)
  }
  return out
}

function spanM(b: LonLatBounds): number {
  const k = Math.cos((((b.south + b.north) / 2) * Math.PI) / 180)
  return Math.max((b.east - b.west) * k, b.north - b.south) * M_PER_DEG
}

function expand(b: LonLatBounds, marginM: number): LonLatBounds {
  const dLat = marginM / M_PER_DEG
  const dLon = marginM / (M_PER_DEG * Math.cos((((b.south + b.north) / 2) * Math.PI) / 180))
  return { west: b.west - dLon, south: b.south - dLat, east: b.east + dLon, north: b.north + dLat }
}

/**
 * Boxes covering the track with `marginM` around it: one box, or several along the (simplified) track when
 * it spans more than `maxSpanM`, consecutive boxes sharing a vertex so the corridor has no gap.
 */
export function corridorBoxes(track: Track, marginM = MAX_LANDMARK_DISTANCE_M, maxSpanM = MAX_BOX_SPAN_M): LonLatBounds[] {
  const points = subdivide(simplifyLine(track.segments.flatMap((s) => s.points), SIMPLIFY_TOLERANCE_M), maxSpanM / 4)
  if (points.length === 0) return []
  const boxes: LonLatBounds[] = []
  let box: LonLatBounds = { west: points[0].lon, south: points[0].lat, east: points[0].lon, north: points[0].lat }
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    const grown: LonLatBounds = {
      west: Math.min(box.west, p.lon),
      south: Math.min(box.south, p.lat),
      east: Math.max(box.east, p.lon),
      north: Math.max(box.north, p.lat),
    }
    if (spanM(grown) > maxSpanM && (box.west !== box.east || box.south !== box.north)) {
      boxes.push(box)
      const prev = points[i - 1]
      box = {
        west: Math.min(prev.lon, p.lon),
        south: Math.min(prev.lat, p.lat),
        east: Math.max(prev.lon, p.lon),
        north: Math.max(prev.lat, p.lat),
      }
    } else {
      box = grown
    }
  }
  boxes.push(box)
  return boxes.map((b) => expand(b, marginM))
}

/** Overpass statements of the kinds; every one requires a name except drinking water (named `UNNAMED_DRINKING_WATER`). */
const STATEMENTS: readonly string[] = [
  'node["natural"~"^(peak|volcano|saddle)$"]["name"]',
  'node["mountain_pass"="yes"]["name"]',
  'nwr["tourism"~"^(alpine_hut|wilderness_hut)$"]["name"]',
  'nwr["natural"="water"]["name"]["water"!~"^(river|stream|canal|ditch|drain|wastewater|moat)$"]',
  'node["waterway"="waterfall"]["name"]',
  'node["place"~"^(town|village|hamlet)$"]["name"]',
  'node["tourism"="viewpoint"]["name"]',
  'nwr["natural"="glacier"]["name"]',
  'node["amenity"="drinking_water"]',
  'node["natural"="spring"]["name"]',
]

/** Overpass bounding box filter `(south,west,north,east)`, 1e-5° (~1 m). */
export function overpassBbox(b: LonLatBounds): string {
  return `(${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)})`
}

/** Overpass QL query for the landmarks inside `boxes` (ways and relations reduced to their centre). */
export function buildOverpassQuery(boxes: readonly LonLatBounds[]): string {
  const lines = boxes.flatMap((b) => {
    const bbox = overpassBbox(b)
    return STATEMENTS.map((s) => `  ${s}${bbox};`)
  })
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];\n(\n${lines.join('\n')}\n);\nout center tags qt;\n`
}

/** The query of a track: its corridor boxes, `MAX_LANDMARK_DISTANCE_M` wide. */
export function trackQuery(track: Track): string {
  return buildOverpassQuery(corridorBoxes(track))
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
  if (tags.amenity === 'drinking_water') return { kind: 'waterPoint', detail: 'drinking_water' }
  if (natural === 'spring') return { kind: 'waterPoint', detail: 'spring' }
  return null
}

/** Elements of an Overpass JSON response; throws an `OverpassError` on a server-side error or an unexpected shape. */
export function overpassElements(json: unknown): unknown[] {
  const record = json as { elements?: unknown; remark?: unknown }
  if (typeof record?.remark === 'string' && /error/i.test(record.remark)) throw new OverpassError(record.remark, 0)
  if (!Array.isArray(record?.elements)) throw new OverpassError('réponse Overpass inattendue', 0)
  return record.elements
}

/** Named, classified features of an Overpass JSON response; throws on a server-side error. */
export function parseOverpass(json: unknown): OsmFeature[] {
  const out: OsmFeature[] = []
  for (const element of overpassElements(json) as OverpassElement[]) {
    const tags = element.tags
    if (!tags) continue
    const type = classify(tags)
    if (!type) continue
    const tagged = (tags['name:fr'] ?? tags.name ?? '').trim()
    const name = tagged || (type.detail === 'drinking_water' ? UNNAMED_DRINKING_WATER : '')
    const lat = element.lat ?? element.center?.lat
    const lon = element.lon ?? element.center?.lon
    if (!name || lat === undefined || lon === undefined) continue
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
  storage: KeyValueStore | null
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

const defaultDeps = (): OverpassDeps => ({
  fetch: (...args) => globalThis.fetch(...args),
  sleep: defaultSleep,
  storage: getPlatform().storage,
  now: () => Date.now(),
})

/** The cache key of a query: its 53-bit hash, as hex. */
export function hashQuery(text: string): string {
  return cyrb53(text).toString(16)
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
export async function runOverpassQuery<T = OsmFeature[]>(
  query: string,
  signal?: AbortSignal,
  deps: OverpassDeps = defaultDeps(),
  endpoints: readonly string[] = OVERPASS_ENDPOINTS,
  parse: (json: unknown) => T = parseOverpass as unknown as (json: unknown) => T,
): Promise<T> {
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
      if (response.ok) return parse(await response.json())
      lastError = new OverpassError(`HTTP ${response.status}`, response.status)
      if (response.status !== 429 && response.status !== 504) throw lastError
      if (attempt === 0) await deps.sleep(retryAfterMs(response), signal)
    }
  }
  throw lastError
}

/** One request at a time for the whole application (usage policy: no parallel queries). */
let queue: Promise<unknown> = Promise.resolve()
const memoryCache = new Map<string, Promise<unknown[]>>()

function readCache<T>(storage: OverpassDeps['storage'], key: string, now: number): T[] | null {
  try {
    const raw = storage?.get(CACHE_PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw) as { t: number; features: T[] }
    if (!Array.isArray(entry.features) || !(now - entry.t < CACHE_TTL_MS)) return null
    return entry.features
  } catch {
    return null
  }
}

function writeCache(storage: OverpassDeps['storage'], key: string, features: readonly unknown[], now: number): void {
  if (!storage) return
  const value = JSON.stringify({ t: now, features })
  if (storage.set(CACHE_PREFIX + key, value)) return
  // full: drop our older entries (never other keys) and try once more; if refused again, the memory cache still
  // avoids repeated queries in this session
  for (const k of storage.keys(CACHE_PREFIX)) storage.remove(k)
  storage.set(CACHE_PREFIX + key, value)
}

/**
 * Landmarks near `track` (all kinds, `MAX_LANDMARK_DISTANCE_M` corridor), from the memory cache, the
 * persistent cache or one queued Overpass query. A failed or aborted query is not cached.
 */
export function fetchTrackFeatures(track: Track, signal?: AbortSignal, deps: OverpassDeps = defaultDeps()): Promise<OsmFeature[]> {
  return cachedOverpassQuery(trackQuery(track), parseOverpass, signal, deps)
}

/**
 * Result of `query` parsed by `parse` (a JSON-serialisable list), from the memory cache, the persistent cache or
 * one queued Overpass query (shared by the landmarks and the water, `water.ts`). A failed or aborted query is not
 * cached.
 */
export function cachedOverpassQuery<T>(
  query: string,
  parse: (json: unknown) => T[],
  signal?: AbortSignal,
  deps: OverpassDeps = defaultDeps(),
): Promise<T[]> {
  const key = hashQuery(query)
  const cached = memoryCache.get(key) as Promise<T[]> | undefined
  if (cached) return cached
  const stored = readCache<T>(deps.storage, key, deps.now())
  if (stored) {
    const promise = Promise.resolve(stored)
    memoryCache.set(key, promise)
    return promise
  }
  const promise = queue
    .catch(() => undefined)
    .then(() => runOverpassQuery(query, signal, deps, OVERPASS_ENDPOINTS, parse))
    .then((features) => {
      writeCache(deps.storage, key, features, deps.now())
      return features
    })
  queue = promise.catch(() => undefined)
  memoryCache.set(key, promise)
  promise.catch(() => memoryCache.delete(key))
  // the promise is tied to this caller's signal: once aborted, a later caller must not get its AbortError
  signal?.addEventListener('abort', () => memoryCache.get(key) === promise && memoryCache.delete(key), { once: true })
  return promise
}

/** Forget the memory cache and the queue (tests). */
export function clearOverpassMemoryCache(): void {
  memoryCache.clear()
  queue = Promise.resolve()
}

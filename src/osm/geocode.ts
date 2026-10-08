/**
 * A place typed by the user (« Préparer une sortie »): coordinates read as they are, otherwise one search on the
 * public Nominatim instance of OpenStreetMap (no key). Its usage policy: no search as you type (only on submit), at
 * most one request per second for the whole app (enforced here), the browser's Referer as identification; the
 * results are kept in memory for the session.
 */
import type { LonLat, LonLatBounds } from '../core/types'

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
const MIN_INTERVAL_MS = 1000

export interface Place {
  name: string
  center: LonLat
  /** extent of the place when Nominatim gives one */
  bounds?: LonLatBounds
}

/** « 45.92, 6.87 » or « 45.92 6.87 » (latitude first, as maps show it), decimal degrees; null otherwise. */
export function parseCoordinates(text: string): LonLat | null {
  const m = text.trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1].replace(',', '.'))
  const lon = Number(m[2].replace(',', '.'))
  return Math.abs(lat) <= 85 && Math.abs(lon) <= 180 ? { lon, lat } : null
}

interface NominatimResult {
  lat: string
  lon: string
  display_name: string
  boundingbox?: [string, string, string, string]
}

const cache = new Map<string, Place | null>()
let last = 0

/** The place named `text` (coordinates or a Nominatim search), null when nothing matches. Throws on a network error. */
export async function findPlace(
  text: string,
  signal?: AbortSignal,
  deps: { fetch: typeof fetch; now: () => number; sleep: (ms: number) => Promise<void> } = {
    fetch: (...args) => globalThis.fetch(...args),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
): Promise<Place | null> {
  const query = text.trim()
  const coordinates = parseCoordinates(query)
  if (coordinates) return { name: query, center: coordinates }
  if (!query) return null
  const key = query.toLowerCase()
  if (cache.has(key)) return cache.get(key)!
  const wait = last + MIN_INTERVAL_MS - deps.now()
  last = deps.now() + Math.max(0, wait)
  if (wait > 0) await deps.sleep(wait)
  const url = `${NOMINATIM_URL}?${new URLSearchParams({ format: 'jsonv2', limit: '1', q: query, 'accept-language': 'fr' })}`
  const response = await deps.fetch(url, { signal })
  if (!response.ok) throw new Error(`recherche de lieu impossible (HTTP ${response.status})`)
  const [first] = (await response.json()) as NominatimResult[]
  const place: Place | null = first
    ? {
        name: first.display_name,
        center: { lon: Number(first.lon), lat: Number(first.lat) },
        bounds: first.boundingbox && {
          south: Number(first.boundingbox[0]),
          north: Number(first.boundingbox[1]),
          west: Number(first.boundingbox[2]),
          east: Number(first.boundingbox[3]),
        },
      }
    : null
  cache.set(key, place)
  return place
}

/**
 * Water bodies around a track from OpenStreetMap (Overpass, same client, queue and cache as the landmarks): lakes and
 * river areas as polygons with holes, for the reflective water of the scene (scene/WaterLayer.tsx).
 *
 * One query per track: `natural=water`, `waterway=riverbank` and `water=*` ways and multipolygon relations in the
 * corridor boxes of the track, WATER_MARGIN_M wide, with their full geometry (`out geom`). The response is reduced
 * here (pure): rings of the relations stitched from their member ways, inner rings assigned to their outer ring,
 * rings simplified (WATER_SIMPLIFY_M), small polygons dropped, the largest MAX_WATER_POLYGONS kept, coordinates
 * rounded; only that compact result is cached (localStorage, 30 days).
 */
import type { LonLat, Track } from '../core/types'
import { cachedOverpassQuery, corridorBoxes, OverpassError, QUERY_TIMEOUT_S, simplifyLine, type OverpassDeps } from './overpass'

/** Corridor around the track (metres): the lakes seen from the flyover, not only those it passes by. */
export const WATER_MARGIN_M = 8000
/** Simplification tolerance of the shores (metres). */
export const WATER_SIMPLIFY_M = 4
/** Polygons smaller than this are dropped (m², about a 45 m square). */
export const MIN_WATER_AREA_M2 = 2000
export const MAX_WATER_POLYGONS = 300

/** The user setting (`settings.water`): reflective water from OpenStreetMap, strength 0..1 (opacity, reflections). */
export interface WaterSettings {
  enabled: boolean
  strength: number
}

export const DEFAULT_WATER: WaterSettings = { enabled: true, strength: 1 }

/** A lake (flat surface) or a river area (follows the relief). Rings open (last point ≠ first), [lon, lat]. */
export interface WaterPolygon {
  /** "way/123" or "relation/45" */
  id: string
  kind: 'lake' | 'river'
  outer: [number, number][]
  holes: [number, number][][]
}

/** `water=*` values of flowing water, drawn as rivers. */
const RIVER_WATER = new Set(['river', 'stream', 'canal', 'ditch', 'drain', 'stream_pool', 'rapids', 'lock'])

/** Overpass QL query of the water areas inside the corridor of `track` (full geometry). */
export function waterQuery(track: Track): string {
  const lines = corridorBoxes(track, WATER_MARGIN_M).flatMap((b) => {
    const bbox = `(${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)})`
    return [
      `  way["natural"="water"]${bbox};`,
      `  relation["natural"="water"]["type"="multipolygon"]${bbox};`,
      `  way["waterway"="riverbank"]${bbox};`,
      `  relation["waterway"="riverbank"]["type"="multipolygon"]${bbox};`,
      `  way["water"]${bbox};`,
      `  relation["water"]["type"="multipolygon"]${bbox};`,
    ]
  })
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];\n(\n${lines.join('\n')}\n);\nout geom qt;\n`
}

interface GeomPoint {
  lat: number
  lon: number
}

interface WaterElement {
  type: string
  id: number
  tags?: Record<string, string>
  geometry?: (GeomPoint | null)[]
  members?: { type: string; ref: number; role?: string; geometry?: (GeomPoint | null)[] }[]
}

type Ring = LonLat[]

const M_PER_DEG = 111_320

function kindOf(tags: Record<string, string> = {}): WaterPolygon['kind'] {
  return tags.waterway === 'riverbank' || RIVER_WATER.has(tags.water ?? '') ? 'river' : 'lake'
}

function toRing(geometry: (GeomPoint | null)[] | undefined): LonLat[] {
  return (geometry ?? []).filter((p): p is GeomPoint => p !== null).map((p) => ({ lon: p.lon, lat: p.lat }))
}

const same = (a: LonLat, b: LonLat) => a.lon === b.lon && a.lat === b.lat
const isClosed = (r: Ring) => r.length >= 4 && same(r[0], r[r.length - 1])

/**
 * Closed rings from the member ways of a multipolygon: ways joined end to end (either direction) until the ring
 * closes; what cannot be closed is dropped (incomplete relation).
 */
export function stitchRings(parts: readonly Ring[]): Ring[] {
  const open = parts.filter((p) => p.length >= 2).map((p) => p.slice())
  const rings: Ring[] = []
  while (open.length > 0) {
    let ring = open.pop()!
    while (!isClosed(ring)) {
      const end = ring[ring.length - 1]
      const i = open.findIndex((p) => same(p[0], end) || same(p[p.length - 1], end))
      if (i < 0) break
      const next = open.splice(i, 1)[0]
      ring = ring.concat((same(next[0], end) ? next : next.reverse()).slice(1))
    }
    if (isClosed(ring)) rings.push(ring)
  }
  return rings
}

/** Area of a ring (m², equirectangular around its first point). */
export function ringAreaM2(ring: readonly LonLat[]): number {
  if (ring.length < 3) return 0
  const k = Math.cos((ring[0].lat * Math.PI) / 180) * M_PER_DEG
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].lon - ring[0].lon) * k * ((ring[i].lat - ring[0].lat) * M_PER_DEG)
    sum -= (ring[i].lon - ring[0].lon) * k * ((ring[j].lat - ring[0].lat) * M_PER_DEG)
  }
  return Math.abs(sum) / 2
}

/** Even-odd point in ring test (lon / lat plane). */
export function pointInRing(p: LonLat, ring: readonly LonLat[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside
  }
  return inside
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6

/** Simplified open ring rounded to 1e-6° (~10 cm), or null when too small. */
function finishRing(ring: Ring): [number, number][] | null {
  const simplified = simplifyLine(ring, WATER_SIMPLIFY_M)
  const open = isClosed(simplified) ? simplified.slice(0, -1) : simplified
  if (open.length < 3 || ringAreaM2(open) < MIN_WATER_AREA_M2) return null
  return open.map((p) => [round6(p.lon), round6(p.lat)])
}

function polygonsOf(id: string, kind: WaterPolygon['kind'], outers: Ring[], inners: Ring[]): WaterPolygon[] {
  const out: WaterPolygon[] = []
  const holesOf = outers.map((): Ring[] => [])
  for (const inner of inners) {
    const owner = outers.findIndex((outer) => pointInRing(inner[0], outer))
    if (owner >= 0) holesOf[owner].push(inner)
  }
  outers.forEach((ring, i) => {
    const outer = finishRing(ring)
    if (!outer) return
    const holes = holesOf[i].map(finishRing).filter((h): h is [number, number][] => h !== null)
    out.push({ id: outers.length > 1 ? `${id}#${i}` : id, kind, outer, holes })
  })
  return out
}

/** Water polygons of an Overpass `out geom` response, largest first; throws on a server-side error. */
export function parseWater(json: unknown): WaterPolygon[] {
  const record = json as { elements?: unknown; remark?: unknown }
  if (typeof record?.remark === 'string' && /error/i.test(record.remark)) throw new OverpassError(record.remark, 0)
  if (!Array.isArray(record?.elements)) throw new OverpassError('réponse Overpass inattendue', 0)
  const elements = record.elements as WaterElement[]
  // a way that is also a member of a returned relation is drawn by the relation
  const members = new Set(elements.flatMap((e) => (e.type === 'relation' ? (e.members ?? []).map((m) => m.ref) : [])))
  const polygons: WaterPolygon[] = []
  for (const e of elements) {
    if (e.type === 'way' && !members.has(e.id)) {
      const ring = toRing(e.geometry)
      if (isClosed(ring)) polygons.push(...polygonsOf(`way/${e.id}`, kindOf(e.tags), [ring], []))
    } else if (e.type === 'relation') {
      const ways = (e.members ?? []).filter((m) => m.type === 'way')
      const outers = stitchRings(ways.filter((m) => m.role !== 'inner').map((m) => toRing(m.geometry)))
      const inners = stitchRings(ways.filter((m) => m.role === 'inner').map((m) => toRing(m.geometry)))
      polygons.push(...polygonsOf(`relation/${e.id}`, kindOf(e.tags), outers, inners))
    }
  }
  const area = new Map(polygons.map((p) => [p, ringAreaM2(p.outer.map(([lon, lat]) => ({ lon, lat })))]))
  return polygons.sort((a, b) => area.get(b)! - area.get(a)!).slice(0, MAX_WATER_POLYGONS)
}

/** Water around `track`, from the caches or one queued Overpass query (fair use: see overpass.ts). */
export function fetchTrackWater(track: Track, signal?: AbortSignal, deps?: OverpassDeps): Promise<WaterPolygon[]> {
  return cachedOverpassQuery(waterQuery(track), parseWater, signal, deps)
}

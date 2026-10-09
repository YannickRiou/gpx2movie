/**
 * Administrative region of an outing from OpenStreetMap (Overpass, same client, queue and cache as the landmarks),
 * highlighted by a 'situation' shot (scene/RegionHighlight.tsx) and framed by its region view (flyover/filmCamera.ts).
 *
 * Two small queries, both cached: the administrative boundaries of levels 4 to 6 (région and département in France,
 * canton and district in Switzerland, Land and Kreis in Germany…) whose area contains the centre of the track, with
 * their tags and bounding box only (`is_in`, `out tags bb`); then the full geometry (`out geom`) of the one chosen
 * (`chooseRegion`: the smallest that contains the whole track box and is REGION_MIN_RATIO times larger). Its outer
 * and inner rings are stitched from the member ways and simplified to at most REGION_MAX_POINTS points; only that
 * compact result is cached. No boundary found, offline or a failed query: the shot simply has no highlight.
 */
import { create } from 'zustand'
import type { LonLat, LonLatBounds } from '../core/types'
import { M_PER_DEG, QUERY_TIMEOUT_S, cachedOverpassQuery, overpassElements, simplifyLine, type OverpassDeps } from './overpass'
import { stitchRings } from './water'

/** The chosen region's box diagonal is at least this × the track's (when one is that large). */
export const REGION_MIN_RATIO = 5
/** Points kept over all the rings of the region (the boundary of a canton has tens of thousands). */
export const REGION_MAX_POINTS = 2000

/** A boundary containing the centre of the track: OSM relation id, admin_level, name and box. */
export interface AdminCandidate {
  id: number
  level: number
  name: string
  bounds: LonLatBounds
}

/** The highlighted region: rings open (last point ≠ first), [lon, lat], outer and inner alike (even-odd fill). */
export interface AdminRegion {
  /** "relation/123" */
  id: string
  name: string
  bounds: LonLatBounds
  rings: [number, number][][]
}

/** Name shown: the bilingual `name` as is (« Valais/Wallis »), else the French name when tagged, else `name`. */
export function regionName(tags: Record<string, string>): string {
  const name = (tags.name ?? '').trim()
  if (name.includes('/')) return name
  return (tags['name:fr'] ?? '').trim() || name
}

/** Diagonal of a lon/lat box, metres (equirectangular at its middle latitude). */
export function boxDiagonalM(b: LonLatBounds): number {
  const k = Math.cos((((b.south + b.north) / 2) * Math.PI) / 180)
  return Math.hypot((b.east - b.west) * k, b.north - b.south) * M_PER_DEG
}

/** Box of points (a boundary has too many of them to spread into Math.min). */
function boxOf(points: readonly LonLat[]): LonLatBounds {
  const box = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity }
  for (const p of points) {
    box.west = Math.min(box.west, p.lon)
    box.east = Math.max(box.east, p.lon)
    box.south = Math.min(box.south, p.lat)
    box.north = Math.max(box.north, p.lat)
  }
  return box
}

const contains = (outer: LonLatBounds, inner: LonLatBounds) =>
  inner.west >= outer.west && inner.east <= outer.east && inner.south >= outer.south && inner.north <= outer.north

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/** Overpass QL query of the administrative boundaries (levels 4 to 6) around `point`: tags and box only. */
export function regionCandidatesQuery(point: LonLat): string {
  return (
    `[out:json][timeout:${QUERY_TIMEOUT_S}];\n` +
    `is_in(${point.lat.toFixed(5)},${point.lon.toFixed(5)})->.a;\n` +
    `rel(pivot.a)["boundary"="administrative"]["admin_level"~"^[456]$"];\n` +
    `out tags bb qt;\n`
  )
}

interface RegionElement {
  type: string
  id: number
  tags?: Record<string, string>
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number }
  members?: { type: string; role?: string; geometry?: ({ lat: number; lon: number } | null)[] }[]
}

/** Named boundaries of a candidates response; throws on a server-side error. */
export function parseRegionCandidates(json: unknown): AdminCandidate[] {
  const out: AdminCandidate[] = []
  for (const e of overpassElements(json) as RegionElement[]) {
    const level = Number(e.tags?.admin_level)
    const name = e.tags ? regionName(e.tags) : ''
    if (e.type !== 'relation' || !e.bounds || !name || !Number.isFinite(level)) continue
    const { minlat, minlon, maxlat, maxlon } = e.bounds
    out.push({ id: e.id, level, name, bounds: { west: minlon, south: minlat, east: maxlon, north: maxlat } })
  }
  return out
}

/**
 * Region to highlight for a track of box `track`: among the boundaries containing the whole box, the smallest that is
 * REGION_MIN_RATIO × larger (diagonals), else the largest; null when none contains it (a track across a border).
 */
export function chooseRegion(candidates: readonly AdminCandidate[], track: LonLatBounds): AdminCandidate | null {
  const containing = candidates
    .filter((c) => contains(c.bounds, track))
    .sort((a, b) => boxDiagonalM(a.bounds) - boxDiagonalM(b.bounds))
  const wanted = REGION_MIN_RATIO * boxDiagonalM(track)
  return containing.find((c) => boxDiagonalM(c.bounds) >= wanted) ?? containing.at(-1) ?? null
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Overpass QL query of the full geometry of the boundary relation `id`. */
export function regionGeometryQuery(id: number): string {
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];\nrel(${id});\nout geom qt;\n`
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5

/**
 * Closed rings simplified together to at most `maxPoints` points: Douglas-Peucker from a tolerance of 1/5000 of the
 * box diagonal, doubled until they fit; rings left with fewer than three points are dropped. Returned open, rounded
 * to 1e-5° (~1 m).
 */
export function simplifyRings(rings: readonly LonLat[][], maxPoints = REGION_MAX_POINTS): [number, number][][] {
  if (rings.length === 0) return []
  let toleranceM = Math.max(1, boxDiagonalM(boxOf(rings.flat())) / 5000)
  for (;;) {
    // a closed ring keeps its first point twice: drop the copy
    const simplified = rings.map((r) => simplifyLine(r, toleranceM).slice(0, -1)).filter((r) => r.length >= 3)
    if (simplified.reduce((n, r) => n + r.length, 0) <= maxPoints) {
      return simplified.map((r) => r.map((p): [number, number] => [round5(p.lon), round5(p.lat)]))
    }
    toleranceM *= 2
  }
}

const toRing = (geometry: ({ lat: number; lon: number } | null)[] | undefined): LonLat[] =>
  (geometry ?? []).filter((p) => p !== null).map((p) => ({ lon: p.lon, lat: p.lat }))

/** The region of a geometry response (a list of at most one, for the cache); throws on a server-side error. */
export function parseRegionGeometry(json: unknown): AdminRegion[] {
  const relation = (overpassElements(json) as RegionElement[]).find((e) => e.type === 'relation')
  if (!relation) return []
  const ways = (relation.members ?? []).filter((m) => m.type === 'way' && m.role !== 'subarea')
  const rings = simplifyRings([
    ...stitchRings(ways.filter((m) => m.role !== 'inner').map((m) => toRing(m.geometry))),
    ...stitchRings(ways.filter((m) => m.role === 'inner').map((m) => toRing(m.geometry))),
  ])
  if (rings.length === 0) return []
  const bounds = boxOf(rings.flat().map(([lon, lat]) => ({ lon, lat })))
  return [{ id: `relation/${relation.id}`, name: regionName(relation.tags ?? {}), bounds, rings }]
}

/** Region to highlight for a track of box `track`, from the caches or two queued Overpass queries; null when none. */
export async function fetchRegion(track: LonLatBounds, signal?: AbortSignal, deps?: OverpassDeps): Promise<AdminRegion | null> {
  const centre = { lon: (track.west + track.east) / 2, lat: (track.south + track.north) / 2 }
  const candidates = await cachedOverpassQuery(regionCandidatesQuery(centre), parseRegionCandidates, signal, deps)
  const chosen = chooseRegion(candidates, track)
  if (!chosen) return null
  const [region] = await cachedOverpassQuery(regionGeometryQuery(chosen.id), parseRegionGeometry, signal, deps)
  return region ?? null
}

/** Centre and size (metres) of the region's box: what the region view frames (flyover/filmCamera.ts `RegionFrame`). */
export function regionFrame(region: AdminRegion): { centre: LonLat; widthM: number; heightM: number } {
  const { west, south, east, north } = region.bounds
  const k = Math.cos((((south + north) / 2) * Math.PI) / 180)
  return {
    centre: { lon: (west + east) / 2, lat: (south + north) / 2 },
    widthM: (east - west) * k * M_PER_DEG,
    heightM: (north - south) * M_PER_DEG,
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/** 'none': no boundary contains the track; 'error': the query failed (offline, busy server). */
export type RegionStatus = 'idle' | 'loading' | 'ready' | 'none' | 'error'

export interface RegionState {
  /** box of the track the region was asked for ("west,south,east,north"), null when not wanted */
  key: string | null
  status: RegionStatus
  region: AdminRegion | null
  /** `regionFrame(region)`, computed once */
  frame: ReturnType<typeof regionFrame> | null
}

export const useRegionStore = create<RegionState>()(() => ({ key: null, status: 'idle', region: null, frame: null }))

let controller: AbortController | null = null
/** `holdRegion`: an answer arriving meanwhile waits in `heldAnswer` */
let holding = false
let heldAnswer: Partial<RegionState> | null = null

/**
 * While the video export renders (`holdRegion(true)` at its start, false at its end), a region answer arriving is
 * kept aside and applied afterwards: the export camera and the highlight keep the region they started with (none if
 * it was still loading), the framing never changes in the middle of a film.
 */
export function holdRegion(hold: boolean): void {
  holding = hold
  if (hold || !heldAnswer) return
  const answer = heldAnswer
  heldAnswer = null
  useRegionStore.setState(answer)
}

/**
 * Bring the region in line with the track box shown and whether a shot highlights it: fetched once per box (cached),
 * forgotten when no longer wanted. Idempotent: React effects may call it on every change.
 */
export function syncRegion(track: LonLatBounds | null, wanted: boolean, fetch = fetchRegion): void {
  const key = wanted && track ? [track.west, track.south, track.east, track.north].join(',') : null
  if (useRegionStore.getState().key === key) return
  controller?.abort()
  controller = null
  heldAnswer = null
  if (!track || key === null) {
    useRegionStore.setState({ key: null, status: 'idle', region: null, frame: null })
    return
  }
  const ctrl = (controller = new AbortController())
  useRegionStore.setState({ key, status: 'loading', region: null, frame: null })
  const answer = (state: Partial<RegionState>) => {
    if (controller !== ctrl) return
    if (holding) heldAnswer = state
    else useRegionStore.setState(state)
  }
  fetch(track, ctrl.signal).then(
    (region) => answer({ status: region ? 'ready' : 'none', region, frame: region ? regionFrame(region) : null }),
    () => answer({ status: 'error' }),
  )
}

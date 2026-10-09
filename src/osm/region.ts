/**
 * Region of an outing from OpenStreetMap (Overpass, same client, queue and cache as the landmarks), highlighted by a
 * 'situation' shot (scene/RegionHighlight.tsx) and framed by its region view (flyover/filmCamera.ts).
 *
 * Two small queries, both cached: the areas that contain the centre of the track, with their tags and bounding box
 * only (`is_in`, `out tags bb`): administrative boundaries of levels 4 to 6 (région and département in France, canton
 * and district in Switzerland, Land and Kreis in Germany…), national parks, protected areas and nature reserves
 * (« Parc naturel régional »), islands, mountain ranges mapped as areas; then the full geometry (`out geom`) of the
 * one chosen: the place picked in the shot (« Lieu », `regionId`) while it still contains the track, else the
 * automatic choice (`chooseRegion`: among the administrative ones, the smallest that contains the whole track box and
 * is REGION_MIN_RATIO times larger). Its outer and inner rings are stitched from the member ways (a closed way is a
 * ring of its own) and simplified to at most REGION_MAX_POINTS points; only that compact result is cached. No area
 * found, offline or a failed query: the shot simply has no highlight.
 */
import { create } from 'zustand'
import type { LonLat, LonLatBounds } from '../core/types'
import { M_PER_DEG, QUERY_TIMEOUT_S, cachedOverpassQuery, overpassElements, simplifyLine, type OverpassDeps } from './overpass'
import { stitchRings } from './water'

/** The chosen region's box diagonal is at least this × the track's (when one is that large). */
export const REGION_MIN_RATIO = 5
/** Points kept over all the rings of the region (the boundary of a canton has tens of thousands). */
export const REGION_MAX_POINTS = 2000

/**
 * What an area is: an administrative boundary (levels 4 to 6), a national park, a protected area or a nature reserve
 * (« Parc naturel régional » in France), an island, a mountain range.
 */
export type RegionKind = 'admin' | 'parc' | 'protege' | 'ile' | 'massif'
export const REGION_KIND_LABELS: Record<RegionKind, string> = {
  admin: 'limite administrative',
  parc: 'parc national',
  protege: 'espace protégé',
  ile: 'île',
  massif: 'massif',
}

/** An area containing the centre of the track: OSM element, kind, admin_level (NaN when not administrative), name and box. */
export interface AdminCandidate {
  type: 'relation' | 'way'
  id: number
  kind: RegionKind
  level: number
  name: string
  bounds: LonLatBounds
}

/** Id of an area as a shot stores it (`regionId`) and as `AdminRegion.id` reads: "relation/123", "way/45". */
export const candidateId = (c: Pick<AdminCandidate, 'type' | 'id'>): string => `${c.type}/${c.id}`

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

/** Overpass QL query of the areas around `point` that may situate it (`regionKind`): tags and box only. */
export function regionCandidatesQuery(point: LonLat): string {
  return (
    `[out:json][timeout:${QUERY_TIMEOUT_S}];\n` +
    `is_in(${point.lat.toFixed(5)},${point.lon.toFixed(5)})->.a;\n` +
    `(\n` +
    `  rel(pivot.a)["boundary"="administrative"]["admin_level"~"^[456]$"];\n` +
    `  wr(pivot.a)["boundary"~"^(national_park|protected_area)$"];\n` +
    `  wr(pivot.a)["leisure"="nature_reserve"];\n` +
    `  wr(pivot.a)["place"="island"];\n` +
    `  wr(pivot.a)["natural"="mountain_range"];\n` +
    `);\n` +
    `out tags bb qt;\n`
  )
}

/** Kind of an area from its tags, null when it is none of those asked for. */
export function regionKind(tags: Record<string, string>): RegionKind | null {
  if (tags.boundary === 'administrative') return /^[456]$/.test(tags.admin_level ?? '') ? 'admin' : null
  if (tags.boundary === 'national_park') return 'parc'
  if (tags.boundary === 'protected_area' || tags.leisure === 'nature_reserve') return 'protege'
  if (tags.place === 'island') return 'ile'
  if (tags.natural === 'mountain_range') return 'massif'
  return null
}

type Geometry = ({ lat: number; lon: number } | null)[]

interface RegionElement {
  type: string
  id: number
  tags?: Record<string, string>
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number }
  geometry?: Geometry
  members?: { type: string; role?: string; geometry?: Geometry }[]
}

/** Named areas of a candidates response (relations; closed ways too, except boundaries); throws on a server-side error. */
export function parseRegionCandidates(json: unknown): AdminCandidate[] {
  const out: AdminCandidate[] = []
  for (const e of overpassElements(json) as RegionElement[]) {
    const kind = e.tags ? regionKind(e.tags) : null
    const name = e.tags ? regionName(e.tags) : ''
    const type = e.type === 'relation' ? 'relation' : e.type === 'way' && kind !== 'admin' ? 'way' : null
    if (!type || !kind || !e.bounds || !name) continue
    const { minlat, minlon, maxlat, maxlon } = e.bounds
    const level = kind === 'admin' ? Number(e.tags?.admin_level) : NaN
    out.push({ type, id: e.id, kind, level, name, bounds: { west: minlon, south: minlat, east: maxlon, north: maxlat } })
  }
  return out
}

/** The areas that contain the whole track box `track`, smallest first (box diagonals; ties by id: deterministic). */
export function containingRegions(candidates: readonly AdminCandidate[], track: LonLatBounds): AdminCandidate[] {
  return candidates
    .filter((c) => contains(c.bounds, track))
    .sort((a, b) => boxDiagonalM(a.bounds) - boxDiagonalM(b.bounds) || candidateId(a).localeCompare(candidateId(b)))
}

/**
 * Region highlighted automatically for a track of box `track`: among the administrative boundaries containing the
 * whole box, the smallest that is REGION_MIN_RATIO × larger (diagonals), else the largest; null when none contains it
 * (a track across a border). Parks, islands and ranges are only offered in the « Lieu » list.
 */
export function chooseRegion(candidates: readonly AdminCandidate[], track: LonLatBounds): AdminCandidate | null {
  const containing = containingRegions(
    candidates.filter((c) => c.kind === 'admin'),
    track,
  )
  const wanted = REGION_MIN_RATIO * boxDiagonalM(track)
  return containing.find((c) => boxDiagonalM(c.bounds) >= wanted) ?? containing.at(-1) ?? null
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Overpass QL query of the full geometry of the area `id`: a relation, or a closed way. */
export function regionGeometryQuery(id: number, type: AdminCandidate['type'] = 'relation'): string {
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];\n${type === 'way' ? 'way' : 'rel'}(${id});\nout geom qt;\n`
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

const toRing = (geometry: Geometry | undefined): LonLat[] =>
  (geometry ?? []).filter((p) => p !== null).map((p) => ({ lon: p.lon, lat: p.lat }))

/** The region of a geometry response (a list of at most one, for the cache); throws on a server-side error. */
export function parseRegionGeometry(json: unknown): AdminRegion[] {
  const element = (overpassElements(json) as RegionElement[]).find((e) => e.type === 'relation' || e.type === 'way')
  if (!element) return []
  const ways = (element.members ?? []).filter((m) => m.type === 'way' && m.role !== 'subarea')
  const rings = simplifyRings(
    element.type === 'way'
      ? stitchRings([toRing(element.geometry)])
      : [
          ...stitchRings(ways.filter((m) => m.role !== 'inner').map((m) => toRing(m.geometry))),
          ...stitchRings(ways.filter((m) => m.role === 'inner').map((m) => toRing(m.geometry))),
        ],
  )
  if (rings.length === 0) return []
  const bounds = boxOf(rings.flat().map(([lon, lat]) => ({ lon, lat })))
  return [{ id: `${element.type}/${element.id}`, name: regionName(element.tags ?? {}), bounds, rings }]
}

/** The areas around a track and the region chosen among them (`fetchRegion`). */
export interface RegionAnswer {
  /** areas containing the whole track box, smallest first (`containingRegions`) */
  candidates: AdminCandidate[]
  /** id of the automatic choice (`chooseRegion`), null when there is none */
  autoId: string | null
  region: AdminRegion | null
}

/**
 * Region to highlight for a track of box `track`: the area `regionId` while it contains the track, else the automatic
 * choice, from the caches or two queued Overpass queries (the geometry of the chosen area only).
 */
export async function fetchRegion(
  track: LonLatBounds,
  regionId: string | null = null,
  signal?: AbortSignal,
  deps?: OverpassDeps,
): Promise<RegionAnswer> {
  const centre = { lon: (track.west + track.east) / 2, lat: (track.south + track.north) / 2 }
  const all = await cachedOverpassQuery(regionCandidatesQuery(centre), parseRegionCandidates, signal, deps)
  const candidates = containingRegions(all, track)
  const auto = chooseRegion(all, track)
  const chosen = candidates.find((c) => candidateId(c) === regionId) ?? auto
  const listed = { candidates, autoId: auto ? candidateId(auto) : null }
  if (!chosen) return { ...listed, region: null }
  const [region] = await cachedOverpassQuery(regionGeometryQuery(chosen.id, chosen.type), parseRegionGeometry, signal, deps)
  return { ...listed, region: region ?? null }
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
  /** box of the track the region was asked for ("west,south,east,north") and the place chosen ("|relation/12", "|" for automatic), null when not wanted */
  key: string | null
  status: RegionStatus
  region: AdminRegion | null
  /** `regionFrame(region)`, computed once */
  frame: ReturnType<typeof regionFrame> | null
  /** the areas offered in « Lieu » (smallest first) and the automatic one; kept while another place of the same track loads */
  candidates: AdminCandidate[]
  autoId: string | null
}

const NO_REGION: Omit<RegionState, 'key'> = { status: 'idle', region: null, frame: null, candidates: [], autoId: null }

export const useRegionStore = create<RegionState>()(() => ({ key: null, ...NO_REGION }))

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
 * Bring the region in line with the track box shown, whether a shot highlights it and the place chosen (`regionId`,
 * null: automatic): fetched once per box and place (cached), forgotten when no longer wanted. Idempotent: React
 * effects may call it on every change.
 */
export function syncRegion(
  track: LonLatBounds | null,
  wanted: boolean,
  regionId: string | null = null,
  fetch: (track: LonLatBounds, regionId: string | null, signal: AbortSignal) => Promise<RegionAnswer> = fetchRegion,
): void {
  const box = track ? [track.west, track.south, track.east, track.north].join(',') : ''
  const key = wanted && track ? `${box}|${regionId ?? ''}` : null
  const before = useRegionStore.getState()
  if (before.key === key) return
  controller?.abort()
  controller = null
  heldAnswer = null
  if (!track || key === null) {
    useRegionStore.setState({ key: null, ...NO_REGION })
    return
  }
  const ctrl = (controller = new AbortController())
  // another place for the same track: the list stays while it loads
  const listed = before.key?.split('|')[0] === box ? {} : { candidates: [], autoId: null }
  useRegionStore.setState({ key, status: 'loading', region: null, frame: null, ...listed })
  const answer = (state: Partial<RegionState>) => {
    if (controller !== ctrl) return
    if (holding) heldAnswer = state
    else useRegionStore.setState(state)
  }
  fetch(track, regionId, ctrl.signal).then(
    ({ region, candidates, autoId }) =>
      answer({ status: region ? 'ready' : 'none', region, frame: region ? regionFrame(region) : null, candidates, autoId }),
    () => answer({ status: 'error' }),
  )
}

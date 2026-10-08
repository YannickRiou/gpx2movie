/**
 * Paths and roads from OpenStreetMap (Overpass, same client, queue and cache as the landmarks and the water), for the
 * route planner (`src/route/`): every `highway` way of a box, except motorways, trunks and private or closed ways,
 * with its full geometry (`out geom`). The response is reduced here (pure) to the highway value and the rounded
 * coordinates of each way; only that compact result is cached (localStorage, 30 days).
 *
 * The box is snapped outwards to a PATHS_GRID_DEG grid, so that moving a point a little reuses the cached query.
 */
import type { LonLatBounds } from '../core/types'
import { QUERY_TIMEOUT_S, cachedOverpassQuery, overpassBbox, overpassElements, type OverpassDeps } from './overpass'

/** Grid (degrees, ~2 km) the queried box is snapped to. */
export const PATHS_GRID_DEG = 0.02
/** Largest box side (degrees, ~33 km of latitude): beyond, the response gets too large for the browser cache. */
export const MAX_PATHS_SPAN_DEG = 0.3

/** One way: `highway` value and its points, [lon, lat] rounded to 1e-5° (~1 m). */
export interface OsmWay {
  hw: string
  c: [number, number][]
}

const EXCLUDED_HIGHWAYS = '^(motorway|motorway_link|trunk|trunk_link|construction|proposed|abandoned|raceway|bus_guideway|platform|elevator|corridor)$'

/** `b` grown outwards to the PATHS_GRID_DEG grid. */
export function snapBounds(b: LonLatBounds): LonLatBounds {
  const down = (v: number) => Math.round(Math.floor(v / PATHS_GRID_DEG) * PATHS_GRID_DEG * 1e5) / 1e5
  const up = (v: number) => Math.round(Math.ceil(v / PATHS_GRID_DEG) * PATHS_GRID_DEG * 1e5) / 1e5
  return { west: down(b.west), south: down(b.south), east: up(b.east), north: up(b.north) }
}

/** Overpass QL query of the usable ways inside `b` (snapped), full geometry. */
export function pathsQuery(b: LonLatBounds): string {
  const bbox = overpassBbox(snapBounds(b))
  const way = `way["highway"]["highway"!~"${EXCLUDED_HIGHWAYS}"]["access"!~"^(private|no)$"]["foot"!~"^(no|private)$"]`
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];\n${way}${bbox};\nout geom qt;\n`
}

interface PathElement {
  type: string
  tags?: Record<string, string>
  geometry?: ({ lat: number; lon: number } | null)[]
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5

/** Ways of an Overpass JSON response; throws on a server-side error. */
export function parsePaths(json: unknown): OsmWay[] {
  const ways: OsmWay[] = []
  for (const element of overpassElements(json) as PathElement[]) {
    const hw = element.tags?.highway
    if (element.type !== 'way' || !hw || !element.geometry) continue
    const c: [number, number][] = []
    for (const p of element.geometry) if (p) c.push([round5(p.lon), round5(p.lat)])
    if (c.length >= 2) ways.push({ hw, c })
  }
  return ways
}

/** Ways inside `b`, from the caches or one queued Overpass query (fair use: see overpass.ts). */
export function fetchPaths(b: LonLatBounds, signal?: AbortSignal, deps?: OverpassDeps): Promise<OsmWay[]> {
  return cachedOverpassQuery(pathsQuery(b), parsePaths, signal, deps)
}

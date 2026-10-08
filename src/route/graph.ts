/**
 * Walking routes on the OpenStreetMap ways (`osm/paths.ts`), computed here (pure): a graph whose nodes are the way
 * points (ways meet where they share a point: same rounded coordinates), whose edges are weighted by their length
 * times a factor of the highway type (paths and tracks preferred to busy roads), and an A* search between points.
 */
import type { LonLat } from '../core/types'
import { planarDistanceM } from '../osm/overpass'
import type { OsmWay } from '../osm/paths'

/** Snapping distance (metres): a placed point farther than this from any way is refused. */
export const MAX_SNAP_M = 500

/** Cost per metre of each highway type, for someone on foot (1 = preferred). Unknown types: 1.3. */
const HIGHWAY_FACTOR: Readonly<Record<string, number>> = {
  path: 1,
  footway: 1,
  track: 1,
  bridleway: 1,
  steps: 1.1,
  pedestrian: 1,
  living_street: 1.1,
  cycleway: 1.2,
  service: 1.2,
  residential: 1.2,
  unclassified: 1.3,
  tertiary: 1.6,
  tertiary_link: 1.6,
  secondary: 2,
  secondary_link: 2,
  primary: 3,
  primary_link: 3,
}

export interface RouteGraph {
  lon: Float64Array
  lat: Float64Array
  /** neighbours of node i: `edges[i]` as pairs [node, cost] flattened */
  edges: number[][]
}

/** Graph of `ways`: one node per distinct point, two directed edges per segment. */
export function buildGraph(ways: readonly OsmWay[]): RouteGraph {
  const index = new Map<string, number>()
  const lon: number[] = []
  const lat: number[] = []
  const edges: number[][] = []
  const node = ([x, y]: [number, number]) => {
    const key = `${x},${y}`
    let i = index.get(key)
    if (i === undefined) {
      i = lon.length
      index.set(key, i)
      lon.push(x)
      lat.push(y)
      edges.push([])
    }
    return i
  }
  for (const way of ways) {
    const factor = HIGHWAY_FACTOR[way.hw] ?? 1.3
    let prev = node(way.c[0])
    for (let k = 1; k < way.c.length; k++) {
      const next = node(way.c[k])
      if (next === prev) continue
      const cost = planarDistanceM({ lon: lon[prev], lat: lat[prev] }, { lon: lon[next], lat: lat[next] }) * factor
      edges[prev].push(next, cost)
      edges[next].push(prev, cost)
      prev = next
    }
  }
  return { lon: Float64Array.from(lon), lat: Float64Array.from(lat), edges }
}

/** Node nearest to `p` and its distance (metres); null for an empty graph. */
export function nearestNode(graph: RouteGraph, p: LonLat): { node: number; distanceM: number } | null {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < graph.lon.length; i++) {
    if (graph.edges[i].length === 0) continue
    const d = planarDistanceM(p, { lon: graph.lon[i], lat: graph.lat[i] })
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best < 0 ? null : { node: best, distanceM: bestD }
}

/** Binary min-heap of node ids keyed by a priority array. */
class Heap {
  private items: number[] = []
  private readonly key: Float64Array
  constructor(key: Float64Array) {
    this.key = key
  }
  get size(): number {
    return this.items.length
  }
  push(n: number): void {
    const a = this.items
    a.push(n)
    let i = a.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.key[a[parent]] <= this.key[a[i]]) break
      ;[a[parent], a[i]] = [a[i], a[parent]]
      i = parent
    }
  }
  pop(): number {
    const a = this.items
    const top = a[0]
    const last = a.pop()!
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && this.key[a[l]] < this.key[a[m]]) m = l
        if (r < a.length && this.key[a[r]] < this.key[a[m]]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
}

/** Cheapest path from node `from` to node `to` (A*, straight-line heuristic), as node ids; null when disconnected. */
export function shortestPath(graph: RouteGraph, from: number, to: number): number[] | null {
  const n = graph.lon.length
  const g = new Float64Array(n).fill(Infinity)
  const f = new Float64Array(n).fill(Infinity)
  const previous = new Int32Array(n).fill(-1)
  const done = new Uint8Array(n)
  const goal = { lon: graph.lon[to], lat: graph.lat[to] }
  const h = (i: number) => planarDistanceM({ lon: graph.lon[i], lat: graph.lat[i] }, goal)
  const open = new Heap(f)
  g[from] = 0
  f[from] = h(from)
  open.push(from)
  while (open.size > 0) {
    const current = open.pop()
    if (done[current]) continue
    if (current === to) break
    done[current] = 1
    const e = graph.edges[current]
    for (let k = 0; k < e.length; k += 2) {
      const next = e[k]
      const cost = g[current] + e[k + 1]
      if (cost < g[next]) {
        g[next] = cost
        f[next] = cost + h(next)
        previous[next] = current
        open.push(next)
      }
    }
  }
  if (g[to] === Infinity) return null
  const path = [to]
  while (path[path.length - 1] !== from) path.push(previous[path[path.length - 1]])
  return path.reverse()
}

export class RouteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RouteError'
  }
}

/**
 * Route through `points` (at least two) along the ways: each point snapped to its nearest way point, then the
 * cheapest path between consecutive points. Throws a `RouteError` (French message) when a point is too far from any
 * way or two points are not connected.
 */
export function routeThrough(graph: RouteGraph, points: readonly LonLat[]): LonLat[] {
  if (points.length < 2) throw new RouteError('Placez au moins un départ et une arrivée.')
  const nodes = points.map((p, i) => {
    const near = nearestNode(graph, p)
    if (!near || near.distanceM > MAX_SNAP_M) throw new RouteError(`Le point ${i + 1} est à plus de ${MAX_SNAP_M} m d'un chemin.`)
    return near.node
  })
  const route: number[] = [nodes[0]]
  for (let i = 1; i < nodes.length; i++) {
    const leg = shortestPath(graph, nodes[i - 1], nodes[i])
    if (!leg) throw new RouteError(`Aucun chemin ne relie le point ${i} au point ${i + 1}.`)
    route.push(...leg.slice(1))
  }
  return route.map((i) => ({ lon: graph.lon[i], lat: graph.lat[i] }))
}

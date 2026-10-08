import { describe, expect, it } from 'vitest'
import { findPlace, parseCoordinates } from '../osm/geocode'
import { pathsQuery, parsePaths, snapBounds } from '../osm/paths'
import { RouteError, buildGraph, nearestNode, routeThrough, shortestPath } from './graph'
import { computeRouteTrack, useRouteStore } from './planner'

// a square of ways 0.01° (~800 m × 1.1 km) wide: a path on the west and north sides, a primary road on the east and
// south sides; the diagonal corners are joined both ways
const W = 6.85
const S = 45.9
const E = 6.86
const N = 45.91
const WAYS = [
  { hw: 'path', c: [[W, S], [W, N]] as [number, number][] },
  { hw: 'path', c: [[W, N], [E, N]] as [number, number][] },
  { hw: 'primary', c: [[W, S], [E, S]] as [number, number][] },
  { hw: 'primary', c: [[E, S], [E, N]] as [number, number][] },
]

describe('paths query and parsing', () => {
  it('snaps the box outwards to the grid and filters the ways', () => {
    expect(snapBounds({ west: 6.851, south: 45.901, east: 6.859, north: 45.909 })).toEqual({ west: 6.84, south: 45.9, east: 6.86, north: 45.92 })
    const query = pathsQuery({ west: 6.851, south: 45.901, east: 6.859, north: 45.909 })
    expect(query).toContain('way["highway"]["highway"!~"^(motorway|')
    expect(query).toContain('(45.90000,6.84000,45.92000,6.86000)')
    expect(query).toContain('out geom qt;')
  })

  it('keeps the highway value and rounded points of each way', () => {
    const json = {
      elements: [
        { type: 'way', id: 1, tags: { highway: 'path' }, geometry: [{ lat: 45.900001, lon: 6.850004 }, null, { lat: 45.91, lon: 6.85 }] },
        { type: 'way', id: 2, tags: { highway: 'track' }, geometry: [{ lat: 45.9, lon: 6.85 }] },
        { type: 'node', id: 3, tags: { highway: 'crossing' } },
      ],
    }
    expect(parsePaths(json)).toEqual([{ hw: 'path', c: [[6.85, 45.9], [6.85, 45.91]] }])
  })
})

describe('routing', () => {
  const graph = buildGraph(WAYS)

  it('joins ways at their shared points', () => {
    expect(graph.lon.length).toBe(4)
    expect(nearestNode(graph, { lon: W + 0.0001, lat: S })?.distanceM).toBeLessThan(10)
  })

  it('prefers the paths to the road', () => {
    const from = nearestNode(graph, { lon: W, lat: S })!.node
    const to = nearestNode(graph, { lon: E, lat: N })!.node
    const path = shortestPath(graph, from, to)!
    expect(path.map((i) => [graph.lon[i], graph.lat[i]])).toEqual([[W, S], [W, N], [E, N]])
  })

  it('goes through every placed point, in order', () => {
    const route = routeThrough(graph, [
      { lon: W, lat: S },
      { lon: E, lat: S + 0.0001 },
      { lon: E, lat: N },
    ])
    expect(route).toEqual([
      { lon: W, lat: S },
      { lon: E, lat: S },
      { lon: E, lat: N },
    ])
  })

  it('refuses a point far from any way, or points that are not connected', () => {
    expect(() => routeThrough(graph, [{ lon: W, lat: S }, { lon: W + 0.05, lat: S }])).toThrow(RouteError)
    const apart = buildGraph([...WAYS, { hw: 'path', c: [[7, 46], [7.001, 46]] }])
    expect(() => routeThrough(apart, [{ lon: W, lat: S }, { lon: 7.001, lat: 46 }])).toThrow(/Aucun chemin/)
    expect(() => routeThrough(graph, [{ lon: W, lat: S }])).toThrow(/départ et une arrivée/)
  })
})

describe('computeRouteTrack', () => {
  const deps = {
    fetchPaths: async () => WAYS,
    fetchHeights: async (points: readonly unknown[]) => points.map((_, i) => (i === 0 ? undefined : 1000 + i)),
  }

  it('builds a track without times, with heights and the placed points as waypoints', async () => {
    const placed = [{ lon: W, lat: S }, { lon: W, lat: N }, { lon: E, lat: N }]
    const track = await computeRouteTrack(placed, { terrainSourceId: 'mapterhorn' }, deps)
    const points = track.segments[0].points
    expect(points[0]).toEqual({ lon: W, lat: S })
    expect(points[1].ele).toBe(1001)
    expect(track.stats.distanceM).toBeGreaterThan(1800)
    expect(track.stats.durationS).toBeUndefined()
    expect(track.waypoints?.map((w) => w.name)).toEqual(['Départ', 'Étape 1', 'Arrivée'])
  })

  it('refuses points too far apart, and an area without ways', async () => {
    await expect(computeRouteTrack([{ lon: 6, lat: 45 }, { lon: 6.5, lat: 45 }], { terrainSourceId: 'mapterhorn' }, deps)).rejects.toThrow(/trop éloignés/)
    await expect(
      computeRouteTrack([{ lon: W, lat: S }, { lon: E, lat: N }], { terrainSourceId: 'mapterhorn' }, { ...deps, fetchPaths: async () => [] }),
    ).rejects.toThrow(/Aucun chemin/)
  })
})

describe('useRouteStore', () => {
  it('adds, moves, removes and reloads points', () => {
    const store = useRouteStore.getState()
    store.clear()
    store.add({ lon: 1, lat: 1 })
    store.add({ lon: 2, lat: 2 })
    useRouteStore.getState().move(1, -1)
    expect(useRouteStore.getState().points).toEqual([{ lon: 2, lat: 2 }, { lon: 1, lat: 1 }])
    useRouteStore.getState().remove(0)
    expect(useRouteStore.getState().points).toEqual([{ lon: 1, lat: 1 }])
    useRouteStore.getState().edit({ id: 't', waypoints: [{ lon: 3, lat: 3, name: 'Départ' }] } as never)
    expect(useRouteStore.getState()).toMatchObject({ points: [{ lon: 3, lat: 3 }], trackId: 't' })
  })
})

describe('place search', () => {
  it('reads coordinates, latitude first', () => {
    expect(parseCoordinates('45.92, 6.87')).toEqual({ lon: 6.87, lat: 45.92 })
    expect(parseCoordinates('45,92 6,87')).toEqual({ lon: 6.87, lat: 45.92 })
    expect(parseCoordinates('Chamonix')).toBeNull()
    expect(parseCoordinates('95, 6')).toBeNull()
  })

  it('asks Nominatim once per name, one second apart', async () => {
    const calls: string[] = []
    let now = 10_000
    const slept: number[] = []
    const deps = {
      fetch: (async (url: string) => {
        calls.push(url)
        return new Response(JSON.stringify(url.includes('Nulle') ? [] : [{ lat: '45.92', lon: '6.87', display_name: 'Chamonix' }]))
      }) as unknown as typeof fetch,
      now: () => now,
      sleep: async (ms: number) => {
        slept.push(ms)
        now += ms
      },
    }
    expect(await findPlace('Chamonix', undefined, deps)).toMatchObject({ name: 'Chamonix', center: { lon: 6.87, lat: 45.92 } })
    expect(await findPlace('chamonix ', undefined, deps)).toMatchObject({ name: 'Chamonix' })
    expect(await findPlace('Nulle part', undefined, deps)).toBeNull()
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('q=Chamonix')
    expect(slept).toEqual([1000])
  })
})

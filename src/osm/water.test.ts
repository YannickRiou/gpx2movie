import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LonLat } from '../core/types'
import { buildTrack } from '../import/stats'
import { clearOverpassMemoryCache, type OverpassDeps } from './overpass'
import { WATER_MARGIN_M, fetchTrackWater, parseWater, pointInRing, ringAreaM2, stitchRings, waterQuery } from './water'

const M = 111_320
const K = Math.cos((45.9 * Math.PI) / 180) * M

/** Square ring of `sideM` metres with its lower-left corner at (lon, lat), closed, as Overpass geometry. */
function square(lon: number, lat: number, sideM: number): { lat: number; lon: number }[] {
  const dLon = sideM / K
  const dLat = sideM / M
  return [
    { lon, lat },
    { lon: lon + dLon, lat },
    { lon: lon + dLon, lat: lat + dLat },
    { lon, lat: lat + dLat },
    { lon, lat },
  ]
}

const track = buildTrack({
  name: 't',
  source: 'gpx',
  segments: [{ points: [{ lon: 6.78, lat: 45.9 }, { lon: 6.79, lat: 45.91 }] }],
})

describe('waterQuery', () => {
  it('asks for water ways and multipolygons with their geometry, in a wide corridor', () => {
    const q = waterQuery(track)
    expect(q).toContain('way["natural"="water"]')
    expect(q).toContain('relation["waterway"="riverbank"]["type"="multipolygon"]')
    expect(q).toContain('out geom qt;')
    const south = Number(/\((-?[\d.]+),/.exec(q)![1])
    expect(south).toBeCloseTo(45.9 - WATER_MARGIN_M / M, 4)
  })
})

describe('rings', () => {
  it('stitches member ways end to end, in either direction, and drops what does not close', () => {
    const a: LonLat = { lon: 0, lat: 0 }
    const b: LonLat = { lon: 1, lat: 0 }
    const c: LonLat = { lon: 1, lat: 1 }
    const d: LonLat = { lon: 0, lat: 1 }
    const rings = stitchRings([[a, b], [c, b], [c, d, a], [{ lon: 5, lat: 5 }, { lon: 6, lat: 6 }]])
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(5)
    expect(rings[0][0]).toEqual(rings[0][4])
  })

  it('measures areas and tests points', () => {
    const ring = square(6.8, 45.9, 100)
    expect(ringAreaM2(ring)).toBeCloseTo(10_000, -1)
    expect(pointInRing({ lon: 6.8001, lat: 45.9001 }, ring)).toBe(true)
    expect(pointInRing({ lon: 6.79, lat: 45.9001 }, ring)).toBe(false)
  })
})

describe('parseWater', () => {
  const response = {
    elements: [
      { type: 'way', id: 1, tags: { natural: 'water', water: 'lake' }, geometry: square(6.8, 45.9, 300) },
      { type: 'way', id: 2, tags: { natural: 'water' }, geometry: square(6.81, 45.9, 20) },
      { type: 'way', id: 3, tags: { waterway: 'riverbank' }, geometry: square(6.82, 45.9, 100).slice(0, 4) },
      {
        type: 'relation',
        id: 4,
        tags: { type: 'multipolygon', natural: 'water', water: 'river' },
        members: [
          { type: 'way', ref: 10, role: 'outer', geometry: square(6.83, 45.9, 1000).slice(0, 3) },
          { type: 'way', ref: 11, role: 'outer', geometry: square(6.83, 45.9, 1000).slice(2) },
          { type: 'way', ref: 12, role: 'inner', geometry: square(6.833, 45.903, 100) },
          { type: 'node', ref: 13, role: '' },
        ],
      },
      { type: 'way', id: 10, tags: { natural: 'water' }, geometry: square(6.83, 45.9, 1000).slice(0, 3) },
    ],
  }

  it('keeps closed rings and multipolygons with their holes, largest first, drops small or open ones', () => {
    const polygons = parseWater(response)
    expect(polygons.map((p) => p.id)).toEqual(['relation/4', 'way/1'])
    const [river, lake] = polygons
    expect(river.kind).toBe('river')
    expect(river.holes).toHaveLength(1)
    expect(lake.kind).toBe('lake')
    // open rings, rounded to 1e-6°
    expect(lake.outer).toHaveLength(4)
    expect(lake.outer[0]).toEqual([6.8, 45.9])
  })

  it('throws on a server-side error', () => {
    expect(() => parseWater({ remark: 'runtime error: timeout', elements: [] })).toThrow()
    expect(() => parseWater({})).toThrow()
  })
})

describe('fetchTrackWater', () => {
  beforeEach(() => clearOverpassMemoryCache())

  it('queries once per track through the shared Overpass cache', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ elements: [{ type: 'way', id: 1, tags: { natural: 'water' }, geometry: square(6.8, 45.9, 300) }] })))
    const deps: OverpassDeps = { fetch: fetch as unknown as OverpassDeps['fetch'], sleep: async () => {}, storage: null, now: () => 0 }
    const a = await fetchTrackWater(track, undefined, deps)
    const b = await fetchTrackWater(track, undefined, deps)
    expect(a).toHaveLength(1)
    expect(b).toBe(a)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

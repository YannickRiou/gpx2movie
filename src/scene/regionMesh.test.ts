import { describe, expect, it } from 'vitest'
import type { LonLat } from '../core/types'
import type { AdminRegion } from '../osm/region'
import { pointInRing } from '../osm/water'
import { buildRegionMesh, labelPoint, ringDepths, ringSegments } from './regionMesh'

/** Open square ring, counter-clockwise from its south-west corner. */
const square = (west: number, south: number, size: number): [number, number][] => [
  [west, south],
  [west + size, south],
  [west + size, south + size],
  [west, south + size],
]
const toLonLat = (ring: [number, number][]): LonLat[] => ring.map(([lon, lat]) => ({ lon, lat }))

// a canton with an enclave of a neighbour, and an exclave of its own
const outer = square(7, 46, 1)
const enclave = square(7.2, 46.2, 0.2)
const exclave = square(8.5, 46.5, 0.1)
const region: AdminRegion = {
  id: 'relation/1',
  name: 'Valais/Wallis',
  bounds: { west: 7, south: 46, east: 8.6, north: 47 },
  rings: [outer, enclave, exclave],
}

describe('region mesh', () => {
  it('ring depths: outer rings and exclaves 0, enclaves 1', () => {
    expect(ringDepths([outer, enclave, exclave].map(toLonLat))).toEqual([0, 1, 0])
  })

  it('darkens the box around the region and the enclave, never the region itself', () => {
    const mesh = buildRegionMesh(region, { lon: 7.5, lat: 46.5 }, 50_000)
    expect(Array.from(mesh.ringStarts)).toEqual([4, 8, 12, 16])
    expect(mesh.lonLat.length).toBe(2 * 16)
    const at = (v: number) => ({ lon: mesh.lonLat[2 * v], lat: mesh.lonLat[2 * v + 1] })
    // the box reaches about 50 km beyond the region
    expect(at(0).lon).toBeLessThan(7 - 0.6)
    expect(at(2).lat).toBeGreaterThan(47 + 0.4)
    const boxArea = (at(1).lon - at(0).lon) * (at(2).lat - at(1).lat)

    const rings = region.rings.map(toLonLat)
    let area = 0
    for (let t = 0; t < mesh.index.length; t += 3) {
      const [a, b, c] = [mesh.index[t], mesh.index[t + 1], mesh.index[t + 2]].map(at)
      area += Math.abs((b.lon - a.lon) * (c.lat - a.lat) - (c.lon - a.lon) * (b.lat - a.lat)) / 2
      const middle = { lon: (a.lon + b.lon + c.lon) / 3, lat: (a.lat + b.lat + c.lat) / 3 }
      expect(rings.filter((ring) => pointInRing(middle, ring)).length % 2).toBe(0)
    }
    expect(area).toBeCloseTo(boxArea - 1 + 0.04 - 0.01, 9)
  })

  it('label point: inside the region, away from its border and from the outing', () => {
    const ring = toLonLat(square(7, 46, 1))
    const bounds = { west: 7, south: 46, east: 8, north: 47 }
    const far = labelPoint([ring], bounds, { lon: 20, lat: 46.5 })
    // 77 km wide, 111 km tall: as clear on a stretch of the middle line, its middle taken
    expect(far.lon).toBeCloseTo(7.5, 1)
    expect(far.lat).toBeCloseTo(46.5, 1)
    // the outing in the middle: the name moves off it, still well inside
    const aside = labelPoint([ring], bounds, { lon: 7.5, lat: 46.5 })
    expect(Math.hypot(aside.lon - 7.5, aside.lat - 46.5)).toBeGreaterThan(0.15)
    expect(pointInRing(aside, ring)).toBe(true)
    expect(Math.min(aside.lon - 7, 8 - aside.lon, aside.lat - 46, 47 - aside.lat)).toBeGreaterThan(0.1)
    // nothing inside (a sliver between grid cells): the box centre
    expect(labelPoint([toLonLat(square(7, 46, 0.001))], bounds, { lon: 0, lat: 0 }, 4)).toEqual({ lon: 7.5, lat: 46.5 })
  })

  it('ring segments: every ring closed, one segment per point, written in place', () => {
    // vertices 0 and 1 stand for the box corners; rings [2, 5) and [5, 7)
    const positions = Float32Array.from({ length: 7 * 3 }, (_, i) => i)
    const ringStarts = [2, 5, 7]
    const segments = ringSegments(positions, ringStarts)
    const pairs = Array.from({ length: segments.length / 3 }, (_, i) => segments[i * 3] / 3)
    expect(pairs).toEqual([2, 3, 3, 4, 4, 2, 5, 6, 6, 5])
    const out = new Float32Array(segments.length)
    expect(ringSegments(positions, ringStarts, out)).toBe(out)
    expect(out).toEqual(segments)
  })
})

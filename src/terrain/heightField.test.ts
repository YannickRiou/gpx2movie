import { describe, expect, it } from 'vitest'
import type { HeightGrid, TileKey } from '../core/types'
import { lonLatToTileFrac } from '../geo/mercator'
import { HeightField } from './heightField'

function flat(value: number, size = 4): HeightGrid {
  return { width: size, height: size, data: new Float32Array(size * size).fill(value) }
}

function tileAt(lon: number, lat: number, z: number): TileKey {
  const f = lonLatToTileFrac(lon, lat, z)
  return { z, x: Math.floor(f.x), y: Math.floor(f.y) }
}

// Somewhere on the Mont Blanc massif.
const LON = 6.8652
const LAT = 45.8326

describe('HeightField', () => {
  it('is empty by default', () => {
    const hf = new HeightField()
    expect(hf.size).toBe(0)
    expect(hf.sampleHeight(LON, LAT)).toBeUndefined()
  })

  it('stores, finds and deletes grids by key', () => {
    const hf = new HeightField()
    const key = tileAt(LON, LAT, 10)
    const g = flat(100)
    hf.set(key, g)
    expect(hf.has(key)).toBe(true)
    expect(hf.has({ ...key, x: key.x + 1 })).toBe(false)
    expect(hf.get(key)).toBe(g)
    expect(hf.size).toBe(1)
    expect(hf.delete(key)).toBe(true)
    expect(hf.delete(key)).toBe(false)
    expect(hf.size).toBe(0)
    expect(hf.sampleHeight(LON, LAT)).toBeUndefined()
  })

  it('samples the deepest loaded tile containing the point', () => {
    const hf = new HeightField()
    hf.set(tileAt(LON, LAT, 10), flat(1000))
    expect(hf.sampleHeight(LON, LAT)).toBeCloseTo(1000, 6)

    hf.set(tileAt(LON, LAT, 12), flat(2000))
    expect(hf.sampleHeight(LON, LAT)).toBeCloseTo(2000, 6)

    // A deeper tile that does NOT contain the point must not be used.
    const elsewhere = tileAt(LON, LAT, 14)
    hf.set({ ...elsewhere, x: elsewhere.x + 3 }, flat(3000))
    expect(hf.sampleHeight(LON, LAT)).toBeCloseTo(2000, 6)

    hf.delete(tileAt(LON, LAT, 12))
    expect(hf.sampleHeight(LON, LAT)).toBeCloseTo(1000, 6)
  })

  it('interpolates inside the grid of the chosen tile', () => {
    const hf = new HeightField()
    const key = tileAt(LON, LAT, 10)
    // 2x2 grid: west column 0, east column 100 -> value follows the u coordinate.
    hf.set(key, { width: 2, height: 2, data: Float32Array.from([0, 100, 0, 100]) })
    const f = lonLatToTileFrac(LON, LAT, 10)
    const u = f.x - key.x
    const expected = Math.min(1, Math.max(0, u * 2 - 0.5)) * 100
    expect(hf.sampleHeight(LON, LAT)).toBeCloseTo(expected, 6)
  })

  it('falls back to the parent when the deepest tile has nodata at the point', () => {
    const hf = new HeightField()
    hf.set(tileAt(LON, LAT, 10), flat(1000))
    hf.set(tileAt(LON, LAT, 12), flat(NaN))
    expect(hf.sampleHeight(LON, LAT)).toBeCloseTo(1000, 6)
  })

  it('tracks the deepest zoom after deletions', () => {
    const hf = new HeightField()
    hf.set(tileAt(LON, LAT, 10), flat(1000))
    hf.set(tileAt(LON, LAT, 13), flat(1300))
    hf.delete(tileAt(LON, LAT, 13))
    hf.set(tileAt(LON, LAT, 11), flat(1100))
    expect(hf.sampleHeight(LON, LAT)).toBeCloseTo(1100, 6)
  })

  it('returns undefined for a point outside every loaded tile', () => {
    const hf = new HeightField()
    hf.set(tileAt(LON, LAT, 10), flat(1000))
    expect(hf.sampleHeight(LON + 10, LAT)).toBeUndefined()
    expect(hf.sampleHeight(500, LAT)).toBeUndefined()
  })

  it('replaces an existing grid without double counting', () => {
    const hf = new HeightField()
    const key = tileAt(LON, LAT, 10)
    hf.set(key, flat(1))
    hf.set(key, flat(2))
    expect(hf.size).toBe(1)
    expect(hf.sampleHeight(LON, LAT)).toBeCloseTo(2, 6)
    hf.delete(key)
    expect(hf.sampleHeight(LON, LAT)).toBeUndefined()
  })

  it('prunes the least recently used grids first', () => {
    const hf = new HeightField()
    const a: TileKey = { z: 10, x: 1, y: 1 }
    const b: TileKey = { z: 10, x: 2, y: 1 }
    const c: TileKey = { z: 10, x: 3, y: 1 }
    hf.set(a, flat(1))
    hf.set(b, flat(2))
    hf.set(c, flat(3))
    hf.get(a) // a becomes the most recently used
    expect(hf.prune(2)).toBe(1)
    expect(hf.has(a)).toBe(true)
    expect(hf.has(b)).toBe(false)
    expect(hf.has(c)).toBe(true)
    expect(hf.size).toBe(2)
    expect(hf.prune(2)).toBe(0)
    expect(Array.from(hf.keys())).toEqual([c, a])
  })

  it('counts a sampled tile as recently used', () => {
    const hf = new HeightField()
    const hit = tileAt(LON, LAT, 10)
    const other: TileKey = { ...hit, x: hit.x + 5 }
    hf.set(hit, flat(1))
    hf.set(other, flat(2))
    hf.sampleHeight(LON, LAT)
    hf.prune(1)
    expect(hf.has(hit)).toBe(true)
    expect(hf.has(other)).toBe(false)
  })

  it('clear() empties everything', () => {
    const hf = new HeightField()
    hf.set(tileAt(LON, LAT, 10), flat(1))
    hf.clear()
    expect(hf.size).toBe(0)
    expect(hf.sampleHeight(LON, LAT)).toBeUndefined()
    hf.set(tileAt(LON, LAT, 9), flat(9))
    expect(hf.sampleHeight(LON, LAT)).toBeCloseTo(9, 6)
  })
})

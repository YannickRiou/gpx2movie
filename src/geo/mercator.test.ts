import { describe, expect, it } from 'vitest'
import type { LonLatBounds, TileKey } from '../core/types'
import {
  MAX_MERCATOR_LAT,
  MERCATOR_CIRCUMFERENCE_M,
  boundsIntersect,
  childrenOf,
  clampLat,
  lonLatToTileFrac,
  lonLatToTileUV,
  parentOf,
  parseTileKey,
  tileBounds,
  tileCenter,
  tileContains,
  tileCountForBounds,
  tileGroundSizeM,
  tileKeyString,
  tileUVToLonLat,
  tileXToLon,
  tileYToLat,
  tilesForBounds,
  zoomForTileBudget,
} from './mercator'

const CHAMONIX = { lon: 6.87, lat: 45.92 }
/** Hand-computed: x = (186.87/360)·4096 = 2126.17, y = (1 − ln(tan φ + sec φ)/π)/2 · 4096 = 1458.48 */
const CHAMONIX_Z12: TileKey = { z: 12, x: 2126, y: 1458 }

function sortKeys(keys: TileKey[]): string[] {
  return keys.map(tileKeyString).sort()
}

describe('lonLatToTileFrac', () => {
  it('places Chamonix in tile 12/2126/1458', () => {
    const f = lonLatToTileFrac(CHAMONIX.lon, CHAMONIX.lat, 12)
    expect(Math.floor(f.x)).toBe(2126)
    expect(Math.floor(f.y)).toBe(1458)
    expect(f.x).toBeCloseTo(2126.17, 1)
    expect(f.y).toBeCloseTo(1458.48, 1)
  })

  it('maps the world corners at zoom 0', () => {
    expect(lonLatToTileFrac(-180, MAX_MERCATOR_LAT, 0).x).toBeCloseTo(0, 9)
    expect(lonLatToTileFrac(-180, MAX_MERCATOR_LAT, 0).y).toBeCloseTo(0, 6)
    expect(lonLatToTileFrac(180, -MAX_MERCATOR_LAT, 0).x).toBeCloseTo(1, 9)
    expect(lonLatToTileFrac(180, -MAX_MERCATOR_LAT, 0).y).toBeCloseTo(1, 6)
    expect(lonLatToTileFrac(0, 0, 0)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('y grows southwards (y = 0 at the north edge)', () => {
    const north = lonLatToTileFrac(0, 60, 5)
    const south = lonLatToTileFrac(0, -60, 5)
    expect(north.y).toBeLessThan(south.y)
    expect(north.y).toBeCloseTo(32 - south.y, 9)
  })

  it('clamps latitudes beyond the Mercator limit', () => {
    expect(lonLatToTileFrac(0, 89, 3).y).toBeCloseTo(lonLatToTileFrac(0, MAX_MERCATOR_LAT, 3).y, 12)
    expect(clampLat(-90)).toBe(-MAX_MERCATOR_LAT)
    expect(clampLat(12.3)).toBe(12.3)
  })
})

describe('tileXToLon / tileYToLat', () => {
  it('invert lonLatToTileFrac', () => {
    for (const z of [0, 3, 12, 18]) {
      for (const [lon, lat] of [
        [CHAMONIX.lon, CHAMONIX.lat],
        [-122.4, 37.8],
        [151.2, -33.9],
        [0, 0],
      ]) {
        const f = lonLatToTileFrac(lon, lat, z)
        expect(tileXToLon(f.x, z)).toBeCloseTo(lon, 9)
        expect(tileYToLat(f.y, z)).toBeCloseTo(lat, 9)
      }
    }
  })

  it('give the world edges at zoom 0', () => {
    expect(tileXToLon(0, 0)).toBe(-180)
    expect(tileXToLon(1, 0)).toBe(180)
    expect(tileYToLat(0, 0)).toBeCloseTo(MAX_MERCATOR_LAT, 6)
    expect(tileYToLat(1, 0)).toBeCloseTo(-MAX_MERCATOR_LAT, 6)
    expect(tileYToLat(0.5, 0)).toBeCloseTo(0, 12)
  })
})

describe('tileBounds / tileCenter', () => {
  it('orders edges correctly and contains Chamonix', () => {
    const b = tileBounds(CHAMONIX_Z12)
    expect(b.north).toBeGreaterThan(b.south)
    expect(b.east).toBeGreaterThan(b.west)
    expect(CHAMONIX.lon).toBeGreaterThanOrEqual(b.west)
    expect(CHAMONIX.lon).toBeLessThan(b.east)
    expect(CHAMONIX.lat).toBeGreaterThanOrEqual(b.south)
    expect(CHAMONIX.lat).toBeLessThan(b.north)
    // a zoom-12 tile is 360/4096 degrees wide
    expect(b.east - b.west).toBeCloseTo(360 / 4096, 12)
  })

  it('zoom 0 covers the whole Mercator world', () => {
    const b = tileBounds({ z: 0, x: 0, y: 0 })
    expect(b.west).toBe(-180)
    expect(b.east).toBe(180)
    expect(b.north).toBeCloseTo(MAX_MERCATOR_LAT, 6)
    expect(b.south).toBeCloseTo(-MAX_MERCATOR_LAT, 6)
  })

  it('centre lies strictly inside the bounds and matches uv (0.5, 0.5)', () => {
    const b = tileBounds(CHAMONIX_Z12)
    const c = tileCenter(CHAMONIX_Z12)
    expect(c.lon).toBeGreaterThan(b.west)
    expect(c.lon).toBeLessThan(b.east)
    expect(c.lat).toBeGreaterThan(b.south)
    expect(c.lat).toBeLessThan(b.north)
    const mid = tileUVToLonLat(CHAMONIX_Z12, 0.5, 0.5)
    expect(c.lon).toBeCloseTo(mid.lon, 12)
    expect(c.lat).toBeCloseTo(mid.lat, 12)
    expect(c.lon).toBeCloseTo((b.west + b.east) / 2, 12)
  })

  it('adjacent tiles share edges exactly', () => {
    const a = tileBounds({ z: 12, x: 2126, y: 1458 })
    const east = tileBounds({ z: 12, x: 2127, y: 1458 })
    const south = tileBounds({ z: 12, x: 2126, y: 1459 })
    expect(a.east).toBe(east.west)
    expect(a.south).toBe(south.north)
  })
})

describe('tileContains / lonLatToTileUV / tileUVToLonLat', () => {
  it('contains Chamonix and not its neighbours', () => {
    expect(tileContains(CHAMONIX_Z12, CHAMONIX.lon, CHAMONIX.lat)).toBe(true)
    expect(tileContains({ z: 12, x: 2127, y: 1458 }, CHAMONIX.lon, CHAMONIX.lat)).toBe(false)
    expect(tileContains({ z: 12, x: 2126, y: 1459 }, CHAMONIX.lon, CHAMONIX.lat)).toBe(false)
    expect(tileContains({ z: 11, x: 1063, y: 729 }, CHAMONIX.lon, CHAMONIX.lat)).toBe(true)
  })

  it('treats the north-west edge as inclusive and the south-east edge as exclusive', () => {
    const b = tileBounds(CHAMONIX_Z12)
    expect(tileContains(CHAMONIX_Z12, b.west, b.north)).toBe(true)
    expect(tileContains(CHAMONIX_Z12, b.east, b.north)).toBe(false)
    expect(tileContains({ z: 12, x: 2127, y: 1458 }, b.east, b.north)).toBe(true)
  })

  it('uv lies in [0, 1) for a contained point and round-trips', () => {
    const uv = lonLatToTileUV(CHAMONIX_Z12, CHAMONIX.lon, CHAMONIX.lat)
    expect(uv.u).toBeGreaterThanOrEqual(0)
    expect(uv.u).toBeLessThan(1)
    expect(uv.v).toBeGreaterThanOrEqual(0)
    expect(uv.v).toBeLessThan(1)
    expect(uv.u).toBeCloseTo(0.17, 1)
    expect(uv.v).toBeCloseTo(0.48, 1)
    const back = tileUVToLonLat(CHAMONIX_Z12, uv.u, uv.v)
    expect(Math.abs(back.lon - CHAMONIX.lon)).toBeLessThan(1e-9)
    expect(Math.abs(back.lat - CHAMONIX.lat)).toBeLessThan(1e-9)
  })

  it('v = 0 is the north edge and u = 0 the west edge', () => {
    const b = tileBounds(CHAMONIX_Z12)
    const nw = tileUVToLonLat(CHAMONIX_Z12, 0, 0)
    expect(nw.lon).toBeCloseTo(b.west, 12)
    expect(nw.lat).toBeCloseTo(b.north, 12)
    const se = tileUVToLonLat(CHAMONIX_Z12, 1, 1)
    expect(se.lon).toBeCloseTo(b.east, 12)
    expect(se.lat).toBeCloseTo(b.south, 12)
  })

  it('uv -> lonlat -> uv round-trips on a grid', () => {
    for (let i = 0; i <= 4; i++) {
      for (let j = 0; j <= 4; j++) {
        const u = i / 4
        const v = j / 4
        const ll = tileUVToLonLat(CHAMONIX_Z12, u, v)
        const back = lonLatToTileUV(CHAMONIX_Z12, ll.lon, ll.lat)
        expect(Math.abs(back.u - u)).toBeLessThan(1e-9)
        expect(Math.abs(back.v - v)).toBeLessThan(1e-9)
      }
    }
  })
})

describe('childrenOf / parentOf', () => {
  it('children are at z+1 and all have the key as parent', () => {
    const children = childrenOf(CHAMONIX_Z12)
    expect(children).toHaveLength(4)
    expect(sortKeys(children)).toEqual(sortKeys([
      { z: 13, x: 4252, y: 2916 },
      { z: 13, x: 4253, y: 2916 },
      { z: 13, x: 4252, y: 2917 },
      { z: 13, x: 4253, y: 2917 },
    ]))
    for (const c of children) expect(parentOf(c)).toEqual(CHAMONIX_Z12)
  })

  it('children exactly tile the parent', () => {
    const p = tileBounds(CHAMONIX_Z12)
    const [nw, ne, sw, se] = childrenOf(CHAMONIX_Z12)
    expect(tileBounds(nw).west).toBe(p.west)
    expect(tileBounds(nw).north).toBe(p.north)
    expect(tileBounds(ne).east).toBe(p.east)
    expect(tileBounds(sw).south).toBe(p.south)
    expect(tileBounds(se).east).toBe(p.east)
    expect(tileBounds(se).south).toBe(p.south)
    expect(tileBounds(nw).east).toBe(tileBounds(ne).west)
    expect(tileBounds(nw).south).toBe(tileBounds(sw).north)
  })

  it('the parent of a child is the key, the root has no parent', () => {
    expect(parentOf({ z: 0, x: 0, y: 0 })).toBeUndefined()
    expect(parentOf({ z: 1, x: 1, y: 1 })).toEqual({ z: 0, x: 0, y: 0 })
    expect(parentOf({ z: 12, x: 2127, y: 1459 })).toEqual({ z: 11, x: 1063, y: 729 })
  })

  it('the parent contains every point of its children', () => {
    for (const c of childrenOf(CHAMONIX_Z12)) {
      const centre = tileCenter(c)
      expect(tileContains(CHAMONIX_Z12, centre.lon, centre.lat)).toBe(true)
    }
  })
})

describe('tilesForBounds', () => {
  it('returns the single tile for a box strictly inside it', () => {
    const b = tileBounds(CHAMONIX_Z12)
    const inside: LonLatBounds = {
      west: b.west + 0.001,
      east: b.east - 0.001,
      south: b.south + 0.001,
      north: b.north - 0.001,
    }
    expect(tilesForBounds(inside, 12)).toEqual([CHAMONIX_Z12])
  })

  it('returns exactly the tile when the box equals its bounds', () => {
    expect(tilesForBounds(tileBounds(CHAMONIX_Z12), 12)).toEqual([CHAMONIX_Z12])
  })

  it('returns the 3×3 block for a box straddling every edge of a tile', () => {
    const b = tileBounds(CHAMONIX_Z12)
    const straddling: LonLatBounds = {
      west: b.west - 0.001,
      east: b.east + 0.001,
      south: b.south - 0.001,
      north: b.north + 0.001,
    }
    const expected: TileKey[] = []
    for (let y = 1457; y <= 1459; y++) for (let x = 2125; x <= 2127; x++) expected.push({ z: 12, x, y })
    expect(sortKeys(tilesForBounds(straddling, 12))).toEqual(sortKeys(expected))
  })

  it('returns a 2×2 block for a box equal to the union of 4 tiles', () => {
    const nw = tileBounds({ z: 12, x: 2126, y: 1458 })
    const se = tileBounds({ z: 12, x: 2127, y: 1459 })
    const box: LonLatBounds = { west: nw.west, north: nw.north, east: se.east, south: se.south }
    expect(sortKeys(tilesForBounds(box, 12))).toEqual(sortKeys([
      { z: 12, x: 2126, y: 1458 },
      { z: 12, x: 2127, y: 1458 },
      { z: 12, x: 2126, y: 1459 },
      { z: 12, x: 2127, y: 1459 },
    ]))
  })

  it('straddling only the east edge yields 2 tiles side by side', () => {
    const b = tileBounds(CHAMONIX_Z12)
    const box: LonLatBounds = { west: b.west + 0.01, east: b.east + 0.01, south: b.south + 0.01, north: b.north - 0.01 }
    expect(sortKeys(tilesForBounds(box, 12))).toEqual(sortKeys([
      { z: 12, x: 2126, y: 1458 },
      { z: 12, x: 2127, y: 1458 },
    ]))
  })

  it('is ordered row-major (north to south, west to east)', () => {
    const b = tileBounds(CHAMONIX_Z12)
    const box: LonLatBounds = { west: b.west - 0.001, east: b.east + 0.001, south: b.south - 0.001, north: b.north + 0.001 }
    const keys = tilesForBounds(box, 12)
    expect(keys[0]).toEqual({ z: 12, x: 2125, y: 1457 })
    expect(keys[8]).toEqual({ z: 12, x: 2127, y: 1459 })
  })

  it('covers the whole world at zoom 0 and 1', () => {
    const world: LonLatBounds = { west: -180, east: 180, south: -90, north: 90 }
    expect(tilesForBounds(world, 0)).toEqual([{ z: 0, x: 0, y: 0 }])
    expect(tilesForBounds(world, 1)).toHaveLength(4)
    expect(tilesForBounds(world, 3)).toHaveLength(64)
  })

  it('clamps to the valid tile range', () => {
    const oversized: LonLatBounds = { west: -200, east: 200, south: -95, north: 95 }
    const keys = tilesForBounds(oversized, 2)
    expect(keys).toHaveLength(16)
    for (const k of keys) {
      expect(k.x).toBeGreaterThanOrEqual(0)
      expect(k.x).toBeLessThan(4)
      expect(k.y).toBeGreaterThanOrEqual(0)
      expect(k.y).toBeLessThan(4)
    }
  })

  it('returns nothing for an inverted (empty) box', () => {
    const inverted: LonLatBounds = { west: 7.3, east: 6.5, south: 45.6, north: 46.2 }
    expect(tilesForBounds(inverted, 10)).toEqual([])
    expect(tileCountForBounds(inverted, 10)).toBe(0)
  })

  it('tileCountForBounds matches the length of tilesForBounds', () => {
    const zooms = [0, 1, 5, 10, 12]
    const cases: [LonLatBounds, number[]][] = [
      [tileBounds(CHAMONIX_Z12), zooms],
      [{ west: 6.5, east: 7.3, south: 45.6, north: 46.2 }, zooms],
      // whole world: stop at z8, z12 would list 16.7 M tiles
      [{ west: -200, east: 200, south: -95, north: 95 }, [0, 1, 5, 8]],
      [{ west: 6.87, east: 6.87, south: 45.92, north: 45.92 }, zooms],
    ]
    for (const [box, boxZooms] of cases) {
      for (const z of boxZooms) {
        expect(tileCountForBounds(box, z)).toBe(tilesForBounds(box, z).length)
      }
    }
  })

  it('every returned tile intersects the box and every intersecting tile is returned', () => {
    const box: LonLatBounds = { west: 6.5, east: 7.3, south: 45.6, north: 46.2 }
    const keys = tilesForBounds(box, 10)
    const set = new Set(keys.map(tileKeyString))
    for (const k of keys) expect(boundsIntersect(tileBounds(k), box)).toBe(true)
    for (let x = 525; x <= 535; x++) {
      for (let y = 360; y <= 375; y++) {
        const k = { z: 10, x, y }
        expect(set.has(tileKeyString(k))).toBe(boundsIntersect(tileBounds(k), box))
      }
    }
  })
})

describe('tileGroundSizeM', () => {
  it('is the Earth circumference at zoom 0', () => {
    expect(Math.abs(tileGroundSizeM({ z: 0, x: 0, y: 0 }) - 40075016.69)).toBeLessThan(1)
  })

  it('halves at each zoom level on the equator', () => {
    const z1 = tileGroundSizeM({ z: 1, x: 0, y: 1 }) // just south of the equator → centre lat ≠ 0
    expect(z1).toBeLessThan(MERCATOR_CIRCUMFERENCE_M / 2)
    const z10 = tileGroundSizeM({ z: 10, x: 512, y: 512 })
    const z11 = tileGroundSizeM({ z: 11, x: 1024, y: 1024 })
    expect(z10 / z11).toBeCloseTo(2, 1)
  })

  it('shrinks with latitude', () => {
    const chamonix = tileGroundSizeM(CHAMONIX_Z12)
    const equator = tileGroundSizeM({ z: 12, x: 2126, y: 2048 })
    expect(chamonix).toBeLessThan(equator)
    // ≈ 9784 m · cos(45.9°) ≈ 6.8 km at Chamonix
    expect(chamonix).toBeGreaterThan(6500)
    expect(chamonix).toBeLessThan(7000)
  })
})

describe('tileKeyString / parseTileKey', () => {
  it('round-trips', () => {
    const keys: TileKey[] = [
      { z: 0, x: 0, y: 0 },
      CHAMONIX_Z12,
      { z: 20, x: 1048575, y: 0 },
    ]
    for (const k of keys) {
      const s = tileKeyString(k)
      expect(s).toBe(`${k.z}/${k.x}/${k.y}`)
      expect(parseTileKey(s)).toEqual(k)
    }
  })

  it('rejects malformed keys', () => {
    expect(() => parseTileKey('12/2126')).toThrow()
    expect(() => parseTileKey('a/b/c')).toThrow()
    expect(() => parseTileKey('12/2126.5/1458')).toThrow()
    expect(() => parseTileKey('-1/0/0')).toThrow()
    expect(() => parseTileKey('')).toThrow()
  })
})

describe('boundsIntersect', () => {
  it('detects overlap and rejects touching/disjoint boxes', () => {
    const a: LonLatBounds = { west: 0, east: 10, south: 0, north: 10 }
    expect(boundsIntersect(a, { west: 5, east: 15, south: 5, north: 15 })).toBe(true)
    expect(boundsIntersect(a, { west: 10, east: 20, south: 0, north: 10 })).toBe(false)
    expect(boundsIntersect(a, { west: 11, east: 20, south: 0, north: 10 })).toBe(false)
    expect(boundsIntersect(a, { west: 2, east: 3, south: 2, north: 3 })).toBe(true)
  })
})

describe('zoomForTileBudget', () => {
  const box: LonLatBounds = { west: 6.5, east: 7.3, south: 45.6, north: 46.2 }

  it('returns the largest zoom whose tile count is within budget', () => {
    const z = zoomForTileBudget(box, 16, 0, 15)
    expect(tilesForBounds(box, z).length).toBeLessThanOrEqual(16)
    expect(tilesForBounds(box, z + 1).length).toBeGreaterThan(16)
  })

  it('is monotonic in the budget', () => {
    let previous = -1
    for (const budget of [1, 2, 4, 8, 16, 32, 64, 128, 256]) {
      const z = zoomForTileBudget(box, budget, 0, 15)
      expect(z).toBeGreaterThanOrEqual(previous)
      previous = z
    }
  })

  it('tile counts are non-decreasing with zoom (the invariant the search relies on)', () => {
    let previous = 0
    for (let z = 0; z <= 14; z++) {
      const count = tilesForBounds(box, z).length
      expect(count).toBeGreaterThanOrEqual(previous)
      previous = count
    }
  })

  it('clamps to [minZoom, maxZoom]', () => {
    expect(zoomForTileBudget(box, 1_000_000, 0, 10)).toBe(10)
    expect(zoomForTileBudget(box, 1, 8, 15)).toBe(8)
    expect(zoomForTileBudget(box, 1, 0, 15)).toBeLessThanOrEqual(15)
    expect(zoomForTileBudget(box, 1, 0, 15)).toBeGreaterThanOrEqual(0)
  })

  it('a single-tile budget gives a zoom where the box fits in one tile', () => {
    const z = zoomForTileBudget(box, 1, 0, 15)
    expect(tilesForBounds(box, z)).toHaveLength(1)
  })

  it('returns minZoom when maxZoom is not above it', () => {
    expect(zoomForTileBudget(box, 1_000, 7, 7)).toBe(7)
    expect(zoomForTileBudget(box, 1_000, 9, 7)).toBe(9)
  })

  it('handles a world-sized box at a deep maxZoom without materialising tiles', () => {
    const world: LonLatBounds = { west: -180, east: 180, south: -90, north: 90 }
    const start = performance.now()
    // zoom 2 has exactly 16 tiles, zoom 3 has 64 → 16 is the largest within budget
    expect(zoomForTileBudget(world, 16, 0, 22)).toBe(2)
    expect(zoomForTileBudget(world, 1, 0, 22)).toBe(0)
    expect(performance.now() - start).toBeLessThan(200)
  })
})

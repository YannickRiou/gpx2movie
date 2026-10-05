/**
 * Web Mercator (EPSG:3857) tile maths. XYZ scheme: y = 0 at the north edge.
 */
import type { LonLatBounds, TileKey } from '../core/types'

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

/** Earth circumference used by Web Mercator, metres. */
export const MERCATOR_CIRCUMFERENCE_M = 40075016.68557849
export const MAX_MERCATOR_LAT = 85.05112878

export function clampLat(lat: number): number {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat))
}

/** Fractional tile coordinates at zoom z. */
export function lonLatToTileFrac(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z
  const latRad = clampLat(lat) * DEG
  const x = ((lon + 180) / 360) * n
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { x, y }
}

/** Latitude (degrees) of the north edge of tile row `y` (fractional allowed) at zoom z. */
export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return RAD * Math.atan(Math.sinh(n))
}

/** Longitude (degrees) of the west edge of tile column `x` (fractional allowed) at zoom z. */
export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180
}

export function tileBounds(key: TileKey): LonLatBounds {
  return {
    west: tileXToLon(key.x, key.z),
    east: tileXToLon(key.x + 1, key.z),
    north: tileYToLat(key.y, key.z),
    south: tileYToLat(key.y + 1, key.z),
  }
}

export function tileCenter(key: TileKey): { lon: number; lat: number } {
  return { lon: tileXToLon(key.x + 0.5, key.z), lat: tileYToLat(key.y + 0.5, key.z) }
}

/**
 * Tolerance (in tile units) used when a box edge falls on a tile edge: the box must overlap
 * a tile by a strictly positive amount to include it, and round-off of a few ulps must not
 * drag a neighbouring tile in. 1e-9 tile units is ~0.04 mm at zoom 20.
 */
const TILE_EDGE_EPS = 1e-9

/** Inclusive tile index range covering the box at zoom z (empty when x1 < x0 or y1 < y0). */
function tileRangeForBounds(bounds: LonLatBounds, z: number): { x0: number; x1: number; y0: number; y1: number } {
  const n = 2 ** z
  const a = lonLatToTileFrac(bounds.west, bounds.north, z)
  const b = lonLatToTileFrac(bounds.east, bounds.south, z)
  return {
    x0: Math.max(0, Math.floor(a.x + TILE_EDGE_EPS)),
    x1: Math.min(n - 1, Math.floor(b.x - TILE_EDGE_EPS)),
    y0: Math.max(0, Math.floor(a.y + TILE_EDGE_EPS)),
    y1: Math.min(n - 1, Math.floor(b.y - TILE_EDGE_EPS)),
  }
}

/** Number of tiles tilesForBounds would return, without allocating them. */
export function tileCountForBounds(bounds: LonLatBounds, z: number): number {
  const { x0, x1, y0, y1 } = tileRangeForBounds(bounds, z)
  return Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1)
}

/** All tiles at zoom z intersecting the box (edges touching a tile edge do not include it). */
export function tilesForBounds(bounds: LonLatBounds, z: number): TileKey[] {
  const { x0, x1, y0, y1 } = tileRangeForBounds(bounds, z)
  const keys: TileKey[] = []
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) keys.push({ z, x, y })
  }
  return keys
}

/** Approximate ground width of a tile in metres (at its centre latitude). */
export function tileGroundSizeM(key: TileKey): number {
  const lat = tileCenter(key).lat
  return (MERCATOR_CIRCUMFERENCE_M * Math.cos(lat * DEG)) / 2 ** key.z
}

export function childrenOf(key: TileKey): [TileKey, TileKey, TileKey, TileKey] {
  const z = key.z + 1
  const x = key.x * 2
  const y = key.y * 2
  return [
    { z, x, y },
    { z, x: x + 1, y },
    { z, x, y: y + 1 },
    { z, x: x + 1, y: y + 1 },
  ]
}

export function parentOf(key: TileKey): TileKey | undefined {
  if (key.z === 0) return undefined
  return { z: key.z - 1, x: key.x >> 1, y: key.y >> 1 }
}

export function tileKeyString(key: TileKey): string {
  return `${key.z}/${key.x}/${key.y}`
}

/** Inverse of tileKeyString. Throws on a malformed key. */
export function parseTileKey(s: string): TileKey {
  const parts = s.split('/')
  if (parts.length !== 3) throw new Error(`Invalid tile key "${s}"`)
  const [z, x, y] = parts.map(Number)
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || x < 0 || y < 0) {
    throw new Error(`Invalid tile key "${s}"`)
  }
  return { z, x, y }
}

export function tileContains(key: TileKey, lon: number, lat: number): boolean {
  const f = lonLatToTileFrac(lon, lat, key.z)
  return f.x >= key.x && f.x < key.x + 1 && f.y >= key.y && f.y < key.y + 1
}

/** Position of lon/lat inside the tile, u east 0..1, v south 0..1 (v = 0 at the north edge). */
export function lonLatToTileUV(key: TileKey, lon: number, lat: number): { u: number; v: number } {
  const f = lonLatToTileFrac(lon, lat, key.z)
  return { u: f.x - key.x, v: f.y - key.y }
}

/** Inverse of lonLatToTileUV. */
export function tileUVToLonLat(key: TileKey, u: number, v: number): { lon: number; lat: number } {
  return { lon: tileXToLon(key.x + u, key.z), lat: tileYToLat(key.y + v, key.z) }
}

/** True if the two boxes intersect (no antimeridian handling). */
export function boundsIntersect(a: LonLatBounds, b: LonLatBounds): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south
}

/**
 * Largest zoom in [minZoom, maxZoom] at which the box is covered by at most `maxTiles` tiles.
 * The tile count is non-decreasing with zoom, so we walk up from minZoom and stop at the first
 * level over budget; counting never allocates keys, so a huge box at a deep maxZoom is cheap.
 * Returns minZoom when even that level exceeds the budget.
 */
export function zoomForTileBudget(bounds: LonLatBounds, maxTiles: number, minZoom: number, maxZoom: number): number {
  let best = minZoom
  for (let z = minZoom + 1; z <= maxZoom; z++) {
    if (tileCountForBounds(bounds, z) > maxTiles) break
    best = z
  }
  return best
}

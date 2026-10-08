/**
 * Ground heights at arbitrary points, outside the area the scene has loaded (a route drawn before any track): the
 * elevation tiles under the points fetched at one zoom, decoded and sampled bilinearly. Same tile fetcher as the
 * scene (offline packs read first).
 */
import type { HeightGrid, LonLat, TerrainSource, TileKey, TileFetcher } from '../core/types'
import { lonLatToTileFrac, lonLatToTileUV } from '../geo/mercator'
import { decodeDem, sampleGrid } from './dem'
import { createTileFetcher, isNoDataError } from './fetch'
import { buildTileUrl } from './sources'

/** Zoom of the sampled tiles: ~20 m per pixel at 45° latitude with 256 px tiles, ~10 m with 512 px. */
export const HEIGHT_ZOOM = 13
/** Coarser zooms tried when a tile has no data (404 above the source's resolution there). */
const MAX_ZOOM_FALLBACK = 3

export interface HeightDeps {
  fetcher: Pick<TileFetcher, 'fetchBitmap'>
  decode: (bitmap: ImageBitmap) => HeightGrid
}

/** Height (metres) of each point; undefined where its tile could not be read or holds no data. */
export async function fetchHeights(
  points: readonly LonLat[],
  source: TerrainSource,
  signal?: AbortSignal,
  deps: HeightDeps = { fetcher: createTileFetcher({ concurrency: 6 }), decode: (b) => decodeDem(b, source.encoding) },
): Promise<(number | undefined)[]> {
  const heights: (number | undefined)[] = new Array(points.length).fill(undefined)
  const zoom = Math.min(source.maxZoom, HEIGHT_ZOOM)
  // a tile without data at this zoom (Mapterhorn stops at z12 where only Copernicus exists): its parent, a few times
  const lowest = Math.max(source.minZoom, zoom - MAX_ZOOM_FALLBACK)

  async function sample(indices: readonly number[], z: number): Promise<void> {
    const byTile = new Map<string, { key: TileKey; indices: number[] }>()
    for (const i of indices) {
      const f = lonLatToTileFrac(points[i].lon, points[i].lat, z)
      const key = { z, x: Math.floor(f.x), y: Math.floor(f.y) }
      const id = `${key.x}/${key.y}`
      const tile = byTile.get(id) ?? { key, indices: [] }
      tile.indices.push(i)
      byTile.set(id, tile)
    }
    await Promise.all(
      [...byTile.values()].map(async ({ key, indices: inTile }) => {
        let grid: HeightGrid
        try {
          grid = deps.decode(await deps.fetcher.fetchBitmap(buildTileUrl(source, key), { signal }))
        } catch (error) {
          if (signal?.aborted) throw error
          if (isNoDataError(error) && z > lowest) await sample(inTile, z - 1)
          return
        }
        for (const i of inTile) {
          const { u, v } = lonLatToTileUV(key, points[i].lon, points[i].lat)
          const h = sampleGrid(grid, u, v)
          if (Number.isFinite(h)) heights[i] = h
        }
      }),
    )
  }

  await sample(points.map((_, i) => i), zoom)
  return heights
}

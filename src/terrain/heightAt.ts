/**
 * Ground heights at arbitrary points, outside the area the scene has loaded (a route drawn before any track): the
 * elevation tiles under the points fetched at one zoom, decoded and sampled bilinearly. Same tile fetcher as the
 * scene (offline packs read first).
 */
import type { HeightGrid, LonLat, TerrainSource, TileKey, TileFetcher } from '../core/types'
import { lonLatToTileFrac, lonLatToTileUV } from '../geo/mercator'
import { decodeDem, sampleGrid } from './dem'
import { createTileFetcher } from './fetch'
import { buildTileUrl } from './sources'

/** Zoom of the sampled tiles: ~20 m per pixel at 45° latitude with 256 px tiles, ~10 m with 512 px. */
export const HEIGHT_ZOOM = 13

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
  const z = Math.min(source.maxZoom, HEIGHT_ZOOM)
  const byTile = new Map<string, { key: TileKey; indices: number[] }>()
  points.forEach((p, i) => {
    const f = lonLatToTileFrac(p.lon, p.lat, z)
    const key = { z, x: Math.floor(f.x), y: Math.floor(f.y) }
    const id = `${key.x}/${key.y}`
    const tile = byTile.get(id) ?? { key, indices: [] }
    tile.indices.push(i)
    byTile.set(id, tile)
  })
  const heights: (number | undefined)[] = new Array(points.length).fill(undefined)
  await Promise.all(
    [...byTile.values()].map(async ({ key, indices }) => {
      let grid: HeightGrid
      try {
        grid = deps.decode(await deps.fetcher.fetchBitmap(buildTileUrl(source, key), { signal }))
      } catch (error) {
        if (signal?.aborted) throw error
        return
      }
      for (const i of indices) {
        const { u, v } = lonLatToTileUV(key, points[i].lon, points[i].lat)
        const h = sampleGrid(grid, u, v)
        if (Number.isFinite(h)) heights[i] = h
      }
    }),
  )
  return heights
}

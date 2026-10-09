/**
 * Tiles an offline pack needs: the ones the terrain engine loads during a flyover of the tracks, limited to a
 * corridor for the fine levels. Pure (tested). See ARCHITECTURE.md "Offline packs".
 *
 * The engine (quadtree.ts) splits a tile when one grid cell looks bigger than 3 px, i.e. when the camera comes closer
 * than about 6 x the tile's ground size (H = 1080 px). Along a flyover the camera stays near the track,
 * `cameraHeightM` above it, so the plan walks the tree from the engine's roots with that rule: the first
 * `LANDSCAPE_LEVELS` levels over the whole area, deeper only the children of tiles touching the corridor, and for
 * each terrain tile its imagery sub-tiles (`planImagerySubtiles`). Overview shots and high orbits need coarser tiles.
 */
import type { ImagerySource, LonLat, LonLatBounds, TerrainSource, TileKey } from '../core/types'
import { expandBounds } from '../geo/lonLat'
import { childrenOf, tileBounds, tileGroundSizeM, tilesForBounds, zoomForTileBudget } from '../geo/mercator'
import { CAMERA_FOV_DEG } from '../flyover/filmCamera'
import { AREA_MARGIN_M, AREA_MIN_SIZE_M, DEFAULT_ERROR_TARGET_PX, DEFAULT_SEGMENTS, DEFAULT_TUNING } from '../terrain/engine'
import { planImagerySubtiles } from '../terrain/imagery'
import { buildTileUrl } from '../terrain/sources'
import { offlinePolicy } from './policy'

/** levels below the roots kept over the whole area, whatever the corridor */
export const LANDSCAPE_LEVELS = 2
/** corridor widths offered (metres, total width) */
export const CORRIDOR_WIDTHS_M = [2_000, 5_000, 10_000] as const
/** a pack bigger than this is refused (narrow the corridor) */
export const MAX_PACK_TILES = 150_000

export interface OfflinePlanInput {
  /** points of every track */
  points: readonly LonLat[]
  /** union of the track bounds */
  bounds: LonLatBounds
  /** corridor width, metres (centred on the track) */
  corridorM: number
  terrain: TerrainSource
  /** null: relief only */
  imagery: ImagerySource | null
  imageryZoomOffset: number
  /** lowest height of the follow camera above the track, metres */
  cameraHeightM: number
  /** height of the rendered image, pixels (default 1080, a 1080p export) */
  viewportHeightPx?: number
}

export interface PlannedTile {
  url: string
  sourceId: string
}

export interface OfflinePlan {
  tiles: PlannedTile[]
  terrainTiles: number
  imageryTiles: number
  /** deepest terrain zoom in the pack */
  maxTerrainZoom: number
  /** terrain tiles per zoom */
  terrainByZoom: Record<number, number>
  estimatedBytes: number
}

/** Distance (metres) under which the engine splits `key`: r = cell · H / (2 · errorTarget · tan(fov / 2)). */
export function splitDistanceM(key: TileKey, viewportHeightPx: number): number {
  const cell = tileGroundSizeM(key) / DEFAULT_SEGMENTS
  return (cell * viewportHeightPx) / (2 * DEFAULT_ERROR_TARGET_PX * Math.tan((CAMERA_FOV_DEG / 2) * (Math.PI / 180)))
}

/** Track points in local metres (equirectangular around the centre), densified, with a grid for nearby queries. */
interface TrackIndex {
  /** is a track point within `limitM` of the box (metres)? */
  near(bounds: LonLatBounds, limitM: number): boolean
}

const STEP_M = 25
const CELL_M = 1_000

function indexTrack(points: readonly LonLat[], center: LonLat): TrackIndex {
  const ky = 111_320
  const kx = 111_320 * Math.cos((center.lat * Math.PI) / 180)
  const xs: number[] = []
  const ys: number[] = []
  const add = (x: number, y: number) => {
    xs.push(x)
    ys.push(y)
  }
  for (let i = 0; i < points.length; i++) {
    const x = (points[i].lon - center.lon) * kx
    const y = (points[i].lat - center.lat) * ky
    if (i > 0) {
      const px = xs[xs.length - 1]
      const py = ys[ys.length - 1]
      const steps = Math.floor(Math.hypot(x - px, y - py) / STEP_M)
      for (let s = 1; s < steps; s++) add(px + ((x - px) * s) / steps, py + ((y - py) * s) / steps)
    }
    add(x, y)
  }
  const grid = new Map<string, number[]>()
  for (let i = 0; i < xs.length; i++) {
    const key = `${Math.floor(xs[i] / CELL_M)},${Math.floor(ys[i] / CELL_M)}`
    let cell = grid.get(key)
    if (!cell) grid.set(key, (cell = []))
    cell.push(i)
  }

  const within = (i: number, x0: number, x1: number, y0: number, y1: number, limit2: number) => {
    const dx = Math.max(x0 - xs[i], 0, xs[i] - x1)
    const dy = Math.max(y0 - ys[i], 0, ys[i] - y1)
    return dx * dx + dy * dy <= limit2
  }

  return {
    near(b, limitM) {
      if (!(limitM >= 0) || xs.length === 0) return false
      const x0 = (b.west - center.lon) * kx
      const x1 = (b.east - center.lon) * kx
      const y0 = (b.south - center.lat) * ky
      const y1 = (b.north - center.lat) * ky
      const limit2 = limitM * limitM
      const cx0 = Math.floor((x0 - limitM) / CELL_M)
      const cx1 = Math.floor((x1 + limitM) / CELL_M)
      const cy0 = Math.floor((y0 - limitM) / CELL_M)
      const cy1 = Math.floor((y1 + limitM) / CELL_M)
      if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > grid.size) {
        // big box (coarse levels): every point
        for (let i = 0; i < xs.length; i++) if (within(i, x0, x1, y0, y1, limit2)) return true
        return false
      }
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const cell = grid.get(`${cx},${cy}`)
          if (cell) for (const i of cell) if (within(i, x0, x1, y0, y1, limit2)) return true
        }
      }
      return false
    },
  }
}

export function planOfflineTiles(input: OfflinePlanInput): OfflinePlan {
  const { terrain, imagery } = input
  const viewportHeightPx = input.viewportHeightPx ?? 1080
  const h = Math.max(0, input.cameraHeightM)
  const halfCorridor = Math.max(0, input.corridorM / 2)
  const area = expandBounds(input.bounds, AREA_MARGIN_M, AREA_MIN_SIZE_M)
  const track = indexTrack(input.points, {
    lon: (input.bounds.west + input.bounds.east) / 2,
    lat: (input.bounds.south + input.bounds.north) / 2,
  })

  const rootZ = zoomForTileBudget(area, DEFAULT_TUNING.rootTileBudget, terrain.minZoom, Math.max(terrain.minZoom, terrain.maxZoom))
  const terrainKeys: TileKey[] = []
  const stack = tilesForBounds(area, rootZ)
  while (stack.length > 0) {
    const key = stack.pop() as TileKey
    terrainKeys.push(key)
    if (key.z >= terrain.maxZoom) continue
    const r = splitDistanceM(key, viewportHeightPx)
    if (r <= h) continue
    let limit = Math.sqrt(r * r - h * h)
    if (key.z >= rootZ + LANDSCAPE_LEVELS) limit = Math.min(limit, halfCorridor)
    if (track.near(tileBounds(key), limit)) stack.push(...childrenOf(key))
  }

  const tiles: PlannedTile[] = []
  const seen = new Set<string>()
  const terrainByZoom: Record<number, number> = {}
  let estimatedBytes = 0
  const add = (url: string, sourceId: string) => {
    if (seen.has(url)) return false
    seen.add(url)
    tiles.push({ url, sourceId })
    estimatedBytes += offlinePolicy(sourceId).typicalTileBytes
    return true
  }
  let maxTerrainZoom = rootZ
  for (const key of terrainKeys) {
    add(buildTileUrl(terrain, key), terrain.id)
    terrainByZoom[key.z] = (terrainByZoom[key.z] ?? 0) + 1
    maxTerrainZoom = Math.max(maxTerrainZoom, key.z)
  }
  let imageryTiles = 0
  if (imagery) {
    for (const key of terrainKeys) {
      for (const op of planImagerySubtiles(key, imagery, input.imageryZoomOffset).tiles) {
        if (add(buildTileUrl(imagery, op.key), imagery.id)) imageryTiles++
      }
    }
  }
  return { tiles, terrainTiles: terrainKeys.length, imageryTiles, maxTerrainZoom, terrainByZoom, estimatedBytes }
}

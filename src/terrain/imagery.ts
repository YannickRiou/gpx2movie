/**
 * Composite imagery texture for one terrain tile.
 *
 * For a terrain tile (z, x, y) and `zoomOffset = k`, the 2^k x 2^k imagery sub-tiles at z + k are drawn
 * into one canvas of `tileSize * 2^k` pixels, which becomes a sRGB `CanvasTexture` with mipmaps.
 * When z + k exceeds the source's maxZoom, the deepest available tiles are cropped / scaled up instead.
 * Sub-tiles outside the source coverage are skipped; failed sub-tiles are left grey; the promise only
 * rejects when every sub-tile failed or the signal was aborted.
 *
 * `planImagerySubtiles` is pure (and tested); `loadImageryTexture` does the fetching and drawing.
 */
import { errorText } from '../core/errors'
import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'
import type { Texture } from 'three'
import type { ImagerySource, LoadImageryOptions, LoadImageryTexture, TileFetcher, TileKey } from '../core/types'
import { boundsIntersect, tileBounds, tileKeyString } from '../geo/mercator'
import { buildTileUrl } from './sources'
import { isAbortError } from './fetch'

/** Neutral grey drawn where imagery is missing (failed, aborted or out of coverage). */
export const IMAGERY_FALLBACK_COLOR = '#8a8f94'

/** Largest zoom offset honoured (2^4 = 16 sub-tiles per side, a 4096 px canvas for 256 px tiles). */
export const MAX_IMAGERY_ZOOM_OFFSET = 4

export interface ImageryDrawOp {
  /** Source tile to fetch. */
  key: TileKey
  /** Destination rectangle in the composite canvas, pixels. */
  dx: number
  dy: number
  dw: number
  dh: number
  /** Source rectangle in the fetched tile, pixels (the whole tile unless cropping a coarser zoom). */
  sx: number
  sy: number
  sw: number
  sh: number
}

export interface ImageryPlan {
  canvasSize: number
  tiles: ImageryDrawOp[]
}

/**
 * Plan which source tiles to draw where, for the terrain tile `key` at `zoomOffset` levels of extra detail.
 *   - z + k <= maxZoom : 2^k x 2^k whole tiles at z + k.
 *   - z + k >  maxZoom : the tiles at maxZoom intersecting the terrain tile, each cropped to the part that
 *     covers it and scaled up (when maxZoom < z a single ancestor tile is cropped).
 *   - effective zoom below minZoom, or sub-tile outside `coverage` : skipped (left grey).
 */
export function planImagerySubtiles(key: TileKey, source: ImagerySource, zoomOffset: number): ImageryPlan {
  const k = Math.min(MAX_IMAGERY_ZOOM_OFFSET, Math.max(0, Math.floor(zoomOffset)))
  const canvasSize = source.tileSize * 2 ** k
  const tiles: ImageryDrawOp[] = []

  const sourceZ = Math.min(key.z + k, source.maxZoom)
  if (sourceZ < source.minZoom) return { canvasSize, tiles }

  // Terrain tile extent in source-tile units at `sourceZ` (exact: powers of two).
  const scale = 2 ** (sourceZ - key.z)
  const left = key.x * scale
  const top = key.y * scale
  const right = left + scale
  const bottom = top + scale
  const pxPerSourceTile = canvasSize / scale

  const colStart = Math.floor(left)
  const colEnd = Math.ceil(right) - 1
  const rowStart = Math.floor(top)
  const rowEnd = Math.ceil(bottom) - 1

  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      const subKey: TileKey = { z: sourceZ, x: col, y: row }
      if (source.coverage && !boundsIntersect(tileBounds(subKey), source.coverage)) continue

      // Intersection of the source tile with the terrain tile, in source-tile units.
      const ix0 = Math.max(col, left)
      const ix1 = Math.min(col + 1, right)
      const iy0 = Math.max(row, top)
      const iy1 = Math.min(row + 1, bottom)

      tiles.push({
        key: subKey,
        sx: (ix0 - col) * source.tileSize,
        sy: (iy0 - row) * source.tileSize,
        sw: (ix1 - ix0) * source.tileSize,
        sh: (iy1 - iy0) * source.tileSize,
        dx: (ix0 - left) * pxPerSourceTile,
        dy: (iy0 - top) * pxPerSourceTile,
        dw: (ix1 - ix0) * pxPerSourceTile,
        dh: (iy1 - iy0) * pxPerSourceTile,
      })
    }
  }
  return { canvasSize, tiles }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

type CompositeCanvas = OffscreenCanvas | HTMLCanvasElement
type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

function createCanvas(size: number): CompositeCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(size, size)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  return canvas
}

function createAbortError(): DOMException {
  return new DOMException('Imagery loading was aborted.', 'AbortError')
}

function createTexture(canvas: CompositeCanvas, key: TileKey): Texture {
  const texture = new CanvasTexture<CompositeCanvas>(canvas)
  texture.name = `imagery ${tileKeyString(key)}`
  texture.colorSpace = SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.anisotropy = 16 // the engine clamps it to the renderer's maximum
  texture.flipY = true // canvas row 0 is the north edge; the mesh builder uses uv.y = 1 - v
  texture.needsUpdate = true
  return texture
}

export const loadImageryTexture: LoadImageryTexture = async (
  key: TileKey,
  source: ImagerySource,
  fetcher: TileFetcher,
  options: LoadImageryOptions,
): Promise<Texture> => {
  const { signal, priority } = options
  if (signal?.aborted) throw createAbortError()

  const plan = planImagerySubtiles(key, source, options.zoomOffset)
  const results = await Promise.allSettled(
    plan.tiles.map((op) => fetcher.fetchBitmap(buildTileUrl(source, op.key), { priority, signal })),
  )
  if (signal?.aborted) throw createAbortError()

  const canvas = createCanvas(plan.canvasSize)
  const ctx = canvas.getContext('2d') as Canvas2D | null
  if (!ctx) throw new Error('2D canvas context unavailable: cannot composite imagery.')

  ctx.fillStyle = IMAGERY_FALLBACK_COLOR
  ctx.fillRect(0, 0, plan.canvasSize, plan.canvasSize)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  let drawn = 0
  let failure: unknown
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'rejected') {
      if (!isAbortError(result.reason)) failure = result.reason
      continue
    }
    const op = plan.tiles[i]
    const bitmap = result.value
    // The plan is expressed in catalogue pixels; scale the source rectangle to the bitmap really received.
    const kx = bitmap.width / source.tileSize
    const ky = bitmap.height / source.tileSize
    try {
      ctx.drawImage(bitmap, op.sx * kx, op.sy * ky, op.sw * kx, op.sh * ky, op.dx, op.dy, op.dw, op.dh)
      drawn++
    } catch (error) {
      // A bitmap evicted and closed by the cache meanwhile: leave the area grey.
      failure = error
    }
  }

  if (plan.tiles.length > 0 && drawn === 0) {
    // Every sub-tile was cancelled by the fetcher itself (clear() on dispose): report it as an abort, not a failure.
    if (failure === undefined) throw createAbortError()
    const cause = errorText(failure)
    throw new Error(`No imagery could be loaded for tile ${tileKeyString(key)} (${source.id}): ${cause}`, {
      cause: failure,
    })
  }
  return createTexture(canvas, key)
}

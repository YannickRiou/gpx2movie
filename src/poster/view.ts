/**
 * The poster's view: what it frames (every loaded track), and the « Carte à plat » map, drawn in 2D from the imagery
 * tiles of the source in use instead of the 3D overview: seen from straight above (Web Mercator, north up), no
 * perspective, no haze, each track in its colour over a casing of the poster's page colour.
 *
 * `framingPath` and `planFlatMap` are pure (tested); `renderFlatMap` fetches the tiles and draws.
 */
import { clamp } from '../core/math'
import type { LonLatBounds, TileFetcher, TileKey, TileSourceBase, Track } from '../core/types'
import { buildTrackPath } from '../flyover/path'
import type { TrackPath } from '../flyover/path'
import { boundsIntersect, lonLatToTileFrac, tileBounds } from '../geo/mercator'
import { buildTileUrl } from '../terrain/sources'

/** Share of the view's width and height left free around the tracks, on each side. */
export const FLAT_MAP_MARGIN = 0.08
/** Tiles of one map at most: the zoom goes down until they fit (a print, not a bulk download). */
export const FLAT_MAP_MAX_TILES = 300
/** Where a tile is missing: the grey of the 3D view without imagery (`IMAGERY_FALLBACK_COLOR`). */
const MISSING_TILE = '#8A8F94'

/** Every track as one path: the box the overview of the poster frames. */
export function framingPath(tracks: readonly Track[]): TrackPath {
  return buildTrackPath({ ...tracks[0], segments: tracks.flatMap((t) => t.segments) })
}

/** A tile and where it goes in the view (whole pixels: neighbours meet without a seam). */
export interface FlatMapTile {
  key: TileKey
  x: number
  y: number
  w: number
  h: number
}

export interface FlatMapPlan {
  zoom: number
  tiles: FlatMapTile[]
  /** pixel of the view at a lon/lat */
  project(lon: number, lat: number): { x: number; y: number }
}

/**
 * Tiles of a `width` × `height` px map of `bounds` (the tracks), centred, inside FLAT_MAP_MARGIN, never more zoomed
 * than the source's deepest tiles. Tiles are drawn near their own size (zoom rounded: × 0.7 to × 1.4), at a lower
 * zoom when they would be more than `maxTiles`; those outside the source's coverage are left out.
 */
export function planFlatMap(
  bounds: LonLatBounds,
  width: number,
  height: number,
  source: Pick<TileSourceBase, 'tileSize' | 'minZoom' | 'maxZoom' | 'coverage'>,
  maxTiles = FLAT_MAP_MAX_TILES,
): FlatMapPlan {
  // Web Mercator at zoom 0: the world is the unit square, y down from the north edge
  const nw = lonLatToTileFrac(bounds.west, bounds.north, 0)
  const se = lonLatToTileFrac(bounds.east, bounds.south, 0)
  const room = 1 - 2 * FLAT_MAP_MARGIN
  // view pixels per world unit
  const k = Math.min((width * room) / (se.x - nw.x), (height * room) / (se.y - nw.y), source.tileSize * 2 ** source.maxZoom)
  const left = (nw.x + se.x) / 2 - width / (2 * k)
  const top = (nw.y + se.y) / 2 - height / (2 * k)

  const rangeAt = (z: number) => {
    const n = 2 ** z
    const index = (world: number) => clamp(Math.floor(world * n), 0, n - 1)
    return { n, x0: index(left), x1: index(left + width / k), y0: index(top), y1: index(top + height / k) }
  }
  const countAt = (z: number) => {
    const r = rangeAt(z)
    return (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1)
  }
  let zoom = clamp(Math.round(Math.log2(k / source.tileSize)), source.minZoom, source.maxZoom)
  while (zoom > source.minZoom && countAt(zoom) > maxTiles) zoom--

  const { n, x0, x1, y0, y1 } = rangeAt(zoom)
  const pixelX = (world: number) => Math.round((world - left) * k)
  const pixelY = (world: number) => Math.round((world - top) * k)
  const tiles: FlatMapTile[] = []
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const key = { z: zoom, x, y }
      if (source.coverage && !boundsIntersect(tileBounds(key), source.coverage)) continue
      const px = pixelX(x / n)
      const py = pixelY(y / n)
      tiles.push({ key, x: px, y: py, w: pixelX((x + 1) / n) - px, h: pixelY((y + 1) / n) - py })
    }
  }
  return {
    zoom,
    tiles,
    project(lon, lat) {
      const f = lonLatToTileFrac(lon, lat, 0)
      return { x: (f.x - left) * k, y: (f.y - top) * k }
    },
  }
}

export interface FlatMapInput {
  width: number
  height: number
  /** box of every track */
  bounds: LonLatBounds
  source: TileSourceBase
  tracks: readonly Track[]
  /** width of a track line (px), over a casing twice as wide */
  lineWidth: number
  casing: string
  fetcher: TileFetcher
  signal: AbortSignal
}

/** Each segment of each track: casings first, so a line crossing another stays whole. */
function drawTracks(ctx: OffscreenCanvasRenderingContext2D, plan: FlatMapPlan, input: FlatMapInput): void {
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const stroke = (colorOf: (track: Track) => string, width: number) => {
    for (const track of input.tracks) {
      for (const segment of track.segments) {
        ctx.beginPath()
        segment.points.forEach((p, i) => {
          const { x, y } = plan.project(p.lon, p.lat)
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.strokeStyle = colorOf(track)
        ctx.lineWidth = width
        ctx.stroke()
      }
    }
  }
  stroke(() => input.casing, input.lineWidth * 2)
  stroke((track) => track.color, input.lineWidth)
}

/** The flat map, tiles drawn as they come (grey where one fails). Rejects when not a single tile came. */
export async function renderFlatMap(input: FlatMapInput): Promise<OffscreenCanvas> {
  const { width, height, source, fetcher, signal } = input
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error("Impossible de créer l'image de la carte.")
  ctx.fillStyle = MISSING_TILE
  ctx.fillRect(0, 0, width, height)
  const plan = planFlatMap(input.bounds, width, height, source)
  const loaded = await Promise.allSettled(
    plan.tiles.map(async (tile) => {
      const bitmap = await fetcher.fetchBitmap(buildTileUrl(source, tile.key), { signal })
      ctx.drawImage(bitmap, tile.x, tile.y, tile.w, tile.h)
    }),
  )
  signal.throwIfAborted()
  if (plan.tiles.length > 0 && loaded.every((r) => r.status === 'rejected')) {
    throw new Error(`Impossible de charger la carte : aucune tuile de « ${source.name} » reçue.`)
  }
  drawTracks(ctx, plan, input)
  return canvas
}

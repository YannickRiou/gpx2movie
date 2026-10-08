/**
 * The poster from the stores: its content (every track, weather of the first one's outing, credits of the sources in
 * use), its export (an overview still of the 3D view framing every track, or the flat map, at the size of the
 * layout's view box, composed into the poster by `drawPoster`), and the last rendered view, kept small for the live
 * preview of the panel.
 */
import { create } from 'zustand'
import type { Track } from '../core/types'
import { useExportStore } from '../export/store'
import { climbsOf } from '../flyover/climbs'
import { buildTrackPath } from '../flyover/path'
import { useLandmarkStore } from '../osm/store'
import { loadOverlayFonts } from '../overlay/assets'
import { overlayCredits } from '../overlay/data'
import { useAppStore } from '../state/store'
import type { AppState } from '../state/store'
import { effectiveProjectName } from '../ui/shell'
import { summarizeOuting } from '../weather/series'
import { createTileFetcher } from '../terrain/fetch'
import { getImagerySource } from '../terrain/sources'
import { useWeatherStore } from '../weather/store'
import { posterContent } from './content'
import type { PosterContent } from './content'
import { POSTER_THEMES, drawPoster } from './draw'
import { posterLayout } from './layout'
import type { Box, PosterRows } from './layout'
import { posterSize } from './settings'
import { framingPath, renderFlatMap } from './view'

/** Longest side of the view kept for the preview (px). */
const PREVIEW_VIEW_PX = 480
/** Simultaneous tile requests of a flat map (the imagery servers are shared). */
const FLAT_MAP_CONCURRENCY = 6

/** Rows of the layout for a content. */
export function posterRows(content: PosterContent): PosterRows {
  return {
    subtitle: content.subtitle !== '',
    figures: content.figures.length,
    profile: content.profile !== undefined,
    weather: content.weather !== '',
    tracks: content.tracks.length,
  }
}

/** File name without extension: « <projet> – affiche ». */
function posterBaseName(projectName: string): string {
  return `${projectName} – affiche`
}

/** The poster of the tracks with the current settings, null without a track. */
export function currentPosterContent(): PosterContent | null {
  const { tracks, settings, projectName } = useAppStore.getState()
  const track = tracks[0]
  if (!track) return null
  const weatherState = useWeatherStore.getState()
  const series = weatherState.status === 'ready' && weatherState.trackId === track.id ? weatherState.series : null
  // rebuilt on every preview redraw (each keystroke in the title): built once for the profile and the weather
  const path = buildTrackPath(track)
  return posterContent({
    tracks,
    race: settings.race.enabled,
    path,
    poster: settings.poster,
    projectName: effectiveProjectName(projectName, track.name),
    climbs: tracks.map((t) => climbsOf(t).length),
    weather: series ? summarizeOuting(series, path) : undefined,
    credits: overlayCredits({
      terrainSourceId: settings.terrainSourceId,
      imagerySourceId: settings.imagerySourceId,
      weather: series !== null,
      landmarks: Object.values(useLandmarkStore.getState().landmarks).some((list) => list.length > 0),
    }),
  })
}

export interface PosterPreviewState {
  /** last rendered view, scaled down, and what it shows (`previewKey`) */
  view: { key: string; image: ImageBitmap; width: number; height: number } | null
}

/** What a rendered view shows: these tracks, in 3D or as a flat map. */
export function previewKey(tracks: readonly Track[], flat: boolean): string {
  return `${flat ? 'plat' : '3d'}:${tracks.map((t) => t.id).join(',')}`
}

export const usePosterPreview = create<PosterPreviewState>()(() => ({ view: null }))

async function rememberView(key: string, view: OffscreenCanvas): Promise<void> {
  const scale = Math.min(1, PREVIEW_VIEW_PX / Math.max(view.width, view.height))
  const width = Math.max(1, Math.round(view.width * scale))
  const height = Math.max(1, Math.round(view.height * scale))
  try {
    const image = await createImageBitmap(view, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' })
    usePosterPreview.getState().view?.image.close()
    usePosterPreview.setState({ view: { key, image, width, height } })
  } catch {
    // the preview keeps its placeholder
  }
}

/** The flat map of every track for a view box of `width` × `height` px, from the imagery source in use. */
async function drawFlatView(
  { w: width, h: height }: Box,
  { tracks, bounds, settings }: Pick<AppState, 'tracks' | 'bounds' | 'settings'>,
  signal: AbortSignal,
): Promise<OffscreenCanvas> {
  if (!bounds) throw new Error('Aucune trace à dessiner.')
  const fetcher = createTileFetcher({ concurrency: FLAT_MAP_CONCURRENCY, maxEntries: 32 })
  try {
    return await renderFlatMap({
      width,
      height,
      bounds,
      source: getImagerySource(settings.imagerySourceId),
      tracks,
      // the width of the 3D line (`trackStyle.width` on a 1080 px frame)
      lineWidth: (settings.trackStyle.width * Math.min(width, height)) / 1080,
      casing: POSTER_THEMES[settings.poster.style].page,
      fetcher,
      signal,
    })
  } finally {
    fetcher.clear()
  }
}

/**
 * Ask the export controller for the poster: its fonts loaded first (the text is fitted with them), the view (the 3D
 * overview of every track, or the flat map) at the size of the layout's view box, then the whole poster composed as a
 * PNG. False without a track.
 */
export async function startPoster(): Promise<boolean> {
  const content = currentPosterContent()
  const state = useAppStore.getState()
  const { tracks, settings, projectName, playback } = state
  const track = tracks[0]
  if (!content || !track) return false
  await loadOverlayFonts()
  const { format, style, flat } = settings.poster
  const { width, height } = posterSize(format)
  const layout = posterLayout(width, height, style, posterRows(content))
  useExportStore.getState().start({
    width: layout.view.w,
    height: layout.view.h,
    fps: 30,
    quality: 'high',
    durationS: 0,
    holdStartS: 0,
    holdEndS: 0,
    baseName: posterBaseName(effectiveProjectName(projectName, track.name)),
    still: {
      progress: playback.progress,
      type: 'image/png',
      overview: true,
      framing: framingPath(tracks),
      drawView: flat ? (signal) => drawFlatView(layout.view, state, signal) : undefined,
      async compose(view) {
        const poster = new OffscreenCanvas(width, height)
        const ctx = poster.getContext('2d', { alpha: false })
        if (!ctx) throw new Error("Impossible de créer l'image de l'affiche.")
        drawPoster(ctx, layout, content, style, { image: view, width: view.width, height: view.height })
        await rememberView(previewKey(tracks, flat), view)
        return poster
      },
    },
  })
  return true
}

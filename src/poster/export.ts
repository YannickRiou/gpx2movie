/**
 * The poster from the stores: its content (first track, weather of the outing, credits of the sources in use), its
 * export (an overview still of the 3D view at the size of the layout's view box, composed into the poster by
 * `drawPoster`), and the last rendered view, kept small for the live preview of the panel.
 */
import { create } from 'zustand'
import { useExportStore } from '../export/store'
import { climbsOf } from '../flyover/climbs'
import { buildTrackPath } from '../flyover/path'
import { useLandmarkStore } from '../osm/store'
import { loadOverlayFonts } from '../overlay/assets'
import { overlayCredits } from '../overlay/data'
import { useAppStore } from '../state/store'
import { effectiveProjectName } from '../ui/shell'
import { summarizeOuting } from '../weather/series'
import { useWeatherStore } from '../weather/store'
import { posterContent } from './content'
import type { PosterContent } from './content'
import { drawPoster } from './draw'
import { posterLayout } from './layout'
import type { PosterRows } from './layout'
import { posterSize } from './settings'

/** Longest side of the view kept for the preview (px). */
export const PREVIEW_VIEW_PX = 480

/** Rows of the layout for a content. */
export function posterRows(content: PosterContent): PosterRows {
  return {
    subtitle: content.subtitle !== '',
    figures: content.figures.length,
    profile: content.profile !== undefined,
    weather: content.weather !== '',
  }
}

/** File name without extension: « <projet> – affiche ». */
export function posterBaseName(projectName: string): string {
  return `${projectName} – affiche`
}

/** The poster of the first track with the current settings, null without a track. */
export function currentPosterContent(): PosterContent | null {
  const { tracks, settings, projectName } = useAppStore.getState()
  const track = tracks[0]
  if (!track) return null
  const weatherState = useWeatherStore.getState()
  const series = weatherState.status === 'ready' && weatherState.trackId === track.id ? weatherState.series : null
  return posterContent({
    track,
    poster: settings.poster,
    projectName: effectiveProjectName(projectName, track.name),
    climbs: climbsOf(track).length,
    weather: series ? summarizeOuting(series, buildTrackPath(track)) : undefined,
    credits: overlayCredits({
      terrainSourceId: settings.terrainSourceId,
      imagerySourceId: settings.imagerySourceId,
      weather: series !== null,
      landmarks: Object.values(useLandmarkStore.getState().landmarks).some((list) => list.length > 0),
    }),
  })
}

export interface PosterPreviewState {
  /** last rendered view of this track, scaled down */
  view: { trackId: string; image: ImageBitmap; width: number; height: number } | null
}

export const usePosterPreview = create<PosterPreviewState>()(() => ({ view: null }))

async function rememberView(trackId: string, view: OffscreenCanvas): Promise<void> {
  const scale = Math.min(1, PREVIEW_VIEW_PX / Math.max(view.width, view.height))
  const width = Math.max(1, Math.round(view.width * scale))
  const height = Math.max(1, Math.round(view.height * scale))
  try {
    const image = await createImageBitmap(view, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' })
    usePosterPreview.getState().view?.image.close()
    usePosterPreview.setState({ view: { trackId, image, width, height } })
  } catch {
    // the preview keeps its placeholder
  }
}

/**
 * Ask the export controller for the poster: its fonts loaded first (the text is fitted with them), the 3D view
 * rendered at the size of the layout's view box, then the whole poster composed as a PNG. False without a track.
 */
export async function startPoster(): Promise<boolean> {
  const content = currentPosterContent()
  const { tracks, settings, projectName, playback } = useAppStore.getState()
  const track = tracks[0]
  if (!content || !track) return false
  await loadOverlayFonts()
  const { format, style } = settings.poster
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
      async compose(view) {
        const poster = new OffscreenCanvas(width, height)
        const ctx = poster.getContext('2d', { alpha: false })
        if (!ctx) throw new Error("Impossible de créer l'image de l'affiche.")
        drawPoster(ctx, layout, content, style, { image: view, width: view.width, height: view.height })
        await rememberView(track.id, view)
        return poster
      },
    },
  })
  return true
}

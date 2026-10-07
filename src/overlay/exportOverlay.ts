/**
 * Bridge between the film overlay and the video export: the export draws every frame through the same
 * `drawOverlay` as the preview (OverlayCanvas), so the movie shows exactly what the viewer sees.
 *
 * The export draws synchronously, so the logo is loaded ahead of time, whenever the setting changes, and the
 * pictures of the photos shown by a frame before it is composed (`loadFramePhotos`).
 * `overlayExtras` reads what both draw beyond the track (timeline texts and photos, credits of the sources in use).
 */
import type { Track } from '../core/types'
import type { DrawOverlay } from '../export/capture'
import { getMediaBitmaps, mediaToLoad } from '../film/media'
import { useLandmarkStore } from '../osm/store'
import { useAppStore } from '../state/store'
import { useWeatherStore } from '../weather/store'
import type { WeatherSeries } from '../weather/series'
import { loadLogo } from './assets'
import { overlayCredits, overlayFrameAt, prepareOverlayTrack } from './data'
import type { OverlayTrack } from './data'
import { drawOverlay } from './draw'
import type { OverlayAssets, OverlayExtras, OverlayTime } from './draw'

/**
 * What the overlay draws beyond the track at film time `time`, from the stores: the texts and photos of the
 * timeline and the credits of the sources in use (as the status bar: relief, imagery, weather and landmarks once
 * loaded).
 */
export function overlayExtras(time: OverlayTime): OverlayExtras {
  const { settings } = useAppStore.getState()
  return {
    time,
    texts: settings.film.texts,
    media: settings.film.media,
    credits: overlayCredits({
      terrainSourceId: settings.terrainSourceId,
      imagerySourceId: settings.imagerySourceId,
      weather: useWeatherStore.getState().status === 'ready',
      landmarks: Object.values(useLandmarkStore.getState().landmarks).some((list) => list.length > 0),
    }),
  }
}

/** Decoded pictures for `drawOverlay` (`OverlayAssets.photo`), shared by the preview and the export. */
export function photoAssets(): Pick<OverlayAssets, 'photo'> {
  const bitmaps = getMediaBitmaps()
  return { photo: (src) => bitmaps.get(src) }
}

/** Resolve once the pictures of the photos shown at film time `timeS` are decoded (export, before a frame). */
export function loadFramePhotos(timeS: number): Promise<void> {
  return getMediaBitmaps().load(mediaToLoad(useAppStore.getState().settings.film.media, timeS))
}

export interface OverlayDrawer {
  draw: DrawOverlay
  dispose(): void
}

export function createOverlayDrawer(): OverlayDrawer {
  let track: Track | undefined
  let series: WeatherSeries | null = null
  let data: OverlayTrack | null = null
  let logoSource = ''
  let assets: OverlayAssets = {}
  let disposed = false

  const syncLogo = (source: string) => {
    if (source === logoSource) return
    logoSource = source
    assets = {}
    if (!source) return
    loadLogo(source)
      .then((logo) => {
        if (!disposed && logoSource === source) assets = { logo }
      })
      .catch(() => {
        // unreadable image: drawn without logo
      })
  }
  syncLogo(useAppStore.getState().settings.overlay.logo.image)
  const unsubscribe = useAppStore.subscribe((state) => syncLogo(state.settings.overlay.logo.image))

  return {
    draw(ctx, at, width, height) {
      const { tracks, settings } = useAppStore.getState()
      const first = tracks[0]
      if (!first) return
      const weather = useWeatherStore.getState().series
      if (first !== track || weather !== series || !data) {
        track = first
        series = weather
        data = prepareOverlayTrack(first, weather)
      }
      drawOverlay(ctx, overlayFrameAt(data, at.progress), settings.overlay, { width, height }, { ...assets, ...photoAssets() }, overlayExtras(at.time))
    },
    dispose() {
      disposed = true
      unsubscribe()
    },
  }
}

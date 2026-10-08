/**
 * Bridge between the film overlay and the video export: the export draws every frame through the same
 * `drawOverlay` as the preview (OverlayCanvas), so the movie shows exactly what the viewer sees.
 *
 * The export draws synchronously, so the logo is loaded ahead of time, whenever the setting changes, and the
 * pictures of the photos and the frames of the video clips shown by a frame before it is composed
 * (`loadFrameMedia`, decoded at the frame's time: never real-time playback; `releaseFrameMedia` after the export).
 * `overlayExtras` reads what both draw beyond the track (timeline texts and photos, credits of the sources in use,
 * ghost-race leaderboard, dip of a shot transition).
 */
import type { Track } from '../core/types'
import { transitionDipAt } from '../film/model'
import type { FilmMedia } from '../film/model'
import type { DrawOverlay } from '../export/capture'
import { getMediaBitmaps, mediaToLoad, useMediaStore } from '../film/media'
import { createExportVideos } from '../film/video'
import type { ExportVideos } from '../film/video'
import { useLandmarkStore, useWaterStore } from '../osm/store'
import { useAppStore } from '../state/store'
import { useWeatherStore } from '../weather/store'
import type { WeatherSeries } from '../weather/series'
import { buildTrackPath } from '../flyover/path'
import type { TrackPath } from '../flyover/path'
import { buildRace, raceAt, raceTrackOf } from '../flyover/race'
import { loadLogo } from './assets'
import { leaderboardRows, overlayCredits, overlayFrameAt, prepareOverlayTrack, recordedAtProgress } from './data'
import type { LeaderboardRow, OverlayTrack } from './data'
import { drawOverlay } from './draw'
import type { OverlayAssets, OverlayExtras, OverlayTime } from './draw'

/** Leaderboard of the ghost race at `progress`, while the race and its widget are on (2+ tracks). */
function leaderboardAt(progress: number): LeaderboardRow[] | undefined {
  const { tracks, settings } = useAppStore.getState()
  if (!settings.overlay.leaderboard.enabled || !settings.race.enabled || tracks.length < 2) return undefined
  // tables cached per track: building the race is cheap
  const race = buildRace(tracks.map(raceTrackOf), settings.race.sync)
  return leaderboardRows(raceAt(race, progress), tracks)
}

/**
 * What the overlay draws beyond the track at film time `time` and `progress`, from the stores: the texts and photos
 * of the timeline, the credits of the sources in use (as the status bar: relief, imagery, weather and landmarks once
 * loaded), the ghost-race leaderboard and the dip of a shot transition.
 */
export function overlayExtras(time: OverlayTime, progress: number): OverlayExtras {
  const { settings } = useAppStore.getState()
  return {
    time,
    leaderboard: leaderboardAt(progress),
    texts: settings.film.texts,
    media: settings.film.media,
    dip: transitionDipAt(settings.film, time),
    credits: overlayCredits({
      terrainSourceId: settings.terrainSourceId,
      imagerySourceId: settings.imagerySourceId,
      weather: useWeatherStore.getState().status === 'ready',
      landmarks:
        Object.values(useLandmarkStore.getState().landmarks).some((list) => list.length > 0) ||
        useWaterStore.getState().polygons > 0,
    }),
  }
}

/** Decoded pictures for `drawOverlay` (`OverlayAssets.photo`), shared by the preview and the export. */
export function photoAssets(): Pick<OverlayAssets, 'photo'> {
  const bitmaps = getMediaBitmaps()
  return { photo: (src) => bitmaps.get(src) }
}

/** Frames of the video clips for the export (opened at the first frame that shows one). */
let exportVideos: ExportVideos | null = null

/** Path of the first track, for the clips following the flight (built once per track). */
let followPath: { track: Track; path: TrackPath } | null = null

/**
 * Resolve once the pictures of the photos and the frames of the clips shown at film time `timeS` and `progress`
 * (where a clip following the flight takes its frame) are decoded (export, before a frame).
 */
export async function loadFrameMedia(timeS: number, progress: number): Promise<void> {
  const { tracks, settings } = useAppStore.getState()
  const { media } = settings.film
  if (media.some((m) => m.kind === 'video')) exportVideos ??= createExportVideos((id) => useMediaStore.getState().table[id])
  let recordedMs: number | undefined
  if (tracks[0] && media.some((m) => m.sync?.follow)) {
    if (followPath?.track !== tracks[0]) followPath = { track: tracks[0], path: buildTrackPath(tracks[0]) }
    recordedMs = recordedAtProgress(followPath.path, progress)
  }
  await Promise.all([getMediaBitmaps().load(mediaToLoad(media, timeS)), exportVideos?.load(media, timeS, recordedMs)])
}

/** Close the clips opened for the export. */
export function releaseFrameMedia(): void {
  exportVideos?.dispose()
  exportVideos = null
  followPath = null
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
      const video = (item: FilmMedia, clipS: number) => exportVideos?.get(item, clipS)
      drawOverlay(ctx, overlayFrameAt(data, at.progress), settings.overlay, { width, height }, { ...assets, ...photoAssets(), video }, overlayExtras(at.time, at.progress))
    },
    dispose() {
      disposed = true
      unsubscribe()
    },
  }
}

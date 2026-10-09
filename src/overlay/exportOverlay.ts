/**
 * Bridge between the film overlay and the video export: the export draws every frame through the same `drawOverlay` as
 * the preview (OverlayCanvas), so the movie shows what the viewer sees.
 *
 * The export draws synchronously, so the logo is loaded ahead of time and the pictures and video-clip frames shown by a
 * frame are decoded before it is composed (`loadFrameMedia`, at the frame's time; `releaseFrameMedia` after the export).
 * `overlayExtras` reads what both draw beyond the track (timeline texts and photos, credits, leaderboard, dips, cards).
 */
import type { Track } from '../core/types'
import { DIP_DEFAULT_S, dipAlpha, transitionDipAt } from '../film/model'
import type { FilmMedia, TransitionDip } from '../film/model'
import type { DrawOverlay } from '../export/capture'
import { getMediaBitmaps, mediaToLoad, useMediaStore } from '../film/media'
import { createExportVideos } from '../film/video'
import type { ExportVideos } from '../film/video'
import { useRegionStore } from '../osm/region'
import { useLandmarkStore, useWaterStore } from '../osm/store'
import { useAppStore } from '../state/store'
import { useWeatherStore, weatherShown, type StageWeather } from '../weather/store'
import type { WeatherSeries } from '../weather/series'
import { trackPathOf } from '../flyover/path'
import { buildRace, raceAt, raceTrackOf } from '../flyover/race'
import type { RaceSettings } from '../flyover/race'
import { filmSequenceOf, filmTrackOf } from '../flyover/sequence'
import type { Sequence } from '../flyover/sequence'
import { loadLogo } from './assets'
import { leaderboardRows, overlayCredits, overlayFilmFrameAt, prepareOverlayFilm, recordedAtProgress, stageCardAt } from './data'
import type { LeaderboardRow, OverlayFilm } from './data'
import { drawOverlay } from './draw'
import type { OverlayAssets, OverlayExtras, OverlayTime } from './draw'

/** Leaderboard of the ghost race at `progress`, while the race and its widget are on (2+ tracks). */
function leaderboardAt(progress: number): LeaderboardRow[] | undefined {
  const { tracks, settings } = useAppStore.getState()
  if (!settings.overlay.leaderboard.enabled || !settings.race.enabled || tracks.length < 2) return undefined
  // tables cached per track: building the race is cheap
  const race = buildRace(
    tracks.map((t) => raceTrackOf(t, settings.trackStyle.smoothingM)),
    settings.race.sync,
  )
  return leaderboardRows(raceAt(race, progress), tracks)
}

/** Dip of the cut between two stages « À la suite » at the frame's time, null without one (or with a plain cut). */
export function stageDipAt(race: Pick<RaceSettings, 'stageTransition'>, time: OverlayTime): TransitionDip | null {
  const transition = race.stageTransition ?? 'fondu-noir'
  if (transition === 'coupe') return null
  const alpha = Math.max(0, ...(time.cutsS ?? []).map((cutS) => dipAlpha(time.timeS, cutS, DIP_DEFAULT_S)))
  return alpha > 0 ? { color: transition === 'fondu-blanc' ? 'white' : 'black', alpha } : null
}

/** The stronger of two dips. */
const strongerDip = (a: TransitionDip | null, b: TransitionDip | null) => (b && b.alpha > (a?.alpha ?? 0) ? b : a)

/**
 * What the overlay draws beyond the track at film time `time` and `progress`, from the stores: the texts and photos
 * of the timeline, the credits of the sources in use (as the status bar: relief, imagery, weather and OpenStreetMap
 * once loaded), the ghost-race leaderboard, the dip of a shot transition, and « À la suite » the card and the dip of
 * each stage.
 */
export function overlayExtras(time: OverlayTime, progress: number): OverlayExtras {
  const { settings, tracks } = useAppStore.getState()
  const sequence = filmSequenceOf(tracks, settings.race)
  return {
    time,
    leaderboard: leaderboardAt(progress),
    texts: settings.film.texts,
    media: settings.film.media,
    dip: strongerDip(transitionDipAt(settings.film, time), sequence ? stageDipAt(settings.race, time) : null),
    stage: sequence && settings.race.stageCards !== false ? stageCardAt(sequence, time) : null,
    credits: overlayCredits({
      terrainSourceId: settings.terrainSourceId,
      imagerySourceId: settings.imagerySourceId,
      weather: weatherShown(useWeatherStore.getState()),
      landmarks:
        Object.values(useLandmarkStore.getState().landmarks).some((list) => list.length > 0) ||
        useWaterStore.getState().polygons > 0 ||
        useRegionStore.getState().region !== null,
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

/**
 * Resolve once the pictures of the photos and the frames of the clips shown at film time `timeS` and `progress`
 * (where a clip following the flight takes its frame) are decoded (export, before a frame).
 */
export async function loadFrameMedia(timeS: number, progress: number): Promise<void> {
  const { tracks, settings } = useAppStore.getState()
  const { media } = settings.film
  if (media.some((m) => m.kind === 'video')) exportVideos ??= createExportVideos((id) => useMediaStore.getState().table[id])
  let recordedMs: number | undefined
  const track = filmTrackOf(tracks, settings.race)
  if (track && media.some((m) => m.sync?.follow)) {
    recordedMs = recordedAtProgress(trackPathOf(track), progress)
  }
  await Promise.all([getMediaBitmaps().load(mediaToLoad(media, timeS)), exportVideos?.load(media, timeS, recordedMs)])
}

/** Close the clips opened for the export. */
export function releaseFrameMedia(): void {
  exportVideos?.dispose()
  exportVideos = null
}

export interface OverlayDrawer {
  draw: DrawOverlay
  dispose(): void
}

/**
 * Overlay data of the film of the stores (`prepareOverlayFilm`), made again only when the film track, its sequence or
 * the weather changes: shared by the preview and the export drawer.
 */
export function createOverlayFilmCache(): () => OverlayFilm | null {
  let track: Track | undefined
  let sequence: Sequence | null = null
  let series: WeatherSeries | null = null
  let stageSeries: Readonly<Record<string, StageWeather>> = {}
  let data: OverlayFilm | null = null
  return () => {
    const { tracks, settings } = useAppStore.getState()
    const nextSequence = filmSequenceOf(tracks, settings.race)
    const next = nextSequence?.track ?? tracks[0]
    if (!next) return null
    const { series: weather, stages } = useWeatherStore.getState()
    if (next !== track || nextSequence !== sequence || weather !== series || stages !== stageSeries || !data) {
      track = next
      sequence = nextSequence
      series = weather
      stageSeries = stages
      data = prepareOverlayFilm(next, nextSequence, weather, stages)
    }
    return data
  }
}

export function createOverlayDrawer(): OverlayDrawer {
  const film = createOverlayFilmCache()
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
      const data = film()
      if (!data) return
      const { settings } = useAppStore.getState()
      const video = (item: FilmMedia, clipS: number) => exportVideos?.get(item, clipS)
      drawOverlay(ctx, overlayFilmFrameAt(data, at.progress), settings.overlay, { width, height }, { ...assets, ...photoAssets(), video }, overlayExtras(at.time, at.progress))
    },
    dispose() {
      disposed = true
      unsubscribe()
    },
  }
}

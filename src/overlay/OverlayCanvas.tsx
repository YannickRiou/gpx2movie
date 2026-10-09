import { useEffect, useRef } from 'react'
import { isExportBusy, useExportStore } from '../export/store'
import { useMusicPreview } from '../film/audio'
import { getMediaBitmaps, mediaToLoad } from '../film/media'
import { shotDipColor } from '../film/model'
import type { FilmMedia } from '../film/model'
import { clipRateAt } from '../film/timeline'
import { getPreviewVideos } from '../film/video'
import { playsInSequence } from '../flyover/sequence'
import { useRegionStore } from '../osm/region'
import { useLandmarkStore, useWaterStore } from '../osm/store'
import { useFilmClock } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { useWeatherStore } from '../weather/store'
import { loadLogo, loadOverlayFonts } from './assets'
import { overlayFilmFrameAt } from './data'
import { drawOverlay, overlayTime } from './draw'
import type { OverlayAssets } from './draw'
import { createOverlayFilmCache, overlayExtras, photoAssets } from './exportOverlay'

/**
 * Preview of the film overlay: a 2D canvas stacked over the 3D view, redrawn by `drawOverlay` on the next
 * animation frame after the progress or film time, the settings, the film clock, the film track, its weather,
 * the landmarks, a decoded photo, a video frame or the view size change (store subscriptions, no React render per
 * frame). Video clips are video elements playing along during the playback, seeked to the film time when scrubbing
 * (none during an export, which decodes its own frames); their sound is heard while playing at ×1, unless the
 * timeline's speaker button cuts the sound of the preview. Rendered while the overlay or the source credits are
 * enabled, or the film has photos, clips, a dip to black or white between its shots and the flight, or stages
 * « À la suite » (their cards and dips).
 */
export function OverlayCanvas() {
  const enabled = useAppStore(
    (s) => {
      const { overlay, film } = s.settings
      const dips = shotDipColor(film.opening) !== null || shotDipColor(film.closing) !== null
      const stages = playsInSequence(s.settings.race, s.tracks.length)
      return (overlay.enabled || overlay.credits.enabled || film.media.length > 0 || dips || stages) && s.tracks.length > 0
    },
  )
  return enabled ? <OverlayPreview /> : null
}

/** Photos decoded this long before they appear (seconds of film time). */
const PHOTO_AHEAD_S = 2

function OverlayPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const clock = useFilmClock()
  const clockRef = useRef(clock)
  const scheduleRef = useRef<() => void>(() => {})
  useEffect(() => {
    clockRef.current = clock
    scheduleRef.current()
  }, [clock])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let raf = 0
    let disposed = false
    let fontsReady = false
    const film = createOverlayFilmCache()
    let logoSource = ''
    let assets: OverlayAssets = {}
    const bitmaps = getMediaBitmaps()
    const videos = getPreviewVideos()

    const draw = () => {
      raf = 0
      const { tracks, playback, settings } = useAppStore.getState()
      const overlay = settings.overlay
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const dpr = window.devicePixelRatio || 1
      const pixelW = Math.max(1, Math.round(width * dpr))
      const pixelH = Math.max(1, Math.round(height * dpr))
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW
        canvas.height = pixelH
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      // first frame only once the fonts are there: no flash of fallback faces
      const data = tracks.length > 0 ? film() : null
      if (!fontsReady || !data || width === 0 || height === 0) return

      const frame = overlayFilmFrameAt(data, playback.progress)
      if (overlay.logo.image !== logoSource) {
        const source = overlay.logo.image
        logoSource = source
        assets = {}
        loadLogo(source)
          .then((logo) => {
            if (disposed || logoSource !== source) return
            assets = { logo }
            schedule()
          })
          .catch(() => {
            // unreadable image: drawn without logo
          })
      }
      ctx.setTransform(pixelW / width, 0, 0, pixelH / height, 0, 0)
      const time = overlayTime(clockRef.current, playback.progress, playback.timeS)
      // decode the photos coming up before they fade in
      for (const id of mediaToLoad(settings.film.media, time.timeS, PHOTO_AHEAD_S)) bitmaps.get(id)
      const sound = { ...playback, muted: useMusicPreview.getState().muted }
      const video = isExportBusy(useExportStore.getState().phase)
        ? undefined
        : (item: FilmMedia, clipS: number) => videos.frame(item, clipS, sound, clipRateAt(item, data.whole.path, clockRef.current, time.timeS))
      drawOverlay(ctx, frame, overlay, { width, height }, { ...assets, ...photoAssets(), video }, overlayExtras(time, playback.progress))
      // clips not drawn by this frame are paused
      videos.settle()
    }
    const schedule = () => {
      if (!raf && !disposed) raf = requestAnimationFrame(draw)
    }

    scheduleRef.current = schedule

    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (
        state.playback.progress !== prev.playback.progress ||
        state.playback.timeS !== prev.playback.timeS ||
        state.playback.playing !== prev.playback.playing ||
        state.playback.speed !== prev.playback.speed ||
        state.settings !== prev.settings ||
        state.tracks !== prev.tracks
      ) {
        schedule()
      }
    })
    const unsubscribeWeather = useWeatherStore.subscribe((state, prev) => {
      if (state.series !== prev.series || state.status !== prev.status) schedule()
    })
    const unsubscribeLandmarks = useLandmarkStore.subscribe((state, prev) => {
      if (state.landmarks !== prev.landmarks) schedule()
    })
    // the OpenStreetMap credit also follows the water polygons and the highlighted region
    const unsubscribeWater = useWaterStore.subscribe((state, prev) => {
      if (state.polygons !== prev.polygons) schedule()
    })
    const unsubscribeRegion = useRegionStore.subscribe((state, prev) => {
      if (state.region !== prev.region) schedule()
    })
    const unsubscribeSound = useMusicPreview.subscribe(schedule)
    const unsubscribePhotos = bitmaps.subscribe(schedule)
    const unsubscribeVideos = videos.subscribe(schedule)
    // size changes, including a devicePixelRatio change (browser zoom, moving to another screen)
    const observer = new ResizeObserver(schedule)
    observer.observe(canvas)
    window.addEventListener('resize', schedule)
    loadOverlayFonts().then(() => {
      fontsReady = true
      schedule()
    })
    schedule()

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      scheduleRef.current = () => {}
      unsubscribe()
      unsubscribeWeather()
      unsubscribeLandmarks()
      unsubscribeWater()
      unsubscribeRegion()
      unsubscribeSound()
      unsubscribePhotos()
      unsubscribeVideos()
      videos.settle()
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [])

  return <canvas ref={canvasRef} className="overlay-canvas" aria-hidden="true" />
}

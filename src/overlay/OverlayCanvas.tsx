import { useEffect, useRef } from 'react'
import type { Track } from '../core/types'
import { useLandmarkStore } from '../osm/store'
import { useFilmClock } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { useWeatherStore } from '../weather/store'
import type { WeatherSeries } from '../weather/series'
import { loadLogo, loadOverlayFonts } from './assets'
import { overlayFrameAt, prepareOverlayTrack } from './data'
import type { OverlayTrack } from './data'
import { drawOverlay, overlayTime } from './draw'
import type { OverlayAssets } from './draw'
import { overlayExtras } from './exportOverlay'

/**
 * Preview of the film overlay: a 2D canvas stacked over the 3D view, redrawn by `drawOverlay` on the next
 * animation frame after the progress or film time, the settings, the film clock, the first track, its weather,
 * the landmarks or the view size change (store subscriptions, no React render per frame). Rendered while the
 * overlay or the source credits are enabled.
 */
export function OverlayCanvas() {
  const enabled = useAppStore((s) => (s.settings.overlay.enabled || s.settings.overlay.credits.enabled) && s.tracks.length > 0)
  return enabled ? <OverlayPreview /> : null
}

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
    let track: Track | undefined
    let series: WeatherSeries | null = null
    let data: OverlayTrack | null = null
    let logoSource = ''
    let assets: OverlayAssets = {}

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
      if (!fontsReady || !tracks[0] || width === 0 || height === 0) return

      const weather = useWeatherStore.getState().series
      if (tracks[0] !== track || weather !== series || !data) {
        track = tracks[0]
        series = weather
        data = prepareOverlayTrack(track, weather)
      }
      const frame = overlayFrameAt(data, playback.progress)
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
      drawOverlay(ctx, frame, overlay, { width, height }, assets, overlayExtras(time))
    }
    const schedule = () => {
      if (!raf && !disposed) raf = requestAnimationFrame(draw)
    }

    scheduleRef.current = schedule

    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (
        state.playback.progress !== prev.playback.progress ||
        state.playback.timeS !== prev.playback.timeS ||
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
      observer.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [])

  return <canvas ref={canvasRef} className="overlay-canvas" aria-hidden="true" />
}

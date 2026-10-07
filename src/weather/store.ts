/**
 * Weather of the first track (zustand), fetched when a timed track is loaded and `settings.weather.enabled`
 * allows it. `syncWeather` is idempotent: calling it again for the same track and setting does nothing, so
 * React effects may call it freely.
 */
import { create } from 'zustand'
import type { Track } from '../core/types'
import { buildTrackPath } from '../flyover/path'
import { WeatherError, fetchOutingWeather } from './openMeteo'
import type { WeatherSeries } from './series'

export type WeatherStatus = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'

export interface WeatherState {
  status: WeatherStatus
  /** why there is no weather (unavailable / error), in French */
  message: string | null
  series: WeatherSeries | null
  /** track the status refers to */
  trackId: string | null
}

const INITIAL: WeatherState = { status: 'idle', message: null, series: null, trackId: null }

export const useWeatherStore = create<WeatherState>()(() => ({ ...INITIAL }))

export interface SyncWeatherDeps {
  fetchWeather: typeof fetchOutingWeather
}

let controller: AbortController | null = null

/**
 * Bring the weather in line with the first track and the setting: idle without a track or when disabled,
 * unavailable for an untimed track, else fetched (cached by `fetchOutingWeather`). `retry` refetches after
 * an error. A newer call cancels the request of an older one.
 */
export function syncWeather(
  track: Track | undefined,
  enabled: boolean,
  { retry = false, deps = { fetchWeather: fetchOutingWeather } }: { retry?: boolean; deps?: SyncWeatherDeps } = {},
): void {
  const state = useWeatherStore.getState()
  if (!track || !enabled) {
    controller?.abort()
    controller = null
    if (state.status !== 'idle' || state.trackId !== null) useWeatherStore.setState({ ...INITIAL })
    return
  }
  if (state.trackId === track.id && state.status !== 'idle' && !(retry && state.status === 'error')) return

  controller?.abort()
  controller = null
  if (track.stats.startTime === undefined) {
    useWeatherStore.setState({
      status: 'unavailable',
      message: 'Trace non horodatée : la météo ne peut pas être datée.',
      series: null,
      trackId: track.id,
    })
    return
  }

  const ctrl = new AbortController()
  controller = ctrl
  useWeatherStore.setState({ status: 'loading', message: null, series: null, trackId: track.id })
  deps.fetchWeather(buildTrackPath(track), { signal: ctrl.signal }).then(
    (series) => {
      if (controller !== ctrl) return
      controller = null
      useWeatherStore.setState({ status: 'ready', message: null, series })
    },
    (e: unknown) => {
      if (controller !== ctrl) return
      controller = null
      if (e instanceof WeatherError) useWeatherStore.setState({ status: e.kind, message: e.message })
      else useWeatherStore.setState({ status: 'error', message: 'Erreur inattendue en chargeant la météo.' })
    },
  )
}

/** Restore the initial state (tests). */
export function resetWeatherStore(): void {
  controller?.abort()
  controller = null
  useWeatherStore.setState({ ...INITIAL })
}

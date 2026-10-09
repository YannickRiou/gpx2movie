/**
 * Weather of the first track (zustand), fetched when a timed track is loaded and `settings.weather.enabled`
 * allows it, and « À la suite » that of the later stages (`syncStageWeather`). Both syncs are idempotent: calling
 * them again for the same tracks, start times and setting does nothing, so React effects may call them freely; new
 * (estimated) times on the same track fetch again.
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
  /** track the status refers to, and its start time then (null when untimed) */
  trackId: string | null
  startTime: number | null
  /** « À la suite »: weather of the later stages, by track id */
  stages: Readonly<Record<string, StageWeather>>
}

/** Weather of a later stage: the start time it is fetched for, its series once there (null while loading or failed). */
export interface StageWeather {
  startTime: number
  series: WeatherSeries | null
}

const IDLE = { status: 'idle', message: null, series: null, trackId: null, startTime: null } as const
const INITIAL: WeatherState = { ...IDLE, stages: {} }

export const useWeatherStore = create<WeatherState>()(() => ({ ...INITIAL }))

export interface SyncWeatherDeps {
  fetchWeather: typeof fetchOutingWeather
}

let controller: AbortController | null = null
/** requests in flight of the later stages, by track id */
const stageControllers = new Map<string, AbortController>()

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
    if (state.status !== 'idle' || state.trackId !== null) useWeatherStore.setState({ ...IDLE })
    return
  }
  const startTime = track.stats.startTime ?? null
  const sameTrack = state.trackId === track.id && state.startTime === startTime
  if (sameTrack && state.status !== 'idle' && !(retry && state.status === 'error')) return

  controller?.abort()
  controller = null
  if (startTime === null) {
    useWeatherStore.setState({
      status: 'unavailable',
      message: 'Trace non horodatée : prévoyez la sortie (liste des traces) pour dater la météo.',
      series: null,
      trackId: track.id,
      startTime,
    })
    return
  }

  const ctrl = new AbortController()
  controller = ctrl
  useWeatherStore.setState({ status: 'loading', message: null, series: null, trackId: track.id, startTime })
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

/**
 * « À la suite »: bring the weather of the later stages (`tracks`, the first stage excluded; none otherwise) in line:
 * each timed one fetched once per start time (a failed one again on the next call), the others dropped.
 */
export function syncStageWeather(
  tracks: readonly Track[],
  enabled: boolean,
  { deps = { fetchWeather: fetchOutingWeather } }: { deps?: SyncWeatherDeps } = {},
): void {
  const current = useWeatherStore.getState().stages
  const stages: Record<string, StageWeather> = {}
  for (const track of enabled ? tracks : []) {
    const startTime = track.stats.startTime
    if (startTime === undefined) continue
    const kept = current[track.id]
    if (kept?.startTime === startTime && (kept.series !== null || stageControllers.has(track.id))) {
      stages[track.id] = kept
      continue
    }
    stageControllers.get(track.id)?.abort()
    const ctrl = new AbortController()
    stageControllers.set(track.id, ctrl)
    stages[track.id] = { startTime, series: null }
    const settle = (series: WeatherSeries | null) => {
      if (stageControllers.get(track.id) !== ctrl) return
      stageControllers.delete(track.id)
      if (series) useWeatherStore.setState((s) => ({ stages: { ...s.stages, [track.id]: { startTime, series } } }))
    }
    deps.fetchWeather(buildTrackPath(track), { signal: ctrl.signal }).then(settle, () => settle(null))
  }
  for (const [id, ctrl] of stageControllers) {
    if (stages[id]) continue
    ctrl.abort()
    stageControllers.delete(id)
  }
  const ids = Object.keys(stages)
  if (ids.length !== Object.keys(current).length || ids.some((id) => current[id] !== stages[id])) useWeatherStore.setState({ stages })
}

/** Series of `track` once fetched: the first track's, or a later stage's « À la suite ». */
export function weatherSeriesOf(state: Pick<WeatherState, 'series' | 'trackId' | 'stages'>, track: Track | undefined): WeatherSeries | null {
  if (!track) return null
  return state.trackId === track.id ? state.series : (state.stages[track.id]?.series ?? null)
}

/** Some weather is shown (its attribution is due). */
export function weatherShown(state: Pick<WeatherState, 'status' | 'stages'>): boolean {
  return state.status === 'ready' || Object.values(state.stages).some((s) => s.series !== null)
}

/** Restore the initial state (tests). */
export function resetWeatherStore(): void {
  controller?.abort()
  controller = null
  for (const ctrl of stageControllers.values()) ctrl.abort()
  stageControllers.clear()
  useWeatherStore.setState({ ...INITIAL })
}

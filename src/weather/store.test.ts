import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../core/types'
import { buildTrack } from '../import/stats'
import { WeatherError } from './openMeteo'
import type { WeatherSeries } from './series'
import { resetWeatherStore, syncStageWeather, syncWeather, useWeatherStore, weatherSeriesOf, weatherShown } from './store'

const T0 = Date.UTC(2025, 6, 12, 7)

function makeTrack(id: string, timed: boolean): Track {
  const track = buildTrack({
    name: id,
    source: 'gpx',
    segments: [
      {
        points: [
          { lon: 6.8, lat: 45.9, ele: 1000, time: timed ? T0 : undefined },
          { lon: 6.9, lat: 45.9, ele: 1100, time: timed ? T0 + 3_600_000 : undefined },
        ],
      },
    ],
  })
  return { ...track, id }
}

const SERIES: WeatherSeries = { time: [T0], stations: [] }

/** A fetcher whose promise the test settles by hand. */
function deferredFetcher() {
  const calls: { resolve: (s: WeatherSeries) => void; reject: (e: unknown) => void; signal?: AbortSignal }[] = []
  const fetchWeather = vi.fn(
    (_path: unknown, opts?: { signal?: AbortSignal }) =>
      new Promise<WeatherSeries>((resolve, reject) => calls.push({ resolve, reject, signal: opts?.signal })),
  )
  return { calls, deps: { fetchWeather } }
}

beforeEach(() => resetWeatherStore())

describe('syncWeather', () => {
  it('stays idle without a track or when disabled, and explains an untimed track', () => {
    const { deps } = deferredFetcher()
    syncWeather(undefined, true, { deps })
    expect(useWeatherStore.getState().status).toBe('idle')
    syncWeather(makeTrack('a', true), false, { deps })
    expect(useWeatherStore.getState().status).toBe('idle')
    syncWeather(makeTrack('u', false), true, { deps })
    expect(useWeatherStore.getState()).toMatchObject({ status: 'unavailable', trackId: 'u' })
    expect(useWeatherStore.getState().message).toMatch(/horodatée/)
    expect(deps.fetchWeather).not.toHaveBeenCalled()
  })

  it('loads the weather of a timed track once', async () => {
    const { calls, deps } = deferredFetcher()
    const track = makeTrack('a', true)
    syncWeather(track, true, { deps })
    expect(useWeatherStore.getState().status).toBe('loading')
    syncWeather(track, true, { deps })
    expect(deps.fetchWeather).toHaveBeenCalledTimes(1)
    calls[0].resolve(SERIES)
    await Promise.resolve()
    expect(useWeatherStore.getState()).toMatchObject({ status: 'ready', series: SERIES, trackId: 'a' })
  })

  it('fetches again when the same track gets new times (planned departure)', () => {
    const { deps } = deferredFetcher()
    const untimed = makeTrack('p', false)
    syncWeather(untimed, true, { deps })
    const planned = makeTrack('p', true)
    syncWeather(planned, true, { deps })
    syncWeather(planned, true, { deps })
    expect(deps.fetchWeather).toHaveBeenCalledTimes(1)
    expect(useWeatherStore.getState()).toMatchObject({ status: 'loading', trackId: 'p', startTime: T0 })
  })

  it('reports failures and retries on demand', async () => {
    const { calls, deps } = deferredFetcher()
    const track = makeTrack('a', true)
    syncWeather(track, true, { deps })
    calls[0].reject(new WeatherError('error', 'Impossible de joindre Open-Meteo : vérifiez la connexion.'))
    await Promise.resolve()
    expect(useWeatherStore.getState()).toMatchObject({ status: 'error', message: expect.stringContaining('Open-Meteo') })
    syncWeather(track, true, { deps })
    expect(deps.fetchWeather).toHaveBeenCalledTimes(1)
    syncWeather(track, true, { deps, retry: true })
    expect(deps.fetchWeather).toHaveBeenCalledTimes(2)
    calls[1].reject(new WeatherError('unavailable', 'Pas d’archive météo avant 1940.'))
    await Promise.resolve()
    expect(useWeatherStore.getState().status).toBe('unavailable')
  })

  it('cancels and ignores the request of a replaced track or a disabled setting', async () => {
    const { calls, deps } = deferredFetcher()
    syncWeather(makeTrack('a', true), true, { deps })
    syncWeather(makeTrack('b', true), true, { deps })
    expect(calls[0].signal?.aborted).toBe(true)
    calls[0].resolve(SERIES)
    await Promise.resolve()
    expect(useWeatherStore.getState()).toMatchObject({ status: 'loading', trackId: 'b' })
    syncWeather(makeTrack('b', true), false, { deps })
    expect(calls[1].signal?.aborted).toBe(true)
    calls[1].resolve(SERIES)
    await Promise.resolve()
    expect(useWeatherStore.getState()).toMatchObject({ status: 'idle', series: null })
  })
})

describe('syncStageWeather (« À la suite »)', () => {
  const SERIES_B: WeatherSeries = { time: [T0 + 86_400_000], stations: [] }

  it('fetches each timed later stage once, apart from the first track, and drops the stages no longer listed', async () => {
    const { calls, deps } = deferredFetcher()
    const a = makeTrack('a', true)
    const b = makeTrack('b', true)
    syncWeather(a, true, { deps })
    syncStageWeather([b, makeTrack('u', false)], true, { deps })
    syncStageWeather([b], true, { deps })
    expect(deps.fetchWeather).toHaveBeenCalledTimes(2)
    calls[0].resolve(SERIES)
    calls[1].resolve(SERIES_B)
    await Promise.resolve()
    const state = useWeatherStore.getState()
    expect(weatherSeriesOf(state, a)).toBe(SERIES)
    expect(weatherSeriesOf(state, b)).toBe(SERIES_B)
    expect(weatherSeriesOf(state, makeTrack('u', false))).toBeNull()
    expect(weatherShown(state)).toBe(true)
    // the first track's sync leaves the stages alone
    syncWeather(a, false, { deps })
    expect(weatherSeriesOf(useWeatherStore.getState(), b)).toBe(SERIES_B)
    syncStageWeather([], true, { deps })
    expect(useWeatherStore.getState().stages).toEqual({})
  })

  it('cancels a stage removed or disabled while loading, fetches a failed one again', async () => {
    const { calls, deps } = deferredFetcher()
    const b = makeTrack('b', true)
    syncStageWeather([b], true, { deps })
    syncStageWeather([b], false, { deps })
    expect(calls[0].signal?.aborted).toBe(true)
    calls[0].resolve(SERIES_B)
    await Promise.resolve()
    expect(useWeatherStore.getState().stages).toEqual({})
    syncStageWeather([b], true, { deps })
    calls[1].reject(new WeatherError('error', 'hors ligne'))
    await Promise.resolve()
    expect(weatherSeriesOf(useWeatherStore.getState(), b)).toBeNull()
    syncStageWeather([b], true, { deps })
    expect(deps.fetchWeather).toHaveBeenCalledTimes(3)
  })
})

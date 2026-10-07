import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../core/types'
import { buildTrack } from '../import/stats'
import { useLabelSources } from '../scene/labelSources'
import { DEFAULT_LANDMARK_SETTINGS } from './landmarks'
import type { LandmarkSettings } from './landmarks'
import { OverpassError } from './overpass'
import type { OsmFeature } from './overpass'
import { resetLandmarkStore, syncLandmarks, useLandmarkStore } from './store'

/** Track going south along 6.78° E from 45.9° N, ≈ 1 km per point. */
function makeTrack(id: string, lon = 6.78): Track {
  const track = buildTrack({
    name: id,
    source: 'gpx',
    segments: [{ points: Array.from({ length: 12 }, (_, i) => ({ lon, lat: 45.9 - i * 0.009, ele: 1000 })) }],
  })
  return { ...track, id }
}

const FEATURES: OsmFeature[] = [
  { id: 'node/1', kind: 'pass', name: 'Col de Voza', lon: 6.78, lat: 45.9 - 3 * 0.009, ele: '1650' },
  { id: 'node/2', kind: 'peak', name: 'Le Prarion', lon: 6.79, lat: 45.9 - 6 * 0.009, ele: '1969' },
  { id: 'node/3', kind: 'place', name: 'Les Houches', lon: 6.78, lat: 45.9, detail: 'village' },
]

/** A fetcher whose promises the test settles by hand. */
function deferredFetcher() {
  const calls: { trackId: string; resolve: (f: OsmFeature[]) => void; reject: (e: unknown) => void; signal?: AbortSignal }[] = []
  const fetchFeatures = vi.fn(
    (track: Track, signal?: AbortSignal) =>
      new Promise<OsmFeature[]>((resolve, reject) => calls.push({ trackId: track.id, resolve, reject, signal })),
  )
  return { calls, deps: { fetchFeatures } }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const osmLabels = () => useLabelSources.getState().sources.osm ?? []

beforeEach(() => resetLandmarkStore())

describe('syncLandmarks', () => {
  it('stays idle without a track or when disabled', () => {
    const { deps } = deferredFetcher()
    syncLandmarks([], DEFAULT_LANDMARK_SETTINGS, { deps })
    expect(useLandmarkStore.getState().status).toBe('idle')
    syncLandmarks([makeTrack('a')], { ...DEFAULT_LANDMARK_SETTINGS, enabled: false }, { deps })
    expect(useLandmarkStore.getState().status).toBe('idle')
    expect(deps.fetchFeatures).not.toHaveBeenCalled()
    expect(osmLabels()).toEqual([])
  })

  it('fetches each track once, filters by the setting and publishes the labels', async () => {
    const { calls, deps } = deferredFetcher()
    const track = makeTrack('a')
    syncLandmarks([track], DEFAULT_LANDMARK_SETTINGS, { deps })
    expect(useLandmarkStore.getState().status).toBe('loading')
    syncLandmarks([track], DEFAULT_LANDMARK_SETTINGS, { deps })
    expect(deps.fetchFeatures).toHaveBeenCalledTimes(1)

    calls[0].resolve(FEATURES)
    await flush()
    const state = useLandmarkStore.getState()
    expect(state.status).toBe('ready')
    expect(state.features.a).toBe(FEATURES)
    // the village is off by default, the pass comes before the peak along the track
    expect(state.landmarks.a.map((l) => l.name)).toEqual(['Col de Voza', 'Le Prarion'])
    expect(osmLabels().map((l) => l.id)).toEqual(['osm:node/1', 'osm:node/2'])
    expect(osmLabels()[0]).toMatchObject({ kind: 'pass', text: 'Col de Voza · 1 650 m', ele: 1650 })

    // changing the kinds or the distance re-filters without a request
    const settings: LandmarkSettings = { ...DEFAULT_LANDMARK_SETTINGS, kinds: { ...DEFAULT_LANDMARK_SETTINGS.kinds, place: true } }
    syncLandmarks([track], settings, { deps })
    expect(useLandmarkStore.getState().landmarks.a.map((l) => l.name)).toEqual(['Les Houches', 'Col de Voza', 'Le Prarion'])
    syncLandmarks([track], { ...settings, maxDistanceM: 100 }, { deps })
    expect(useLandmarkStore.getState().landmarks.a.map((l) => l.name)).toEqual(['Les Houches', 'Col de Voza'])
    expect(deps.fetchFeatures).toHaveBeenCalledTimes(1)
  })

  it('reports an error with a French message and retries on demand', async () => {
    const { calls, deps } = deferredFetcher()
    const track = makeTrack('a')
    syncLandmarks([track], DEFAULT_LANDMARK_SETTINGS, { deps })
    calls[0].reject(new OverpassError('HTTP 504', 504))
    await flush()
    expect(useLandmarkStore.getState()).toMatchObject({ status: 'error', message: expect.stringMatching(/saturé/) })

    syncLandmarks([track], DEFAULT_LANDMARK_SETTINGS, { deps })
    expect(deps.fetchFeatures).toHaveBeenCalledTimes(1)
    syncLandmarks([track], DEFAULT_LANDMARK_SETTINGS, { deps, retry: true })
    expect(deps.fetchFeatures).toHaveBeenCalledTimes(2)
    expect(useLandmarkStore.getState().status).toBe('loading')
    calls[1].resolve(FEATURES)
    await flush()
    expect(useLandmarkStore.getState()).toMatchObject({ status: 'ready', message: null })
  })

  it('handles several tracks, forgets a removed one and cancels on disable', async () => {
    const { calls, deps } = deferredFetcher()
    const a = makeTrack('a')
    const b = makeTrack('b', 6.79)
    syncLandmarks([a, b], DEFAULT_LANDMARK_SETTINGS, { deps })
    expect(deps.fetchFeatures).toHaveBeenCalledTimes(2)
    calls[0].resolve(FEATURES)
    await flush()
    expect(useLandmarkStore.getState().status).toBe('loading')
    expect(useLandmarkStore.getState().landmarks.a).toHaveLength(2)

    syncLandmarks([a], DEFAULT_LANDMARK_SETTINGS, { deps })
    expect(calls[1].signal?.aborted).toBe(true)
    expect(useLandmarkStore.getState().status).toBe('ready')
    expect(Object.keys(useLandmarkStore.getState().features)).toEqual(['a'])

    syncLandmarks([a], { ...DEFAULT_LANDMARK_SETTINGS, enabled: false }, { deps })
    expect(useLandmarkStore.getState()).toMatchObject({ status: 'idle', features: {}, landmarks: {} })
    expect(osmLabels()).toEqual([])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../core/types'
import { buildTrack } from '../import/stats'
import { useLabelSources } from '../scene/labelSources'
import { DEFAULT_LANDMARK_SETTINGS } from './landmarks'
import type { LandmarkSettings } from './landmarks'
import { OverpassError } from './overpass'
import {
  candidateId,
  chooseRegion,
  containingRegions,
  holdRegion,
  parseRegionCandidates,
  parseRegionGeometry,
  regionCandidatesQuery,
  regionGeometryQuery,
  retryRegion,
  syncRegion,
  useRegionStore,
} from './region'
import type { AdminCandidate, AdminRegion, RegionAnswer } from './region'
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
    expect(useLandmarkStore.getState()).toMatchObject({ status: 'idle', features: {}, landmarks: {}, hidden: {} })
    expect(osmLabels()).toEqual([])
  })

  it('keeps the landmarks hidden by the user aside, out of the labels, without refetching', async () => {
    const { calls, deps } = deferredFetcher()
    const track = makeTrack('a')
    const hiding: LandmarkSettings = { ...DEFAULT_LANDMARK_SETTINGS, hiddenIds: ['node/1', 'node/999'] }
    syncLandmarks([track], hiding, { deps })
    calls[0].resolve(FEATURES)
    await flush()
    let state = useLandmarkStore.getState()
    expect(state.landmarks.a.map((l) => l.id)).toEqual(['node/2'])
    expect(state.hidden.a.map((l) => l.id)).toEqual(['node/1'])
    expect(osmLabels().map((l) => l.id)).toEqual(['osm:node/2'])

    syncLandmarks([track], DEFAULT_LANDMARK_SETTINGS, { deps })
    expect(deps.fetchFeatures).toHaveBeenCalledTimes(1)
    state = useLandmarkStore.getState()
    expect(state.landmarks.a.map((l) => l.id)).toEqual(['node/1', 'node/2'])
    expect(state.hidden.a).toEqual([])
    expect(osmLabels().map((l) => l.id).sort()).toEqual(['osm:node/1', 'osm:node/2'])
  })
})

describe('holdRegion', () => {
  const box = { west: 7.0, south: 46.0, east: 7.1, north: 46.1 }
  const region: AdminRegion = { id: 'relation/1', name: 'Valais/Wallis', bounds: { west: 6.7, south: 45.8, east: 8.5, north: 46.7 }, rings: [] }
  const later = () => {
    let resolve: (r: RegionAnswer) => void = () => {}
    const fetch = vi.fn((_track: unknown, _id: string | null) => new Promise<RegionAnswer>((r) => (resolve = r)))
    return { fetch, resolve: (r: AdminRegion | null) => resolve({ candidates: [], autoId: r?.id ?? null, region: r }) }
  }

  it('keeps a region arriving during an export aside until it ends', async () => {
    syncRegion(null, false)
    const { fetch, resolve } = later()
    syncRegion(box, true, null, fetch)
    holdRegion(true)
    resolve(region)
    await flush()
    // the export renders the whole film without it
    expect(useRegionStore.getState()).toMatchObject({ status: 'loading', region: null, frame: null })
    holdRegion(false)
    expect(useRegionStore.getState()).toMatchObject({ status: 'ready', region })
    expect(useRegionStore.getState().frame).not.toBeNull()
  })

  it('drops a held answer once the region is no longer wanted', async () => {
    syncRegion(null, false)
    const { fetch, resolve } = later()
    syncRegion(box, true, null, fetch)
    holdRegion(true)
    resolve(region)
    await flush()
    syncRegion(null, false)
    holdRegion(false)
    expect(useRegionStore.getState()).toMatchObject({ key: null, status: 'idle', region: null })
  })

  it('asks again for another place of the same track, keeping the list of places meanwhile', async () => {
    syncRegion(null, false)
    const first = later()
    syncRegion(box, true, null, first.fetch)
    const park: AdminCandidate = { type: 'relation', id: 9, kind: 'protege', level: NaN, name: 'Parc', bounds: box }
    first.fetch.mockClear()
    first.resolve(region)
    await flush()
    useRegionStore.setState({ candidates: [park] })
    const second = later()
    syncRegion(box, true, 'relation/9', second.fetch)
    expect(second.fetch.mock.calls[0][1]).toBe('relation/9')
    expect(useRegionStore.getState()).toMatchObject({ status: 'loading', candidates: [park] })
    // same box and place: nothing asked
    syncRegion(box, true, 'relation/9', second.fetch)
    expect(second.fetch).toHaveBeenCalledTimes(1)
    syncRegion(null, false)
  })

  it('lists the places as soon as they are known, before the region geometry', () => {
    syncRegion(null, false)
    const park: AdminCandidate = { type: 'relation', id: 9, kind: 'protege', level: NaN, name: 'Parc', bounds: box }
    const fetch = vi.fn((_t: unknown, _id: string | null, _s: AbortSignal, onListed: (l: Omit<RegionAnswer, 'region'>) => void) => {
      onListed({ candidates: [park], autoId: 'relation/9' })
      return new Promise<RegionAnswer>(() => {})
    })
    syncRegion(box, true, null, fetch)
    expect(useRegionStore.getState()).toMatchObject({ status: 'loading', candidates: [park], autoId: 'relation/9' })
    syncRegion(null, false)
  })

  it('asks again after a failure on « Réessayer » only', async () => {
    syncRegion(null, false)
    const fetch = vi.fn(() => Promise.reject(new Error('busy')))
    syncRegion(box, true, null, fetch)
    await flush()
    expect(useRegionStore.getState().status).toBe('error')
    // same box and place: the effects do not ask again
    syncRegion(box, true, null, fetch)
    expect(fetch).toHaveBeenCalledTimes(1)
    retryRegion()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(useRegionStore.getState().status).toBe('loading')
    await flush()
    syncRegion(null, false)
    // nothing to retry once it is no longer wanted
    retryRegion()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('region candidates', () => {
  const track = { west: 8.9, south: 42.1, east: 9.0, north: 42.2 }
  const element = (type: string, id: number, tags: Record<string, string>, [w, s, e, n]: number[]) => ({
    type,
    id,
    tags,
    bounds: { minlon: w, minlat: s, maxlon: e, maxlat: n },
  })
  const json = {
    elements: [
      element('relation', 1, { boundary: 'administrative', admin_level: '4', name: 'Corse' }, [8.5, 41.3, 9.6, 43.1]),
      element('relation', 2, { boundary: 'administrative', admin_level: '6', name: 'Haute-Corse' }, [8.5, 41.8, 9.6, 43.1]),
      element('relation', 3, { boundary: 'protected_area', protect_class: '5', name: 'Parc naturel régional de Corse' }, [8.55, 41.4, 9.4, 42.9]),
      element('relation', 4, { place: 'island', name: 'Corse', 'name:fr': 'Corse' }, [8.53, 41.33, 9.57, 43.03]),
      element('way', 5, { leisure: 'nature_reserve', name: 'Réserve' }, [8.95, 42.15, 8.96, 42.16]),
      element('way', 6, { boundary: 'administrative', admin_level: '6', name: 'Way boundary' }, [8, 41, 10, 44]),
      element('relation', 7, { natural: 'mountain_range', name: 'Monte Cinto' }, [8.8, 42.0, 9.1, 42.4]),
      element('relation', 8, { boundary: 'administrative', admin_level: '8', name: 'Commune' }, [8.8, 42.0, 9.1, 42.3]),
      element('relation', 9, { boundary: 'national_park' }, [8, 41, 10, 44]),
    ],
  }

  it('asks for every kind of area in one is_in query', () => {
    const query = regionCandidatesQuery({ lon: 8.95, lat: 42.15 })
    expect(query).toContain('is_in(42.15000,8.95000)')
    for (const tag of ['"admin_level"~"^[456]$"', 'national_park|protected_area', '"leisure"="nature_reserve"', '"place"="island"', '"natural"="mountain_range"']) {
      expect(query).toContain(tag)
    }
    expect(regionGeometryQuery(5, 'way')).toContain('way(5);')
    expect(regionGeometryQuery(3)).toContain('rel(3);')
  })

  it('parses the named areas with their kind, not other boundaries nor unnamed ones', () => {
    const candidates = parseRegionCandidates(json)
    expect(candidates.map((c) => `${candidateId(c)} ${c.kind}`)).toEqual([
      'relation/1 admin',
      'relation/2 admin',
      'relation/3 protege',
      'relation/4 ile',
      'way/5 protege',
      'relation/7 massif',
    ])
    expect(candidates[1].level).toBe(6)
    expect(Number.isNaN(candidates[2].level)).toBe(true)
  })

  it('lists the areas containing the whole track, smallest first; the automatic choice stays administrative', () => {
    const candidates = parseRegionCandidates(json)
    expect(containingRegions(candidates, track).map((c) => c.id)).toEqual([7, 2, 3, 4, 1])
    // the smallest administrative boundary 5 × larger than the track, as before the other kinds were asked
    expect(chooseRegion(candidates, track)?.id).toBe(2)
    expect(chooseRegion(candidates.filter((c) => c.kind !== 'admin'), track)).toBeNull()
  })

  it('reads the geometry of a closed way as one ring', () => {
    const ring = [
      { lon: 8.95, lat: 42.15 },
      { lon: 8.96, lat: 42.15 },
      { lon: 8.96, lat: 42.16 },
      { lon: 8.95, lat: 42.15 },
    ]
    const [region] = parseRegionGeometry({ elements: [{ type: 'way', id: 5, tags: { name: 'Réserve' }, geometry: ring }] })
    expect(region).toMatchObject({ id: 'way/5', name: 'Réserve' })
    expect(region.rings).toHaveLength(1)
    expect(region.rings[0]).toHaveLength(3)
  })
})

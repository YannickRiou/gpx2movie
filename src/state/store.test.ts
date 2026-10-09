import { beforeEach, describe, expect, it } from 'vitest'
import type { LonLatBounds, Track } from '../core/types'
import { DEFAULT_OVERLAY } from '../overlay/settings'
import { computeFrameOrigin, pickRegionalImagery, resetAppStore, unionBounds, useAppStore } from './store'

function makeTrack(id: string, bounds: LonLatBounds): Track {
  return {
    id,
    name: `Trace ${id}`,
    source: 'gpx',
    segments: [{ points: [] }],
    stats: { distanceM: 0, ascentM: 0, descentM: 0, pointCount: 0 },
    bounds,
    color: '#000000',
  }
}

// Chamonix valley (France)
const FR = makeTrack('fr', { west: 6.8, south: 45.9, east: 6.95, north: 45.98 })
// Engadin (Switzerland, east of the IGN box)
const CH = makeTrack('ch', { west: 10.2, south: 46.0, east: 10.3, north: 46.05 })
// Vancouver (no regional source)
const CA = makeTrack('ca', { west: -123.2, south: 49.2, east: -123.0, north: 49.3 })

beforeEach(() => resetAppStore())

describe('helpers', () => {
  it('unionBounds merges boxes and returns null for an empty list', () => {
    expect(unionBounds([])).toBeNull()
    expect(unionBounds([FR, CH])).toEqual({ west: 6.8, south: 45.9, east: 10.3, north: 46.05 })
  })

  it('computeFrameOrigin rounds the centroid to 0.01°', () => {
    expect(computeFrameOrigin(FR.bounds)).toEqual({ lon: 6.88, lat: 45.94 })
  })

  it('pickRegionalImagery follows catalogue order and requires full containment', () => {
    expect(pickRegionalImagery(FR.bounds)).toBe('ign-ortho')
    expect(pickRegionalImagery(CH.bounds)).toBe('swisstopo')
    expect(pickRegionalImagery(CA.bounds)).toBeNull()
    // straddling the boxes -> contained by none
    expect(pickRegionalImagery({ west: -10, south: 45, east: 7, north: 46 })).toBeNull()
  })
})

describe('addTracks', () => {
  it('appends, computes bounds, fixes the frame origin and bumps fitRequest', () => {
    const s = useAppStore.getState()
    s.addTracks([FR])
    let st = useAppStore.getState()
    expect(st.tracks).toHaveLength(1)
    expect(st.bounds).toEqual(FR.bounds)
    expect(st.frameOrigin).toEqual({ lon: 6.88, lat: 45.94 })
    expect(st.fitRequest).toBe(1)

    s.addTracks([CH])
    st = useAppStore.getState()
    expect(st.tracks.map((t) => t.id)).toEqual(['fr', 'ch'])
    expect(st.bounds).toEqual({ west: 6.8, south: 45.9, east: 10.3, north: 46.05 })
    // the origin does not move once set
    expect(st.frameOrigin).toEqual({ lon: 6.88, lat: 45.94 })
    expect(st.fitRequest).toBe(2)
  })

  it('ignores an empty batch', () => {
    useAppStore.getState().addTracks([])
    expect(useAppStore.getState().fitRequest).toBe(0)
    expect(useAppStore.getState().frameOrigin).toBeNull()
  })

  it('switches imagery to the regional source when the trip is fully covered', () => {
    useAppStore.getState().addTracks([FR])
    expect(useAppStore.getState().settings.imagerySourceId).toBe('ign-ortho')
  })

  it('keeps the default imagery when no regional source covers the trip', () => {
    useAppStore.getState().addTracks([CA])
    expect(useAppStore.getState().settings.imagerySourceId).toBe('arcgis-world-imagery')
  })

  it('keeps the regional choice when a later track leaves the coverage', () => {
    useAppStore.getState().addTracks([FR])
    useAppStore.getState().addTracks([CA])
    expect(useAppStore.getState().settings.imagerySourceId).toBe('ign-ortho')
  })

  it('never overrides an imagery source chosen by the user', () => {
    useAppStore.getState().setSetting('imagerySourceId', 'eox-s2cloudless')
    useAppStore.getState().addTracks([FR])
    expect(useAppStore.getState().settings.imagerySourceId).toBe('eox-s2cloudless')
  })
})

describe('removeTrack / clearTracks', () => {
  it('recomputes bounds and keeps the origin while tracks remain', () => {
    const s = useAppStore.getState()
    s.addTracks([FR])
    s.addTracks([CH])
    s.removeTrack('ch')
    const st = useAppStore.getState()
    expect(st.tracks.map((t) => t.id)).toEqual(['fr'])
    expect(st.bounds).toEqual(FR.bounds)
    expect(st.frameOrigin).toEqual({ lon: 6.88, lat: 45.94 })
  })

  it('resets bounds and origin when the last track is removed', () => {
    const s = useAppStore.getState()
    s.addTracks([FR])
    s.removeTrack('fr')
    expect(useAppStore.getState().bounds).toBeNull()
    expect(useAppStore.getState().frameOrigin).toBeNull()
  })

  it('ignores unknown ids without touching the state', () => {
    useAppStore.getState().addTracks([FR])
    const before = useAppStore.getState()
    useAppStore.getState().removeTrack('nope')
    expect(useAppStore.getState()).toBe(before)
  })

  it('clearTracks empties everything derived from tracks', () => {
    useAppStore.getState().addTracks([FR, CH])
    useAppStore.getState().clearTracks()
    const st = useAppStore.getState()
    expect(st.tracks).toEqual([])
    expect(st.bounds).toBeNull()
    expect(st.frameOrigin).toBeNull()
  })

  it('setTrackColor recolours one track and keeps the playback', () => {
    useAppStore.getState().addTracks([FR, CH])
    useAppStore.getState().setProgress(0.5)
    useAppStore.getState().setTrackColor('ch', '#ff0000')
    const st = useAppStore.getState()
    expect(st.tracks.map((t) => t.color)).toEqual(['#000000', '#ff0000'])
    expect(st.playback.progress).toBe(0.5)
    const before = useAppStore.getState()
    useAppStore.getState().setTrackColor('ch', '#ff0000')
    expect(useAppStore.getState()).toBe(before)
  })

  it('flyTrack puts the track first; no-op on the first or an unknown one', () => {
    useAppStore.getState().addTracks([FR, CH, CA])
    useAppStore.getState().flyTrack('ca')
    expect(useAppStore.getState().tracks.map((t) => t.id)).toEqual(['ca', 'fr', 'ch'])
    const before = useAppStore.getState()
    useAppStore.getState().flyTrack('ca')
    useAppStore.getState().flyTrack('nope')
    expect(useAppStore.getState()).toBe(before)
  })
})

describe('setPlanArea', () => {
  it('shows an area without any track, kept when the tracks come and go', () => {
    const area = FR.bounds
    useAppStore.getState().setPlanArea(area)
    let st = useAppStore.getState()
    expect(st.bounds).toEqual(area)
    expect(st.frameOrigin).toEqual({ lon: 6.88, lat: 45.94 })
    expect(st.fitRequest).toBe(1)
    expect(st.settings.imagerySourceId).toBe(pickRegionalImagery(area))

    // a track far from the area gets its own origin, one inside it keeps the area's
    st.addTracks([CH])
    expect(useAppStore.getState().bounds).toEqual(CH.bounds)
    expect(useAppStore.getState().frameOrigin).toEqual({ lon: 10.25, lat: 46.03 })
    useAppStore.getState().removeTrack('ch')
    expect(useAppStore.getState().frameOrigin).toEqual({ lon: 6.88, lat: 45.94 })
    useAppStore.getState().addTracks([FR])
    expect(useAppStore.getState().frameOrigin).toEqual({ lon: 6.88, lat: 45.94 })
    useAppStore.getState().removeTrack('fr')
    st = useAppStore.getState()
    expect(st.bounds).toEqual(area)
    expect(st.frameOrigin).toEqual({ lon: 6.88, lat: 45.94 })

    useAppStore.getState().clearTracks()
    expect(useAppStore.getState()).toMatchObject({ planArea: null, bounds: null, frameOrigin: null })
  })
})

describe('settings and misc', () => {
  it('setSetting updates one key and keeps the others', () => {
    useAppStore.getState().setSetting('exaggeration', 1.5)
    useAppStore.getState().setSetting('wireframe', true)
    expect(useAppStore.getState().settings).toEqual({
      terrainSourceId: 'mapterhorn',
      imagerySourceId: 'arcgis-world-imagery',
      imageryZoomOffset: 1,
      exaggeration: 1.5,
      wireframe: true,
      atmosphere: true,
      shadows: true,
      sunHour: 10,
      sunDate: '',
      sunFromTrack: true,
      exposureEv: 0,
      grading: { preset: 'naturel', contrast: 0, saturation: 0, warmth: 0, vignette: 0 },
      trackColorBy: 'none',
      trackStyle: { width: 4, dash: 'plein', glow: false, drawOn: false },
      marker: { kind: 'boule', figure: 'randonneur', image: '', size: 1, animated: false },
      camera: { style: 'chase', distance: 1, pitchDeg: 30, headingOffsetDeg: 0, smoothing: 1, northUp: false },
      flyoverDurationS: 60,
      pacing: { enabled: false, climbs: true, landmarks: true, slowFactor: 0.35, windowM: 1000, pauseS: 2, keepDuration: true, transitionS: 1.5 },
      film: {
        opening: { style: 'descente', durationS: 6 },
        closing: { style: 'descente', durationS: 5 },
        autoStops: true,
        autoMode: 'temps-forts',
        stops: [],
        speeds: [],
        cameraKeys: [],
        texts: [],
        media: [],
        audio: [],
        duckMusic: false,
        landmarkTitles: true,
        pois: [],
      },
      labels: { climbs: true, waypoints: true, kmStep: 0, endpoints: false, size: 1, rangeKm: 70 },
      weather: { enabled: true },
      weatherScene: { enabled: true, strength: 1 },
      haze: 0,
      clouds: { mode: 'meteo', coverage: 0.4, altitudeM: 1200, quality: 'medium' },
      water: { enabled: true, strength: 1 },
      overlay: DEFAULT_OVERLAY,
      video: { aspect: '16:9', resolution: '1080p', fps: 30, quality: 'high' },
      poster: {
        format: 'a4-portrait',
        style: 'editorial',
        title: '',
        subtitle: '',
        figures: { distance: true, ascent: true, time: true, maxAltitude: true, climbs: true },
        weather: true,
        flat: false,
      },
      landmarks: {
        enabled: true,
        kinds: { peak: true, pass: true, hut: true, lake: true, waterfall: false, place: false, viewpoint: false, glacier: false },
        maxDistanceM: 1500,
      },
      race: { enabled: false, sync: 'elapsed' },
    })
  })

  it('requestFit increments the counter', () => {
    useAppStore.getState().requestFit()
    useAppStore.getState().requestFit()
    expect(useAppStore.getState().fitRequest).toBe(2)
  })

  it('stores terrain stats and loading', () => {
    const stats = { visibleTiles: 4, loadedTiles: 42, pendingTiles: 3, failedTiles: 0 }
    useAppStore.getState().setTerrainStats(stats)
    useAppStore.getState().setLoading(true)
    const st = useAppStore.getState()
    expect(st.terrainStats).toEqual(stats)
    expect(st.loading).toBe(true)
  })
})

describe('playback', () => {
  it('starts paused at 0 and clamps the progress', () => {
    const s = useAppStore.getState()
    expect(s.playback).toEqual({ playing: false, progress: 0, timeS: null, speed: 1 })
    s.setProgress(1.5)
    expect(useAppStore.getState().playback.progress).toBe(1)
    s.setProgress(-1)
    expect(useAppStore.getState().playback.progress).toBe(0)
  })

  it('stops at the end and rewinds to the first frame of the film when played again', () => {
    const s = useAppStore.getState()
    s.setPlaying(true)
    s.setProgress(1)
    expect(useAppStore.getState().playback).toMatchObject({ playing: false, progress: 1 })
    s.setPlaying(true)
    expect(useAppStore.getState().playback).toMatchObject({ playing: true, progress: 0, timeS: 0 })
  })

  it('plays from the first frame (opening) when started at the start, from the scrubbed progress elsewhere', () => {
    const s = useAppStore.getState()
    s.setPlaying(true)
    expect(useAppStore.getState().playback).toMatchObject({ playing: true, progress: 0, timeS: 0 })
    s.setPlaying(false)
    s.setProgress(0.3)
    s.setPlaying(true)
    expect(useAppStore.getState().playback).toMatchObject({ playing: true, progress: 0.3, timeS: null })
  })

  it('keeps playing at the end while a film time is given (final pause), forgets it when set from outside', () => {
    const s = useAppStore.getState()
    s.setPlaying(true)
    s.setProgress(1, 61)
    expect(useAppStore.getState().playback).toMatchObject({ playing: true, progress: 1, timeS: 61 })
    s.setProgress(1, 62)
    expect(useAppStore.getState().playback.timeS).toBe(62)
    // paused during the final pause: playing again resumes it instead of rewinding
    s.setPlaying(false)
    s.setPlaying(true)
    expect(useAppStore.getState().playback).toMatchObject({ playing: true, progress: 1, timeS: 62 })
    // the end of the film: no film time, stops
    s.setProgress(1)
    expect(useAppStore.getState().playback).toMatchObject({ playing: false, progress: 1, timeS: null })
  })

  it('pauses on a fit request and resets when a track is removed', () => {
    const s = useAppStore.getState()
    s.addTracks([FR])
    s.setSpeed(2)
    s.setProgress(0.4)
    s.setPlaying(true)
    s.requestFit()
    expect(useAppStore.getState().playback).toEqual({ playing: false, progress: 0.4, timeS: null, speed: 2 })
    s.removeTrack('fr')
    expect(useAppStore.getState().playback).toEqual({ playing: false, progress: 0, timeS: null, speed: 2 })
  })
})

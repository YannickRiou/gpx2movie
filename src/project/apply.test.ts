import { beforeEach, describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import { buildTrack } from '../import/stats'
import { DEFAULT_SETTINGS, resetAppStore, useAppStore } from '../state/store'
import { useMediaStore } from '../film/media'
import { applyProject, applySettings, modifiedPaths, modifiedSettings, sameValue } from './apply'
import type { LoadedProject } from './document'

/** A short track in the Chamonix valley (inside the IGN coverage). */
function chamonix(id: string): Track {
  const track = buildTrack({
    name: id,
    source: 'gpx',
    segments: [{ points: [{ lon: 6.86, lat: 45.92, ele: 1035 }, { lon: 6.87, lat: 45.93, ele: 1100 }] }],
  })
  track.id = id
  track.color = '#FFC53D'
  return track
}

function project(patch: Partial<LoadedProject> = {}): LoadedProject {
  return { name: 'p', settings: { ...DEFAULT_SETTINGS }, speed: 2, tracks: [chamonix('new')], media: {}, warnings: [], ...patch }
}

beforeEach(() => resetAppStore())

describe('applySettings', () => {
  it('only sets the keys that differ', () => {
    const before = useAppStore.getState().settings
    applySettings({ ...before })
    expect(useAppStore.getState().settings).toBe(before)
    applySettings({ ...before, exaggeration: 2 })
    expect(useAppStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS, exaggeration: 2 })
  })
})

describe('sameValue', () => {
  it('compares primitives, arrays and nested plain objects by value', () => {
    expect(sameValue(1, 1)).toBe(true)
    expect(sameValue(Number.NaN, Number.NaN)).toBe(true)
    expect(sameValue({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toBe(true)
    expect(sameValue({ a: [1, { b: 'x' }] }, { a: [1, { b: 'y' }] })).toBe(false)
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(sameValue([1], { 0: 1 })).toBe(false)
    expect(sameValue(null, {})).toBe(false)
    expect(sameValue(0, '0')).toBe(false)
  })
})

describe('modifiedPaths', () => {
  it('compares whole settings and single fields of object settings with their defaults', () => {
    const paths = ['exposureEv', 'weatherScene.strength', 'camera.distance', 'pacing'] as const
    expect(modifiedPaths(DEFAULT_SETTINGS, paths)).toEqual([])
    // a field shown elsewhere (weatherScene.enabled, camera.style) does not count
    const visibleOnly = {
      ...DEFAULT_SETTINGS,
      weatherScene: { ...DEFAULT_SETTINGS.weatherScene, enabled: !DEFAULT_SETTINGS.weatherScene.enabled },
      camera: { ...DEFAULT_SETTINGS.camera, style: 'orbit' as const },
    }
    expect(modifiedPaths(visibleOnly, paths)).toEqual([])
    const hidden = {
      ...visibleOnly,
      exposureEv: 1,
      camera: { ...visibleOnly.camera, distance: 2 },
      pacing: { ...DEFAULT_SETTINGS.pacing },
    }
    expect(modifiedPaths(hidden, paths)).toEqual(['exposureEv', 'camera.distance'])
  })
})

describe('modifiedSettings', () => {
  it('lists the keys of the group that differ from the defaults, nested values compared deeply', () => {
    const keys = ['exaggeration', 'camera', 'overlay'] as const
    expect(modifiedSettings(DEFAULT_SETTINGS, keys)).toEqual([])
    // a copy equal to the default is not modified
    const copy = { ...DEFAULT_SETTINGS, camera: { ...DEFAULT_SETTINGS.camera } }
    expect(modifiedSettings(copy, keys)).toEqual([])
    const overlay = { ...DEFAULT_SETTINGS.overlay, title: { ...DEFAULT_SETTINGS.overlay.title, title: 'Col' } }
    const changed = { ...DEFAULT_SETTINGS, exaggeration: 2, wireframe: true, overlay }
    expect(modifiedSettings(changed, keys)).toEqual(['exaggeration', 'overlay'])
  })
})

describe('applyProject', () => {
  it('replaces tracks, settings and speed, and requests a camera fit', () => {
    const store = useAppStore.getState()
    store.addTracks([chamonix('old')])
    store.setProgress(0.5)
    store.setImportError('erreur')
    const fit = useAppStore.getState().fitRequest

    applyProject(project({ settings: { ...DEFAULT_SETTINGS, wireframe: true, imagerySourceId: 'eox-s2cloudless' } }))
    const state = useAppStore.getState()
    expect(state.tracks.map((t) => t.id)).toEqual(['new'])
    expect(state.settings).toEqual({ ...DEFAULT_SETTINGS, wireframe: true, imagerySourceId: 'eox-s2cloudless' })
    expect(state.playback).toMatchObject({ speed: 2, progress: 0, playing: false })
    expect(state.fitRequest).toBeGreaterThan(fit)
    expect(state.frameOrigin).toEqual({ lon: 6.87, lat: 45.93 })
    expect(state.importError).toBeNull()
  })

  it('replaces the pictures of the film', () => {
    const data = 'data:image/jpeg;base64,/9j/AAEC'
    useMediaStore.getState().add([{ data, thumb: data, width: 1, height: 1, name: 'ancienne.jpg' }])
    const media = { 'photo-1': { data, thumb: data, width: 4, height: 3, name: 'lac.jpg' } }
    applyProject(project({ media }))
    expect(useMediaStore.getState().table).toEqual(media)
  })

  it("keeps the project's imagery even where a regional source would be picked automatically", () => {
    applyProject(project())
    expect(useAppStore.getState().settings.imagerySourceId).toBe(DEFAULT_SETTINGS.imagerySourceId)
  })

  it('accepts a project without tracks', () => {
    useAppStore.getState().addTracks([chamonix('old')])
    applyProject(project({ tracks: [] }))
    expect(useAppStore.getState().tracks).toEqual([])
    expect(useAppStore.getState().bounds).toBeNull()
  })
})

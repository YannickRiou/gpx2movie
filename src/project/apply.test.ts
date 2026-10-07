import { beforeEach, describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import { buildTrack } from '../import/stats'
import { DEFAULT_SETTINGS, resetAppStore, useAppStore } from '../state/store'
import { applyProject, applySettings } from './apply'
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
  return { name: 'p', settings: { ...DEFAULT_SETTINGS }, speed: 2, tracks: [chamonix('new')], warnings: [], ...patch }
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

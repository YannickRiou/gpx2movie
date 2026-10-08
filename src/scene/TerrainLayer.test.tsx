import { describe, expect, it, vi } from 'vitest'
import type { LonLatBounds } from '../core/types'
import { DEFAULT_FILM } from '../film/model'
import { DEFAULT_OVERLAY } from '../overlay/settings'
import { getImagerySource, getTerrainSource } from '../terrain/sources'

vi.mock('@react-three/fiber', () => ({ useFrame: vi.fn(), useThree: vi.fn() }))
vi.mock('../terrain/engine', () => ({ createTerrainEngine: vi.fn() }))

const {
  boundsContain,
  resolveEngineArea,
  statsEqual,
  engineOptionsFromSettings,
  diffEngineOptions,
} = await import('./TerrainLayer')

const outer: LonLatBounds = { west: 6, south: 45, east: 7, north: 46 }

describe('boundsContain', () => {
  it('accepts a box inside (edges included)', () => {
    expect(boundsContain(outer, { west: 6.2, south: 45.2, east: 6.8, north: 45.8 })).toBe(true)
    expect(boundsContain(outer, outer)).toBe(true)
  })
  it('rejects a box crossing any edge', () => {
    expect(boundsContain(outer, { west: 5.9, south: 45.2, east: 6.8, north: 45.8 })).toBe(false)
    expect(boundsContain(outer, { west: 6.2, south: 45.2, east: 7.1, north: 45.8 })).toBe(false)
    expect(boundsContain(outer, { west: 6.2, south: 44.9, east: 6.8, north: 45.8 })).toBe(false)
    expect(boundsContain(outer, { west: 6.2, south: 45.2, east: 6.8, north: 46.1 })).toBe(false)
  })
})

describe('resolveEngineArea', () => {
  it('keeps the previous area while it still covers the desired one', () => {
    const desired = { west: 6.2, south: 45.2, east: 6.8, north: 45.8 }
    expect(resolveEngineArea(outer, desired)).toBe(outer)
  })
  it('switches to the desired area when it grows outside', () => {
    const desired = { west: 5, south: 45.2, east: 6.8, north: 45.8 }
    expect(resolveEngineArea(outer, desired)).toBe(desired)
  })
  it('uses the desired area when there is no previous one', () => {
    expect(resolveEngineArea(null, outer)).toBe(outer)
  })
})

describe('statsEqual', () => {
  it('compares every counter', () => {
    const a = { visibleTiles: 1, loadedTiles: 2, pendingTiles: 3, failedTiles: 4 }
    expect(statsEqual(a, { ...a })).toBe(true)
    expect(statsEqual(a, { ...a, visibleTiles: 0 })).toBe(false)
    expect(statsEqual(a, { ...a, loadedTiles: 0 })).toBe(false)
    expect(statsEqual(a, { ...a, pendingTiles: 0 })).toBe(false)
    expect(statsEqual(a, { ...a, failedTiles: 0 })).toBe(false)
  })
})

describe('engine options from settings', () => {
  const settings = {
    terrainSourceId: 'mapterhorn',
    imagerySourceId: 'arcgis-world-imagery',
    imageryZoomOffset: 1 as const,
    exaggeration: 1,
    wireframe: false,
    atmosphere: true,
    shadows: true,
    sunHour: 10,
    sunFromTrack: true,
    exposureEv: 0,
    trackColorBy: 'none' as const,
    camera: { style: 'chase' as const, distance: 1, pitchDeg: 30, headingOffsetDeg: 0, smoothing: 1, northUp: false },
    flyoverDurationS: 60,
    pacing: { enabled: false, climbs: true, landmarks: true, slowFactor: 0.35, windowM: 1000, pauseS: 2, keepDuration: true },
    film: DEFAULT_FILM,
    labels: { climbs: true, waypoints: true },
    weather: { enabled: true },
    weatherScene: { enabled: true, strength: 1 },
    clouds: { mode: 'meteo' as const, coverage: 0.4, altitudeM: 1200, quality: 'medium' as const },
    water: { enabled: true, strength: 1 },
    overlay: DEFAULT_OVERLAY,
    video: { aspect: '16:9' as const, resolution: '1080p' as const, fps: 30 as const, quality: 'high' as const },
    poster: { format: 'a4-portrait' as const, style: 'editorial' as const, title: '', subtitle: '', figures: { distance: true, ascent: true, time: true, maxAltitude: true, climbs: true }, weather: true },
    landmarks: {
      enabled: true,
      kinds: { peak: true, pass: true, hut: true, lake: true, waterfall: false, place: false, viewpoint: false, glacier: false },
      maxDistanceM: 1500,
    },
    race: { enabled: false, sync: 'elapsed' as const },
  }

  it('resolves the sources from the catalogue', () => {
    const options = engineOptionsFromSettings(settings)
    expect(options.terrain).toBe(getTerrainSource('mapterhorn'))
    expect(options.imagery).toBe(getImagerySource('arcgis-world-imagery'))
    expect(options).toMatchObject({ imageryZoomOffset: 1, exaggeration: 1, wireframe: false })
  })

  it('diff returns null when nothing changed', () => {
    const a = engineOptionsFromSettings(settings)
    const b = engineOptionsFromSettings({ ...settings })
    expect(diffEngineOptions(a, b)).toBeNull()
  })

  it('diff returns only the changed keys', () => {
    const a = engineOptionsFromSettings(settings)
    const b = engineOptionsFromSettings({ ...settings, imagerySourceId: 'ign-ortho', exaggeration: 1.5 })
    const partial = diffEngineOptions(a, b)
    expect(partial).not.toBeNull()
    expect(Object.keys(partial ?? {}).sort()).toEqual(['exaggeration', 'imagery'])
    expect(partial?.imagery).toBe(getImagerySource('ign-ortho'))
    expect(partial?.exaggeration).toBe(1.5)
  })

  it('diff detects terrain, zoom offset and wireframe changes', () => {
    const a = engineOptionsFromSettings(settings)
    const b = engineOptionsFromSettings({
      ...settings,
      terrainSourceId: 'aws-terrarium',
      imageryZoomOffset: 2,
      wireframe: true,
    })
    const partial = diffEngineOptions(a, b)
    expect(Object.keys(partial ?? {}).sort()).toEqual(['imageryZoomOffset', 'terrain', 'wireframe'])
  })
})

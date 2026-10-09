import { describe, expect, it, vi } from 'vitest'
import type { LonLatBounds } from '../core/types'
import { DEFAULT_FILM } from '../film/model'
import { DEFAULT_OVERLAY } from '../overlay/settings'
import { AREA_MARGIN_M } from '../terrain/engine'
import { getImagerySource, getTerrainSource } from '../terrain/sources'
import { DEFAULT_GRADING } from './grading'
import { DEFAULT_MARKER, DEFAULT_TRACK_STYLE } from './markerSettings'

vi.mock('@react-three/fiber', () => ({ useFrame: vi.fn(), useThree: vi.fn() }))
vi.mock('../terrain/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../terrain/engine')>()),
  createTerrainEngine: vi.fn(),
}))

const {
  boundsContain,
  engineAreaFor,
  resolveEngineArea,
  usesRegionView,
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
  const inner = { west: 6.2, south: 45.2, east: 6.8, north: 45.8 }
  it('keeps the previous area while it still covers the desired one', () => {
    const previous = { area: outer }
    expect(resolveEngineArea(previous, { area: inner })).toBe(previous)
  })
  it('switches to the desired area when it grows outside', () => {
    const desired = { area: { west: 5, south: 45.2, east: 6.8, north: 45.8 } }
    expect(resolveEngineArea({ area: outer }, desired)).toBe(desired)
  })
  it('uses the desired area when there is no previous one', () => {
    const desired = { area: outer }
    expect(resolveEngineArea(null, desired)).toBe(desired)
  })
  it('switches when the region view comes or goes, and when the tracks leave the detail area', () => {
    const wide = { area: { west: 0, south: 40, east: 13, north: 51 }, detailArea: outer }
    expect(resolveEngineArea({ area: outer }, wide)).toBe(wide)
    const plain = { area: inner }
    expect(resolveEngineArea(wide, plain)).toBe(plain)
    expect(resolveEngineArea(wide, { ...wide, detailArea: inner })).toBe(wide)
    const moved = { ...wide, detailArea: { west: 5, south: 45, east: 6, north: 46 } }
    expect(resolveEngineArea(wide, moved)).toBe(moved)
  })
})

describe('engineAreaFor', () => {
  const track = { west: 6.8, south: 45.9, east: 7.0, north: 46.0 }
  it('the usual area without a region view, nothing coarse', () => {
    const { area, detailArea } = engineAreaFor(track, false)
    expect(detailArea).toBeUndefined()
    // 25 km of margin: ~0.23° of latitude
    expect(track.south - area.south).toBeCloseTo(AREA_MARGIN_M / 111_320, 2)
  })
  it('with a region view: the usual area as the detail area of a much larger one', () => {
    const wide = engineAreaFor(track, true)
    expect(wide.detailArea).toEqual(engineAreaFor(track, false).area)
    // 500 km of margin
    expect(track.south - wide.area.south).toBeCloseTo(500_000 / 111_320, 1)
    expect(boundsContain(wide.area, wide.detailArea!)).toBe(true)
  })
  it('a region view in the opening or the closing', () => {
    const shot = (style: 'descente' | 'situation') => ({ style, durationS: 6 })
    expect(usesRegionView(DEFAULT_FILM)).toBe(false)
    expect(usesRegionView({ opening: shot('situation'), closing: shot('descente') })).toBe(true)
    expect(usesRegionView({ opening: shot('descente'), closing: shot('situation') })).toBe(true)
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
    sunDate: '',
    sunFromTrack: true,
    exposureEv: 0,
    grading: DEFAULT_GRADING,
    trackColorBy: 'none' as const,
    camera: { style: 'chase' as const, distance: 1, pitchDeg: 30, headingOffsetDeg: 0, smoothing: 1, northUp: false },
    flyoverDurationS: 60,
    pacing: { enabled: false, climbs: true, landmarks: true, slowFactor: 0.35, windowM: 1000, pauseS: 2, keepDuration: true, transitionS: 1.5 },
    film: DEFAULT_FILM,
    labels: { climbs: true, waypoints: true, kmStep: 0, endpoints: false, photos: false, size: 1, rangeKm: 70 },
    weather: { enabled: true },
    weatherScene: { enabled: true, strength: 1 },
    haze: 0,
    clouds: { mode: 'meteo' as const, coverage: 0.4, altitudeM: 1200, quality: 'medium' as const },
    water: { enabled: true, strength: 1 },
    overlay: DEFAULT_OVERLAY,
    video: { aspect: '16:9' as const, resolution: '1080p' as const, fps: 30 as const, quality: 'high' as const },
    poster: { format: 'a4-portrait' as const, style: 'editorial' as const, title: '', subtitle: '', figures: { distance: true, ascent: true, time: true, maxAltitude: true, climbs: true }, weather: true, flat: false },
    landmarks: {
      enabled: true,
      kinds: { peak: true, pass: true, hut: true, lake: true, waterfall: false, place: false, viewpoint: false, glacier: false, waterPoint: false },
      maxDistanceM: 1500,
    },
    race: { enabled: false, sync: 'elapsed' as const },
    trackStyle: DEFAULT_TRACK_STYLE,
    marker: DEFAULT_MARKER,
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

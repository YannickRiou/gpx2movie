import { describe, expect, it, vi } from 'vitest'
import type { LonLatBounds } from '../core/types'
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

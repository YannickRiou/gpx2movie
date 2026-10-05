import { describe, expect, it } from 'vitest'
import type { ImagerySource, TileSourceBase } from '../core/types'
import {
  IMAGERY_SOURCES,
  TERRAIN_SOURCES,
  buildTileUrl,
  getImagerySource,
  getTerrainSource,
  sourceCovers,
} from './sources'

const CHAMONIX = { lon: 6.87, lat: 45.92 }
const CHAMONIX_Z12 = { z: 12, x: 2126, y: 1458 }

function fakeSource(urlTemplate: string, extra: Partial<TileSourceBase> = {}): TileSourceBase {
  return { id: 'fake', name: 'fake', urlTemplate, minZoom: 0, maxZoom: 19, tileSize: 256, attribution: '', ...extra }
}

describe('buildTileUrl', () => {
  it('expands {z} {x} {y}', () => {
    expect(buildTileUrl(fakeSource('https://a/{z}/{x}/{y}.png'), CHAMONIX_Z12)).toBe('https://a/12/2126/1458.png')
  })

  it('expands {-y} as the TMS-flipped row without touching {y}', () => {
    const url = buildTileUrl(fakeSource('https://a/{z}/{x}/{-y}?xyz={y}'), CHAMONIX_Z12)
    // 2^12 - 1 - 1458 = 2637
    expect(url).toBe('https://a/12/2126/2637?xyz=1458')
  })

  it('flips {-y} correctly at the extremes (z = 0, first/last row, and beyond 32-bit shifts)', () => {
    const tms = fakeSource('{z}/{x}/{-y}')
    expect(buildTileUrl(tms, { z: 0, x: 0, y: 0 })).toBe('0/0/0')
    expect(buildTileUrl(tms, { z: 3, x: 0, y: 0 })).toBe('3/0/7')
    expect(buildTileUrl(tms, { z: 3, x: 0, y: 7 })).toBe('3/0/0')
    // 1 << 31 is negative in JS; 2 ** 31 - 1 - 0 = 2147483647
    expect(buildTileUrl(tms, { z: 31, x: 0, y: 0 })).toBe('31/0/2147483647')
  })

  it('picks a deterministic subdomain for {s} based on the tile key', () => {
    const source = fakeSource('https://{s}.a/{z}/{x}/{y}', { subdomains: ['a', 'b', 'c'] })
    // (2126 + 1458) % 3 = 3584 % 3 = 2 -> 'c'
    expect(buildTileUrl(source, CHAMONIX_Z12)).toBe('https://c.a/12/2126/1458')
    expect(buildTileUrl(source, { z: 12, x: 2127, y: 1458 })).toBe('https://a.a/12/2127/1458')
    // same key -> same URL (cache keys must be stable)
    expect(buildTileUrl(source, CHAMONIX_Z12)).toBe(buildTileUrl(source, CHAMONIX_Z12))
  })

  it('leaves {s} untouched when the source declares no subdomains', () => {
    expect(buildTileUrl(fakeSource('https://{s}.a/{z}'), CHAMONIX_Z12)).toBe('https://{s}.a/12')
  })

  it('replaces every occurrence of a placeholder (WMTS query strings repeat none, but templates may)', () => {
    expect(buildTileUrl(fakeSource('/tiles/{z}/{z}'), { z: 3, x: 0, y: 0 })).toBe('/tiles/3/3')
  })

  it('keeps relative dev-proxy templates relative', () => {
    expect(buildTileUrl(fakeSource('/tiles/ign-ortho/wmts?TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'), CHAMONIX_Z12)).toBe(
      '/tiles/ign-ortho/wmts?TILEMATRIX=12&TILEROW=1458&TILECOL=2126',
    )
  })
})

describe('getters', () => {
  it('return the requested source by id', () => {
    expect(getTerrainSource('aws-terrarium').id).toBe('aws-terrarium')
    expect(getImagerySource('swisstopo').id).toBe('swisstopo')
  })

  it('fall back to the first catalogue entry for unknown ids', () => {
    expect(getTerrainSource('nope')).toBe(TERRAIN_SOURCES[0])
    expect(getImagerySource('')).toBe(IMAGERY_SOURCES[0])
  })

  it('default to Mapterhorn terrain and IGN imagery', () => {
    expect(TERRAIN_SOURCES[0].id).toBe('mapterhorn')
    expect(IMAGERY_SOURCES[0].id).toBe('ign-ortho')
  })
})

describe('sourceCovers', () => {
  const ign = getImagerySource('ign-ortho')
  const swiss = getImagerySource('swisstopo')
  const esri = getImagerySource('arcgis-world-imagery')

  it('treats a source without coverage as worldwide', () => {
    expect(esri.coverage).toBeUndefined()
    expect(sourceCovers(esri, { lon: -74, lat: 40.7 })).toBe(true)
    expect(sourceCovers(esri, { west: -180, south: -85, east: 180, north: 85 })).toBe(true)
  })

  it('accepts points inside the box and rejects points outside', () => {
    expect(sourceCovers(ign, CHAMONIX)).toBe(true)
    expect(sourceCovers(ign, { lon: -74, lat: 40.7 })).toBe(false)
    expect(sourceCovers(swiss, { lon: 7.75, lat: 46.02 })).toBe(true) // Zermatt
    expect(sourceCovers(swiss, { lon: 2.35, lat: 48.86 })).toBe(false) // Paris
  })

  it('requires the whole box to be inside the coverage', () => {
    const tourDuMontBlanc = { west: 6.7, south: 45.75, east: 7.1, north: 46.05 }
    expect(sourceCovers(ign, tourDuMontBlanc)).toBe(true)
    expect(sourceCovers(swiss, tourDuMontBlanc)).toBe(true)
    const franceAndAtlantic = { west: -6.5, south: 43, east: 2, north: 48 }
    expect(sourceCovers(ign, franceAndAtlantic)).toBe(false)
  })

  it('is edge-inclusive', () => {
    const c = ign.coverage!
    expect(sourceCovers(ign, { lon: c.west, lat: c.north })).toBe(true)
    expect(sourceCovers(ign, { lon: c.east, lat: c.south })).toBe(true)
    expect(sourceCovers(ign, { lon: c.east + 1e-9, lat: c.south })).toBe(false)
  })

  it('rejects a box that only partially overlaps, in every direction', () => {
    const c = swiss.coverage!
    const inside = { west: c.west + 1, south: c.south + 1, east: c.east - 1, north: c.north - 1 }
    expect(sourceCovers(swiss, inside)).toBe(true)
    expect(sourceCovers(swiss, { ...inside, west: c.west - 0.1 })).toBe(false)
    expect(sourceCovers(swiss, { ...inside, east: c.east + 0.1 })).toBe(false)
    expect(sourceCovers(swiss, { ...inside, south: c.south - 0.1 })).toBe(false)
    expect(sourceCovers(swiss, { ...inside, north: c.north + 0.1 })).toBe(false)
  })

  it('documents the known over-approximation of the IGN box (border strip without data)', () => {
    // Courmayeur (Italy) is inside the metropolitan-France box but IGN serves a white tile there;
    // callers must treat `true` as "worth trying", see docs/sources.md.
    expect(sourceCovers(ign, { lon: 6.97, lat: 45.79 })).toBe(true)
  })
})

describe('catalogue integrity (values verified 2026-10-05, see docs/sources.md)', () => {
  const all: TileSourceBase[] = [...TERRAIN_SOURCES, ...IMAGERY_SOURCES]

  it('has unique ids', () => {
    const ids = all.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(all.map((s) => [s.id, s] as const))('%s is well-formed', (_id, s) => {
    expect(s.name.length).toBeGreaterThan(0)
    expect(s.attribution.length).toBeGreaterThan(0)
    expect(s.minZoom).toBeGreaterThanOrEqual(0)
    expect(s.maxZoom).toBeGreaterThanOrEqual(s.minZoom)
    expect([256, 512]).toContain(s.tileSize)
    for (const p of ['{z}', '{x}', '{y}']) expect(s.urlTemplate).toContain(p)
    expect(s.urlTemplate).not.toContain('{-y}') // all catalogue sources are XYZ (y = 0 north)
    expect(s.urlTemplate.startsWith('https://') || s.urlTemplate.startsWith('/tiles/')).toBe(true)
    if (s.subdomains) expect(s.urlTemplate).toContain('{s}')
    else expect(s.urlTemplate).not.toContain('{s}')
    if (s.coverage) {
      expect(s.coverage.west).toBeLessThan(s.coverage.east)
      expect(s.coverage.south).toBeLessThan(s.coverage.north)
    }
  })

  it('builds the exact URLs that were verified with curl at Chamonix z12', () => {
    const expected: Record<string, string> = {
      mapterhorn: 'https://tiles.mapterhorn.com/12/2126/1458.webp',
      'aws-terrarium': 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/2126/1458.png',
      'ign-ortho':
        'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=12&TILEROW=1458&TILECOL=2126&FORMAT=image/jpeg',
      swisstopo: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/12/2126/1458.jpeg',
      'arcgis-world-imagery':
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/12/1458/2126',
      'eox-s2cloudless': 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/12/1458/2126.jpg',
    }
    for (const s of all) expect(buildTileUrl(s, CHAMONIX_Z12), s.id).toBe(expected[s.id])
  })

  it('terrain sources declare a known encoding and the verified tile sizes', () => {
    expect(getTerrainSource('mapterhorn')).toMatchObject({ encoding: 'terrarium', tileSize: 512, maxZoom: 17 })
    expect(getTerrainSource('aws-terrarium')).toMatchObject({ encoding: 'terrarium', tileSize: 256, maxZoom: 15 })
  })

  it('imagery sources are all 256 px with the verified max zooms', () => {
    const byId = Object.fromEntries(IMAGERY_SOURCES.map((s) => [s.id, s])) as Record<string, ImagerySource>
    expect(IMAGERY_SOURCES.every((s) => s.tileSize === 256)).toBe(true)
    expect(byId['ign-ortho'].maxZoom).toBe(19)
    expect(byId['swisstopo'].maxZoom).toBe(20)
    expect(byId['arcgis-world-imagery'].maxZoom).toBe(19)
    expect(byId['eox-s2cloudless'].maxZoom).toBe(16)
  })
})

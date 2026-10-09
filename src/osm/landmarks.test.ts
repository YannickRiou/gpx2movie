import { describe, expect, it } from 'vitest'
import { buildTrack } from '../import/stats'
import { buildTrackPath } from '../flyover/path'
import {
  DEFAULT_LANDMARK_SETTINGS,
  buildLandmarks,
  landmarkLabels,
  landmarkPriority,
  landmarkText,
  parseEle,
  projectOnPath,
  withLandmarkDefaults,
} from './landmarks'
import type { OsmFeature } from './overpass'

/** Straight track going south along 6.78° E from 45.90° N, 1 km per point (≈ 11 km). */
const TRACK = buildTrack({
  name: 't',
  source: 'gpx',
  segments: [{ points: Array.from({ length: 12 }, (_, i) => ({ lon: 6.78, lat: 45.9 - i * 0.009, ele: 1000 })) }],
})
const PATH = buildTrackPath(TRACK)

function feature(partial: Partial<OsmFeature> & Pick<OsmFeature, 'kind' | 'name'>): OsmFeature {
  return { id: `node/${partial.name}`, lon: 6.78, lat: 45.9, ...partial }
}

describe('parseEle', () => {
  it('reads the usual OSM spellings in metres', () => {
    expect(parseEle('1653')).toBe(1653)
    expect(parseEle('4808.73')).toBeCloseTo(4808.73)
    expect(parseEle('1 653 m')).toBe(1653)
    expect(parseEle('1653m')).toBe(1653)
    expect(parseEle('1653,5')).toBe(1653.5)
    expect(parseEle('1,653')).toBe(1653)
    expect(parseEle(' 2 120 ')).toBe(2120)
  })

  it('converts feet and rejects garbage or absurd values', () => {
    expect(parseEle('5400 ft')).toBeCloseTo(1645.9, 1)
    expect(parseEle(undefined)).toBeUndefined()
    expect(parseEle('')).toBeUndefined()
    expect(parseEle('environ 1600')).toBeUndefined()
    expect(parseEle('12000')).toBeUndefined()
    expect(parseEle('-800')).toBeUndefined()
  })
})

describe('projectOnPath', () => {
  it('gives the distance to the track and the position along it', () => {
    // 0.01° east of the 5th km, between two points: ≈ 775 m away at 45.86° N, 4.5 km along
    const p = projectOnPath(PATH, 6.79, 45.9 - 4.5 * 0.009)
    expect(p.distanceM).toBeCloseTo(775, -1)
    expect(p.alongM).toBeCloseTo(PATH.lengthM * (4.5 / 11), -2)
  })

  it('clamps to the ends', () => {
    expect(projectOnPath(PATH, 6.78, 45.95).alongM).toBe(0)
    expect(projectOnPath(PATH, 6.78, 45.7).alongM).toBe(PATH.lengthM)
    expect(projectOnPath({ ...PATH, count: 0 }, 6.78, 45.9).distanceM).toBe(Infinity)
  })
})

describe('landmarkPriority / landmarkText', () => {
  it('ranks crossed passes first, then peaks by elevation and closeness, huts, lakes, places last', () => {
    const crossed = landmarkPriority('pass', 1650, 20)
    const highPeak = landmarkPriority('peak', 4808, 500)
    const lowPeak = landmarkPriority('peak', 1200, 500)
    const farPeak = landmarkPriority('peak', 1200, 2500)
    const farPass = landmarkPriority('pass', 2000, 1200)
    const hut = landmarkPriority('hut', 1500, 100)
    const lake = landmarkPriority('lake', undefined, 100)
    const village = landmarkPriority('place', undefined, 100, 'village')
    const hamlet = landmarkPriority('place', undefined, 100, 'hamlet')
    expect(crossed).toBeGreaterThan(highPeak)
    expect(highPeak).toBeGreaterThan(lowPeak)
    expect(lowPeak).toBeGreaterThan(farPeak)
    expect(farPass).toBeGreaterThan(hut)
    expect(hut).toBeGreaterThan(lake)
    expect(lake).toBeGreaterThan(village)
    expect(village).toBeGreaterThan(hamlet)
    expect(crossed).toBeLessThan(50)
    expect(landmarkPriority('place', undefined, 3000, 'hamlet')).toBe(0)
  })

  it('adds the elevation to summits and passes only', () => {
    // narrow no-break space as thousands separator (formatNumber)
    expect(landmarkText('pass', 'Col de Voza', 1653)).toBe('Col de Voza · 1 653 m')
    expect(landmarkText('peak', 'Le Prarion', 1969.1)).toBe('Le Prarion · 1 969 m')
    expect(landmarkText('peak', 'Sans cote', undefined)).toBe('Sans cote')
    expect(landmarkText('hut', "Refuge du Nid d'Aigle", 2372)).toBe("Refuge du Nid d'Aigle")
    expect(landmarkText('lake', 'Lac Blanc', 2352)).toBe('Lac Blanc')
  })
})

describe('buildLandmarks', () => {
  const settings = { kinds: DEFAULT_LANDMARK_SETTINGS.kinds, maxDistanceM: 1500 }

  it('filters by kind and distance, parses the elevation and orders along the track', () => {
    const features = [
      feature({ kind: 'peak', name: 'Mont Truc', ele: '1 811 m', lat: 45.9 - 8 * 0.009, lon: 6.785 }),
      feature({ kind: 'pass', name: 'Col de Voza', ele: '1650', lat: 45.9 - 3 * 0.009 }),
      feature({ kind: 'hut', name: 'Refuge', lat: 45.9 - 5 * 0.009, lon: 6.79 }),
      feature({ kind: 'place', name: 'Hameau', lat: 45.9 - 1 * 0.009, detail: 'hamlet' }),
      feature({ kind: 'peak', name: 'Trop loin', ele: '3000', lat: 45.9 - 6 * 0.009, lon: 6.81 }),
    ]
    const out = buildLandmarks(features, PATH, settings)
    expect(out.map((l) => l.name)).toEqual(['Col de Voza', 'Refuge', 'Mont Truc'])
    expect(out[0]).toMatchObject({ kind: 'pass', ele: 1650, text: 'Col de Voza · 1 650 m' })
    expect(out[0].distanceM).toBeLessThan(1)
    expect(out[2].ele).toBe(1811)
    expect(out[1].ele).toBeUndefined()
    expect(out[0].alongM).toBeLessThan(out[1].alongM)
    expect(out[1].alongM).toBeLessThan(out[2].alongM)
  })

  it('keeps one landmark per name nearby, the most important one', () => {
    const features = [
      feature({ id: 'node/1', kind: 'pass', name: 'Col de Voza', lat: 45.9 - 3 * 0.009 }),
      feature({ id: 'node/2', kind: 'pass', name: 'Col de Voza', ele: '1650', lat: 45.9 - 3 * 0.009, lon: 6.781 }),
      feature({ id: 'node/3', kind: 'pass', name: 'COL DE VOZA', lat: 45.9 - 3 * 0.009, lon: 6.779 }),
      feature({ id: 'node/4', kind: 'pass', name: 'Col de Voza', lat: 45.9 - 10 * 0.009 }),
    ]
    const out = buildLandmarks(features, PATH, settings)
    expect(out.map((l) => l.id)).toEqual(['node/2', 'node/4'])
  })

  it('caps the count by priority, then orders along the track', () => {
    const features = Array.from({ length: 10 }, (_, i) =>
      feature({ id: `node/${i}`, kind: 'peak', name: `Pic ${i}`, ele: String(1000 + i * 100), lat: 45.9 - i * 0.009 }),
    )
    const out = buildLandmarks(features, PATH, settings, 3)
    expect(out.map((l) => l.name)).toEqual(['Pic 7', 'Pic 8', 'Pic 9'])
  })
})

describe('landmarkLabels', () => {
  it('maps kinds to the label model, merges tracks on the OSM id and caps the count', () => {
    const base = { lon: 6.78, lat: 45.9, distanceM: 10, alongM: 0 }
    const a = [
      { ...base, id: 'node/1', kind: 'pass' as const, name: 'Col', ele: 1650, priority: 40, text: 'Col · 1 650 m' },
      { ...base, id: 'way/2', kind: 'lake' as const, name: 'Lac', priority: 18, text: 'Lac' },
    ]
    const b = [
      { ...base, id: 'node/1', kind: 'pass' as const, name: 'Col', ele: 1650, priority: 30, text: 'Col · 1 650 m' },
      { ...base, id: 'node/3', kind: 'glacier' as const, name: 'Glacier', priority: 14, text: 'Glacier' },
    ]
    const labels = landmarkLabels([a, b])
    expect(labels).toEqual([
      { id: 'osm:node/1', lon: 6.78, lat: 45.9, ele: 1650, text: 'Col · 1 650 m', kind: 'pass', priority: 40 },
      { id: 'osm:way/2', lon: 6.78, lat: 45.9, text: 'Lac', kind: 'water', priority: 18 },
      { id: 'osm:node/3', lon: 6.78, lat: 45.9, text: 'Glacier', kind: 'other', priority: 14 },
    ])
    expect(landmarkLabels([a, b], 1)).toHaveLength(1)
  })
})

describe('withLandmarkDefaults', () => {
  it('gives an older project the kinds added since, off', () => {
    const { waterPoint: _added, ...olderKinds } = DEFAULT_LANDMARK_SETTINGS.kinds
    const older = { enabled: true, kinds: { ...olderKinds, place: true }, maxDistanceM: 800 }
    expect(withLandmarkDefaults(older)).toEqual({ ...older, kinds: { ...older.kinds, waterPoint: false } })
    expect(withLandmarkDefaults('x')).toBe('x')
  })
})

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import sampleGpx from '../../public/samples/tour-du-mont-blanc-j1.gpx?raw'
import type { LonLatBounds, TileSourceBase } from '../core/types'
import { parseGpx } from '../import/gpx'
import { buildTrack } from '../import/stats'
import { unionBounds } from '../state/store'
import { FLAT_MAP_MARGIN, FLAT_MAP_MAX_TILES, framingPath, planFlatMap } from './view'

const sample = parseGpx(sampleGpx, 'tour-du-mont-blanc-j1.gpx')[0]
/** a short outing north-east of the sample */
const other = buildTrack({ name: 'autre', source: 'gpx', segments: [{ points: [{ lon: 7.1, lat: 46.1 }, { lon: 7.15, lat: 46.2 }] }] })
const SOURCE: Pick<TileSourceBase, 'tileSize' | 'minZoom' | 'maxZoom' | 'coverage'> = { tileSize: 256, minZoom: 0, maxZoom: 19 }

const points = (bounds: LonLatBounds) => [
  { lon: bounds.west, lat: bounds.north },
  { lon: bounds.east, lat: bounds.south },
]

describe('framing of the poster view', () => {
  it('frames every track: one path through all their points', () => {
    const path = framingPath([sample, other])
    expect(path.count).toBe(sample.stats.pointCount + other.stats.pointCount)
    expect(Math.max(...path.lat)).toBeCloseTo(46.2, 9)
    expect(Math.min(...path.lon)).toBeCloseTo(sample.bounds.west, 9)
  })
})

describe('planFlatMap', () => {
  const bounds = unionBounds([sample, other]) as LonLatBounds

  it.each([
    [2184, 2400],
    [3600, 2000],
    [800, 800],
  ])('%i × %i px: every track inside the margins, centred, north up', (width, height) => {
    const plan = planFlatMap(bounds, width, height, SOURCE)
    const [nw, se] = points(bounds).map((p) => plan.project(p.lon, p.lat))
    const margin = FLAT_MAP_MARGIN * Math.min(width, height) - 1e-6
    expect(nw.x).toBeGreaterThanOrEqual(margin)
    expect(nw.y).toBeGreaterThanOrEqual(margin)
    expect(se.x).toBeLessThanOrEqual(width - margin)
    expect(se.y).toBeLessThanOrEqual(height - margin)
    // north up, east right, centred
    expect(se.y).toBeGreaterThan(nw.y)
    expect(se.x).toBeGreaterThan(nw.x)
    expect((nw.x + se.x) / 2).toBeCloseTo(width / 2, 6)
    expect((nw.y + se.y) / 2).toBeCloseTo(height / 2, 6)
    // the tracks fill the view along one side
    expect(Math.max((se.x - nw.x) / width, (se.y - nw.y) / height)).toBeCloseTo(1 - 2 * FLAT_MAP_MARGIN, 6)
  })

  it('covers the whole view with tiles that meet without a gap, near their own size, within the budget', () => {
    const width = 3508
    const height = 2600
    const plan = planFlatMap(bounds, width, height, SOURCE)
    expect(plan.tiles.length).toBeLessThanOrEqual(FLAT_MAP_MAX_TILES)
    expect(Math.min(...plan.tiles.map((t) => t.x))).toBeLessThanOrEqual(0)
    expect(Math.min(...plan.tiles.map((t) => t.y))).toBeLessThanOrEqual(0)
    expect(Math.max(...plan.tiles.map((t) => t.x + t.w))).toBeGreaterThanOrEqual(width)
    expect(Math.max(...plan.tiles.map((t) => t.y + t.h))).toBeGreaterThanOrEqual(height)
    const byKey = new Map(plan.tiles.map((t) => [`${t.key.x}/${t.key.y}`, t]))
    for (const t of plan.tiles) {
      expect(t.key.z).toBe(plan.zoom)
      for (const v of [t.x, t.y, t.w, t.h]) expect(Number.isInteger(v)).toBe(true)
      expect(t.w).toBeGreaterThan(256 * 0.7)
      expect(t.w).toBeLessThan(256 * 1.42)
      const right = byKey.get(`${t.key.x + 1}/${t.key.y}`)
      if (right) expect(right.x).toBe(t.x + t.w)
      const below = byKey.get(`${t.key.x}/${t.key.y + 1}`)
      if (below) expect(below.y).toBe(t.y + t.h)
    }
  })

  it('goes down a zoom level when the tiles would be too many, and never past the deepest tiles', () => {
    const fine = planFlatMap(bounds, 3508, 2600, SOURCE)
    const capped = planFlatMap(bounds, 3508, 2600, SOURCE, 40)
    expect(capped.zoom).toBeLessThan(fine.zoom)
    expect(capped.tiles.length).toBeLessThanOrEqual(40)
    const tiny: LonLatBounds = { west: 6.8, east: 6.8001, south: 45.9, north: 45.9001 }
    expect(planFlatMap(tiny, 2000, 2000, { ...SOURCE, maxZoom: 16 }).zoom).toBe(16)
  })

  it('leaves out the tiles outside the source coverage', () => {
    const all = planFlatMap(bounds, 2000, 2000, SOURCE)
    const west = planFlatMap(bounds, 2000, 2000, { ...SOURCE, coverage: { west: 0, east: 6.9, south: 40, north: 50 } })
    expect(west.tiles.length).toBeGreaterThan(0)
    expect(west.tiles.length).toBeLessThan(all.tiles.length)
  })
})

import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../core/types'
import { buildTrack } from '../import/stats'
import { trackPathOf } from './path'
import { smoothedTrackPath, smoothPoints, smoothTrack } from './smooth'

/** Metres per degree of latitude on the haversine sphere (R = 6371008.8 m). */
const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180
const LON0 = 6.8
const LAT0 = 45.8
/** Metres per degree of longitude at LAT0. */
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180)

/** Points heading north every `stepM`, offset east by `offsetM(i)` metres from the lon = LON0 line. */
function line(count: number, stepM: number, offsetM: (i: number) => number = () => 0): TrackPoint[] {
  const points: TrackPoint[] = []
  for (let i = 0; i < count; i++) {
    points.push({ lon: LON0 + offsetM(i) / M_PER_DEG_LON, lat: LAT0 + (i * stepM) / M_PER_DEG_LAT })
  }
  return points
}

/** Distance (metres) of a point to the lon = LON0 line. */
function offLine(p: TrackPoint): number {
  return Math.abs(p.lon - LON0) * M_PER_DEG_LON
}

describe('smoothPoints', () => {
  it('returns the same instance when the window is 0 or there are fewer than 3 points', () => {
    const points = line(20, 10)
    expect(smoothPoints(points, 0)).toBe(points)
    expect(smoothPoints(points, -5)).toBe(points)
    const two = line(2, 10)
    expect(smoothPoints(two, 100)).toBe(two)
  })

  it('keeps a straight line identical', () => {
    const points = line(50, 10)
    const out = smoothPoints(points, 100)
    expect(out).not.toBe(points)
    expect(out).toHaveLength(points.length)
    out.forEach((p, i) => {
      expect(p.lon).toBeCloseTo(points[i].lon, 9)
      expect(p.lat).toBeCloseTo(points[i].lat, 9)
    })
  })

  it('flattens a GPS zigzag and keeps the end points exactly', () => {
    const points = line(60, 10, (i) => (i % 2 === 0 ? 5 : -5))
    expect(Math.max(...points.map(offLine))).toBeCloseTo(5, 6)
    const out = smoothPoints(points, 100)
    expect(out[0]).toEqual(points[0])
    expect(out[out.length - 1]).toEqual(points[points.length - 1])
    // the window shrinks to nothing next to the ends: those two points stay (almost) as recorded
    expect(offLine(out[1])).toBeCloseTo(5, 3)
    expect(offLine(out[out.length - 2])).toBeCloseTo(5, 3)
    const inner = out.slice(2, -2)
    expect(Math.max(...inner.map(offLine))).toBeLessThan(1)
    // the smoothed points still progress northwards
    for (let i = 1; i < out.length; i++) expect(out[i].lat).toBeGreaterThan(out[i - 1].lat)
  })

  it('keeps time and hr from each original point', () => {
    const points = line(10, 10, (i) => (i % 2 === 0 ? 3 : -3)).map((p, i) => ({ ...p, time: 1_000 * i, hr: 120 + i }))
    const out = smoothPoints(points, 50)
    out.forEach((p, i) => {
      expect(p.time).toBe(points[i].time)
      expect(p.hr).toBe(points[i].hr)
    })
    // the originals are not mutated
    expect(points[3].lon).toBeCloseTo(LON0 - 3 / M_PER_DEG_LON, 12)
  })

  it('smooths ele where present and leaves it absent otherwise', () => {
    const points = line(11, 10).map((p, i) => (i === 5 ? p : { ...p, ele: i % 2 === 0 ? 1000 : 1010 }))
    const out = smoothPoints(points, 60)
    expect(out[5].ele).toBeUndefined()
    expect('ele' in out[5]).toBe(false)
    // inner points with ele are pulled towards the mean of their neighbours
    for (let i = 2; i < 9; i++) {
      if (i === 5) continue
      const e = out[i].ele
      expect(e).toBeDefined()
      expect(e).toBeGreaterThan(1000)
      expect(e).toBeLessThan(1010)
    }
    // ends and their neighbours (empty window) keep the recorded elevation
    expect(out[0].ele).toBe(1000)
    expect(out[1].ele).toBe(1010)
    expect(out[9].ele).toBe(1010)
    expect(out[10].ele).toBe(1000)
  })
})

describe('smoothTrack', () => {
  const zigzag = line(40, 10, (i) => (i % 2 === 0 ? 5 : -5))
  const track = buildTrack({ name: 'zz', source: 'gpx', segments: [{ points: zigzag }, { points: zigzag.slice(0, 20) }] })

  it('returns the track itself when the window is 0', () => {
    expect(smoothTrack(track, 0)).toBe(track)
    expect(smoothTrack(track, 0).segments).toBe(track.segments)
  })

  it('smooths every segment and keeps id, stats, bounds and colour', () => {
    const out = smoothTrack(track, 100)
    expect(out).not.toBe(track)
    expect(out.id).toBe(track.id)
    expect(out.name).toBe(track.name)
    expect(out.stats).toBe(track.stats)
    expect(out.bounds).toBe(track.bounds)
    expect(out.color).toBe(track.color)
    expect(out.segments).toHaveLength(2)
    for (const [k, segment] of out.segments.entries()) {
      expect(segment.points).toHaveLength(track.segments[k].points.length)
      expect(Math.max(...segment.points.slice(2, -2).map(offLine))).toBeLessThan(1)
    }
    // the original track is untouched
    expect(Math.max(...track.segments[0].points.map(offLine))).toBeCloseTo(5, 6)
  })
})

describe('smoothedTrackPath', () => {
  const zigzag = line(40, 10, (i) => (i % 2 === 0 ? 5 : -5)).map((p, i) => ({ ...p, time: 1_000 * i }))
  const track = buildTrack({ name: 'zz', source: 'gpx', segments: [{ points: zigzag }] })

  it('is the cached recorded path when the window is 0', () => {
    expect(smoothedTrackPath(track, 0)).toBe(trackPathOf(track))
  })

  it('smooths the positions and keeps the recorded distances and times', () => {
    const recorded = trackPathOf(track)
    const path = smoothedTrackPath(track, 100)
    expect(path.count).toBe(recorded.count)
    expect(path.dist).toBe(recorded.dist)
    expect(path.lengthM).toBe(track.stats.distanceM)
    expect(Array.from(path.time)).toEqual(Array.from(recorded.time))
    for (let i = 2; i < path.count - 2; i++) expect(Math.abs(path.lon[i] - LON0) * M_PER_DEG_LON).toBeLessThan(1)
    expect(path.lon[0]).toBe(recorded.lon[0])
  })
})

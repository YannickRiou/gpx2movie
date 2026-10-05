import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../core/types'
import { haversineM } from '../geo/ellipsoid'
import {
  buildTrack,
  computeBounds,
  computeElevationGain,
  computeStats,
  densify,
  smoothElevations,
  stripExtension,
} from './stats'

describe('computeElevationGain', () => {
  it('ignores metre-level zig-zag noise', () => {
    const noisy: number[] = []
    for (let i = 0; i < 200; i++) noisy.push(1000 + (i % 2 === 0 ? 1 : -1))
    const gain = computeElevationGain(noisy)
    expect(gain.ascentM).toBeLessThan(0.5)
    expect(gain.descentM).toBeLessThan(0.5)
  })

  it('keeps a slow steady climb despite noise', () => {
    const values: number[] = []
    for (let i = 0; i < 400; i++) values.push(1000 + i * 0.5 + (i % 3) - 1)
    const gain = computeElevationGain(values)
    expect(gain.ascentM).toBeGreaterThan(190)
    expect(gain.ascentM).toBeLessThan(205)
    expect(gain.descentM).toBeLessThan(2)
  })

  it('counts a staircase exactly', () => {
    expect(computeElevationGain([100, 100, 100, 100, 100, 200, 200, 200, 200, 200, 150, 150, 150, 150, 150])).toEqual({
      ascentM: 100,
      descentM: 50,
    })
    expect(computeElevationGain([])).toEqual({ ascentM: 0, descentM: 0 })
    expect(computeElevationGain([42])).toEqual({ ascentM: 0, descentM: 0 })
  })
})

describe('smoothElevations', () => {
  it('keeps the end values of a ramp and averages the interior', () => {
    expect(smoothElevations([0, 10, 20, 30, 40, 50])).toEqual([0, 10, 20, 30, 40, 50])
    expect(smoothElevations([0, 0, 10, 0, 0])).toEqual([0, 10 / 3, 2, 10 / 3, 0])
    expect(smoothElevations([], 5)).toEqual([])
  })
})

describe('computeStats / computeBounds', () => {
  const points: TrackPoint[] = [
    { lon: 6, lat: 45, ele: 1000, time: 1_000_000 },
    { lon: 6.01, lat: 45, ele: 1010, time: 1_300_000 },
    { lon: 6.01, lat: 45.01, ele: 1004, time: 1_600_000 },
  ]

  it('sums distance within segments only and exposes times', () => {
    const stats = computeStats([{ points: points.slice(0, 2) }, { points: points.slice(2) }])
    expect(stats.distanceM).toBeCloseTo(haversineM(points[0], points[1]), 6)
    expect(stats.pointCount).toBe(3)
    expect(stats.startTime).toBe(1_000_000)
    expect(stats.endTime).toBe(1_600_000)
    expect(stats.durationS).toBe(600)
    expect(stats.minEle).toBe(1000)
    expect(stats.maxEle).toBe(1010)
  })

  it('handles empty input and points without elevation or time', () => {
    const stats = computeStats([])
    expect(stats).toEqual({
      distanceM: 0,
      ascentM: 0,
      descentM: 0,
      durationS: undefined,
      minEle: undefined,
      maxEle: undefined,
      startTime: undefined,
      endTime: undefined,
      pointCount: 0,
    })
    const bare = computeStats([{ points: [{ lon: 6, lat: 45 }, { lon: 6.001, lat: 45 }] }])
    expect(bare.distanceM).toBeGreaterThan(70)
    expect(bare.durationS).toBeUndefined()
    expect(bare.minEle).toBeUndefined()
  })

  it('computes bounds and rejects empty input', () => {
    expect(computeBounds([{ points }])).toEqual({ west: 6, east: 6.01, south: 45, north: 45.01 })
    expect(() => computeBounds([{ points: [] }])).toThrow(/aucun point/)
  })
})

describe('densify', () => {
  const a: TrackPoint = { lon: 6, lat: 45, ele: 1000, time: 0, hr: 100 }
  const b: TrackPoint = { lon: 6.0127, lat: 45, ele: 1100, time: 60_000 }
  const c: TrackPoint = { lon: 6.0127, lat: 45.0005, ele: 1120, time: 70_000 }

  it('guarantees the maximum step and keeps the original points', () => {
    const out = densify([a, b, c], 100)
    expect(out[0]).toBe(a)
    expect(out[out.length - 1]).toBe(c)
    expect(out).toContain(b)
    const dAB = haversineM(a, b)
    expect(out.length).toBe(1 + Math.ceil(dAB / 100) + 1)
    for (let i = 1; i < out.length; i++) expect(haversineM(out[i - 1], out[i])).toBeLessThanOrEqual(100 * 1.001)
  })

  it('interpolates ele and time, and leaves fields absent on one side undefined', () => {
    const out = densify([a, b], 500)
    const mid = out[1]
    expect(mid.lon).toBeCloseTo(6.0127 / 2 + 3, 9)
    expect(mid.ele).toBeCloseTo(1050, 6)
    expect(mid.time).toBeCloseTo(30_000, 6)
    expect(mid.hr).toBeUndefined()
  })

  it('returns a copy for degenerate inputs and validates the step', () => {
    expect(densify([], 10)).toEqual([])
    expect(densify([a], 10)).toEqual([a])
    expect(() => densify([a, b], 0)).toThrow(RangeError)
  })
})

describe('buildTrack / stripExtension', () => {
  it('assembles a track with id, stats and bounds', () => {
    const track = buildTrack({ name: 'T', source: 'gpx', segments: [{ points: [{ lon: 6, lat: 45 }] }] })
    expect(track.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(track.color).toBe('')
    expect(track.activityType).toBeUndefined()
    expect(track.stats.pointCount).toBe(1)
    expect(track.bounds.west).toBe(6)
  })

  it('strips extensions and directories', () => {
    expect(stripExtension('trace.GPX')).toBe('trace')
    expect(stripExtension('C:\\a\\b\\sortie du matin.fit')).toBe('sortie du matin')
    expect(stripExtension('/tmp/x/sans-extension')).toBe('sans-extension')
    expect(stripExtension('.gpx')).toBe('.gpx')
  })
})

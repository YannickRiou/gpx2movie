import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../core/types'
import { haversineM } from '../geo/ellipsoid'
import { buildTrack } from '../import/stats'
import { buildTrackPath, elevationProfile, samplePath } from './path'

const A: TrackPoint = { lon: 6.8, lat: 45.9, ele: 1000 }
const B: TrackPoint = { lon: 6.81, lat: 45.9, ele: 1100 }
const C: TrackPoint = { lon: 6.81, lat: 45.91 }
const D: TrackPoint = { lon: 6.82, lat: 45.91, ele: 1300 }

const track = buildTrack({ name: 't', source: 'gpx', segments: [{ points: [A, B, C] }, { points: [D] }] })

describe('buildTrackPath', () => {
  it('concatenates the segments with cumulative distances matching the track stats', () => {
    const path = buildTrackPath(track)
    expect(path.count).toBe(4)
    expect(path.dist[0]).toBe(0)
    expect(path.dist[1]).toBeCloseTo(haversineM(A, B), 6)
    expect(path.dist[2]).toBeCloseTo(haversineM(A, B) + haversineM(B, C), 6)
    // the jump C -> D between segments adds no distance
    expect(path.dist[3]).toBe(path.dist[2])
    expect(path.lengthM).toBeCloseTo(track.stats.distanceM, 6)
    expect(Number.isNaN(path.ele[2])).toBe(true)
  })
})

describe('samplePath', () => {
  const path = buildTrackPath(track)

  it('returns the end points at 0 and at the length, and clamps outside', () => {
    expect(samplePath(path, 0)).toEqual({ lon: A.lon, lat: A.lat, ele: 1000 })
    expect(samplePath(path, -50)).toEqual(samplePath(path, 0))
    const end = samplePath(path, path.lengthM)
    expect(end.lon).toBeCloseTo(D.lon, 9)
    expect(end.lat).toBeCloseTo(D.lat, 9)
    expect(samplePath(path, path.lengthM + 1e4)).toEqual(end)
  })

  it('interpolates position and elevation linearly by distance', () => {
    const mid = samplePath(path, path.dist[1] / 2)
    expect(mid.lon).toBeCloseTo((A.lon + B.lon) / 2, 9)
    expect(mid.lat).toBeCloseTo(45.9, 9)
    expect(mid.ele).toBeCloseTo(1050, 6)
  })

  it('leaves the elevation undefined next to a point without one', () => {
    expect(samplePath(path, (path.dist[1] + path.dist[2]) / 2).ele).toBeUndefined()
  })

  it('throws on an empty path', () => {
    const empty = { ...path, count: 0 }
    expect(() => samplePath(empty, 0)).toThrow(RangeError)
  })
})

describe('elevationProfile', () => {
  const path = buildTrackPath(track)

  it('samples the elevation at evenly spaced distances, NaN where unknown', () => {
    const profile = elevationProfile(path, 101)!
    expect(profile.ele).toHaveLength(101)
    expect(profile.ele[0]).toBe(1000)
    // A -> B: linear in distance
    expect(profile.ele[1]).toBeCloseTo(1000 + (100 * (path.lengthM / 100)) / path.dist[1], 6)
    // B -> C: C has no elevation
    expect(profile.ele[Math.round(((path.dist[1] + path.dist[2]) / 2 / path.lengthM) * 100)]).toBeNaN()
    // the end is D (the jump C -> D adds no distance)
    expect(profile.ele[100]).toBe(1300)
    expect(profile.minEle).toBe(1000)
    expect(profile.maxEle).toBe(1300)
  })

  it('is undefined without any recorded elevation', () => {
    const flat = buildTrack({ name: 'f', source: 'gpx', segments: [{ points: [{ lon: 6.8, lat: 45.9 }, C] }] })
    expect(elevationProfile(buildTrackPath(flat), 10)).toBeUndefined()
    expect(elevationProfile({ ...path, count: 0 }, 10)).toBeUndefined()
  })
})

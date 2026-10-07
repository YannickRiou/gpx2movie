import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../core/types'
import { haversineM } from '../geo/ellipsoid'
import { buildTrack } from '../import/stats'
import { buildTrackPath, distanceAtTime, elevationProfile, nearestOnPath, pickProjectedPath, recordedTimeAt, samplePath } from './path'

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

describe('recorded time', () => {
  const T0 = Date.UTC(2026, 6, 14, 4, 30)
  const MIN = 60_000
  // A at T0, B without time, C at T0 + 20 min, pause at C until T0 + 30 min (no distance), D at T0 + 40 min
  const timed = buildTrack({
    name: 'h',
    source: 'gpx',
    segments: [
      { points: [{ ...A, time: T0 }, B, { ...C, time: T0 + 20 * MIN }, { ...C, time: T0 + 30 * MIN }] },
      { points: [{ ...D, time: T0 + 40 * MIN }] },
    ],
  })
  const path = buildTrackPath(timed)

  it('keeps the time per point, NaN when unknown', () => {
    expect(path.time[0]).toBe(T0)
    expect(path.time[1]).toBeNaN()
    expect(path.time[3]).toBe(T0 + 30 * MIN)
  })

  it('samplePath interpolates the time only between two timed points', () => {
    // like the elevation: undefined as soon as one end has no time, even exactly on a timed point
    expect(samplePath(path, 0).time).toBeUndefined()
    expect(samplePath(path, path.dist[1] / 2).time).toBeUndefined()
    // pause then segment jump: no distance, the playback crosses them instantly (last point wins)
    expect(samplePath(path, path.lengthM).time).toBe(T0 + 40 * MIN)
  })

  it('recordedTimeAt bridges points without time by distance', () => {
    expect(recordedTimeAt(path, 0)).toBe(T0)
    const at = path.dist[1] / 2
    expect(recordedTimeAt(path, at)).toBeCloseTo(T0 + 20 * MIN * (at / path.dist[2]), 3)
    expect(recordedTimeAt(path, path.dist[1])).toBeCloseTo(T0 + 20 * MIN * (path.dist[1] / path.dist[2]), 3)
    expect(recordedTimeAt(path, path.lengthM)).toBe(T0 + 40 * MIN)
  })

  it('uses the only timed side at the ends, undefined without any time', () => {
    const tail = buildTrack({ name: 't', source: 'gpx', segments: [{ points: [A, B, { ...C, time: T0 }, D] }] })
    const tailPath = buildTrackPath(tail)
    expect(recordedTimeAt(tailPath, 0)).toBe(T0)
    expect(recordedTimeAt(tailPath, tailPath.lengthM)).toBe(T0)
    expect(recordedTimeAt(buildTrackPath(track), 100)).toBeUndefined()
  })
})

describe('photos along the path', () => {
  const T0 = Date.UTC(2026, 6, 14, 4, 30)
  const MIN = 60_000
  // A, B, C timed every 10 min, C held 10 min (pause), back to B
  const outAndBack = buildTrack({
    name: 'p',
    source: 'gpx',
    segments: [
      {
        points: [
          { ...A, time: T0 },
          { ...B, time: T0 + 10 * MIN },
          { ...C, time: T0 + 20 * MIN },
          { ...C, time: T0 + 30 * MIN },
          { ...B, time: T0 + 40 * MIN },
        ],
      },
    ],
  })
  const path = buildTrackPath(outAndBack)

  it('nearest point, on the pass recorded closest to the instant', () => {
    const near = nearestOnPath(path, { lon: 6.8101, lat: 45.9 })!
    expect(near.distanceM).toBe(path.dist[1])
    expect(near.offM).toBeCloseTo(haversineM(B, { lon: 6.8101, lat: 45.9 }), 6)
    expect(nearestOnPath(path, B, T0 + 38 * MIN)!.distanceM).toBe(path.dist[4])
    expect(nearestOnPath({ ...path, count: 0 }, A)).toBeUndefined()
  })

  it('distance at a recorded instant, ends within the tolerance', () => {
    expect(distanceAtTime(path, T0 + 5 * MIN)).toBeCloseTo(path.dist[1] / 2, 6)
    expect(distanceAtTime(path, T0 + 25 * MIN)).toBe(path.dist[2])
    expect(distanceAtTime(path, T0)).toBe(0)
    expect(distanceAtTime(path, T0 - MIN)).toBeUndefined()
    expect(distanceAtTime(path, T0 - MIN, 2 * MIN)).toBe(0)
    expect(distanceAtTime(path, T0 + 41 * MIN, 2 * MIN)).toBe(path.lengthM)
    expect(distanceAtTime(path, T0 + 50 * MIN, 2 * MIN)).toBeUndefined()
    expect(distanceAtTime(buildTrackPath(track), T0)).toBeUndefined()
  })
})

describe('picking the track on screen', () => {
  // samples at 0, 100, 200 m drawn from (0, 0) to (200, 0) px, then back above it to (0, 40) at 400 m
  const screen = [0, 0, 100, 0, 200, 0, 200, 40, 0, 40]
  const distM = [0, 100, 200, 240, 440]

  it('gives the distance of the nearest point within the radius, between two samples too', () => {
    expect(pickProjectedPath(screen, distM, 50, 5, 12)).toBeCloseTo(50, 6)
    expect(pickProjectedPath(screen, distM, 150, -3, 12)).toBeCloseTo(150, 6)
    // the pass back, nearer to the pointer than the way out
    expect(pickProjectedPath(screen, distM, 50, 30, 12)).toBeCloseTo(390, 6)
  })

  it('gives nothing beyond the radius', () => {
    expect(pickProjectedPath(screen, distM, 50, 20, 12)).toBeUndefined()
    expect(pickProjectedPath([], [], 0, 0, 12)).toBeUndefined()
  })

  it('skips the samples behind the camera and the segments that touch them', () => {
    const hidden = [0, 0, Number.NaN, Number.NaN, 200, 0]
    expect(pickProjectedPath(hidden, [0, 100, 200], 100, 0, 12)).toBeUndefined()
    expect(pickProjectedPath(hidden, [0, 100, 200], 195, 2, 12)).toBe(200)
  })
})

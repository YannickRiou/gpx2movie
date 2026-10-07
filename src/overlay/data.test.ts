import { describe, expect, it } from 'vitest'
import sampleGpx from '../../public/samples/tour-du-mont-blanc-j1.gpx?raw'
import type { TrackPoint } from '../core/types'
import { parseGpx } from '../import/gpx'
import { buildTrack } from '../import/stats'
import { cumulativeAscent, overlayFrameAt, prepareOverlayTrack } from './data'

/** metres per degree of latitude on the haversine sphere */
const M_PER_DEG = (6371008.8 * Math.PI) / 180
const T0 = Date.UTC(2025, 6, 12, 7)

/** Points due north every 10 m, one every 5 s (7.2 km/h), elevation and extras from `extra`. */
function line(count: number, extra: (i: number) => Partial<TrackPoint>): TrackPoint[] {
  return Array.from({ length: count }, (_, i) => ({ lon: 6.8, lat: 45.9 + (i * 10) / M_PER_DEG, time: T0 + i * 5000, ...extra(i) }))
}

const sample = parseGpx(sampleGpx, 'tour-du-mont-blanc-j1.gpx')[0]

describe('cumulativeAscent', () => {
  it('rises monotonically to the D+ of the track statistics', () => {
    const ascent = cumulativeAscent(sample)
    expect(ascent[0]).toBe(0)
    for (let i = 1; i < ascent.length; i++) expect(ascent[i]).toBeGreaterThanOrEqual(ascent[i - 1])
    expect(ascent[ascent.length - 1]).toBeCloseTo(sample.stats.ascentM, 6)
  })

  it('ignores GPS jitter on flat ground', () => {
    const track = buildTrack({ name: 'plat', source: 'gpx', segments: [{ points: line(200, (i) => ({ ele: 1000 + (i % 2 ? 1.5 : -1.5) })) }] })
    expect(cumulativeAscent(track)[199]).toBe(0)
  })

  it('carries the total across segments and over points without elevation', () => {
    const climb = line(50, (i) => ({ ele: 1000 + i * 2 }))
    const gap = line(5, () => ({}))
    const track = buildTrack({ name: 's', source: 'gpx', segments: [{ points: climb }, { points: [...gap, ...climb] }] })
    const ascent = cumulativeAscent(track)
    const first = ascent[49]
    expect(first).toBeGreaterThan(80)
    expect(ascent[50]).toBe(first)
    expect(ascent[54]).toBe(first)
    expect(ascent[ascent.length - 1]).toBeCloseTo(track.stats.ascentM, 6)
  })
})

describe('overlayFrameAt', () => {
  const data = prepareOverlayTrack(sample)

  it('starts at zero', () => {
    const frame = overlayFrameAt(data, 0)
    expect(frame).toMatchObject({ progress: 0, distanceM: 0, ascentM: 0, elapsedS: 0 })
    expect(frame.ele).toBeCloseTo(sample.segments[0].points[0].ele!, 6)
    expect(frame.heartRate).toBeGreaterThan(40)
  })

  it('ends on the whole-track figures', () => {
    const frame = overlayFrameAt(data, 1)
    expect(frame.distanceM).toBeCloseTo(sample.stats.distanceM, 6)
    expect(frame.ascentM).toBeCloseTo(sample.stats.ascentM, 6)
    expect(frame.elapsedS).toBeCloseTo(sample.stats.durationS!, 6)
    expect(data.stats).toMatchObject({ maxEleM: sample.stats.maxEle, durationS: sample.stats.durationS })
    expect(data.stats.maxSpeedKmh).toBeGreaterThan(1)
    expect(data.stats.maxSpeedKmh).toBeLessThan(20)
  })

  it('clamps the progress and interpolates in between', () => {
    expect(overlayFrameAt(data, -1).distanceM).toBe(0)
    expect(overlayFrameAt(data, 2).progress).toBe(1)
    expect(overlayFrameAt(data, Number.NaN).progress).toBe(0)
    const mid = overlayFrameAt(data, 0.5)
    expect(mid.distanceM).toBeCloseTo(sample.stats.distanceM / 2, 6)
    expect(mid.ascentM).toBeGreaterThan(0)
    expect(mid.ascentM).toBeLessThan(sample.stats.ascentM)
    expect(mid.elapsedS).toBeGreaterThan(0)
    expect(mid.speedKmh).toBeGreaterThan(0)
  })

  it('leaves out what the track does not record', () => {
    const bare = buildTrack({ name: 'nu', source: 'gpx', segments: [{ points: line(20, () => ({ time: undefined })) }] })
    const frame = overlayFrameAt(prepareOverlayTrack(bare), 0.5)
    expect(frame.distanceM).toBeGreaterThan(0)
    expect(frame.ele).toBeUndefined()
    expect(frame.ascentM).toBeUndefined()
    expect(frame.elapsedS).toBeUndefined()
    expect(frame.speedKmh).toBeUndefined()
    expect(frame.heartRate).toBeUndefined()
    expect(prepareOverlayTrack(bare).profile).toBeUndefined()
  })

  it('reads the steady speed of a regular track', () => {
    const track = buildTrack({ name: 'r', source: 'gpx', segments: [{ points: line(100, (i) => ({ ele: 1000 + i })) }] })
    expect(overlayFrameAt(prepareOverlayTrack(track), 0.4).speedKmh).toBeCloseTo(7.2, 3)
  })
})

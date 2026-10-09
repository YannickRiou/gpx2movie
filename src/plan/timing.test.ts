import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../core/types'
import { buildTrack } from '../import/stats'
import {
  estimateElapsedS,
  localDayAndTime,
  localDepartureMs,
  localUtcOffsetMin,
  planActivityOf,
  stretchHours,
  withEstimatedTimes,
  withoutTimes,
} from './timing'

/** metres per degree of latitude along a meridian (R = 6371008.8 m, as `haversineM`) */
const M_PER_DEG = (6371008.8 * Math.PI) / 180
const HOUR_S = 3600

/** `count` steps due north over `distanceM`, elevation linear from `fromEle` to `toEle` (none when undefined). */
function northward(distanceM: number, fromEle?: number, toEle?: number, count = 20): TrackPoint[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const point: TrackPoint = { lon: 6.8, lat: 45 + (i / count) * (distanceM / M_PER_DEG) }
    if (fromEle !== undefined && toEle !== undefined) point.ele = fromEle + (i / count) * (toEle - fromEle)
    return point
  })
}

const totalS = (points: TrackPoint[], activity: 'hiking' | 'trail' | 'cycling', pace = 1) =>
  estimateElapsedS([{ points }], activity, pace)[0].at(-1)!

describe('stretchHours', () => {
  it('follows DIN 33466 for hiking', () => {
    expect(stretchHours('hiking', 4000, 0, 0)).toBeCloseTo(1)
    expect(stretchHours('hiking', 0, 1000, 0)).toBeCloseTo(10 / 3) // 3 h 20
    expect(stretchHours('hiking', 0, 0, 500)).toBeCloseTo(1)
    // 10 km and 1000 m up: 3 h 20 vertical + half of 2 h 30 horizontal
    expect(stretchHours('hiking', 10_000, 1000, 0)).toBeCloseTo(10 / 3 + 1.25)
  })

  it('counts effort kilometres for trail and adds the climb for cycling', () => {
    expect(stretchHours('trail', 10_000, 500, 500)).toBeCloseTo(15 / 8)
    expect(stretchHours('cycling', 40_000, 1200, 1200)).toBeCloseTo(4)
  })
})

describe('estimateElapsedS', () => {
  it('gives an hour for 4 km on the flat, and the section time on a steady climb', () => {
    expect(totalS(northward(4000, 500, 500), 'hiking')).toBeCloseTo(HOUR_S, 0)
    expect(totalS(northward(10_000, 1000, 2000), 'hiking')).toBeCloseTo((10 / 3 + 1.25) * HOUR_S, 0)
    expect(totalS(northward(2000, 1500, 1000), 'hiking')).toBeCloseTo(1.25 * HOUR_S, 0)
  })

  it('applies the pace and treats a route without elevation as flat', () => {
    expect(totalS(northward(4000), 'hiking', 1.2)).toBeCloseTo(1.2 * HOUR_S, 0)
    expect(totalS(northward(20_000), 'cycling')).toBeCloseTo(HOUR_S, 0)
  })

  it('starts at 0, grows along the route, and spends no time between segments', () => {
    const first = northward(4000, 500, 500)
    const second = northward(4000, 500, 500).map((p) => ({ ...p, lon: 7 }))
    const [a, b] = estimateElapsedS([{ points: first }, { points: second }], 'hiking', 1)
    expect(a[0]).toBe(0)
    expect(a.every((t, i) => i === 0 || t > a[i - 1])).toBe(true)
    expect(b[0]).toBe(a.at(-1))
    expect(b.at(-1)).toBeCloseTo(2 * HOUR_S, 0)
  })
})

describe('withEstimatedTimes / withoutTimes', () => {
  const planned = buildTrack({ name: 'Lac Blanc', source: 'gpx', segments: [{ points: northward(4000, 1000, 1000) }] })
  const departureMs = Date.UTC(2026, 9, 10, 6)
  const timed = withEstimatedTimes(planned, { activity: 'hiking', pace: 1, departureMs, utcOffsetMin: 120 })

  it('writes the times, the stats and the flag without touching the planned track', () => {
    const points = timed.segments[0].points
    expect(points[0].time).toBe(departureMs)
    expect(points.at(-1)!.time! - departureMs).toBeCloseTo(HOUR_S * 1000, -3)
    expect(timed.stats.startTime).toBe(departureMs)
    expect(timed.stats.durationS).toBeCloseTo(HOUR_S, 0)
    expect(timed).toMatchObject({ id: planned.id, timesEstimated: true, utcOffsetMin: 120 })
    expect(planned.segments[0].points[0].time).toBeUndefined()
  })

  it('restores the untimed track', () => {
    const cleared = withoutTimes(timed)
    expect(cleared.segments).toEqual(planned.segments)
    expect(cleared.stats).toEqual(planned.stats)
    expect(cleared).not.toHaveProperty('timesEstimated')
    expect(cleared).not.toHaveProperty('utcOffsetMin')
  })
})

describe('planActivityOf', () => {
  it('reads GPX types and FIT sports, hiking by default', () => {
    expect(planActivityOf('running')).toBe('trail')
    expect(planActivityOf('Trail')).toBe('trail')
    expect(planActivityOf('cycling')).toBe('cycling')
    expect(planActivityOf('mountain_biking')).toBe('cycling')
    expect(planActivityOf('Vélo')).toBe('cycling')
    expect(planActivityOf('hiking')).toBe('hiking')
    expect(planActivityOf(undefined)).toBe('hiking')
  })
})

describe('localDepartureMs', () => {
  it('reads the date and time on the device clock', () => {
    const ms = localDepartureMs('2026-10-10', '08:30')
    expect(ms).toBe(new Date(2026, 9, 10, 8, 30).getTime())
    expect(localUtcOffsetMin(ms!)).toBe(-new Date(ms!).getTimezoneOffset() || 0)
    expect(localDayAndTime(ms!)).toEqual({ day: '2026-10-10', time: '08:30' })
    expect(localDepartureMs('', '08:30')).toBeUndefined()
    expect(localDepartureMs('2026-10-10', '8h')).toBeUndefined()
  })
})

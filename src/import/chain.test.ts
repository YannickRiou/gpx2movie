import { describe, expect, it } from 'vitest'
import type { Track, TrackPoint } from '../core/types'
import { CHAIN_OFFER_MAX_GAP_MS, chainName, chainOrder, chainTracks, followEachOther, replaceByChain } from './chain'
import { buildTrack, computeStats } from './stats'

const HOUR = 3600 * 1000
const DAY1 = Date.UTC(2026, 6, 1, 8)

/** A short eastward line of 3 points at `lat`, timed from `startMs` (one point every 10 min) unless null. */
function line(lat: number, startMs: number | null): TrackPoint[] {
  return [0, 1, 2].map((i) => ({
    lon: 6.8 + i * 0.01,
    lat,
    ele: 1000 + i * 50,
    ...(startMs === null ? {} : { time: startMs + i * 10 * 60 * 1000 }),
  }))
}

function track(name: string, lat: number, startMs: number | null, extra: Partial<Track> = {}): Track {
  return { ...buildTrack({ name, source: 'gpx', segments: [{ points: line(lat, startMs) }] }), color: '#FF5A36', ...extra }
}

describe('chainOrder', () => {
  it('orders timed tracks by start time', () => {
    const day2 = track('J2', 45.1, DAY1 + 24 * HOUR)
    const day1 = track('J1', 45.0, DAY1)
    expect(chainOrder([day2, day1])).toEqual([day1, day2])
  })

  it('keeps the list order when a track has no time', () => {
    const day2 = track('J2', 45.1, DAY1 + 24 * HOUR)
    const untimed = track('J1', 45.0, null)
    expect(chainOrder([day2, untimed])).toEqual([day2, untimed])
  })
})

describe('chainName', () => {
  it('keeps the common words of the names', () => {
    expect(chainName(['Tour du Mont-Blanc J1', 'Tour du Mont-Blanc J2', 'Tour du Mont-Blanc J3'])).toBe('Tour du Mont-Blanc')
    expect(chainName(['tmb-j1', 'tmb-j2'])).toBe('tmb')
    expect(chainName(['Morning Hike', 'Morning Hike (2)'])).toBe('Morning Hike')
  })

  it('falls back to « first → last » without a meaningful prefix', () => {
    expect(chainName(['Chamonix', 'Courmayeur', 'Champex'])).toBe('Chamonix → Champex')
    expect(chainName(['2026-07-01', '2026-07-02'])).toBe('2026-07-01 → 2026-07-02')
  })
})

describe('chainTracks', () => {
  it('keeps each source track as its own segments, in time order, with recomputed stats and a new id', () => {
    const day1 = track('TMB J1', 45.0, DAY1)
    const day2 = { ...track('TMB J2', 45.1, DAY1 + 24 * HOUR), segments: [{ points: line(45.1, DAY1 + 24 * HOUR) }, { points: line(45.2, DAY1 + 26 * HOUR) }] }
    const chained = chainTracks([day2, day1])

    expect(chained.segments).toEqual([...day1.segments, ...day2.segments])
    expect(chained.id).not.toBe(day1.id)
    expect(chained.id).not.toBe(day2.id)
    expect(chained.name).toBe('TMB')
    expect(chained.color).toBe(day1.color)
    expect(chained.stats).toEqual(computeStats(chained.segments))
    // the jumps between recordings add no distance
    expect(chained.stats.distanceM).toBeCloseTo(day1.stats.distanceM + computeStats(day2.segments).distanceM, 6)
    expect(chained.stats.startTime).toBe(DAY1)
    expect(chained.bounds.south).toBe(45.0)
    expect(chained.bounds.north).toBe(45.2)
  })

  it('chains a timed and an untimed track in list order', () => {
    const untimed = track('Matin', 45.1, null)
    const timed = track('Soir', 45.0, DAY1)
    const chained = chainTracks([untimed, timed])
    expect(chained.segments).toEqual([...untimed.segments, ...timed.segments])
    expect(chained.name).toBe('Matin → Soir')
  })

  it('refuses recordings that overlap in time', () => {
    const a = track('Moi', 45.0, DAY1)
    const b = track('Ami', 45.0, DAY1 + 5 * 60 * 1000)
    expect(() => chainTracks([a, b])).toThrow(/en même temps/)
  })

  it('refuses a single track', () => {
    expect(() => chainTracks([track('Seule', 45.0, DAY1)])).toThrow(/deux traces/)
  })

  it('keeps the waypoints of every track and the clock offset of the first', () => {
    const day1 = track('J1', 45.0, DAY1, { waypoints: [{ lon: 6.8, lat: 45, name: 'Refuge' }], utcOffsetMin: 120 })
    const day2 = track('J2', 45.1, DAY1 + 24 * HOUR, { waypoints: [{ lon: 6.9, lat: 45.1, name: 'Col' }] })
    const chained = chainTracks([day1, day2])
    expect(chained.waypoints?.map((w) => w.name)).toEqual(['Refuge', 'Col'])
    expect(chained.utcOffsetMin).toBe(120)
  })
})

describe('replaceByChain', () => {
  it('puts the chained track at the place of the first replaced one', () => {
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((name, i) => track(name, 45 + i * 0.1, DAY1 + i * HOUR))
    const merged = track('B → D', 45, DAY1)
    expect(replaceByChain([a, b, c, d], [d, b], merged)).toEqual([a, merged, c])
  })
})

describe('followEachOther', () => {
  it('is true for timed tracks that follow each other within a day, in any order', () => {
    const day1 = track('J1', 45.0, DAY1)
    const day2 = track('J2', 45.1, DAY1 + 23 * HOUR)
    expect(followEachOther([day2, day1])).toBe(true)
  })

  it('is false for overlapping, distant, untimed or single tracks', () => {
    const day1 = track('J1', 45.0, DAY1)
    expect(followEachOther([day1, track('Ami', 45.0, DAY1 + 60 * 1000)])).toBe(false)
    expect(followEachOther([day1, track('Plus tard', 45.0, DAY1 + HOUR + CHAIN_OFFER_MAX_GAP_MS)])).toBe(false)
    expect(followEachOther([day1, track('Sans heure', 45.0, null)])).toBe(false)
    expect(followEachOther([day1])).toBe(false)
  })
})

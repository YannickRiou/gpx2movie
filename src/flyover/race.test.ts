import { describe, expect, it } from 'vitest'
import type { TrackPoint } from '../core/types'
import { buildTrack } from '../import/stats'
import { buildTrackPath, trackPathOf } from './path'
import {
  arrivalTime,
  buildRace,
  isValidRace,
  positionAtDistance,
  positionAtTime,
  prepareRaceTrack,
  raceAt,
  raceTrackOf,
  rankRacers,
} from './race'
import type { RaceSync, RaceTrack, Racer } from './race'
import { smoothedTrackPath } from './smooth'

const T0 = Date.UTC(2025, 6, 14, 8, 0, 0)
const MIN = 60_000

/**
 * Straight route of `n` points eastwards (0.001° ≈ 78 m apart), the same for every track; `times[i]` is the
 * recorded time of point i (undefined = no time).
 */
function route(times: readonly (number | undefined)[]): RaceTrack {
  const points: TrackPoint[] = times.map((time, i) => {
    const p: TrackPoint = { lon: 6.8 + i * 0.001, lat: 45.9, ele: 1000 + i * 10 }
    if (time !== undefined) p.time = time
    return p
  })
  return prepareRaceTrack(buildTrackPath(buildTrack({ name: 't', source: 'gpx', segments: [{ points }] })))
}

/** n points, one every `stepMs`, from `startMs`. */
function steady(n: number, startMs: number, stepMs: number): RaceTrack {
  return route(Array.from({ length: n }, (_, i) => startMs + i * stepMs))
}

const untimed = (n: number) => route(Array.from({ length: n }, () => undefined))

function racer(racers: Racer[], index: number): Racer {
  const r = racers.find((x) => x.index === index)
  if (!r) throw new Error(`racer ${index} absent`)
  return r
}

describe('prepareRaceTrack', () => {
  it('keeps recorded times and spans the recording', () => {
    const t = steady(5, T0, MIN)
    expect(Array.from(t.times!)).toEqual([T0, T0 + MIN, T0 + 2 * MIN, T0 + 3 * MIN, T0 + 4 * MIN])
    expect(t.startMs).toBe(T0)
    expect(t.endMs).toBe(T0 + 4 * MIN)
  })

  it('bridges points without time by distance and copies the only side at the ends', () => {
    const t = route([undefined, T0, undefined, T0 + 2 * MIN, undefined])
    const times = Array.from(t.times!)
    expect(times[0]).toBe(T0)
    expect(times[2]).toBeCloseTo(T0 + MIN, -1)
    expect(times[4]).toBe(T0 + 2 * MIN)
  })

  it('makes the times non-decreasing against clock glitches', () => {
    const t = route([T0, T0 + 2 * MIN, T0 + MIN, T0 + 3 * MIN])
    expect(Array.from(t.times!)).toEqual([T0, T0 + 2 * MIN, T0 + 2 * MIN, T0 + 3 * MIN])
  })

  it('has no time table without at least two distinct times', () => {
    expect(untimed(4).times).toBeNull()
    expect(route([undefined, T0, undefined]).times).toBeNull()
    expect(route([T0, T0, T0]).times).toBeNull()
    expect(Number.isNaN(untimed(3).startMs)).toBe(true)
  })

  it('caches per track object', () => {
    const track = buildTrack({ name: 'x', source: 'gpx', segments: [{ points: [{ lon: 6, lat: 45 }, { lon: 6.01, lat: 45 }] }] })
    expect(raceTrackOf(track, 0)).toBe(raceTrackOf(track, 0))
  })

  it('follows the smoothed line, recorded distances kept, cached per smoothing value', () => {
    // zigzag eastwards: the smoothing pulls the inner points towards the middle line
    const points: TrackPoint[] = Array.from({ length: 12 }, (_, i) => ({
      lon: 6.8 + i * 0.001,
      lat: 45.9 + (i % 2) * 0.0005,
      time: T0 + i * MIN,
    }))
    const track = buildTrack({ name: 'z', source: 'gpx', segments: [{ points }] })
    const recorded = raceTrackOf(track, 0)
    expect(recorded.path).toBe(trackPathOf(track))
    const smoothed = raceTrackOf(track, 200)
    expect(smoothed).not.toBe(recorded)
    expect(raceTrackOf(track, 200)).toBe(smoothed)
    expect(Array.from(smoothed.path.lat)).toEqual(Array.from(smoothedTrackPath(track, 200).lat))
    expect(smoothed.path.lat[5]).not.toBeCloseTo(recorded.path.lat[5], 6)
    expect(smoothed.path.dist).toBe(recorded.path.dist)
    expect(smoothed.startMs).toBe(T0)
    expect(raceTrackOf(track, 0).path).toBe(trackPathOf(track))
  })
})

describe('positionAtTime / arrivalTime', () => {
  // moves 2 min, stops 10 min (point 3 at the same place as point 2), moves again
  const stopTrack = (() => {
    const pts: TrackPoint[] = [0, 1, 2, 2, 3].map((k, i) => ({
      lon: 6.8 + k * 0.001,
      lat: 45.9,
      time: [T0, T0 + MIN, T0 + 2 * MIN, T0 + 12 * MIN, T0 + 13 * MIN][i],
    }))
    return prepareRaceTrack(buildTrackPath(buildTrack({ name: 's', source: 'gpx', segments: [{ points: pts }] })))
  })()

  it('interpolates linearly in time between two points', () => {
    const t = steady(3, T0, MIN)
    const mid = positionAtTime(t, T0 + MIN / 2)
    expect(mid.lon).toBeCloseTo(6.8005, 9)
    expect(mid.distanceM).toBeCloseTo(t.path.dist[1] / 2, 6)
    expect(mid.ele).toBeCloseTo(1005, 6)
  })

  it('holds the position during a stop', () => {
    const d = stopTrack.path.dist[2]
    for (const minutes of [2, 5, 9, 12]) expect(positionAtTime(stopTrack, T0 + minutes * MIN).distanceM).toBeCloseTo(d, 6)
    expect(positionAtTime(stopTrack, T0 + 12.5 * MIN).distanceM).toBeGreaterThan(d)
  })

  it('clamps before the start and after the end', () => {
    const t = steady(4, T0, MIN)
    expect(positionAtTime(t, T0 - 3600_000)).toEqual(positionAtTime(t, T0))
    expect(positionAtTime(t, T0 + 99 * MIN).distanceM).toBeCloseTo(t.path.lengthM, 6)
    expect(positionAtTime(t, T0 + 99 * MIN).lon).toBeCloseTo(6.803, 9)
  })

  it('arrivalTime is the first arrival (start of a stop) and inverts positionAtTime while moving', () => {
    expect(arrivalTime(stopTrack, stopTrack.path.dist[2])).toBe(T0 + 2 * MIN)
    const t = steady(5, T0, MIN)
    for (const minutes of [0, 0.3, 1.7, 3.9, 4]) {
      const d = positionAtTime(t, T0 + minutes * MIN).distanceM
      expect(arrivalTime(t, d)).toBeCloseTo(T0 + minutes * MIN, -1)
    }
    expect(arrivalTime(t, -10)).toBe(T0)
    expect(arrivalTime(t, 1e9)).toBe(T0 + 4 * MIN)
  })

  it('refuses an untimed track', () => {
    expect(() => positionAtTime(untimed(3), T0)).toThrow(RangeError)
    expect(() => arrivalTime(untimed(3), 0)).toThrow(RangeError)
  })

  it('positionAtDistance clamps to the track', () => {
    const t = steady(3, T0, MIN)
    expect(positionAtDistance(t, -5)).toMatchObject({ lon: 6.8, distanceM: 0 })
    expect(positionAtDistance(t, 1e9).distanceM).toBe(t.path.lengthM)
  })
})

describe('buildRace', () => {
  it('keeps the time modes when every track is timed', () => {
    const race = buildRace([steady(3, T0, MIN), steady(3, T0, 2 * MIN)], 'clock')
    expect(race).toMatchObject({ sync: 'clock', timed: true })
  })

  it('falls back to distance when a track has no timestamps', () => {
    for (const sync of ['elapsed', 'clock'] as const) {
      expect(buildRace([steady(3, T0, MIN), untimed(3)], sync)).toMatchObject({ sync: 'distance', timed: false })
      expect(buildRace([untimed(3), steady(3, T0, MIN)], sync).sync).toBe('distance')
    }
    expect(buildRace([untimed(3), untimed(3)], 'distance').sync).toBe('distance')
  })

  it('validates the settings', () => {
    expect(isValidRace({ enabled: true, sync: 'clock' })).toBe(true)
    expect(isValidRace({ enabled: true, sync: 'warp' as RaceSync })).toBe(false)
  })
})

describe('raceAt — elapsed', () => {
  // same route, 11 points: lead 10 min, B twice slower (20 min) starting a day later, C twice faster (5 min)
  const lead = steady(11, T0, MIN)
  const slow = steady(11, T0 + 86_400_000, 2 * MIN)
  const fast = steady(11, T0 + 3600_000, MIN / 2)
  const race = buildRace([lead, slow, fast], 'elapsed')

  it('places each track at the same elapsed time since its own start', () => {
    const racers = raceAt(race, 0.5) // lead elapsed 5 min
    expect(racers.map((r) => r.index)).toEqual([0, 1, 2])
    expect(racer(racers, 0).fraction).toBe(0.5)
    expect(racer(racers, 1).fraction).toBeCloseTo(0.25, 9)
    expect(racer(racers, 2).fraction).toBe(1)
    expect(racer(racers, 2).finished).toBe(true)
    expect(racer(racers, 1).finished).toBe(false)
  })

  it('gives the live time gap: positive behind, negative ahead', () => {
    const racers = raceAt(race, 0.5)
    // the lead went through B's point (fraction 0.25) at 2.5 min, it is now 5 min
    expect(racer(racers, 1).gapMs).toBeCloseTo(2.5 * MIN, -1)
    // C went through the lead's point (fraction 0.5) at 2.5 min
    expect(racer(racers, 2).gapMs).toBeCloseTo(-2.5 * MIN, -1)
    expect(racer(racers, 0).gapMs).toBeUndefined()
  })

  it('starts everyone together and keeps finished tracks at their end', () => {
    const start = raceAt(race, 0)
    for (const r of start) expect(r.distanceM).toBe(0)
    expect(racer(start, 1).gapMs).toBe(0)
    const end = raceAt(race, 1)
    expect(racer(end, 1).fraction).toBeCloseTo(0.5, 9)
    expect(racer(end, 2).distanceM).toBeCloseTo(fast.path.lengthM, 6)
    // C finished 5 min before the lead
    expect(racer(end, 2).gapMs).toBeCloseTo(-5 * MIN, -1)
  })

  it('holds a racer still during its stop while the gap grows', () => {
    // 6 min stop: points 2 and 3 at the same place
    const pts: TrackPoint[] = [0, 1, 2, 2, 3, 4].map((k, i) => ({
      lon: 6.8 + k * 0.001,
      lat: 45.9,
      time: [T0, T0 + MIN, T0 + 2 * MIN, T0 + 8 * MIN, T0 + 9 * MIN, T0 + 10 * MIN][i],
    }))
    const other = prepareRaceTrack(buildTrackPath(buildTrack({ name: 'p', source: 'gpx', segments: [{ points: pts }] })))
    const leader = steady(5, T0, 2.5 * MIN) // 10 min over the same 4 steps
    const r = buildRace([leader, other], 'elapsed')
    const at = (minutes: number) => racer(raceAt(r, minutes / 10), 1)
    expect(at(3).distanceM).toBeCloseTo(at(7).distanceM, 6)
    expect(at(7).gapMs!).toBeGreaterThan(at(3).gapMs!)
  })
})

describe('raceAt — clock', () => {
  const lead = steady(11, T0, MIN) // 8:00 → 8:10
  const late = steady(11, T0 + 4 * MIN, MIN / 2) // 8:04 → 8:09
  const race = buildRace([lead, late], 'clock')

  it('waits at the start before its first time and stays at the end after its last', () => {
    expect(racer(raceAt(race, 0.2), 1).distanceM).toBe(0) // 8:02
    expect(racer(raceAt(race, 0.6), 1).fraction).toBeCloseTo(0.4, 9) // 8:06 = 2 min after its start
    expect(racer(raceAt(race, 0.95), 1).finished).toBe(true) // 8:09:30
  })

  it('measures the gap in real time', () => {
    // 8:02: late has not started (fraction 0), the lead left its start 2 min ago
    expect(racer(raceAt(race, 0.2), 1).gapMs).toBeCloseTo(2 * MIN, -1)
    // 8:06: late at 0.4, which the lead passed at 8:04
    expect(racer(raceAt(race, 0.6), 1).gapMs).toBeCloseTo(2 * MIN, -1)
    // 8:09:30: late finished at 8:09, the lead will reach the end at 8:10; late passed 0.95 at 8:08:45
    expect(racer(raceAt(race, 0.95), 1).gapMs).toBeCloseTo(-(0.75 * MIN), -1)
  })
})

describe('raceAt — distance', () => {
  it('places every track at the same fraction of its own length, with a distance gap without times', () => {
    const lead = untimed(11)
    const shorter = untimed(6)
    const racers = raceAt(buildRace([lead, shorter], 'elapsed'), 0.5)
    expect(racer(racers, 1).fraction).toBeCloseTo(0.5, 9)
    expect(racer(racers, 1).gapM).toBeCloseTo(shorter.path.lengthM / 2 - lead.path.lengthM / 2, 6)
    expect(racer(racers, 1).gapM!).toBeLessThan(0)
    expect(racer(racers, 1).gapMs).toBeUndefined()
  })

  it('compares the elapsed times at that fraction when the tracks are timed', () => {
    const racers = raceAt(buildRace([steady(11, T0, MIN), steady(11, T0, 2 * MIN)], 'distance'), 0.5)
    expect(racer(racers, 1).fraction).toBeCloseTo(0.5, 9)
    expect(racer(racers, 1).gapMs).toBeCloseTo(5 * MIN, -1)
  })
})

describe('raceAt — general', () => {
  const tracks = [steady(11, T0, MIN), steady(7, T0 + 3 * MIN, 3 * MIN), route([T0, T0 + MIN, T0 + 30 * MIN, T0 + 31 * MIN])]

  it('moves every marker forward only, in every mode', () => {
    for (const sync of ['elapsed', 'clock', 'distance'] as const) {
      const race = buildRace(tracks, sync)
      let previous = raceAt(race, 0)
      for (let i = 1; i <= 200; i++) {
        const current = raceAt(race, i / 200)
        current.forEach((r, k) => expect(r.distanceM).toBeGreaterThanOrEqual(previous[k].distanceM - 1e-9))
        previous = current
      }
    }
  })

  it('clamps the progress and is a pure function of it', () => {
    const race = buildRace(tracks, 'elapsed')
    expect(raceAt(race, -1)).toEqual(raceAt(race, 0))
    expect(raceAt(race, 3)).toEqual(raceAt(race, 1))
    expect(raceAt(race, 0.37)).toEqual(raceAt(race, 0.37))
  })

  it('returns nothing without a lead', () => {
    expect(raceAt(buildRace([], 'elapsed'), 0.5)).toEqual([])
  })
})

describe('rankRacers', () => {
  const base = { lon: 0, lat: 0, distanceM: 0, finished: false }

  it('orders by fraction covered, then by time gap, then track order', () => {
    const racers: Racer[] = [
      { ...base, index: 0, fraction: 0.5 },
      { ...base, index: 1, fraction: 0.25, gapMs: 150_000 },
      { ...base, index: 2, fraction: 1, finished: true, gapMs: -300_000 },
      { ...base, index: 3, fraction: 1, finished: true, gapMs: -600_000 },
      { ...base, index: 4, fraction: 0.5, gapMs: 0 },
    ]
    expect(rankRacers(racers).map((r) => r.index)).toEqual([3, 2, 0, 4, 1])
    expect(racers.map((r) => r.index)).toEqual([0, 1, 2, 3, 4])
  })

  it('orders equal fractions by distance gap (largest first)', () => {
    const racers: Racer[] = [
      { ...base, index: 0, fraction: 0.5 },
      { ...base, index: 1, fraction: 0.5, gapM: -350 },
      { ...base, index: 2, fraction: 0.5, gapM: 120 },
    ]
    expect(rankRacers(racers).map((r) => r.index)).toEqual([2, 0, 1])
  })

  it('ranks a real race', () => {
    const race = buildRace([steady(11, T0, MIN), steady(11, T0, 2 * MIN), steady(11, T0, MIN / 2)], 'elapsed')
    expect(rankRacers(raceAt(race, 0.5)).map((r) => r.index)).toEqual([2, 0, 1])
  })
})

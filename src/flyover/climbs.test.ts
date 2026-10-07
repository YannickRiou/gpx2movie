import { describe, expect, it } from 'vitest'
import sampleGpx from '../../public/samples/tour-du-mont-blanc-j1.gpx?raw'
import type { Track } from '../core/types'
import { parseGpx } from '../import/gpx'
import { buildTrack } from '../import/stats'
import { climbCategory, climbsOf, detectClimbs, turningPoints } from './climbs'

/** Metres per degree of latitude on the haversine sphere (R = 6371008.8 m). */
const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180

/** Track heading north with one point every 10 m; `ele(d)` gives the elevation at distance d (metres). */
function profileTrack(lengthM: number, ele: ((d: number) => number) | null): Track {
  const points = []
  for (let d = 0; d <= lengthM; d += 10) {
    const p: { lon: number; lat: number; ele?: number } = { lon: 6.8, lat: 45.8 + d / M_PER_DEG_LAT }
    if (ele) p.ele = ele(d)
    points.push(p)
  }
  return buildTrack({ name: 'test', source: 'gpx', segments: [{ points }] })
}

/** Piecewise-linear profile from [distance, elevation] knots. */
function piecewise(knots: [number, number][]): (d: number) => number {
  return (d) => {
    for (let i = 1; i < knots.length; i++) {
      const [d0, e0] = knots[i - 1]
      const [d1, e1] = knots[i]
      if (d <= d1) return e0 + ((e1 - e0) * (d - d0)) / (d1 - d0)
    }
    return knots[knots.length - 1][1]
  }
}

/** Deterministic pseudo-random jitter in [-amplitude, amplitude]. */
function jitter(amplitude: number): (d: number) => number {
  return (d) => amplitude * Math.sin(d * 12.9898 + 78.233) * Math.cos(d * 0.37)
}

describe('climbCategory', () => {
  it('maps the climb score to catégorie 4 / 3 / 2 / 1 / HC', () => {
    expect(climbCategory(7_999)).toBeNull()
    expect(climbCategory(8_000)).toBe('4')
    expect(climbCategory(16_000)).toBe('3')
    expect(climbCategory(32_000)).toBe('2')
    expect(climbCategory(64_000)).toBe('1')
    expect(climbCategory(80_000)).toBe('HC')
  })
})

describe('turningPoints', () => {
  it('ignores reversals smaller than the hysteresis', () => {
    expect(turningPoints([0, 5, 2, 20, 15, 30, 10], 10)).toEqual([0, 5, 6])
    expect(turningPoints([3, 3, 3], 10)).toEqual([])
  })
})

describe('detectClimbs', () => {
  const flatClimbFlat = piecewise([
    [0, 1000],
    [1000, 1000],
    [4000, 1180],
    [5000, 1180],
  ])

  it('finds one climb with its ends, gain, gradients and category', () => {
    const [climb, ...rest] = detectClimbs(profileTrack(5000, flatClimbFlat))
    expect(rest).toEqual([])
    expect(climb.startDistM).toBeGreaterThan(900)
    expect(climb.startDistM).toBeLessThan(1100)
    expect(climb.endDistM).toBeGreaterThan(3900)
    expect(climb.endDistM).toBeLessThan(4100)
    expect(climb.gainM).toBeGreaterThan(170)
    expect(climb.gainM).toBeLessThanOrEqual(180)
    expect(climb.avgGradient).toBeCloseTo(0.06, 2)
    expect(climb.maxGradient).toBeCloseTo(0.06, 2)
    expect(climb.score).toBeCloseTo(climb.gainM * 100, 6)
    expect(climb.category).toBe('3')
    expect(climb.topEleM).toBeCloseTo(1180, 0)
    expect(climb.top.lat).toBeCloseTo(45.8 + climb.endDistM / M_PER_DEG_LAT, 6)
  })

  it('is robust to GPS noise on the elevation', () => {
    const noise = jitter(4)
    const climbs = detectClimbs(profileTrack(5000, (d) => flatClimbFlat(d) + noise(d)))
    expect(climbs).toHaveLength(1)
    expect(climbs[0].gainM).toBeGreaterThan(165)
    expect(climbs[0].category).toBe('3')
  })

  it('merges two climbs separated by a small dip, not by a real descent', () => {
    const smallDip = piecewise([
      [0, 1000],
      [2000, 1160],
      [2300, 1140],
      [4300, 1300],
    ])
    expect(detectClimbs(profileTrack(4300, smallDip))).toHaveLength(1)
    const realDescent = piecewise([
      [0, 1000],
      [2000, 1160],
      [3500, 1010],
      [5500, 1170],
    ])
    const climbs = detectClimbs(profileTrack(5500, realDescent))
    expect(climbs).toHaveLength(2)
    expect(climbs[0].endDistM).toBeLessThan(climbs[1].startDistM)
  })

  it('reports the steepest 100 m', () => {
    const wall = piecewise([
      [0, 1000],
      [1000, 1050],
      [1200, 1080],
      [2200, 1130],
    ])
    const [climb] = detectClimbs(profileTrack(2200, wall))
    expect(climb.avgGradient).toBeCloseTo(130 / 2200, 2)
    expect(climb.maxGradient).toBeGreaterThan(0.12)
    expect(climb.maxGradient).toBeLessThanOrEqual(0.15)
  })

  it('drops bumps below the gain, length and gradient thresholds', () => {
    const bump = piecewise([
      [0, 1000],
      [400, 1030],
      [800, 1000],
    ])
    expect(detectClimbs(profileTrack(800, bump))).toEqual([])
    const falseFlat = piecewise([
      [0, 1000],
      [5000, 1075],
    ])
    expect(detectClimbs(profileTrack(5000, falseFlat))).toEqual([])
    expect(detectClimbs(profileTrack(5000, null))).toEqual([])
  })

  it('finds the Col de Voza climb on the bundled sample', () => {
    const track = parseGpx(sampleGpx, 'tour-du-mont-blanc-j1.gpx')[0]
    const climbs = detectClimbs(track)
    expect(climbs).toHaveLength(1)
    expect(climbs[0].startDistM).toBeLessThan(200)
    expect(climbs[0].gainM).toBeGreaterThan(600)
    expect(climbs[0].topEleM).toBeGreaterThan(1640)
    expect(climbs[0].topEleM).toBeLessThan(1670)
    expect(climbs[0].category).toBe('1')
  })
})

describe('climbsOf', () => {
  it('caches the climbs per track object', () => {
    const track = profileTrack(1000, (d) => 1000 + d * 0.1)
    expect(climbsOf(track)).toBe(climbsOf(track))
    expect(climbsOf(track)).toHaveLength(1)
  })
})

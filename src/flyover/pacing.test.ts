import { describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import { buildTrack } from '../import/stats'
import type { Landmark } from '../osm/landmarks'
import { isValidSetting, sanitizeSettings } from '../project/document'
import { buildPacing } from './__fixtures__/pacing'
import { advanceProgress } from './cameraSettings'
import {
  DEFAULT_PACING,
  flightPacing,
  isValidPacing,
  landmarkHighlights,
  MAX_PAUSE_SHARE,
  PACING_RANGES,
  pacingFromHighlights,
  withPacingDefaults,
  PAUSE_EASE_S,
  relativeSpeed,
  SPEED_EASE_S,
} from './pacing'
import type { Pacing, PacingSettings } from './pacing'

const ON: PacingSettings = { ...DEFAULT_PACING, enabled: true }
const L = 10_000
const D = 60

/** Progress every `dt` seconds over the whole film. */
function sampleProgress(pacing: Pacing, dt: number): number[] {
  const out: number[] = []
  const total = pacing.totalTime()
  for (let t = 0; t <= total + dt / 2; t += dt) out.push(pacing.progressAtTime(t))
  return out
}

/** ∫₀ᴸ dx / r(x) by a fine trapezoid, independent of the pacing tables. */
function slowLength(highlights: number[], s: PacingSettings): number {
  const steps = 200_000
  let sum = 0
  for (let i = 0; i <= steps; i++) {
    const w = i === 0 || i === steps ? 0.5 : 1
    sum += w / relativeSpeed((i * L) / steps, highlights, s.slowFactor, s.windowM)
  }
  return (sum * L) / steps
}

/** Checks shared by every pacing: monotonic, continuous, ends, inverse. */
function expectWellFormed(pacing: Pacing, maxRate: number) {
  const total = pacing.totalTime()
  const dt = 0.01
  const p = sampleProgress(pacing, dt)
  expect(p[0]).toBe(pacing.progressAtTime(0))
  expect(pacing.progressAtTime(total)).toBe(1)
  for (let i = 1; i < p.length; i++) {
    expect(p[i]).toBeGreaterThanOrEqual(p[i - 1])
    expect(p[i] - p[i - 1]).toBeLessThanOrEqual(maxRate * dt + 1e-12)
  }
  let previous = -1
  for (let i = 0; i <= 1000; i++) {
    const progress = i / 1000
    const t = pacing.timeAtProgress(progress)
    expect(t).toBeGreaterThanOrEqual(previous)
    previous = t
    expect(pacing.progressAtTime(t)).toBeCloseTo(progress, 9)
  }
  const holds = pacing.pauses
  for (let t = 0; t <= total; t += 0.37) {
    if (holds.some((h) => t > h.holdStartS && t <= h.holdEndS)) continue
    expect(pacing.timeAtProgress(pacing.progressAtTime(t))).toBeCloseTo(t, 6)
  }
}

describe('pacing settings', () => {
  it('defaults are valid, off, and accepted as a project setting', () => {
    expect(DEFAULT_PACING.enabled).toBe(false)
    expect(isValidPacing(DEFAULT_PACING)).toBe(true)
    expect(isValidSetting('pacing', DEFAULT_PACING)).toBe(true)
  })

  it('rejects out-of-range numbers and wrong shapes', () => {
    expect(isValidPacing({ ...DEFAULT_PACING, slowFactor: 0 })).toBe(false)
    expect(isValidPacing({ ...DEFAULT_PACING, windowM: PACING_RANGES.windowM.max + 1 })).toBe(false)
    expect(isValidPacing({ ...DEFAULT_PACING, pauseS: -1 })).toBe(false)
    expect(isValidSetting('pacing', { ...DEFAULT_PACING, pauseS: 99 })).toBe(false)
    expect(isValidSetting('pacing', { enabled: true })).toBe(false)
  })

  it('older projects without pacing load with the default', () => {
    const { settings, invalid } = sanitizeSettings({ flyoverDurationS: 90 })
    expect(settings.pacing).toEqual(DEFAULT_PACING)
    expect(invalid).toEqual([])
  })
})

describe('relativeSpeed', () => {
  it('dips smoothly to the slow factor at a highlight over ±window', () => {
    expect(relativeSpeed(5000, [5000], 0.35, 1000)).toBeCloseTo(0.35, 12)
    expect(relativeSpeed(4000, [5000], 0.35, 1000)).toBe(1)
    expect(relativeSpeed(6500, [5000], 0.35, 1000)).toBe(1)
    expect(relativeSpeed(4500, [5000], 0.35, 1000)).toBeCloseTo(0.675, 12)
    // continuous at the window edge and flat at the bottom
    expect(1 - relativeSpeed(4001, [5000], 0.35, 1000)).toBeLessThan(1e-5)
    expect(relativeSpeed(4999, [5000], 0.35, 1000) - 0.35).toBeLessThan(1e-5)
  })

  it('takes the deepest dip of overlapping windows (no compounding)', () => {
    const r = relativeSpeed(5200, [5000, 5400], 0.35, 1000)
    expect(r).toBeCloseTo(relativeSpeed(5200, [5000], 0.35, 1000), 12)
    for (let x = 3000; x <= 7000; x += 10) expect(relativeSpeed(x, [5000, 5400, 5600], 0.35, 1000)).toBeGreaterThanOrEqual(0.35 - 1e-12)
  })
})

describe('identity pacing', () => {
  const cases: [string, Pacing][] = [
    ['disabled', pacingFromHighlights(L, [5000], D, DEFAULT_PACING)],
    ['no highlight', pacingFromHighlights(L, [], D, ON)],
    ['nothing to do', pacingFromHighlights(L, [5000], D, { ...ON, slowFactor: 1, pauseS: 0 })],
    ['no track', buildPacing({ track: undefined, durationS: D, settings: ON })],
  ]

  it.each(cases)('%s: exactly the constant ground speed', (_, pacing) => {
    expect(pacing.active).toBe(false)
    expect(pacing.totalTime()).toBe(D)
    expect(pacing.pauses).toEqual([])
    expect(pacing.progressAtTime(15)).toBe(0.25)
    expect(pacing.progressAtTime(-1)).toBe(0)
    expect(pacing.progressAtTime(D + 1)).toBe(1)
    expect(pacing.timeAtProgress(0.5)).toBe(30)
    for (const [progress, dt, speed] of [
      [0, 1 / 60, 1],
      [0.3, 0.016, 2],
      [0.99, 1, 4],
      [0.123456, 0.0333, 0.5],
    ]) {
      const next = pacing.advance(pacing.positionAt(progress), dt, speed)
      expect(next.progress).toBe(advanceProgress(progress, dt, speed, D))
    }
  })
})

describe('slow-downs', () => {
  const slow: PacingSettings = { ...ON, pauseS: 0, keepDuration: false }

  it('lengthen the film by the time spent in the dip without keepDuration', () => {
    const pacing = pacingFromHighlights(L, [5000], D, slow)
    expect(pacing.active).toBe(true)
    expect(pacing.pauses).toEqual([])
    const expected = (slowLength([5000], slow) * D) / L
    expect(expected).toBeGreaterThan(D + 1)
    expect(pacing.totalTime()).toBeCloseTo(expected, 3)
    // outside the window: normal speed
    expect(pacing.progressAtTime(10)).toBeCloseTo(10 / D, 9)
    expect(pacing.timeAtProgress(1) - pacing.timeAtProgress(0.6)).toBeCloseTo(0.4 * D, 9)
    expectWellFormed(pacing, 1 / D)
  })

  it('keep the film duration by raising the base speed with keepDuration', () => {
    const pacing = pacingFromHighlights(L, [2000, 7000], D, { ...slow, keepDuration: true })
    expect(pacing.totalTime()).toBeCloseTo(D, 9)
    const scale = D / ((slowLength([2000, 7000], slow) * D) / L)
    // away from the highlights, the speed is the raised base speed
    expect(pacing.progressAtTime(5) / 5).toBeCloseTo(1 / (D * scale), 4)
    expectWellFormed(pacing, 1 / (D * scale) + 1e-6)
  })

  it('reach the slow factor at the highlight', () => {
    const pacing = pacingFromHighlights(L, [5000], D, slow)
    const t = pacing.timeAtProgress(0.5)
    const rate = (pacing.progressAtTime(t + 0.01) - pacing.progressAtTime(t - 0.01)) / 0.02
    expect(rate).toBeCloseTo(0.35 / D, 4)
  })

  it('merge overlapping windows', () => {
    const one = pacingFromHighlights(L, [5000], D, slow).totalTime()
    const merged = pacingFromHighlights(L, [5000, 5300], D, slow).totalTime()
    const apart = pacingFromHighlights(L, [3000, 7000], D, slow).totalTime()
    expect(merged).toBeGreaterThan(one)
    expect(merged - D).toBeLessThan(apart - D)
    expect(apart - D).toBeCloseTo(2 * (one - D), 3)
  })

  it('handle highlights at the very start and end of the track', () => {
    const pacing = pacingFromHighlights(L, [0, L], D, slow)
    const one = pacingFromHighlights(L, [5000], D, slow).totalTime()
    // two half dips = one full dip
    expect(pacing.totalTime()).toBeCloseTo(one, 3)
    expectWellFormed(pacing, 1 / D)
    const near = pacingFromHighlights(L, [-50, L + 200], D, slow)
    expect(near.highlights).toEqual([0, 1])
  })
})

describe('pauses', () => {
  const pauseOnly: PacingSettings = { ...ON, slowFactor: 1, pauseS: 4, keepDuration: false }

  it('hold the progress at the highlight and add exactly pauseS each', () => {
    const pacing = pacingFromHighlights(L, [2500, 7500], D, pauseOnly)
    expect(pacing.totalTime()).toBeCloseTo(D + 8, 9)
    expect(pacing.pauses).toHaveLength(2)
    for (const pause of pacing.pauses) {
      expect(pause.holdEndS - pause.holdStartS).toBeCloseTo(4 - PAUSE_EASE_S, 9)
      for (let t = pause.holdStartS; t <= pause.holdEndS; t += 0.05) expect(pacing.progressAtTime(t)).toBe(pause.progress)
      expect(pacing.progressAtTime(pause.holdStartS - 0.1)).toBeLessThan(pause.progress)
      expect(pacing.progressAtTime(pause.holdEndS + 0.1)).toBeGreaterThan(pause.progress)
      expect(pacing.timeAtProgress(pause.progress)).toBeCloseTo(pause.holdStartS, 9)
    }
    expect(pacing.pauses.map((p) => p.progress)).toEqual([0.25, 0.75])
    expectWellFormed(pacing, 1 / D)
  })

  it('ease in and out: the marker slows to a stop instead of stopping abruptly', () => {
    const pacing = pacingFromHighlights(L, [5000], D, pauseOnly)
    const [pause] = pacing.pauses
    const rate = (t: number) => (pacing.progressAtTime(t + 0.001) - pacing.progressAtTime(t - 0.001)) / 0.002
    expect(rate(pause.holdStartS - PAUSE_EASE_S - 0.5)).toBeCloseTo(1 / D, 6)
    expect(rate(pause.holdStartS - 0.05)).toBeLessThan(0.01 / D)
    expect(rate(pause.holdStartS - PAUSE_EASE_S / 2)).toBeCloseTo(0.5 / D, 3)
    expect(rate(pause.holdEndS + 0.05)).toBeLessThan(0.01 / D)
    expect(rate(pause.holdEndS + PAUSE_EASE_S + 0.5)).toBeCloseTo(1 / D, 6)
  })

  it('are combined with the slow-down', () => {
    const settings: PacingSettings = { ...ON, pauseS: 3, keepDuration: false }
    const pacing = pacingFromHighlights(L, [5000], D, settings)
    expect(pacing.totalTime()).toBeCloseTo((slowLength([5000], settings) * D) / L + 3, 3)
    expectWellFormed(pacing, 1 / D)
  })

  it('pause once per cluster of close highlights, at a highlight', () => {
    const pacing = pacingFromHighlights(L, [4000, 4600, 5100, 8000], D, { ...pauseOnly, windowM: 1000 })
    expect(pacing.pauses.map((p) => p.progress)).toEqual([0.46, 0.8])
    expect(pacing.totalTime()).toBeCloseTo(D + 8, 9)
  })

  it('at the start and the end of the track: hold the first and the last frame', () => {
    const pacing = pacingFromHighlights(L, [0, L], D, pauseOnly)
    expect(pacing.totalTime()).toBeCloseTo(D + 8, 9)
    expect(pacing.progressAtTime(3.9)).toBe(0)
    expect(pacing.progressAtTime(4.1)).toBeGreaterThan(0)
    expect(pacing.progressAtTime(D + 4 - 0.1)).toBeLessThan(1)
    expect(pacing.progressAtTime(D + 4)).toBe(1)
    // the end of the track is the end of the film, after the final pause
    expect(pacing.timeAtProgress(1)).toBe(pacing.totalTime())
    expect(pacing.timeAtProgress(1 - 1e-9)).toBeCloseTo(D + 4, 6)
    expectWellFormed(pacing, 1 / D)
  })

  it('keep the duration: the base speed rises, the pauses take at most half of it', () => {
    const keep = pacingFromHighlights(L, [2500, 7500], D, { ...pauseOnly, keepDuration: true })
    expect(keep.totalTime()).toBeCloseTo(D, 9)
    expect(keep.progressAtTime(5)).toBeCloseTo(5 / (D - 8), 9)

    const many = [1000, 2500, 4000, 5500, 7000, 8500, 9900]
    const capped = pacingFromHighlights(L, many, D, { ...pauseOnly, pauseS: 10, keepDuration: true })
    expect(capped.totalTime()).toBeCloseTo(D, 9)
    const pause = (MAX_PAUSE_SHARE * D) / many.length
    expect(capped.progressAtTime(1)).toBeCloseTo(1 / (D - many.length * pause), 9)
    expectWellFormed(capped, 1 / (D * (1 - MAX_PAUSE_SHARE)) + 1e-9)
  })

  it('shorten the eases when pauses are very close in time', () => {
    // 1000 km in 15 s: neighbouring clusters a few hundredths of a second apart
    const pacing = pacingFromHighlights(1_000_000, [500_000, 501_500, 503_000], 15, { ...pauseOnly, windowM: 1000 })
    expect(pacing.pauses).toHaveLength(3)
    expect(pacing.totalTime()).toBeCloseTo(15 + 12, 9)
    expectWellFormed(pacing, 1 / 15)
  })
})

describe('flight stops (pauses given by the film)', () => {
  const off: PacingSettings = { ...DEFAULT_PACING, keepDuration: false }

  it('equal the automatic pauses when placed at them with pauseS', () => {
    const settings: PacingSettings = { ...ON, pauseS: 3, keepDuration: true }
    const auto = pacingFromHighlights(L, [2500, 7500], D, settings)
    const given = flightPacing(L, [2500, 7500], D, settings, [
      { atM: 2500, durationS: 3 },
      { atM: 7500, durationS: 3 },
    ])
    expect(given.totalTime()).toBeCloseTo(auto.totalTime(), 12)
    expect(given.pauses).toEqual(auto.pauses)
    for (let t = 0; t <= auto.totalTime(); t += 0.7) expect(given.progressAtTime(t)).toBeCloseTo(auto.progressAtTime(t), 12)
  })

  it('hold anywhere on the track, each for its own duration, even with the pacing off', () => {
    const pacing = flightPacing(L, [], D, off, [
      { atM: 1234, durationS: 2 },
      { atM: 6000, durationS: 8 },
    ])
    expect(pacing.active).toBe(true)
    expect(pacing.highlights).toEqual([])
    expect(pacing.totalTime()).toBeCloseTo(D + 10, 9)
    const [a, b] = pacing.pauses
    expect(a.progress).toBeCloseTo(0.1234, 12)
    expect(b.durationS).toBe(8)
    expect(b.holdEndS - b.holdStartS).toBeCloseTo(8 - PAUSE_EASE_S, 9)
    expect(b.endS - b.startS).toBeCloseTo(8 + PAUSE_EASE_S, 9)
    expect(pacing.progressAtTime((a.holdStartS + a.holdEndS) / 2)).toBe(a.progress)
    // away from the stops: the constant ground speed, shifted by the time already added
    expect(pacing.progressAtTime(30)).toBeCloseTo((30 - 2) / D, 9)
    expectWellFormed(pacing, 1 / D)
  })

  it('keep the duration: stops shortened in proportion beyond the share of the film', () => {
    const pacing = flightPacing(L, [], D, { ...off, keepDuration: true }, [
      { atM: 3000, durationS: 30 },
      { atM: 7000, durationS: 10 },
    ])
    expect(pacing.totalTime()).toBeCloseTo(D, 9)
    expect(pacing.pauses.map((p) => p.durationS)).toEqual([22.5, 7.5])
  })

  it('two stops at the same place: one after the other, reached at the first', () => {
    const pacing = flightPacing(L, [], D, off, [
      { atM: 5000, durationS: 2 },
      { atM: 5000, durationS: 3 },
    ])
    expect(pacing.totalTime()).toBeCloseTo(D + 5, 9)
    expect(pacing.timeAtProgress(0.5)).toBeCloseTo(pacing.pauses[0].startS, 9)
    expectWellFormed(pacing, 1 / D)
  })

  it('no stop and no slow-down: the identity', () => {
    expect(flightPacing(L, [5000], D, off, []).active).toBe(false)
    expect(flightPacing(0, [], D, off, [{ atM: 0, durationS: 2 }]).active).toBe(false)
  })
})

describe('speed portions (set by hand on the timeline)', () => {
  const off: PacingSettings = { ...DEFAULT_PACING, keepDuration: false }
  /** film seconds spent over [fromM, toM] flown `factor` times faster, transitions included (fine midpoint sum) */
  const portionS = (fromM: number, toM: number, factor: number) => {
    const ramp = Math.min((SPEED_EASE_S * L) / D, (toM - fromM) / 2)
    const n = 100_000
    let sum = 0
    for (let i = 0; i < n; i++) {
      const x = fromM + ((i + 0.5) * (toM - fromM)) / n
      const edge = Math.min(x - fromM, toM - x)
      const w = edge >= ramp ? 1 : (1 - Math.cos((Math.PI * edge) / ramp)) / 2
      sum += (toM - fromM) / n / factor ** w
    }
    return (sum * D) / L
  }
  /** ground speed (progress per second) every 0.01 s */
  const rates = (pacing: Pacing) => {
    const p = sampleProgress(pacing, 0.01)
    return p.slice(1).map((v, i) => (v - p[i]) / 0.01)
  }

  it('shorten the flight by the time saved over the portion, transitions included', () => {
    const pacing = flightPacing(L, [], D, off, [], [{ fromM: 4000, toM: 6000, factor: 2 }])
    expect(pacing.active).toBe(true)
    expect(pacing.totalTime()).toBeCloseTo((D * 8000) / L + portionS(4000, 6000, 2), 3)
    // twice as fast in the middle of the portion as before it
    const middle = pacing.timeAtProgress(0.5)
    expect(pacing.progressAtTime(middle + 0.1) - pacing.progressAtTime(middle)).toBeCloseTo((2 * 0.1) / D, 9)
    expect(pacing.timeAtProgress(0.4)).toBeCloseTo(0.4 * D, 9)
    expectWellFormed(pacing, 2 / D)
  })

  it('a slower portion lengthens it; keep the duration: the rest of the track adapts', () => {
    const slow = flightPacing(L, [], D, off, [], [{ fromM: 2000, toM: 3000, factor: 0.5 }])
    expect(slow.totalTime()).toBeCloseTo((D * 9000) / L + portionS(2000, 3000, 0.5), 3)
    const kept = flightPacing(L, [], D, { ...off, keepDuration: true }, [], [{ fromM: 2000, toM: 3000, factor: 0.5 }])
    expect(kept.totalTime()).toBeCloseTo(D, 9)
    const scale = D / slow.totalTime()
    expect(kept.progressAtTime(10.1) - kept.progressAtTime(10)).toBeCloseTo(0.1 / D / scale, 9)
    expectWellFormed(kept, 1 / D / scale)
  })

  it('speed changes smoothly at both edges (no jump), even at ×4', () => {
    for (const factor of [4, 0.25]) {
      const v = rates(flightPacing(L, [], D, off, [], [{ fromM: 3000, toM: 7000, factor }]))
      let worst = 1
      for (let i = 1; i < v.length - 1; i++) if (v[i] > 0 && v[i - 1] > 0) worst = Math.max(worst, v[i] / v[i - 1], v[i - 1] / v[i])
      expect(worst).toBeLessThan(1.08)
      expect(Math.max(...v) / Math.min(...v.slice(0, -1))).toBeCloseTo(4, 1)
    }
  })

  it('combine with the stops and the slow-downs at the highlights', () => {
    const speeds = [{ fromM: 4000, toM: 6000, factor: 2 }]
    const stopped = flightPacing(L, [], D, off, [{ atM: 5000, durationS: 3 }], speeds)
    expect(stopped.totalTime()).toBeCloseTo(flightPacing(L, [], D, off, [], speeds).totalTime() + 3, 9)
    const [pause] = stopped.pauses
    expect(pause.durationS).toBe(3)
    expect(stopped.progressAtTime((pause.holdStartS + pause.holdEndS) / 2)).toBe(0.5)
    expectWellFormed(stopped, 2 / D)
    const slowed = flightPacing(L, [5000], D, { ...ON, keepDuration: false }, [], speeds)
    const highlightOnly = flightPacing(L, [5000], D, { ...ON, keepDuration: false }, [], [])
    expect(slowed.totalTime()).toBeLessThan(highlightOnly.totalTime())
    expectWellFormed(slowed, 2 / D)
  })

  it('×1, empty or off-track portions change nothing; portions are clipped to the track', () => {
    expect(flightPacing(L, [], D, off, [], [{ fromM: 1000, toM: 2000, factor: 1 }]).active).toBe(false)
    expect(flightPacing(L, [], D, off, [], [{ fromM: L + 10, toM: L + 500, factor: 2 }]).active).toBe(false)
    const clipped = flightPacing(L, [], D, off, [], [{ fromM: 9000, toM: L + 5000, factor: 2 }])
    expect(clipped.totalTime()).toBeCloseTo((D * 9000) / L + portionS(9000, L, 2), 3)
  })
})

describe('advance', () => {
  it('plays through slow-downs and pauses without getting stuck and ends at the total time', () => {
    const pacing = pacingFromHighlights(L, [0, 3000, 5000, L], D, { ...ON, pauseS: 2 })
    const fps = 60
    let position = pacing.positionAt(0)
    let frames = 0
    while (position.timeS < pacing.totalTime() && frames < 100_000) {
      position = pacing.advance(position, 1 / fps, 1)
      frames++
    }
    expect(position.progress).toBe(1)
    // the last pause (at the end) is played too: the film ends at the total time, not when the progress reaches 1
    expect(frames / fps).toBeCloseTo(pacing.totalTime(), 1)
    expect(pacing.positionAt(1)).toEqual({ timeS: pacing.totalTime(), progress: 1 })
  })

  it('scales with the playback speed and resumes from a scrubbed progress', () => {
    const pacing = pacingFromHighlights(L, [5000], D, { ...ON, keepDuration: false })
    const from = pacing.positionAt(0.2)
    expect(from.timeS).toBeCloseTo(12, 9)
    const twice = pacing.advance(from, 0.5, 2)
    expect(twice.timeS).toBeCloseTo(13, 9)
    expect(twice.progress).toBeCloseTo(pacing.progressAtTime(13), 12)
    expect(pacing.advance(from, 1000, 1)).toEqual({ timeS: pacing.totalTime(), progress: 1 })
  })
})

// ---------------------------------------------------------------------------
// Highlights of a track
// ---------------------------------------------------------------------------

const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180

/** 5 km heading north: flat, a 200 m climb from 1 km to 3 km, flat. */
function climbTrack(): Track {
  const points = []
  for (let d = 0; d <= 5000; d += 10) {
    const ele = d < 1000 ? 1000 : d < 3000 ? 1000 + ((d - 1000) / 2000) * 200 : 1200
    points.push({ lon: 6.8, lat: 45.8 + d / M_PER_DEG_LAT, ele })
  }
  return buildTrack({ name: 'test', source: 'gpx', segments: [{ points }] })
}

function landmark(kind: Landmark['kind'], alongM: number, distanceM: number): Landmark {
  return { id: `node/${alongM}`, kind, name: kind, lon: 6.8, lat: 45.8, distanceM, alongM, priority: 10, text: kind }
}

describe('highlights', () => {
  const landmarks = [
    landmark('pass', 1500, 50),
    landmark('pass', 2000, 400),
    landmark('peak', 3500, 250),
    landmark('peak', 4000, 500),
    landmark('hut', 4500, 0),
  ]

  it('landmarks: passes crossed and peaks next to the track only', () => {
    expect(landmarkHighlights(landmarks)).toEqual([1500, 3500])
  })

  it('come from the climb tops and the landmarks, as enabled', () => {
    const track = climbTrack()
    const L5 = track.stats.distanceM
    const both = buildPacing({ track, durationS: D, settings: ON, landmarks })
    expect(both.highlights).toHaveLength(3)
    expect(both.highlights[0]).toBeCloseTo(1500 / L5, 9)
    expect(both.highlights[1] * L5).toBeGreaterThan(2800)
    expect(both.highlights[1] * L5).toBeLessThan(3100)
    expect(both.highlights[2]).toBeCloseTo(3500 / L5, 9)

    expect(buildPacing({ track, durationS: D, settings: { ...ON, landmarks: false }, landmarks }).highlights).toHaveLength(1)
    expect(buildPacing({ track, durationS: D, settings: { ...ON, climbs: false }, landmarks }).highlights).toHaveLength(2)
    expect(buildPacing({ track, durationS: D, settings: { ...ON, climbs: false } }).active).toBe(false)
    expect(buildPacing({ track, durationS: D, settings: DEFAULT_PACING, landmarks }).active).toBe(false)
    expect(both.totalTime()).toBeCloseTo(D, 9)
  })
})

describe('transitionS', () => {
  it('sets the ease into and out of a pause; older projects keep 1.5 s', () => {
    const at = (transitionS: number) =>
      pacingFromHighlights(10_000, [5000], 60, { ...DEFAULT_PACING, enabled: true, slowFactor: 1, pauseS: 4, keepDuration: false, transitionS })
    const pause = (transitionS: number) => at(transitionS).pauses[0]
    expect(pause(1.5).holdEndS - pause(1.5).holdStartS).toBeCloseTo(4 - 1.5, 9)
    expect(pause(3).holdEndS - pause(3).holdStartS).toBeCloseTo(4 - 3, 9)
    expect(withPacingDefaults({ enabled: true })).toMatchObject({ enabled: true, transitionS: PAUSE_EASE_S })
    expect(isValidPacing({ ...DEFAULT_PACING, transitionS: 10 })).toBe(false)
  })
})

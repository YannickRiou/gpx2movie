import { afterEach, describe, expect, it } from 'vitest'
import type { FilmClock } from '../film/clock'
import {
  DEFAULT_LENS,
  SHUTTER_SUBFRAMES,
  bloomParams,
  depthOfFieldParams,
  isValidLens,
  lensActive,
  previewShutterWeight,
  radialBlurLength,
  sameShot,
  setShutterSubFrame,
  shutterSamples,
  shutterSubFrame,
  subFrameSlices,
} from './lens'

describe('setting', () => {
  it('every effect is off by default: no composer is needed', () => {
    expect(isValidLens(DEFAULT_LENS)).toBe(true)
    expect(lensActive(DEFAULT_LENS, true)).toBe(false)
    expect(lensActive(DEFAULT_LENS, false)).toBe(false)
  })

  it('the flare needs the atmosphere, the other effects do not', () => {
    expect(lensActive({ ...DEFAULT_LENS, flare: 0.5 }, true)).toBe(true)
    expect(lensActive({ ...DEFAULT_LENS, flare: 0.5 }, false)).toBe(false)
    for (const key of ['shutter', 'bloom', 'depthOfField'] as const) expect(lensActive({ ...DEFAULT_LENS, [key]: 0.5 }, false), key).toBe(true)
  })

  it('rejects values out of range', () => {
    expect(isValidLens({ ...DEFAULT_LENS, shutter: 1.5 })).toBe(false)
    expect(isValidLens({ ...DEFAULT_LENS, depthOfField: -0.1 })).toBe(false)
  })
})

describe('effect parameters', () => {
  it('bloom grows with the amount, its radius stays inside the mipmap blur range', () => {
    expect(bloomParams(0, 0.6).intensity).toBe(0)
    expect(bloomParams(1, 0.6).intensity).toBeGreaterThan(bloomParams(0.5, 0.6).intensity)
    expect(bloomParams(1, 0).radius).toBeGreaterThan(0)
    expect(bloomParams(1, 1).radius).toBeLessThan(1)
  })

  it('depth of field: a stronger setting blurs more and narrows the sharp zone, which follows the focus distance', () => {
    const weak = depthOfFieldParams(0.2, 1000)
    const strong = depthOfFieldParams(1, 1000)
    expect(strong.bokehScale).toBeGreaterThan(weak.bokehScale)
    expect(strong.focusRange).toBeLessThan(weak.focusRange)
    expect(depthOfFieldParams(1, 2000).focusRange).toBeCloseTo(2 * strong.focusRange)
  })
})

describe('shutterSamples', () => {
  const times = [0, 0, 1, 2, 3, 3]
  const progress = [0, 0, 0.1, 0.2, 0.3, 0.3]

  it('a closed shutter or a single render gives the frame itself, exactly', () => {
    expect(shutterSamples(times, progress, 2, 0, SHUTTER_SUBFRAMES)).toEqual([{ progress: 0.1, timeS: 1 }])
    expect(shutterSamples(times, progress, 2, 0.6, 1)).toEqual([{ progress: 0.1, timeS: 1 }])
  })

  it('spreads the renders over the open shutter, centred on the frame', () => {
    const samples = shutterSamples(times, progress, 3, 1, 4)
    expect(samples.map((s) => s.timeS)).toEqual([1.625, 1.875, 2.125, 2.375])
    expect(samples[0].progress).toBeCloseTo(0.1625)
    const mean = samples.reduce((sum, s) => sum + s.timeS, 0) / samples.length
    expect(mean).toBeCloseTo(2)
    // a half-open shutter covers half the interval
    const half = shutterSamples(times, progress, 3, 0.5, 4).map((s) => s.timeS)
    expect(half[3] - half[0]).toBeCloseTo((1 - 1 / 4) / 2)
  })

  it('held frames do not move, the film ends are clamped', () => {
    expect(new Set(shutterSamples(times, progress, 0, 1, 4).map((s) => s.progress))).toEqual(new Set([0]))
    expect(shutterSamples(times, progress, 5, 1, 4).every((s) => s.progress === 0.3)).toBe(true)
  })

  it('an instant rejected (other side of a cut) is replaced by the frame itself', () => {
    const samples = shutterSamples(times, progress, 3, 1, 4, (t) => t <= 2)
    expect(samples.slice(2)).toEqual([
      { progress: 0.2, timeS: 2 },
      { progress: 0.2, timeS: 2 },
    ])
  })
})

describe('preview trail', () => {
  it('lags like the centre of the open shutter, whatever the preview frame rate', () => {
    for (const deltaS of [1 / 60, 1 / 30, 1 / 15]) {
      const w = previewShutterWeight(1, 30, deltaS)
      expect((deltaS * w) / (1 - w)).toBeCloseTo(1 / 60)
    }
    expect(previewShutterWeight(0, 30, 1 / 60)).toBe(0)
    expect(previewShutterWeight(1, 30, 0)).toBe(0)
  })
})

describe('radial speed blur', () => {
  it('grows with the speed of the camera relative to its aim distance, capped, none when still', () => {
    const slow = radialBlurLength(1, 5, 1000, 1 / 30)
    const fast = radialBlurLength(1, 15, 1000, 1 / 30)
    expect(fast).toBeCloseTo(3 * slow)
    expect(radialBlurLength(1, 15, 3000, 1 / 30)).toBeCloseTo(slow)
    expect(radialBlurLength(1, 1000, 1000, 1 / 30)).toBe(0.15)
    expect(radialBlurLength(1, 0.1, 1000, 1 / 30)).toBe(0)
    expect(radialBlurLength(0.5, 15, 1000, 1 / 30)).toBeCloseTo(fast / 2)
    expect(radialBlurLength(0, 15, 1000, 1 / 30)).toBe(0)
    // a jump longer than the aim distance is a cut: no blur on that frame
    expect(radialBlurLength(1, 1500, 1000, 1 / 30)).toBe(0)
  })

  it('a shot stops at a phase change and at a stage cut « À la suite »', () => {
    const clock = {
      stateAt: (t: number) => ({ phase: t < 2 ? 'opening' : 'flight' }),
      cuts: [{ atM: 1000, timeS: 10 }],
    } as unknown as FilmClock
    expect(sameShot(clock, 3, 9)).toBe(true)
    expect(sameShot(clock, 1.9, 2.1)).toBe(false)
    expect(sameShot(clock, 9.9, 10.1)).toBe(false)
    expect(sameShot(clock, 10.1, 9.9)).toBe(false)
  })

  it('does not depend on the frame rate', () => {
    expect(radialBlurLength(1, 10, 1000, 1 / 30)).toBeCloseTo(radialBlurLength(1, 20, 1000, 1 / 15))
  })
})

describe('sub-frames', () => {
  afterEach(() => setShutterSubFrame(0, 1))

  it('the export sets the sub-frame being rendered', () => {
    expect(shutterSubFrame()).toEqual({ index: 0, count: 1 })
    setShutterSubFrame(3, SHUTTER_SUBFRAMES)
    expect(shutterSubFrame()).toEqual({ index: 3, count: SHUTTER_SUBFRAMES })
  })

  it('the cloud noise slices of a frame are shared among its sub-frames, each its own', () => {
    expect(subFrameSlices(24, { index: 0, count: 1 })).toEqual({ first: 0, count: 24 })
    const used = new Set<number>()
    for (let index = 0; index < SHUTTER_SUBFRAMES; index++) {
      const { first, count } = subFrameSlices(24, { index, count: SHUTTER_SUBFRAMES })
      for (let k = 0; k < count; k++) used.add(first + k)
    }
    expect(used.size).toBe(24)
    expect(subFrameSlices(4, { index: 5, count: 8 })).toEqual({ first: 5, count: 1 })
  })
})

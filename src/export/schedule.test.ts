import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VIDEO_SETTINGS,
  VIDEO_ASPECTS,
  VIDEO_FORMATS,
  buildFrameSchedule,
  getVideoFormat,
  isValidVideoSettings,
} from './schedule'

describe('video formats', () => {
  it('lists the expected sizes, all with even dimensions (H.264 requirement)', () => {
    expect(VIDEO_FORMATS.map((f) => `${f.aspect} ${f.width}x${f.height}`)).toEqual([
      '16:9 1920x1080',
      '16:9 3840x2160',
      '16:9 1280x720',
      '9:16 1080x1920',
      '1:1 1080x1080',
      '4:5 1080x1350',
    ])
    for (const f of VIDEO_FORMATS) {
      expect(f.width % 2).toBe(0)
      expect(f.height % 2).toBe(0)
      const [w, h] = f.aspect.split(':').map(Number)
      expect(f.width / f.height).toBeCloseTo(w / h, 6)
    }
  })

  it('every aspect has at least one format', () => {
    for (const { aspect } of VIDEO_ASPECTS) expect(VIDEO_FORMATS.some((f) => f.aspect === aspect)).toBe(true)
  })

  it('looks formats up by id', () => {
    expect(getVideoFormat('1080x1350')).toMatchObject({ aspect: '4:5', width: 1080, height: 1350 })
    expect(getVideoFormat('640x480')).toBeUndefined()
  })

  it('validates video settings', () => {
    expect(isValidVideoSettings(DEFAULT_VIDEO_SETTINGS)).toBe(true)
    expect(isValidVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, format: '640x480' as never })).toBe(false)
    expect(isValidVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, fps: 25 as never })).toBe(false)
    expect(isValidVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, quality: 'ultra' as never })).toBe(false)
  })
})

describe('buildFrameSchedule', () => {
  it('ramps from 0 to 1 over duration × fps frames', () => {
    const frames = buildFrameSchedule({ durationS: 2, fps: 10 })
    expect(frames).toHaveLength(20)
    expect(frames[0]).toBe(0)
    expect(frames[19]).toBe(1)
    for (let i = 1; i < frames.length; i++) expect(frames[i] - frames[i - 1]).toBeCloseTo(1 / 19, 12)
  })

  it('adds hold frames on the first and last images', () => {
    const frames = buildFrameSchedule({ durationS: 1, fps: 4, holdStartS: 0.5, holdEndS: 1 })
    expect(frames).toEqual([0, 0, 0, 1 / 3, 2 / 3, 1, 1, 1, 1, 1])
  })

  it('follows a non-linear pacing, ends exactly on 0 and 1', () => {
    // half the film paused at the middle of the track, then a linear end
    const progressAt = (t: number) => (t < 2 ? t / 4 : t < 4 ? 0.5 : 0.5 + (t - 4) / 8)
    const frames = buildFrameSchedule({ durationS: 8, fps: 1, progressAt, holdEndS: 1 })
    expect(frames).toHaveLength(8 + 1)
    expect(frames[0]).toBe(0)
    expect(frames[7]).toBe(1)
    expect(frames[8]).toBe(1)
    // frame k shows film time k × 8 / 7
    expect(frames[1]).toBeCloseTo(8 / 7 / 4, 12)
    expect(frames[2]).toBe(0.5)
    expect(frames[3]).toBe(0.5)
    for (let i = 1; i < frames.length; i++) expect(frames[i]).toBeGreaterThanOrEqual(frames[i - 1])
  })

  it('a linear progressAt gives the default ramp', () => {
    const linear = buildFrameSchedule({ durationS: 3, fps: 10 })
    expect(buildFrameSchedule({ durationS: 3, fps: 10, progressAt: (t) => t / 3 })).toEqual(
      linear.map((p) => expect.closeTo(p, 12)),
    )
  })

  it('60 s at 30 fps with the default holds', () => {
    expect(buildFrameSchedule({ durationS: 60, fps: 30, holdStartS: 1, holdEndS: 2 })).toHaveLength(1890)
  })

  it('keeps at least two frames for very short films', () => {
    expect(buildFrameSchedule({ durationS: 0.01, fps: 24 })).toEqual([0, 1])
  })

  it('rejects invalid durations and frame rates', () => {
    expect(() => buildFrameSchedule({ durationS: 0, fps: 30 })).toThrow(RangeError)
    expect(() => buildFrameSchedule({ durationS: Number.NaN, fps: 30 })).toThrow(RangeError)
    expect(() => buildFrameSchedule({ durationS: 10, fps: 0 })).toThrow(RangeError)
    expect(() => buildFrameSchedule({ durationS: 10, fps: Number.POSITIVE_INFINITY })).toThrow(RangeError)
  })
})

import { describe, expect, it } from 'vitest'
import { buildFilmClock } from '../film/clock'
import { DEFAULT_FILM } from '../film/model'
import { DEFAULT_PACING } from '../flyover/pacing'
import {
  DEFAULT_VIDEO_SETTINGS,
  VIDEO_ASPECTS,
  VIDEO_RESOLUTIONS,
  buildFrameSchedule,
  buildFrameTimes,
  isValidVideoSettings,
  videoSize,
  withVideoDefaults,
} from './schedule'

describe('video formats', () => {
  it('sizes every aspect × resolution from the short side', () => {
    const sizes = VIDEO_ASPECTS.map((a) =>
      VIDEO_RESOLUTIONS.map((r) => {
        const { width, height } = videoSize(a.id, r.id)
        return `${width}x${height}`
      }).join(' '),
    )
    expect(sizes).toEqual([
      '1280x720 1920x1080 2560x1440 3840x2160',
      '720x1280 1080x1920 1440x2560 2160x3840',
      '720x720 1080x1080 1440x1440 2160x2160',
      '720x900 1080x1350 1440x1800 2160x2700',
      '1680x720 2520x1080 3360x1440 5040x2160',
    ])
  })

  it('keeps even sizes with the exact aspect and short side', () => {
    for (const a of VIDEO_ASPECTS) {
      for (const r of VIDEO_RESOLUTIONS) {
        const { width, height } = videoSize(a.id, r.id)
        expect(width % 2).toBe(0)
        expect(height % 2).toBe(0)
        expect(Math.min(width, height)).toBe(r.shortSide)
        expect(width / height).toBeCloseTo(a.x / a.y, 2)
      }
    }
  })

  it('validates video settings', () => {
    expect(isValidVideoSettings(DEFAULT_VIDEO_SETTINGS)).toBe(true)
    expect(isValidVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, aspect: '3:2' as never })).toBe(false)
    expect(isValidVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, resolution: '8k' as never })).toBe(false)
    expect(isValidVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, fps: 25 as never })).toBe(false)
    expect(isValidVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, quality: 'ultra' as never })).toBe(false)
  })

  it('upgrades the former fixed formats', () => {
    expect(withVideoDefaults({ format: '1080x1920', fps: 60, quality: 'max' })).toEqual({
      aspect: '9:16',
      resolution: '1080p',
      fps: 60,
      quality: 'max',
    })
    expect(withVideoDefaults({ format: '3840x2160', fps: 30, quality: 'high' })).toMatchObject({ aspect: '16:9', resolution: '4k' })
    expect(withVideoDefaults({ format: '1080x1350', fps: 30, quality: 'high' })).toMatchObject({ aspect: '4:5', resolution: '1080p' })
    expect(withVideoDefaults({ format: '640x480', fps: 24, quality: 'standard' })).toEqual({
      aspect: '16:9',
      resolution: '1080p',
      fps: 24,
      quality: 'standard',
    })
    // current shape and unrelated values are left alone
    expect(withVideoDefaults(DEFAULT_VIDEO_SETTINGS)).toBe(DEFAULT_VIDEO_SETTINGS)
    expect(withVideoDefaults(null)).toBeNull()
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

  it('film times: held on 0 and the duration, the ramp in between (the pauses keep moving the time)', () => {
    const options = { durationS: 8, fps: 1, progressAt: (t: number) => (t < 2 ? t / 4 : t < 4 ? 0.5 : 0.5 + (t - 4) / 8) }
    const times = buildFrameTimes({ ...options, holdStartS: 1, holdEndS: 2 })
    expect(times).toEqual([0, ...Array.from({ length: 8 }, (_, k) => expect.closeTo((k * 8) / 7, 12)), 8, 8])
    expect(times[8]).toBe(8)
    // same frames as the progress schedule
    expect(buildFrameSchedule({ ...options, holdStartS: 1, holdEndS: 2 })).toHaveLength(times.length)
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

  // the view is a pure function of (progress, film time), the same for the preview and the export (filmViewAt)
  it('playing the film reaches the progress of every exported frame', () => {
    const clock = buildFilmClock({
      opening: DEFAULT_FILM.opening,
      closing: DEFAULT_FILM.closing,
      stops: [{ id: 'summit', atM: 4000, durationS: 4, camera: 'orbite' }],
      speeds: [{ id: 'fast', fromM: 6000, toM: 8000, factor: 2 }],
      lengthM: 10_000,
      highlightsM: [],
      durationS: 60,
      pacing: { ...DEFAULT_PACING, keepDuration: false },
    })
    const options = { durationS: clock.totalTime(), progressAt: clock.progressAtTime, fps: 30, holdStartS: 1, holdEndS: 2 }
    const schedule = buildFrameSchedule(options)
    let played = clock.positionAt(0)
    buildFrameTimes(options).forEach((t, i) => {
      played = clock.advance(played, t - played.timeS, 1)
      expect(played.timeS).toBeCloseTo(t, 6)
      expect(played.progress).toBeCloseTo(schedule[i], 9)
    })
  })
})

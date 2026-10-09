import { describe, expect, it } from 'vitest'
import { isValidSetting, sanitizeSettings } from '../project/document'
import {
  advanceProgress,
  CAMERA_PRESETS,
  DEFAULT_CAMERA,
  DEFAULT_FLYOVER_DURATION_S,
  findCameraPreset,
  isValidCamera,
  turnSmoothingM,
} from './cameraSettings'

describe('advanceProgress', () => {
  it('covers the whole track in the flyover duration at speed x1 and scales with speed', () => {
    expect(advanceProgress(0, DEFAULT_FLYOVER_DURATION_S / 2, 1, DEFAULT_FLYOVER_DURATION_S)).toBeCloseTo(0.5, 9)
    expect(advanceProgress(0, DEFAULT_FLYOVER_DURATION_S / 4, 2, DEFAULT_FLYOVER_DURATION_S)).toBeCloseTo(0.5, 9)
    expect(advanceProgress(0, 60, 1, 240)).toBeCloseTo(0.25, 9)
    expect(advanceProgress(0.9, DEFAULT_FLYOVER_DURATION_S, 1, DEFAULT_FLYOVER_DURATION_S)).toBe(1)
  })
})

describe('camera presets', () => {
  it('start with today\'s chase view and have unique names and cameras', () => {
    expect(CAMERA_PRESETS[0].camera).toEqual(DEFAULT_CAMERA)
    expect(new Set(CAMERA_PRESETS.map((p) => p.name)).size).toBe(CAMERA_PRESETS.length)
    for (const preset of CAMERA_PRESETS) expect(findCameraPreset({ ...preset.camera })).toBe(preset)
  })

  it('are all valid', () => {
    for (const preset of CAMERA_PRESETS) expect(isValidCamera(preset.camera)).toBe(true)
  })

  it('findCameraPreset returns undefined for a custom camera', () => {
    expect(findCameraPreset({ ...DEFAULT_CAMERA, pitchDeg: 31 })).toBeUndefined()
  })
})

describe('turn smoothing', () => {
  it('« Auto »: 4% of the track (300 m–3 km) times the multiplier; metres when set', () => {
    expect(turnSmoothingM(DEFAULT_CAMERA, 20_000)).toBe(800)
    expect(turnSmoothingM(DEFAULT_CAMERA, 2_000)).toBe(300)
    expect(turnSmoothingM(DEFAULT_CAMERA, 500_000)).toBe(3_000)
    expect(turnSmoothingM({ ...DEFAULT_CAMERA, smoothing: 2 }, 20_000)).toBe(1_600)
    expect(turnSmoothingM({ ...DEFAULT_CAMERA, smoothing: 2, turnSmoothingM: 1_000 }, 20_000)).toBe(1_000)
  })
})

describe('validation of a loaded project', () => {
  it('rejects an unknown style, an out-of-range value or a missing key', () => {
    expect(isValidSetting('camera', { ...DEFAULT_CAMERA, style: 'fisheye' })).toBe(false)
    expect(isValidSetting('camera', { ...DEFAULT_CAMERA, distance: 10 })).toBe(false)
    const { northUp: _, ...missing } = DEFAULT_CAMERA
    expect(isValidSetting('camera', missing)).toBe(false)
    expect(isValidSetting('camera', { ...DEFAULT_CAMERA, style: 'orbit' })).toBe(true)
  })

  it('a camera saved before the smoothing in time loads with its turn multiplier kept (« Auto ») and the new defaults', () => {
    const saved = { style: 'sway', distance: 1.3, pitchDeg: 25, headingOffsetDeg: 0, smoothing: 1.5, northUp: false }
    const { settings, invalid } = sanitizeSettings({ camera: saved })
    expect(invalid).toEqual([])
    expect(settings.camera).toEqual({ ...saved, turnSmoothingM: 0, aimSmoothingS: 0, cameraSmoothingS: 3, endingS: 0 })
    // the same window as before: the automatic one of the track times the multiplier, shown in metres
    expect(turnSmoothingM(settings.camera, 20_000)).toBe(2 * 400 * 1.5)
  })

  it('bounds the flyover duration', () => {
    expect(isValidSetting('flyoverDurationS', 120)).toBe(true)
    expect(isValidSetting('flyoverDurationS', 5)).toBe(false)
    expect(isValidSetting('flyoverDurationS', 3600)).toBe(false)
  })
})

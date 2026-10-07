import { describe, expect, it } from 'vitest'
import { isValidSetting } from '../project/document'
import {
  advanceProgress,
  CAMERA_PRESETS,
  DEFAULT_CAMERA,
  DEFAULT_FLYOVER_DURATION_S,
  findCameraPreset,
  isValidCamera,
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

describe('validation of a loaded project', () => {
  it('rejects an unknown style, an out-of-range value or a missing key', () => {
    expect(isValidSetting('camera', { ...DEFAULT_CAMERA, style: 'fisheye' })).toBe(false)
    expect(isValidSetting('camera', { ...DEFAULT_CAMERA, distance: 10 })).toBe(false)
    const { northUp: _, ...missing } = DEFAULT_CAMERA
    expect(isValidSetting('camera', missing)).toBe(false)
    expect(isValidSetting('camera', { ...DEFAULT_CAMERA, style: 'orbit' })).toBe(true)
  })

  it('bounds the flyover duration', () => {
    expect(isValidSetting('flyoverDurationS', 120)).toBe(true)
    expect(isValidSetting('flyoverDurationS', 5)).toBe(false)
    expect(isValidSetting('flyoverDurationS', 3600)).toBe(false)
  })
})

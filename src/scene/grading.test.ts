import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GRADING,
  GRADING_PRESETS,
  LUMA_WEIGHTS,
  gradingOfPreset,
  gradingUniforms,
  isIdentityGrading,
  isValidGrading,
  matchingPreset,
  withGradingValue,
} from './grading'

const luminance = ([r, g, b]: readonly number[]) => LUMA_WEIGHTS[0] * r + LUMA_WEIGHTS[1] * g + LUMA_WEIGHTS[2] * b

describe('presets', () => {
  it('« Naturel » is the default and the identity, the other presets change the image', () => {
    expect(DEFAULT_GRADING.preset).toBe('naturel')
    expect(isIdentityGrading(DEFAULT_GRADING)).toBe(true)
    for (const preset of GRADING_PRESETS.slice(1)) expect(isIdentityGrading(preset.values), preset.id).toBe(false)
  })

  it('every preset is valid and recognised from its values', () => {
    for (const preset of GRADING_PRESETS) {
      const grading = gradingOfPreset(preset.id)
      expect(isValidGrading(grading), preset.id).toBe(true)
      expect(matchingPreset(grading)).toBe(preset.id)
    }
  })

  it('« Noir et blanc » removes all colour', () => {
    expect(gradingUniforms(gradingOfPreset('noir-et-blanc')).saturation).toBe(0)
  })
})

describe('withGradingValue', () => {
  it('a slider moved away from a preset makes it custom, moved back re-selects it', () => {
    const warm = gradingOfPreset('chaud-du-soir')
    const custom = withGradingValue(warm, 'vignette', 0.5)
    expect(custom).toMatchObject({ preset: 'personnalise', vignette: 0.5, warmth: warm.warmth })
    expect(withGradingValue(custom, 'vignette', warm.vignette).preset).toBe('chaud-du-soir')
  })

  it('clamps to the slider range', () => {
    expect(withGradingValue(DEFAULT_GRADING, 'vignette', -1).vignette).toBe(0)
    expect(withGradingValue(DEFAULT_GRADING, 'contrast', 3).contrast).toBe(1)
  })
})

describe('isValidGrading', () => {
  it('rejects unknown presets and values out of range', () => {
    expect(isValidGrading({ ...DEFAULT_GRADING, preset: 'sepia' as never })).toBe(false)
    expect(isValidGrading({ ...DEFAULT_GRADING, saturation: -1.5 })).toBe(false)
    expect(isValidGrading({ ...DEFAULT_GRADING, vignette: -0.1 })).toBe(false)
    expect(isValidGrading({ ...DEFAULT_GRADING, preset: 'personnalise', warmth: 0.4 })).toBe(true)
  })
})

describe('gradingUniforms', () => {
  it('leaves the image unchanged at the identity', () => {
    const { gain, ...rest } = gradingUniforms(DEFAULT_GRADING)
    expect(rest).toEqual({ saturation: 1, contrast: 1, vignette: 0 })
    for (const g of gain) expect(g).toBeCloseTo(1, 12)
  })

  it('warmth shifts red against blue without changing the luminance', () => {
    const warm = gradingUniforms({ ...DEFAULT_GRADING, warmth: 1 }).gain
    const cold = gradingUniforms({ ...DEFAULT_GRADING, warmth: -1 }).gain
    expect(warm[0]).toBeGreaterThan(warm[2])
    expect(cold[2]).toBeGreaterThan(cold[0])
    expect(luminance(warm)).toBeCloseTo(1, 12)
    expect(luminance(cold)).toBeCloseTo(1, 12)
  })

  it('contrast is an exponent around 1, vignette a darkening below 1', () => {
    expect(gradingUniforms({ ...DEFAULT_GRADING, contrast: 1 }).contrast).toBe(2)
    expect(gradingUniforms({ ...DEFAULT_GRADING, contrast: -1 }).contrast).toBe(0.5)
    const vignette = gradingUniforms({ ...DEFAULT_GRADING, vignette: 1 }).vignette
    expect(vignette).toBeGreaterThan(0)
    expect(vignette).toBeLessThan(1)
  })
})

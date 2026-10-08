/**
 * Colour grading of the film (« Étalonnage », `settings.grading`): contrast, saturation, warmth and vignette, set by
 * a preset (« Naturel », « Lumineux »…) then refined with sliders. Applied to the final image by one post-effect
 * (scene/gradingEffect.ts), identical in the preview and the export.
 *
 * This module is the pure part (no DOM, no Three): the setting, the presets, their validation and the shader
 * parameters derived from them (`gradingUniforms`). « Naturel » is the identity: no effect is mounted at all.
 */
import { clamp } from '../core/math'

/** The four sliders, each 0 when neutral. */
export interface GradingValues {
  /** −1 (flat) .. +1 (punchy): slope of the S curve around mid grey */
  contrast: number
  /** −1 (black and white) .. +1 (twice as saturated) */
  saturation: number
  /** −1 (cold, blue) .. +1 (warm, orange): white balance, brightness kept */
  warmth: number
  /** 0 (none) .. 1 (strong): darker corners */
  vignette: number
}

export const GRADING_PRESETS = [
  { id: 'naturel', label: 'Naturel', values: { contrast: 0, saturation: 0, warmth: 0, vignette: 0 } },
  { id: 'lumineux', label: 'Lumineux', values: { contrast: 0.15, saturation: 0.25, warmth: 0.08, vignette: 0 } },
  { id: 'doux', label: 'Doux', values: { contrast: -0.3, saturation: -0.15, warmth: 0.05, vignette: 0.1 } },
  { id: 'contraste', label: 'Contrasté', values: { contrast: 0.4, saturation: 0.1, warmth: 0, vignette: 0.25 } },
  { id: 'chaud-du-soir', label: 'Chaud du soir', values: { contrast: 0.1, saturation: 0.1, warmth: 0.55, vignette: 0.3 } },
  { id: 'froid-altitude', label: 'Froid d’altitude', values: { contrast: 0.1, saturation: -0.1, warmth: -0.5, vignette: 0.15 } },
  { id: 'noir-et-blanc', label: 'Noir et blanc', values: { contrast: 0.3, saturation: -1, warmth: 0, vignette: 0.3 } },
] as const satisfies readonly { id: string; label: string; values: GradingValues }[]

export type GradingPresetId = (typeof GRADING_PRESETS)[number]['id']

/** The user setting: the values, and the preset they match ('personnalise' once a slider moved away from it). */
export interface GradingSettings extends GradingValues {
  preset: GradingPresetId | 'personnalise'
}

export const DEFAULT_GRADING: GradingSettings = { preset: 'naturel', ...GRADING_PRESETS[0].values }

/** Slider bounds of each value (also the validation of saved projects). */
export const GRADING_RANGES: Record<keyof GradingValues, { min: number; max: number; step: number }> = {
  contrast: { min: -1, max: 1, step: 0.05 },
  saturation: { min: -1, max: 1, step: 0.05 },
  warmth: { min: -1, max: 1, step: 0.05 },
  vignette: { min: 0, max: 1, step: 0.05 },
}

const VALUE_KEYS = Object.keys(GRADING_RANGES) as (keyof GradingValues)[]

export function isValidGrading(v: GradingSettings): boolean {
  const presetKnown = v.preset === 'personnalise' || GRADING_PRESETS.some((p) => p.id === v.preset)
  return presetKnown && VALUE_KEYS.every((key) => v[key] >= GRADING_RANGES[key].min && v[key] <= GRADING_RANGES[key].max)
}

/** True when the grading leaves the image unchanged (whatever the preset name): the effect is then not mounted. */
export function isIdentityGrading(v: GradingValues): boolean {
  return VALUE_KEYS.every((key) => v[key] === 0)
}

/** The preset whose values are exactly `values`, else 'personnalise'. */
export function matchingPreset(values: GradingValues): GradingSettings['preset'] {
  return GRADING_PRESETS.find((p) => VALUE_KEYS.every((key) => p.values[key] === values[key]))?.id ?? 'personnalise'
}

/** The setting of a preset chip. */
export function gradingOfPreset(id: GradingPresetId): GradingSettings {
  const preset = GRADING_PRESETS.find((p) => p.id === id) ?? GRADING_PRESETS[0]
  return { preset: preset.id, ...preset.values }
}

/** The setting after one slider moved: the preset follows the values (a slider back on a preset re-selects it). */
export function withGradingValue(grading: GradingSettings, key: keyof GradingValues, value: number): GradingSettings {
  const range = GRADING_RANGES[key]
  const values = { ...grading, [key]: clamp(value, range.min, range.max) }
  return { ...values, preset: matchingPreset(values) }
}

// ---------------------------------------------------------------------------
// Shader parameters
// ---------------------------------------------------------------------------

/** Exponent of the S curve at contrast ±1 (2^±1: slope ×2 or ×0.5 at mid grey, black and white stay in place). */
const CONTRAST_OCTAVES = 1
/** Red / blue gain change at warmth ±1, before the luminance is restored (a mild white balance shift). */
const WARMTH_GAIN = 0.15
/** Darkening of the corners at vignette 1. */
const VIGNETTE_MAX_DARKENING = 0.6
/** Rec. 709 luminance weights of linear RGB, same as in the shader. */
export const LUMA_WEIGHTS: readonly [number, number, number] = [0.2126, 0.7152, 0.0722]

export interface GradingUniforms {
  /** linear RGB multipliers of the white balance, with a luminance of exactly 1 */
  gain: [number, number, number]
  /** mix factor from grey (0) through the colour (1) and beyond */
  saturation: number
  /** exponent of the S curve in display space, 1 = unchanged */
  contrast: number
  /** darkening in the corners, 0 = none */
  vignette: number
}

export function gradingUniforms(v: GradingValues): GradingUniforms {
  const warmth = clamp(v.warmth, -1, 1)
  const r = 1 + WARMTH_GAIN * warmth
  const b = 1 - WARMTH_GAIN * warmth
  const luminance = LUMA_WEIGHTS[0] * r + LUMA_WEIGHTS[1] + LUMA_WEIGHTS[2] * b
  return {
    gain: [r / luminance, 1 / luminance, b / luminance],
    saturation: 1 + clamp(v.saturation, -1, 1),
    contrast: 2 ** (CONTRAST_OCTAVES * clamp(v.contrast, -1, 1)),
    vignette: VIGNETTE_MAX_DARKENING * clamp(v.vignette, 0, 1),
  }
}

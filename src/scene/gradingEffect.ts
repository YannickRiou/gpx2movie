/**
 * Colour grading post-effect (`settings.grading`, scene/grading.ts): the last effect of the chain, after the tone
 * mapping and the anti-aliasing, on display-range linear colours. One cheap per-pixel shader (no texture read, no
 * depth): white balance, saturation, S curve, vignette.
 *
 *   colour × gain (warmth, luminance kept) → mix(luma, colour, saturation) → S curve around mid grey in sRGB
 *   (0 and 1 stay in place, nothing clips) → back to linear → × (1 − vignette · smoothstep(0.3, 1, r))
 *
 * r is the distance to the centre in frame units (0 at the centre, 1 in the corners): the vignette follows the
 * format and does not depend on the resolution, so the preview and the export match.
 *
 * Without the atmosphere the canvas is transparent over a CSS sky gradient; `skyBackdrop` then lays the image over
 * the same gradient first (the image is premultiplied: rgb + sky · (1 − alpha)) so that the sky is graded too and
 * the output is opaque.
 */
import { BlendFunction, Effect } from 'postprocessing'
import { Color, SRGBColorSpace, Uniform, Vector3 } from 'three'
import { gradingUniforms } from './grading'
import type { GradingValues } from './grading'

const fragmentShader = /* glsl */ `
uniform vec3 gradingGain;
uniform float gradingSaturation;
uniform float gradingContrast;
uniform float gradingVignette;
#ifdef GRADING_SKY_BACKDROP
uniform vec3 gradingSkyTop;
uniform vec3 gradingSkyHorizon;
#endif

vec3 gradingSrgbToLinear(const in vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 gradingLinearToSrgb(const in vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// S curve through (0, 0), (0.5, 0.5) and (1, 1), slope "exponent" at 0.5
vec3 gradingSCurve(const in vec3 x, const in float exponent) {
  vec3 low = 0.5 * pow(2.0 * x, vec3(exponent));
  vec3 high = 1.0 - 0.5 * pow(2.0 * (1.0 - x), vec3(exponent));
  return mix(low, high, step(0.5, x));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 color = inputColor.rgb;
  float alpha = inputColor.a;
  #ifdef GRADING_SKY_BACKDROP
  // the CSS gradient interpolates in sRGB, top (uv.y = 1) to horizon (uv.y = 0)
  color += gradingSrgbToLinear(mix(gradingSkyHorizon, gradingSkyTop, uv.y)) * (1.0 - alpha);
  alpha = 1.0;
  #endif
  color *= gradingGain;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = clamp(mix(vec3(luma), color, gradingSaturation), 0.0, 1.0);
  color = gradingSrgbToLinear(gradingSCurve(gradingLinearToSrgb(color), gradingContrast));
  float radius = length(uv * 2.0 - 1.0) * 0.70710678;
  color *= 1.0 - gradingVignette * smoothstep(0.3, 1.0, radius);
  outputColor = vec4(color, alpha);
}
`

export interface GradingEffectOptions {
  /** CSS sky gradient behind a transparent canvas (sRGB hex colours), laid under the image before grading */
  skyBackdrop?: { top: string; horizon: string }
}

/** sRGB components of a CSS colour, as the CSS gradient interpolates them. */
function srgbVector(css: string): Vector3 {
  const { r, g, b } = new Color(css).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace)
  return new Vector3(r, g, b)
}

export class GradingEffect extends Effect {
  constructor({ skyBackdrop }: GradingEffectOptions = {}) {
    const uniforms = new Map<string, Uniform>([
      ['gradingGain', new Uniform(new Vector3(1, 1, 1))],
      ['gradingSaturation', new Uniform(1)],
      ['gradingContrast', new Uniform(1)],
      ['gradingVignette', new Uniform(0)],
    ])
    if (skyBackdrop) {
      uniforms.set('gradingSkyTop', new Uniform(srgbVector(skyBackdrop.top)))
      uniforms.set('gradingSkyHorizon', new Uniform(srgbVector(skyBackdrop.horizon)))
    }
    super('GradingEffect', fragmentShader, {
      blendFunction: BlendFunction.SRC,
      defines: new Map(skyBackdrop ? [['GRADING_SKY_BACKDROP', '1']] : []),
      uniforms,
    })
  }

  /** Only uniforms change: moving a slider never recompiles the shader. */
  setGrading(values: GradingValues): void {
    const { gain, saturation, contrast, vignette } = gradingUniforms(values)
    const u = this.uniforms
    const gainUniform = u.get('gradingGain')!.value as Vector3
    gainUniform.set(...gain)
    u.get('gradingSaturation')!.value = saturation
    u.get('gradingContrast')!.value = contrast
    u.get('gradingVignette')!.value = vignette
  }
}

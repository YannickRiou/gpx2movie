/** Lens flare, atmosphere only (ARCHITECTURE.md, « Objectif »). */
import { BlendFunction, Effect } from 'postprocessing'
import { Uniform, Vector2 } from 'three'
import type { Texture, WebGLRenderTarget, WebGLRenderer } from 'three'

const fragmentShader = /* glsl */ `
uniform sampler2D flareScene;
uniform vec2 flareSun;
uniform float flareAspect;
uniform float flareSunRadius;
uniform float flareStrength;

// warm glare of the sun; ghost tints: periwinkle, water green, chartreuse (linear)
const vec3 FLARE_GLARE = vec3(1.0, 0.85, 0.65);
const vec3 FLARE_A = vec3(0.50, 0.64, 1.00);
const vec3 FLARE_B = vec3(0.76, 0.91, 0.73);
const vec3 FLARE_C = vec3(0.71, 0.79, 0.07);

float flareSeen(const in vec2 uv) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return smoothstep(0.85, 0.98, dot(texture2D(flareScene, uv).rgb, vec3(0.2126, 0.7152, 0.0722)));
}

float flareGhost(const in vec2 p, const in vec2 centre, const in float radius) {
  return 1.0 - smoothstep(0.7 * radius, radius, length(p - centre));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = inputColor;
  if (flareStrength <= 0.0) return;
  // the sun disc saturates the tone mapping unless the relief or a cloud hides it
  vec2 r = 0.6 * flareSunRadius * vec2(1.0 / flareAspect, 1.0);
  float seen = 0.2 * (flareSeen(flareSun) + flareSeen(flareSun + vec2(r.x, 0.0)) + flareSeen(flareSun - vec2(r.x, 0.0)) +
    flareSeen(flareSun + vec2(0.0, r.y)) + flareSeen(flareSun - vec2(0.0, r.y)));
  if (seen <= 0.0) return;
  // frame units: the height spans 1, the centre at the origin
  vec2 scale = vec2(flareAspect, 1.0);
  vec2 p = (uv - 0.5) * scale;
  vec2 s = (flareSun - 0.5) * scale;
  float d = length(p - s);
  vec3 flare = FLARE_GLARE * (0.5 * exp(-d * 14.0) + 0.2 * exp(-d * 3.5));
  flare += FLARE_GLARE * 0.3 * exp(-abs(p.y - s.y) * 300.0) * exp(-abs(p.x - s.x) * 2.5);
  flare += FLARE_A * 0.06 * exp(-pow((d - 0.32) * 30.0, 2.0));
  flare += FLARE_A * 0.22 * flareGhost(p, s * 0.55, 0.03);
  flare += FLARE_B * 0.12 * flareGhost(p, s * 0.2, 0.06);
  flare += FLARE_C * 0.16 * flareGhost(p, s * -0.3, 0.045);
  flare += FLARE_A * 0.08 * flareGhost(p, s * -0.6, 0.11);
  flare += FLARE_B * 0.14 * flareGhost(p, s * -1.0, 0.07);
  flare += FLARE_C * 0.06 * flareGhost(p, s * -1.4, 0.16);
  outputColor = vec4(inputColor.rgb + flareStrength * seen * flare, inputColor.a);
}
`

export class FlareEffect extends Effect {
  constructor() {
    super('FlareEffect', fragmentShader, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ['flareScene', new Uniform<Texture | null>(null)],
        ['flareSun', new Uniform(new Vector2(0.5, 0.5))],
        ['flareAspect', new Uniform(1)],
        ['flareSunRadius', new Uniform(0.005)],
        ['flareStrength', new Uniform(0)],
      ]),
    })
  }

  /** `uv` from the bottom left, `radius` of the disc as a fraction of the frame height, `strength` 0 = none. */
  setSun(uv: Vector2, radius: number, aspect: number, strength: number): void {
    const u = this.uniforms
    ;(u.get('flareSun')!.value as Vector2).copy(uv)
    u.get('flareSunRadius')!.value = radius
    u.get('flareAspect')!.value = aspect
    u.get('flareStrength')!.value = strength
  }

  override update(_renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget): void {
    this.uniforms.get('flareScene')!.value = inputBuffer.texture
  }
}

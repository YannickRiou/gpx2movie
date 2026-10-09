/**
 * Motion blur: radial speed blur, then the average of the export sub-frames or a trail while the preview plays
 * (ARCHITECTURE.md, « Objectif »).
 */
import { BlendFunction, Effect, ShaderPass } from 'postprocessing'
import { HalfFloatType, NoBlending, ShaderMaterial, Uniform, Vector2, WebGLRenderTarget } from 'three'
import type { Texture, WebGLRenderer } from 'three'
import { previewShutterWeight, shutterSubFrame } from './lens'

const fragmentShader = /* glsl */ `
uniform sampler2D shutterAverage;
uniform bool shutterActive;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = shutterActive ? texture2D(shutterAverage, uv) : inputColor;
}
`

const blendShader = /* glsl */ `
#define RADIAL_TAPS 10
uniform sampler2D inputBuffer;
uniform sampler2D historyBuffer;
uniform float historyWeight;
uniform vec2 radialCentre;
uniform float radialLength;
uniform float radialAspect;
varying vec2 vUv;

void main() {
  vec4 color = texture2D(inputBuffer, vUv);
  if (radialLength > 0.0) {
    // 0 at the centre, 1 in the farthest corner; sharp inside 0.3
    vec2 offset = vUv - radialCentre;
    vec2 frame = offset * vec2(radialAspect, 1.0);
    vec2 corner = (0.5 + abs(radialCentre - 0.5)) * vec2(radialAspect, 1.0);
    float streak = radialLength * smoothstep(0.3, 1.0, length(frame) / length(corner));
    if (streak > 0.0) {
      for (int i = 1; i < RADIAL_TAPS; i++) {
        color += texture2D(inputBuffer, vUv - offset * streak * float(i) / float(RADIAL_TAPS - 1));
      }
      color /= float(RADIAL_TAPS);
    }
  }
  gl_FragColor = mix(color, texture2D(historyBuffer, vUv), historyWeight);
}
`

const vertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

export class ShutterEffect extends Effect {
  playing = false
  shutter = 0
  fps = 30
  /** radial speed blur of this frame: centre (uv) and streak length, 0 = none */
  readonly radialCentre = new Vector2(0.5, 0.5)
  radialLength = 0
  private history: WebGLRenderTarget
  private current: WebGLRenderTarget
  private readonly blend: ShaderPass
  /** a sub-frame rendered again (waiting for tiles) restarts from the same history */
  private lastIndex = -1
  private trail = false

  constructor() {
    super('ShutterEffect', fragmentShader, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ['shutterAverage', new Uniform<Texture | null>(null)],
        ['shutterActive', new Uniform(false)],
      ]),
    })
    // half floats: an average of 8-bit images would lose its low bits
    const target = () => new WebGLRenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType })
    this.history = target()
    this.current = target()
    this.blend = new ShaderPass(
      new ShaderMaterial({
        name: 'ShutterBlend',
        uniforms: {
          inputBuffer: new Uniform(null),
          historyBuffer: new Uniform(null),
          historyWeight: new Uniform(0),
          radialCentre: new Uniform(new Vector2()),
          radialLength: new Uniform(0),
          radialAspect: new Uniform(1),
        },
        vertexShader,
        fragmentShader: blendShader,
        blending: NoBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    )
  }

  private swap(): void {
    ;[this.history, this.current] = [this.current, this.history]
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, deltaTime = 0): void {
    const { index, count } = shutterSubFrame()
    const active = this.uniforms.get('shutterActive')!
    let weight: number
    if (count > 1) {
      if (index > 0 && index !== this.lastIndex) this.swap()
      this.lastIndex = index
      this.trail = false
      weight = index / (index + 1)
    } else {
      this.lastIndex = -1
      weight = this.playing ? previewShutterWeight(this.shutter, this.fps, deltaTime) : 0
      if (weight > 0) {
        if (!this.trail) weight = 0
        this.swap()
        this.trail = true
      } else {
        this.trail = false
        if (this.radialLength <= 0) {
          active.value = false
          return
        }
      }
    }
    const uniforms = (this.blend.fullscreenMaterial as ShaderMaterial).uniforms
    uniforms.historyBuffer.value = this.history.texture
    uniforms.historyWeight.value = weight
    uniforms.radialCentre.value.copy(this.radialCentre)
    uniforms.radialLength.value = this.radialLength
    uniforms.radialAspect.value = inputBuffer.width / Math.max(1, inputBuffer.height)
    this.blend.render(renderer, inputBuffer, this.current)
    this.uniforms.get('shutterAverage')!.value = this.current.texture
    active.value = true
  }

  override setSize(width: number, height: number): void {
    this.history.setSize(width, height)
    this.current.setSize(width, height)
    this.trail = false
  }

  override dispose(): void {
    this.history.dispose()
    this.current.dispose()
    this.blend.dispose()
    super.dispose()
  }
}

/**
 * Weather post-effect, after the aerial perspective and before the tone mapping (HDR radiances): extra haze
 * that thickens towards the ground, a cloud veil over the sky and a slight desaturation (src/weather/sceneWeather.ts).
 *
 * Why a post-effect: Takram's AerialPerspectiveEffect has no knob for the density of its haze (its transmittance and
 * inscatter come from the precomputed clear atmosphere), so the extra extinction is applied here, from the same depth
 * buffer, in the same EffectPass (a few ALU per pixel, no extra texture).
 *
 * Haze: exponential height fog beta(y) = beta0 * exp(-(y - baseY) / H) above the ground under the marker, integrated
 * analytically along the view ray; sky pixels (depth cleared to 1) see it up to infinity, after the cloud veil.
 * hazeColor is the radiance of a white diffuser lit by the (dimmed) sun and sky lights, set every frame.
 */
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import { Color, Matrix4, Uniform } from 'three'
import type { Camera, WebGLRenderer, WebGLRenderTarget } from 'three'

const fragmentShader = /* glsl */ `
uniform mat4 weatherInverseProjection;
uniform mat4 weatherCameraMatrixWorld;
uniform vec3 weatherHazeColor;
uniform float weatherHazeExtinction;
uniform float weatherHazeBaseY;
uniform float weatherHazeHeight;
uniform float weatherSkyVeil;
uniform float weatherDesaturation;

// relative haze density at world height y (exponent clamped against overflow)
float weatherHazeDensity(const in float y) {
  return exp(clamp((weatherHazeBaseY - y) / weatherHazeHeight, -40.0, 20.0));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 color = inputColor.rgb;
  if (weatherHazeExtinction > 0.0 || weatherSkyVeil > 0.0) {
    // view-space point at viewZ = -1 on this pixel's ray, and the ray in world space
    vec4 nearPoint = weatherInverseProjection * vec4(uv * 2.0 - 1.0, -1.0, 1.0);
    vec3 viewRay = nearPoint.xyz / nearPoint.w;
    viewRay /= -viewRay.z;
    vec3 direction = normalize(mat3(weatherCameraMatrixWorld) * viewRay);
    float cameraY = weatherCameraMatrixWorld[3].y;
    float a0 = weatherHazeDensity(cameraY);
    float rawDepth = texture2D(depthBuffer, uv).r;
    float opticalDepth;
    if (rawDepth >= 1.0 - 1e-7) {
      color = mix(color, weatherHazeColor, weatherSkyVeil);
      opticalDepth = weatherHazeExtinction * weatherHazeHeight * a0 / max(direction.y, 1e-3);
    } else {
      #if defined(USE_LOGARITHMIC_DEPTH_BUFFER) || defined(LOG_DEPTH)
      float viewDepth = exp2(rawDepth * log2(cameraFar + 1.0)) - 1.0;
      #else
      float viewDepth = -getViewZ(depth);
      #endif
      float distance = viewDepth * length(viewRay);
      float dy = direction.y * distance;
      // under a cloud deck the distance turns grey, not blue: the clear-sky inscatter of the aerial
      // perspective is neutralised with the veil, more so far away (20 km scale)
      float grey = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(color, vec3(grey), weatherSkyVeil * (1.0 - exp(-distance / 20000.0)));
      float a1 = weatherHazeDensity(cameraY + dy);
      float mean = abs(dy) > 1e-3 * weatherHazeHeight ? weatherHazeHeight * (a0 - a1) / dy : 0.5 * (a0 + a1);
      opticalDepth = weatherHazeExtinction * distance * mean;
    }
    color = mix(weatherHazeColor, color, exp(-opticalDepth));
  }
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  outputColor = vec4(mix(color, vec3(luma), weatherDesaturation), inputColor.a);
}
`

/** Values set every frame by AtmosphereLayer; the defaults leave the image unchanged. */
export interface WeatherEffectParams {
  /** extra extinction at baseY (1/m), 0 = no haze */
  hazeExtinction: number
  /** world height of the ground under the marker (metres) */
  hazeBaseY: number
  /** scale height of the haze (world metres, > 0) */
  hazeHeight: number
  skyVeil: number
  desaturation: number
}

export class WeatherEffect extends Effect {
  private viewCamera: Camera | null = null

  constructor({ logarithmicDepth = false }: { logarithmicDepth?: boolean } = {}) {
    super('WeatherEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      blendFunction: BlendFunction.SRC,
      defines: new Map(logarithmicDepth ? [['USE_LOGARITHMIC_DEPTH_BUFFER', '1']] : []),
      uniforms: new Map<string, Uniform>([
        ['weatherInverseProjection', new Uniform(new Matrix4())],
        ['weatherCameraMatrixWorld', new Uniform(new Matrix4())],
        ['weatherHazeColor', new Uniform(new Color(0, 0, 0))],
        ['weatherHazeExtinction', new Uniform(0)],
        ['weatherHazeBaseY', new Uniform(0)],
        ['weatherHazeHeight', new Uniform(1000)],
        ['weatherSkyVeil', new Uniform(0)],
        ['weatherDesaturation', new Uniform(0)],
      ]),
    })
  }

  override set mainCamera(camera: Camera) {
    this.viewCamera = camera
  }

  /** Linear radiance of the haze and of the cloud veil (same units as the scene before tone mapping). */
  get hazeColor(): Color {
    return this.uniforms.get('weatherHazeColor')!.value as Color
  }

  setParams({ hazeExtinction, hazeBaseY, hazeHeight, skyVeil, desaturation }: WeatherEffectParams): void {
    const u = this.uniforms
    u.get('weatherHazeExtinction')!.value = Math.max(0, hazeExtinction)
    u.get('weatherHazeBaseY')!.value = hazeBaseY
    u.get('weatherHazeHeight')!.value = Math.max(1, hazeHeight)
    u.get('weatherSkyVeil')!.value = Math.min(1, Math.max(0, skyVeil))
    u.get('weatherDesaturation')!.value = Math.min(1, Math.max(0, desaturation))
  }

  override update(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, deltaTime?: number): void {
    super.update(renderer, inputBuffer, deltaTime)
    const camera = this.viewCamera
    if (!camera) return
    const inverseProjection = this.uniforms.get('weatherInverseProjection')!.value as Matrix4
    const cameraMatrixWorld = this.uniforms.get('weatherCameraMatrixWorld')!.value as Matrix4
    inverseProjection.copy(camera.projectionMatrixInverse)
    cameraMatrixWorld.copy(camera.matrixWorld)
  }
}

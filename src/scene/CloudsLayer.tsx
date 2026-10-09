/**
 * CloudsLayer — volumetric clouds (`@takram/three-clouds`), inside the EffectComposer of AtmosphereLayer and before
 * its aerial perspective, which composites them over the scene (ARCHITECTURE.md "Volumetric clouds").
 *
 * Every frame, at the sun date under the marker: coverage, altitudes and thinning from the weather of the outing or the
 * manual setting (weather/sceneClouds.ts); the clouds drift with the wind x film time (offsets set directly, no
 * velocity integrated over frames).
 *
 * Export: full resolution, no reprojection: each render averages a fixed number of noise slices from scratch, so a
 * frame never depends on the frames rendered before it. The textures are served locally at /clouds/ (vite.config.ts),
 * with a generated noise instead of the Takram blue noise (cloudNoise.ts): nothing is downloaded from GitHub.
 * Limit: the terrain is lit by light sources (SunLight), so the cloud shadows do not reach it.
 */
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3, type Camera, type Data3DTexture } from 'three'
import { CloudLayers, type CloudsEffect } from '@takram/three-clouds'
import { Clouds, type CloudsProps } from '@takram/three-clouds/r3f'
import { isExportBusy, useExportStore } from '../export/store'
import { samplePath } from '../flyover/path'
import { geoidUndulation } from '../geo/geoid'
import { useAppStore } from '../state/store'
import {
  cloudCoversAt,
  cloudDrift,
  filmWind,
  sceneCloudsFrom,
  seaOfClouds,
  weatherOffsetFor,
  type CloudQuality,
} from '../weather/sceneClouds'
import { sceneConditionsAt } from '../weather/sceneWeather'
import type { MarkerTrack } from './AtmosphereLayer'
import { shutterSubFrame, subFrameSlices } from './lens'
import { previewCloudPass } from './renderOnDemand'
import { useFilmClock } from './usePacing'
import { useTerrainContext } from './TerrainLayer'

const CLOUD_TEXTURES_URL = `${import.meta.env.BASE_URL}clouds/`
/**
 * Resolution of the cloud pass in the preview (fraction of the canvas): full, so that the average of a still view is
 * as sharp as an exported frame; while the view moves, temporal upscaling still marches one pixel in 16 only.
 */
const PREVIEW_RESOLUTION_SCALE = 1
/**
 * Preview marches, cheaper than the 'low' preset (200 steps of at least 100 m, 25 for the shadows): the clouds of the
 * preview are a little coarser, the export keeps its quality (`qualityPreset` sets every value back).
 */
const PREVIEW_MARCH = { maxIterationCount: 120, minStepSize: 150, shadowIterationCount: 15 }
/** Marches of the averaged frames of a still view: those of the 'low' preset. */
const STILL_MARCH = { maxIterationCount: 200, minStepSize: 100, shadowIterationCount: 25 }
/**
 * Distance covered by the cloud shadow map (metres). By default it is the camera's far plane, 5,000 km: two
 * cascades of 256² texels over that range gave the clouds black below a sun of ~35°.
 */
const SHADOW_MAX_FAR_M = 5e4
/** Period of the shape noise of three-clouds (`shapeRepeat` 0.0003 per metre). */
const DEFAULT_SHAPE_PERIOD_M = 1 / 0.0003
/**
 * Noise slices averaged per exported frame. Each slice is one noisy march per pixel; with 2 / 4 / 6 the exported
 * frames kept a visible grain on the dense sea of clouds (measured, see ARCHITECTURE.md).
 */
const EXPORT_SAMPLES: Record<CloudQuality, number> = { low: 16, medium: 24, high: 32 }

const HISTORY_FETCH = 'vec4 historyColor = texture(colorHistoryBuffer, prevUv);'
const RESOLVED = '  #endif // TEMPORAL_UPSCALE\n'

/**
 * A non-finite value in the clouds (one degenerate frame is enough) stays in the history of the temporal resolve for
 * good, since mix(NaN, x, 1) is NaN, and spreads through the variance clipping: black clouds. The resolve drops a
 * non-finite history and output instead.
 */
function guardResolve(effect: CloudsEffect): void {
  const material = effect.cloudsPass.resolveMaterial
  const source = material.fragmentShader
  if (!source.includes(HISTORY_FETCH) || !source.includes(RESOLVED) || source.includes('isnan')) return
  material.fragmentShader = source
    .replaceAll(HISTORY_FETCH, `${HISTORY_FETCH}\n  if (any(isnan(historyColor)) || any(isinf(historyColor))) historyColor = currentColor;`)
    .replace(RESOLVED, `${RESOLVED}  if (any(isnan(outputColor)) || any(isinf(outputColor))) outputColor = vec4(0.0);\n`)
  material.needsUpdate = true
}

const _east = new Vector3()
const _north = new Vector3()
const _origin = new Vector3()

/** What the clouds of a frame depend on, but the depth of the scene: camera, sun, cover, layers, drift. */
function cloudInputs(effect: CloudsEffect, camera: Camera): number[] {
  return [
    ...camera.matrixWorld.elements,
    ...camera.projectionMatrix.elements,
    ...effect.sunDirection.toArray(),
    effect.coverage,
    ...effect.localWeatherOffset.toArray(),
    ...effect.shapeOffset.toArray(),
    effect.shapeRepeat.x,
    ...effect.cloudLayers.flatMap((layer) => [
      layer.altitude,
      layer.height,
      layer.densityScale,
      layer.weatherExponent,
      layer.coverageFilterWidth,
      layer.shapeAlteringBias,
      layer.densityProfile.linearTerm,
      layer.densityProfile.constantTerm,
    ]),
  ]
}

interface CloudsLayerProps {
  date: RefObject<Date | null>
  marker: RefObject<MarkerTrack | null>
  noise: Data3DTexture
}

export function CloudsLayer({ date, marker, noise }: CloudsLayerProps) {
  const { frame } = useTerrainContext()
  const quality = useAppStore((s) => s.settings.clouds.quality)
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  const clock = useFilmClock()
  const ref = useRef<CloudsEffect>(null)
  /** preview: inputs of the last frame and number of frames since they last changed */
  const last = useRef<number[]>([])
  const still = useRef(0)
  /** cloud altitudes are above the ellipsoid, the scene heights above sea level (geo/geoid.ts) */
  const undulation = useMemo(() => (frame ? geoidUndulation(frame.origin.lon, frame.origin.lat) : 0), [frame])

  useLayoutEffect(() => {
    if (ref.current) guardResolve(ref.current)
  }, [])

  // Preview: cheap, upscaled until the view is still (useFrame); export: chosen quality, averaged noise slices.
  useLayoutEffect(() => {
    const effect = ref.current
    if (!effect) return
    effect.qualityPreset = exporting ? quality : 'low'
    effect.resolutionScale = exporting ? 1 : PREVIEW_RESOLUTION_SCALE
    effect.temporalUpscale = !exporting
    // no reprojection of the shadow map (its jitter is averaged with the frames of a still view); its depth only
    // where the clouds are seen in detail
    effect.shadow.temporalPass = false
    effect.shadow.maxFar = SHADOW_MAX_FAR_M
    // the weather post-effect already adds the haze
    effect.haze = false
    effect.cloudLayers[3].height = 0
    if (!exporting) return
    const update = effect.update
    const samples = EXPORT_SAMPLES[quality]
    effect.update = function (renderer, inputBuffer) {
      const alpha = this.cloudsPass.resolveMaterial.uniforms.temporalAlpha
      const previous = alpha.value
      // motion blur: this sub-frame's share of the slices, the other sub-frames average the rest
      const slices = subFrameSlices(samples, shutterSubFrame())
      for (let k = 0; k < slices.count; k++) {
        // the frame counter picks the noise slice: fixed per sample, never carried over from the previous frame
        Reflect.set(this, 'frame', slices.first + k)
        alpha.value = 1 / (k + 1)
        update.call(this, renderer, inputBuffer, 0)
      }
      alpha.value = previous
    }
    return () => {
      effect.update = update
    }
  }, [exporting, quality])

  useFrame(({ camera, invalidate }) => {
    const effect = ref.current
    if (!effect || !frame) return
    const { playback, settings } = useAppStore.getState()
    const now = date.current
    const under = marker.current
    const path = under?.path
    const series = under?.series ?? null
    let conditions
    if (settings.clouds.mode === 'meteo' && series && path && path.count > 0 && now) {
      const at = samplePath(path, Math.min(1, Math.max(0, under.progress)) * path.lengthM)
      conditions = sceneConditionsAt(series, now.getTime(), at.lon, at.lat)
    }
    const clouds =
      settings.clouds.mode === 'mer'
        ? seaOfClouds(settings.clouds.seaTopM, settings.exaggeration)
        : sceneCloudsFrom(cloudCoversAt(settings.clouds, conditions), {
            groundM: under?.track.stats.minEle ?? 0,
            altitudeM: settings.clouds.altitudeM,
            exaggeration: settings.exaggeration,
          })
    effect.coverage = clouds?.coverage ?? 0
    for (let i = 0; i < 3; i++) {
      const layer = effect.cloudLayers[i]
      const params = clouds?.layers[i]
      layer.altitude = (params?.altitudeM ?? 0) + undulation
      layer.height = params?.heightM ?? 0
      layer.densityScale = params?.densityScale ?? 0
      layer.weatherExponent = params?.weatherExponent ?? 1
      const shape = params?.shape
      const initial = CloudLayers.DEFAULT[i]
      layer.coverageFilterWidth = shape?.coverageFilterWidth ?? initial.coverageFilterWidth
      layer.shapeAlteringBias = shape?.shapeAlteringBias ?? initial.shapeAlteringBias
      if (shape) layer.densityProfile.set(0, 0, shape.densityProfile.linear, shape.densityProfile.constant)
      else layer.densityProfile.copy(initial.densityProfile)
    }
    effect.shapeRepeat.setScalar(1 / (clouds?.shapePeriodM ?? DEFAULT_SHAPE_PERIOD_M))

    // drift with the wind, a function of the film time only
    const timeS = playback.timeS ?? clock.timeAtProgress(playback.progress)
    const start = path && path.count > 0 ? samplePath(path, 0) : null
    const wind = filmWind(series, under?.track.stats.startTime ?? 0, start?.lon ?? 0, start?.lat ?? 0)
    const drift = cloudDrift(wind, timeS)
    _origin.setFromMatrixPosition(frame.localToEcef)
    _east.setFromMatrixColumn(frame.localToEcef, 0).normalize()
    _north.setFromMatrixColumn(frame.localToEcef, 2).normalize().negate()
    const [du, dv] = weatherOffsetFor(_origin.toArray(), _east.toArray(), _north.toArray(), drift, effect.localWeatherRepeat.x)
    effect.localWeatherOffset.set(du, dv)
    const shift = _east.multiplyScalar(drift.east).addScaledVector(_north, drift.north)
    effect.shapeOffset.copy(shift).multiply(effect.shapeRepeat).negate()
    effect.shapeDetailOffset.copy(shift).multiply(effect.shapeDetailRepeat).negate()

    if (exporting) return
    // preview: upscaled while the view changes, then the average of the still frames
    const inputs = cloudInputs(effect, camera)
    const changed = inputs.length !== last.current.length || inputs.some((v, i) => v !== last.current[i])
    last.current = inputs
    still.current = changed ? 0 : still.current + 1
    const pass = previewCloudPass(still.current)
    effect.temporalUpscale = pass.upscale
    const march = pass.upscale ? PREVIEW_MARCH : STILL_MARCH
    effect.clouds.maxIterationCount = march.maxIterationCount
    effect.clouds.minStepSize = march.minStepSize
    effect.shadow.maxIterationCount = march.shadowIterationCount
    effect.cloudsPass.resolveMaterial.uniforms.temporalAlpha.value = pass.alpha
    if (pass.more) invalidate()
  }, -0.5)

  return (
    <Clouds
      // the nested « clouds-… » / « shadow-… » props are only typing sugar of the R3F component
      ref={ref as CloudsProps['ref']}
      localWeatherTexture={`${CLOUD_TEXTURES_URL}local_weather.png`}
      shapeTexture={`${CLOUD_TEXTURES_URL}shape.bin`}
      shapeDetailTexture={`${CLOUD_TEXTURES_URL}shape_detail.bin`}
      turbulenceTexture={`${CLOUD_TEXTURES_URL}turbulence.png`}
      stbnTexture={noise}
      resolutionScale={exporting ? 1 : PREVIEW_RESOLUTION_SCALE}
    />
  )
}

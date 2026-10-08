/**
 * CloudsLayer — volumetric clouds (`@takram/three-clouds`), inside the EffectComposer of AtmosphereLayer and before
 * its aerial perspective, which composites them over the scene.
 *
 * Every frame, at the sun date under the marker: cover per layer from the weather of the outing or the manual
 * setting, then coverage, altitudes and thinning of the three layers (weather/sceneClouds.ts); the clouds drift with
 * the wind of the outing × film time (offsets set directly, no velocity integrated over frames).
 *
 * Preview: cheapest preset, half resolution, temporal upscaling (clouds converge over a few frames). Export:
 * `settings.clouds.quality`, full resolution, no reprojection: each render averages a fixed number of noise slices
 * from scratch (history discarded by the first one), so a frame never depends on the frames rendered before it.
 * The textures ship with the package and are served locally at /clouds/ (vite.config.ts); the blue noise of the
 * Takram examples is replaced by a generated noise (cloudNoise.ts), nothing is downloaded from GitHub.
 * Limit: the terrain is lit by light sources (SunLight), so the cloud shadows do not reach it (the weather dims the sun).
 */
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3, type Data3DTexture } from 'three'
import type { CloudsEffect } from '@takram/three-clouds'
import { Clouds, type CloudsProps } from '@takram/three-clouds/r3f'
import { isExportBusy, useExportStore } from '../export/store'
import { samplePath, type TrackPath } from '../flyover/path'
import { useAppStore } from '../state/store'
import { cloudCoversAt, cloudDrift, filmWind, sceneCloudsFrom, weatherOffsetFor, type CloudQuality } from '../weather/sceneClouds'
import { sceneConditionsAt } from '../weather/sceneWeather'
import { useWeatherStore } from '../weather/store'
import { useFilmClock } from './usePacing'
import { useTerrainContext } from './TerrainLayer'

const CLOUD_TEXTURES_URL = `${import.meta.env.BASE_URL}clouds/`
/** Resolution of the cloud pass in the preview (fraction of the canvas). */
const PREVIEW_RESOLUTION_SCALE = 0.5
/** Noise slices averaged per exported frame. */
const EXPORT_SAMPLES: Record<CloudQuality, number> = { low: 2, medium: 4, high: 6 }

const _east = new Vector3()
const _north = new Vector3()
const _origin = new Vector3()

export function CloudsLayer({ date, path, noise }: { date: RefObject<Date | null>; path: TrackPath | null; noise: Data3DTexture }) {
  const { frame } = useTerrainContext()
  const track = useAppStore((s) => s.tracks[0])
  const quality = useAppStore((s) => s.settings.clouds.quality)
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  const series = useWeatherStore((s) => (track && s.trackId === track.id ? s.series : null))
  const clock = useFilmClock()
  const ref = useRef<CloudsEffect>(null)
  const startTime = track?.stats.startTime
  const start = path && path.count > 0 ? samplePath(path, 0) : null
  const wind = useMemo(
    () => filmWind(series, startTime ?? 0, start?.lon ?? 0, start?.lat ?? 0),
    [series, startTime, start?.lon, start?.lat],
  )

  // Preview: cheap and temporally upscaled; export: chosen quality, no reprojection, averaged noise slices.
  useLayoutEffect(() => {
    const effect = ref.current
    if (!effect) return
    effect.qualityPreset = exporting ? quality : 'low'
    effect.resolutionScale = exporting ? 1 : PREVIEW_RESOLUTION_SCALE
    effect.temporalUpscale = !exporting
    effect.shadow.temporalPass = !exporting
    // the weather post-effect already adds the haze
    effect.haze = false
    effect.cloudLayers[3].height = 0
    if (!exporting) return
    const update = effect.update
    const samples = EXPORT_SAMPLES[quality]
    effect.update = function (renderer, inputBuffer) {
      const alpha = this.cloudsPass.resolveMaterial.uniforms.temporalAlpha
      const previous = alpha.value
      for (let k = 0; k < samples; k++) {
        // the frame counter picks the noise slice: fixed per sample, never carried over from the previous frame
        Reflect.set(this, 'frame', k)
        alpha.value = 1 / (k + 1)
        update.call(this, renderer, inputBuffer, 0)
      }
      alpha.value = previous
    }
    return () => {
      effect.update = update
    }
  }, [exporting, quality])

  useFrame(() => {
    const effect = ref.current
    if (!effect || !frame) return
    const { playback, settings } = useAppStore.getState()
    const now = date.current
    let conditions
    if (settings.clouds.mode === 'meteo' && series && path && path.count > 0 && now) {
      const marker = samplePath(path, Math.min(1, Math.max(0, playback.progress)) * path.lengthM)
      conditions = sceneConditionsAt(series, now.getTime(), marker.lon, marker.lat)
    }
    const clouds = sceneCloudsFrom(cloudCoversAt(settings.clouds, conditions), {
      groundM: track?.stats.minEle ?? 0,
      altitudeM: settings.clouds.altitudeM,
      exaggeration: settings.exaggeration,
    })
    effect.coverage = clouds?.coverage ?? 0
    for (let i = 0; i < 3; i++) {
      const layer = effect.cloudLayers[i]
      const params = clouds?.layers[i]
      layer.altitude = params?.altitudeM ?? 0
      layer.height = params?.heightM ?? 0
      layer.densityScale = params?.densityScale ?? 0
      layer.weatherExponent = params?.weatherExponent ?? 1
    }

    // drift with the wind, a function of the film time only
    const timeS = playback.timeS ?? clock.timeAtProgress(playback.progress)
    const drift = cloudDrift(wind, timeS)
    _origin.setFromMatrixPosition(frame.localToEcef)
    _east.setFromMatrixColumn(frame.localToEcef, 0).normalize()
    _north.setFromMatrixColumn(frame.localToEcef, 2).normalize().negate()
    const [du, dv] = weatherOffsetFor(_origin.toArray(), _east.toArray(), _north.toArray(), drift, effect.localWeatherRepeat.x)
    effect.localWeatherOffset.set(du, dv)
    const shift = _east.multiplyScalar(drift.east).addScaledVector(_north, drift.north)
    effect.shapeOffset.copy(shift).multiply(effect.shapeRepeat).negate()
    effect.shapeDetailOffset.copy(shift).multiply(effect.shapeDetailRepeat).negate()
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

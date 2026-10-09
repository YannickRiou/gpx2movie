/**
 * AtmosphereLayer — physically based sky, sun / sky lighting and aerial perspective (Takram's precomputed
 * atmospheric scattering). Rendered inside TerrainLayer: the local frame gives the world → ECEF matrix, raised by the
 * geoid undulation at its origin (scene heights are above sea level, Takram expects ellipsoid heights: geo/geoid.ts).
 *
 * Lighting uses light sources (SunLight + SkyLight) so the terrain keeps its MeshStandardMaterial; the
 * aerial perspective post-process adds the distance haze, and the composer tone-maps the HDR result (Khronos
 * Neutral, which keeps the hues of the orthophotos and the track).
 *
 * Every frame: the sun date follows the playback (recorded time under the marker, else the solar hour, see
 * flyover/sun.ts), then the exposure opens up as the sun goes down and a faint night fill keeps the relief
 * readable (scene/exposure.ts).
 * The weather of the outing under the marker at that date (weather/sceneWeather.ts, `settings.weatherScene`)
 * then dims the sun and sky lights, fades the shadows, adds exposure, and drives the weather post-effect
 * (extra haze near the ground, veiled sky, desaturation: scene/weatherEffect.ts).
 * The SMAA runs in a pass of its own, after the tone mapping: on the edges it blends the pass input, so merged into
 * the pass of the other effects it would put back the raw HDR image (no haze, no tone mapping) along the ridges.
 * The colour grading (`settings.grading`, scene/GradingComposer.tsx) closes the chain, in the same pass after the SMAA.
 * Volumetric clouds (`settings.clouds`, scene/CloudsLayer.tsx) are composited by the aerial perspective; while they
 * are shown, the veil over the sky pixels is lighter (the clouds themselves cover it).
 * The precomputed scattering textures ship with the package and are served locally at /atmosphere/ (see
 * vite.config.ts): generating them at start-up runs in idle callbacks, which never fire while a heavy scene
 * keeps the main thread busy, and the lights would stay black.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Color, Vector3, type HemisphereLight } from 'three'
import { EffectComposer, ToneMapping, disposePassWithoutEffects } from '@react-three/postprocessing'
import { EffectPass, SMAAEffect, ToneMappingMode } from 'postprocessing'
import type { AerialPerspectiveEffect, SkyLightProbe, SunDirectionalLight } from '@takram/three-atmosphere'
import { AerialPerspective, Atmosphere, Sky, SkyLight, Stars, SunLight, type AtmosphereApi } from '@takram/three-atmosphere/r3f'
import { samplePath, trackPathOf } from '../flyover/path'
import { mslLocalToEcef } from '../geo/geoid'
import { sunDateAt, sunDayMs } from '../flyover/sun'
import { useAppStore } from '../state/store'
import { CLEAR_SCENE_WEATHER, hazeExtinction, sceneWeatherAt, withManualHaze } from '../weather/sceneWeather'
import type { SceneWeather } from '../weather/sceneWeather'
import { useWeatherStore } from '../weather/store'
import { createCloudNoiseTexture } from './cloudNoise'
import { CloudsLayer } from './CloudsLayer'
import { DEFAULT_GROUND_HEIGHT_M } from './CameraRig'
import { useGradingEffect } from './GradingComposer'
import { nightFillIntensity, sceneExposure, sunElevation } from './exposure'
import { useTerrainContext } from './TerrainLayer'
import { SHADOW_MAP_SIZE, TerrainShadow } from './terrainShadow'
import { WeatherEffect } from './weatherEffect'

/** Directory of the precomputed atmosphere textures (EXR) and of the star catalogue. */
export const ATMOSPHERE_TEXTURES_URL = `${import.meta.env.BASE_URL}atmosphere/`
const STARS_DATA_URL = `${ATMOSPHERE_TEXTURES_URL}stars.bin`
/** Night fill colours (sky / ground), multiplied by nightFillIntensity. */
const NIGHT_SKY_COLOR = '#A9CCD9'
const NIGHT_GROUND_COLOR = '#1C2A33'
/** Reflectance of the haze droplets lit by the sun and the sky (a white diffuser would be 1). */
const HAZE_ALBEDO = 0.8
/** Part of the weather veil kept over the sky pixels while volumetric clouds are shown. */
const CLOUDS_SKY_VEIL = 0.3
const WORLD_UP = new Vector3(0, 1, 0)
const _marker = new Vector3()
const _irradiance = new Vector3()
const _grey = new Color()

export function AtmosphereLayer() {
  const { engine, frame } = useTerrainContext()
  const shadows = useAppStore((s) => s.settings.shadows)
  const track = useAppStore((s) => s.tracks[0])
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const atmosphereRef = useRef<AtmosphereApi>(null)
  const aerialRef = useRef<AerialPerspectiveEffect>(null)
  const nightFillRef = useRef<HemisphereLight>(null)
  const skyLightRef = useRef<SkyLightProbe>(null)
  const [sun, setSun] = useState<SunDirectionalLight | null>(null)
  /** day used when the track has no timestamps */
  const [today] = useState(() => Date.now())
  /** sun date and weather (timed tracks), ground under the marker for the haze (every track) */
  const path = track ? trackPathOf(track) : null
  const weatherEffect = useMemo(() => new WeatherEffect({ logarithmicDepth: gl.capabilities.logarithmicDepthBuffer }), [gl])
  useEffect(() => () => weatherEffect.dispose(), [weatherEffect])
  /** weather applied to the current frame, kept for the haze colour (after the lights are updated) */
  const weatherRef = useRef<SceneWeather>(CLEAR_SCENE_WEATHER)
  /** sun date of the current frame, read by the clouds */
  const dateRef = useRef<Date | null>(null)
  const cloudMode = useAppStore((s) => s.settings.clouds.mode)
  const weatherLoaded = useWeatherStore((s) => s.series !== null && s.trackId !== null && s.trackId === track?.id)
  const cloudsOn = cloudMode === 'manuel' || cloudMode === 'mer' || (cloudMode === 'meteo' && weatherLoaded)
  const noise = useMemo(() => createCloudNoiseTexture(), [])
  useEffect(() => () => noise.dispose(), [noise])
  /** local vertical in ECEF, for the sun elevation */
  const up = useMemo(() => (frame ? new Vector3().setFromMatrixColumn(frame.localToEcef, 1).normalize() : null), [frame])
  const grading = useGradingEffect()
  const smaa = useMemo(() => new SMAAEffect(), [])
  useEffect(() => () => smaa.dispose(), [smaa])
  const antialiasPass = useMemo(
    () => new EffectPass(camera, ...(grading.active ? [smaa, grading.effect] : [smaa])),
    [camera, smaa, grading.active, grading.effect],
  )
  // the effects are owned above: dispose only the pass
  useEffect(() => () => disposePassWithoutEffects(antialiasPass), [antialiasPass])

  // Restore the renderer exposure when the atmosphere is switched off.
  useLayoutEffect(() => {
    const previous = gl.toneMappingExposure
    return () => {
      gl.toneMappingExposure = previous
    }
  }, [gl])

  // Before the default render (negative priority): sun date, weather, exposure and night fill for this frame.
  // Reading the progress here rather than through a selector avoids a React render per frame during playback.
  // Everything is a function of the progress (no state carried between frames): the export stays deterministic.
  useFrame(() => {
    const atmosphere = atmosphereRef.current
    if (!frame || !up || !atmosphere) return
    const { playback, settings } = useAppStore.getState()
    const date = sunDateAt(path, playback.progress, {
      sunFromTrack: settings.sunFromTrack,
      solarHour: settings.sunHour,
      lon: frame.origin.lon,
      dayMs: sunDayMs(settings.sunDate, track?.stats.startTime, today),
    })
    atmosphere.updateByDate(date)
    dateRef.current = date
    const elevation = sunElevation(atmosphere.sunDirection, up)

    // weather under the marker at the sun date; the haze starts from the ground there
    let weather: SceneWeather = CLEAR_SCENE_WEATHER
    let hazeBaseY = 0
    const { series, trackId } = useWeatherStore.getState()
    const weatherOn = series && trackId === track?.id && settings.weatherScene.enabled
    if (path && path.count > 0 && (weatherOn || settings.haze > 0)) {
      const marker = samplePath(path, Math.min(1, Math.max(0, playback.progress)) * path.lengthM)
      if (weatherOn) weather = sceneWeatherAt(series, date.getTime(), marker.lon, marker.lat, settings.weatherScene)
      const ground = engine?.sampleHeight(marker.lon, marker.lat) ?? marker.ele ?? 0
      hazeBaseY = frame.toLocal(marker.lon, marker.lat, ground * settings.exaggeration, _marker).y
    }
    // the haze set by hand thickens the weather's (also read for the haze colour below)
    const hazeScale = withManualHaze(weather.hazeScale, settings.haze)
    if (hazeScale !== weather.hazeScale) weather = { ...weather, hazeScale }
    weatherRef.current = weather

    gl.toneMappingExposure = sceneExposure(elevation, settings.exposureEv + weather.exposureCompensationEv)
    if (nightFillRef.current) nightFillRef.current.intensity = nightFillIntensity(elevation)
    if (sun) {
      sun.intensity = weather.sunScale
      sun.shadow.intensity = weather.shadowStrength
    }
    if (skyLightRef.current) skyLightRef.current.intensity = weather.skyScale
    weatherEffect.setParams({
      hazeExtinction: hazeExtinction(weather.hazeScale),
      hazeBaseY,
      hazeHeight: weather.hazeHeightM * settings.exaggeration,
      skyVeil: weather.skyVeil * (cloudsOn ? CLOUDS_SKY_VEIL : 1),
      desaturation: weather.desaturation,
    })
  }, -1)

  // Once the Takram lights are updated for this frame (priority 0) and before the composer renders (priority 1):
  // the sky light under a cloud deck turns white (its blue fades with the veil, luminance kept), then the haze
  // colour is the radiance of the haze lit by the dimmed sun (on a horizontal surface) and sky.
  useFrame(() => {
    const atmosphere = atmosphereRef.current
    const sky = skyLightRef.current
    if (!up || !atmosphere || !sun || !sky) return
    const weather = weatherRef.current
    if (weather.skyVeil > 0) {
      for (const c of sky.sh.coefficients) {
        const grey = 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z
        c.set(c.x + (grey - c.x) * weather.skyVeil, c.y + (grey - c.y) * weather.skyVeil, c.z + (grey - c.z) * weather.skyVeil)
      }
    }
    const color = weatherEffect.hazeColor
    if (weather.hazeScale <= 1 && weather.skyVeil <= 0) {
      color.setRGB(0, 0, 0)
      return
    }
    const sinElevation = Math.max(0, Math.sin(sunElevation(atmosphere.sunDirection, up)))
    const skyIrradiance = sky.sh.getIrradianceAt(WORLD_UP, _irradiance).multiplyScalar(sky.intensity)
    const sunIrradiance = sun.intensity * sinElevation
    color.setRGB(
      skyIrradiance.x + sun.color.r * sunIrradiance,
      skyIrradiance.y + sun.color.g * sunIrradiance,
      skyIrradiance.z + sun.color.b * sunIrradiance,
    )
    color.multiplyScalar(HAZE_ALBEDO / Math.PI)
    // haze under a cloud deck is lit by white diffuse light: the tint of the low sun fades with the veil
    const grey = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
    color.lerp(_grey.setRGB(grey, grey, grey), weather.skyVeil)
  }, 0.5)

  useLayoutEffect(() => {
    if (frame && atmosphereRef.current) mslLocalToEcef(frame, atmosphereRef.current.worldToECEFMatrix)
  }, [frame])

  // postprocessing flags a logarithmic depth buffer as LOG_DEPTH, Takram's shader expects this define:
  // without it the depth is read as linear and the whole terrain looks infinitely far (uniform haze).
  useLayoutEffect(() => {
    const effect = aerialRef.current
    if (!effect || !gl.capabilities.logarithmicDepthBuffer) return
    effect.defines.set('USE_LOGARITHMIC_DEPTH_BUFFER', '1')
    effect.dispatchEvent({ type: 'change' })
  }, [gl, frame])

  // Cast shadows of the relief: one shadow map refitted every frame to the terrain in view (terrainShadow.ts).
  useLayoutEffect(() => {
    if (!sun || !engine || !shadows) return
    const original = sun.shadow
    const shadow = new TerrainShadow(engine.group, Math.min(SHADOW_MAP_SIZE, gl.capabilities.maxTextureSize))
    sun.shadow = shadow
    sun.castShadow = true
    return () => {
      sun.castShadow = false
      sun.shadow = original
      shadow.dispose()
    }
  }, [sun, engine, shadows, gl])

  if (!frame) return null
  return (
    <Atmosphere ref={atmosphereRef} textures={ATMOSPHERE_TEXTURES_URL}>
      <Sky />
      <Stars data={STARS_DATA_URL} />
      <hemisphereLight ref={nightFillRef} color={NIGHT_SKY_COLOR} groundColor={NIGHT_GROUND_COLOR} intensity={0} />
      <group position={[0, DEFAULT_GROUND_HEIGHT_M, 0]}>
        <SkyLight ref={skyLightRef} />
        <SunLight ref={setSun} />
      </group>
      <EffectComposer multisampling={0}>
        {cloudsOn && <CloudsLayer date={dateRef} path={path} noise={noise} />}
        <AerialPerspective ref={aerialRef} stbnTexture={noise} />
        <primitive object={weatherEffect} mainCamera={camera} />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        <primitive object={antialiasPass} />
      </EffectComposer>
    </Atmosphere>
  )
}

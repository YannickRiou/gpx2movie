/**
 * AtmosphereLayer — physically based sky, sun / sky lighting and aerial perspective (Takram's precomputed
 * atmospheric scattering). Rendered inside TerrainLayer: the local frame gives the world → ECEF matrix.
 *
 * Lighting uses light sources (SunLight + SkyLight) so the terrain keeps its MeshStandardMaterial; the
 * aerial perspective post-process adds the distance haze, and the composer tone-maps the HDR result (Khronos
 * Neutral, which keeps the hues of the orthophotos and the track).
 *
 * Every frame: the sun date follows the playback (recorded time under the marker, else the solar hour, see
 * flyover/sun.ts), then the exposure opens up as the sun goes down and a faint night fill keeps the relief
 * readable (scene/exposure.ts).
 * The precomputed scattering textures ship with the package and are served locally at /atmosphere/ (see
 * vite.config.ts): generating them at start-up runs in idle callbacks, which never fire while a heavy scene
 * keeps the main thread busy, and the lights would stay black.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3, type HemisphereLight } from 'three'
import { EffectComposer, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import type { AerialPerspectiveEffect, SunDirectionalLight } from '@takram/three-atmosphere'
import { AerialPerspective, Atmosphere, Sky, SkyLight, Stars, SunLight, type AtmosphereApi } from '@takram/three-atmosphere/r3f'
import { buildTrackPath } from '../flyover/path'
import { sunDateAt } from '../flyover/sun'
import { useAppStore } from '../state/store'
import { DEFAULT_GROUND_HEIGHT_M } from './CameraRig'
import { nightFillIntensity, sceneExposure, sunElevation } from './exposure'
import { useTerrainContext } from './TerrainLayer'
import { SHADOW_MAP_SIZE, TerrainShadow } from './terrainShadow'

/** Directory of the precomputed atmosphere textures (EXR) and of the star catalogue. */
export const ATMOSPHERE_TEXTURES_URL = `${import.meta.env.BASE_URL}atmosphere/`
const STARS_DATA_URL = `${ATMOSPHERE_TEXTURES_URL}stars.bin`
/** Night fill colours (sky / ground), multiplied by nightFillIntensity. */
const NIGHT_SKY_COLOR = '#A9CCD9'
const NIGHT_GROUND_COLOR = '#1C2A33'

export function AtmosphereLayer() {
  const { engine, frame } = useTerrainContext()
  const shadows = useAppStore((s) => s.settings.shadows)
  const track = useAppStore((s) => s.tracks[0])
  const sunFromTrack = useAppStore((s) => s.settings.sunFromTrack)
  const gl = useThree((s) => s.gl)
  const atmosphereRef = useRef<AtmosphereApi>(null)
  const aerialRef = useRef<AerialPerspectiveEffect>(null)
  const nightFillRef = useRef<HemisphereLight>(null)
  const [sun, setSun] = useState<SunDirectionalLight | null>(null)
  /** day used when the track has no timestamps */
  const [today] = useState(() => Date.now())
  /** only timed tracks need the path (startTime is set as soon as one point has a time) */
  const path = useMemo(
    () => (track && sunFromTrack && track.stats.startTime !== undefined ? buildTrackPath(track) : null),
    [track, sunFromTrack],
  )
  /** local vertical in ECEF, for the sun elevation */
  const up = useMemo(() => (frame ? new Vector3().setFromMatrixColumn(frame.localToEcef, 1).normalize() : null), [frame])

  // Restore the renderer exposure when the atmosphere is switched off.
  useLayoutEffect(() => {
    const previous = gl.toneMappingExposure
    return () => {
      gl.toneMappingExposure = previous
    }
  }, [gl])

  // Before the default render (negative priority): sun date, exposure and night fill for this frame. Reading
  // the progress here rather than through a selector avoids a React render per frame during playback.
  useFrame(() => {
    const atmosphere = atmosphereRef.current
    if (!frame || !up || !atmosphere) return
    const { playback, settings } = useAppStore.getState()
    const date = sunDateAt(path, playback.progress, {
      sunFromTrack: settings.sunFromTrack,
      solarHour: settings.sunHour,
      lon: frame.origin.lon,
      dayMs: track?.stats.startTime ?? today,
    })
    atmosphere.updateByDate(date)
    const elevation = sunElevation(atmosphere.sunDirection, up)
    gl.toneMappingExposure = sceneExposure(elevation, settings.exposureEv)
    if (nightFillRef.current) nightFillRef.current.intensity = nightFillIntensity(elevation)
  }, -1)

  useLayoutEffect(() => {
    if (frame) atmosphereRef.current?.worldToECEFMatrix.copy(frame.localToEcef)
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
        <SkyLight />
        <SunLight ref={setSun} />
      </group>
      <EffectComposer multisampling={0}>
        <AerialPerspective ref={aerialRef} />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        <SMAA />
      </EffectComposer>
    </Atmosphere>
  )
}

/**
 * AtmosphereLayer — physically based sky, sun / sky lighting and aerial perspective (Takram's precomputed
 * atmospheric scattering). Rendered inside TerrainLayer: the local frame gives the world → ECEF matrix.
 *
 * Lighting uses light sources (SunLight + SkyLight) so the terrain keeps its MeshStandardMaterial; the
 * aerial perspective post-process adds the distance haze, and the composer tone-maps the HDR result (Khronos Neutral, which keeps the hues of the orthophotos and the track).
 * The precomputed scattering textures ship with the package and are served locally at /atmosphere/ (see
 * vite.config.ts): generating them at start-up runs in idle callbacks, which never fire while a heavy scene
 * keeps the main thread busy, and the lights would stay black.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { EffectComposer, SMAA, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import type { AerialPerspectiveEffect } from '@takram/three-atmosphere'
import { AerialPerspective, Atmosphere, Sky, SkyLight, Stars, SunLight, type AtmosphereApi } from '@takram/three-atmosphere/r3f'
import { useAppStore } from '../state/store'
import { DEFAULT_GROUND_HEIGHT_M } from './CameraRig'
import { useTerrainContext } from './TerrainLayer'

/** Directory of the precomputed atmosphere textures (EXR) and of the star catalogue. */
export const ATMOSPHERE_TEXTURES_URL = `${import.meta.env.BASE_URL}atmosphere/`
const STARS_DATA_URL = `${ATMOSPHERE_TEXTURES_URL}stars.bin`
/** At the daylight exposure the stars barely reach 10 % grey; a night camera would expose much longer. */
const STARS_INTENSITY = 8

/** Radiance → display scale applied before tone mapping (Takram radiances are physical). */
export const ATMOSPHERE_EXPOSURE = 5

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/**
 * Instant at which the local mean solar time at `lon` is `solarHour`, on the UTC day containing `dayMs`.
 * Solar time keeps the setting independent of time zones: 12 h is always the sun near its highest.
 */
export function solarHourToDate(dayMs: number, lon: number, solarHour: number): Date {
  const dayStart = Math.floor(dayMs / DAY_MS) * DAY_MS
  return new Date(dayStart + (solarHour - lon / 15) * HOUR_MS)
}

export function AtmosphereLayer() {
  const { frame } = useTerrainContext()
  const sunHour = useAppStore((s) => s.settings.sunHour)
  const startTime = useAppStore((s) => s.tracks[0]?.stats.startTime)
  const gl = useThree((s) => s.gl)
  const atmosphereRef = useRef<AtmosphereApi>(null)
  const aerialRef = useRef<AerialPerspectiveEffect>(null)
  /** day used when the track has no timestamps */
  const [today] = useState(() => Date.now())

  const date = useMemo(
    () => (frame ? solarHourToDate(startTime ?? today, frame.origin.lon, sunHour) : undefined),
    [frame, startTime, today, sunHour],
  )

  useLayoutEffect(() => {
    const previous = gl.toneMappingExposure
    gl.toneMappingExposure = ATMOSPHERE_EXPOSURE
    return () => {
      gl.toneMappingExposure = previous
    }
  }, [gl])

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

  if (!frame) return null
  return (
    <Atmosphere ref={atmosphereRef} textures={ATMOSPHERE_TEXTURES_URL} date={date}>
      <Sky />
      <Stars data={STARS_DATA_URL} intensity={STARS_INTENSITY} />
      <group position={[0, DEFAULT_GROUND_HEIGHT_M, 0]}>
        <SkyLight />
        <SunLight />
      </group>
      <EffectComposer multisampling={0}>
        <AerialPerspective ref={aerialRef} />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        <SMAA />
      </EffectComposer>
    </Atmosphere>
  )
}

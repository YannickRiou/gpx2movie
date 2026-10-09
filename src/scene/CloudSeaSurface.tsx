/**
 * CloudSeaSurface — the sea of clouds drawn as a lit surface (« Nappe », `settings.clouds.seaRender` 'surface'),
 * inside AtmosphereLayer instead of the volumetric clouds: no ray marching, so no grain, at the cost of a single
 * opaque top (seen from below, an overcast ceiling).
 *
 * One mesh: a radial grid centred under the camera (scene/cloudSea.ts: square cells, dense near the camera, out to
 * the horizon), lifted in the vertex shader to the top of the sea (`seaTopM` × exaggeration, minus the relief) along
 * the curvature of the Earth, and displaced into rolling cumulus billows that drift with the wind of the outing ×
 * film time (same drift as the volumetric clouds). The fragment shader evaluates the same relief per pixel for its
 * normal (octaves smaller than a pixel faded out: noise-free in the distance) and lights it with the sun and sky
 * lights of the atmosphere. The aerial perspective of the composer hazes it like the terrain.
 *
 * Everything is a function of (settings, film time, camera): the export draws the same sea as the preview.
 */
import { useEffect, useMemo, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, ShaderMaterial, Uniform, Vector2, Vector3, type HemisphereLight } from 'three'
import type { SkyLightProbe, SunDirectionalLight } from '@takram/three-atmosphere'
import { samplePath, type TrackPath } from '../flyover/path'
import { useAppStore } from '../state/store'
import { cloudDrift, filmWind } from '../weather/sceneClouds'
import { useWeatherStore } from '../weather/store'
import { buildRadialGrid, seaBaseAltitude, seaReliefGlsl } from './cloudSea'
import { useFilmClock } from './usePacing'

/** Radial grid: first ring, horizon (beyond the loaded terrain, so the sea hides its edge) and sectors. */
const GRID_INNER_M = 8
const GRID_OUTER_M = 300_000
const GRID_SEGMENTS = 256
/** Diffuse reflectance of the cloud tops. */
const SEA_ALBEDO = 0.9
/** Wrap lighting: light still reaches surfaces turned this far from the sun (multiple scattering in the cloud). */
const SEA_WRAP = 0.4

const vertexShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${seaReliefGlsl()}
uniform vec2 seaCenter;
uniform vec2 seaDrift;
uniform float seaBase;
uniform float seaCellRatio;
varying vec3 vSeaWorld;

void main() {
  vec2 xz = seaCenter + position.xz;
  // a vertex draws the octaves larger than a few cells of the grid around it
  float cell = max(length(position.xz), ${GRID_INNER_M}.0) * seaCellRatio;
  float relief = seaRelief(xz - seaDrift, 1.5 * cell);
  vSeaWorld = vec3(xz.x, seaBase + relief - dot(xz, xz) / (2.0 * SEA_EARTH_RADIUS), xz.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(vSeaWorld, 1.0);
  #include <logdepthbuf_vertex>
}
`

const fragmentShader = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${seaReliefGlsl()}
uniform vec2 seaDrift;
uniform vec3 seaSunDirection;
uniform vec3 seaSunIrradiance;
uniform vec3 seaSkyIrradiance;
uniform float seaAlbedo;
varying vec3 vSeaWorld;

void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vSeaWorld.xz - seaDrift;
  float footprint = max(length(fwidth(vSeaWorld.xz)), 0.25);
  float e = max(footprint, 2.0);
  float h = seaRelief(p, footprint);
  // slope of the relief and of the curved Earth
  float dx = (seaRelief(p + vec2(e, 0.0), footprint) - h) / e - vSeaWorld.x / SEA_EARTH_RADIUS;
  float dz = (seaRelief(p + vec2(0.0, e), footprint) - h) / e - vSeaWorld.z / SEA_EARTH_RADIUS;
  vec3 n = normalize(vec3(-dx, 1.0, -dz));
  vec3 L = seaSunDirection;
  float wrapNL = saturate((dot(n, L) + ${SEA_WRAP}) / (1.0 + ${SEA_WRAP}));
  vec3 irradiance = seaSunIrradiance * wrapNL + seaSkyIrradiance * (0.6 + 0.4 * n.y);
  if (!gl_FrontFacing) irradiance = 0.35 * seaSkyIrradiance;
  gl_FragColor = vec4(seaAlbedo * RECIPROCAL_PI * irradiance, 1.0);
}
`

const WORLD_UP = new Vector3(0, 1, 0)
const _irradiance = new Vector3()

function createSeaUniforms(cellRatio: number) {
  return {
    seaCenter: new Uniform(new Vector2()),
    seaDrift: new Uniform(new Vector2()),
    seaBase: new Uniform(0),
    seaCellRatio: new Uniform(cellRatio),
    seaSunDirection: new Uniform(new Vector3(0, 1, 0)),
    seaSunIrradiance: new Uniform(new Vector3()),
    seaSkyIrradiance: new Uniform(new Vector3()),
    seaAlbedo: new Uniform(SEA_ALBEDO),
  }
}

/** The single mesh of the sea: the radial grid, lifted and lit by the shaders. */
function createSeaMesh() {
  const grid = buildRadialGrid(GRID_INNER_M, GRID_OUTER_M, GRID_SEGMENTS)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(grid.positions, 3))
  geometry.setIndex(new BufferAttribute(grid.index, 1))
  const uniforms = createSeaUniforms(grid.cellRatio)
  const mesh = new Mesh(geometry, new ShaderMaterial({ vertexShader, fragmentShader, uniforms, side: DoubleSide }))
  mesh.name = 'cloud-sea'
  // follows the camera: always in view
  mesh.frustumCulled = false
  // never picked: the track picker and the camera target the relief and the track
  mesh.raycast = () => {}
  return { mesh, uniforms }
}

interface CloudSeaSurfaceProps {
  sun: SunDirectionalLight | null
  sky: RefObject<SkyLightProbe | null>
  nightFill: RefObject<HemisphereLight | null>
  path: TrackPath | null
}

export function CloudSeaSurface({ sun, sky, nightFill, path }: CloudSeaSurfaceProps) {
  const track = useAppStore((s) => s.tracks[0])
  const series = useWeatherStore((s) => (track && s.trackId === track.id ? s.series : null))
  const clock = useFilmClock()
  const startTime = track?.stats.startTime
  const start = path && path.count > 0 ? samplePath(path, 0) : null
  const wind = useMemo(
    () => filmWind(series, startTime ?? 0, start?.lon ?? 0, start?.lat ?? 0),
    [series, startTime, start?.lon, start?.lat],
  )

  const { mesh, uniforms } = useMemo(() => createSeaMesh(), [])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    },
    [mesh],
  )

  // Once the Takram lights are updated for this frame (priority 0) and before the composer renders (priority 1).
  useFrame(({ camera }) => {
    const { playback, settings } = useAppStore.getState()
    const u = uniforms
    u.seaCenter.value.set(camera.position.x, camera.position.z)
    const drift = cloudDrift(wind, playback.timeS ?? clock.timeAtProgress(playback.progress))
    // noise point = position − (east, −north) (cloudSea.ts `seaNoisePoint`, +Z south)
    u.seaDrift.value.set(drift.east, -drift.north)
    u.seaBase.value = seaBaseAltitude(settings.clouds.seaTopM, settings.exaggeration)
    const sunIrradiance = u.seaSunIrradiance.value
    if (sun) {
      u.seaSunDirection.value.subVectors(sun.position, sun.target.position).normalize()
      sunIrradiance.set(sun.color.r, sun.color.g, sun.color.b).multiplyScalar(sun.intensity)
    } else sunIrradiance.set(0, 0, 0)
    const skyIrradiance = u.seaSkyIrradiance.value
    const probe = sky.current
    if (probe) skyIrradiance.copy(probe.sh.getIrradianceAt(WORLD_UP, _irradiance)).multiplyScalar(probe.intensity)
    else skyIrradiance.set(0, 0, 0)
    // the faint night fill of the terrain (hemisphere light, irradiance of its sky colour on a level surface)
    const fill = nightFill.current
    if (fill) skyIrradiance.add(_irradiance.set(fill.color.r, fill.color.g, fill.color.b).multiplyScalar(fill.intensity))
  }, 0.5)

  return <primitive object={mesh} dispose={null} />
}

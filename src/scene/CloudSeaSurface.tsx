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
 * lights of the atmosphere (warm at golden hour): wrap lighting, creases darker than the tops, self-shadowing from
 * the relief probed toward the sun, forward scattering through the rims and thin tops when looking toward the sun.
 * The aerial perspective of the composer hazes it like the terrain, into the horizon.
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
import { buildRadialGrid, glslFloat, seaBaseAltitude, seaReliefGlsl } from './cloudSea'
import { useFilmClock } from './usePacing'

/** Radial grid: first ring, horizon (beyond the loaded terrain, so the sea hides its edge) and sectors. */
const GRID_INNER_M = 8
const GRID_OUTER_M = 300_000
const GRID_SEGMENTS = 256
/** Diffuse reflectance of the cloud tops. */
const SEA_ALBEDO = 0.8
/** Wrap lighting: light still reaches surfaces turned this far from the sun (multiple scattering in the cloud). */
const SEA_WRAP = 0.25
/**
 * The normals of the shading follow a relief this many times steeper than the geometry: the domes of cumulus are
 * much rounder than a sea of clouds can be displaced without looking like hills.
 */
const SEA_NORMAL_RELIEF = 2
/** Light left in the deepest creases (sky and light scattered by the billows around). */
const SEA_CREASE_LIGHT = 0.4
/** Forward scattering: Henyey-Greenstein asymmetry and strength of the light scattered through rims and thin tops. */
const SEA_FORWARD_G = 0.6
const SEA_FORWARD = 0.25
/** Sky light under the sea, seen from below (overcast ceiling). */
const SEA_CEILING_LIGHT = 0.35
/**
 * Self-shadowing: the relief probed toward the sun at these distances (metres), octaves smaller than the footprint
 * dropped (their shadows would be grain), soft over this height.
 */
const SHADOW_STEPS_M = [60, 180, 450] as const
const SHADOW_FOOTPRINT_M = 40
const SHADOW_SOFT_M = 25

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
  float cell = max(length(position.xz), ${glslFloat(GRID_INNER_M)}) * seaCellRatio;
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
uniform vec2 seaCenter;
uniform vec2 seaDrift;
uniform vec3 seaSunDirection;
uniform vec3 seaSunIrradiance;
uniform vec3 seaSkyIrradiance;
uniform float seaAlbedo;
varying vec3 vSeaWorld;

// Part of the sun reaching the relief h at p: the coarse relief probed toward the sun at a few distances, against
// the height of the ray there (soft: a billow just grazing the ray dims it).
float seaSunVisibility(vec2 p, vec3 L, float footprint) {
  float run = length(L.xz);
  if (run < 1e-4) return 1.0;
  vec2 dir = L.xz / run;
  float rise = L.y / run;
  float f = max(footprint, ${glslFloat(SHADOW_FOOTPRINT_M)});
  float h = seaRelief(p, f);
  float lit = 1.0 - smoothstep(0.0, ${glslFloat(SHADOW_SOFT_M)}, seaRelief(p + dir * ${glslFloat(SHADOW_STEPS_M[0])}, f) - h - rise * ${glslFloat(SHADOW_STEPS_M[0])});
  lit = min(lit, 1.0 - smoothstep(0.0, ${glslFloat(SHADOW_SOFT_M)}, seaRelief(p + dir * ${glslFloat(SHADOW_STEPS_M[1])}, f) - h - rise * ${glslFloat(SHADOW_STEPS_M[1])}));
  lit = min(lit, 1.0 - smoothstep(0.0, ${glslFloat(SHADOW_SOFT_M)}, seaRelief(p + dir * ${glslFloat(SHADOW_STEPS_M[2])}, f) - h - rise * ${glslFloat(SHADOW_STEPS_M[2])}));
  return lit;
}

// Henyey-Greenstein phase, 1 for an isotropic medium: > 1 looking toward the sun (silver lining)
float seaPhase(float cosTheta) {
  float g = ${glslFloat(SEA_FORWARD_G)};
  return (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5);
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 p = vSeaWorld.xz - seaDrift;
  float footprint = max(length(fwidth(vSeaWorld.xz)), 0.25);
  float e = max(footprint, 2.0);
  float h = seaRelief(p, footprint);
  // slope of the relief (steepened for the shading) and of the curved Earth
  float dx = ${glslFloat(SEA_NORMAL_RELIEF)} * (seaRelief(p + vec2(e, 0.0), footprint) - h) / e - vSeaWorld.x / SEA_EARTH_RADIUS;
  float dz = ${glslFloat(SEA_NORMAL_RELIEF)} * (seaRelief(p + vec2(0.0, e), footprint) - h) / e - vSeaWorld.z / SEA_EARTH_RADIUS;
  vec3 n = normalize(vec3(-dx, 1.0, -dz));
  vec3 L = seaSunDirection;
  vec3 V = normalize(cameraPosition - vSeaWorld);
  // 0 in the deepest creases, 1 on the highest tops
  float top = saturate(h / SEA_RELIEF_M);

  vec3 radiance;
  if (gl_FrontFacing) {
    float sunLit = seaSunVisibility(p, L, footprint);
    // wrap lighting: the light scattered inside the cloud still reaches the slopes turned away from the sun
    float wrapNL = saturate((dot(n, L) + ${glslFloat(SEA_WRAP)}) / (1.0 + ${glslFloat(SEA_WRAP)}));
    // creases see less sky and receive less light scattered by the billows around them
    float occlusion = mix(${glslFloat(SEA_CREASE_LIGHT)}, 1.0, smoothstep(0.1, 0.8, top));
    vec3 direct = seaSunIrradiance * wrapNL * sunLit * occlusion;
    vec3 ambient = seaSkyIrradiance * (0.65 + 0.35 * n.y) * occlusion;
    radiance = seaAlbedo * RECIPROCAL_PI * (direct + ambient);
    // forward scattering toward the sun: bright rims of the billows, thin translucent tops
    float rim = pow(1.0 - saturate(dot(n, V)), 4.0);
    float thin = smoothstep(0.7, 1.0, top);
    radiance += seaSunIrradiance * RECIPROCAL_PI * ${glslFloat(SEA_FORWARD)} * seaPhase(dot(-V, L)) * (0.6 * rim + 0.4 * thin) * mix(0.3, 1.0, sunLit);
  } else {
    // from below: the grey ceiling of an overcast sky
    radiance = seaAlbedo * RECIPROCAL_PI * (${glslFloat(SEA_CEILING_LIGHT)} * seaSkyIrradiance + 0.05 * max(L.y, 0.0) * seaSunIrradiance);
  }
  // the rim of the grid, far beyond the haze, fades out
  float rimDistance = length(vSeaWorld.xz - seaCenter);
  float alpha = 1.0 - smoothstep(${glslFloat(0.75 * GRID_OUTER_M)}, ${glslFloat(GRID_OUTER_M)}, rimDistance);
  gl_FragColor = vec4(radiance, alpha);
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
  const material = new ShaderMaterial({ vertexShader, fragmentShader, uniforms, side: DoubleSide, transparent: true })
  const mesh = new Mesh(geometry, material)
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

/**
 * WaterLayer — lakes and rivers of OpenStreetMap (osm/water.ts) as a reflective water surface slightly above the
 * relief, inside TerrainLayer.
 *
 * Geometry: each polygon is meshed once (scene/waterMesh.ts: grid cells inside the water, fade from the shore), then
 * draped like the track (`engine.sampleHeight` × exaggeration + WATER_LIFT_M) and re-draped (debounced, flushed by
 * the video export) when tiles arrive. A lake is flat at a low percentile of its heights (the DEM of its banks does
 * not lift it), a river area follows its valley. One merged geometry, one draw call.
 *
 * Shading: MeshStandardMaterial (sun light, sun glint of a low roughness, relief shadows) extended in
 * `onBeforeCompile`: normals of four gentle waves (directional sines animated by the film time, faded out when
 * smaller than a few pixels, no shimmer in the distance), Fresnel reflection of the sky (radiance of the sky light
 * probe of the atmosphere in the reflected direction, else a fixed sky colour), opacity = shore fade ×
 * mix(WATER_OPACITY, 1, Fresnel) × strength. Everything is a function of the film time: the export is deterministic.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Color, Mesh, MeshStandardMaterial, Uniform, Vector3 } from 'three'
import type { LocalFrame, TerrainEngine } from '../core/types'
import { registerDrapeFlush } from '../export/store'
import { useWaterStore } from '../osm/store'
import { fetchTrackWater, type WaterPolygon } from '../osm/water'
import { useAppStore } from '../state/store'
import { useDebouncedCallback } from './useDebouncedCallback'
import { REDRAPE_DEBOUNCE_MS, REDRAPE_MAX_WAIT_MS } from './TrackLines'
import { useTerrainContext } from './TerrainLayer'
import { wakeScene } from './renderOnDemand'
import { useFilmClock } from './usePacing'
import { buildWaterMesh, type WaterMesh } from './waterMesh'

/** Height of the surface above the draped relief (metres, not exaggerated: like the track). */
export const WATER_LIFT_M = 2
/** Percentile of the heights of a lake taken as its level. */
const LAKE_LEVEL_PERCENTILE = 0.25
/** Deep alpine lake. */
const WATER_COLOR = '#1F4252'
/** Opacity seen from above; grazing angles reflect almost everything (Fresnel). */
const WATER_OPACITY = 0.82
/** Sky reflected without the atmosphere (glacier sky of the plain lighting, linear). */
const PLAIN_SKY = new Color('#A9CCD9')

const vertexHead = /* glsl */ `
attribute float waterFade;
varying float vWaterFade;
varying vec2 vWaterXZ;
`
const vertexBody = /* glsl */ `
vWaterFade = waterFade;
vWaterXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
`
const fragmentHead = /* glsl */ `
uniform float waterTime;
uniform float waterStrength;
uniform float waterOpacity;
uniform vec3 waterSkyColor;
varying float vWaterFade;
varying vec2 vWaterXZ;

// slope of h = a·sin(k·(d·p − c·t)), faded out when the wavelength covers less than ~8 pixels
vec2 waterWave(vec2 p, vec2 dir, float wavelength, float amplitude, float speed) {
  float k = 6.2831853 / wavelength;
  float aa = clamp(wavelength / (8.0 * length(fwidth(p))) - 0.5, 0.0, 1.0);
  return dir * (amplitude * k * cos(k * (dot(dir, p) - speed * waterTime)) * aa);
}
`
const fragmentNormal = /* glsl */ `
{
  vec2 slope = waterWave(vWaterXZ, vec2(0.80, 0.60), 23.0, 0.10, 1.5)
    + waterWave(vWaterXZ, vec2(-0.50, 0.866), 9.0, 0.035, 1.0)
    + waterWave(vWaterXZ, vec2(0.96, -0.28), 4.1, 0.014, 0.7)
    + waterWave(vWaterXZ, vec2(-0.20, -0.98), 1.7, 0.005, 0.45);
  normal = normalize((viewMatrix * vec4(normalize(vec3(-slope.x, 1.0, -slope.y)), 0.0)).xyz);
}
`
const fragmentReflection = /* glsl */ `
{
  float waterCos = saturate(dot(normal, geometryViewDir));
  float fresnel = 0.02 + 0.98 * pow(1.0 - waterCos, 5.0);
  #ifdef USE_LIGHT_PROBES
  // irradiance / π is the cosine-weighted mean radiance around the reflected ray: it averages the bright horizon
  // with the dark sky below it, hence the ray kept above the horizon and a gain
  vec3 ray = inverseTransformDirection(reflect(-geometryViewDir, normal), viewMatrix);
  ray = normalize(vec3(ray.x, max(ray.y, 0.15), ray.z));
  vec3 sky = 1.5 * shGetIrradianceAt(ray, lightProbe) / PI;
  #else
  vec3 sky = waterSkyColor;
  #endif
  reflectedLight.indirectSpecular += sky * fresnel * waterStrength;
  diffuseColor.a = vWaterFade * mix(waterOpacity, 1.0, fresnel) * waterStrength;
}
`

function createWaterMaterial(uniforms: Record<string, Uniform>): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: WATER_COLOR,
    roughness: 0.08,
    metalness: 0,
    transparent: true,
    depthWrite: false,
  })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = vertexHead + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexBody}`)
    shader.fragmentShader =
      fragmentHead +
      shader.fragmentShader
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${fragmentNormal}`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${fragmentReflection}`)
  }
  material.customProgramCacheKey = () => 'openflyover-water'
  return material
}

/** Height of each vertex of `mesh` (metres, before exaggeration), NaN where the relief is not loaded yet. */
function sampleHeights(mesh: WaterMesh, engine: TerrainEngine | null): Float64Array {
  const count = mesh.fade.length
  const heights = new Float64Array(count)
  for (let v = 0; v < count; v++) heights[v] = engine?.sampleHeight(mesh.lonLat[2 * v], mesh.lonLat[2 * v + 1]) ?? Number.NaN
  return heights
}

/** Low percentile of the known heights, NaN when none is known. */
function lakeLevel(heights: Float64Array): number {
  const known = Array.from(heights).filter((h) => !Number.isNaN(h)).sort((a, b) => a - b)
  return known.length === 0 ? Number.NaN : known[Math.floor((known.length - 1) * LAKE_LEVEL_PERCENTILE)]
}

const _p = new Vector3()

/** Merged geometry of every draped polygon whose relief is known (lakes flat, rivers per vertex). */
function drapeWater(
  meshes: readonly { polygon: WaterPolygon; mesh: WaterMesh }[],
  engine: TerrainEngine | null,
  frame: LocalFrame,
  exaggeration: number,
): BufferGeometry {
  const positions: number[] = []
  const fades: number[] = []
  const index: number[] = []
  for (const { polygon, mesh } of meshes) {
    const heights = sampleHeights(mesh, engine)
    const level = lakeLevel(heights)
    if (Number.isNaN(level)) continue
    const base = positions.length / 3
    for (let v = 0; v < mesh.fade.length; v++) {
      const h = polygon.kind === 'lake' || Number.isNaN(heights[v]) ? level : heights[v]
      frame.toLocal(mesh.lonLat[2 * v], mesh.lonLat[2 * v + 1], h * exaggeration + WATER_LIFT_M, _p)
      positions.push(_p.x, _p.y, _p.z)
      fades.push(mesh.fade[v])
    }
    for (const i of mesh.index) index.push(base + i)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  // up everywhere: the waves of the shader perturb the world vertical
  const normals = new Float32Array(positions.length)
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('waterFade', new BufferAttribute(new Float32Array(fades), 1))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}

export function WaterLayer() {
  const { engine, frame } = useTerrainContext()
  const track = useAppStore((s) => s.tracks[0])
  const enabled = useAppStore((s) => s.settings.water.enabled)
  const exaggeration = useAppStore((s) => s.settings.exaggeration)
  const clock = useFilmClock()
  /** water of the track it was fetched for (shown only for the current first track, setting on) */
  const [fetched, setFetched] = useState<{ trackId: string; polygons: WaterPolygon[] } | null>(null)
  const polygons = useMemo(() => (enabled && fetched && fetched.trackId === track?.id ? fetched.polygons : []), [enabled, fetched, track])
  const uniforms = useMemo(
    () => ({
      waterTime: new Uniform(0),
      waterStrength: new Uniform(1),
      waterOpacity: new Uniform(WATER_OPACITY),
      waterSkyColor: new Uniform(PLAIN_SKY.clone()),
    }),
    [],
  )
  const mesh = useMemo(() => {
    const m = new Mesh(new BufferGeometry(), createWaterMaterial(uniforms))
    m.name = 'water'
    m.receiveShadow = true
    // never picked: the track picker and the camera target the relief and the track
    m.raycast = () => {}
    return m
  }, [uniforms])
  useEffect(
    () => () => {
      mesh.geometry.dispose()
      mesh.material.dispose()
    },
    [mesh],
  )

  // one Overpass query per track (cached); nothing is sent while the setting is off
  useEffect(() => {
    if (!enabled || !track) return
    // not aborted on cleanup: the query is shared and cached (StrictMode runs this effect twice), only its
    // answer is ignored once stale
    let current = true
    const trackId = track.id
    fetchTrackWater(track).then(
      (result) => current && setFetched({ trackId, polygons: result }),
      () => current && setFetched({ trackId, polygons: [] }),
    )
    return () => {
      current = false
    }
  }, [enabled, track])
  useEffect(() => useWaterStore.setState({ polygons: polygons.length }), [polygons])
  useEffect(() => () => useWaterStore.setState({ polygons: 0 }), [])

  const meshes = useMemo(() => polygons.map((polygon) => ({ polygon, mesh: buildWaterMesh(polygon) })), [polygons])
  const drape = useCallback(
    (current: TerrainEngine | null, factor: number) => {
      if (!frame) return
      const previous = mesh.geometry
      mesh.geometry = drapeWater(meshes, current, frame, factor)
      previous.dispose()
      wakeScene()
    },
    [mesh, frame, meshes],
  )
  useEffect(() => drape(engine, exaggeration), [drape, engine, exaggeration])

  const redrape = useDebouncedCallback(drape, REDRAPE_DEBOUNCE_MS, REDRAPE_MAX_WAIT_MS)
  useEffect(() => {
    if (!engine) return
    const unsubscribe = engine.onChange(() => redrape(engine, exaggeration))
    return () => {
      unsubscribe()
      redrape.cancel()
    }
  }, [engine, exaggeration, redrape])
  // the video export runs the pending re-drape right away instead of waiting for the debounce
  useEffect(
    () =>
      registerDrapeFlush(() => {
        const pending = redrape.isPending()
        redrape.flush()
        return pending
      }),
    [redrape],
  )

  useFrame(() => {
    const { playback, settings } = useAppStore.getState()
    uniforms.waterTime.value = playback.timeS ?? clock.timeAtProgress(playback.progress)
    uniforms.waterStrength.value = Math.min(1, Math.max(0, settings.water.strength))
  })

  if (polygons.length === 0) return null
  return <primitive object={mesh} dispose={null} />
}

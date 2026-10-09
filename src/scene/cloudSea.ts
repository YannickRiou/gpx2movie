/**
 * Surface sea of clouds (« Nappe », scene/CloudSeaSurface.tsx): the relief of its rolling cumulus tops, its drift
 * with the wind, its soft edge against the terrain, the camera-centred radial grid it is drawn on and the grid of
 * terrain heights its shader compares it with.
 *
 * Relief: octaves of billows (domes on a jittered grid, the highest one wins: rounded tops, sharp creases where two
 * meet, cauliflower once stacked) from ~2 km down to ~100 m over a gentle swell, in a domain warped by a low-frequency noise so the cells do not line up. Each octave
 * fades to its mean once its wavelength covers fewer than LOD_SAMPLES pixels (or grid cells): nothing smaller than a
 * pixel is drawn, the surface stays noise-free in the distance. `seaRelief` is the reference of the GLSL written by
 * `seaReliefGlsl` (same constants and formulas, double here, single precision there): tested here, drawn there.
 *
 * Everything is a function of (position, drift): the drift is wind × film time (weather/sceneClouds.ts), so the
 * export draws the same sea as the preview for the same frame.
 *
 * Pure functions (no DOM, no React, no Three).
 */
import { clamp } from '../core/math'
import type { Wind } from '../weather/sceneClouds'

export interface SeaOctave {
  wavelengthM: number
  amplitudeM: number
}

/** Slow swell under the billows: the sea rises and dips gently over kilometres. */
export const SEA_SWELL: SeaOctave = { wavelengthM: 9000, amplitudeM: 35 }
/** Cumulus billows, largest first (amplitudes in metres, not exaggerated: like the thickness of the volumetric layer). */
export const SEA_BILLOWS: readonly SeaOctave[] = [
  { wavelengthM: 2200, amplitudeM: 75 },
  { wavelengthM: 1050, amplitudeM: 50 },
  { wavelengthM: 500, amplitudeM: 30 },
  { wavelengthM: 240, amplitudeM: 16 },
  { wavelengthM: 110, amplitudeM: 8 },
]
/** Domain warp: the billows are pushed around by up to this many metres, over this wavelength. */
const WARP: SeaOctave = { wavelengthM: 3200, amplitudeM: 380 }
/** Highest relief (metres): the tops reach the top of the sea, the creases go down to the top minus this. */
export const SEA_RELIEF_M = SEA_SWELL.amplitudeM + SEA_BILLOWS.reduce((sum, o) => sum + o.amplitudeM, 0)
/** Radius of a billow (cells): gaps between the domes go down to the bottom of the octave. */
const DOME_RADIUS = 0.75
/** Width of the smooth maximum between two domes (rounded rather than knife-edged creases). */
const DOME_BLEND = 0.25
/** Mean of a billow octave (`billow` over the plane), the value of an octave faded out. */
export const BILLOW_MEAN = 0.81
/** An octave is fully drawn above LOD_SAMPLES pixels (or cells) per wavelength, gone below half of that. */
export const LOD_SAMPLES = 6
/** Each octave is turned by this angle from the previous one and offset (no lattice alignment between octaves). */
const OCTAVE_TURN_RAD = 1.1
const OCTAVE_SHIFT = [17.3, 31.7] as const

/** Mean radius of the Earth (metres): the sea follows the curvature like the volumetric layer. */
export const EARTH_RADIUS_M = 6_371_000
/** Opacity fades over this thickness of cloud above the terrain (metres, × exaggeration): summits emerge softly. */
export const EDGE_FADE_M = 120
/** Altitude stored where the terrain is unknown (far below any sea: opaque cloud). */
export const NO_TERRAIN_M = -10_000

const fract = (x: number) => x - Math.floor(x)

/** Pseudo-random gradient of the lattice point (ix, iy), components in [-1, 1] (hash without sine, D. Hoskins). */
function gradient(ix: number, iy: number): [number, number] {
  let x = fract(ix * 0.1031)
  let y = fract(iy * 0.103)
  let z = fract(ix * 0.0973)
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33)
  x += d
  y += d
  z += d
  return [fract((x + y) * z) * 2 - 1, fract((x + z) * y) * 2 - 1]
}

/** 2D gradient noise, quintic fade (smooth normals), about [-0.7, 0.7]. */
export function gradientNoise(px: number, py: number): number {
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  const fx = px - ix
  const fy = py - iy
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
  const corner = (cx: number, cy: number) => {
    const g = gradient(ix + cx, iy + cy)
    return g[0] * (fx - cx) + g[1] * (fy - cy)
  }
  const a = corner(0, 0)
  const b = corner(1, 0)
  const c = corner(0, 1)
  const d = corner(1, 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

/**
 * Billows of one octave at (px, py) (in cells), [0, 1]: a rounded dome of DOME_RADIUS cells over a point jittered
 * in each cell (t (2 − t), t = 1 − (d / radius)²: round top, finite slope at its foot), the highest of the 3 × 3
 * cells around wins (smooth maximum: rounded creases).
 */
export function billow(px: number, py: number): number {
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  let best = 0
  for (let cy = -1; cy <= 1; cy++) {
    for (let cx = -1; cx <= 1; cx++) {
      const g = gradient(ix + cx, iy + cy)
      const dx = cx + 0.5 + 0.4 * g[0] - (px - ix)
      const dy = cy + 0.5 + 0.4 * g[1] - (py - iy)
      const t = 1 - Math.min(1, (dx * dx + dy * dy) / (DOME_RADIUS * DOME_RADIUS))
      // smooth maximum, rounded creases where two domes meet (narrower at a foot: nothing between the domes)
      const w = Math.min(DOME_BLEND, t)
      const k = w > 0 ? Math.max(w - Math.abs(best - t), 0) / w : 0
      best = Math.max(best, t) + k * k * w * 0.25
    }
  }
  best = Math.min(best, 1)
  return best * (2 - best)
}

/** Part of an octave drawn for a footprint (metres per pixel or per cell); 0 = no footprint, fully drawn. */
export function octaveWeight(wavelengthM: number, footprintM: number): number {
  if (!(footprintM > 0)) return 1
  return clamp(wavelengthM / (LOD_SAMPLES * footprintM) - 0.5, 0, 1)
}

/**
 * Relief of the sea at the noise point (x, z) (local metres, see `seaNoisePoint`), in [0, SEA_RELIEF_M]: 0 at the
 * bottom of the deepest crease, SEA_RELIEF_M at the top of the highest billow. Octaves smaller than the footprint
 * are replaced by their mean.
 */
export function seaRelief(x: number, z: number, footprintM = 0): number {
  const kw = 1 / WARP.wavelengthM
  const wx = x + WARP.amplitudeM * gradientNoise(x * kw + 5.2, z * kw + 1.3)
  const wz = z + WARP.amplitudeM * gradientNoise(x * kw + 9.7, z * kw + 7.1)
  const ks = 1 / SEA_SWELL.wavelengthM
  const swell = 0.5 + 0.5 * clamp(1.4 * gradientNoise(wx * ks, wz * ks), -1, 1)
  const ws = octaveWeight(SEA_SWELL.wavelengthM, footprintM)
  let h = SEA_SWELL.amplitudeM * (ws * swell + (1 - ws) * 0.5)
  SEA_BILLOWS.forEach((octave, i) => {
    const w = octaveWeight(octave.wavelengthM, footprintM)
    let b = BILLOW_MEAN
    if (w > 0) {
      const angle = i * OCTAVE_TURN_RAD
      const c = Math.cos(angle) / octave.wavelengthM
      const s = Math.sin(angle) / octave.wavelengthM
      b = w * billow(c * wx - s * wz + OCTAVE_SHIFT[0] * i, s * wx + c * wz + OCTAVE_SHIFT[1] * i) + (1 - w) * BILLOW_MEAN
    }
    h += octave.amplitudeM * b
  })
  return h
}

/**
 * Noise point of the local position (x, z) (+X east, +Z south) after a drift of the clouds (metres east / north,
 * `cloudDrift`): the pattern seen at (x, z) is the one that stood at (x − east, z + north).
 */
export function seaNoisePoint(x: number, z: number, drift: Wind): [number, number] {
  return [x - drift.east, z + drift.north]
}

/** Altitude of the bottom of the creases (metres above sea level, scene scale): the top of the sea minus its relief. */
export function seaBaseAltitude(seaTopM: number, exaggeration: number): number {
  const k = Number.isFinite(exaggeration) && exaggeration > 0 ? exaggeration : 1
  return seaTopM * k - SEA_RELIEF_M
}

/** Drop of the curved Earth below the tangent plane of the local frame at a horizontal distance from its origin. */
export function curvatureDropM(x: number, z: number): number {
  return (x * x + z * z) / (2 * EARTH_RADIUS_M)
}

/** Opacity of the cloud at `cloudAltM` over terrain at `terrainAltM`: 0 at contact, 1 from `fadeM` of cloud above it. */
export function edgeFade(cloudAltM: number, terrainAltM: number, fadeM: number): number {
  const t = clamp((cloudAltM - terrainAltM) / Math.max(fadeM, 1e-6), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Opacity toward the rim of the grid: 1 up to 75 % of `outerM`, then a smooth fade to 0 at `outerM`. */
export function rimFade(distanceM: number, outerM: number): number {
  const t = clamp((distanceM - 0.75 * outerM) / (0.25 * outerM), 0, 1)
  return 1 - t * t * (3 - 2 * t)
}

// ---------------------------------------------------------------------------
// Grids
// ---------------------------------------------------------------------------

export interface RadialGrid {
  /** x, 0, z of each vertex: offsets from the centre (the camera) */
  positions: Float32Array
  /** three vertex indices per triangle, facing up (+Y) */
  index: Uint32Array
  /** size of a cell / distance from the centre (rings grow geometrically, cells stay square) */
  cellRatio: number
}

/**
 * Disc of `segments` sectors around a centre vertex, rings from `innerM` growing by 1 + 2π / segments to `outerM`:
 * square cells, as dense near the centre (the camera) as they are coarse at the horizon, where they cover the same
 * angle on screen.
 */
export function buildRadialGrid(innerM: number, outerM: number, segments: number): RadialGrid {
  const ratio = (2 * Math.PI) / segments
  const radii: number[] = []
  for (let r = innerM; r < outerM; r *= 1 + ratio) radii.push(r)
  radii.push(outerM)
  const positions = new Float32Array(3 * (1 + radii.length * segments))
  radii.forEach((r, ring) => {
    for (let s = 0; s < segments; s++) {
      const angle = s * ratio
      const v = 3 * (1 + ring * segments + s)
      positions[v] = r * Math.cos(angle)
      positions[v + 2] = -r * Math.sin(angle)
    }
  })
  const index = new Uint32Array(3 * segments * (1 + 2 * (radii.length - 1)))
  let i = 0
  const at = (ring: number, s: number) => 1 + ring * segments + (s % segments)
  for (let s = 0; s < segments; s++) {
    index[i++] = 0
    index[i++] = at(0, s)
    index[i++] = at(0, s + 1)
  }
  for (let ring = 0; ring < radii.length - 1; ring++) {
    for (let s = 0; s < segments; s++) {
      const a = at(ring, s)
      const b = at(ring + 1, s)
      const c = at(ring + 1, s + 1)
      const d = at(ring, s + 1)
      index[i++] = a
      index[i++] = b
      index[i++] = c
      index[i++] = a
      index[i++] = c
      index[i++] = d
    }
  }
  return { positions, index, cellRatio: ratio }
}

/** Horizontal rectangle of the local frame (metres). */
export interface TerrainBox {
  minX: number
  minZ: number
  sizeX: number
  sizeZ: number
}

/** Smallest box holding the points (x, z). */
export function terrainBoxOf(points: readonly { x: number; z: number }[]): TerrainBox {
  const xs = points.map((p) => p.x)
  const zs = points.map((p) => p.z)
  const minX = Math.min(...xs)
  const minZ = Math.min(...zs)
  return { minX, minZ, sizeX: Math.max(...xs) - minX, sizeZ: Math.max(...zs) - minZ }
}

/** Centres of the texels of an n × n grid over `box`, as x, z pairs (row-major, rows along +Z), where a texture samples them. */
export function terrainGridCentres(box: TerrainBox, n: number): Float64Array {
  const out = new Float64Array(2 * n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      out[2 * (j * n + i)] = box.minX + ((i + 0.5) / n) * box.sizeX
      out[2 * (j * n + i) + 1] = box.minZ + ((j + 0.5) / n) * box.sizeZ
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

/** GLSL float literal of a number. */
export function glslFloat(x: number): string {
  return Number.isInteger(x) ? `${x}.0` : `${x}`
}
const f = glslFloat

/**
 * GLSL of `seaRelief` (`float seaRelief(vec2 p, float footprint)`) and of the constants the shaders share with this
 * module (SEA_RELIEF_M, EARTH_RADIUS_M, NO_TERRAIN_M).
 */
export function seaReliefGlsl(): string {
  const octaves = SEA_BILLOWS.map((octave, i) => {
    const c = Math.cos(i * OCTAVE_TURN_RAD) / octave.wavelengthM
    const s = Math.sin(i * OCTAVE_TURN_RAD) / octave.wavelengthM
    return /* glsl */ `
  w = seaOctaveWeight(${f(octave.wavelengthM)}, footprint);
  b = SEA_BILLOW_MEAN;
  if (w > 0.0) {
    b = mix(SEA_BILLOW_MEAN, seaBillow(vec2(${f(c)} * q.x - ${f(s)} * q.y + ${f(OCTAVE_SHIFT[0] * i)}, ${f(s)} * q.x + ${f(c)} * q.y + ${f(OCTAVE_SHIFT[1] * i)})), w);
  }
  h += ${f(octave.amplitudeM)} * b;`
  }).join('')
  return /* glsl */ `
#define SEA_RELIEF_M ${f(SEA_RELIEF_M)}
#define SEA_EARTH_RADIUS ${f(EARTH_RADIUS_M)}
#define SEA_NO_TERRAIN ${f(NO_TERRAIN_M)}
#define SEA_BILLOW_MEAN ${f(BILLOW_MEAN)}

vec2 seaGradient(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}

float seaNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(seaGradient(i), f);
  float b = dot(seaGradient(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(seaGradient(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(seaGradient(i + vec2(1.0)), f - vec2(1.0));
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}

float seaBillow(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  float best = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 c = vec2(float(x), float(y));
      vec2 d = c + 0.5 + 0.4 * seaGradient(i + c) - f;
      float t = 1.0 - min(1.0, dot(d, d) * ${f(1 / (DOME_RADIUS * DOME_RADIUS))});
      float w = min(${f(DOME_BLEND)}, t);
      float k = w > 0.0 ? max(w - abs(best - t), 0.0) / w : 0.0;
      best = max(best, t) + k * k * w * 0.25;
    }
  }
  best = min(best, 1.0);
  return best * (2.0 - best);
}

float seaOctaveWeight(float wavelength, float footprint) {
  return footprint > 0.0 ? clamp(wavelength / (${f(LOD_SAMPLES)} * footprint) - 0.5, 0.0, 1.0) : 1.0;
}

float seaRelief(vec2 p, float footprint) {
  vec2 kp = p * ${f(1 / WARP.wavelengthM)};
  vec2 q = p + ${f(WARP.amplitudeM)} * vec2(seaNoise(kp + vec2(5.2, 1.3)), seaNoise(kp + vec2(9.7, 7.1)));
  float w = seaOctaveWeight(${f(SEA_SWELL.wavelengthM)}, footprint);
  float swell = 0.5 + 0.5 * clamp(1.4 * seaNoise(q * ${f(1 / SEA_SWELL.wavelengthM)}), -1.0, 1.0);
  float h = ${f(SEA_SWELL.amplitudeM)} * mix(0.5, swell, w);
  float b;${octaves}
  return h;
}
`
}

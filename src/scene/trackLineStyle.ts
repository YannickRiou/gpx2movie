/**
 * Style of the track lines (`settings.trackStyle`) for TrackLines: the glow material, the dash pattern and its scale,
 * and the « trace qui se dessine » cut. Three.js only, no React.
 *
 * Dashes: LineMaterial measures them in world units. To keep them a few pixels long whatever the zoom, the scale
 * follows the camera distance rounded to a power of two: the dashes stay put on the ground while the camera flies.
 * Draw-on: each segment draws its pieces up to the marker (`instanceCount`) and the last one is shortened by moving its
 * end vertex in the shared buffer (restored afterwards). The distance comes from the playback progress, so the preview
 * and the export draw the same line.
 */
import { CustomBlending, MaxEquation } from 'three'
import type { Camera, Color, InterleavedBufferAttribute, Vector3 } from 'three'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import type { TrackDash, TrackStyle } from './markerSettings'

/** Dash and gap of the patterns, in line widths. */
export const DASH_PATTERNS: Record<Exclude<TrackDash, 'plein'>, { dash: number; gap: number }> = {
  tirets: { dash: 3, gap: 2 },
  points: { dash: 1, gap: 1.5 },
}
/** Default strength of a glow at its centre (times its colour), fading to 0 at its edge. */
export const GLOW_STRENGTH = 0.55
/** Strength of the track glow at « Intensité du halo » 100 %: above 1 it is brighter than the line it borders. */
export const TRACK_GLOW_MAX_STRENGTH = 2

// ---------------------------------------------------------------------------
// Glow
// ---------------------------------------------------------------------------

const FRAGMENT_OUTPUT = 'gl_FragColor = vec4( diffuseColor.rgb, alpha );'
/**
 * Fade from `glowInner` (the edge of the line drawn over it, as a fraction of the half-width; 0 = the centre) to the
 * edge (`vUv.x` across the line, `vUv.y` beyond ±1 in the round caps); nothing inside, so the line keeps its colour.
 * Written with MAX blending: where neighbouring pieces overlap at a joint the result does not add up into beads (nor
 * into an opaque line far away), and the glow lightens dark ground with the track colour.
 */
const GLOW_OUTPUT = `
  float glowR = abs( vUv.y ) > 1.0 ? length( vec2( vUv.x, abs( vUv.y ) - 1.0 ) ) : abs( vUv.x );
  float glowFade = glowR < glowInner ? 0.0 : 1.0 - smoothstep( glowInner, 1.0, glowR );
  gl_FragColor = vec4( diffuseColor.rgb * glowFade * glowFade * glowStrength, 1.0 );
`

export function createGlowMaterial(color: Color, width: number, height: number): LineMaterial {
  const material = new LineMaterial({
    color,
    worldUnits: false,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: MaxEquation,
  })
  material.resolution.set(width, height)
  // set with `setGlow`
  material.uniforms.glowStrength = { value: GLOW_STRENGTH }
  material.uniforms.glowInner = { value: 0 }
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = `uniform float glowStrength;\nuniform float glowInner;\n${shader.fragmentShader.replace(FRAGMENT_OUTPUT, GLOW_OUTPUT)}`
  }
  // a different program than the plain line material, whose source is the same before the patch
  material.customProgramCacheKey = () => 'track-glow'
  return material
}

// ---------------------------------------------------------------------------
// Width and dashes
// ---------------------------------------------------------------------------

/** Strength of a glow material where it starts, and the part of its half-width covered by the line (0..1). */
export function setGlow(material: LineMaterial, strength: number, inner: number): void {
  material.uniforms.glowStrength.value = strength
  material.uniforms.glowInner.value = inner
}

/** Width in canvas pixels of the line, or of its glow, for this style. */
export function lineWidthPx(style: TrackStyle, renderScale: number, glow = false): number {
  return (glow ? style.glowWidth : style.width) * renderScale
}

/**
 * World length of one pixel at `distance` from a perspective camera (viewport `heightPx` tall), rounded to a
 * power of two so that the dash pattern does not crawl along the line while the camera moves.
 */
export function quantizedPixelSize(distance: number, camera: Camera, heightPx: number): number {
  const pixel = (2 * distance) / (camera.projectionMatrix.elements[5] * Math.max(1, heightPx))
  return 2 ** Math.round(Math.log2(Math.max(pixel, 1e-6)))
}

/**
 * Dash settings of a line material: off for 'plein'; otherwise the pattern in pixels of a `pixelSize` world
 * length (`quantizedPixelSize`). Changing `dashed` recompiles the material, so it is only set when it changes.
 */
export function applyDash(material: LineMaterial, style: TrackStyle, renderScale: number, pixelSize: number): void {
  const dashed = style.dash !== 'plein'
  if (material.dashed !== dashed) {
    material.dashed = dashed
    material.needsUpdate = true
  }
  if (style.dash === 'plein') return
  const { dash, gap } = DASH_PATTERNS[style.dash]
  const px = style.width * renderScale
  material.dashScale = 1 / pixelSize
  material.dashSize = dash * px
  material.gapSize = gap * px
}

// ---------------------------------------------------------------------------
// Draw-on
// ---------------------------------------------------------------------------

/**
 * Pieces of a polyline (`dist` per point) drawn up to `distanceM`: `count` pieces, the last one drawn over the
 * fraction `t` of its length (1 = whole). `count` is 0 before the polyline and `dist.length - 1` past its end.
 */
export function cutAt(dist: Float64Array, distanceM: number): { count: number; t: number } {
  const last = dist.length - 1
  if (last < 1 || distanceM <= dist[0]) return { count: 0, t: 1 }
  if (distanceM >= dist[last]) return { count: last, t: 1 }
  // first point beyond the distance, by bisection
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (dist[mid] <= distanceM) lo = mid
    else hi = mid
  }
  const span = dist[hi] - dist[lo]
  return { count: hi, t: span > 0 ? (distanceM - dist[lo]) / span : 1 }
}

/** The part of a segment the draw-on changes: its geometry, draped points and point distances. */
export interface CuttableLine {
  geometry: LineGeometry
  /** draped xyz per point, as written into the geometry */
  positions: Float32Array
  dist: Float64Array
  /** piece whose end vertex is moved to the marker, -1 for none */
  shortened: number
}

function setPieceEnd(line: CuttableLine, piece: number, x: number, y: number, z: number): void {
  const end = line.geometry.getAttribute('instanceEnd') as InterleavedBufferAttribute | undefined
  if (!end?.isInterleavedBufferAttribute) return
  end.setXYZ(piece, x, y, z)
  end.data.needsUpdate = true
}

/** Undo the shortening of the last drawn piece (its end back on the next draped point). */
export function restorePiece(line: CuttableLine): void {
  if (line.shortened < 0) return
  const o = (line.shortened + 1) * 3
  setPieceEnd(line, line.shortened, line.positions[o], line.positions[o + 1], line.positions[o + 2])
  line.shortened = -1
}

/** Draw `line` up to `distanceM` (Infinity = whole). */
export function cutLine(line: CuttableLine, distanceM: number): void {
  restorePiece(line)
  const { count, t } = cutAt(line.dist, distanceM)
  line.geometry.instanceCount = count
  if (count === 0 || t >= 1) return
  const piece = count - 1
  const a = piece * 3
  const p = line.positions
  setPieceEnd(line, piece, p[a] + (p[a + 3] - p[a]) * t, p[a + 1] + (p[a + 4] - p[a + 1]) * t, p[a + 2] + (p[a + 5] - p[a + 2]) * t)
  line.shortened = piece
}

/** Distance from `camera` to what it looks at (`target`), for the dash scale. */
export function viewDistance(camera: Camera, target: Vector3 | null): number {
  return target ? camera.position.distanceTo(target) : camera.position.length()
}

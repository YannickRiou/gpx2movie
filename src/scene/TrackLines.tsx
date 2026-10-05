/**
 * TrackLines — draws every loaded track draped on the terrain.
 *
 * Per track segment: one Line2 (solid, 4 px) plus a "ghost" clone rendered without depth test at 25 %
 * opacity, so the parts hidden by the relief are still hinted. Start / end markers are small spheres.
 *
 * Draping is cheap to redo: each densified point stores its local position at height 0 and its local "up"
 * vector (both exact, derived from the ellipsoid), so re-draping is `base + up * height` with no trigonometry.
 * It runs when tracks or the frame change, when the exaggeration changes, and (debounced) whenever the
 * terrain engine reports new tiles.
 *
 * Three.js objects are managed imperatively inside one <group>: buffers are updated in place when the
 * point count is unchanged (no GPU buffer churn), and everything is disposed on unmount.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import {
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type InterleavedBufferAttribute,
} from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { LocalFrame, TerrainEngine, Track, TrackPoint } from '../core/types'
import { densify } from '../import/stats'
import { useAppStore } from '../state/store'
import { useTerrainContext } from './TerrainLayer'
import { useDebouncedCallback } from './useDebouncedCallback'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Line width in CSS pixels (LineMaterial with worldUnits = false). */
export const LINE_WIDTH_PX = 4
/** Maximum spacing between consecutive points after densification (metres). */
export const DENSIFY_STEP_M = 10
/** Vertical lift above the (exaggerated) terrain so the line is never z-fighting with it (metres). */
export const LINE_LIFT_M = 3
/** Opacity of the depth-test-free pass that hints hidden portions. */
export const GHOST_OPACITY = 0.25
/** Delay between a terrain change and the re-drape (milliseconds). */
export const REDRAPE_DEBOUNCE_MS = 150
/**
 * While tiles stream in, the engine reports a change almost every frame; a trailing-only debounce would
 * leave the line at its recorded elevation (often under the relief) until loading pauses. This bounds the
 * wait: the line is re-draped at least this often during a burst of changes (milliseconds).
 */
export const REDRAPE_MAX_WAIT_MS = 600
/** Start / end marker spheres (metres, true scale). */
export const MARKER_RADIUS_M = 12
export const START_COLOR = '#024442'
export const END_COLOR = '#DBE64C'

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Terrain height sampler (metres, true scale) or undefined when unknown. */
export type HeightSampler = (lon: number, lat: number) => number | undefined

/**
 * Per-point data needed to drape a polyline on the terrain repeatedly:
 * `base` is the local position at ellipsoid height 0, `up` the local unit normal at that point, so the
 * local position at height h is `base + up * h` (exact, since lonLatToEcef is linear in h).
 */
export interface DrapeBuffer {
  count: number
  lon: Float64Array
  lat: Float64Array
  /** recorded elevation, NaN when the point has none */
  ele: Float32Array
  /** xyz per point */
  base: Float64Array
  /** xyz per point */
  up: Float64Array
}

export function buildDrapeBuffer(points: readonly TrackPoint[], frame: LocalFrame): DrapeBuffer {
  const count = points.length
  const buffer: DrapeBuffer = {
    count,
    lon: new Float64Array(count),
    lat: new Float64Array(count),
    ele: new Float32Array(count),
    base: new Float64Array(count * 3),
    up: new Float64Array(count * 3),
  }
  const b = new Vector3()
  const u = new Vector3()
  for (let i = 0; i < count; i++) {
    const p = points[i]
    buffer.lon[i] = p.lon
    buffer.lat[i] = p.lat
    buffer.ele[i] = p.ele ?? Number.NaN
    frame.toLocal(p.lon, p.lat, 0, b)
    frame.toLocal(p.lon, p.lat, 1, u)
    const o = i * 3
    buffer.base[o] = b.x
    buffer.base[o + 1] = b.y
    buffer.base[o + 2] = b.z
    buffer.up[o] = u.x - b.x
    buffer.up[o + 1] = u.y - b.y
    buffer.up[o + 2] = u.z - b.z
  }
  return buffer
}

/**
 * Compute the draped local positions (xyz per point) into `out`:
 * height = (terrain ?? recorded elevation ?? 0) * exaggeration + LINE_LIFT_M.
 */
export function computeDrapedPositions(
  buffer: DrapeBuffer,
  sample: HeightSampler | null,
  exaggeration: number,
  out: Float32Array,
): Float32Array {
  const { count, lon, lat, ele, base, up } = buffer
  for (let i = 0; i < count; i++) {
    let h = sample ? sample(lon[i], lat[i]) : undefined
    if (h === undefined || Number.isNaN(h)) {
      const recorded = ele[i]
      h = Number.isNaN(recorded) ? 0 : recorded
    }
    const y = h * exaggeration + LINE_LIFT_M
    const o = i * 3
    out[o] = base[o] + up[o] * y
    out[o + 1] = base[o + 1] + up[o + 1] * y
    out[o + 2] = base[o + 2] + up[o + 2] * y
  }
  return out
}

function isInterleavedAttribute(value: unknown): value is InterleavedBufferAttribute {
  return typeof value === 'object' && value !== null && (value as InterleavedBufferAttribute).isInterleavedBufferAttribute === true
}

/**
 * Write a polyline (xyz per point, at least 2 points) into a LineGeometry.
 * When the segment count is unchanged the existing interleaved buffer is updated in place (one upload,
 * no attribute re-creation); otherwise `setPositions` rebuilds the attributes.
 */
export function writeLinePositions(geometry: LineGeometry, positions: Float32Array): void {
  const pointCount = Math.floor(positions.length / 3)
  if (pointCount < 2) return
  const segmentCount = pointCount - 1
  const start: unknown = geometry.getAttribute('instanceStart')
  if (isInterleavedAttribute(start) && start.data.array.length === segmentCount * 6) {
    const array = start.data.array as Float32Array
    for (let i = 0; i < segmentCount; i++) {
      const o = i * 6
      const p = i * 3
      array[o] = positions[p]
      array[o + 1] = positions[p + 1]
      array[o + 2] = positions[p + 2]
      array[o + 3] = positions[p + 3]
      array[o + 4] = positions[p + 4]
      array[o + 5] = positions[p + 5]
    }
    start.data.needsUpdate = true
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    return
  }
  geometry.setPositions(positions)
}

// ---------------------------------------------------------------------------
// Three.js object management (no React below this line except the component; exported for unit tests)
// ---------------------------------------------------------------------------

export interface SegmentLines {
  buffer: DrapeBuffer
  /** scratch xyz per point, reused on every drape */
  positions: Float32Array
  geometry: LineGeometry
  solid: Line2
  ghost: Line2
}

export interface TrackLineSet {
  track: Track
  frame: LocalFrame
  object: Group
  segments: SegmentLines[]
  solidMaterial: LineMaterial
  ghostMaterial: LineMaterial
  startMarker: Mesh | null
  endMarker: Mesh | null
}

/** Resources shared by every track of one TrackLines instance. */
export interface SharedResources {
  markerGeometry: SphereGeometry
  startMaterial: MeshStandardMaterial
  endMaterial: MeshStandardMaterial
  dispose(): void
}

export function createSharedResources(): SharedResources {
  const markerGeometry = new SphereGeometry(MARKER_RADIUS_M, 24, 16)
  const startMaterial = new MeshStandardMaterial({ color: new Color(START_COLOR), roughness: 0.6, metalness: 0 })
  const endMaterial = new MeshStandardMaterial({ color: new Color(END_COLOR), roughness: 0.6, metalness: 0 })
  return {
    markerGeometry,
    startMaterial,
    endMaterial,
    dispose() {
      markerGeometry.dispose()
      startMaterial.dispose()
      endMaterial.dispose()
    },
  }
}

function createLineMaterials(color: string, width: number, height: number): { solid: LineMaterial; ghost: LineMaterial } {
  const solid = new LineMaterial({
    color: new Color(color),
    linewidth: LINE_WIDTH_PX,
    worldUnits: false,
  })
  solid.resolution.set(width, height)
  const ghost = new LineMaterial({
    color: new Color(color),
    linewidth: LINE_WIDTH_PX,
    worldUnits: false,
    transparent: true,
    opacity: GHOST_OPACITY,
    depthTest: false,
    depthWrite: false,
  })
  ghost.resolution.set(width, height)
  return { solid, ghost }
}

export function buildTrackLineSet(
  track: Track,
  frame: LocalFrame,
  shared: SharedResources,
  width: number,
  height: number,
): TrackLineSet {
  const object = new Group()
  object.name = `track:${track.id}`
  const { solid: solidMaterial, ghost: ghostMaterial } = createLineMaterials(track.color, width, height)

  const segments: SegmentLines[] = []
  for (const segment of track.segments) {
    const points = densify(segment.points, DENSIFY_STEP_M)
    if (points.length < 2) continue
    const buffer = buildDrapeBuffer(points, frame)
    const positions = new Float32Array(buffer.count * 3)
    const geometry = new LineGeometry()
    const solid = new Line2(geometry, solidMaterial)
    solid.name = 'track-line'
    const ghost = new Line2(geometry, ghostMaterial)
    ghost.name = 'track-line-ghost'
    ghost.renderOrder = 1
    object.add(solid, ghost)
    segments.push({ buffer, positions, geometry, solid, ghost })
  }

  let startMarker: Mesh | null = null
  let endMarker: Mesh | null = null
  if (segments.length > 0) {
    startMarker = new Mesh(shared.markerGeometry, shared.startMaterial)
    startMarker.name = 'track-start'
    endMarker = new Mesh(shared.markerGeometry, shared.endMaterial)
    endMarker.name = 'track-end'
    object.add(startMarker, endMarker)
  }

  return { track, frame, object, segments, solidMaterial, ghostMaterial, startMarker, endMarker }
}

export function disposeTrackLineSet(set: TrackLineSet): void {
  set.object.removeFromParent()
  for (const segment of set.segments) segment.geometry.dispose()
  set.solidMaterial.dispose()
  set.ghostMaterial.dispose()
  // marker geometry / materials are shared and disposed with the component
}

export function drapeTrackLineSet(set: TrackLineSet, engine: TerrainEngine | null, exaggeration: number): void {
  const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
  for (const segment of set.segments) {
    computeDrapedPositions(segment.buffer, sampler, exaggeration, segment.positions)
    writeLinePositions(segment.geometry, segment.positions)
  }
  const first = set.segments[0]
  const last = set.segments[set.segments.length - 1]
  if (set.startMarker && first) {
    set.startMarker.position.set(first.positions[0], first.positions[1], first.positions[2])
  }
  if (set.endMarker && last) {
    const o = (last.buffer.count - 1) * 3
    set.endMarker.position.set(last.positions[o], last.positions[o + 1], last.positions[o + 2])
  }
}

function applyResolution(sets: Iterable<TrackLineSet>, width: number, height: number): void {
  for (const set of sets) {
    set.solidMaterial.resolution.set(width, height)
    set.ghostMaterial.resolution.set(width, height)
  }
}

/**
 * Reconcile the Three objects with the store: keep sets whose track and frame are unchanged, rebuild the
 * others, drop the ones whose track disappeared.
 */
export function syncTrackLineSets(
  group: Group,
  sets: Map<string, TrackLineSet>,
  tracks: readonly Track[],
  frame: LocalFrame | null,
  shared: SharedResources,
  width: number,
  height: number,
): void {
  const alive = new Set<string>()
  for (const track of tracks) {
    alive.add(track.id)
    const existing = sets.get(track.id)
    if (existing && existing.track === track && existing.frame === frame) continue
    if (existing) {
      disposeTrackLineSet(existing)
      sets.delete(track.id)
    }
    if (!frame) continue
    const set = buildTrackLineSet(track, frame, shared, width, height)
    group.add(set.object)
    sets.set(track.id, set)
  }
  for (const [id, set] of sets) {
    if (alive.has(id)) continue
    disposeTrackLineSet(set)
    sets.delete(id)
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TrackLines() {
  const tracks = useAppStore((s) => s.tracks)
  const exaggeration = useAppStore((s) => s.settings.exaggeration)
  const { engine, frame } = useTerrainContext()
  const size = useThree((s) => s.size)

  const groupRef = useRef<Group>(null)
  const setsRef = useRef<Map<string, TrackLineSet>>(new Map())
  const sharedRef = useRef<SharedResources | null>(null)
  const sizeRef = useRef(size)

  // Keep the material resolution in sync with the canvas size (Line2 also refreshes it before each
  // render, this covers objects that are not rendered yet).
  useEffect(() => {
    sizeRef.current = size
    applyResolution(setsRef.current.values(), size.width, size.height)
  }, [size])

  const drapeAll = useCallback((current: TerrainEngine | null, factor: number) => {
    for (const set of setsRef.current.values()) drapeTrackLineSet(set, current, factor)
  }, [])

  // Build / rebuild the lines, then drape them with the current terrain and exaggeration.
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    sharedRef.current ??= createSharedResources()
    const { width, height } = sizeRef.current
    syncTrackLineSets(group, setsRef.current, tracks, frame, sharedRef.current, width, height)
    drapeAll(engine, exaggeration)
  }, [tracks, frame, engine, exaggeration, drapeAll])

  // Re-drape (debounced, with a bounded wait so a long tile stream cannot starve it) whenever the engine
  // reports new or removed tiles.
  const redrape = useDebouncedCallback(drapeAll, REDRAPE_DEBOUNCE_MS, REDRAPE_MAX_WAIT_MS)

  useEffect(() => {
    if (!engine) return
    const unsubscribe = engine.onChange(() => redrape(engine, exaggeration))
    return () => {
      unsubscribe()
      redrape.cancel()
    }
  }, [engine, exaggeration, redrape])

  // Release every Three resource on unmount (also exercised by StrictMode's simulated unmount).
  useEffect(
    () => () => {
      for (const set of setsRef.current.values()) disposeTrackLineSet(set)
      setsRef.current.clear()
      sharedRef.current?.dispose()
      sharedRef.current = null
    },
    [],
  )

  return <group ref={groupRef} name="track-lines" />
}

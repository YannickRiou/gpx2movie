import { describe, expect, it, vi } from 'vitest'
import { Group } from 'three'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import type { InterleavedBufferAttribute, TypedArray } from 'three'
import type { TerrainEngine, Track, TrackPoint } from '../core/types'
import { createLocalFrame } from '../geo/ellipsoid'
import type { TrackLineSet } from './TrackLines'

vi.mock('@react-three/fiber', () => ({ useFrame: vi.fn(), useThree: vi.fn() }))
vi.mock('../terrain/engine', () => ({ createTerrainEngine: vi.fn() }))

const {
  buildDrapeBuffer,
  computeDrapedPositions,
  writeLinePositions,
  createSharedResources,
  syncTrackLineSets,
  drapeTrackLineSet,
  disposeTrackLineSet,
  LINE_LIFT_M,
  LINE_WIDTH_PX,
  GHOST_OPACITY,
  DENSIFY_STEP_M,
} = await import('./TrackLines')

const frame = createLocalFrame(6.5, 45.5)
const points: TrackPoint[] = [
  { lon: 6.5, lat: 45.5, ele: 1000 },
  { lon: 6.51, lat: 45.505, ele: 1100 },
  { lon: 6.52, lat: 45.51 }, // no recorded elevation
]

function expectLocal(out: ArrayLike<number>, index: number, lon: number, lat: number, height: number) {
  const expected = frame.toLocal(lon, lat, height)
  const o = index * 3
  expect(out[o]).toBeCloseTo(expected.x, 3)
  expect(out[o + 1]).toBeCloseTo(expected.y, 3)
  expect(out[o + 2]).toBeCloseTo(expected.z, 3)
}

describe('buildDrapeBuffer / computeDrapedPositions', () => {
  it('reproduces frame.toLocal at the draped height without the terrain', () => {
    const buffer = buildDrapeBuffer(points, frame)
    expect(buffer.count).toBe(3)
    expect(Number.isNaN(buffer.ele[2])).toBe(true)

    const out = computeDrapedPositions(buffer, null, 1, new Float32Array(9))
    expectLocal(out, 0, 6.5, 45.5, 1000 + LINE_LIFT_M)
    expectLocal(out, 1, 6.51, 45.505, 1100 + LINE_LIFT_M)
    // no elevation at all -> 0 m
    expectLocal(out, 2, 6.52, 45.51, LINE_LIFT_M)
  })

  it('prefers the terrain height, falls back to the recorded elevation, and applies the exaggeration', () => {
    const buffer = buildDrapeBuffer(points, frame)
    const sampler = (lon: number) => (lon > 6.505 ? 2000 : undefined)
    const out = computeDrapedPositions(buffer, sampler, 1.5, new Float32Array(9))
    expectLocal(out, 0, 6.5, 45.5, 1000 * 1.5 + LINE_LIFT_M)
    expectLocal(out, 1, 6.51, 45.505, 2000 * 1.5 + LINE_LIFT_M)
    expectLocal(out, 2, 6.52, 45.51, 2000 * 1.5 + LINE_LIFT_M)
  })

  it('treats a NaN terrain sample as unknown', () => {
    const buffer = buildDrapeBuffer(points.slice(0, 1), frame)
    const out = computeDrapedPositions(buffer, () => Number.NaN, 1, new Float32Array(3))
    expectLocal(out, 0, 6.5, 45.5, 1000 + LINE_LIFT_M)
  })
})

describe('writeLinePositions', () => {
  const instanceStart = (geometry: LineGeometry) => geometry.getAttribute('instanceStart') as InterleavedBufferAttribute
  const data = (geometry: LineGeometry) => instanceStart(geometry).data

  it('builds the pair attributes on first write', () => {
    const geometry = new LineGeometry()
    writeLinePositions(geometry, new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]))
    expect(instanceStart(geometry).count).toBe(2)
    expect(geometry.instanceCount).toBe(2)
    expect(Array.from(data(geometry).array as TypedArray)).toEqual([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0])
    expect(geometry.boundingSphere).not.toBeNull()
    geometry.dispose()
  })

  it('updates the existing buffer in place when the point count is unchanged', () => {
    const geometry = new LineGeometry()
    writeLinePositions(geometry, new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]))
    const buffer = data(geometry)
    const versionBefore = buffer.version
    writeLinePositions(geometry, new Float32Array([0, 5, 0, 1, 5, 0, 1, 6, 0]))
    expect(data(geometry)).toBe(buffer)
    expect(buffer.version).toBeGreaterThan(versionBefore)
    expect(Array.from(buffer.array as TypedArray)).toEqual([0, 5, 0, 1, 5, 0, 1, 5, 0, 1, 6, 0])
    expect(geometry.instanceCount).toBe(2)
    expect(geometry.boundingBox?.min.y).toBe(5)
    expect(geometry.boundingBox?.max.y).toBe(6)
    geometry.dispose()
  })

  it('rebuilds the attributes when the point count changes', () => {
    const geometry = new LineGeometry()
    writeLinePositions(geometry, new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]))
    const buffer = data(geometry)
    writeLinePositions(geometry, new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 2, 2, 0]))
    expect(data(geometry)).not.toBe(buffer)
    expect(instanceStart(geometry).count).toBe(3)
    expect(geometry.instanceCount).toBe(3)
    geometry.dispose()
  })

  it('ignores degenerate polylines (fewer than two points)', () => {
    const geometry = new LineGeometry()
    writeLinePositions(geometry, new Float32Array([0, 0, 0]))
    expect(geometry.getAttribute('instanceStart')).toBeUndefined()
    geometry.dispose()
  })
})

// ---------------------------------------------------------------------------
// Three.js object management (runs in jsdom: Line2 / LineMaterial need no WebGL to be constructed)
// ---------------------------------------------------------------------------

function makeTrack(id: string, segments: TrackPoint[][], color = '#ff0000'): Track {
  return {
    id,
    name: id,
    source: 'gpx',
    segments: segments.map((pts) => ({ points: pts })),
    stats: { distanceM: 0, ascentM: 0, descentM: 0, pointCount: segments.flat().length },
    bounds: { west: 6.5, south: 45.5, east: 6.52, north: 45.51 },
    color,
  }
}

/** Two points ~110 m apart (densified to 12 points at 10 m) and a second, separate ~5 m segment (not densified). */
const segmentA: TrackPoint[] = [
  { lon: 6.5, lat: 45.5, ele: 1000 },
  { lon: 6.5, lat: 45.501, ele: 1050 },
]
const segmentB: TrackPoint[] = [
  { lon: 6.51, lat: 45.505, ele: 1100 },
  { lon: 6.51005, lat: 45.50503, ele: 1110 },
]
const lastPoint = segmentB[segmentB.length - 1]

function fakeEngine(height: number): TerrainEngine {
  return {
    group: new Group(),
    update: vi.fn(),
    sampleHeight: () => height,
    setOptions: vi.fn(),
    onChange: () => () => {},
    stats: { visibleTiles: 0, loadedTiles: 0, pendingTiles: 0, failedTiles: 0 },
    dispose: vi.fn(),
  }
}

describe('syncTrackLineSets', () => {
  it('builds one solid + one ghost Line2 per segment (segments are not joined) plus the two markers', () => {
    const group = new Group()
    const sets = new Map<string, TrackLineSet>()
    const shared = createSharedResources()
    const track = makeTrack('a', [segmentA, [{ lon: 6, lat: 45 }], segmentB])

    syncTrackLineSets(group, sets, [track], frame, shared, 800, 600)

    const set = sets.get('a')!
    expect(group.children).toEqual([set.object])
    // the single-point segment is skipped
    expect(set.segments).toHaveLength(2)
    expect(set.segments[0].buffer.count).toBeGreaterThanOrEqual(Math.ceil(110 / DENSIFY_STEP_M) + 1)
    expect(set.segments[1].buffer.count).toBe(segmentB.length)
    // solid and ghost share one geometry, segments never share one
    expect(set.segments[0].ghost.geometry).toBe(set.segments[0].solid.geometry)
    expect(set.segments[1].geometry).not.toBe(set.segments[0].geometry)
    expect(set.object.children.filter((o) => o instanceof Line2)).toHaveLength(4)
    expect(set.object.children).toContain(set.startMarker)
    expect(set.object.children).toContain(set.endMarker)

    // materials: 4 px screen-space lines, ghost without depth test at 25 %
    expect(set.solidMaterial.linewidth).toBe(LINE_WIDTH_PX)
    expect(set.solidMaterial.worldUnits).toBe(false)
    expect(set.solidMaterial.resolution.toArray()).toEqual([800, 600])
    expect(set.solidMaterial.color.getHexString()).toBe('ff0000')
    expect(set.ghostMaterial.depthTest).toBe(false)
    expect(set.ghostMaterial.depthWrite).toBe(false)
    expect(set.ghostMaterial.transparent).toBe(true)
    expect(set.ghostMaterial.opacity).toBe(GHOST_OPACITY)
    expect(set.segments[0].ghost.renderOrder).toBeGreaterThan(set.segments[0].solid.renderOrder)

    syncTrackLineSets(group, sets, [], frame, shared, 800, 600)
    shared.dispose()
  })

  it('keeps an unchanged track, rebuilds a replaced one and drops a removed one (disposing resources)', () => {
    const group = new Group()
    const sets = new Map<string, TrackLineSet>()
    const shared = createSharedResources()
    const a = makeTrack('a', [segmentA])
    const b = makeTrack('b', [segmentB])

    syncTrackLineSets(group, sets, [a, b], frame, shared, 800, 600)
    const setA = sets.get('a')!
    const setB = sets.get('b')!
    expect(group.children).toHaveLength(2)

    // same track objects: nothing is rebuilt
    syncTrackLineSets(group, sets, [a, b], frame, shared, 800, 600)
    expect(sets.get('a')).toBe(setA)
    expect(sets.get('b')).toBe(setB)

    // a replaced by a new object with the same id, b removed
    const geometryDispose = vi.spyOn(setA.segments[0].geometry, 'dispose')
    const solidDispose = vi.spyOn(setA.solidMaterial, 'dispose')
    const ghostDispose = vi.spyOn(setA.ghostMaterial, 'dispose')
    const bGeometryDispose = vi.spyOn(setB.segments[0].geometry, 'dispose')
    const a2 = makeTrack('a', [segmentA], '#00ff00')
    syncTrackLineSets(group, sets, [a2], frame, shared, 800, 600)

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(solidDispose).toHaveBeenCalledTimes(1)
    expect(ghostDispose).toHaveBeenCalledTimes(1)
    expect(bGeometryDispose).toHaveBeenCalledTimes(1)
    expect(sets.has('b')).toBe(false)
    const setA2 = sets.get('a')!
    expect(setA2).not.toBe(setA)
    expect(setA2.solidMaterial.color.getHexString()).toBe('00ff00')
    expect(group.children).toEqual([setA2.object])
    expect(setA.object.parent).toBeNull()
    expect(setB.object.parent).toBeNull()

    // shared marker resources survive per-track disposal
    expect(setA2.startMarker?.geometry).toBe(shared.markerGeometry)

    syncTrackLineSets(group, sets, [], frame, shared, 800, 600)
    expect(sets.size).toBe(0)
    expect(group.children).toHaveLength(0)
    shared.dispose()
  })

  it('rebuilds when the local frame changes and builds nothing without a frame', () => {
    const group = new Group()
    const sets = new Map<string, TrackLineSet>()
    const shared = createSharedResources()
    const a = makeTrack('a', [segmentA])

    syncTrackLineSets(group, sets, [a], null, shared, 800, 600)
    expect(sets.size).toBe(0)
    expect(group.children).toHaveLength(0)

    syncTrackLineSets(group, sets, [a], frame, shared, 800, 600)
    const first = sets.get('a')!
    const otherFrame = createLocalFrame(6.6, 45.6)
    syncTrackLineSets(group, sets, [a], otherFrame, shared, 800, 600)
    const second = sets.get('a')!
    expect(second).not.toBe(first)
    expect(second.frame).toBe(otherFrame)
    expect(group.children).toEqual([second.object])

    syncTrackLineSets(group, sets, [], frame, shared, 800, 600)
    shared.dispose()
  })
})

describe('drapeTrackLineSet', () => {
  it('drapes every segment on the terrain and puts the markers on the first and last point', () => {
    const group = new Group()
    const sets = new Map<string, TrackLineSet>()
    const shared = createSharedResources()
    const track = makeTrack('a', [segmentA, segmentB])
    syncTrackLineSets(group, sets, [track], frame, shared, 800, 600)
    const set = sets.get('a')!

    drapeTrackLineSet(set, fakeEngine(2000), 1.5)
    const h = 2000 * 1.5 + LINE_LIFT_M
    expectLocal(set.startMarker!.position.toArray(), 0, 6.5, 45.5, h)
    expectLocal(set.endMarker!.position.toArray(), 0, lastPoint.lon, lastPoint.lat, h)

    // geometry of the first segment: segment 0 starts at the first point, last segment ends at the last
    const startA = set.segments[0].geometry.getAttribute('instanceStart') as InterleavedBufferAttribute
    expectLocal(startA.data.array as TypedArray, 0, 6.5, 45.5, h)
    expect(startA.count).toBe(set.segments[0].buffer.count - 1)
    const endB = set.segments[1].geometry.getAttribute('instanceEnd') as InterleavedBufferAttribute
    const lastSegment = endB.count - 1
    expect(endB.getX(lastSegment)).toBeCloseTo(set.endMarker!.position.x, 3)
    expect(endB.getY(lastSegment)).toBeCloseTo(set.endMarker!.position.y, 3)
    expect(endB.getZ(lastSegment)).toBeCloseTo(set.endMarker!.position.z, 3)

    // a re-drape without terrain falls back to the recorded elevations, in place
    const bufferBefore = startA.data
    drapeTrackLineSet(set, null, 1)
    expect((set.segments[0].geometry.getAttribute('instanceStart') as InterleavedBufferAttribute).data).toBe(
      bufferBefore,
    )
    expectLocal(set.startMarker!.position.toArray(), 0, 6.5, 45.5, 1000 + LINE_LIFT_M)
    expectLocal(set.endMarker!.position.toArray(), 0, lastPoint.lon, lastPoint.lat, 1110 + LINE_LIFT_M)

    disposeTrackLineSet(set)
    shared.dispose()
  })
})

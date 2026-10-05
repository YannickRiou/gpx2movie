import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import type { HeightGrid, TileKey } from '../core/types'
import { createLocalFrame } from '../geo/ellipsoid'
import { tileBounds, tileCenter } from '../geo/mercator'
import { buildTileGeometry, tileMeshLayout } from './mesh'

/** A z=12 tile over the Mont Blanc massif. */
const KEY: TileKey = { z: 12, x: 2126, y: 1457 }
const CENTER = tileCenter(KEY)
const FRAME = createLocalFrame(CENTER.lon, CENTER.lat)

function flatGrid(size: number, value: number): HeightGrid {
  return { width: size, height: size, data: new Float32Array(size * size).fill(value) }
}

function positionAt(positions: ArrayLike<number>, i: number, target = new Vector3()): Vector3 {
  return target.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
}

function expectVec3Close(actual: Vector3, expected: Vector3, tol: number): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tol)
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tol)
  expect(Math.abs(actual.z - expected.z)).toBeLessThanOrEqual(tol)
}

/** Exactly what a Float32Array stores for this double. */
function fround3(v: Vector3): Vector3 {
  return new Vector3(Math.fround(v.x), Math.fround(v.y), Math.fround(v.z))
}

describe('buildTileGeometry', () => {
  const segments = 8
  const layout = tileMeshLayout(segments)

  it('has (segments+1)^2 grid vertices plus 4 skirt runs, and matching index counts', () => {
    const { geometry } = buildTileGeometry(KEY, flatGrid(4, 0), FRAME, { segments, exaggeration: 1, skirtDepthM: 50 })
    expect(layout.gridVertexCount).toBe(81)
    expect(geometry.getAttribute('position').count).toBe(layout.vertexCount)
    expect(geometry.getAttribute('uv').count).toBe(layout.vertexCount)
    expect(geometry.getAttribute('normal').count).toBe(layout.vertexCount)
    expect(geometry.getIndex()?.count).toBe(layout.indexCount)
    expect(geometry.getIndex()?.array).toBeInstanceOf(Uint32Array)
    expect(geometry.getAttribute('position').array).toBeInstanceOf(Float32Array)
    expect(geometry.boundingSphere).not.toBeNull()
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(0)
  })

  it('places the four corner vertices at frame.toLocal of the tile corners', () => {
    const { geometry } = buildTileGeometry(KEY, flatGrid(4, 0), FRAME, { segments, exaggeration: 1, skirtDepthM: 50 })
    const pos = geometry.getAttribute('position').array
    const b = tileBounds(KEY)
    const edge = layout.edge
    const cases: Array<[number, number, number]> = [
      [0, b.west, b.north], // NW
      [segments, b.east, b.north], // NE
      [segments * edge, b.west, b.south], // SW
      [segments * edge + segments, b.east, b.south], // SE
    ]
    for (const [vi, lon, lat] of cases) {
      const expected = fround3(FRAME.toLocal(lon, lat, 0))
      expectVec3Close(positionAt(pos, vi), expected, 1e-6)
    }
  })

  it('applies the sampled height times the exaggeration', () => {
    const exaggeration = 2.5
    const { geometry, minHeight, maxHeight } = buildTileGeometry(KEY, flatGrid(4, 100), FRAME, {
      segments,
      exaggeration,
      skirtDepthM: 50,
    })
    expect(minHeight).toBeCloseTo(250, 9)
    expect(maxHeight).toBeCloseTo(250, 9)
    const pos = geometry.getAttribute('position').array
    const b = tileBounds(KEY)
    const expected = fround3(FRAME.toLocal(b.west, b.north, 250))
    expectVec3Close(positionAt(pos, 0), expected, 1e-6)
    // centre vertex: lifted by 250 m above the ellipsoid at the frame origin
    const centreIndex = (segments / 2) * layout.edge + segments / 2
    expect(positionAt(pos, centreIndex).y).toBeCloseTo(250, 3)
  })

  it('treats nodata as 0 m', () => {
    const grid: HeightGrid = { width: 2, height: 2, data: new Float32Array([NaN, NaN, NaN, NaN]) }
    const { minHeight, maxHeight } = buildTileGeometry(KEY, grid, FRAME, { segments, exaggeration: 1, skirtDepthM: 50 })
    expect(minHeight).toBe(0)
    expect(maxHeight).toBe(0)
  })

  it('samples with the shared dem.sampleGrid: an isolated nodata pixel does not punch a 0 m hole', () => {
    // With segments = 2 and a 2 px grid, vertex (0, 0) sits exactly on the clamped NW pixel: only that
    // pixel carries weight and it is nodata. dem.sampleGrid falls back to the mean of the valid
    // neighbours (1000 m); a naive sampler would return NaN -> 0 m and spike the mesh.
    const grid: HeightGrid = { width: 2, height: 2, data: new Float32Array([NaN, 1000, 1000, 1000]) }
    const { minHeight, maxHeight } = buildTileGeometry(KEY, grid, FRAME, { segments: 2, exaggeration: 1, skirtDepthM: 10 })
    expect(minHeight).toBeCloseTo(1000, 6)
    expect(maxHeight).toBeCloseTo(1000, 6)
  })

  it('writes uv = (u, 1 - v) within [0, 1]', () => {
    const { geometry } = buildTileGeometry(KEY, flatGrid(4, 0), FRAME, { segments, exaggeration: 1, skirtDepthM: 50 })
    const uv = geometry.getAttribute('uv').array
    for (let i = 0; i < uv.length; i++) {
      expect(uv[i]).toBeGreaterThanOrEqual(0)
      expect(uv[i]).toBeLessThanOrEqual(1)
    }
    // NW corner: image row 0 is the north edge, i.e. uv.y = 1 in Three.js
    expect(uv[0]).toBe(0)
    expect(uv[1]).toBe(1)
    // SE corner
    const se = segments * layout.edge + segments
    expect(uv[se * 2]).toBe(1)
    expect(uv[se * 2 + 1]).toBe(0)
  })

  it('lowers every skirt vertex below its border vertex by skirtDepthM, copying normal and uv', () => {
    const skirtDepthM = 80
    const { geometry } = buildTileGeometry(KEY, flatGrid(4, 300), FRAME, { segments, exaggeration: 1, skirtDepthM })
    const pos = geometry.getAttribute('position').array
    const nrm = geometry.getAttribute('normal').array
    const uv = geometry.getAttribute('uv').array
    const edge = layout.edge
    const borders = [
      (t: number) => t, // north
      (t: number) => segments * edge + t, // south
      (t: number) => t * edge, // west
      (t: number) => t * edge + segments, // east
    ]
    for (let side = 0; side < 4; side++) {
      for (let t = 0; t < edge; t++) {
        const g = borders[side](t)
        const s = layout.gridVertexCount + side * edge + t
        const dy = pos[g * 3 + 1] - pos[s * 3 + 1]
        // close to the frame origin the ellipsoid normal is ~ +Y
        expect(dy).toBeGreaterThan(skirtDepthM * 0.99)
        expect(dy).toBeLessThan(skirtDepthM * 1.01)
        expect(nrm[s * 3]).toBe(nrm[g * 3])
        expect(nrm[s * 3 + 1]).toBe(nrm[g * 3 + 1])
        expect(nrm[s * 3 + 2]).toBe(nrm[g * 3 + 2])
        expect(uv[s * 2]).toBe(uv[g * 2])
        expect(uv[s * 2 + 1]).toBe(uv[g * 2 + 1])
      }
    }
  })

  it('winds grid triangles so their face normals point up (+Y) and skirts face outward', () => {
    const { geometry } = buildTileGeometry(KEY, flatGrid(4, 0), FRAME, { segments, exaggeration: 1, skirtDepthM: 50 })
    const pos = geometry.getAttribute('position').array
    const idx = geometry.getIndex()!.array
    const a = new Vector3()
    const b = new Vector3()
    const c = new Vector3()
    const n = new Vector3()
    const faceNormal = (tri: number) => {
      positionAt(pos, idx[tri * 3], a)
      positionAt(pos, idx[tri * 3 + 1], b)
      positionAt(pos, idx[tri * 3 + 2], c)
      return n.copy(b).sub(a).cross(c.sub(a)).normalize()
    }
    const gridTriangles = layout.gridIndexCount / 3
    for (let tri = 0; tri < gridTriangles; tri++) {
      expect(faceNormal(tri).y).toBeGreaterThan(0.99)
    }
    // Skirt runs: north faces -Z, south +Z, west -X, east +X (horizontal component).
    const perSide = (layout.skirtIndexCount / 3) / 4
    const expected = [
      (v: Vector3) => v.z < -0.9,
      (v: Vector3) => v.z > 0.9,
      (v: Vector3) => v.x < -0.9,
      (v: Vector3) => v.x > 0.9,
    ]
    for (let side = 0; side < 4; side++) {
      for (let t = 0; t < perSide; t++) {
        const tri = gridTriangles + side * perSide + t
        expect(expected[side](faceNormal(tri))).toBe(true)
      }
    }
    // Vertex normals of the grid are up as well
    const nrm = geometry.getAttribute('normal').array
    for (let vi = 0; vi < layout.gridVertexCount; vi++) {
      expect(nrm[vi * 3 + 1]).toBeGreaterThan(0.99)
    }
  })

  it('reports min/max of the exaggerated heights on a sloped grid', () => {
    const grid: HeightGrid = { width: 2, height: 2, data: new Float32Array([0, 1000, 0, 1000]) }
    const { minHeight, maxHeight } = buildTileGeometry(KEY, grid, FRAME, { segments, exaggeration: 1.5, skirtDepthM: 50 })
    expect(minHeight).toBeCloseTo(0, 9)
    expect(maxHeight).toBeCloseTo(1500, 9)
  })

  it('rejects a non-positive segment count', () => {
    expect(() => buildTileGeometry(KEY, flatGrid(2, 0), FRAME, { segments: 0, exaggeration: 1, skirtDepthM: 1 })).toThrow(
      RangeError,
    )
  })
})

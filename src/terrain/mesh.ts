/**
 * Tile geometry builder: turns a decoded elevation grid into a THREE.BufferGeometry expressed
 * in the local tangent frame (X east, Y up, Z south).
 *
 * Pure CPU code: no WebGL, no DOM, so it runs (and is tested) under jsdom.
 *
 * Layout of the produced geometry (segments = S, edge = S + 1):
 *   - vertices [0, edge²)             : the grid, row-major, row 0 = north edge, column 0 = west edge
 *   - vertices [edge², edge² + 4·edge): skirts, one run of `edge` vertices per side in the order
 *                                       north, south, west, east (copies of the border lowered by skirtDepthM)
 *   - indices  [0, 6·S²)              : grid triangles, counter-clockwise seen from +Y
 *   - indices  [6·S², 6·S² + 24·S)    : skirt triangles, front face pointing away from the tile
 */
import { BufferAttribute, BufferGeometry, Vector3 } from 'three'
import type { BuildTileGeometryOptions, HeightGrid, LocalFrame, TileGeometryResult, TileKey } from '../core/types'
import { tileXToLon, tileYToLat } from '../geo/mercator'
import { sampleGrid } from './dem'

export interface TileMeshLayout {
  /** vertices per edge (= segments + 1) */
  edge: number
  gridVertexCount: number
  skirtVertexCount: number
  vertexCount: number
  gridIndexCount: number
  skirtIndexCount: number
  indexCount: number
}

/** Vertex / index counts of a tile mesh, so callers and tests can reason about buffers. */
export function tileMeshLayout(segments: number): TileMeshLayout {
  const edge = segments + 1
  const gridVertexCount = edge * edge
  const skirtVertexCount = 4 * edge
  const gridIndexCount = segments * segments * 6
  const skirtIndexCount = 4 * segments * 6
  return {
    edge,
    gridVertexCount,
    skirtVertexCount,
    vertexCount: gridVertexCount + skirtVertexCount,
    gridIndexCount,
    skirtIndexCount,
    indexCount: gridIndexCount + skirtIndexCount,
  }
}

/** Number of skirt runs (north, south, west, east). */
const SIDE_COUNT = 4

/**
 * Build the geometry of one terrain tile in the local frame.
 * Heights come from `dem.sampleGrid` (the same bilinear, pixel-centre, NaN-safe sampler the
 * height field uses for draping, so tracks and meshes agree), multiplied by `opts.exaggeration`;
 * a vertex whose four neighbours are all nodata becomes 0 m. `skirtDepthM` is applied along the
 * ellipsoid normal (the skirt vertex is the border vertex re-projected at h - skirtDepthM).
 */
export function buildTileGeometry(
  key: TileKey,
  grid: HeightGrid,
  frame: LocalFrame,
  opts: BuildTileGeometryOptions,
): TileGeometryResult {
  const { segments, exaggeration, skirtDepthM } = opts
  if (!Number.isInteger(segments) || segments < 1) {
    throw new RangeError(`buildTileGeometry: segments must be a positive integer (got ${segments})`)
  }
  const layout = tileMeshLayout(segments)
  const { edge, gridVertexCount, gridIndexCount } = layout

  const positions = new Float32Array(layout.vertexCount * 3)
  const uvs = new Float32Array(layout.vertexCount * 2)
  const index = new Uint32Array(layout.indexCount)
  /** exaggerated heights of the grid vertices, reused for the skirts */
  const heights = new Float64Array(gridVertexCount)

  // Lon only depends on the column and lat on the row: compute each once, in doubles.
  const lons = new Float64Array(edge)
  const lats = new Float64Array(edge)
  for (let i = 0; i < edge; i++) {
    lons[i] = tileXToLon(key.x + i / segments, key.z)
    lats[i] = tileYToLat(key.y + i / segments, key.z)
  }

  const p = new Vector3()
  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY

  // --- grid vertices -------------------------------------------------------
  for (let j = 0; j < edge; j++) {
    const v = j / segments
    for (let i = 0; i < edge; i++) {
      const u = i / segments
      let h = sampleGrid(grid, u, v)
      if (h !== h) h = 0 // nodata all around: sea level
      h *= exaggeration
      const vi = j * edge + i
      heights[vi] = h
      if (h < minHeight) minHeight = h
      if (h > maxHeight) maxHeight = h
      frame.toLocal(lons[i], lats[j], h, p)
      positions[vi * 3] = p.x
      positions[vi * 3 + 1] = p.y
      positions[vi * 3 + 2] = p.z
      uvs[vi * 2] = u
      uvs[vi * 2 + 1] = 1 - v
    }
  }

  // --- grid indices: two triangles per cell, counter-clockwise seen from +Y ---
  // Local axes: +X east, +Z south, so (NW, SW, NE) and (NE, SW, SE) wind CCW seen from above.
  let k = 0
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const nw = j * edge + i
      const ne = nw + 1
      const sw = nw + edge
      const se = sw + 1
      index[k++] = nw
      index[k++] = sw
      index[k++] = ne
      index[k++] = ne
      index[k++] = sw
      index[k++] = se
    }
  }

  // --- normals from the grid only (the skirts must not bend the border normals) ---
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(new BufferAttribute(index.subarray(0, gridIndexCount), 1))
  geometry.computeVertexNormals()
  const normals = geometry.getAttribute('normal').array as Float32Array

  // --- skirts --------------------------------------------------------------
  for (let side = 0; side < SIDE_COUNT; side++) {
    const base = gridVertexCount + side * edge
    for (let t = 0; t < edge; t++) {
      const gridIndex = borderVertexIndex(side, t, segments, edge)
      const col = gridIndex % edge
      const row = (gridIndex - col) / edge
      const skirtIndex = base + t
      frame.toLocal(lons[col], lats[row], heights[gridIndex] - skirtDepthM, p)
      positions[skirtIndex * 3] = p.x
      positions[skirtIndex * 3 + 1] = p.y
      positions[skirtIndex * 3 + 2] = p.z
      normals[skirtIndex * 3] = normals[gridIndex * 3]
      normals[skirtIndex * 3 + 1] = normals[gridIndex * 3 + 1]
      normals[skirtIndex * 3 + 2] = normals[gridIndex * 3 + 2]
      uvs[skirtIndex * 2] = uvs[gridIndex * 2]
      uvs[skirtIndex * 2 + 1] = uvs[gridIndex * 2 + 1]
    }
    // Walking the border in increasing t, the triangle (e_t, e_t+1, s_t) faces outward for the
    // north and east sides and inward for the south and west sides, which are therefore flipped.
    const flip = side === 1 || side === 2
    for (let t = 0; t < segments; t++) {
      const e0 = borderVertexIndex(side, t, segments, edge)
      const e1 = borderVertexIndex(side, t + 1, segments, edge)
      const s0 = base + t
      const s1 = s0 + 1
      if (flip) {
        index[k++] = e0
        index[k++] = s0
        index[k++] = e1
        index[k++] = e1
        index[k++] = s0
        index[k++] = s1
      } else {
        index[k++] = e0
        index[k++] = e1
        index[k++] = s0
        index[k++] = e1
        index[k++] = s1
        index[k++] = s0
      }
    }
  }

  geometry.setIndex(new BufferAttribute(index, 1))
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  return { geometry, minHeight, maxHeight }
}

/** Grid vertex index of the t-th vertex along a border (north/south walk east, west/east walk south). */
function borderVertexIndex(side: number, t: number, segments: number, edge: number): number {
  switch (side) {
    case 0: // north: row 0
      return t
    case 1: // south: last row
      return segments * edge + t
    case 2: // west: column 0
      return t * edge
    default: // east: last column
      return t * edge + segments
  }
}

/**
 * Geometry of the highlighted administrative region (osm/region.ts) for scene/RegionHighlight.tsx: the darkened
 * outside as one triangle mesh (a box `marginM` around the region with the region cut out), the points of its border
 * rings for the glowing line, and where its name goes (`labelPoint`).
 *
 * The rings are even-odd: a ring inside no other is an outer ring (a hole of the darkened box, exclaves included), a
 * ring inside one other is an enclave, darkened on its own; deeper nesting is ignored. Pure (three: triangulation only).
 */
import { ShapeUtils, Vector2 } from 'three'
import type { LonLat, LonLatBounds } from '../core/types'
import { centroid, expandBounds } from '../geo/lonLat'
import { M_PER_DEG, planarDistanceM, segmentDistanceM } from '../osm/overpass'
import type { AdminRegion } from '../osm/region'
import { pointInRing } from '../osm/water'

/** Cells of the grid searched for the name, along each side of the region's box. */
export const LABEL_GRID = 32
/** Metres of clearance a cell gives up per metre from the box centre: of two cells nearly as clear, the more central. */
const LABEL_CENTRE_PULL = 0.02

export interface RegionMesh {
  /** lon, lat of each vertex: the four corners of the darkened box, then the points of every ring in order */
  lonLat: Float64Array
  /** first vertex of each ring, then the vertex count: ring r is [ringStarts[r], ringStarts[r + 1]) */
  ringStarts: Uint32Array
  /** three vertex indices per triangle of the darkened outside */
  index: Uint32Array
  /** where the name goes */
  labelAt: LonLat
}

/** How many of the other rings contain each ring (tested at its first point). */
export function ringDepths(rings: readonly LonLat[][]): number[] {
  return rings.map((ring, i) => rings.filter((other, j) => j !== i && ring.length > 0 && pointInRing(ring[0], other)).length)
}

/** Even-odd: inside an odd number of rings. */
function inside(p: LonLat, rings: readonly LonLat[][]): boolean {
  return rings.filter((ring) => pointInRing(p, ring)).length % 2 === 1
}

/** Distance (metres) from `p` to the nearest border segment. */
function borderDistanceM(p: LonLat, rings: readonly LonLat[][]): number {
  let best = Infinity
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) best = Math.min(best, segmentDistanceM(p, ring[j], ring[i]))
  }
  return best
}

/**
 * Where the name of the region goes: the centre of the cell of a LABEL_GRID² grid over `bounds` that lies inside the
 * region and farthest from both its border and `avoid` (the outing's dot), slightly pulled to the middle
 * (LABEL_CENTRE_PULL); the box centre when no cell is inside.
 */
export function labelPoint(rings: readonly LonLat[][], bounds: LonLatBounds, avoid: LonLat, cells = LABEL_GRID): LonLat {
  const middle = centroid(bounds)
  let best = middle
  let bestScore = -Infinity
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const p = {
        lon: bounds.west + ((i + 0.5) / cells) * (bounds.east - bounds.west),
        lat: bounds.south + ((j + 0.5) / cells) * (bounds.north - bounds.south),
      }
      if (!inside(p, rings)) continue
      const score = Math.min(borderDistanceM(p, rings), planarDistanceM(p, avoid)) - LABEL_CENTRE_PULL * planarDistanceM(p, middle)
      if (score > bestScore) {
        bestScore = score
        best = p
      }
    }
  }
  return best
}

/** Mesh of the darkened outside of `region` over a box `marginM` around it, its border and its label point. */
export function buildRegionMesh(region: AdminRegion, outing: LonLat, marginM: number): RegionMesh {
  const rings = region.rings.map((ring) => ring.map(([lon, lat]) => ({ lon, lat })))
  const box = expandBounds(region.bounds, marginM)
  const corners = [
    { lon: box.west, lat: box.south },
    { lon: box.east, lat: box.south },
    { lon: box.east, lat: box.north },
    { lon: box.west, lat: box.north },
  ]
  const points = [...corners, ...rings.flat()]
  const lonLat = new Float64Array(points.flatMap((p) => [p.lon, p.lat]))
  const ringStarts = new Uint32Array(rings.length + 1)
  ringStarts[0] = corners.length
  rings.forEach((ring, r) => (ringStarts[r + 1] = ringStarts[r] + ring.length))
  const vertices = (r: number) => Array.from({ length: rings[r].length }, (_, i) => ringStarts[r] + i)

  const centre = centroid(box)
  const k = Math.cos((centre.lat * Math.PI) / 180) * M_PER_DEG
  const plane = (p: LonLat) => new Vector2((p.lon - centre.lon) * k, (p.lat - centre.lat) * M_PER_DEG)
  const depths = ringDepths(rings)
  const holes = rings.flatMap((_, r) => (depths[r] === 0 ? [r] : []))
  const index: number[] = []
  // earcut numbers the contour's points, then each hole's in turn
  const order = [0, 1, 2, 3, ...holes.flatMap(vertices)]
  for (const face of ShapeUtils.triangulateShape(corners.map(plane), holes.map((r) => rings[r].map(plane)))) {
    index.push(...face.map((i) => order[i]))
  }
  rings.forEach((ring, r) => {
    if (depths[r] !== 1) return
    const own = vertices(r)
    for (const face of ShapeUtils.triangulateShape(ring.map(plane), [])) index.push(...face.map((i) => own[i]))
  })
  return { lonLat, ringStarts, index: new Uint32Array(index), labelAt: labelPoint(rings, region.bounds, outing) }
}

/**
 * Closed border of every ring as segment pairs (xyz, xyz) for LineSegmentsGeometry, from the vertex `positions`,
 * written into `out` (six numbers per ring point).
 */
export function ringSegments(
  positions: ArrayLike<number>,
  ringStarts: ArrayLike<number>,
  out: Float32Array = new Float32Array((ringStarts[ringStarts.length - 1] - ringStarts[0]) * 6),
): Float32Array {
  let o = 0
  const copy = (v: number) => {
    for (let c = 0; c < 3; c++) out[o++] = positions[v * 3 + c]
  }
  for (let r = 0; r + 1 < ringStarts.length; r++) {
    const start = ringStarts[r]
    const end = ringStarts[r + 1]
    for (let i = start; i < end; i++) {
      copy(i)
      copy(i + 1 < end ? i + 1 : start)
    }
  }
  return out
}

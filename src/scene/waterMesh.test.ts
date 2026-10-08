import { describe, expect, it } from 'vitest'
import type { WaterPolygon } from '../osm/water'
import { buildWaterMesh, clipRing } from './waterMesh'

const M = 111_320
const LAT = 45.9
const K = Math.cos((LAT * Math.PI) / 180) * M

/** Square of `sideM` metres centred on (6.8, 45.9), as an open [lon, lat] ring. */
function square(sideM: number, lon = 6.8, lat = LAT): [number, number][] {
  const h = sideM / 2
  return [
    [lon - h / K, lat - h / M],
    [lon + h / K, lat - h / M],
    [lon + h / K, lat + h / M],
    [lon - h / K, lat + h / M],
  ]
}

/** Total area of the triangles (m², local metres). */
function meshArea(mesh: ReturnType<typeof buildWaterMesh>): number {
  let area = 0
  const xy = (i: number) => [(mesh.lonLat[2 * i] - 6.8) * K, (mesh.lonLat[2 * i + 1] - LAT) * M]
  for (let t = 0; t < mesh.index.length; t += 3) {
    const [a, b, c] = [xy(mesh.index[t]), xy(mesh.index[t + 1]), xy(mesh.index[t + 2])]
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
  }
  return area
}

describe('clipRing', () => {
  it('clips a ring to a rectangle', () => {
    const out = clipRing([[-1, -1], [3, -1], [3, 3], [-1, 3]], 0, 0, 2, 2)
    expect(out).toHaveLength(4)
    for (const [x, y] of out) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(2)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(2)
    }
    expect(clipRing([[5, 5], [6, 5], [6, 6]], 0, 0, 2, 2)).toEqual([])
  })
})

describe('buildWaterMesh', () => {
  const lake: WaterPolygon = { id: 'way/1', kind: 'lake', outer: square(500), holes: [] }

  it('covers the polygon with grid cells, holes left out', () => {
    const mesh = buildWaterMesh(lake, { cellM: 60, maxCells: 40, fadeM: 40 })
    expect(meshArea(mesh)).toBeCloseTo(250_000, -2)
    const island = buildWaterMesh({ ...lake, holes: [square(100)] }, { cellM: 60, maxCells: 40, fadeM: 40 })
    expect(meshArea(island)).toBeCloseTo(240_000, -2)
    // vertices inside the water every cell, not only on the shore
    expect(mesh.lonLat.length / 2).toBeGreaterThan(60)
  })

  it('fades from 0 on the shore to 1 beyond fadeM', () => {
    const mesh = buildWaterMesh(lake, { cellM: 60, maxCells: 40, fadeM: 40 })
    let shore = 0
    let open = 0
    for (let v = 0; v < mesh.fade.length; v++) {
      const x = (mesh.lonLat[2 * v] - 6.8) * K
      const y = (mesh.lonLat[2 * v + 1] - LAT) * M
      const d = 250 - Math.max(Math.abs(x), Math.abs(y))
      expect(mesh.fade[v]).toBeCloseTo(Math.min(1, d / 40), 2)
      if (d < 0.01) shore++
      if (d > 40) open++
    }
    expect(shore).toBeGreaterThan(0)
    expect(open).toBeGreaterThan(0)
  })

  it('caps the number of cells of a large lake', () => {
    const big = buildWaterMesh({ ...lake, outer: square(20_000) }, { cellM: 60, maxCells: 40, fadeM: 40 })
    expect(big.index.length / 3).toBeLessThanOrEqual(40 * 40 * 4)
    expect(meshArea(big)).toBeCloseTo(4e8, -5)
  })
})

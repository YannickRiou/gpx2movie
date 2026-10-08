import { describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import type { InterleavedBufferAttribute } from 'three'
import { DEFAULT_TRACK_STYLE } from './markerSettings'
import { applyDash, cumulativeDistances, cutAt, cutLine, quantizedPixelSize, type CuttableLine } from './trackLineStyle'

describe('cutAt', () => {
  const dist = Float64Array.from([100, 110, 120, 130])

  it('draws nothing before the polyline and every piece past its end', () => {
    expect(cutAt(dist, 50)).toEqual({ count: 0, t: 1 })
    expect(cutAt(dist, 100)).toEqual({ count: 0, t: 1 })
    expect(cutAt(dist, 130)).toEqual({ count: 3, t: 1 })
    expect(cutAt(dist, Infinity)).toEqual({ count: 3, t: 1 })
  })

  it('ends inside the piece holding the distance', () => {
    const cut = cutAt(dist, 115)
    expect(cut.count).toBe(2)
    expect(cut.t).toBeCloseTo(0.5, 9)
  })
})

describe('cumulativeDistances', () => {
  it('adds the ground length to the start distance', () => {
    const d = cumulativeDistances([{ lon: 6.5, lat: 45.5 }, { lon: 6.5, lat: 45.501 }], 1000)
    expect(d[0]).toBe(1000)
    expect(d[1] - d[0]).toBeCloseTo(111.2, 0)
  })
})

describe('cutLine', () => {
  function line(): CuttableLine {
    const positions = Float32Array.from([0, 0, 0, 10, 0, 0, 20, 0, 0])
    const geometry = new LineGeometry()
    geometry.setPositions(positions)
    return { geometry, positions, dist: Float64Array.from([0, 10, 20]), shortened: -1 }
  }
  const endX = (l: CuttableLine, piece: number) => (l.geometry.getAttribute('instanceEnd') as InterleavedBufferAttribute).getX(piece)

  it('ends the last drawn piece exactly at the distance, and puts it back afterwards', () => {
    const l = line()
    cutLine(l, 15)
    expect(l.geometry.instanceCount).toBe(2)
    expect(endX(l, 1)).toBeCloseTo(15, 6)
    expect(l.shortened).toBe(1)

    cutLine(l, Infinity)
    expect(l.geometry.instanceCount).toBe(2)
    expect(endX(l, 1)).toBe(20)
    expect(l.shortened).toBe(-1)
  })
})

describe('dashes', () => {
  it('rounds the pixel size to a power of two', () => {
    const camera = new PerspectiveCamera(50, 1, 1, 1e6)
    const size = quantizedPixelSize(1000, camera, 1000)
    expect(Math.log2(size) % 1).toBe(0)
    // a slightly different distance keeps the same pattern
    expect(quantizedPixelSize(1050, camera, 1000)).toBe(size)
    expect(quantizedPixelSize(4000, camera, 1000)).toBe(size * 4)
  })

  it('turns dashes on with a pattern in line widths, and off for a solid line', () => {
    const material = new LineMaterial()
    applyDash(material, { ...DEFAULT_TRACK_STYLE, dash: 'tirets', width: 4 }, 1, 0.25)
    expect(material.dashed).toBe(true)
    expect(material.dashScale).toBe(4)
    expect(material.dashSize).toBe(12)
    expect(material.gapSize).toBe(8)
    applyDash(material, DEFAULT_TRACK_STYLE, 1, 0.25)
    expect(material.dashed).toBe(false)
  })
})

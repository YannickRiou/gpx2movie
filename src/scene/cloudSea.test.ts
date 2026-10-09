import { describe, expect, it } from 'vitest'
import { cloudDrift } from '../weather/sceneClouds'
import {
  BILLOW_MEAN,
  NO_TERRAIN_M,
  SEA_BILLOWS,
  SEA_RELIEF_M,
  SEA_SWELL,
  billow,
  buildRadialGrid,
  curvatureDropM,
  edgeFade,
  gradientNoise,
  octaveWeight,
  rimFade,
  sampleTerrainGrid,
  seaBaseAltitude,
  seaNoisePoint,
  seaRelief,
  seaReliefGlsl,
  terrainBoxOf,
} from './cloudSea'

describe('sea relief', () => {
  it('is a pure function of the position', () => {
    expect(seaRelief(1234.5, -987.25)).toBe(seaRelief(1234.5, -987.25))
    expect(gradientNoise(3.3, -7.7)).toBe(gradientNoise(3.3, -7.7))
    expect(seaRelief(1234.5, -987.25)).not.toBe(seaRelief(1834.5, -987.25))
  })

  it('stays within [0, SEA_RELIEF_M] and rolls by tens of metres', () => {
    const values: number[] = []
    for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) values.push(seaRelief(i * 173 - 4000, j * 151 + 2500))
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...values)).toBeLessThanOrEqual(SEA_RELIEF_M)
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(80)
    expect(SEA_RELIEF_M).toBeLessThan(250)
  })

  it('is continuous: one metre changes the height by less than a metre', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 37.1 - 3000
      const z = i * -23.9 + 800
      expect(Math.abs(seaRelief(x + 1, z) - seaRelief(x, z))).toBeLessThan(1)
      expect(Math.abs(seaRelief(x, z + 1) - seaRelief(x, z))).toBeLessThan(1)
    }
  })

  it('billows are domes, highest over their centre, BILLOW_MEAN their mean', () => {
    let sum = 0
    let low = 1
    for (let i = 0; i < 200; i++) {
      for (let j = 0; j < 200; j++) {
        const b = billow(i * 0.137 + 3, j * 0.149 - 7)
        expect(b).toBeGreaterThanOrEqual(0)
        expect(b).toBeLessThanOrEqual(1)
        sum += b
        low = Math.min(low, b)
      }
    }
    expect(sum / 40000).toBeCloseTo(BILLOW_MEAN, 1)
    // gaps between the domes reach the bottom of the octave
    expect(low).toBeLessThan(0.05)
    expect(billow(2.3, -4.1)).toBe(billow(2.3, -4.1))
  })

  it('fades octaves smaller than the footprint to their mean (flat and noise-free far away)', () => {
    expect(octaveWeight(110, 0)).toBe(1)
    expect(octaveWeight(600, 100)).toBe(0.5)
    expect(octaveWeight(110, 100)).toBe(0)
    const flat = SEA_SWELL.amplitudeM * 0.5 + SEA_BILLOWS.reduce((s, o) => s + o.amplitudeM * BILLOW_MEAN, 0)
    expect(seaRelief(500, 700, 1e6)).toBeCloseTo(flat, 6)
    expect(seaRelief(-12_000, 3_000, 1e6)).toBeCloseTo(flat, 6)
  })
})

describe('drift', () => {
  it('moves the pattern with the wind, a function of the film time only', () => {
    const drift = cloudDrift({ east: 3, north: -2 }, 12.5)
    const [x, z] = seaNoisePoint(400 + drift.east, -900 - drift.north, drift)
    expect(x).toBeCloseTo(400, 9)
    expect(z).toBeCloseTo(-900, 9)
    // the pattern carried east-north-east is found downwind
    expect(seaRelief(...seaNoisePoint(400 + drift.east, -900 - drift.north, drift))).toBeCloseTo(seaRelief(400, -900), 9)
    expect(seaNoisePoint(10, 20, { east: 0, north: 0 })).toEqual([10, 20])
  })
})

describe('altitudes and fades', () => {
  it('puts the highest billows at the top of the sea, × exaggeration', () => {
    expect(seaBaseAltitude(2000, 1) + SEA_RELIEF_M).toBe(2000)
    expect(seaBaseAltitude(2000, 1.5) + SEA_RELIEF_M).toBe(3000)
    expect(seaBaseAltitude(2000, Number.NaN) + SEA_RELIEF_M).toBe(2000)
  })

  it('follows the curvature of the Earth', () => {
    expect(curvatureDropM(0, 0)).toBe(0)
    expect(curvatureDropM(30_000, 40_000)).toBeCloseTo(196.2, 1)
  })

  it('fades the cloud where it meets the terrain', () => {
    expect(edgeFade(2000, 2000, 120)).toBe(0)
    expect(edgeFade(2000, 2300, 120)).toBe(0)
    expect(edgeFade(2000, 1880, 120)).toBe(1)
    expect(edgeFade(2000, 1940, 120)).toBe(0.5)
    expect(edgeFade(2000, NO_TERRAIN_M, 120)).toBe(1)
    expect(edgeFade(2000, 1990, 120)).toBeLessThan(edgeFade(2000, 1960, 120))
  })

  it('fades toward the rim of the grid', () => {
    expect(rimFade(0, 1000)).toBe(1)
    expect(rimFade(750, 1000)).toBe(1)
    expect(rimFade(875, 1000)).toBe(0.5)
    expect(rimFade(1000, 1000)).toBe(0)
  })
})

describe('grids', () => {
  it('builds a disc of square cells, denser near the centre, facing up', () => {
    const grid = buildRadialGrid(10, 1000, 64)
    const rings = (grid.positions.length / 3 - 1) / 64
    expect(Number.isInteger(rings)).toBe(true)
    expect(rings).toBe(Math.ceil(Math.log(100) / Math.log(1 + grid.cellRatio)) + 1)
    const radius = (v: number) => Math.hypot(grid.positions[3 * v], grid.positions[3 * v + 2])
    expect(radius(1)).toBeCloseTo(10, 4)
    expect(radius(1 + (rings - 1) * 64)).toBeCloseTo(1000, 3)
    expect(grid.index.length).toBe(3 * 64 * (1 + 2 * (rings - 1)))
    for (let t = 0; t < grid.index.length; t += 3) {
      const [a, b, c] = [grid.index[t], grid.index[t + 1], grid.index[t + 2]].map((v) => [grid.positions[3 * v], grid.positions[3 * v + 2]])
      // y of (b − a) × (c − a)
      const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1])
      expect(up).toBeGreaterThan(0)
    }
  })

  it('samples the terrain at the texel centres of a box', () => {
    const box = terrainBoxOf([
      { x: -100, z: 50 },
      { x: 300, z: -150 },
    ])
    expect(box).toEqual({ minX: -100, minZ: -150, sizeX: 400, sizeZ: 200 })
    const grid = sampleTerrainGrid(box, 2, (x, z) => (x > 0 ? x + z : undefined))
    expect(Array.from(grid)).toEqual([NO_TERRAIN_M, 200 - 100, NO_TERRAIN_M, 200])
  })
})

describe('shader', () => {
  it('writes every octave and the shared constants', () => {
    const glsl = seaReliefGlsl()
    expect(glsl.match(/seaOctaveWeight\(/g)?.length).toBe(SEA_BILLOWS.length + 2)
    expect(glsl).toContain(`#define SEA_RELIEF_M ${SEA_RELIEF_M}.0`)
    expect(glsl).toContain('float seaRelief(vec2 p, float footprint)')
  })
})

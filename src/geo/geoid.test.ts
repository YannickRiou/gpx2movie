import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { createLocalFrame, ecefToLonLat } from './ellipsoid'
import { ellipsoidToMslHeight, geoidUndulation, mslLocalToEcef, mslToEllipsoidHeight } from './geoid'

/** Reference values: NGA EGM96 15' grid (bilinear), metres; the 1° grid rounds off the sharp extremes by a few metres. */
const REFERENCES: [name: string, lon: number, lat: number, n: number, tol: number][] = [
  ['Chamonix', 6.8694, 45.9237, 51.18, 0.5],
  ['Paris', 2.3522, 48.8566, 44.56, 0.5],
  ['Reykjavik', -21.94, 64.15, 66.42, 0.5],
  ['Denver', -104.99, 39.74, -16.98, 0.5],
  ['lowest, south of Sri Lanka', 78.75, 4.75, -106.99, 1.5],
  ['highest, New Guinea', 147.25, -8.25, 85.39, 5],
  ['Gulf of Guinea (0, 0)', 0, 0, 17.16, 0.01],
  ['North Pole', 0, 90, 13.61, 0.01],
  ['South Pole', 0, -90, -29.53, 0.01],
]

describe('geoidUndulation', () => {
  it.each(REFERENCES)('%s', (_name, lon, lat, n, tol) => {
    expect(Math.abs(geoidUndulation(lon, lat) - n)).toBeLessThanOrEqual(tol)
  })

  it('wraps the longitude across the antimeridian and clamps the latitude', () => {
    expect(geoidUndulation(180, 10)).toBeCloseTo(geoidUndulation(-180, 10), 6)
    expect(geoidUndulation(179.5, -20)).toBeCloseTo(geoidUndulation(-180.5, -20), 6)
    expect(geoidUndulation(370, 45)).toBeCloseTo(geoidUndulation(10, 45), 6)
    expect(geoidUndulation(12, 95)).toBeCloseTo(geoidUndulation(12, 90), 6)
    expect(geoidUndulation(12, -95)).toBeCloseTo(geoidUndulation(12, -90), 6)
  })

  it('is continuous between grid nodes', () => {
    const a = geoidUndulation(6.999999, 45.5)
    const b = geoidUndulation(7.000001, 45.5)
    expect(Math.abs(a - b)).toBeLessThan(1e-3)
  })
})

describe('MSL <-> ellipsoid heights', () => {
  it('adds the undulation and round-trips', () => {
    const n = geoidUndulation(6.87, 45.92)
    expect(mslToEllipsoidHeight(6.87, 45.92, 1035)).toBeCloseTo(1035 + n, 9)
    expect(ellipsoidToMslHeight(6.87, 45.92, mslToEllipsoidHeight(6.87, 45.92, 1035))).toBeCloseTo(1035, 9)
  })
})

describe('mslLocalToEcef', () => {
  it('puts local y = 0 on the geoid and local y = h at ellipsoid height h + N', () => {
    const frame = createLocalFrame(6.87, 45.92)
    const n = geoidUndulation(6.87, 45.92)
    const m = mslLocalToEcef(frame)
    const atOrigin = ecefToLonLat(new Vector3(0, 0, 0).applyMatrix4(m))
    expect(atOrigin.height).toBeCloseTo(n, 6)
    expect(atOrigin.lon).toBeCloseTo(6.87, 9)
    expect(atOrigin.lat).toBeCloseTo(45.92, 9)
    // a terrain point stored in MSL in the scene, 3 km away: ellipsoid height h + N(origin); the shift follows the
    // vertical of the origin, so the point also moves sideways by N × angle from the origin (~3 cm here)
    const local = frame.toLocal(6.9, 45.95, 1035)
    const p = ecefToLonLat(local.clone().applyMatrix4(m))
    expect(Math.abs(p.lon - 6.9)).toBeLessThan(1e-6)
    expect(Math.abs(p.lat - 45.95)).toBeLessThan(1e-6)
    expect(Math.abs(p.height - (1035 + n))).toBeLessThan(0.01)
  })

  it('keeps the axes of the frame and leaves it untouched', () => {
    const frame = createLocalFrame(-21.94, 64.15)
    const before = frame.localToEcef.clone()
    const m = mslLocalToEcef(frame)
    expect(frame.localToEcef.equals(before)).toBe(true)
    for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) expect(m.elements[i]).toBe(before.elements[i])
    const shift = new Vector3().setFromMatrixPosition(m).sub(frame.originEcef)
    expect(shift.length()).toBeCloseTo(geoidUndulation(-21.94, 64.15), 6)
  })
})

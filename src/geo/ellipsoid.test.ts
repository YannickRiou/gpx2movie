import { describe, expect, it } from 'vitest'
import { Matrix4, Vector3 } from 'three'
import type { LonLatBounds } from '../core/types'
import {
  WGS84,
  centroid,
  createLocalFrame,
  ecefToLonLat,
  expandBounds,
  haversineM,
  lonLatToEcef,
} from './ellipsoid'

const CHAMONIX = { lon: 6.87, lat: 45.92 }
/** Metres per degree of latitude, spherical approximation (good enough to place a test point). */
const M_PER_DEG_LAT = 111195
const DEG = Math.PI / 180

/** Meridian radius of curvature M(φ) = a(1−e²)/(1−e²sin²φ)^{3/2}: exact metres per radian going north. */
function meridianRadiusM(latDeg: number): number {
  const s = Math.sin(latDeg * DEG)
  return (WGS84.a * (1 - WGS84.e2)) / Math.pow(1 - WGS84.e2 * s * s, 1.5)
}

/** Prime-vertical radius N(φ) = a/√(1−e²sin²φ). */
function primeVerticalRadiusM(latDeg: number): number {
  const s = Math.sin(latDeg * DEG)
  return WGS84.a / Math.sqrt(1 - WGS84.e2 * s * s)
}

function expectVec(v: Vector3, x: number, y: number, z: number, tol: number): void {
  expect(Math.abs(v.x - x)).toBeLessThanOrEqual(tol)
  expect(Math.abs(v.y - y)).toBeLessThanOrEqual(tol)
  expect(Math.abs(v.z - z)).toBeLessThanOrEqual(tol)
}

function expectRoundTrip(lon: number, lat: number, height: number): void {
  const back = ecefToLonLat(lonLatToEcef(lon, lat, height))
  expect(Math.abs(back.lon - lon)).toBeLessThan(1e-9)
  expect(Math.abs(back.lat - lat)).toBeLessThan(1e-9)
  expect(Math.abs(back.height - height)).toBeLessThan(1e-6)
}

describe('WGS84 constants', () => {
  it('are self-consistent', () => {
    expect(WGS84.b).toBeCloseTo(WGS84.a * (1 - WGS84.f), 6)
    expect(WGS84.e2).toBeCloseTo(2 * WGS84.f - WGS84.f * WGS84.f, 15)
  })
})

describe('lonLatToEcef', () => {
  it('maps (0, 0, 0) to the X axis at the equatorial radius', () => {
    expectVec(lonLatToEcef(0, 0, 0), WGS84.a, 0, 0, 1e-6)
  })

  it('maps the north pole to the polar radius on +Z', () => {
    const v = lonLatToEcef(0, 90, 0)
    expect(Math.abs(v.z - 6356752.314245)).toBeLessThan(1e-3)
    expect(Math.abs(v.x)).toBeLessThan(1e-6)
    expect(Math.abs(v.y)).toBeLessThan(1e-6)
  })

  it('maps lon 90 / lat 0 to the +Y axis', () => {
    expectVec(lonLatToEcef(90, 0, 0), 0, WGS84.a, 0, 1e-6)
  })

  it('maps the south pole to -Z', () => {
    const v = lonLatToEcef(45, -90, 0)
    expect(Math.abs(v.z + WGS84.b)).toBeLessThan(1e-3)
  })

  it('adds height along the ellipsoid normal', () => {
    expectVec(lonLatToEcef(0, 0, 1000), WGS84.a + 1000, 0, 0, 1e-6)
    const pole = lonLatToEcef(0, 90, 1000)
    expect(Math.abs(pole.z - (WGS84.b + 1000))).toBeLessThan(1e-3)
  })

  it('writes into the provided target and returns it', () => {
    const target = new Vector3()
    const out = lonLatToEcef(10, 20, 30, target)
    expect(out).toBe(target)
  })
})

describe('ecefToLonLat', () => {
  it('round-trips a spread of points to 1e-9 deg / 1e-6 m', () => {
    const cases: Array<[number, number, number]> = [
      [0, 0, 0],
      [CHAMONIX.lon, CHAMONIX.lat, 1035],
      [86.925, 27.9881, 8848], // Everest
      [35.5, 31.5, -400], // Dead Sea
      [-70.6693, -33.4489, 520], // Santiago (south / west)
      [151.2093, -33.8688, 0], // Sydney
      [-157.8583, 21.3069, 10], // Honolulu
      [0, 89.9, 0],
      [45, 89.9, 2000],
      [-120, -89.9, -50],
      [179.999, 0.001, 5],
      [-179.999, -0.001, 5],
      [12.5, 45, 1e5], // 100 km up
    ]
    for (const [lon, lat, h] of cases) expectRoundTrip(lon, lat, h)
  })

  it('handles points exactly on the polar axis', () => {
    const north = ecefToLonLat(new Vector3(0, 0, WGS84.b + 100))
    expect(north.lat).toBe(90)
    expect(Math.abs(north.height - 100)).toBeLessThan(1e-6)
    const south = ecefToLonLat(new Vector3(0, 0, -WGS84.b - 100))
    expect(south.lat).toBe(-90)
    expect(Math.abs(south.height - 100)).toBeLessThan(1e-6)
  })

  it('inverts the pole as produced by lonLatToEcef', () => {
    const back = ecefToLonLat(lonLatToEcef(30, 90, 0))
    expect(Math.abs(back.lat - 90)).toBeLessThan(1e-9)
    expect(Math.abs(back.height)).toBeLessThan(1e-6)
  })

  it('is accurate on a dense latitude sweep', () => {
    for (let lat = -89; lat <= 89; lat += 7) {
      for (let lon = -180; lon < 180; lon += 45) expectRoundTrip(lon, lat, 500)
    }
  })
})

describe('createLocalFrame', () => {
  const frame = createLocalFrame(CHAMONIX.lon, CHAMONIX.lat)

  it('stores the origin and its ECEF position', () => {
    expect(frame.origin).toEqual(CHAMONIX)
    const expected = lonLatToEcef(CHAMONIX.lon, CHAMONIX.lat, 0)
    expectVec(frame.originEcef, expected.x, expected.y, expected.z, 1e-9)
  })

  it('maps the origin to (0, 0, 0)', () => {
    expectVec(frame.toLocal(CHAMONIX.lon, CHAMONIX.lat, 0), 0, 0, 0, 1e-6)
  })

  it('puts a point 1 km north on -Z with the curvature drop on Y', () => {
    const dLat = 1000 / M_PER_DEG_LAT
    const p = frame.toLocal(CHAMONIX.lon, CHAMONIX.lat + dLat, 0)
    expect(Math.abs(p.z + 1000)).toBeLessThanOrEqual(2)
    // exact meridian arc at this latitude (chord/arc difference is ~1e-6 m over 1 km)
    const arcM = meridianRadiusM(CHAMONIX.lat) * dLat * DEG
    expect(Math.abs(p.z + arcM)).toBeLessThan(0.01)
    expect(Math.abs(p.x)).toBeLessThan(1e-6)
    // the ellipsoid curves away: drop ≈ d² / (2M) ≈ 0.078 m
    expect(Math.abs(p.y + 0.078)).toBeLessThanOrEqual(0.02)
    expect(Math.abs(p.y + (arcM * arcM) / (2 * meridianRadiusM(CHAMONIX.lat)))).toBeLessThan(1e-3)
  })

  it('puts a point to the east on +X', () => {
    const dLon = 0.01
    const p = frame.toLocal(CHAMONIX.lon + dLon, CHAMONIX.lat, 0)
    // radius of the parallel = N cos φ; arc along it
    const parallelR = primeVerticalRadiusM(CHAMONIX.lat) * Math.cos(CHAMONIX.lat * DEG)
    const arcM = parallelR * dLon * DEG
    expect(p.x).toBeGreaterThan(700)
    expect(p.x).toBeLessThan(800)
    expect(Math.abs(p.x - arcM)).toBeLessThan(0.01)
    // a parallel is not a geodesic: its chord sags d²/(2·N cos φ) towards the polar axis,
    // which projects onto -Z (north) by sin φ and onto -Y (down) by cos φ
    const sag = (arcM * arcM) / (2 * parallelR)
    expect(Math.abs(p.z + sag * Math.sin(CHAMONIX.lat * DEG))).toBeLessThan(1e-3)
    expect(Math.abs(p.y + sag * Math.cos(CHAMONIX.lat * DEG))).toBeLessThan(1e-3)
  })

  it('puts a point to the south on +Z and to the west on -X', () => {
    const south = frame.toLocal(CHAMONIX.lon, CHAMONIX.lat - 0.01, 0)
    expect(south.z).toBeGreaterThan(1000)
    const west = frame.toLocal(CHAMONIX.lon - 0.01, CHAMONIX.lat, 0)
    expect(west.x).toBeLessThan(-700)
  })

  it('maps height to +Y at the origin', () => {
    const p = frame.toLocal(CHAMONIX.lon, CHAMONIX.lat, 4808)
    expectVec(p, 0, 4808, 0, 1e-6)
  })

  it('has a right-handed orthonormal rotation', () => {
    const m = frame.localToEcef.elements
    const ex = new Vector3(m[0], m[1], m[2])
    const ey = new Vector3(m[4], m[5], m[6])
    const ez = new Vector3(m[8], m[9], m[10])
    expect(Math.abs(ex.length() - 1)).toBeLessThan(1e-12)
    expect(Math.abs(ey.length() - 1)).toBeLessThan(1e-12)
    expect(Math.abs(ez.length() - 1)).toBeLessThan(1e-12)
    expect(Math.abs(ex.dot(ey))).toBeLessThan(1e-12)
    expect(Math.abs(ey.dot(ez))).toBeLessThan(1e-12)
    expect(Math.abs(ez.dot(ex))).toBeLessThan(1e-12)
    // X × Y = Z
    const cross = ex.clone().cross(ey)
    expectVec(cross, ez.x, ez.y, ez.z, 1e-12)
    // Y (up) is the ellipsoid normal at the origin
    const phi = (CHAMONIX.lat * Math.PI) / 180
    const lam = (CHAMONIX.lon * Math.PI) / 180
    expectVec(ey, Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi), 1e-12)
  })

  it('localToEcef * ecefToLocal is the identity', () => {
    const products = [
      new Matrix4().multiplyMatrices(frame.localToEcef, frame.ecefToLocal),
      new Matrix4().multiplyMatrices(frame.ecefToLocal, frame.localToEcef),
    ]
    const identity = new Matrix4().identity().elements
    for (const product of products) {
      let maxErr = 0
      product.elements.forEach((e, i) => {
        maxErr = Math.max(maxErr, Math.abs(e - identity[i]))
      })
      expect(maxErr).toBeLessThan(1e-9)
    }
  })

  it('toLonLat inverts toLocal', () => {
    const cases: Array<[number, number, number]> = [
      [CHAMONIX.lon, CHAMONIX.lat, 0],
      [CHAMONIX.lon + 0.3, CHAMONIX.lat - 0.2, 4808],
      [CHAMONIX.lon - 1.5, CHAMONIX.lat + 1.1, -120],
      [CHAMONIX.lon + 5, CHAMONIX.lat + 5, 12000],
    ]
    for (const [lon, lat, h] of cases) {
      const back = frame.toLonLat(frame.toLocal(lon, lat, h))
      expect(Math.abs(back.lon - lon)).toBeLessThan(1e-9)
      expect(Math.abs(back.lat - lat)).toBeLessThan(1e-9)
      expect(Math.abs(back.height - h)).toBeLessThan(1e-6)
    }
  })

  it('toLocal writes into the provided target', () => {
    const target = new Vector3()
    expect(frame.toLocal(CHAMONIX.lon, CHAMONIX.lat, 10, target)).toBe(target)
  })

  it('works in the southern / western hemispheres', () => {
    const lat = -33.4489
    const lon = -70.6693
    const f = createLocalFrame(lon, lat)
    expectVec(f.toLocal(lon, lat, 0), 0, 0, 0, 1e-6)
    const dLat = 1000 / M_PER_DEG_LAT
    const north = f.toLocal(lon, lat + dLat, 0)
    const arcM = meridianRadiusM(lat) * dLat * DEG
    expect(Math.abs(north.z + arcM)).toBeLessThan(0.01)
    expect(Math.abs(north.z + 1000)).toBeLessThanOrEqual(3) // meridian is shorter at 33° than the 111195 m/deg mean
    expect(north.y).toBeLessThan(0)
    const east = f.toLocal(lon + 0.01, lat, 0)
    expect(east.x).toBeGreaterThan(0)
    // southern hemisphere: the parallel sags towards the axis, i.e. south → +Z
    expect(east.z).toBeGreaterThan(0)
    const up = f.toLocal(lon, lat, 500)
    expectVec(up, 0, 500, 0, 1e-6)
  })
})

describe('haversineM', () => {
  it('Paris – Marseille ≈ 661 km', () => {
    const d = haversineM({ lon: 2.3522, lat: 48.8566 }, { lon: 5.3698, lat: 43.2965 })
    expect(Math.abs(d - 661_000)).toBeLessThan(3_000)
  })

  it('is zero for identical points and symmetric', () => {
    const a = { lon: 6.87, lat: 45.92 }
    const b = { lon: 7.0, lat: 46.0 }
    expect(haversineM(a, a)).toBe(0)
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 9)
  })

  it('gives half the circumference for antipodes', () => {
    const d = haversineM({ lon: 0, lat: 0 }, { lon: 180, lat: 0 })
    expect(d).toBeCloseTo(Math.PI * 6371008.8, 3)
  })

  it('matches 1 arc-minute ≈ 1852 m along a meridian', () => {
    const d = haversineM({ lon: 0, lat: 0 }, { lon: 0, lat: 1 / 60 })
    expect(Math.abs(d - 1853.25)).toBeLessThan(1)
  })
})

describe('centroid', () => {
  it('returns the box centre', () => {
    expect(centroid({ west: 6, south: 45, east: 8, north: 47 })).toEqual({ lon: 7, lat: 46 })
  })
})

describe('expandBounds', () => {
  const box: LonLatBounds = { west: 6.8, south: 45.9, east: 6.9, north: 46.0 }

  it('keeps the centroid', () => {
    const out = expandBounds(box, 5000)
    expect(centroid(out).lon).toBeCloseTo(centroid(box).lon, 9)
    expect(centroid(out).lat).toBeCloseTo(centroid(box).lat, 9)
  })

  it('adds the margin on every side', () => {
    const marginM = 10_000
    const out = expandBounds(box, marginM)
    const mPerDegLat = 111320
    const mPerDegLon = 111320 * Math.cos((centroid(box).lat * Math.PI) / 180)
    expect((box.south - out.south) * mPerDegLat).toBeCloseTo(marginM, 3)
    expect((out.north - box.north) * mPerDegLat).toBeCloseTo(marginM, 3)
    expect((box.west - out.west) * mPerDegLon).toBeCloseTo(marginM, 3)
    expect((out.east - box.east) * mPerDegLon).toBeCloseTo(marginM, 3)
  })

  it('is a no-op with zero margin and no minimum', () => {
    const out = expandBounds(box, 0)
    expect(out.west).toBeCloseTo(box.west, 9)
    expect(out.east).toBeCloseTo(box.east, 9)
    expect(out.south).toBeCloseTo(box.south, 9)
    expect(out.north).toBeCloseTo(box.north, 9)
  })

  it('enforces the minimum size when the box is small', () => {
    const point: LonLatBounds = { west: 6.87, south: 45.92, east: 6.87, north: 45.92 }
    const out = expandBounds(point, 0, 40_000)
    const mPerDegLat = 111320
    const mPerDegLon = 111320 * Math.cos((45.92 * Math.PI) / 180)
    expect((out.north - out.south) * mPerDegLat).toBeCloseTo(40_000, 3)
    expect((out.east - out.west) * mPerDegLon).toBeCloseTo(40_000, 3)
    expect(centroid(out).lon).toBeCloseTo(6.87, 9)
    expect(centroid(out).lat).toBeCloseTo(45.92, 9)
  })

  it('does not shrink a box already larger than the minimum', () => {
    const big: LonLatBounds = { west: 0, south: 40, east: 10, north: 50 }
    const out = expandBounds(big, 0, 40_000)
    expect(out.west).toBeCloseTo(0, 9)
    expect(out.east).toBeCloseTo(10, 9)
    expect(out.south).toBeCloseTo(40, 9)
    expect(out.north).toBeCloseTo(50, 9)
  })

  it('clamps to the Web Mercator world', () => {
    const polar: LonLatBounds = { west: -179, south: 80, east: 179, north: 85 }
    const out = expandBounds(polar, 2_000_000)
    expect(out.west).toBe(-180)
    expect(out.east).toBe(180)
    expect(out.north).toBeLessThanOrEqual(85.05)
    expect(out.south).toBeGreaterThanOrEqual(-85.05)
  })
})

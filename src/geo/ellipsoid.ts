/**
 * WGS84 ellipsoid maths: lon/lat/height <-> ECEF, local tangent frames (X east, Y up, Z south).
 * All computations are done in JS doubles. See src/core/types.ts for conventions.
 */
import { Matrix4, Vector3 } from 'three'
import type { LocalFrame } from '../core/types'

export const WGS84 = {
  a: 6378137,
  f: 1 / 298.257223563,
  b: 6356752.314245179,
  e2: 0.00669437999014132,
} as const

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

/** lon/lat degrees, height metres -> ECEF metres. */
export function lonLatToEcef(lon: number, lat: number, height: number, target = new Vector3()): Vector3 {
  const phi = lat * DEG
  const lambda = lon * DEG
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const n = WGS84.a / Math.sqrt(1 - WGS84.e2 * sinPhi * sinPhi)
  const x = (n + height) * cosPhi * Math.cos(lambda)
  const y = (n + height) * cosPhi * Math.sin(lambda)
  const z = (n * (1 - WGS84.e2) + height) * sinPhi
  return target.set(x, y, z)
}

/**
 * Ellipsoid height from the converged geodetic latitude. Two algebraically equivalent
 * expressions exist; pick the better-conditioned one (p/cos blows up near the poles,
 * z/sin blows up near the equator).
 */
function ellipsoidHeight(p: number, z: number, phi: number): number {
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const n = WGS84.a / Math.sqrt(1 - WGS84.e2 * sinPhi * sinPhi)
  return Math.abs(cosPhi) >= Math.abs(sinPhi) ? p / cosPhi - n : z / sinPhi - n * (1 - WGS84.e2)
}

/**
 * ECEF metres -> lon/lat degrees + ellipsoid height.
 * Fixed-point iteration on the geodetic latitude (contraction factor ~e2 per step, so
 * ~5 iterations reach double precision); accurate to < 1e-9 deg / 1e-6 m at any latitude.
 */
export function ecefToLonLat(ecef: Vector3): { lon: number; lat: number; height: number } {
  const { x, y, z } = ecef
  const lambda = Math.atan2(y, x)
  const p = Math.hypot(x, y)
  if (p < 1e-9) {
    // on the polar axis: longitude is undefined, latitude is exactly ±90
    const height = Math.abs(z) - WGS84.b
    return { lon: lambda * RAD, lat: z >= 0 ? 90 : -90, height }
  }
  let phi = Math.atan2(z, p * (1 - WGS84.e2))
  for (let i = 0; i < 10; i++) {
    const sinPhi = Math.sin(phi)
    const n = WGS84.a / Math.sqrt(1 - WGS84.e2 * sinPhi * sinPhi)
    const height = ellipsoidHeight(p, z, phi)
    const next = Math.atan2(z, p * (1 - (WGS84.e2 * n) / (n + height)))
    const converged = Math.abs(next - phi) < 1e-14
    phi = next
    if (converged) break
  }
  return { lon: lambda * RAD, lat: phi * RAD, height: ellipsoidHeight(p, z, phi) }
}

/**
 * Local tangent frame at (lon, lat), height 0.
 * Local axes in ECEF: X = east, Y = up (ellipsoid normal), Z = south.
 */
export function createLocalFrame(lon: number, lat: number): LocalFrame {
  const phi = lat * DEG
  const lambda = lon * DEG
  const sinPhi = Math.sin(phi)
  const cosPhi = Math.cos(phi)
  const sinLam = Math.sin(lambda)
  const cosLam = Math.cos(lambda)

  const east = new Vector3(-sinLam, cosLam, 0)
  const north = new Vector3(-sinPhi * cosLam, -sinPhi * sinLam, cosPhi)
  const up = new Vector3(cosPhi * cosLam, cosPhi * sinLam, sinPhi)
  const south = north.clone().negate()

  const originEcef = lonLatToEcef(lon, lat, 0)

  // columns = local axes expressed in ECEF, translation = origin
  const localToEcef = new Matrix4().makeBasis(east, up, south).setPosition(originEcef)

  // exact inverse of a rigid transform: R^T and -R^T * t
  const rT = new Matrix4().makeBasis(east, up, south).transpose()
  const t = originEcef.clone().applyMatrix4(rT).negate()
  const ecefToLocal = rT.clone().setPosition(t)

  const scratch = new Vector3()

  return {
    origin: { lon, lat },
    originEcef,
    localToEcef,
    ecefToLocal,
    toLocal(lonDeg, latDeg, height, target = new Vector3()) {
      lonLatToEcef(lonDeg, latDeg, height, target)
      return target.applyMatrix4(ecefToLocal)
    },
    toLonLat(local) {
      scratch.copy(local).applyMatrix4(localToEcef)
      return ecefToLonLat(scratch)
    },
  }
}

// re-exported for the scene code; the rest of the app imports them from ./lonLat (no three.js at startup)
export { centroid, expandBounds, haversineM } from './lonLat'

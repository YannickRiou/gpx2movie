/**
 * Lon/lat maths that need no three.js (distances, boxes), so that the app imports them without loading the 3D
 * engine at startup. Ellipsoid and local frames: ./ellipsoid.ts.
 */
import type { LonLat, LonLatBounds } from '../core/types'

const DEG = Math.PI / 180

/** Great-circle distance in metres (spherical approximation, R = 6371008.8 m). */
export function haversineM(a: LonLat, b: LonLat): number {
  const r = 6371008.8
  const dLat = (b.lat - a.lat) * DEG
  const dLon = (b.lon - a.lon) * DEG
  const s1 = Math.sin(dLat / 2)
  const s2 = Math.sin(dLon / 2)
  const h = s1 * s1 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * s2 * s2
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Distance of every point from the start of its track (metres): `startM` plus the length along `points`, the
 * jump between two segments adding nothing (as `buildTrackPath`, which places the marker).
 */
export function cumulativeDistances(points: readonly LonLat[], startM = 0): Float64Array {
  const out = new Float64Array(points.length)
  let total = startM
  for (let i = 0; i < points.length; i++) {
    if (i > 0) total += haversineM(points[i - 1], points[i])
    out[i] = total
  }
  return out
}

/** Centre of a lon/lat box (does not handle the antimeridian). */
export function centroid(bounds: LonLatBounds): LonLat {
  return { lon: (bounds.west + bounds.east) / 2, lat: (bounds.south + bounds.north) / 2 }
}

/** Expand a box by `marginM` metres on every side, and to at least `minSizeM` across. */
export function expandBounds(bounds: LonLatBounds, marginM: number, minSizeM = 0): LonLatBounds {
  const c = centroid(bounds)
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos(c.lat * DEG)
  const heightM = Math.max((bounds.north - bounds.south) * mPerDegLat + 2 * marginM, minSizeM)
  const widthM = Math.max((bounds.east - bounds.west) * mPerDegLon + 2 * marginM, minSizeM)
  const halfLat = heightM / 2 / mPerDegLat
  const halfLon = widthM / 2 / mPerDegLon
  return {
    west: Math.max(-180, c.lon - halfLon),
    east: Math.min(180, c.lon + halfLon),
    south: Math.max(-85.05, c.lat - halfLat),
    north: Math.min(85.05, c.lat + halfLat),
  }
}

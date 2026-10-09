/**
 * Geoid: EGM96 undulation N (metres, height of mean sea level above the WGS84 ellipsoid), 1° grid, bilinear.
 *
 * Elevation tiles and GPX / FIT elevations are heights above mean sea level; ECEF and the Takram atmosphere work in
 * ellipsoid heights: h_ellipsoid = h_msl + N (~+51 m around Chamonix, -107 m to +85 m worldwide).
 * The scene keeps MSL heights in its local frame; only what reads it in true ECEF (atmosphere, clouds) uses
 * `mslLocalToEcef`, the local frame raised by N at its origin. N varies by a few metres at most across a scene, so a
 * constant offset is enough.
 *
 * Grid: src/geo/egm96Grid.ts (scripts/gen-geoid.mjs, NGA EGM96, public domain). Error against the NGA 15' grid: 0.45 m
 * RMS, < 2 m for 99 % of the globe, up to ~14 m on steep volcanic islands.
 */
import { Matrix4, Vector3 } from 'three'
import type { LocalFrame } from '../core/types'
import { EGM96_CM_BASE64, EGM96_COLS, EGM96_ROWS } from './egm96Grid'

let grid: Float32Array | null = null

/** Decoded on first use (130 KB of Int16 centimetres). */
function egm96(): Float32Array {
  if (grid) return grid
  const bytes = Uint8Array.from(atob(EGM96_CM_BASE64), (c) => c.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  const values = new Float32Array(EGM96_ROWS * EGM96_COLS)
  for (let i = 0; i < values.length; i++) values[i] = view.getInt16(i * 2, true) / 100
  grid = values
  return values
}

/** EGM96 geoid undulation at lon/lat degrees (metres above the WGS84 ellipsoid). Longitude wraps, latitude is clamped. */
export function geoidUndulation(lon: number, lat: number): number {
  const g = egm96()
  const x = ((((lon + 180) % 360) + 360) % 360)
  const y = Math.min(EGM96_ROWS - 1, Math.max(0, 90 - lat))
  const c0 = Math.floor(x)
  const r0 = Math.min(EGM96_ROWS - 2, Math.floor(y))
  const fx = x - c0
  const fy = y - r0
  const c1 = (c0 + 1) % EGM96_COLS
  const at = (r: number, c: number) => g[r * EGM96_COLS + c]
  const top = at(r0, c0) + (at(r0, c1) - at(r0, c0)) * fx
  const bottom = at(r0 + 1, c0) + (at(r0 + 1, c1) - at(r0 + 1, c0)) * fx
  return top + (bottom - top) * fy
}

/** Height above mean sea level -> height above the WGS84 ellipsoid (metres). */
export function mslToEllipsoidHeight(lon: number, lat: number, heightMsl: number): number {
  return heightMsl + geoidUndulation(lon, lat)
}

/** Height above the WGS84 ellipsoid -> height above mean sea level (metres). */
export function ellipsoidToMslHeight(lon: number, lat: number, heightEllipsoid: number): number {
  return heightEllipsoid - geoidUndulation(lon, lat)
}

const _up = new Vector3()

/**
 * True local -> ECEF matrix of a scene whose heights are above mean sea level: `frame.localToEcef` with its origin
 * raised by N along the vertical, so local y = 0 lands on the geoid at the frame origin (and local y = h at
 * ellipsoid height h + N). For the atmosphere's world -> ECEF matrix.
 */
export function mslLocalToEcef(frame: LocalFrame, target = new Matrix4()): Matrix4 {
  const n = geoidUndulation(frame.origin.lon, frame.origin.lat)
  _up.setFromMatrixColumn(frame.localToEcef, 1).normalize()
  target.copy(frame.localToEcef)
  const e = target.elements
  e[12] += _up.x * n
  e[13] += _up.y * n
  e[14] += _up.z * n
  return target
}

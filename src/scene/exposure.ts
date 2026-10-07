/**
 * Scene exposure under the physical atmosphere. Takram radiances are physical: the daylight exposure would
 * leave dusk and night pitch black, so the exposure opens up as the sun goes down, like a camera on
 * automatic, and the user adds a compensation in stops (EV).
 *
 * Pure functions (no React, no renderer).
 */
import type { Vector3 } from 'three'

/** Radiance → display scale in daylight. */
export const DAYLIGHT_EXPOSURE = 5

/** Automatic extra stops by sun elevation (degrees): none in daylight, then civil dusk, then full night. */
const AUTO_EV_CURVE: readonly (readonly [elevationDeg: number, ev: number])[] = [
  [10, 0],
  [-6, 3],
  [-18, 6],
]

/** Faint sky fill of the relief at night (the atmosphere only models sunlight), before exposure. */
export const NIGHT_FILL_INTENSITY = 0.004

const DEG = 180 / Math.PI

/** Sun elevation above the local horizon (radians) from unit ECEF vectors. */
export function sunElevation(sunDirectionEcef: Vector3, upEcef: Vector3): number {
  return Math.asin(Math.min(1, Math.max(-1, sunDirectionEcef.dot(upEcef))))
}

/** Extra stops opened automatically for a sun at `elevationRad` (piecewise linear, clamped). */
export function autoExposureEv(elevationRad: number): number {
  const deg = elevationRad * DEG
  const first = AUTO_EV_CURVE[0]
  const last = AUTO_EV_CURVE[AUTO_EV_CURVE.length - 1]
  if (deg >= first[0]) return first[1]
  if (deg <= last[0]) return last[1]
  for (let i = 1; i < AUTO_EV_CURVE.length; i++) {
    const [d1, ev1] = AUTO_EV_CURVE[i]
    if (deg >= d1) {
      const [d0, ev0] = AUTO_EV_CURVE[i - 1]
      return ev0 + ((deg - d0) / (d1 - d0)) * (ev1 - ev0)
    }
  }
  return last[1]
}

/** Renderer exposure for the sun elevation and the user compensation (stops). */
export function sceneExposure(elevationRad: number, compensationEv: number): number {
  return DAYLIGHT_EXPOSURE * 2 ** (autoExposureEv(elevationRad) + compensationEv)
}

/** Night fill light: 0 while the sun is up, full once it is 6° below the horizon. */
export function nightFillIntensity(elevationRad: number): number {
  const t = Math.min(1, Math.max(0, -(elevationRad * DEG) / 6))
  return NIGHT_FILL_INTENSITY * t
}

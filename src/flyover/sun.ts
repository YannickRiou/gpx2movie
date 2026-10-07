/**
 * Date used to light the scene (sun and moon positions): the recorded time under the flyover marker, so a
 * dawn outing replays its sunrise, or a fixed local solar hour when the track has no time.
 *
 * Pure functions (no DOM, no React, no Three).
 */
import { recordedTimeAt, type TrackPath } from './path'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/**
 * Instant at which the local mean solar time at `lon` is `solarHour`, on the UTC day containing `dayMs`.
 * Solar time keeps the setting independent of time zones: 12 h is always the sun near its highest.
 */
export function solarHourToDate(dayMs: number, lon: number, solarHour: number): Date {
  const dayStart = Math.floor(dayMs / DAY_MS) * DAY_MS
  return new Date(dayStart + (solarHour - lon / 15) * HOUR_MS)
}

export interface SunDateOptions {
  /** follow the recorded time of the track when it has one */
  sunFromTrack: boolean
  /** fallback: local mean solar time (hours) at `lon` (degrees) on the UTC day containing `dayMs` */
  solarHour: number
  lon: number
  dayMs: number
}

/**
 * Date of the sun at `progress` (0..1) along `path`: the recorded time there (points without time bridged by
 * `recordedTimeAt`) when `sunFromTrack` is on, otherwise, or when the path has no time at all, the fixed
 * solar hour. `path` may be null (no track).
 */
export function sunDateAt(path: TrackPath | null, progress: number, opts: SunDateOptions): Date {
  if (opts.sunFromTrack && path && path.count > 0) {
    const time = recordedTimeAt(path, progress * path.lengthM)
    if (time !== undefined) return new Date(time)
  }
  return solarHourToDate(opts.dayMs, opts.lon, opts.solarHour)
}

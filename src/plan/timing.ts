/**
 * Estimated passage times of a planned route (« Prévoir la sortie »): elapsed time at each point for an activity and
 * a pace factor, without pauses, written onto the track points so that everything that reads recorded times (sun,
 * counters, weather, ghost race) works on a route exported without them (Komoot, Visorando, IGNrando…).
 *
 * Pure functions (no DOM, no React); the departure is read in the time zone of this device.
 */
import type { Track, TrackPoint, TrackSegment } from '../core/types'
import { haversineM } from '../geo/lonLat'
import { computeStats, smoothElevations } from '../import/stats'

export const PLAN_ACTIVITIES = ['hiking', 'trail', 'cycling'] as const
export type PlanActivity = (typeof PLAN_ACTIVITIES)[number]

export const PLAN_ACTIVITY_LABELS: Readonly<Record<PlanActivity, string>> = {
  hiking: 'Randonnée',
  trail: 'Trail',
  cycling: 'Vélo',
}

/** « Rythme »: factor on every duration (1 = the model, 1.2 = 20 % more time, 0.8 = 20 % less). */
export const PACE_RANGE = { min: 0.7, max: 1.5, step: 0.05 } as const

export interface OutingPlan {
  activity: PlanActivity
  /** factor on the model's durations, within `PACE_RANGE` */
  pace: number
  /** departure instant (ms since epoch) */
  departureMs: number
  /** minutes the local clock of the departure is ahead of UTC */
  utcOffsetMin: number
}

const HOUR_S = 3600

/**
 * Hours to cover a stretch of `distanceM` horizontal metres climbing `upM` and descending `downM`:
 * - hiking, DIN 33466 (German hiking-time standard, used by the Alpine clubs): 4 km/h on the flat, 300 m/h up,
 *   500 m/h down; the longer of the horizontal and vertical times plus half the shorter one;
 * - trail: ITRA effort distance (1 km-effort = 1 km on the flat or 100 m of climbing) at 8 km-effort/h, descents
 *   counted as flat;
 * - cycling: additive rule in the manner of Naismith, 20 km/h on the flat plus 1 h per 600 m of climbing, descents
 *   counted as flat (bends, braking).
 */
export function stretchHours(activity: PlanActivity, distanceM: number, upM: number, downM: number): number {
  switch (activity) {
    case 'hiking': {
      const horizontal = distanceM / 4000
      const vertical = upM / 300 + downM / 500
      return Math.max(horizontal, vertical) + Math.min(horizontal, vertical) / 2
    }
    case 'trail':
      return (distanceM / 1000 + upM / 100) / 8
    case 'cycling':
      return distanceM / 20_000 + upM / 600
  }
}

/** Elevations of a segment smoothed as for its D+ (`smoothElevations`); null when a point has none (flat route). */
function smoothedElevations(points: readonly TrackPoint[]): number[] | null {
  const elevations = points.map((p) => p.ele)
  if (!elevations.every((e) => e !== undefined && Number.isFinite(e))) return null
  return smoothElevations(elevations as number[])
}

/**
 * Estimated seconds from the start at each point, one array per segment, `pace` applied, no pauses. The jump between
 * two segments takes no time (as for the distance).
 */
export function estimateElapsedS(segments: readonly TrackSegment[], activity: PlanActivity, pace: number): number[][] {
  let elapsedS = 0
  return segments.map(({ points }) => {
    const elevations = smoothedElevations(points)
    return points.map((point, i) => {
      if (i > 0) {
        const climbM = elevations ? elevations[i] - elevations[i - 1] : 0
        const hours = stretchHours(activity, haversineM(points[i - 1], point), Math.max(0, climbM), Math.max(0, -climbM))
        elapsedS += hours * HOUR_S * pace
      }
      return elapsedS
    })
  })
}

/** The track with estimated times on every point (whole milliseconds), recomputed stats and `timesEstimated`. */
export function withEstimatedTimes(track: Track, plan: OutingPlan): Track {
  const elapsed = estimateElapsedS(track.segments, plan.activity, plan.pace)
  const segments = track.segments.map((segment, s) => ({
    points: segment.points.map((p, i) => ({ ...p, time: Math.round(plan.departureMs + elapsed[s][i] * 1000) })),
  }))
  return { ...track, segments, stats: computeStats(segments), timesEstimated: true, utcOffsetMin: plan.utcOffsetMin }
}

/** The track as planned before: no time on any point, no clock offset, no `timesEstimated`. */
export function withoutTimes(track: Track): Track {
  const segments = track.segments.map((segment) => ({
    points: segment.points.map((p) => {
      const point = { ...p }
      delete point.time
      return point
    }),
  }))
  const out: Track = { ...track, segments, stats: computeStats(segments) }
  delete out.timesEstimated
  delete out.utcOffsetMin
  return out
}

/** Activity of the plan from the track's own (GPX <type>, FIT sport); hiking when unknown. */
export function planActivityOf(activityType: string | undefined): PlanActivity {
  const type = activityType?.toLowerCase() ?? ''
  if (/run|trail|course/.test(type)) return 'trail'
  if (/cycl|bik|ride|v[ée]lo/.test(type)) return 'cycling'
  return 'hiking'
}

/** Instant of `day` ('YYYY-MM-DD') at `time` ('HH:MM') on this device's clock; undefined when either is invalid. */
export function localDepartureMs(day: string, time: string): number | undefined {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return undefined
  const ms = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2])).getTime()
  return Number.isNaN(ms) ? undefined : ms
}

/** Date ('YYYY-MM-DD') and time ('HH:MM') of `ms` on this device's clock: the inverse of `localDepartureMs`. */
export function localDayAndTime(ms: number): { day: string; time: string } {
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    day: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  }
}

/** Minutes this device's clock is ahead of UTC at `ms` (summer time included). */
export function localUtcOffsetMin(ms: number): number {
  return 0 - new Date(ms).getTimezoneOffset() // `0 -` rather than `-`: no -0 at UTC
}

/**
 * Date used to light the scene (sun and moon positions): the recorded time under the flyover marker, so a
 * dawn outing replays its sunrise, or a fixed local solar hour when the track has no time.
 *
 * Pure functions (no DOM, no React, no Three).
 */
import type { FilmClock } from '../film/clock'
import { shotSunOf } from '../film/model'
import { recordedTimeAt, type TrackPath } from './path'

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

/** A day typed by the user, `YYYY-MM-DD`; '' stands for the day of the track. */
export function isSunDate(value: string): boolean {
  return value === '' || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)))
}

/** The day lit at a fixed solar hour: the one chosen (`sunDate`), else the start of the track, else `today`. */
export function sunDayMs(sunDate: string, startTime: number | undefined, today: number): number {
  return sunDate ? Date.parse(`${sunDate}T00:00:00Z`) : (startTime ?? today)
}

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

/** Hours of the day the sun runs over a 'situation' shot that moves it (« Faire bouger le soleil »). */
export const SHOT_SUN_HOURS = 2

/**
 * Shift (ms) of the sun date at film time `timeS` during a 'situation' shot with `moveSun`, 0 anywhere else: a time
 * lapse of SHOT_SUN_HOURS over the whole shot that joins the flight's own sun without a jump. Opening: from
 * SHOT_SUN_HOURS before the time at the start of the flight, slowing down to it (−H·(1 − u)², u = share of the
 * shot); closing: from the time at the end of the flight, speeding up to SHOT_SUN_HOURS after it (H·u²). The sun
 * thus stands still where the shot meets the flight. A pure function of the film time: the preview and the export
 * light the same frames.
 */
export function shotSunShiftMs(clock: Pick<FilmClock, 'stateAt' | 'opening' | 'closing'>, timeS: number): number {
  const away = shotSunAway(clock, timeS, 'accelere')
  return away === null ? 0 : (away.opening ? -away.weight : away.weight) * SHOT_SUN_HOURS * HOUR_MS
}

/** Solar hour of « Plein jour »: the region view is lit whatever the time of the outing. */
export const SHOT_DAYLIGHT_HOUR = 13

/**
 * Sun date at film time `timeS`: `flightDate` (the sun of the flight) outside a 'situation' shot and with « Heure du
 * survol »; « Accéléré », the time lapse of `shotSunShiftMs`; « Plein jour », from `daylight` at the region view to
 * `flightDate` where the shot meets the flight, with the same easing (no jump, the sun stands still at the joint).
 */
export function shotSunDate(clock: Pick<FilmClock, 'stateAt' | 'opening' | 'closing'>, timeS: number, flightDate: Date, daylight: Date): Date {
  const away = shotSunAway(clock, timeS, 'jour')
  if (away !== null) return new Date(flightDate.getTime() + away.weight * (daylight.getTime() - flightDate.getTime()))
  return new Date(flightDate.getTime() + shotSunShiftMs(clock, timeS))
}

/** Share (1 at the region view, 0 where the shot meets the flight) of a 'situation' shot lit in `mode`, else null. */
function shotSunAway(clock: Pick<FilmClock, 'stateAt' | 'opening' | 'closing'>, timeS: number, mode: 'jour' | 'accelere'): { weight: number; opening: boolean } | null {
  const state = clock.stateAt(timeS)
  if (state.phase !== 'opening' && state.phase !== 'closing') return null
  const opening = state.phase === 'opening'
  const shot = opening ? clock.opening : clock.closing
  if (shot.style !== 'situation' || shotSunOf(shot) !== mode || !(state.lengthS > 0)) return null
  const u = Math.min(1, Math.max(0, state.localS / state.lengthS))
  return { weight: opening ? (1 - u) ** 2 : u ** 2, opening }
}

/** Local mean solar time (hours) at `lon` of `date`, counted from the UTC day containing `dayMs` (inverse of `solarHourToDate`). */
export function solarHourOf(dayMs: number, lon: number, date: Date): number {
  const dayStart = Math.floor(dayMs / DAY_MS) * DAY_MS
  return (date.getTime() - dayStart) / HOUR_MS + lon / 15
}

export interface SunTimes {
  /** null when the sun stays above (polar day) or below (polar night) the horizon all day */
  sunrise: Date | null
  sunset: Date | null
  /** highest sun of the day */
  solarNoon: Date
  /** 'day': the sun never sets, 'night': it never rises, null otherwise */
  polar: 'day' | 'night' | null
}

/** radians per degree */
const DEG = Math.PI / 180
/** zenith of the sun's centre at sunrise / sunset: 90° + refraction (34′) + half the solar disc (16′) */
const SUNRISE_ZENITH = 90.833

/**
 * Sunrise, sunset and solar noon at (`lat`, `lon`) in degrees on the UTC day containing `date` (NOAA solar
 * equations, about one minute of error away from the poles; refraction included).
 */
export function sunTimes(lat: number, lon: number, date: Date): SunTimes {
  const dayStart = Math.floor(date.getTime() / DAY_MS) * DAY_MS
  // the sun is evaluated near the local noon of that day
  const noonGuess = dayStart + (12 - lon / 15) * HOUR_MS
  const jc = (noonGuess / DAY_MS + 2440587.5 - 2451545) / 36525
  const l0 = (((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360) + 360) % 360
  const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc)
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc)
  const c =
    Math.sin(m * DEG) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * m * DEG) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * m * DEG) * 0.000289
  const omega = 125.04 - 1934.136 * jc
  const apparentLong = l0 + c - 0.00569 - 0.00478 * Math.sin(omega * DEG)
  const meanObliquity = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * DEG)
  const declination = Math.asin(Math.sin(obliquity * DEG) * Math.sin(apparentLong * DEG))
  const y = Math.tan((obliquity / 2) * DEG) ** 2
  // equation of time, minutes
  const eqTime =
    (4 / DEG) *
    (y * Math.sin(2 * l0 * DEG) -
      2 * e * Math.sin(m * DEG) +
      4 * e * y * Math.sin(m * DEG) * Math.cos(2 * l0 * DEG) -
      0.5 * y * y * Math.sin(4 * l0 * DEG) -
      1.25 * e * e * Math.sin(2 * m * DEG))
  const noonMs = dayStart + (720 - 4 * lon - eqTime) * 60_000
  const solarNoon = new Date(noonMs)
  const latRad = lat * DEG
  const cosHourAngle =
    Math.cos(SUNRISE_ZENITH * DEG) / (Math.cos(latRad) * Math.cos(declination)) - Math.tan(latRad) * Math.tan(declination)
  if (!(cosHourAngle <= 1)) return { sunrise: null, sunset: null, solarNoon, polar: 'night' }
  if (cosHourAngle < -1) return { sunrise: null, sunset: null, solarNoon, polar: 'day' }
  // hour angle in degrees: 4 minutes of time per degree
  const halfDayMs = (Math.acos(cosHourAngle) / DEG) * 4 * 60_000
  return { sunrise: new Date(noonMs - halfDayMs), sunset: new Date(noonMs + halfDayMs), solarNoon, polar: null }
}

/** The day's sun events in local mean solar hours (the unit of `settings.sunHour`), see `solarHourOf`. */
export interface SolarDay {
  sunrise: number | null
  sunset: number | null
  noon: number
  polar: SunTimes['polar']
}

export function solarDay(lat: number, lon: number, dayMs: number): SolarDay {
  const times = sunTimes(lat, lon, new Date(dayMs))
  const hour = (d: Date | null) => (d ? solarHourOf(dayMs, lon, d) : null)
  return { sunrise: hour(times.sunrise), sunset: hour(times.sunset), noon: solarHourOf(dayMs, lon, times.solarNoon), polar: times.polar }
}

/** Clock hour (0–24) of a local mean solar hour at `lon`, for a local clock `utcOffsetMin` minutes ahead of UTC. */
export function clockHourOfSolar(solarHour: number, lon: number, utcOffsetMin: number): number {
  const hour = solarHour - lon / 15 + utcOffsetMin / 60
  return ((hour % 24) + 24) % 24
}

/** Quick choices of the fixed solar hour (« Lumière » section). */
export const SUN_CHIPS = ['lever', 'matin', 'midi', 'heure-doree', 'coucher', 'nuit'] as const
export type SunChip = (typeof SUN_CHIPS)[number]

export const SUN_CHIP_LABELS: Readonly<Record<SunChip, string>> = {
  lever: 'Lever',
  matin: 'Matin',
  midi: 'Midi',
  'heure-doree': 'Heure dorée',
  coucher: 'Coucher',
  nuit: 'Nuit',
}

/** Range and step of the solar hour slider (also the hours given by the chips). */
export const SUN_HOUR_RANGE = { min: 0, max: 23.75, step: 0.25 } as const

const quarter = (h: number, round: (x: number) => number = Math.round) =>
  Math.min(SUN_HOUR_RANGE.max, Math.max(SUN_HOUR_RANGE.min, round(h * 4) / 4))

/**
 * Solar hour of a chip on `day`, on the slider's quarter-hour steps; null when the moment does not exist that day
 * (no sunrise in a polar day or night, no night in a polar day). Lever: first quarter after sunrise; Coucher: last
 * quarter before sunset; Heure dorée: one hour before sunset; Matin: halfway between sunrise and noon; Nuit: solar
 * midnight.
 */
export function sunChipHour(chip: SunChip, day: SolarDay): number | null {
  const { sunrise, sunset, noon } = day
  switch (chip) {
    case 'lever':
      return sunrise === null ? null : quarter(sunrise, Math.ceil)
    case 'coucher':
      return sunset === null ? null : quarter(sunset, Math.floor)
    case 'heure-doree':
      return sunset === null ? null : quarter(sunset - 1)
    case 'matin':
      if (day.polar === 'night') return null
      return quarter(sunrise === null ? 9 : (sunrise + noon) / 2)
    case 'midi':
      return quarter(noon)
    case 'nuit':
      return day.polar === 'day' ? null : 0
  }
}

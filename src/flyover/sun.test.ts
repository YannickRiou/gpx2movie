import { describe, expect, it } from 'vitest'
import { buildFilmClock } from '../film/clock'
import type { FilmShot } from '../film/model'
import { buildTrack } from '../import/stats'
import { DEFAULT_PACING } from './pacing'
import { buildTrackPath } from './path'
import {
  SHOT_SUN_HOURS,
  SUN_CHIPS,
  clockHourOfSolar,
  isSunDate,
  shotSunShiftMs,
  solarDay,
  solarHourOf,
  solarHourToDate,
  sunChipHour,
  sunDateAt,
  sunDayMs,
  sunTimes,
} from './sun'
import type { SolarDay } from './sun'

describe('solarHourToDate', () => {
  const day = Date.UTC(2026, 6, 14, 17, 42) // any time of the day

  it('is the UTC hour on the Greenwich meridian', () => {
    expect(solarHourToDate(day, 0, 10.5).toISOString()).toBe('2026-07-14T10:30:00.000Z')
  })

  it('shifts by 4 minutes per degree of longitude', () => {
    // Chamonix ~6.87° E: solar noon ~27.5 min before 12:00 UTC
    expect(solarHourToDate(day, 6.87, 12).getTime()).toBe(Date.UTC(2026, 6, 14, 12) - 6.87 * 4 * 60_000)
    expect(solarHourToDate(day, -90, 12).toISOString()).toBe('2026-07-14T18:00:00.000Z')
  })
})

describe('sunDateAt', () => {
  const T0 = Date.UTC(2026, 6, 14, 3, 45) // dawn in the Alps
  const HOUR = 3_600_000
  const timed = buildTrackPath(
    buildTrack({
      name: 'aube',
      source: 'gpx',
      segments: [
        {
          points: [
            { lon: 6.8, lat: 45.9, time: T0 },
            { lon: 6.81, lat: 45.9, time: T0 + HOUR },
          ],
        },
      ],
    }),
  )
  const untimed = buildTrackPath(
    buildTrack({
      name: 'sans heure',
      source: 'gpx',
      segments: [{ points: [{ lon: 6.8, lat: 45.9 }, { lon: 6.81, lat: 45.9 }] }],
    }),
  )
  const opts = { sunFromTrack: true, solarHour: 10, lon: 0, dayMs: T0 }
  const fixed = solarHourToDate(T0, 0, 10).getTime()

  it('follows the recorded time along the track', () => {
    expect(sunDateAt(timed, 0, opts).getTime()).toBe(T0)
    expect(sunDateAt(timed, 0.5, opts).getTime()).toBeCloseTo(T0 + HOUR / 2, 3)
    expect(sunDateAt(timed, 1, opts).getTime()).toBe(T0 + HOUR)
  })

  it('uses the fixed solar hour when disabled, without time or without track', () => {
    expect(sunDateAt(timed, 0.5, { ...opts, sunFromTrack: false }).getTime()).toBe(fixed)
    expect(sunDateAt(untimed, 0.5, opts).getTime()).toBe(fixed)
    expect(sunDateAt(null, 0.5, opts).getTime()).toBe(fixed)
  })
})

describe('sunTimes', () => {
  const MIN = 60_000
  /** |a − b| in minutes */
  const minutesApart = (a: Date | null, iso: string) => Math.abs((a?.getTime() ?? Number.NaN) - Date.parse(iso)) / MIN

  it('matches published sunrise, noon and sunset times (within 2 min)', () => {
    // Paris, summer solstice: 05:47 / 13:52 / 21:58 CEST
    const paris = sunTimes(48.8566, 2.3522, new Date(Date.UTC(2024, 5, 21, 15)))
    expect(minutesApart(paris.sunrise, '2024-06-21T03:47Z')).toBeLessThan(2)
    expect(minutesApart(paris.solarNoon, '2024-06-21T11:52Z')).toBeLessThan(2)
    expect(minutesApart(paris.sunset, '2024-06-21T19:58Z')).toBeLessThan(2)
    expect(paris.polar).toBeNull()
    // New York, winter solstice: 07:16 / 16:32 EST
    const ny = sunTimes(40.7128, -74.006, new Date(Date.UTC(2024, 11, 21, 3)))
    expect(minutesApart(ny.sunrise, '2024-12-21T12:16Z')).toBeLessThan(2)
    expect(minutesApart(ny.sunset, '2024-12-21T21:32Z')).toBeLessThan(2)
    // Sydney, southern summer: 05:41 / 20:05 AEDT (sunrise on the previous UTC day)
    const sydney = sunTimes(-33.8688, 151.2093, new Date(Date.UTC(2024, 11, 21)))
    expect(minutesApart(sydney.sunrise, '2024-12-20T18:41Z')).toBeLessThan(2)
    expect(minutesApart(sydney.sunset, '2024-12-21T09:05Z')).toBeLessThan(2)
  })

  it('follows the equation of time: Greenwich solar noon about 16 min early in early November', () => {
    const greenwich = sunTimes(51.4769, 0, new Date(Date.UTC(2024, 10, 3)))
    expect(minutesApart(greenwich.solarNoon, '2024-11-03T11:43:35Z')).toBeLessThan(1)
  })

  it('handles the polar day and night', () => {
    const june = sunTimes(69.6492, 18.9553, new Date(Date.UTC(2024, 5, 21)))
    expect(june).toMatchObject({ sunrise: null, sunset: null, polar: 'day' })
    const december = sunTimes(69.6492, 18.9553, new Date(Date.UTC(2024, 11, 21)))
    expect(december).toMatchObject({ sunrise: null, sunset: null, polar: 'night' })
    expect(december.solarNoon.getUTCHours()).toBe(10)
  })
})

describe('clockHourOfSolar', () => {
  it('turns a solar hour into the clock hour of a UTC offset, within the day', () => {
    // Chamonix in summer (UTC+2): the clock is 1 h 32 min ahead of mean solar time
    expect(clockHourOfSolar(4.5, 6.87, 120)).toBeCloseTo(4.5 + 2 - 6.87 / 15, 9)
    expect(clockHourOfSolar(23.5, 0, 60)).toBeCloseTo(0.5, 9)
    expect(clockHourOfSolar(0.5, -120, -480)).toBeCloseTo(0.5, 9) // Pacific time, clock = solar at 120° W
    expect(clockHourOfSolar(1, 30, 0)).toBeCloseTo(23, 9)
  })
})

describe('solarHourOf', () => {
  it('inverts solarHourToDate', () => {
    const day = Date.UTC(2026, 6, 14, 17)
    for (const lon of [-120, 0, 6.87, 151.2]) {
      expect(solarHourOf(day, lon, solarHourToDate(day, lon, 7.25))).toBeCloseTo(7.25, 9)
    }
  })

  it('gives sun events near the local clock of the sun whatever the longitude', () => {
    const chamonix = solarDay(45.92, 6.87, Date.UTC(2026, 6, 14, 5))
    expect(chamonix.noon).toBeCloseTo(12.1, 1) // equation of time −6 min in mid-July
    expect(chamonix.sunrise).toBeGreaterThan(4.2)
    expect(chamonix.sunrise).toBeLessThan(4.6)
    expect(chamonix.sunset).toBeGreaterThan(19.6)
    expect(chamonix.sunset).toBeLessThan(20)
  })
})

describe('sunChipHour', () => {
  const day: SolarDay = { sunrise: 4.39, sunset: 19.8, noon: 12.1, polar: null }

  it('maps each chip to a quarter hour of the day', () => {
    expect(Object.fromEntries(SUN_CHIPS.map((chip) => [chip, sunChipHour(chip, day)]))).toEqual({
      lever: 4.5, // first quarter after sunrise
      matin: 8.25, // halfway to noon
      midi: 12,
      'heure-doree': 18.75, // one hour before sunset
      coucher: 19.75, // last quarter before sunset
      nuit: 0,
    })
  })

  it('leaves out the moments that do not exist in a polar day or night', () => {
    const polarDay: SolarDay = { sunrise: null, sunset: null, noon: 11.8, polar: 'day' }
    expect(SUN_CHIPS.map((chip) => sunChipHour(chip, polarDay))).toEqual([null, 9, 11.75, null, null, null])
    const polarNight: SolarDay = { sunrise: null, sunset: null, noon: 11.8, polar: 'night' }
    expect(SUN_CHIPS.map((chip) => sunChipHour(chip, polarNight))).toEqual([null, null, 11.75, null, null, 0])
  })

  it('stays inside the slider range', () => {
    expect(sunChipHour('coucher', { sunrise: 0.1, sunset: 23.95, noon: 12, polar: null })).toBe(23.75)
  })
})

describe('sunDayMs / isSunDate', () => {
  it('takes the day chosen, else the track start, else today', () => {
    expect(sunDayMs('2024-12-21', 5, 7)).toBe(Date.UTC(2024, 11, 21))
    expect(sunDayMs('', 5, 7)).toBe(5)
    expect(sunDayMs('', undefined, 7)).toBe(7)
  })

  it('accepts an empty day or YYYY-MM-DD only', () => {
    expect(isSunDate('')).toBe(true)
    expect(isSunDate('2024-06-21')).toBe(true)
    expect(isSunDate('2024-13-40')).toBe(false)
    expect(isSunDate('21/06/2024')).toBe(false)
  })
})

describe('shotSunShiftMs', () => {
  const HOUR = 3_600_000
  const clockOf = (opening: FilmShot, closing: FilmShot) =>
    buildFilmClock({
      opening,
      closing,
      stops: [],
      cameraKeys: [],
      lengthM: 4_000,
      highlightsM: [],
      durationS: 60,
      pacing: { ...DEFAULT_PACING, keepDuration: false },
    })
  const moving = { style: 'situation', durationS: 8, moveSun: true } as const

  it('opening: from SHOT_SUN_HOURS before the flight, slowing down to it; closing: from it, speeding up', () => {
    const clock = clockOf(moving, { ...moving, durationS: 6 })
    expect(shotSunShiftMs(clock, 0)).toBe(-SHOT_SUN_HOURS * HOUR)
    expect(shotSunShiftMs(clock, 4)).toBeCloseTo(-SHOT_SUN_HOURS * HOUR * 0.25, 6)
    expect(shotSunShiftMs(clock, 8)).toBe(0)
    expect(shotSunShiftMs(clock, 30)).toBe(0)
    const closingS = clock.openingS + clock.flightS
    expect(shotSunShiftMs(clock, closingS)).toBe(0)
    expect(shotSunShiftMs(clock, closingS + 3)).toBeCloseTo(SHOT_SUN_HOURS * HOUR * 0.25, 6)
    expect(shotSunShiftMs(clock, clock.totalTime())).toBe(SHOT_SUN_HOURS * HOUR)
    // the sun stands still where the shot meets the flight: no jump in its speed
    const speed = (t: number) => (shotSunShiftMs(clock, t + 0.001) - shotSunShiftMs(clock, t - 0.001)) / 0.002
    expect(Math.abs(speed(8 - 0.002))).toBeLessThan((0.01 * SHOT_SUN_HOURS * HOUR) / 8)
  })

  it('none without the switch, outside a « Depuis la région » shot', () => {
    for (const shot of [{ style: 'situation', durationS: 8 }, { style: 'descente', durationS: 8, moveSun: true }] as const) {
      const clock = clockOf(shot, shot)
      for (const t of [0, 4, clock.totalTime()]) expect(shotSunShiftMs(clock, t)).toBe(0)
    }
  })
})

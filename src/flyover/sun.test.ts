import { describe, expect, it } from 'vitest'
import { buildTrack } from '../import/stats'
import { buildTrackPath } from './path'
import { solarHourToDate, sunDateAt } from './sun'

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

import { describe, expect, it } from 'vitest'
import type { StravaActivity } from './api'
import { stravaActivityType, stravaSportLabel, streamsToTrack } from './track'

const ACTIVITY: StravaActivity = {
  id: 42,
  name: ' Tour du lac ',
  sport_type: 'Hike',
  type: 'Hike',
  start_date: '2024-06-01T06:00:00Z',
  start_date_local: '2024-06-01T08:00:00Z',
  distance: 250,
  total_elevation_gain: 20,
  utc_offset: 7200,
}

const LATLNG: [number, number][] = [
  [45.9, 6.8],
  [45.901, 6.801],
  [45.902, 6.802],
]

describe('streamsToTrack', () => {
  it('builds a timed track with altitude, heart rate, cadence and power', () => {
    const track = streamsToTrack(ACTIVITY, {
      latlng: { data: LATLNG },
      time: { data: [0, 10, 20] },
      altitude: { data: [1000, 1005, 1010] },
      heartrate: { data: [120, 125, 130] },
      cadence: { data: [80, 82, 84] },
      watts: { data: [200, null, 220] },
    })
    expect(track.source).toBe('strava')
    expect(track.name).toBe('Tour du lac')
    expect(track.activityType).toBe('hiking')
    expect(track.utcOffsetMin).toBe(120)
    const points = track.segments[0].points
    expect(points[0]).toEqual({ lon: 6.8, lat: 45.9, ele: 1000, time: Date.parse('2024-06-01T06:00:00Z'), hr: 120, cad: 80, power: 200 })
    expect(points[1].power).toBeUndefined()
    expect(track.stats.startTime).toBe(Date.parse('2024-06-01T06:00:00Z'))
    expect(track.stats.durationS).toBe(20)
    expect(track.stats.maxEle).toBe(1010)
  })

  it('builds a track without altitude nor heart rate', () => {
    const track = streamsToTrack({ ...ACTIVITY, utc_offset: undefined }, { latlng: { data: LATLNG }, time: { data: [0, 10, 20] } })
    expect(track.segments[0].points[2]).toEqual({ lon: 6.802, lat: 45.902, time: Date.parse('2024-06-01T06:00:20Z') })
    expect(track.stats.maxEle).toBeUndefined()
    expect(track.utcOffsetMin).toBeUndefined()
  })

  it('names an unnamed activity and refuses one without GPS positions', () => {
    expect(streamsToTrack({ ...ACTIVITY, name: '' }, { latlng: { data: LATLNG } }).name).toBe('Activité Strava')
    expect(() => streamsToTrack(ACTIVITY, { time: { data: [0, 1] } })).toThrow('aucune position GPS dans cette activité')
  })
})

describe('activity types', () => {
  it('maps the Strava sport types to the app activities, else to snake case', () => {
    expect(stravaActivityType('Ride')).toBe('cycling')
    expect(stravaActivityType('MountainBikeRide')).toBe('cycling')
    expect(stravaActivityType('TrailRun')).toBe('trail_running')
    expect(stravaActivityType('NordicSki')).toBe('cross_country_skiing')
    expect(stravaActivityType('RockClimbing')).toBe('rock_climbing')
    expect(stravaActivityType('')).toBeUndefined()
  })

  it('labels the sport type in French, from the older `type` when `sport_type` is missing', () => {
    expect(stravaSportLabel({ sport_type: 'GravelRide', type: 'Ride' })).toBe('Gravel')
    expect(stravaSportLabel({ type: 'Walk' })).toBe('Marche')
    expect(stravaSportLabel({ sport_type: 'Kitesurf' })).toBe('Kitesurf')
  })
})

import { describe, expect, it } from 'vitest'
import type { Track, TrackPoint } from '../core/types'
import { buildTrack } from '../import/stats'
import type { OsmFeature } from '../osm/overpass'
import {
  buildRoadbook,
  formatPlaceClock,
  longestSteepText,
  passageText,
  roadbookLandmarks,
  roadbookSummary,
  roadbookText,
  steepSections,
} from './roadbook'

/** Metres per degree of latitude on the haversine sphere (R = 6371008.8 m). */
const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180
const LAT0 = 45.8
const LON0 = 6.8

/** Point `d` metres north of the start, `eastM` metres east of the track. */
function at(d: number, eastM = 0): { lon: number; lat: number } {
  const lat = LAT0 + d / M_PER_DEG_LAT
  return { lon: LON0 + eastM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180)), lat }
}

/** Piecewise-linear profile from [distance, elevation] knots. */
function piecewise(knots: [number, number][]): (d: number) => number {
  return (d) => {
    for (let i = 1; i < knots.length; i++) {
      const [d0, e0] = knots[i - 1]
      const [d1, e1] = knots[i]
      if (d <= d1) return e0 + ((e1 - e0) * (d - d0)) / (d1 - d0)
    }
    return knots[knots.length - 1][1]
  }
}

/**
 * Track heading north with one point every 10 m; `ele(d)` gives the elevation (undefined: none), `timeAt(d)` the time
 * (ms since epoch) when given.
 */
function profileTrack(lengthM: number, ele: (d: number) => number | undefined, timeAt?: (d: number) => number): Track {
  const points: TrackPoint[] = []
  for (let d = 0; d <= lengthM; d += 10) {
    const p: TrackPoint = at(d)
    const e = ele(d)
    if (e !== undefined) p.ele = e
    if (timeAt) p.time = timeAt(d)
    points.push(p)
  }
  return buildTrack({ name: 'test', source: 'gpx', segments: [{ points }] })
}

describe('steepSections', () => {
  it('reports the slopes from 15 % (« très raide » from 25 %), uphill and downhill, from 100 m', () => {
    const track = profileTrack(
      3000,
      piecewise([
        [0, 1000],
        [500, 1000],
        [800, 1060], // 300 m at 20 % up
        [1300, 1060],
        [1600, 970], // 300 m at 30 % down
        [2000, 970],
        [2080, 986], // 80 m at 20 %: too short
        [2400, 986],
        [2900, 1046], // 500 m at 12 %: not steep
        [3000, 1046],
      ]),
    )
    const sections = steepSections(track)
    expect(sections.map((s) => [s.direction, s.verySteep])).toEqual([
      ['up', false],
      ['down', true],
    ])
    const [up, down] = sections
    // the ±50 m slope window shortens the stretch a little at each end
    expect(up.startM).toBeGreaterThanOrEqual(500)
    expect(up.endM).toBeLessThanOrEqual(800)
    expect(up.lengthM).toBeGreaterThan(200)
    expect(up.avgPercent).toBeCloseTo(20, 0)
    expect(up.maxPercent).toBeCloseTo(20, 0)
    expect(down.avgPercent).toBeGreaterThan(25)
    expect(down.maxPercent).toBeCloseTo(30, 0)
  })

  it('merges two runs of the same direction less than 50 m apart, not farther or of opposite directions', () => {
    const ramp = (d: number) => 1000 + 0.3 * d
    // points without elevation have no slope: a hole of 30 m (40 m between steep points) is bridged, 100 m is not
    const holed = (from: number, to: number) => (d: number) => (d > from && d < to ? undefined : ramp(d))
    expect(steepSections(profileTrack(1000, holed(500, 540)))).toHaveLength(1)
    expect(steepSections(profileTrack(1000, holed(500, 610)))).toHaveLength(2)
    const upDown = profileTrack(1000, piecewise([[0, 1000], [500, 1150], [1000, 1000]]))
    expect(steepSections(upDown).map((s) => s.direction)).toEqual(['up', 'down'])
  })

  it('is empty without elevation', () => {
    expect(steepSections(profileTrack(1000, () => undefined))).toEqual([])
  })
})

/** Flat 1 km, 2 km at 8 % up (a climb), 2 km at 8 % down (157 m of D+ / D− after the smoothing of the stats). */
const climbProfile = piecewise([
  [0, 1000],
  [1000, 1000],
  [3000, 1160],
  [5000, 1000],
])

function feature(kind: OsmFeature['kind'], name: string, d: number, eastM: number): OsmFeature {
  return { id: `node/${name}`, kind, name, ...at(d, eastM) }
}

describe('roadbookLandmarks', () => {
  it('keeps passes, summits, huts and water within 200 m of the track', () => {
    const track = profileTrack(5000, climbProfile)
    const features = [
      feature('pass', 'Col du Test', 3000, 0),
      feature('hut', 'Refuge proche', 500, 150),
      feature('peak', 'Sommet lointain', 2000, 500),
      feature('waterPoint', 'Source', 4000, 20),
      feature('lake', 'Lac', 1500, 10),
    ]
    expect(roadbookLandmarks(features, track).map((l) => l.name)).toEqual(['Refuge proche', 'Col du Test', 'Source'])
  })

  it('skips the landmarks hidden one by one', () => {
    const track = profileTrack(5000, climbProfile)
    const features = [feature('pass', 'Col du Test', 3000, 0), feature('hut', 'Refuge proche', 500, 150)]
    expect(roadbookLandmarks(features, track, ['node/Col du Test']).map((l) => l.name)).toEqual(['Refuge proche'])
  })
})

describe('buildRoadbook', () => {
  const pois = [{ id: 'poi-1', ...at(4500, 30), name: 'Pique-nique' }]

  it('orders the key points along the track, a climb top being the pass at the same place', () => {
    const track = profileTrack(5000, climbProfile)
    const landmarks = roadbookLandmarks(
      [feature('pass', 'Col du Test', 3020, 0), feature('hut', 'Refuge proche', 500, 150)],
      track,
    )
    const roadbook = buildRoadbook(track, landmarks, pois)
    expect(roadbook.rows.map((r) => r.name)).toEqual(['Départ', 'Refuge proche', 'Col du Test', 'Pique-nique', 'Arrivée'])
    expect(roadbook.rows[1].detail).toBe('Refuge · à 150 m de la trace')
    expect(roadbook.rows[2].detail).toBe('Col · sommet de la montée 1')
    expect(roadbook.rows[2].eleM).toBeCloseTo(1158, -1)
    expect(roadbook.rows[2].ascentM).toBeCloseTo(160, -1)
    expect(roadbook.rows[4].ascentM).toBe(track.stats.ascentM)
    expect(roadbook.steep).toEqual([])

    // without the pass, the climb top has its own row
    const alone = buildRoadbook(track, [], [])
    expect(alone.rows.map((r) => r.name)).toEqual(['Départ', 'Sommet de la montée 1', 'Arrivée'])
    expect(alone.rows[1].detail).toMatch(/^cat\. \d · \d,\d km à \d,\d %$/)
  })

  it('lists the start of the steep sections', () => {
    const track = profileTrack(2200, piecewise([[0, 1000], [1000, 1000], [1600, 1156], [2200, 1156]])) // 600 m at 26 %
    const roadbook = buildRoadbook(track, [], [])
    expect(roadbook.rows.map((r) => r.name)).toEqual(['Départ', 'Montée très raide', 'Sommet de la montée 1', 'Arrivée'])
    expect(roadbook.rows[1].detail).toMatch(/^\d+ m à 26 % \(max 26 %\)$/)
    expect(longestSteepText(roadbook)).toMatch(/^Plus longue pente raide : montée de \d+ m à 26 % \(max 26 %\), au km 1,0$/)
  })

  it('gives the time of passage and the time since the previous row when the track has times', () => {
    const start = Date.UTC(2026, 6, 1, 6, 0) // 8 h 00 at UTC+2
    const timed = profileTrack(5000, climbProfile, (d) => start + d * 600) // 10 min per km
    timed.utcOffsetMin = 120
    const roadbook = buildRoadbook(timed, [], pois)
    expect(roadbook.rows.map((r) => passageText(roadbook, r))).toEqual(['8 h 00', '8 h 30', '8 h 45', '8 h 50'])
    const since = roadbook.rows.map((r) => r.sincePreviousS)
    expect(since[0]).toBeUndefined()
    since.slice(1).forEach((s, i) => expect(s).toBeCloseTo([1800, 900, 300][i], 3))
    expect(roadbook.durationS).toBeCloseTo(3000, 3)
    expect(roadbookSummary(roadbook)).toBe('5,0 km · D+ 157 m · D− 157 m · 50 min')

    timed.timesEstimated = true
    const estimated = buildRoadbook(timed, [], pois)
    expect(passageText(estimated, estimated.rows[1])).toBe('≈ 8 h 30')
    expect(roadbookSummary(estimated)).toBe('5,0 km · D+ 157 m · D− 157 m · ≈ 50 min')
    const text = roadbookText(estimated, 'Tour test')
    expect(text).toContain('Heures estimées.')
    expect(text).toContain("km 4,5 · Pique-nique (Point d'intérêt) · ")
    expect(text).toMatch(/km 4,5 · .* · ≈ 8 h 45 \(\+15 min\)\n/)
  })

  it('has no time without recorded or estimated times', () => {
    const roadbook = buildRoadbook(profileTrack(5000, climbProfile), [], [])
    expect(roadbook.rows.every((r) => r.timeMs === undefined && r.sincePreviousS === undefined)).toBe(true)
    expect(roadbook.durationS).toBeUndefined()
    expect(roadbookSummary(roadbook)).toBe('5,0 km · D+ 157 m · D− 157 m')
    const text = roadbookText(roadbook, 'Tour test')
    expect(text.split('\n').slice(0, 2)).toEqual(['Feuille de route : Tour test', '5,0 km · D+ 157 m · D− 157 m'])
    expect(text).not.toMatch(/ h \d\d/)
  })
})

describe('formatPlaceClock', () => {
  it('shows the local clock of the place when its offset is known', () => {
    expect(formatPlaceClock(Date.UTC(2026, 0, 1, 23, 5), 60)).toBe('0 h 05')
    expect(formatPlaceClock(Date.UTC(2026, 0, 1, 7, 30), -300)).toBe('2 h 30')
  })
})

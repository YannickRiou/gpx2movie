// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import sampleGpx from '../../public/samples/tour-du-mont-blanc-j1.gpx?raw'
import type { TrackPoint } from '../core/types'
import { parseGpx } from '../import/gpx'
import { buildTrack } from '../import/stats'
import { buildTrackPath } from '../flyover/path'
import { OSM_ATTRIBUTION } from '../osm/overpass'
import { getImagerySource, getTerrainSource } from '../terrain/sources'
import { OPEN_METEO_ATTRIBUTION } from '../weather/openMeteo'
import type { Racer } from '../flyover/race'
import { buildSequence } from '../flyover/sequence'
import {
  cumulativeAscent,
  leaderboardRows,
  miniMapOutline,
  overlayCredits,
  overlayFilmFrameAt,
  overlayFrameAt,
  prepareOverlayFilm,
  prepareOverlayTrack,
  STAGE_CARD_S,
  stageCardAt,
} from './data'

/** metres per degree of latitude on the haversine sphere */
const M_PER_DEG = (6371008.8 * Math.PI) / 180
const T0 = Date.UTC(2025, 6, 12, 7)

/** Points due north every 10 m, one every 5 s (7.2 km/h), elevation and extras from `extra`. */
function line(count: number, extra: (i: number) => Partial<TrackPoint>): TrackPoint[] {
  return Array.from({ length: count }, (_, i) => ({ lon: 6.8, lat: 45.9 + (i * 10) / M_PER_DEG, time: T0 + i * 5000, ...extra(i) }))
}

const sample = parseGpx(sampleGpx, 'tour-du-mont-blanc-j1.gpx')[0]

describe('cumulativeAscent', () => {
  it('rises monotonically to the D+ of the track statistics', () => {
    const ascent = cumulativeAscent(sample)
    expect(ascent[0]).toBe(0)
    for (let i = 1; i < ascent.length; i++) expect(ascent[i]).toBeGreaterThanOrEqual(ascent[i - 1])
    expect(ascent[ascent.length - 1]).toBeCloseTo(sample.stats.ascentM, 6)
  })

  it('ignores GPS jitter on flat ground', () => {
    const track = buildTrack({ name: 'plat', source: 'gpx', segments: [{ points: line(200, (i) => ({ ele: 1000 + (i % 2 ? 1.5 : -1.5) })) }] })
    expect(cumulativeAscent(track)[199]).toBe(0)
  })

  it('carries the total across segments and over points without elevation', () => {
    const climb = line(50, (i) => ({ ele: 1000 + i * 2 }))
    const gap = line(5, () => ({}))
    const track = buildTrack({ name: 's', source: 'gpx', segments: [{ points: climb }, { points: [...gap, ...climb] }] })
    const ascent = cumulativeAscent(track)
    const first = ascent[49]
    expect(first).toBeGreaterThan(80)
    expect(ascent[50]).toBe(first)
    expect(ascent[54]).toBe(first)
    expect(ascent[ascent.length - 1]).toBeCloseTo(track.stats.ascentM, 6)
  })
})

describe('overlayFrameAt', () => {
  const data = prepareOverlayTrack(sample)

  it('starts at zero', () => {
    const frame = overlayFrameAt(data, 0)
    expect(frame).toMatchObject({ progress: 0, distanceM: 0, ascentM: 0, elapsedS: 0 })
    expect(frame.ele).toBeCloseTo(sample.segments[0].points[0].ele!, 6)
    expect(frame.heartRate).toBeGreaterThan(40)
  })

  it('ends on the whole-track figures', () => {
    const frame = overlayFrameAt(data, 1)
    expect(frame.distanceM).toBeCloseTo(sample.stats.distanceM, 6)
    expect(frame.ascentM).toBeCloseTo(sample.stats.ascentM, 6)
    expect(frame.elapsedS).toBeCloseTo(sample.stats.durationS!, 6)
    expect(data.stats).toMatchObject({ maxEleM: sample.stats.maxEle, durationS: sample.stats.durationS })
    expect(data.stats.maxSpeedKmh).toBeGreaterThan(1)
    expect(data.stats.maxSpeedKmh).toBeLessThan(20)
  })

  it('clamps the progress and interpolates in between', () => {
    expect(overlayFrameAt(data, -1).distanceM).toBe(0)
    expect(overlayFrameAt(data, 2).progress).toBe(1)
    expect(overlayFrameAt(data, Number.NaN).progress).toBe(0)
    const mid = overlayFrameAt(data, 0.5)
    expect(mid.distanceM).toBeCloseTo(sample.stats.distanceM / 2, 6)
    expect(mid.ascentM).toBeGreaterThan(0)
    expect(mid.ascentM).toBeLessThan(sample.stats.ascentM)
    expect(mid.elapsedS).toBeGreaterThan(0)
    expect(mid.speedKmh).toBeGreaterThan(0)
  })

  it('leaves out what the track does not record', () => {
    const bare = buildTrack({ name: 'nu', source: 'gpx', segments: [{ points: line(20, () => ({ time: undefined })) }] })
    const frame = overlayFrameAt(prepareOverlayTrack(bare), 0.5)
    expect(frame.distanceM).toBeGreaterThan(0)
    expect(frame.ele).toBeUndefined()
    expect(frame.ascentM).toBeUndefined()
    expect(frame.elapsedS).toBeUndefined()
    expect(frame.speedKmh).toBeUndefined()
    expect(frame.heartRate).toBeUndefined()
    expect(prepareOverlayTrack(bare).profile).toBeUndefined()
  })

  it('reads the steady speed of a regular track', () => {
    const track = buildTrack({ name: 'r', source: 'gpx', segments: [{ points: line(100, (i) => ({ ele: 1000 + i })) }] })
    expect(overlayFrameAt(prepareOverlayTrack(track), 0.4).speedKmh).toBeCloseTo(7.2, 3)
  })
})

describe('mini-map outline', () => {
  const lat0 = 45.9
  const mPerDegLon = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180)
  // 2 km due east, then 1 km due north
  const east: TrackPoint[] = Array.from({ length: 101 }, (_, i) => ({ lon: 6.8 + (i * 20) / mPerDegLon, lat: lat0, ele: 1000 }))
  const north: TrackPoint[] = Array.from({ length: 100 }, (_, j) => ({ lon: east[100].lon, lat: lat0 + ((j + 1) * 10) / M_PER_DEG, ele: 1000 }))
  const ell = buildTrack({ name: 'L', source: 'gpx', segments: [{ points: [...east, ...north] }] })
  const data = prepareOverlayTrack(ell)

  it('keeps the aspect ratio of the ground, longer side 1, north up', () => {
    const outline = data.outline!
    expect(outline.width).toBeCloseTo(1, 9)
    expect(outline.height).toBeCloseTo(0.5, 3)
    // start in the south-west corner, end in the north-east one
    expect([outline.x[0], outline.y[0]]).toEqual([0, expect.closeTo(0.5, 3)])
    expect(outline.x[outline.x.length - 1]).toBeCloseTo(1, 9)
    expect(outline.y[outline.y.length - 1]).toBeCloseTo(0, 9)
  })

  it('places the marker at the progress', () => {
    expect(overlayFrameAt(data, 0).mapPoint).toEqual({ x: 0, y: expect.closeTo(0.5, 3) })
    const half = overlayFrameAt(data, 0.5).mapPoint!
    expect(half.x).toBeCloseTo(0.75, 2) // 1.5 km of 3 km: three quarters of the eastward leg
    expect(half.y).toBeCloseTo(0.5, 3)
    const end = overlayFrameAt(data, 1).mapPoint!
    expect(end.x).toBeCloseTo(1, 9)
    expect(end.y).toBeCloseTo(0, 9)
  })

  it('keeps at most the requested points, the first and the last', () => {
    const path = buildTrackPath(sample)
    const outline = miniMapOutline(path, 100)!
    expect(path.count).toBeGreaterThan(100)
    expect(outline.x.length).toBeLessThanOrEqual(100)
    expect(outline.dist[0]).toBe(0)
    expect(outline.dist[outline.dist.length - 1]).toBe(path.lengthM)
    for (let i = 1; i < outline.dist.length; i++) expect(outline.dist[i]).toBeGreaterThanOrEqual(outline.dist[i - 1])
    expect(Math.max(outline.width, outline.height)).toBeCloseTo(1, 9)
  })

  it('handles a track that does not move, and no track', () => {
    const still = buildTrack({ name: 'arrêt', source: 'gpx', segments: [{ points: [{ lon: 6.8, lat: 45.9 }, { lon: 6.8, lat: 45.9 }] }] })
    const frame = overlayFrameAt(prepareOverlayTrack(still), 0.5)
    expect(frame.track.outline).toMatchObject({ width: 0, height: 0 })
    expect(frame.mapPoint).toEqual({ x: 0, y: 0 })
    expect(miniMapOutline({ ...buildTrackPath(still), count: 0 })).toBeUndefined()
  })
})

describe('overlayCredits', () => {
  it('credits relief and imagery always, the weather and the landmarks once loaded, as the status bar', () => {
    const sources = { terrainSourceId: 'mapterhorn', imagerySourceId: 'opentopomap', weather: false, landmarks: false }
    expect(overlayCredits(sources)).toEqual([
      `Relief : ${getTerrainSource('mapterhorn').attribution}`,
      `Imagerie : ${getImagerySource('opentopomap').attribution}`,
    ])
    expect(overlayCredits({ ...sources, weather: true, landmarks: true }).slice(2)).toEqual([OPEN_METEO_ATTRIBUTION, `Repères : ${OSM_ATTRIBUTION}`])
    // unknown ids fall back to the default sources, like the scene
    expect(overlayCredits({ ...sources, imagerySourceId: 'nope' })[1]).toBe(`Imagerie : ${getImagerySource('nope').attribution}`)
  })
})

describe('leaderboardRows', () => {
  const base = { lon: 0, lat: 0, distanceM: 0, finished: false }
  const tracks = ['Lead', 'Bob', 'Chloé', 'Dan'].map((name, i) => ({ name, color: `#00000${i}` }))

  it('ranks the racers with their colour and their time gap to the first, not to the lead track', () => {
    const racers: Racer[] = [
      { ...base, index: 0, fraction: 0.5 },
      { ...base, index: 1, fraction: 0.4, gapMs: 90_000 },
      { ...base, index: 2, fraction: 0.6, gapMs: -60_000 },
    ]
    expect(leaderboardRows(racers, tracks)).toEqual([
      { rank: 1, name: 'Chloé', color: '#000002', gap: 'Tête' },
      { rank: 2, name: 'Lead', color: '#000000', gap: '+1 min 00' },
      { rank: 3, name: 'Bob', color: '#000001', gap: '+2 min 30' },
    ])
  })

  it('gives distance gaps when the race has no times', () => {
    const racers: Racer[] = [
      { ...base, index: 0, fraction: 0.5 },
      { ...base, index: 1, fraction: 0.5, gapM: -300 },
      { ...base, index: 2, fraction: 0.5, gapM: 1200 },
    ]
    expect(leaderboardRows(racers, tracks).map((r) => [r.name, r.gap])).toEqual([
      ['Chloé', 'Tête'],
      ['Lead', '−1,2 km'],
      ['Bob', '−1,5 km'],
    ])
  })

  it('shares the rank of racers at the same point with the same gap', () => {
    const racers: Racer[] = [
      { ...base, index: 0, fraction: 0.5 },
      { ...base, index: 1, fraction: 0.5, gapMs: 0 },
      { ...base, index: 2, fraction: 0.3, gapMs: 30_000 },
      { ...base, index: 3, fraction: 0.3, gapMs: 30_000 },
    ]
    expect(leaderboardRows(racers, tracks).map((r) => [r.rank, r.gap])).toEqual([
      [1, 'Tête'],
      [1, 'Tête'],
      [3, '+30 s'],
      [3, '+30 s'],
    ])
  })

  it('marks the first once it has finished and keeps the final gaps of the others', () => {
    const racers: Racer[] = [
      { ...base, index: 0, fraction: 1, finished: true },
      { ...base, index: 1, fraction: 1, finished: true, gapMs: -45_000 },
      { ...base, index: 2, fraction: 0.8, gapMs: 120_000 },
    ]
    expect(leaderboardRows(racers, tracks).map((r) => [r.name, r.gap])).toEqual([
      ['Bob', 'Arrivée'],
      ['Lead', '+45 s'],
      ['Chloé', '+2 min 45'],
    ])
  })

  it('is empty without racers', () => {
    expect(leaderboardRows([], tracks)).toEqual([])
  })
})

describe('« À la suite »', () => {
  const a = buildTrack({ name: 'J1', source: 'gpx', segments: [{ points: line(11, (i) => ({ ele: 1000 + i * 10, time: T0 + i * 60_000 })) }] })
  // J2: ~8 km farther east, untimed
  const b = buildTrack({ name: 'J2', source: 'gpx', segments: [{ points: line(21, (i) => ({ lon: 6.9, ele: 1100 + i * 10, time: undefined })) }] })
  const sequence = buildSequence([a, b])
  const film = prepareOverlayFilm(sequence.track, sequence)
  const cut = sequence.stages[1].from

  it('the figures of the stage under the marker, the name and totals of the whole for the cards', () => {
    const first = overlayFilmFrameAt(film, cut / 2)
    expect(first.distanceM).toBeCloseTo(sequence.stages[0].endM / 2, 6)
    expect(first.elapsedS).toBeCloseTo(300, 6)
    expect(first.track.name).toBe('J1 → J2')
    expect(first.track.stats.distanceM).toBeCloseTo(sequence.stages[1].endM, 6)
    const second = overlayFilmFrameAt(film, cut)
    expect(second.distanceM).toBe(0)
    expect(second.ele).toBeCloseTo(1100, 6)
    expect(second.elapsedS).toBeUndefined()
    // one track: as before
    const alone = prepareOverlayFilm(a, null)
    expect(overlayFilmFrameAt(alone, 0.5)).toEqual(overlayFrameAt(alone.whole, 0.5))
  })

  it('each stage its own weather series, the first one that of the first track', () => {
    const first = { time: [T0], stations: [] }
    const second = { time: [T0 + 86_400_000], stations: [] }
    const withWeather = prepareOverlayFilm(sequence.track, sequence, first, { [b.id]: { series: second } })
    expect(withWeather.stages?.map((s) => s.weatherSeries)).toEqual([first, second])
    expect(prepareOverlayFilm(sequence.track, sequence, first).stages?.[1].weatherSeries).toBeUndefined()
  })

  it('a card for each stage as it starts: the first with the flight, the others at their cut', () => {
    const time = (timeS: number) => ({ timeS, openingS: 6, flightS: 60, totalS: 70, cutsS: [30] })
    expect(stageCardAt(sequence, time(5))).toBeNull()
    expect(stageCardAt(sequence, time(6))).toMatchObject({ name: 'J1', index: 0, count: 2, startS: 6, durationS: STAGE_CARD_S, startTime: T0 })
    expect(stageCardAt(sequence, time(6 + STAGE_CARD_S))).toBeNull()
    const second = stageCardAt(sequence, time(31))
    expect(second).toMatchObject({ name: 'J2', index: 1, startS: 30, ascentM: b.stats.ascentM })
    expect(second?.distanceM).toBeCloseTo(sequence.stages[1].endM - sequence.stages[1].startM, 6)
    expect(second?.startTime).toBeUndefined()
  })
})

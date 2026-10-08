import { describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import { DEFAULT_PACING } from '../flyover/pacing'
import type { PacingSettings } from '../flyover/pacing'
import { buildTrack } from '../import/stats'
import type { Landmark } from '../osm/landmarks'
import {
  assembleFilm,
  autoStopId,
  autoStops,
  filmStops,
  freezeLandmarkTitles,
  LANDMARK_TITLE_S,
  MAX_LANDMARK_TITLES,
  materializeStops,
  pickLandmarkTitles,
  sameLandmarkTitles,
  stopCandidates,
  TITLE_LEAD_S,
  TITLE_SLOW,
  withLandmarkTitles,
  withoutLandmarkTitles,
} from './assemble'
import type { LandmarkTitleInput, PassingTimes } from './assemble'
import { filmClockFor } from './clock'
import { AUTO_STOP_S, DEFAULT_FILM, isValidFilm } from './model'
import type { Film } from './model'

const ON: PacingSettings = { ...DEFAULT_PACING, enabled: true }
const M_PER_DEG_LAT = (6371008.8 * Math.PI) / 180

/** 5 km heading north: flat, a 200 m climb from 1 km to 3 km, flat. */
function climbTrack(): Track {
  const points = []
  for (let d = 0; d <= 5000; d += 10) {
    const ele = d < 1000 ? 1000 : d < 3000 ? 1000 + ((d - 1000) / 2000) * 200 : 1200
    points.push({ lon: 6.8, lat: 45.8 + d / M_PER_DEG_LAT, ele })
  }
  return buildTrack({ name: 'test', source: 'gpx', segments: [{ points }] })
}

function landmark(kind: Landmark['kind'], name: string, alongM: number, distanceM: number): Landmark {
  return { id: `node/${alongM}`, kind, name, lon: 6.8, lat: 45.8, distanceM, alongM, priority: 10, text: name }
}

const track = climbTrack()
const landmarks = [
  landmark('pass', 'Col de Voza', 1500, 50),
  landmark('peak', 'Mont Lachat', 4500, 250),
  // too far from the track to be a highlight
  landmark('peak', 'Aiguille', 2000, 900),
]

describe('autoStops (rythme: films saved before the timeline)', () => {
  it('none with the default pacing (off) or without pause', () => {
    expect(autoStops({ track, landmarks, pacing: DEFAULT_PACING }, 'rythme')).toEqual([])
    expect(autoStops({ track, landmarks, pacing: { ...ON, pauseS: 0 } }, 'rythme')).toEqual([])
  })

  it('one held stop per highlight: climb top and landmarks, with label, source and a stable id', () => {
    const stops = autoStops({ track, landmarks, pacing: ON }, 'rythme')
    expect(stops).toHaveLength(3)
    const [pass, top, peak] = stops
    expect(pass).toEqual({
      id: autoStopId(1500),
      atM: 1500,
      durationS: ON.pauseS,
      camera: 'film',
      label: 'Col de Voza',
      source: { kind: 'landmark', ref: 'node/1500' },
    })
    expect(top.atM).toBeGreaterThan(2800)
    expect(top.atM).toBeLessThan(3100)
    expect(top.source).toEqual({ kind: 'climb', ref: '0' })
    expect(top.label).toMatch(/^Montée 1/)
    expect(peak.label).toBe('Mont Lachat')
    expect(autoStops({ track, landmarks, pacing: ON }, 'rythme')).toEqual(stops)
  })

  it('follow the highlight kinds and cluster close highlights like the pauses they replace', () => {
    expect(autoStops({ track, landmarks, pacing: { ...ON, landmarks: false } }, 'rythme').map((s) => s.source?.kind)).toEqual(['climb'])
    expect(autoStops({ track, landmarks, pacing: { ...ON, climbs: false } }, 'rythme').map((s) => s.label)).toEqual(['Col de Voza', 'Mont Lachat'])
    // window of 1.5 km: the pass and the climb top (~1.45 km apart) form one cluster, paused once
    expect(autoStops({ track, landmarks, pacing: { ...ON, windowM: 1500 } }, 'rythme')).toHaveLength(2)
  })
})

describe('autoStops (temps-forts: new films)', () => {
  it('a stop at every highlight whatever the pacing, orbiting, AUTO_STOP_S each', () => {
    const stops = autoStops({ track, landmarks, pacing: DEFAULT_PACING }, 'temps-forts')
    expect(stops.map((s) => s.label?.slice(0, 6))).toEqual(['Col de', 'Montée', 'Mont L'])
    expect(stops.every((s) => s.camera === 'orbite' && s.durationS === AUTO_STOP_S)).toBe(true)
    expect(stops.map((s) => s.atM)).toEqual(autoStops({ track, landmarks, pacing: ON }, 'rythme').map((s) => s.atM))
    expect(autoStops({ track, landmarks, pacing: { ...DEFAULT_PACING, climbs: false, landmarks: false } }, 'temps-forts')).toEqual([])
  })

  it('stopCandidates: every highlight by position, not clustered', () => {
    const candidates = stopCandidates({ track, landmarks, pacing: { ...DEFAULT_PACING, windowM: 5000 } })
    expect(candidates.map((c) => c.source.kind)).toEqual(['landmark', 'climb', 'landmark'])
    expect(autoStops({ track, landmarks, pacing: { ...DEFAULT_PACING, windowM: 5000 } }, 'temps-forts')).toHaveLength(1)
  })
})

describe('assembleFilm', () => {
  it('default shots, generated stops written out, valid', () => {
    const film = assembleFilm({ track, landmarks, pacing: ON })
    expect(film.opening).toEqual(DEFAULT_FILM.opening)
    expect(film.closing).toEqual(DEFAULT_FILM.closing)
    expect(film.autoStops).toBe(false)
    expect(film.stops).toEqual(autoStops({ track, landmarks, pacing: ON }, 'temps-forts'))
    expect(isValidFilm(film)).toBe(true)
  })

  it('materializeStops: writes the generated stops of the film mode, keeps the rest; own stops untouched', () => {
    const legacy: Film = { ...DEFAULT_FILM, autoMode: 'rythme', opening: { style: 'saut', durationS: 3 } }
    const written = materializeStops(legacy, { track, landmarks, pacing: ON })
    expect(written).toEqual({ ...legacy, autoStops: false, stops: autoStops({ track, landmarks, pacing: ON }, 'rythme') })
    expect(materializeStops(written, { track, landmarks, pacing: DEFAULT_PACING })).toBe(written)
  })

  it('filmStops: generated while autoStops is set, else the film own', () => {
    expect(filmStops(DEFAULT_FILM, { track, landmarks, pacing: ON })).toHaveLength(3)
    expect(filmStops({ ...DEFAULT_FILM, autoMode: 'rythme' }, { track, landmarks, pacing: DEFAULT_PACING })).toEqual([])
    const own = { ...DEFAULT_FILM, autoStops: false, stops: [{ id: 'stop-1', atM: 10, durationS: 1, camera: 'orbite' as const }] }
    expect(filmStops(own, { track, landmarks, pacing: ON })).toBe(own.stops)
  })
})

describe('pickLandmarkTitles', () => {
  const at = (kind: Landmark['kind'], alongM: number, distanceM: number, priority = 10): Landmark => ({
    ...landmark(kind, `${kind} ${alongM}`, alongM, distanceM),
    id: `${kind}/${alongM}`,
    priority,
  })
  /** 20 km flown at 100 m/s: 10 s between titles is 1 km */
  const base: LandmarkTitleInput = { landmarks: [], lengthM: 20_000, heldM: [], speeds: [], timeAtM: (m) => m / 100 }
  const names = (input: Partial<LandmarkTitleInput>) => pickLandmarkTitles({ ...base, ...input }).map((t) => t.landmark.name)

  it('passes and summits crossed or within 150 m, huts on the track, nothing else', () => {
    const landmarks = [at('pass', 1000, 100), at('pass', 3000, 200), at('peak', 5000, 140), at('hut', 7000, 80), at('hut', 9000, 120), at('lake', 11_000, 0)]
    expect(names({ landmarks })).toEqual(['pass 1000', 'peak 5000', 'hut 7000'])
  })

  it('the most important first, never two closer than the gap in film time, ordered along the track', () => {
    const landmarks = [at('hut', 1000, 0, 20), at('pass', 1500, 0, 45), at('peak', 2600, 0, 30)]
    expect(names({ landmarks })).toEqual(['pass 1500', 'peak 2600'])
  })

  it('one title per 3 km of track (at least one), never more than MAX_LANDMARK_TITLES', () => {
    const landmarks = Array.from({ length: 12 }, (_, i) => at('peak', 1000 + i * 1500, 0, 30 - i))
    expect(names({ landmarks, lengthM: 6000 })).toHaveLength(2)
    expect(names({ landmarks, lengthM: 1000 })).toHaveLength(1)
    expect(names({ landmarks })).toHaveLength(MAX_LANDMARK_TITLES)
  })

  it('a slow-down centred on each, kept on the track; none over a stop, a slowed highlight or a speed portion', () => {
    const landmarks = [at('pass', 100, 0), at('pass', 5000, 0), at('pass', 9000, 0), at('pass', 13_000, 0)]
    const titles = pickLandmarkTitles({ ...base, landmarks, heldM: [5150], speeds: [{ fromM: 8000, toM: 8900 }] })
    expect(titles.map((t) => t.slow)).toEqual([{ fromM: 0, toM: 300 }, undefined, undefined, { fromM: 12_800, toM: 13_200 }])
  })

  it('deterministic: the same titles whatever the order of the landmarks', () => {
    const landmarks = [at('pass', 4000, 0, 40), at('peak', 4000, 0, 40), at('hut', 9000, 0, 20), at('peak', 15_000, 0, 30)]
    const titles = pickLandmarkTitles({ ...base, landmarks })
    expect(pickLandmarkTitles({ ...base, landmarks: [...landmarks].reverse() })).toEqual(titles)
  })
})

describe('withLandmarkTitles', () => {
  const titled = [
    { ...landmark('pass', 'Col de Voza', 1500, 50), ele: 1653, priority: 45 },
    { ...landmark('hut', 'Refuge du Fioux', 3800, 40), priority: 22 },
    landmark('peak', 'Mont Lachat', 4500, 250),
  ]
  const input = { track, landmarks: titled, pacing: DEFAULT_PACING }
  const passingTimes: PassingTimes = (film) => {
    const clock = filmClockFor({ track, film, durationS: 60, pacing: DEFAULT_PACING, landmarks: titled })
    return (atM) => clock.timeAtProgress(atM / track.stats.distanceM)
  }
  const own: Film = {
    ...DEFAULT_FILM,
    speeds: [{ id: 'speed-1', fromM: 0, toM: 500, factor: 2 }],
    texts: [{ id: 'text-1', startS: 2, durationS: 4, text: 'Départ', anchor: 'bottom-center', size: 1 }],
  }

  it('a title at each landmark, a slow-down where the film does not already stop; own items kept, film valid', () => {
    const film = withLandmarkTitles(own, input, passingTimes)
    // the pass is a generated stop: its title only
    expect(film.speeds).toEqual([own.speeds[0], { id: 'auto-speed-node-3800', fromM: 3600, toM: 4000, factor: TITLE_SLOW.factor }])
    const [mine, pass, hut] = film.texts
    expect(mine).toBe(own.texts[0])
    expect(pass).toMatchObject({ id: 'auto-text-node-1500', text: 'Col de Voza', durationS: LANDMARK_TITLE_S, anchor: 'top-center' })
    expect(pass.subtitle).toMatch(/^1\D653 m$/)
    expect(hut.subtitle).toBeUndefined()
    // placed where the marker passes, slow-down included
    expect(hut.startS).toBeCloseTo(passingTimes(film)(3800) - TITLE_LEAD_S, 1)
    expect(isValidFilm(film)).toBe(true)
  })

  it('made again the same (no change to write), removed without touching the rest', () => {
    const film = withLandmarkTitles(own, input, passingTimes)
    expect(withLandmarkTitles(film, input, passingTimes)).toEqual(film)
    expect(sameLandmarkTitles(film, withLandmarkTitles(film, input, passingTimes))).toBe(true)
    expect(withoutLandmarkTitles(film)).toEqual(own)
    expect(withLandmarkTitles(film, { ...input, landmarks: [] }, passingTimes)).toEqual(own)
  })

  it('freezeLandmarkTitles: retouching or removing a title fixes them, other edits do not', () => {
    const film = withLandmarkTitles(own, input, passingTimes)
    const moved = { ...film, texts: film.texts.map((t) => (t.id === 'auto-text-node-1500' ? { ...t, startS: t.startS + 1 } : t)) }
    expect(freezeLandmarkTitles(film, moved)).toEqual({ ...moved, landmarkTitles: false })
    expect(freezeLandmarkTitles(film, withoutLandmarkTitles(film)).landmarkTitles).toBe(false)
    const ownEdit = { ...film, speeds: film.speeds.map((s) => (s.id === 'speed-1' ? { ...s, factor: 3 } : s)) }
    expect(freezeLandmarkTitles(film, ownEdit)).toBe(ownEdit)
    expect(freezeLandmarkTitles({ ...film, landmarkTitles: false }, moved)).toBe(moved)
  })
})

import { describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import { DEFAULT_PACING } from '../flyover/pacing'
import type { PacingSettings } from '../flyover/pacing'
import { buildTrack } from '../import/stats'
import type { Landmark } from '../osm/landmarks'
import { assembleFilm, autoStopId, autoStops, filmStops } from './assemble'
import { DEFAULT_FILM, isValidFilm } from './model'

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

describe('autoStops', () => {
  it('none with the default pacing (off) or without pause', () => {
    expect(autoStops({ track, landmarks, pacing: DEFAULT_PACING })).toEqual([])
    expect(autoStops({ track, landmarks, pacing: { ...ON, pauseS: 0 } })).toEqual([])
  })

  it('one held stop per highlight: climb top and landmarks, with label, source and a stable id', () => {
    const stops = autoStops({ track, landmarks, pacing: ON })
    expect(stops).toHaveLength(3)
    const [pass, top, peak] = stops
    expect(pass).toEqual({
      id: autoStopId(1500),
      atM: 1500,
      durationS: ON.pauseS,
      camera: 'fixe',
      label: 'Col de Voza',
      source: { kind: 'landmark', ref: 'node/1500' },
    })
    expect(top.atM).toBeGreaterThan(2800)
    expect(top.atM).toBeLessThan(3100)
    expect(top.source).toEqual({ kind: 'climb', ref: '0' })
    expect(top.label).toMatch(/^Montée 1/)
    expect(peak.label).toBe('Mont Lachat')
    expect(autoStops({ track, landmarks, pacing: ON })).toEqual(stops)
  })

  it('follow the highlight kinds and cluster close highlights like the pauses they replace', () => {
    expect(autoStops({ track, landmarks, pacing: { ...ON, landmarks: false } }).map((s) => s.source?.kind)).toEqual(['climb'])
    expect(autoStops({ track, landmarks, pacing: { ...ON, climbs: false } }).map((s) => s.label)).toEqual(['Col de Voza', 'Mont Lachat'])
    // window of 1.5 km: the pass and the climb top (~1.45 km apart) form one cluster, paused once
    expect(autoStops({ track, landmarks, pacing: { ...ON, windowM: 1500 } })).toHaveLength(2)
  })
})

describe('assembleFilm', () => {
  it('default shots, generated stops written out, valid', () => {
    const film = assembleFilm({ track, landmarks, pacing: ON })
    expect(film.opening).toEqual(DEFAULT_FILM.opening)
    expect(film.closing).toEqual(DEFAULT_FILM.closing)
    expect(film.autoStops).toBe(false)
    expect(film.stops).toEqual(autoStops({ track, landmarks, pacing: ON }))
    expect(isValidFilm(film)).toBe(true)
  })

  it('filmStops: generated while autoStops is set, else the film own', () => {
    expect(filmStops(DEFAULT_FILM, { track, landmarks, pacing: ON })).toHaveLength(3)
    const own = { ...DEFAULT_FILM, autoStops: false, stops: [{ id: 'stop-1', atM: 10, durationS: 1, camera: 'orbite' as const }] }
    expect(filmStops(own, { track, landmarks, pacing: ON })).toBe(own.stops)
  })
})

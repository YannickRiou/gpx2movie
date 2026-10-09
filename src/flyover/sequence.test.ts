import { describe, expect, it } from 'vitest'
import type { Track, TrackPoint } from '../core/types'
import { buildTrack } from '../import/stats'
import type { Landmark } from '../osm/landmarks'
import { filmFollowOf } from './follow'
import { trackPathOf } from './path'
import { DEFAULT_RACE, isValidRace } from './race'
import {
  buildSequence,
  filmSequenceOf,
  filmTrackOf,
  playsInSequence,
  sequenceLandmarks,
  sequenceOf,
  stageAt,
  trackUnderMarker,
} from './sequence'
import { sunDateAt } from './sun'

const DAY1 = Date.UTC(2026, 6, 1, 8)
const HOUR = 3600 * 1000

/** An eastward line of `n` points at `lat` (0.01° apart), timed from `startMs` (one point every 10 min) unless null. */
function track(name: string, lat: number, startMs: number | null, n = 3): Track {
  const points: TrackPoint[] = Array.from({ length: n }, (_, i) => ({
    lon: 6.8 + i * 0.01,
    lat,
    ele: 1000 + i * 50,
    ...(startMs === null ? {} : { time: startMs + i * 10 * 60 * 1000 }),
  }))
  return { ...buildTrack({ name, source: 'gpx', segments: [{ points }] }), color: `#00000${lat === 45 ? 1 : 2}` }
}

const SUITE = { ...DEFAULT_RACE, sequence: true }

describe('buildSequence', () => {
  const day1 = track('TMB J1', 45, DAY1)
  const day2 = track('TMB J2', 45.1, DAY1 + 24 * HOUR, 5)

  it('flies the tracks in list order, each one a stage', () => {
    const sequence = buildSequence([day2, day1])
    expect(sequence.stages.map((s) => s.track)).toEqual([day2, day1])
    const l2 = trackPathOf(day2).lengthM
    const l1 = trackPathOf(day1).lengthM
    expect(sequence.stages[0]).toMatchObject({ index: 0, startM: 0, endM: l2, from: 0 })
    expect(sequence.stages[1].startM).toBe(l2)
    expect(sequence.stages[1].to).toBe(1)
    expect(sequence.stages[1].from).toBeCloseTo(l2 / (l1 + l2), 12)
    expect(sequence.cutsM).toEqual([l2])
  })

  it('makes one track of their segments, the jump between them neither counted nor drawn', () => {
    const { track: whole } = buildSequence([day1, day2])
    expect(whole.id).toBe(`suite:${day1.id}+${day2.id}`)
    expect(whole.name).toBe('TMB')
    expect(whole.segments).toEqual([...day1.segments, ...day2.segments])
    expect(whole.stats.distanceM).toBeCloseTo(day1.stats.distanceM + day2.stats.distanceM, 6)
    expect(trackPathOf(whole).lengthM).toBeCloseTo(trackPathOf(day1).lengthM + trackPathOf(day2).lengthM, 6)
    expect(whole.color).toBe(day1.color)
  })

  it('keeps its identity while the tracks keep their points (a colour change does not rebuild it)', () => {
    const first = sequenceOf([day1, day2])
    expect(sequenceOf([day1, day2])).toBe(first)
    expect(sequenceOf([{ ...day1, color: '#123456' }, day2])).toBe(first)
    expect(sequenceOf([day2, day1])).not.toBe(first)
  })
})

describe('playsInSequence / filmTrackOf', () => {
  const a = track('A', 45, null)
  const b = track('B', 45.1, null)

  it('needs « À la suite », two tracks, and no ghost race', () => {
    expect(playsInSequence(SUITE, 2)).toBe(true)
    expect(playsInSequence(SUITE, 1)).toBe(false)
    expect(playsInSequence(DEFAULT_RACE, 2)).toBe(false)
    expect(playsInSequence({ ...SUITE, enabled: true }, 2)).toBe(false)
  })

  it('films the first track unless the tracks play « À la suite »', () => {
    expect(filmTrackOf([a, b], DEFAULT_RACE)).toBe(a)
    expect(filmTrackOf([a], SUITE)).toBe(a)
    expect(filmTrackOf([], SUITE)).toBeUndefined()
    expect(filmSequenceOf([a, b], DEFAULT_RACE)).toBeNull()
    expect(filmTrackOf([a, b], SUITE)).toBe(sequenceOf([a, b]).track)
  })
})

describe('stageAt', () => {
  const sequence = buildSequence([track('A', 45, null), track('B', 45.1, null, 5)])
  const cut = sequence.stages[1].from

  it('gives the stage under the marker and the progress along it', () => {
    expect(stageAt(sequence, 0)).toEqual({ stage: sequence.stages[0], progress: 0 })
    expect(stageAt(sequence, cut / 2).progress).toBeCloseTo(0.5, 12)
    expect(stageAt(sequence, cut - 1e-9).stage.index).toBe(0)
    expect(stageAt(sequence, cut)).toEqual({ stage: sequence.stages[1], progress: 0 })
    expect(stageAt(sequence, 1)).toEqual({ stage: sequence.stages[1], progress: 1 })
  })
})

describe('trackUnderMarker', () => {
  const day1 = track('J1', 45, DAY1)
  const day2 = track('J2', 45.1, DAY1 + 24 * HOUR, 5)
  const sun = { sunFromTrack: true, solarHour: 12, lon: 6.8, dayMs: DAY1 }

  it('is the first track at the film progress unless the tracks play « À la suite »', () => {
    expect(trackUnderMarker([day1, day2], DEFAULT_RACE, 0.7)).toEqual({ track: day1, progress: 0.7 })
    expect(trackUnderMarker([day1, day2], { ...SUITE, enabled: true }, 0.7)).toEqual({ track: day1, progress: 0.7 })
    expect(trackUnderMarker([day1], SUITE, 0.7)).toEqual({ track: day1, progress: 0.7 })
    expect(trackUnderMarker([], SUITE, 0.7)).toBeUndefined()
  })

  it('« À la suite », the stage under the marker as the store holds it, and its own sun time', () => {
    const recoloured = { ...day2, color: '#123456' }
    const tracks = [day1, recoloured]
    const cut = sequenceOf([day1, day2]).stages[1].from
    expect(trackUnderMarker(tracks, SUITE, cut / 2)?.track).toBe(day1)
    const second = trackUnderMarker(tracks, SUITE, cut)
    expect(second).toEqual({ track: recoloured, progress: 0 })
    // the sun follows each stage's own day, with a jump on the cut
    const sunAt = (progress: number) => {
      const at = trackUnderMarker(tracks, SUITE, progress)
      return at ? sunDateAt(trackPathOf(at.track), at.progress, sun).getTime() : NaN
    }
    expect(sunAt(cut - 1e-9)).toBeCloseTo(DAY1 + 20 * 60 * 1000, -1)
    expect(sunAt(cut)).toBe(DAY1 + 24 * HOUR)
    expect(sunAt(1)).toBe(DAY1 + 24 * HOUR + 40 * 60 * 1000)
  })
})

describe('sequenceLandmarks', () => {
  const a = track('A', 45, null)
  const b = track('B', 45.1, null)
  const sequence = buildSequence([a, b])
  const landmark = (id: string, alongM: number) => ({ id, alongM }) as Landmark

  it('places every stage’s landmarks along the sequence, a shared one once', () => {
    const byTrack = { [a.id]: [landmark('node/1', 100), landmark('node/2', 900)], [b.id]: [landmark('node/2', 0), landmark('node/3', 50)] }
    const out = sequenceLandmarks(sequence, byTrack)
    expect(out?.map((l) => [l.id, l.alongM])).toEqual([
      ['node/1', 100],
      ['node/2', 900],
      ['node/3', 50 + sequence.stages[1].startM],
    ])
    // same arrays: same result
    expect(sequenceLandmarks(sequence, { ...byTrack })).toBe(out)
    expect(sequenceLandmarks(sequence, {})).toBeUndefined()
  })
})

describe('race settings « Plusieurs traces »', () => {
  it('accepts the new optional fields and rejects unknown values', () => {
    expect(isValidRace(DEFAULT_RACE)).toBe(true)
    expect(isValidRace({ ...DEFAULT_RACE, sequence: true, stageCards: false, stageTransition: 'coupe', camera: 'ensemble' })).toBe(true)
    expect(isValidRace({ ...DEFAULT_RACE, camera: 'drone' as never })).toBe(false)
    expect(isValidRace({ ...DEFAULT_RACE, stageTransition: 'enchaine' as never })).toBe(false)
    expect(isValidRace({ ...DEFAULT_RACE, sequence: 'yes' as never })).toBe(false)
  })
})

describe('filmFollowOf', () => {
  const a = track('A', 45, DAY1)
  const b = track('B', 45.1, DAY1 + 24 * HOUR, 5)

  it('follows nothing for one track, the first track alone or a race filmed from the first track', () => {
    expect(filmFollowOf([a], SUITE, 0)).toBeNull()
    expect(filmFollowOf([a, b], DEFAULT_RACE, 0)).toBeNull()
    expect(filmFollowOf([a, b], { ...DEFAULT_RACE, enabled: true }, 0)).toBeNull()
  })

  it('« À la suite »: flies the stage under the marker on its own path', () => {
    const follow = filmFollowOf([a, b], SUITE, 0)!
    const cut = sequenceOf([a, b]).stages[1].from
    expect(follow(cut / 2)).toEqual({ path: trackPathOf(a), progress: expect.closeTo(0.5, 12) })
    expect(follow(cut)).toEqual({ path: trackPathOf(b), progress: 0 })
  })

  it('« En parallèle »: the racer ahead, or all of them framed together', () => {
    // untimed, same distance fraction: the longer track has covered more ground, it leads
    const [u, v] = [track('U', 45, null), track('V', 45.1, null, 5)]
    const race = { ...DEFAULT_RACE, enabled: true, sync: 'distance' as const }
    const ahead = filmFollowOf([u, v], { ...race, camera: 'tete' }, 0)!(0.5)!
    expect(ahead.markerOnFilm).toBe(true)
    expect(ahead.path).toBe(trackPathOf(v))
    expect(ahead.progress).toBeCloseTo(0.5, 12)
    // once it has finished, the first one still racing
    expect(filmFollowOf([v, u], { ...race, camera: 'tete' }, 0)!(1)!.path).toBe(trackPathOf(v))
    const all = filmFollowOf([u, v], { ...race, camera: 'ensemble' }, 0)!(0.5)!
    expect(all.path).toBe(trackPathOf(u))
    expect(all.group).toHaveLength(2)
  })
})

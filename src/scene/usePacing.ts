import { useMemo } from 'react'
import type { Track } from '../core/types'
import { freezeLandmarkTitles, materializeStops, sameLandmarkTitles, withLandmarkTitles, withoutLandmarkTitles } from '../film/assemble'
import type { PassingTimes } from '../film/assemble'
import { filmClockFor } from '../film/clock'
import type { FilmClock, FilmClockFor } from '../film/clock'
import type { Film } from '../film/model'
import { followStops } from '../film/timeline'
import { filmSequenceOf, filmTrackOf, sequenceLandmarks } from '../flyover/sequence'
import type { Sequence } from '../flyover/sequence'
import type { Landmark } from '../osm/landmarks'
import { useLandmarkStore } from '../osm/store'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'

/** The sequence « À la suite » the film flies, null otherwise (flyover/sequence.ts). */
export function useFilmSequence(): Sequence | null {
  return useAppStore((s) => filmSequenceOf(s.tracks, s.settings.race))
}

/** The track the film flies: the first one, or the sequence of all of them « À la suite ». */
export function useFilmTrack(): Track | undefined {
  return useAppStore((s) => filmTrackOf(s.tracks, s.settings.race))
}

/** Landmarks of the film track: the first track's, or those of every stage along the sequence. */
function filmLandmarks(track: Track | undefined, sequence: Sequence | null, byTrack: Readonly<Record<string, readonly Landmark[]>>) {
  if (sequence) return sequenceLandmarks(sequence, byTrack)
  return track ? byTrack[track.id] : undefined
}

/** What the film clock is computed from: film track, film, flyover duration, pacing, landmarks (from the stores). */
export function useFilmSource(): FilmClockFor {
  const sequence = useFilmSequence()
  const track = useFilmTrack()
  const durationS = useAppStore((s) => s.settings.flyoverDurationS)
  const pacing = useAppStore((s) => s.settings.pacing)
  const film = useAppStore((s) => s.settings.film)
  const landmarks = useLandmarkStore((s) => filmLandmarks(track, sequence, s.landmarks))
  return { track, film, durationS, pacing, landmarks, cutsM: sequence?.cutsM }
}

/** The film source read from the stores outside React (event handlers, shortcuts). */
export function getFilmSource(): FilmClockFor {
  const { tracks, settings } = useAppStore.getState()
  const sequence = filmSequenceOf(tracks, settings.race)
  const track = sequence?.track ?? tracks[0]
  const landmarks = filmLandmarks(track, sequence, useLandmarkStore.getState().landmarks)
  return { track, film: settings.film, durationS: settings.flyoverDurationS, pacing: settings.pacing, landmarks, cutsM: sequence?.cutsM }
}

/**
 * Edit the film of the stores: `stops` writes the generated stops out first (`materializeStops`, editing a stop);
 * the texts and media attached to a stop follow it (`followStops`); retouching a landmark title fixes them
 * (`freezeLandmarkTitles`); one undo step, or merged with the quick changes before it when `step` is false (typing in
 * the inspector). The edit's `id` is selected on the timeline (null: nothing selected, absent: unchanged).
 */
export function editFilm(edit: (film: Film) => { film: Film; id?: string | null }, { stops = false, step = true } = {}): void {
  const source = getFilmSource()
  const { track, film, pacing, landmarks } = source
  const base = stops && track ? materializeStops(film, { track, landmarks, pacing }) : film
  const result = edit(base)
  const next = freezeLandmarkTitles(film, followStops(base, result.film, (f) => filmClockFor({ ...source, film: f })))
  const set = () => useAppStore.getState().setSetting('film', next)
  if (next !== film) {
    if (step) getSettingsHistory().transaction(set)
    else set()
  }
  if (result.id !== undefined) useAppStore.getState().setFilmSelection(result.id)
}

/**
 * « Ralentir et titrer aux repères » on the film of the stores: on, its landmark slow-downs and titles made again from
 * the landmarks loaded for the first track (`withLandmarkTitles`); off, removed. The texts and media attached to a
 * stop follow it (`followStops`). One undo step, none when nothing changes (the landmarks are published again and
 * again with the same content).
 */
export function setLandmarkTitles(on: boolean): void {
  const source = getFilmSource()
  const { track, film, landmarks, pacing } = source
  const next =
    on && track
      ? withLandmarkTitles({ ...film, landmarkTitles: true }, { track, landmarks, pacing }, passingTimes(source))
      : withoutLandmarkTitles({ ...film, landmarkTitles: on })
  if (next.landmarkTitles === film.landmarkTitles && sameLandmarkTitles(film, next)) return
  const followed = followStops(film, next, (f) => filmClockFor({ ...source, film: f }))
  getSettingsHistory().transaction(() => useAppStore.getState().setSetting('film', followed))
}

/**
 * Set the flyover duration and / or the pacing of the stores; the texts and media attached to a stop follow it
 * (`followStops`) in the same change of the settings, so one undo step (coalesced like any slider).
 */
export function setFlightTiming(patch: Partial<Pick<FilmClockFor, 'durationS' | 'pacing'>>): void {
  const source = getFilmSource()
  const film = followStops(
    source.film,
    source.film,
    (f) => filmClockFor({ ...source, ...patch, film: f }),
    (f) => filmClockFor({ ...source, film: f }),
  )
  const { settings } = useAppStore.getState()
  const { durationS = settings.flyoverDurationS, pacing = settings.pacing } = patch
  useAppStore.setState({ settings: { ...settings, flyoverDurationS: durationS, pacing, film } })
}

/**
 * After the flyover duration or the pacing of the stores changed from `before` (« Par défaut » of « Durée et rythme »,
 * `resetSettings`), the texts and media attached to a stop follow it (`followStops`), in the same undo step.
 */
export function followFlightTiming(before: Pick<Settings, 'flyoverDurationS' | 'pacing'>): void {
  const source = getFilmSource()
  if (source.durationS === before.flyoverDurationS && source.pacing === before.pacing) return
  const film = followStops(
    source.film,
    source.film,
    (f) => filmClockFor({ ...source, film: f }),
    (f) => filmClockFor({ ...source, durationS: before.flyoverDurationS, pacing: before.pacing, film: f }),
  )
  if (film !== source.film) useAppStore.getState().setSetting('film', film)
}

/** Landmarks of the first track the film was last in line with (null: none published for that track yet). */
let followedLandmarks: { trackId: string | undefined; landmarks: readonly Landmark[] | null } = { trackId: undefined, landmarks: null }

/**
 * The landmarks of the first track published again (`LandmarkPanel`): the slow-downs of the pacing at landmarks move
 * the stops in film time, and the texts and media attached to a stop follow them (`followStops`) from the landmarks
 * published before. Not an undo step: loading landmarks is not an edit. Not on the first landmarks of a track (project
 * opened, track imported): landmarks are not saved but fetched again, and a film was saved with the times of its own.
 */
export function followLandmarks(): void {
  const source = getFilmSource()
  const trackId = source.track?.id
  const previous = followedLandmarks.trackId === trackId ? followedLandmarks.landmarks : null
  // once a track had landmarks, none (turned off) is a change too
  followedLandmarks = { trackId, landmarks: source.landmarks ?? (previous && []) }
  if (!previous || previous === source.landmarks) return
  const film = followStops(
    source.film,
    source.film,
    (f) => filmClockFor({ ...source, film: f }),
    (f) => filmClockFor({ ...source, landmarks: previous, film: f }),
  )
  if (film === source.film) return
  const resume = getSettingsHistory().suspend()
  try {
    useAppStore.getState().setSetting('film', film)
  } finally {
    resume()
  }
}

/** Film time at which the marker passes a distance along the first track of `source`, in a given film (flight only). */
function passingTimes(source: FilmClockFor): PassingTimes {
  const lengthM = source.track?.stats.distanceM ?? 0
  return (film) => {
    const clock = filmClockFor({ ...source, film })
    return (atM) => Math.min(clock.timeAtProgress(lengthM > 0 ? atM / lengthM : 0), clock.openingS + clock.flightS)
  }
}

/**
 * Film clock of the film track (the first track, or the sequence « À la suite ») for the current settings and
 * OpenStreetMap landmarks (memoised), shared by the playback (FlyoverRig), the export (ExportController), the timeline
 * and the panels (film duration, highlights).
 */
export function useFilmClock(): FilmClock {
  const { track, film, durationS, pacing, landmarks, cutsM } = useFilmSource()
  return useMemo(
    () => filmClockFor({ track, film, durationS, pacing, landmarks, cutsM }),
    [track, film, durationS, pacing, landmarks, cutsM],
  )
}

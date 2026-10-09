import { useMemo } from 'react'
import { freezeLandmarkTitles, materializeStops, sameLandmarkTitles, withLandmarkTitles, withoutLandmarkTitles } from '../film/assemble'
import type { PassingTimes } from '../film/assemble'
import { filmClockFor } from '../film/clock'
import type { FilmClock, FilmClockFor } from '../film/clock'
import type { Film } from '../film/model'
import { followStops } from '../film/timeline'
import { useLandmarkStore } from '../osm/store'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'

/** What the film clock is computed from: first track, film, flyover duration, pacing, landmarks (from the stores). */
export function useFilmSource(): FilmClockFor {
  const track = useAppStore((s) => s.tracks[0])
  const durationS = useAppStore((s) => s.settings.flyoverDurationS)
  const pacing = useAppStore((s) => s.settings.pacing)
  const film = useAppStore((s) => s.settings.film)
  const landmarks = useLandmarkStore((s) => (track ? s.landmarks[track.id] : undefined))
  return { track, film, durationS, pacing, landmarks }
}

/** The film source read from the stores outside React (event handlers, shortcuts). */
export function getFilmSource(): FilmClockFor {
  const { tracks, settings } = useAppStore.getState()
  const track = tracks[0]
  const landmarks = track ? useLandmarkStore.getState().landmarks[track.id] : undefined
  return { track, film: settings.film, durationS: settings.flyoverDurationS, pacing: settings.pacing, landmarks }
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

/** Film time at which the marker passes a distance along the first track of `source`, in a given film (flight only). */
function passingTimes(source: FilmClockFor): PassingTimes {
  const lengthM = source.track?.stats.distanceM ?? 0
  return (film) => {
    const clock = filmClockFor({ ...source, film })
    return (atM) => Math.min(clock.timeAtProgress(lengthM > 0 ? atM / lengthM : 0), clock.openingS + clock.flightS)
  }
}

/**
 * Film clock of the first track for the current settings and OpenStreetMap landmarks (memoised), shared by the
 * playback (FlyoverRig), the export (ExportController), the timeline and the panels (film duration, highlights).
 */
export function useFilmClock(): FilmClock {
  const { track, film, durationS, pacing, landmarks } = useFilmSource()
  return useMemo(() => filmClockFor({ track, film, durationS, pacing, landmarks }), [track, film, durationS, pacing, landmarks])
}

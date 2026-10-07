import { useMemo } from 'react'
import { materializeStops } from '../film/assemble'
import { filmClockFor } from '../film/clock'
import type { FilmClock, FilmClockFor } from '../film/clock'
import type { Film } from '../film/model'
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
 * one undo step, or merged with the quick changes before it when `step` is false (typing in the inspector). The
 * edit's `id` is selected on the timeline (null: nothing selected, absent: unchanged).
 */
export function editFilm(edit: (film: Film) => { film: Film; id?: string | null }, { stops = false, step = true } = {}): void {
  const { track, film, pacing, landmarks } = getFilmSource()
  const result = edit(stops && track ? materializeStops(film, { track, landmarks, pacing }) : film)
  const set = () => useAppStore.getState().setSetting('film', result.film)
  if (result.film !== film) {
    if (step) getSettingsHistory().transaction(set)
    else set()
  }
  if (result.id !== undefined) useAppStore.getState().setFilmSelection(result.id)
}

/**
 * Film clock of the first track for the current settings and OpenStreetMap landmarks (memoised), shared by the
 * playback (FlyoverRig), the export (ExportController), the timeline and the panels (film duration, highlights).
 */
export function useFilmClock(): FilmClock {
  const { track, film, durationS, pacing, landmarks } = useFilmSource()
  return useMemo(() => filmClockFor({ track, film, durationS, pacing, landmarks }), [track, film, durationS, pacing, landmarks])
}

/** The film clock under its former name (camera and export panels). */
export const usePacing = useFilmClock

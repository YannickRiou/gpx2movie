import { useMemo } from 'react'
import { filmClockFor } from '../film/clock'
import type { FilmClock, FilmClockFor } from '../film/clock'
import { useLandmarkStore } from '../osm/store'
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

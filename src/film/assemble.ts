/**
 * Automatic assembly of the film when a track is loaded: overview opening, flight with a stop at each highlight
 * of the pacing (climb tops, passes crossed, peaks next to the track; one per cluster, like the pauses it
 * replaces), overview closing. The user retouches it afterwards on the timeline.
 *
 * The stops follow the pacing settings (`enabled`, `climbs`, `landmarks`, `windowM`, `pauseS`): with the default
 * pacing (off) the flight has no stop, as before the film existed. Pure module.
 */
import type { Track } from '../core/types'
import { climbsOf } from '../flyover/climbs'
import { isHighlightLandmark, pausePositions } from '../flyover/pacing'
import type { PacingSettings } from '../flyover/pacing'
import type { Landmark } from '../osm/landmarks'
import { climbLabelText } from '../scene/labelModel'
import { DEFAULT_FILM } from './model'
import type { Film, FilmStop } from './model'

export interface AssembleInput {
  /** first track */
  track: Track
  /** OpenStreetMap landmarks of the track (from the landmark store) */
  landmarks?: readonly Landmark[]
  pacing: PacingSettings
}

/** Id of a generated stop: its rounded position, stable while the highlights do not move. */
export function autoStopId(atM: number): string {
  return `auto-${Math.round(atM)}`
}

/** Stops at the highlights of the pacing, `pauseS` each, camera held (the pauses they replace held it too). */
export function autoStops({ track, landmarks = [], pacing }: AssembleInput): FilmStop[] {
  const L = track.stats.distanceM
  if (!pacing.enabled || !(pacing.pauseS > 0) || !(L > 0)) return []
  const candidates: Omit<FilmStop, 'id' | 'durationS' | 'camera'>[] = []
  const at = (m: number) => Math.min(L, Math.max(0, m))
  if (pacing.climbs) {
    climbsOf(track).forEach((climb, i) =>
      candidates.push({ atM: at(climb.endDistM), label: climbLabelText(climb, i), source: { kind: 'climb', ref: String(i) } }),
    )
  }
  if (pacing.landmarks) {
    for (const l of landmarks.filter(isHighlightLandmark)) {
      candidates.push({ atM: at(l.alongM), label: l.name, source: { kind: 'landmark', ref: l.id } })
    }
  }
  const positions = [...new Set(candidates.map((c) => c.atM))].sort((a, b) => a - b)
  return pausePositions(positions, pacing.windowM).map((atM) => {
    const { label, source } = candidates.find((c) => c.atM === atM)!
    return { id: autoStopId(atM), atM, durationS: pacing.pauseS, camera: 'fixe', label, source }
  })
}

/** The film assembled from the track: default opening and closing, generated stops written out, no text. */
export function assembleFilm(input: AssembleInput): Film {
  return { ...DEFAULT_FILM, autoStops: false, stops: autoStops(input) }
}

/** Stops of `film`: generated while `autoStops` is set, else its own. */
export function filmStops(film: Film, input: AssembleInput): FilmStop[] {
  return film.autoStops ? autoStops(input) : film.stops
}

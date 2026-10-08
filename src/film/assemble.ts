/**
 * Automatic assembly of the film when a track is loaded: overview opening, flight with a stop at each highlight
 * of the pacing (climb tops, passes crossed, peaks next to the track; one per cluster, like the pauses it
 * replaces), overview closing. The user retouches it afterwards on the timeline.
 *
 * The highlight kinds and the clustering follow the pacing settings (`climbs`, `landmarks`, `windowM`). New films
 * ('temps-forts') stop at every highlight, camera orbiting; films saved before the timeline ('rythme') keep the
 * pauses of the pacing (only while it is on, `pauseS` each, camera held). Pure module.
 */
import type { Track } from '../core/types'
import { climbsOf } from '../flyover/climbs'
import { isHighlightLandmark, pausePositions } from '../flyover/pacing'
import type { PacingSettings } from '../flyover/pacing'
import type { Landmark } from '../osm/landmarks'
import { climbLabelText } from '../scene/labelModel'
import { AUTO_STOP_S, DEFAULT_FILM } from './model'
import type { AutoStopMode, Film, FilmStop } from './model'

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

/** A highlight a stop can be made for. */
export type StopCandidate = Required<Pick<FilmStop, 'atM' | 'label' | 'source'>>

/** Highlights of the track selected by the pacing kinds (climb tops, passes crossed, peaks nearby), by position. */
export function stopCandidates({ track, landmarks = [], pacing }: AssembleInput): StopCandidate[] {
  const L = track.stats.distanceM
  const candidates: StopCandidate[] = []
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
  return candidates.sort((a, b) => a.atM - b.atM)
}

/**
 * Stops at the highlights, one per cluster (like the pauses they replace): 'temps-forts' `AUTO_STOP_S` each,
 * camera orbiting; 'rythme' only while the pacing is on, `pauseS` each, camera held.
 */
export function autoStops(input: AssembleInput, mode: AutoStopMode): FilmStop[] {
  const { track, pacing } = input
  const legacy = mode === 'rythme'
  if (!(track.stats.distanceM > 0) || (legacy && (!pacing.enabled || !(pacing.pauseS > 0)))) return []
  const candidates = stopCandidates(input)
  const positions = [...new Set(candidates.map((c) => c.atM))]
  return pausePositions(positions, pacing.windowM).map((atM) => {
    const { label, source } = candidates.find((c) => c.atM === atM)!
    const durationS = legacy ? pacing.pauseS : AUTO_STOP_S
    return { id: autoStopId(atM), atM, durationS, camera: legacy ? 'fixe' : 'orbite', label, source }
  })
}

/** `film` with its generated stops written out (`autoStops` cleared): the first edit of a stop on the timeline. */
export function materializeStops(film: Film, input: AssembleInput): Film {
  return film.autoStops ? { ...film, autoStops: false, stops: autoStops(input, film.autoMode) } : film
}

/** The film assembled from the track: default opening and closing, generated stops written out, no text. */
export function assembleFilm(input: AssembleInput): Film {
  return materializeStops(DEFAULT_FILM, input)
}

/** Stops of `film`: generated while `autoStops` is set, else its own. */
export function filmStops(film: Film, input: AssembleInput): FilmStop[] {
  return film.autoStops ? autoStops(input, film.autoMode) : film.stops
}

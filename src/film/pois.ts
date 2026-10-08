/**
 * Points of interest placed by hand (`film.pois`, « Le chalet de Paul »): add, rename, remove, and where on the
 * first track the stop « Faire un arrêt ici » goes. Pure functions of the film, like the edits of `timeline.ts`.
 */
import type { LonLat } from '../core/types'
import { nearestOnPath } from '../flyover/path'
import type { TrackPath } from '../flyover/path'
import { nextFilmId } from './model'
import type { Film } from './model'

/** Longest name kept (the 3D label shows at most its first 40 characters). */
export const POI_NAME_MAX = 60

/** Coordinates kept at 1e-6° (about 10 cm): clean values in the project file. */
const roundDeg = (deg: number) => Math.round(deg * 1e6) / 1e6

/** « Point d'intérêt 3 »: the name given to the next point when none is typed. */
export function defaultPoiName(film: Film): string {
  return `Point d'intérêt ${nextFilmId(film, 'poi').slice('poi-'.length)}`
}

/** The film with a new point of interest at `at`, named `name` (trimmed; `defaultPoiName` when empty). */
export function addPoi(film: Film, at: LonLat, name = ''): Film {
  const poi = {
    id: nextFilmId(film, 'poi'),
    lon: roundDeg(at.lon),
    lat: roundDeg(at.lat),
    name: name.trim().slice(0, POI_NAME_MAX) || defaultPoiName(film),
  }
  return { ...film, pois: [...film.pois, poi] }
}

/** The film with point `id` renamed (kept as typed, so a field can be cleared and retyped; a blank name shows no label). */
export function renamePoi(film: Film, id: string, name: string): Film {
  return { ...film, pois: film.pois.map((poi) => (poi.id === id ? { ...poi, name: name.slice(0, POI_NAME_MAX) } : poi)) }
}

export function removePoi(film: Film, id: string): Film {
  return { ...film, pois: film.pois.filter((poi) => poi.id !== id) }
}

/** Distance along the first track of its point nearest to `at` (metres, rounded), where its stop goes. */
export function poiStopAtM(path: TrackPath, at: LonLat): number | undefined {
  const nearest = nearestOnPath(path, at)
  return nearest && Math.round(nearest.distanceM)
}

/**
 * Automatic assembly of the film when a track is loaded: overview opening, flight with a stop at each highlight
 * of the pacing (climb tops, passes crossed, peaks next to the track; one per cluster, like the pauses it
 * replaces), overview closing. The user retouches it afterwards on the timeline.
 *
 * The highlight kinds and the clustering follow the pacing settings (`climbs`, `landmarks`, `windowM`). New films
 * ('temps-forts') stop at every highlight, camera orbiting; films saved before the timeline ('rythme') keep the
 * pauses of the pacing (only while it is on, `pauseS` each, camera held).
 *
 * « Ralentir et titrer aux repères » (`film.landmarkTitles`): at the most notable landmarks on the track (passes,
 * summits, huts), a slow-down portion and a title card with the name, written into the film (`withLandmarkTitles`)
 * and told apart from the user's own items by their ids (`auto-speed-…`, `auto-text-…`). Pure module.
 */
import type { Track } from '../core/types'
import { climbsOf } from '../flyover/climbs'
import { isHighlightLandmark, pacingHighlights, pausePositions } from '../flyover/pacing'
import type { PacingSettings } from '../flyover/pacing'
import { CROSSED_PASS_M } from '../osm/landmarks'
import type { Landmark } from '../osm/landmarks'
import { climbLabelText } from '../scene/labelModel'
import { formatNumber } from '../ui/format'
import { AUTO_STOP_S, MIN_SPEED_SPAN_M } from './model'
import type { AutoStopMode, Film, FilmSpeed, FilmStop, FilmText } from './model'

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
 * camera orbiting; 'rythme' only while the pacing is on, `pauseS` each, camera as in the film (as these pauses were).
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
    return { id: autoStopId(atM), atM, durationS, camera: legacy ? 'film' : 'orbite', label, source }
  })
}

/** `film` with its generated stops written out (`autoStops` cleared): the first edit of a stop on the timeline. */
export function materializeStops(film: Film, input: AssembleInput): Film {
  return film.autoStops ? { ...film, autoStops: false, stops: autoStops(input, film.autoMode) } : film
}

/** Stops of `film`: generated while `autoStops` is set, else its own. */
export function filmStops(film: Film, input: AssembleInput): FilmStop[] {
  return film.autoStops ? autoStops(input, film.autoMode) : film.stops
}

// ---------------------------------------------------------------------------
// Slow-downs and titles at the landmarks
// ---------------------------------------------------------------------------

/** Passes and summits this close to the track get a title (metres), huts closer than `TITLE_HUT_M`. */
export const TITLE_NEAR_M = CROSSED_PASS_M
export const TITLE_HUT_M = 100
/** At most one title per `TITLE_EVERY_M` of track, never more than `MAX_LANDMARK_TITLES`. */
export const TITLE_EVERY_M = 3000
export const MAX_LANDMARK_TITLES = 6
/** Shortest film time between two titles (seconds). */
export const TITLE_GAP_S = 10
/** A title stays `LANDMARK_TITLE_S` on screen, from `TITLE_LEAD_S` before the marker passes the landmark. */
export const LANDMARK_TITLE_S = 4
export const TITLE_LEAD_S = 1
/** Slow-down centred on a titled landmark. */
export const TITLE_SLOW = { factor: 0.5, spanM: 400 } as const

/** Film time at which the marker passes `atM` metres along the first track, in a given film (from its clock). */
export type PassingTimes = (film: Film) => (atM: number) => number

export interface LandmarkTitleInput {
  landmarks: readonly Landmark[]
  lengthM: number
  /** where the film already stops or slows down (metres along the track): no slow-down portion over them */
  heldM: readonly number[]
  /** speed portions of the user (a slow-down never overlaps them) */
  speeds: readonly Pick<FilmSpeed, 'fromM' | 'toM'>[]
  /** film time at which the marker passes a distance along the track (seconds) */
  timeAtM: (atM: number) => number
}

/** A landmark to title, with the portion slowed around it (absent where there is no room for one). */
export interface LandmarkTitle {
  landmark: Landmark
  slow?: { fromM: number; toM: number }
}

const isTitleWorthy = (l: Landmark) =>
  l.kind === 'hut' ? l.distanceM <= TITLE_HUT_M : (l.kind === 'pass' || l.kind === 'peak') && l.distanceM <= TITLE_NEAR_M

const overlaps = (a: { fromM: number; toM: number }, b: { fromM: number; toM: number }) => a.fromM < b.toM && b.fromM < a.toM

/** The slow-down around `atM`, kept on the track; none when that leaves less than `MIN_SPEED_SPAN_M`. */
function slowPortion(atM: number, lengthM: number): { fromM: number; toM: number } | undefined {
  const fromM = Math.max(0, atM - TITLE_SLOW.spanM / 2)
  const toM = Math.min(lengthM, atM + TITLE_SLOW.spanM / 2)
  return toM - fromM >= MIN_SPEED_SPAN_M ? { fromM, toM } : undefined
}

/**
 * The landmarks to title, ordered along the track: passes and summits within `TITLE_NEAR_M`, huts within
 * `TITLE_HUT_M`, most important first (`priority`), each at least `TITLE_GAP_S` from the others, one per
 * `TITLE_EVERY_M` of track (at least one, at most `MAX_LANDMARK_TITLES`). Each gets a slow-down unless it would
 * cover a place where the film already stops or slows down, or overlap a speed portion.
 */
export function pickLandmarkTitles({ landmarks, lengthM, heldM, speeds, timeAtM }: LandmarkTitleInput): LandmarkTitle[] {
  const most = Math.min(MAX_LANDMARK_TITLES, Math.max(1, Math.round(lengthM / TITLE_EVERY_M)))
  const ranked = landmarks
    .filter(isTitleWorthy)
    .sort((a, b) => b.priority - a.priority || a.alongM - b.alongM || (a.id < b.id ? -1 : 1))
  const picked: { landmark: Landmark; timeS: number }[] = []
  for (const landmark of ranked) {
    if (picked.length === most) break
    const timeS = timeAtM(landmark.alongM)
    if (picked.every((p) => Math.abs(p.timeS - timeS) >= TITLE_GAP_S)) picked.push({ landmark, timeS })
  }

  const taken = [...speeds]
  return picked
    .map((p) => p.landmark)
    .sort((a, b) => a.alongM - b.alongM)
    .map((landmark) => {
      const slow = slowPortion(landmark.alongM, lengthM)
      if (!slow || heldM.some((m) => m >= slow.fromM && m <= slow.toM) || taken.some((s) => overlaps(s, slow))) return { landmark }
      taken.push(slow)
      return { landmark, slow }
    })
}

/** Id of an item made for a landmark: `auto-speed-node-123`, `auto-text-node-123`. */
const titleItemId = (kind: 'speed' | 'text', landmark: Landmark) => `auto-${kind}-${landmark.id.replace('/', '-')}`

/** The item was made for a landmark (`withLandmarkTitles`). */
export const isLandmarkTitleItem = (item: { id: string }) => /^auto-(speed|text)-/.test(item.id)

/** Title card of a landmark passed at film time `passS`: its name, its elevation below when known. */
function titleText(landmark: Landmark, passS: number): FilmText {
  const startS = Math.round(Math.max(0, passS - TITLE_LEAD_S) * 10) / 10
  const text: FilmText = { id: titleItemId('text', landmark), startS, durationS: LANDMARK_TITLE_S, text: landmark.name, anchor: 'top-center', size: 1 }
  if (landmark.ele !== undefined) text.subtitle = `${formatNumber(landmark.ele)} m`
  return text
}

/** `film` without the items made for the landmarks. */
export function withoutLandmarkTitles(film: Film): Film {
  return { ...film, speeds: film.speeds.filter((s) => !isLandmarkTitleItem(s)), texts: film.texts.filter((t) => !isLandmarkTitleItem(t)) }
}

/**
 * `film` with the slow-downs and titles of the landmarks made again (`pickLandmarkTitles`), the user's own items
 * untouched. The film already stops at its stops and slows at the pacing highlights (while the pacing is on): no
 * slow-down there, the title only. Titles are placed where the marker passes once the slow-downs are in.
 */
export function withLandmarkTitles(film: Film, input: AssembleInput, passingTimes: PassingTimes): Film {
  const own = withoutLandmarkTitles(film)
  const { track, landmarks = [], pacing } = input
  const heldM = [...filmStops(own, input).map((s) => s.atM), ...(pacing.enabled ? pacingHighlights(track, pacing, landmarks) : [])]
  const titles = pickLandmarkTitles({ landmarks, lengthM: track.stats.distanceM, heldM, speeds: own.speeds, timeAtM: passingTimes(own) })
  const speeds = titles.flatMap(({ landmark, slow }) => (slow ? [{ id: titleItemId('speed', landmark), ...slow, factor: TITLE_SLOW.factor }] : []))
  const slowed = { ...own, speeds: [...own.speeds, ...speeds] }
  const passS = passingTimes(slowed)
  return { ...slowed, texts: [...own.texts, ...titles.map(({ landmark }) => titleText(landmark, passS(landmark.alongM)))] }
}

const landmarkTitleItems = (film: Film) => JSON.stringify([...film.speeds, ...film.texts].filter(isLandmarkTitleItem))

/** Both films have the same items made for the landmarks. */
export function sameLandmarkTitles(a: Film, b: Film): boolean {
  return landmarkTitleItems(a) === landmarkTitleItems(b)
}

/**
 * `next`, a retouch of `previous` by the user, with the landmark titles left as they are from now on
 * (`landmarkTitles` cleared) when it changes or removes one of their items, as retouching a stop fixes the
 * generated stops.
 */
export function freezeLandmarkTitles(previous: Film, next: Film): Film {
  return previous.landmarkTitles && next.landmarkTitles && !sameLandmarkTitles(previous, next) ? { ...next, landmarkTitles: false } : next
}

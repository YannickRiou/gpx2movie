/**
 * Film clock: the one mapping between the film time (seconds at x1 from the very first frame) and what the film
 * shows, shared by the preview (`FlyoverRig`, `playback.timeS`) and the export (`ExportController`), so both give the
 * same frame for the same time.
 *
 *   [0, O)          opening: overview shot, progress 0
 *   [O, O + F)      flight: pacing slow-downs, speed portions and stops (`flightPacing`); 'stop' phase in a stop window
 *   [O + F, total]  closing: overview shot, progress 1
 *
 * A pure function of the film time: any frame can be computed alone.
 */
import { clamp } from '../core/math'
import type { Track } from '../core/types'
import { flightPacing, pacingHighlights } from '../flyover/pacing'
import type { Pacing, PacingPosition, PacingSettings } from '../flyover/pacing'
import type { Landmark } from '../osm/landmarks'
import { filmStops } from './assemble'
import { shotDurationS } from './model'
import type { Film, FilmCameraKey, FilmShot, FilmSpeed, FilmStop } from './model'

export type FilmPhase = 'opening' | 'flight' | 'stop' | 'closing'

/** A stop of the film placed on the clock (film times from the very start, opening included). */
export interface ClockStop extends FilmStop {
  progress: number
  /** start of the ease-in, hold, end of the ease-out */
  startS: number
  holdStartS: number
  holdEndS: number
  endS: number
  /** time added to the film (after the `keepDuration` cap of the pacing) */
  addedS: number
}

/** A speed portion of the film placed on the clock: film times at which the marker enters and leaves it. */
export interface ClockSpeed extends FilmSpeed {
  startS: number
  endS: number
}

/** A camera key of the film placed on the clock: film time at which the marker passes it. */
export interface ClockCameraKey extends FilmCameraKey {
  timeS: number
}

/** A cut between two stages « À la suite » (flyover/sequence.ts): film time at which the marker reaches it. */
export interface ClockCut {
  atM: number
  timeS: number
}

/** What the film shows at a film time. */
export interface FilmState {
  phase: FilmPhase
  /** film time, clamped to [0, total] */
  timeS: number
  progress: number
  /** time since the start of the flight, clamped to it: drives the time-based camera styles */
  flightTimeS: number
  /** the stop whose window contains the time ('stop' phase), else null */
  stop: ClockStop | null
  /** time since the start of the phase (the flight, a stop's window, a shot) and the length of that phase */
  localS: number
  lengthS: number
}

/**
 * Same contract as a `Pacing` over the whole film (the panels read `totalTime` and `highlights`, the export
 * `progressAtTime`), plus the phases.
 */
export interface FilmClock {
  /** pacing highlights as progress values, sorted */
  highlights: readonly number[]
  opening: FilmShot
  closing: FilmShot
  openingS: number
  flightS: number
  closingS: number
  stops: readonly ClockStop[]
  /** speed portions, by position */
  speeds: readonly ClockSpeed[]
  /** camera keys, by position */
  cameraKeys: readonly ClockCameraKey[]
  /** cuts between stages « À la suite », by position (none otherwise) */
  cuts: readonly ClockCut[]
  /** film length at ×1 (seconds) */
  totalTime(): number
  /** progress at film time `tS` (0 during the opening, 1 during the closing); continuous and non-decreasing */
  progressAtTime(tS: number): number
  /**
   * film time of a progress set from outside (scrub): the first time the flight reaches it (0 is the start of
   * the flight, after the opening; a stop's position the start of its hold); 1 is the end of the film
   */
  timeAtProgress(progress: number): number
  positionAt(progress: number): PacingPosition
  /** position after `dtS` seconds of playback at `speed` (film time clamped to [0, totalTime()]) */
  advance(from: PacingPosition, dtS: number, speed: number): PacingPosition
  stateAt(tS: number): FilmState
}

export interface FilmClockInput {
  opening: FilmShot
  closing: FilmShot
  stops: readonly FilmStop[]
  /** speed portions (none by default) */
  speeds?: readonly FilmSpeed[]
  /** camera keys (none by default) */
  cameraKeys?: readonly FilmCameraKey[]
  /** cuts between stages « À la suite » (metres, none by default) */
  cutsM?: readonly number[]
  /** length of the first track (metres), 0 without track */
  lengthM: number
  /** pacing highlights (metres along the track), slowed down when `pacing.enabled` */
  highlightsM: readonly number[]
  /** `settings.flyoverDurationS` */
  durationS: number
  pacing: PacingSettings
}

/** Clock of a film whose stops are known. */
export function buildFilmClock(input: FilmClockInput): FilmClock {
  const sorted = [...input.stops].sort((a, b) => a.atM - b.atM)
  const speeds = [...(input.speeds ?? [])].sort((a, b) => a.fromM - b.fromM)
  const flight: Pacing = flightPacing(input.lengthM, input.highlightsM, input.durationS, input.pacing, sorted, speeds)
  const openingS = shotDurationS(input.opening)
  const closingS = shotDurationS(input.closing)
  const flightS = flight.totalTime()
  const total = openingS + flightS + closingS
  // the identity flight (no track) has no pause: no stop either
  const stops: ClockStop[] = flight.pauses.map((pause, k) => ({
    ...sorted[k],
    progress: pause.progress,
    startS: openingS + pause.startS,
    holdStartS: openingS + pause.holdStartS,
    holdEndS: openingS + pause.holdEndS,
    endS: openingS + pause.endS,
    addedS: pause.durationS,
  }))

  // without track (no length) the portions have no place in the flight
  const flightTimeOf = (atM: number) => openingS + flight.timeAtProgress(Math.min(1, atM / input.lengthM))
  const clockSpeeds: ClockSpeed[] =
    input.lengthM > 0 ? speeds.map((s) => ({ ...s, startS: flightTimeOf(s.fromM), endS: flightTimeOf(s.toM) })) : []
  const cameraKeys: ClockCameraKey[] =
    input.lengthM > 0 ? [...(input.cameraKeys ?? [])].sort((a, b) => a.atM - b.atM).map((k) => ({ ...k, timeS: flightTimeOf(k.atM) })) : []
  const cuts: ClockCut[] = input.lengthM > 0 ? [...(input.cutsM ?? [])].sort((a, b) => a - b).map((atM) => ({ atM, timeS: flightTimeOf(atM) })) : []

  const progressAtTime = (tS: number) => flight.progressAtTime(tS - openingS)
  const timeAtProgress = (progress: number) => (progress >= 1 ? total : openingS + flight.timeAtProgress(progress))

  const stopAt = (t: number): ClockStop | null => {
    let lo = 0
    let hi = stops.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (stops[mid].startS <= t) lo = mid + 1
      else hi = mid
    }
    const stop = stops[lo - 1]
    return stop && t < stop.endS ? stop : null
  }

  const stateAt = (tS: number): FilmState => {
    const timeS = clamp(tS, 0, total)
    if (timeS < openingS) {
      return { phase: 'opening', timeS, progress: 0, flightTimeS: 0, stop: null, localS: timeS, lengthS: openingS }
    }
    const flightTimeS = timeS - openingS
    if (flightTimeS >= flightS && closingS > 0) {
      return { phase: 'closing', timeS, progress: 1, flightTimeS: flightS, stop: null, localS: flightTimeS - flightS, lengthS: closingS }
    }
    const progress = flight.progressAtTime(flightTimeS)
    const stop = stopAt(timeS)
    if (stop) return { phase: 'stop', timeS, progress, flightTimeS, stop, localS: timeS - stop.startS, lengthS: stop.endS - stop.startS }
    return { phase: 'flight', timeS, progress, flightTimeS, stop: null, localS: flightTimeS, lengthS: flightS }
  }

  return {
    highlights: flight.highlights,
    opening: input.opening,
    closing: input.closing,
    openingS,
    flightS,
    closingS,
    stops,
    speeds: clockSpeeds,
    cameraKeys,
    cuts,
    totalTime: () => total,
    progressAtTime,
    timeAtProgress,
    positionAt: (progress) => ({ timeS: timeAtProgress(progress), progress }),
    advance: (from, dtS, speed) => {
      const timeS = clamp(from.timeS + dtS * speed, 0, total)
      return { timeS, progress: progressAtTime(timeS) }
    },
    stateAt,
  }
}

export interface FilmClockFor {
  /** first track (none: no stop, a flight of `durationS`) */
  track: Track | undefined
  film: Film
  durationS: number
  pacing: PacingSettings
  /** OpenStreetMap landmarks of the track (from the landmark store) */
  landmarks?: readonly Landmark[]
  /** cuts between stages when the track is a sequence « À la suite » (metres) */
  cutsM?: readonly number[]
}

/** Input of the clock of the film of `track`: highlights and generated stops from the pacing settings and the landmarks. */
export function filmClockInputFor({ track, film, durationS, pacing, landmarks = [], cutsM }: FilmClockFor): FilmClockInput {
  return {
    opening: film.opening,
    closing: film.closing,
    stops: track ? filmStops(film, { track, landmarks, pacing }) : [],
    speeds: track ? film.speeds : [],
    cameraKeys: track ? film.cameraKeys : [],
    cutsM: track ? cutsM : [],
    lengthM: track?.stats.distanceM ?? 0,
    highlightsM: track && pacing.enabled ? pacingHighlights(track, pacing, landmarks) : [],
    durationS,
    pacing,
  }
}

/** Clock of the film of `track` (`filmClockInputFor`). */
export function filmClockFor(input: FilmClockFor): FilmClock {
  return buildFilmClock(filmClockInputFor(input))
}

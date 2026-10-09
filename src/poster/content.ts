/**
 * What a poster shows, as text and numbers: title, subtitle line, key figures, elevation profile, weather of the day,
 * list of the tracks, credits of the sources. Pure (no DOM, no React): `posterContent` takes the tracks and what the
 * stores know.
 *
 * Several tracks: a set of outings sums them (no weather of a single day); a ghost race keeps the figures and weather
 * of the lead (the same route). Either way the list of the tracks takes the place of the profile (up to
 * POSTER_LIST_MAX tracks listed, more are only counted and summed).
 */
import type { Track, TrackStats } from '../core/types'
import { buildTrackPath, elevationProfile } from '../flyover/path'
import type { TrackPath } from '../flyover/path'
import { formatDateFr, weatherSummaryLine } from '../overlay/draw'
import { formatDistance, formatDuration, formatNumber } from '../ui/format'
import type { WeatherSummary } from '../weather/series'
import { POSTER_FIGURES, POSTER_FIGURE_LABELS } from './settings'
import type { PosterFigureId, PosterSettings } from './settings'

/** Samples of the poster's elevation profile. */
export const POSTER_PROFILE_SAMPLES = 400
/** Tracks listed at most: beyond, the poster only sums them. */
export const POSTER_LIST_MAX = 6

export interface PosterFigure {
  id: PosterFigureId
  label: string
  /** number in large type, e.g. "12,4" */
  value: string
  /** unit after it in smaller type, e.g. "km" ('' for a duration) */
  unit: string
}

export interface PosterProfile {
  /** recorded elevation at evenly spaced distances (NaN where unknown) */
  ele: Float64Array
  minEle: number
  maxEle: number
  lengthM: number
}

/** One line of the list of tracks. */
export interface PosterTrackLine {
  name: string
  /** CSS colour of the track (its swatch) */
  color: string
  distance: string
  /** « D+ 850 m », '' without elevation */
  ascent: string
  /** « 12/07/2026 », '' without time */
  date: string
}

export interface PosterContent {
  title: string
  /** subtitle and date, '' when there is neither */
  subtitle: string
  figures: PosterFigure[]
  profile?: PosterProfile
  /** '' when hidden or unknown */
  weather: string
  /** several tracks, at most POSTER_LIST_MAX: one line each (empty otherwise) */
  tracks: PosterTrackLine[]
  /** one string per source, always shown (their licences require it) */
  credits: string[]
}

export interface PosterContentInput {
  /** every loaded track, the lead first */
  tracks: readonly Track[]
  /** ghost race: the tracks are racers on the lead's route (its figures), not outings to sum */
  race: boolean
  poster: PosterSettings
  /** name of the project, the default title */
  projectName: string
  /** number of climbs detected on each track */
  climbs: readonly number[]
  /** weather of the lead's outing */
  weather?: WeatherSummary
  credits: readonly string[]
  /** `buildTrackPath(tracks[0])` when the caller already has it */
  path?: TrackPath
}

/** "12,4 km" -> value "12,4", unit "km" (the unit follows the last space). */
function split(text: string): { value: string; unit: string } {
  const i = text.lastIndexOf(' ')
  return i < 0 ? { value: text, unit: '' } : { value: text.slice(0, i), unit: text.slice(i + 1) }
}

/** A figure of these statistics, null when the track does not record what it needs. */
export function posterFigure(id: PosterFigureId, stats: TrackStats, climbs: number): PosterFigure | null {
  const hasEle = stats.maxEle !== undefined
  const label = POSTER_FIGURE_LABELS[id]
  switch (id) {
    case 'distance':
      return { id, label, ...split(formatDistance(stats.distanceM)) }
    case 'ascent':
      return hasEle ? { id, label, value: formatNumber(Math.max(0, stats.ascentM)), unit: 'm' } : null
    case 'time':
      return stats.durationS === undefined ? null : { id, label, value: formatDuration(stats.durationS), unit: '' }
    case 'maxAltitude':
      return hasEle ? { id, label, value: formatNumber(stats.maxEle ?? 0), unit: 'm' } : null
    case 'climbs':
      return hasEle ? { id, label: climbs === 1 ? 'Montée' : label, value: formatNumber(climbs), unit: '' } : null
  }
}

/** Which figures these statistics can show (the others are greyed out in the panel). */
export function availableFigures(stats: TrackStats): Record<PosterFigureId, boolean> {
  return Object.fromEntries(POSTER_FIGURES.map((id) => [id, posterFigure(id, stats, 0) !== null])) as Record<PosterFigureId, boolean>
}

/**
 * Statistics of several outings together: distances, climbs and durations added, the highest point. A sum that
 * one of them does not record (elevation, time) is left out rather than understated.
 */
export function totalStats(tracks: readonly Track[]): TrackStats {
  const all = tracks.map((t) => t.stats)
  const sum = (of: (s: TrackStats) => number) => all.reduce((total, s) => total + of(s), 0)
  const everyEle = all.every((s) => s.maxEle !== undefined)
  const everyTime = all.every((s) => s.durationS !== undefined)
  return {
    distanceM: sum((s) => s.distanceM),
    ascentM: everyEle ? sum((s) => s.ascentM) : 0,
    descentM: everyEle ? sum((s) => s.descentM) : 0,
    durationS: everyTime ? sum((s) => s.durationS ?? 0) : undefined,
    maxEle: everyEle ? Math.max(...all.map((s) => s.maxEle ?? -Infinity)) : undefined,
    pointCount: sum((s) => s.pointCount),
  }
}

/** What the figures describe: the tracks summed for a set of outings, else the lead (alone, or the route of a race). */
export function posterStats(tracks: readonly Track[], race: boolean): TrackStats {
  return tracks.length > 1 && !race ? totalStats(tracks) : tracks[0].stats
}

/** « 12 juillet 2026 », or « 3 juillet 2026 – 28 juillet 2026 » when the tracks span several days ('' without time). */
function dateSpan(tracks: readonly Track[]): string {
  const times = tracks.flatMap((t) => (t.stats.startTime === undefined ? [] : [t.stats.startTime]))
  if (times.length === 0) return ''
  const first = formatDateFr(Math.min(...times))
  const last = formatDateFr(Math.max(...times))
  return first === last ? first : `${first} – ${last}`
}

/** « 12/07/2026 »: short enough for a column of the list. */
export function shortDateFr(ms: number): string {
  const date = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()}`
}

/** The line of a track in the list. */
export function trackLine(track: Track): PosterTrackLine {
  const { stats } = track
  return {
    name: track.name,
    color: track.color,
    distance: formatDistance(stats.distanceM),
    ascent: stats.maxEle === undefined ? '' : `D+ ${formatNumber(Math.max(0, stats.ascentM))} m`,
    date: stats.startTime === undefined ? '' : shortDateFr(stats.startTime),
  }
}

/** Elevation profile of a track, undefined when it records no elevation. */
function profileOf(path: TrackPath): PosterProfile | undefined {
  const profile = elevationProfile(path, POSTER_PROFILE_SAMPLES)
  return profile && { ...profile, lengthM: path.lengthM }
}

export function posterContent(input: PosterContentInput): PosterContent {
  const { tracks, race, poster, projectName, climbs, weather, credits } = input
  const lead = tracks[0]
  const several = tracks.length > 1
  // a set of outings is summed; a single track or a race shows the lead's day
  const outings = several && !race
  const stats = posterStats(tracks, race)
  const climbCount = outings ? climbs.reduce((a, b) => a + b, 0) : (climbs[0] ?? 0)
  const count = several ? `${formatNumber(tracks.length)} ${race ? 'traces' : 'sorties'}` : ''
  return {
    title: poster.title.trim() || projectName.trim() || lead.name,
    subtitle: [poster.subtitle.trim(), count, dateSpan(outings ? tracks : [lead])].filter(Boolean).join(' · '),
    figures: POSTER_FIGURES.filter((id) => poster.figures[id]).flatMap((id) => posterFigure(id, stats, climbCount) ?? []),
    // several tracks: the list takes its place
    profile: several ? undefined : profileOf(input.path ?? buildTrackPath(lead)),
    weather: poster.weather && !outings ? weatherSummaryLine(weather) : '',
    tracks: several && tracks.length <= POSTER_LIST_MAX ? tracks.map(trackLine) : [],
    credits: [...credits],
  }
}

/**
 * What a poster shows, as text and numbers: title, subtitle line, key figures, elevation profile, weather of the day,
 * credits of the sources. Pure (no DOM, no React): `posterContent` takes the track and what the stores know.
 */
import type { Track } from '../core/types'
import { buildTrackPath, elevationProfile } from '../flyover/path'
import { formatDateFr, weatherSummaryLine } from '../overlay/draw'
import { formatDistance, formatDuration, formatNumber } from '../ui/format'
import type { WeatherSummary } from '../weather/series'
import { POSTER_FIGURES, POSTER_FIGURE_LABELS } from './settings'
import type { PosterFigureId, PosterSettings } from './settings'

/** Samples of the poster's elevation profile. */
export const POSTER_PROFILE_SAMPLES = 400

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

export interface PosterContent {
  title: string
  /** subtitle and date, '' when there is neither */
  subtitle: string
  figures: PosterFigure[]
  profile?: PosterProfile
  /** '' when hidden or unknown */
  weather: string
  /** one string per source, always shown (their licences require it) */
  credits: string[]
}

export interface PosterContentInput {
  track: Track
  poster: PosterSettings
  /** name of the project, the default title */
  projectName: string
  /** number of climbs detected on the track */
  climbs: number
  weather?: WeatherSummary
  credits: readonly string[]
}

/** "12,4 km" -> value "12,4", unit "km" (the unit follows the last space). */
function split(text: string): { value: string; unit: string } {
  const i = text.lastIndexOf(' ')
  return i < 0 ? { value: text, unit: '' } : { value: text.slice(0, i), unit: text.slice(i + 1) }
}

/** A figure of the track, null when the track does not record what it needs. */
export function posterFigure(id: PosterFigureId, track: Track, climbs: number): PosterFigure | null {
  const { stats } = track
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

/** Which figures this track can show (the others are greyed out in the panel). */
export function availableFigures(track: Track): Record<PosterFigureId, boolean> {
  return Object.fromEntries(POSTER_FIGURES.map((id) => [id, posterFigure(id, track, 0) !== null])) as Record<PosterFigureId, boolean>
}

export function posterContent({ track, poster, projectName, climbs, weather, credits }: PosterContentInput): PosterContent {
  const date = track.stats.startTime === undefined ? '' : formatDateFr(track.stats.startTime)
  const path = buildTrackPath(track)
  const profile = elevationProfile(path, POSTER_PROFILE_SAMPLES)
  return {
    title: poster.title.trim() || projectName.trim() || track.name,
    subtitle: [poster.subtitle.trim(), date].filter(Boolean).join(' · '),
    figures: POSTER_FIGURES.filter((id) => poster.figures[id]).flatMap((id) => posterFigure(id, track, climbs) ?? []),
    profile: profile && { ...profile, lengthM: path.lengthM },
    weather: poster.weather ? weatherSummaryLine(weather) : '',
    credits: [...credits],
  }
}

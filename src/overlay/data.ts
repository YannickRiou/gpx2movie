/**
 * Values shown by the film overlay at a flyover progress: distance covered, altitude, cumulative D+,
 * elapsed recorded time, speed, heart rate, and the whole-track figures of the closing card; the lines of the
 * ghost-race leaderboard (`leaderboardRows`).
 *
 * `prepareOverlayTrack` does the per-track work once (path, cumulative ascent, smoothed speed and heart
 * rate per point); `overlayFrameAt` is then a cheap pure function of the progress, so the export can
 * compute any frame on its own. Pure functions (no DOM, no React, no Three).
 */
import type { Track } from '../core/types'
import { buildTrackPath, elevationProfile, recordedTimeAt, samplePath } from '../flyover/path'
import type { ElevationProfile, TrackPath } from '../flyover/path'
import { rankRacers } from '../flyover/race'
import type { Racer } from '../flyover/race'
import { stageAt } from '../flyover/sequence'
import type { Sequence } from '../flyover/sequence'
import { metricValues } from '../flyover/trackColor'
import { ELEVATION_HYSTERESIS_M, smoothElevations } from '../import/stats'
import { OSM_ATTRIBUTION } from '../osm/overpass'
import { getImagerySource, getTerrainSource } from '../terrain/sources'
import { formatDistanceGap, formatTimeGap } from '../ui/format'
import { OPEN_METEO_ATTRIBUTION } from '../weather/openMeteo'
import { summarizeOuting, weatherWidgetData } from '../weather/series'
import type { WeatherSeries, WeatherSummary, WeatherWidgetData } from '../weather/series'
import type { OverlayTime, StageCard } from './draw'

/** Samples of the overlay elevation profile over the track. */
export const OVERLAY_PROFILE_SAMPLES = 240
/** Most points kept in the mini-map outline (every n-th point of the path, plus the last one). */
export const OVERLAY_MINIMAP_POINTS = 1500
/** metres per degree of latitude (spherical Earth, enough for a plan view) */
const M_PER_DEG = (6371008.8 * Math.PI) / 180

/**
 * Plan view of the track for the mini-map: local equirectangular projection (x east, y south, like a canvas)
 * normalised so the longer side of the bounding box measures 1. Aspect ratio preserved.
 */
export interface MiniMapOutline {
  /** projected points, every n-th point of the path and the last one */
  x: Float64Array
  y: Float64Array
  /** cumulative distance along the path at each kept point (metres) */
  dist: Float64Array
  /** size of the bounding box (longer side = 1, both 0 for a track that does not move) */
  width: number
  height: number
  /** projection: x = (lon - west) * kx, y = (north - lat) * ky */
  west: number
  north: number
  kx: number
  ky: number
}

export interface OverlayTrackStats {
  distanceM: number
  /** undefined when the track has no elevation */
  ascentM?: number
  maxEleM?: number
  /** elapsed recorded time, start to end (seconds) */
  durationS?: number
  /** highest smoothed speed (km/h) */
  maxSpeedKmh?: number
  /** recorded time of the start (ms since epoch) */
  startTime?: number
  /** the times are estimated from a planned departure (`Track.timesEstimated`) */
  timesEstimated?: boolean
  /** weather of the outing, when its series is known */
  weather?: WeatherSummary
}

export interface OverlayTrack {
  name: string
  path: TrackPath
  /** cumulative D+ at each path point (metres); NaN everywhere when the track has no elevation */
  ascent: Float64Array
  /** smoothed speed at each path point (km/h), NaN when unknown */
  speed: Float64Array
  /** heart rate averaged over a few seconds at each path point (bpm), NaN when unknown */
  heartRate: Float64Array
  profile?: ElevationProfile
  /** plan view of the track (mini-map), undefined without points */
  outline?: MiniMapOutline
  /** historical weather along the track (Open-Meteo), when fetched */
  weatherSeries?: WeatherSeries
  stats: OverlayTrackStats
}

/** Everything the overlay shows at one progress. */
export interface OverlayFrame {
  /** 0 = start of the flyover, 1 = end */
  progress: number
  track: OverlayTrack
  distanceM: number
  ele?: number
  ascentM?: number
  elapsedS?: number
  speedKmh?: number
  heartRate?: number
  /** weather under the marker, when the track has a weather series */
  weather?: WeatherWidgetData
  /** position of the marker on the mini-map outline (same units as `track.outline`) */
  mapPoint?: { x: number; y: number }
}

/**
 * Cumulative ascent at each point of the flattened track, with the rule of `computeStats` (moving average,
 * then a climb only counts once it exceeds the hysteresis since the last accepted elevation, per segment):
 * the last value equals `track.stats.ascentM`. Points without elevation keep the running total.
 */
export function cumulativeAscent(track: Track): Float64Array {
  const out = new Float64Array(track.segments.reduce((n, s) => n + s.points.length, 0))
  let total = 0
  let offset = 0
  for (const segment of track.segments) {
    const points = segment.points
    const indices: number[] = []
    const elevations: number[] = []
    points.forEach((p, i) => {
      if (p.ele !== undefined && Number.isFinite(p.ele)) {
        indices.push(i)
        elevations.push(p.ele)
      }
    })
    const smoothed = smoothElevations(elevations)
    let reference = smoothed[0]
    let k = 0
    for (let i = 0; i < points.length; i++) {
      if (k < indices.length && indices[k] === i) {
        const delta = smoothed[k] - reference
        if (Math.abs(delta) > ELEVATION_HYSTERESIS_M) {
          if (delta > 0) total += delta
          reference = smoothed[k]
        }
        k++
      }
      out[offset + i] = total
    }
    offset += points.length
  }
  return out
}

function concat(parts: readonly Float64Array[], count: number): Float64Array {
  const out = new Float64Array(count)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function maxOf(values: Float64Array): number | undefined {
  let max = -Infinity
  for (const v of values) if (v > max) max = v
  return max > -Infinity ? max : undefined
}

/** Plan view of the path for the mini-map (see `MiniMapOutline`); undefined when the path has no point. */
export function miniMapOutline(path: TrackPath, maxPoints = OVERLAY_MINIMAP_POINTS): MiniMapOutline | undefined {
  const { count, lon, lat, dist } = path
  if (count === 0) return undefined
  let west = Infinity
  let east = -Infinity
  let south = Infinity
  let north = -Infinity
  for (let i = 0; i < count; i++) {
    west = Math.min(west, lon[i])
    east = Math.max(east, lon[i])
    south = Math.min(south, lat[i])
    north = Math.max(north, lat[i])
  }
  const widthM = (east - west) * M_PER_DEG * Math.cos((((south + north) / 2) * Math.PI) / 180)
  const heightM = (north - south) * M_PER_DEG
  const longerM = Math.max(widthM, heightM)
  const unit = longerM > 0 ? 1 / longerM : 0
  const kx = (widthM > 0 ? widthM / (east - west) : 0) * unit
  const ky = M_PER_DEG * unit
  const step = Math.max(1, Math.ceil(count / Math.max(2, maxPoints - 1)))
  const kept: number[] = []
  for (let i = 0; i < count; i += step) kept.push(i)
  if (kept[kept.length - 1] !== count - 1) kept.push(count - 1)
  const x = new Float64Array(kept.length)
  const y = new Float64Array(kept.length)
  const keptDist = new Float64Array(kept.length)
  kept.forEach((i, k) => {
    x[k] = (lon[i] - west) * kx
    y[k] = (north - lat[i]) * ky
    keptDist[k] = dist[i]
  })
  return { x, y, dist: keptDist, width: widthM * unit, height: heightM * unit, west, north, kx, ky }
}

/** Per-track data of the overlay; `weather` is the series of the outing (`useWeatherStore`), when fetched. */
export function prepareOverlayTrack(track: Track, weather?: WeatherSeries | null): OverlayTrack {
  const path = buildTrackPath(track)
  const hasEle = track.stats.maxEle !== undefined
  const speed = concat(
    track.segments.map((s) => metricValues(s.points, 'speed')),
    path.count,
  )
  const heartRate = concat(
    track.segments.map((s) => metricValues(s.points, 'heartRate')),
    path.count,
  )
  const ascent = hasEle ? cumulativeAscent(track) : new Float64Array(path.count).fill(Number.NaN)
  const weatherSeries = weather ?? undefined
  return {
    name: track.name,
    path,
    weatherSeries,
    ascent,
    speed,
    heartRate,
    profile: path.count > 0 ? elevationProfile(path, OVERLAY_PROFILE_SAMPLES) : undefined,
    outline: miniMapOutline(path),
    stats: {
      distanceM: path.lengthM,
      ascentM: hasEle ? track.stats.ascentM : undefined,
      maxEleM: track.stats.maxEle,
      durationS: track.stats.durationS,
      maxSpeedKmh: maxOf(speed),
      startTime: track.stats.startTime,
      timesEstimated: track.timesEstimated,
      weather: weatherSeries && path.count > 0 ? summarizeOuting(weatherSeries, path) : undefined,
    },
  }
}

/** Last index whose distance is <= d (binary search), the next one and the fraction between them. */
function locate(dist: Float64Array, d: number): { a: number; b: number; t: number } {
  let lo = 0
  let hi = dist.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (dist[mid] <= d) lo = mid
    else hi = mid - 1
  }
  const b = Math.min(dist.length - 1, lo + 1)
  const span = dist[b] - dist[lo]
  return { a: lo, b, t: span > 0 ? (d - dist[lo]) / span : 0 }
}

/** Linear interpolation; the known side when the other one is NaN; undefined when both are. */
function lerpKnown(values: Float64Array, a: number, b: number, t: number): number | undefined {
  const va = values[a]
  const vb = values[b]
  if (Number.isNaN(va)) return Number.isNaN(vb) ? undefined : vb
  if (Number.isNaN(vb)) return va
  return va + (vb - va) * t
}

/** Overlay values at `progress` (clamped to [0, 1]) of the flyover, which runs at constant ground speed. */
/**
 * Recorded instant under the marker at `progress` (ms since epoch), at the distance `overlayFrameAt` gives it;
 * undefined for an untimed track. What a video clip following the flight shows (`clipTimeS`), the same for the
 * drawing and for the frames decoded by the export.
 */
export function recordedAtProgress(path: TrackPath, progress: number): number | undefined {
  if (path.count === 0) return undefined
  return recordedTimeAt(path, Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0)) * path.lengthM)
}

export function overlayFrameAt(data: OverlayTrack, progress: number): OverlayFrame {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0))
  const { path } = data
  const distanceM = p * path.lengthM
  const frame: OverlayFrame = { progress: p, track: data, distanceM }
  if (path.count === 0) return frame

  const { a, b, t } = locate(path.dist, distanceM)
  const sample = samplePath(path, distanceM)
  frame.ele = sample.ele
  const { outline } = data
  if (outline) frame.mapPoint = { x: (sample.lon - outline.west) * outline.kx, y: (outline.north - sample.lat) * outline.ky }
  frame.ascentM = lerpKnown(data.ascent, a, b, t)
  frame.speedKmh = lerpKnown(data.speed, a, b, t)
  frame.heartRate = lerpKnown(data.heartRate, a, b, t)
  if (data.stats.startTime !== undefined) {
    const start = recordedTimeAt(path, 0)
    const now = recordedTimeAt(path, distanceM)
    if (start !== undefined && now !== undefined) frame.elapsedS = Math.max(0, (now - start) / 1000)
  }
  if (data.weatherSeries) frame.weather = weatherWidgetData(data.weatherSeries, path, p)
  return frame
}

/** Overlay data of the film: its track, and « À la suite » the sequence and each stage's own data. */
export interface OverlayFilm {
  whole: OverlayTrack
  sequence?: Sequence
  stages?: readonly OverlayTrack[]
}

/**
 * `prepareOverlayTrack` of the film track, and of every stage of a sequence « À la suite ». `weather` is the first
 * track's series, `stageWeather` those of the later stages by track id (weather store).
 */
export function prepareOverlayFilm(
  track: Track,
  sequence: Sequence | null,
  weather?: WeatherSeries | null,
  stageWeather?: Readonly<Record<string, { series: WeatherSeries | null }>>,
): OverlayFilm {
  if (!sequence) return { whole: prepareOverlayTrack(track, weather) }
  const stages = sequence.stages.map((s) => prepareOverlayTrack(s.track, s.index === 0 ? weather : stageWeather?.[s.track.id]?.series))
  return { whole: prepareOverlayTrack(track), sequence, stages }
}

/**
 * Overlay values at film `progress`: those of the film track, or « À la suite » those of the stage under the marker
 * (its own distance, D+, time, profile and mini-map) with the name and figures of the whole sequence for the opening
 * and closing cards.
 */
export function overlayFilmFrameAt(film: OverlayFilm, progress: number): OverlayFrame {
  if (!film.sequence || !film.stages) return overlayFrameAt(film.whole, progress)
  const at = stageAt(film.sequence, Number.isFinite(progress) ? progress : 0)
  const frame = overlayFrameAt(film.stages[at.stage.index], at.progress)
  return { ...frame, track: { ...frame.track, name: film.whole.name, stats: film.whole.stats } }
}

/** How long the card of a stage stays (seconds at ×1). */
export const STAGE_CARD_S = 5

/**
 * Card of the stage starting at film time `time.timeS` « À la suite »: the first one with the flight, each other at
 * its cut (`time.cutsS`), for STAGE_CARD_S; null outside these windows.
 */
export function stageCardAt(sequence: Sequence, time: OverlayTime): StageCard | null {
  const starts = [time.openingS, ...(time.cutsS ?? [])]
  let k = starts.length - 1
  while (k >= 0 && time.timeS < starts[k]) k--
  const stage = sequence.stages[k]
  if (!stage || time.timeS >= starts[k] + STAGE_CARD_S) return null
  const { stats } = stage.track
  const card: StageCard = {
    name: stage.track.name,
    index: k,
    count: sequence.stages.length,
    distanceM: stage.endM - stage.startM,
    startS: starts[k],
    durationS: STAGE_CARD_S,
  }
  if (stats.startTime !== undefined) card.startTime = stats.startTime
  if (stats.maxEle !== undefined) card.ascentM = stats.ascentM
  return card
}

export interface CreditSources {
  terrainSourceId: string
  imagerySourceId: string
  /** the weather of the outing is loaded (Open-Meteo) */
  weather: boolean
  /** OpenStreetMap landmarks are loaded */
  landmarks: boolean
}

/**
 * Credits of the sources in the film, the same strings as the status bar: relief and imagery always, Open-Meteo
 * and OpenStreetMap when their data is loaded.
 */
export function overlayCredits({ terrainSourceId, imagerySourceId, weather, landmarks }: CreditSources): string[] {
  return [
    `Relief : ${getTerrainSource(terrainSourceId).attribution}`,
    `Imagerie : ${getImagerySource(imagerySourceId).attribution}`,
    ...(weather ? [OPEN_METEO_ATTRIBUTION] : []),
    ...(landmarks ? [`Repères : ${OSM_ATTRIBUTION}`] : []),
  ]
}

/** One line of the ghost-race leaderboard. */
export interface LeaderboardRow {
  /** 1 for the first; racers at the same point with the same gap share a rank (1, 1, 3) */
  rank: number
  name: string
  color: string
  /** gap to the first: « +1 min 20 » (time) or « −350 m » (distance); « Tête », then « Arrivée », for the first */
  gap: string
}

/** Racers this close in fraction stand at the same point (as `rankRacers`). */
const SAME_FRACTION = 1e-9

/**
 * Leaderboard of the ghost race from the racers at one progress (`raceAt`): ranked by `rankRacers`, each with the
 * colour and name of its track and its gap to the first of the board. The gaps of `raceAt` are to the lead track
 * (the one the camera follows): the gap to the first is their difference, in time when the race has time gaps,
 * else in distance.
 */
export function leaderboardRows(racers: readonly Racer[], tracks: readonly Pick<Track, 'name' | 'color'>[]): LeaderboardRow[] {
  const ranked = rankRacers(racers)
  const first = ranked[0]
  if (!first) return []
  const timed = ranked.some((r) => r.gapMs !== undefined)
  const gapToFirst = (r: Racer) => (timed ? (r.gapMs ?? 0) - (first.gapMs ?? 0) : (r.gapM ?? 0) - (first.gapM ?? 0))
  let rank = 0
  return ranked.map((racer, i) => {
    const gap = gapToFirst(racer)
    const previous = ranked[i - 1]
    const tied = i > 0 && Math.abs(previous.fraction - racer.fraction) <= SAME_FRACTION && gapToFirst(previous) === gap
    if (!tied) rank = i + 1
    const { name, color } = tracks[racer.index]
    const gapText = timed ? formatTimeGap(gap) : formatDistanceGap(gap)
    return { rank, name, color, gap: rank === 1 ? (racer.finished ? 'Arrivée' : 'Tête') : gapText }
  })
}

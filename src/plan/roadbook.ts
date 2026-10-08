/**
 * Roadbook (« Feuille de route ») of a route, planned or recorded: its steep sections and its key points ordered along
 * it, each with distance, elevation, climb since the start and, when the track has times, the time of passage.
 *
 * - Steep sections: runs of points whose slope (`metricValues(…, 'slope')`, the ±50 m window of the slope colouring)
 *   is at least `STEEP_PERCENT`, uphill or downhill. Runs of the same direction less than `STEEP_MERGE_GAP_M` apart
 *   are merged, runs shorter than `STEEP_MIN_LENGTH_M` dropped; « très raide » when the steepest windowed slope of the
 *   run reaches `VERY_STEEP_PERCENT`.
 * - Key points: start, end, climb tops (`climbsOf`), OSM landmarks near the route (`ROADBOOK_LANDMARKS`), the points of
 *   interest of the film (at the nearest track point) and the start of each steep section. A climb top with a pass or
 *   a summit less than `SAME_PLACE_M` away along the track is that landmark (one row).
 * - D+ since the start: `computeElevationGain` (the rule of the track stats) on the elevations up to the row, so the
 *   last row matches `track.stats.ascentM`.
 *
 * Pure functions (no DOM, no React).
 */
import type { Track } from '../core/types'
import type { FilmPoi } from '../film/model'
import { climbsOf } from '../flyover/climbs'
import type { Climb } from '../flyover/climbs'
import { nearestOnPath, recordedTimeAt, samplePath, trackPathOf } from '../flyover/path'
import type { TrackPath } from '../flyover/path'
import { trackMetricValues } from '../flyover/trackColor'
import { computeElevationGain } from '../import/stats'
import { KIND_BADGES, buildLandmarks } from '../osm/landmarks'
import type { Landmark, LandmarkSettings } from '../osm/landmarks'
import type { OsmFeature } from '../osm/overpass'
import { formatAscent, formatClock, formatDistance, formatDuration, formatNumber } from '../ui/format'

/** A slope at least this steep (%, either direction) is « raide »… */
export const STEEP_PERCENT = 15
/** …and « très raide » from this one. */
export const VERY_STEEP_PERCENT = 25
/** Shortest steep section reported (metres). */
export const STEEP_MIN_LENGTH_M = 100
/** Two steep runs of the same direction closer than this are one section (metres). */
export const STEEP_MERGE_GAP_M = 50
/** A climb top and a pass or summit closer than this along the track are the same place (metres). */
export const SAME_PLACE_M = 300
/** A landmark or point of interest farther than this from the track says how far (metres). */
const OFF_TRACK_NOTE_M = 50

/** Landmarks of the roadbook: what matters on the way (passes, summits, huts, water), close to the route. */
export const ROADBOOK_LANDMARKS: Pick<LandmarkSettings, 'kinds' | 'maxDistanceM'> = {
  kinds: {
    peak: true,
    pass: true,
    hut: true,
    lake: false,
    waterfall: false,
    place: false,
    viewpoint: false,
    glacier: false,
    waterPoint: true,
  },
  maxDistanceM: 200,
}

export type SteepDirection = 'up' | 'down'

export interface SteepSection {
  /** distances along the track (metres, `buildTrackPath` scale) */
  startM: number
  endM: number
  lengthM: number
  direction: SteepDirection
  verySteep: boolean
  /** average gradient of the section (%, positive in both directions) */
  avgPercent: number
  /** steepest windowed gradient of the section (%, positive) */
  maxPercent: number
}

export type RoadbookKind = 'start' | 'end' | 'climbTop' | 'landmark' | 'poi' | 'steep'

export interface RoadbookRow {
  kind: RoadbookKind
  /** « Départ », « Col de Voza », « Montée raide » */
  name: string
  /** short precision: « Col », « cat. 2 · 8,2 km à 6,1 % », « 350 m à 18 % (max 27 %) »; empty when none */
  detail: string
  /** distance along the track (metres) */
  distanceM: number
  /** recorded (or planned) elevation of the track there (metres), undefined without elevation */
  eleM?: number
  /** climb since the start (metres) */
  ascentM: number
  /** time of passage (ms since epoch), undefined when the track has no time */
  timeMs?: number
  /** time since the previous row (seconds), undefined for the first row or without time */
  sincePreviousS?: number
}

export interface Roadbook {
  rows: RoadbookRow[]
  steep: SteepSection[]
  distanceM: number
  ascentM: number
  descentM: number
  /** from the first to the last time of passage (seconds), undefined without time */
  durationS?: number
  /** the times are estimated (`Track.timesEstimated`), shown with « ≈ » */
  timesEstimated: boolean
  /** `Track.utcOffsetMin`: the times are shown on the local clock of the place when known */
  utcOffsetMin?: number
}

// ---------------------------------------------------------------------------
// Steep sections
// ---------------------------------------------------------------------------

/** Slope (%) at each point of the path (segments concatenated like `buildTrackPath`), NaN when unknown. */
function pathSlopes(track: Track): Float64Array {
  const perSegment = trackMetricValues(track, 'slope')
  const out = new Float64Array(perSegment.reduce((n, values) => n + values.length, 0))
  let offset = 0
  for (const values of perSegment) {
    out.set(values, offset)
    offset += values.length
  }
  return out
}

function steepDirection(slopePercent: number): SteepDirection | null {
  if (slopePercent >= STEEP_PERCENT) return 'up'
  if (slopePercent <= -STEEP_PERCENT) return 'down'
  return null
}

interface SteepRun {
  start: number
  end: number
  direction: SteepDirection
}

function toSection(path: TrackPath, slopes: Float64Array, run: SteepRun): SteepSection {
  const startM = path.dist[run.start]
  const endM = path.dist[run.end]
  const lengthM = endM - startM
  let maxPercent = 0
  for (let i = run.start; i <= run.end; i++) {
    if (steepDirection(slopes[i]) === run.direction) maxPercent = Math.max(maxPercent, Math.abs(slopes[i]))
  }
  const rise = Math.abs(path.ele[run.end] - path.ele[run.start])
  return {
    startM,
    endM,
    lengthM,
    direction: run.direction,
    verySteep: maxPercent >= VERY_STEEP_PERCENT,
    avgPercent: lengthM > 0 ? (rise / lengthM) * 100 : 0,
    maxPercent,
  }
}

/** Steep sections of a track, uphill and downhill, in order along it; empty without elevation. */
export function steepSections(track: Track): SteepSection[] {
  const path = trackPathOf(track)
  const slopes = pathSlopes(track)
  const sections: SteepSection[] = []
  let run: SteepRun | null = null
  const close = (r: SteepRun | null) => {
    if (!r) return
    const section = toSection(path, slopes, r)
    if (section.lengthM >= STEEP_MIN_LENGTH_M) sections.push(section)
  }
  for (let i = 0; i < slopes.length; i++) {
    const direction = steepDirection(slopes[i])
    if (!direction) continue
    // consecutive steep points always join, whatever their spacing
    if (run && run.direction === direction && (run.end === i - 1 || path.dist[i] - path.dist[run.end] < STEEP_MERGE_GAP_M)) {
      run.end = i
      continue
    }
    close(run)
    run = { start: i, end: i, direction }
  }
  close(run)
  return sections
}

// ---------------------------------------------------------------------------
// Key points
// ---------------------------------------------------------------------------

/** OSM landmarks of the roadbook among the corridor features of a track, ordered along it (no cap). */
export function roadbookLandmarks(features: readonly OsmFeature[], track: Track): Landmark[] {
  return buildLandmarks(features, trackPathOf(track), ROADBOOK_LANDMARKS, Infinity)
}

/** Climb since the start up to `distanceM` (the rule of the track stats, per segment). */
function ascentUpTo(track: Track, path: TrackPath, distanceM: number): number {
  let ascent = 0
  let i = 0
  for (const segment of track.segments) {
    const elevations: number[] = []
    for (const p of segment.points) {
      if (path.dist[i] <= distanceM && p.ele !== undefined && Number.isFinite(p.ele)) elevations.push(p.ele)
      i++
    }
    ascent += computeElevationGain(elevations).ascentM
  }
  return ascent
}

function offTrackNote(offM: number): string {
  return offM >= OFF_TRACK_NOTE_M ? ` · à ${formatDistance(offM)} de la trace` : ''
}

function climbDetail(climb: Climb): string {
  const category = climb.category === null ? '' : climb.category === 'HC' ? 'HC · ' : `cat. ${climb.category} · `
  return `${category}${formatDistance(climb.lengthM)} à ${formatNumber(climb.avgGradient * 100, 1)} %`
}

function steepName(section: SteepSection): string {
  return `${section.direction === 'up' ? 'Montée' : 'Descente'} ${section.verySteep ? 'très raide' : 'raide'}`
}

function steepDetail(section: SteepSection): string {
  return `${formatDistance(section.lengthM)} à ${formatNumber(section.avgPercent)} % (max ${formatNumber(section.maxPercent)} %)`
}

type RowPlace = Pick<RoadbookRow, 'kind' | 'name' | 'detail' | 'distanceM'>

/** Where the rows go, before elevation and time: one per key point, a climb top merged into its pass or summit. */
function keyPlaces(
  track: Track,
  path: TrackPath,
  landmarks: readonly Landmark[],
  pois: readonly FilmPoi[],
  steep: readonly SteepSection[],
): RowPlace[] {
  const places: RowPlace[] = [
    { kind: 'start', name: 'Départ', detail: '', distanceM: 0 },
    { kind: 'end', name: 'Arrivée', detail: '', distanceM: path.lengthM },
  ]
  const landmarkRows: { landmark: Landmark; row: RowPlace }[] = landmarks.map((landmark) => {
    const detail = KIND_BADGES[landmark.kind] + offTrackNote(landmark.distanceM)
    return { landmark, row: { kind: 'landmark', name: landmark.name, detail, distanceM: landmark.alongM } }
  })
  const isTopOf = (landmark: Landmark, climb: Climb) =>
    (landmark.kind === 'pass' || landmark.kind === 'peak') && Math.abs(landmark.alongM - climb.endDistM) < SAME_PLACE_M
  climbsOf(track).forEach((climb, i) => {
    const same = landmarkRows.find(({ landmark }) => isTopOf(landmark, climb))
    const name = `Sommet de la montée ${i + 1}`
    if (same) same.row.detail += ` · ${name.toLowerCase()}`
    else places.push({ kind: 'climbTop', name, detail: climbDetail(climb), distanceM: climb.endDistM })
  })
  places.push(...landmarkRows.map(({ row }) => row))
  for (const poi of pois) {
    const nearest = nearestOnPath(path, poi)
    if (!nearest) continue
    const name = poi.name.trim() || "Point d'intérêt"
    places.push({ kind: 'poi', name, detail: "Point d'intérêt" + offTrackNote(nearest.offM), distanceM: nearest.distanceM })
  }
  for (const section of steep) {
    places.push({ kind: 'steep', name: steepName(section), detail: steepDetail(section), distanceM: section.startM })
  }
  return places
}

/** Start first and end last at equal distance, the rest in the order it was listed. */
const KIND_ORDER: Readonly<Record<RoadbookKind, number>> = { start: 0, climbTop: 1, landmark: 1, poi: 1, steep: 1, end: 2 }

/**
 * Roadbook of a track: its steep sections and its key points ordered along it. `landmarks`: OSM landmarks of the track
 * (`roadbookLandmarks`), `pois`: the points of interest of the film.
 */
export function buildRoadbook(track: Track, landmarks: readonly Landmark[], pois: readonly FilmPoi[]): Roadbook {
  const path = trackPathOf(track)
  const steep = steepSections(track)
  const hasTimes = path.time.some((t) => !Number.isNaN(t))
  const places = keyPlaces(track, path, landmarks, pois, steep).sort(
    (a, b) => a.distanceM - b.distanceM || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
  )
  const rows: RoadbookRow[] = []
  for (const place of places) {
    const row: RoadbookRow = { ...place, ascentM: ascentUpTo(track, path, place.distanceM) }
    const ele = samplePath(path, place.distanceM).ele
    if (ele !== undefined) row.eleM = ele
    const timeMs = hasTimes ? recordedTimeAt(path, place.distanceM) : undefined
    if (timeMs !== undefined) {
      row.timeMs = timeMs
      const previous = rows[rows.length - 1]?.timeMs
      if (previous !== undefined) row.sincePreviousS = (timeMs - previous) / 1000
    }
    rows.push(row)
  }
  const roadbook: Roadbook = {
    rows,
    steep,
    distanceM: track.stats.distanceM,
    ascentM: track.stats.ascentM,
    descentM: track.stats.descentM,
    timesEstimated: track.timesEstimated === true,
  }
  const first = rows[0]?.timeMs
  const last = rows[rows.length - 1]?.timeMs
  if (first !== undefined && last !== undefined) roadbook.durationS = (last - first) / 1000
  if (track.utcOffsetMin !== undefined) roadbook.utcOffsetMin = track.utcOffsetMin
  return roadbook
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Instant -> « 14 h 32 » on the local clock of the place when `utcOffsetMin` is known, else in the browser time zone. */
export function formatPlaceClock(ms: number, utcOffsetMin?: number): string {
  if (utcOffsetMin === undefined) return formatClock(ms)
  const date = new Date(ms + utcOffsetMin * 60_000)
  return `${date.getUTCHours()} h ${String(date.getUTCMinutes()).padStart(2, '0')}`
}

/** « 14 h 32 », « ≈ 14 h 32 » when estimated, empty without time. */
export function passageText(roadbook: Roadbook, row: RoadbookRow): string {
  if (row.timeMs === undefined) return ''
  return `${roadbook.timesEstimated ? '≈ ' : ''}${formatPlaceClock(row.timeMs, roadbook.utcOffsetMin)}`
}

/** « 12,4 km · D+ 980 m · D− 950 m · ≈ 4 h 12 » (duration omitted without time). */
export function roadbookSummary(roadbook: Roadbook): string {
  const parts = [
    formatDistance(roadbook.distanceM),
    `D+ ${formatAscent(roadbook.ascentM)}`,
    `D− ${formatAscent(roadbook.descentM)}`,
  ]
  if (roadbook.durationS !== undefined) parts.push(`${roadbook.timesEstimated ? '≈ ' : ''}${formatDuration(roadbook.durationS)}`)
  return parts.join(' · ')
}

/** « Plus longue pente raide : montée de 450 m à 18 % (max 27 %), au km 3,2 », null when there is none. */
export function longestSteepText(roadbook: Roadbook): string | null {
  if (roadbook.steep.length === 0) return null
  const longest = roadbook.steep.reduce((a, b) => (b.lengthM > a.lengthM ? b : a))
  const what = longest.direction === 'up' ? 'montée' : 'descente'
  return `Plus longue pente raide : ${what} de ${steepDetail(longest)}, au km ${formatNumber(longest.startM / 1000, 1)}`
}

/** One line of the plain text: « km 3,2 · Col de Voza (Col) · 1 653 m · D+ 620 m · ≈ 9 h 45 (+1 h 45) ». */
function rowText(roadbook: Roadbook, row: RoadbookRow): string {
  const parts = [`km ${formatNumber(row.distanceM / 1000, 1)}`, row.detail ? `${row.name} (${row.detail})` : row.name]
  if (row.eleM !== undefined) parts.push(`${formatNumber(row.eleM)} m`)
  parts.push(`D+ ${formatAscent(row.ascentM)}`)
  const passage = passageText(roadbook, row)
  if (passage) parts.push(row.sincePreviousS === undefined ? passage : `${passage} (+${formatDuration(row.sincePreviousS)})`)
  return parts.join(' · ')
}

/** The roadbook as plain text (clipboard, .txt): title, summary, longest steep section, one line per row. */
export function roadbookText(roadbook: Roadbook, title: string): string {
  const lines = [`Feuille de route : ${title}`, roadbookSummary(roadbook)]
  const steep = longestSteepText(roadbook)
  if (steep) lines.push(steep)
  if (roadbook.timesEstimated) lines.push('Heures estimées.')
  lines.push('', ...roadbook.rows.map((row) => rowText(roadbook, row)))
  return `${lines.join('\n')}\n`
}

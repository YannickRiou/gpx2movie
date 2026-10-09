/**
 * OpenStreetMap landmarks along a track: pure post-processing of the features returned by `overpass.ts`.
 *
 * 1. Each feature is projected on the track: distance to the nearest point of the polyline and position
 *    along it (same distance scale as `buildTrackPath`, so `alongM / lengthM` is a playback progress).
 * 2. Kinds switched off and features farther than `maxDistanceM` are dropped.
 * 3. Duplicates (same name, accents and case ignored, within `DEDUPE_RADIUS_M`) keep the most important.
 * 4. Priority (`landmarkPriority`): passes crossed by the track first, then peaks by elevation (a proxy
 *    for prominence) and closeness, passes nearby, huts, lakes, waterfalls / viewpoints / glaciers, water points, places.
 *    Range [0, 50), below the GPX waypoints and the climbs of the 3D labels.
 * 5. At most `maxCount` landmarks are kept (highest priorities), returned ordered along the track.
 *
 * No React, no DOM, no network.
 */
import type { TrackPath } from '../flyover/path'
import type { LandmarkKind as LabelKind, LandmarkLabel } from '../scene/labelModel'
import { formatNumber } from '../ui/format'
import { MAX_LANDMARK_DISTANCE_M, M_PER_DEG, planarDistanceM, type OsmFeature, type OsmKind } from './overpass'

export interface LandmarkSettings {
  enabled: boolean
  kinds: Record<OsmKind, boolean>
  /** largest distance between a landmark and the track (metres) */
  maxDistanceM: number
}

export const DEFAULT_LANDMARK_SETTINGS: LandmarkSettings = {
  enabled: true,
  kinds: {
    peak: true,
    pass: true,
    hut: true,
    lake: true,
    waterfall: false,
    place: false,
    viewpoint: false,
    glacier: false,
    waterPoint: false,
  },
  maxDistanceM: 1500,
}

/** The settings of an older project with the kinds added since set to their default (« Points d'eau »). */
export function withLandmarkDefaults(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw
  const settings = raw as { kinds?: unknown }
  if (settings.kinds === null || typeof settings.kinds !== 'object') return raw
  return { ...settings, kinds: { ...DEFAULT_LANDMARK_SETTINGS.kinds, ...settings.kinds } }
}

/** Allowed `maxDistanceM` (metres); the upper bound is what one query covers. */
export const LANDMARK_DISTANCE_RANGE = { min: 100, max: MAX_LANDMARK_DISTANCE_M, step: 100 } as const

export const KIND_LABELS: Readonly<Record<OsmKind, string>> = {
  peak: 'Sommets',
  pass: 'Cols',
  hut: 'Refuges',
  lake: 'Lacs',
  waterfall: 'Cascades',
  place: 'Villages et hameaux',
  viewpoint: 'Points de vue',
  glacier: 'Glaciers',
  waterPoint: "Points d'eau",
}

/** Name of one landmark of each kind (badge of the lists). */
export const KIND_BADGES: Readonly<Record<OsmKind, string>> = {
  peak: 'Sommet',
  pass: 'Col',
  hut: 'Refuge',
  lake: 'Lac',
  waterfall: 'Cascade',
  place: 'Lieu',
  viewpoint: 'Vue',
  glacier: 'Glacier',
  waterPoint: 'Eau',
}

/** Most landmarks kept per track (the scene stays readable). */
export const MAX_LANDMARKS = 40
/** Two features with the same name closer than this are one landmark (metres). */
export const DEDUPE_RADIUS_M = 1000
/** A pass closer than this to the track is crossed by it (metres). */
export const CROSSED_PASS_M = 150

export interface Landmark {
  /** OSM id ("node/123") */
  id: string
  kind: OsmKind
  name: string
  lon: number
  lat: number
  /** elevation from the OSM `ele` tag (metres), undefined when absent or unreadable */
  ele?: number
  /** distance to the track (metres) */
  distanceM: number
  /** position of the nearest point of the track, from its start (metres) */
  alongM: number
  priority: number
  /** French label: « Col de Voza · 1 653 m », « Refuge du Nid d'Aigle » */
  text: string
}

// ---------------------------------------------------------------------------
// Elevation
// ---------------------------------------------------------------------------

/**
 * Metres from an OSM `ele` value: "1653", "4808.73", "1 653 m", "1653m", "1,653", "1653,5", "5400 ft".
 * Undefined when unreadable or outside [-500, 9000] m.
 */
export function parseEle(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  let text = raw.trim().toLowerCase()
  let factor = 1
  if (/(ft|feet|foot|')$/.test(text)) {
    factor = 0.3048
    text = text.replace(/(ft|feet|foot|')$/, '')
  }
  text = text.replace(/m$/, '').replace(/[\s  ]/g, '')
  if (/^-?\d{1,3}(,\d{3})+$/.test(text)) text = text.replace(/,/g, '')
  else text = text.replace(',', '.')
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined
  const metres = Number(text) * factor
  return metres >= -500 && metres <= 9000 ? metres : undefined
}

// ---------------------------------------------------------------------------
// Projection on the track
// ---------------------------------------------------------------------------

/** Distance (metres) from (lon, lat) to the path, and position along it of the nearest point. */
export function projectOnPath(path: TrackPath, lon: number, lat: number): { distanceM: number; alongM: number } {
  if (path.count === 0) return { distanceM: Infinity, alongM: 0 }
  const k = Math.cos((lat * Math.PI) / 180) * M_PER_DEG
  const x = (i: number) => (path.lon[i] - lon) * k
  const y = (i: number) => (path.lat[i] - lat) * M_PER_DEG
  let best = Math.hypot(x(0), y(0))
  let along = 0
  for (let i = 1; i < path.count; i++) {
    const ax = x(i - 1)
    const ay = y(i - 1)
    const dx = x(i) - ax
    const dy = y(i) - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0
    const d = Math.hypot(ax + t * dx, ay + t * dy)
    if (d < best) {
      best = d
      along = path.dist[i - 1] + t * (path.dist[i] - path.dist[i - 1])
    }
  }
  return { distanceM: best, alongM: along }
}

// ---------------------------------------------------------------------------
// Priority and text
// ---------------------------------------------------------------------------

const PLACE_RANK: Readonly<Record<string, number>> = { town: 6, village: 3, hamlet: 0 }

/**
 * Importance in [0, 50): a base per kind, plus elevation for summits and passes, minus up to 8 points
 * with the distance to the track (at 3 km).
 */
export function landmarkPriority(kind: OsmKind, ele: number | undefined, distanceM: number, detail?: string): number {
  const far = Math.min(8, distanceM / 375)
  const high = ele === undefined ? 0 : Math.min(8, Math.max(0, ele / 1000) * 1.6)
  let p: number
  switch (kind) {
    case 'pass':
      p = distanceM <= CROSSED_PASS_M ? 40 + high : 24 + high - far
      break
    case 'peak':
      p = 28 + high - far
      break
    case 'hut':
      p = 22 - far
      break
    case 'lake':
      p = 18 - far
      break
    case 'glacier':
    case 'waterfall':
    case 'viewpoint':
      p = 14 - far
      break
    case 'place':
      p = 6 + (PLACE_RANK[detail ?? ''] ?? 0) - far
      break
    case 'waterPoint':
      p = 10 - far
      break
  }
  return Math.min(49.9, Math.max(0, p))
}

/** « Col de Voza · 1 653 m » for summits and passes with an elevation, the name alone otherwise. */
export function landmarkText(kind: OsmKind, name: string, ele: number | undefined): string {
  if ((kind === 'peak' || kind === 'pass') && ele !== undefined) return `${name} · ${formatNumber(ele)} m`
  return name
}

function normaliseName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/** Landmarks of one track from its OSM features, filtered, deduplicated, capped and ordered along it. */
export function buildLandmarks(
  features: readonly OsmFeature[],
  path: TrackPath,
  settings: Pick<LandmarkSettings, 'kinds' | 'maxDistanceM'>,
  maxCount = MAX_LANDMARKS,
): Landmark[] {
  const candidates: Landmark[] = []
  for (const f of features) {
    if (!settings.kinds[f.kind]) continue
    const { distanceM, alongM } = projectOnPath(path, f.lon, f.lat)
    if (!(distanceM <= settings.maxDistanceM)) continue
    const ele = parseEle(f.ele)
    const landmark: Landmark = {
      id: f.id,
      kind: f.kind,
      name: f.name,
      lon: f.lon,
      lat: f.lat,
      distanceM,
      alongM,
      priority: landmarkPriority(f.kind, ele, distanceM, f.detail),
      text: landmarkText(f.kind, f.name, ele),
    }
    if (ele !== undefined) landmark.ele = ele
    candidates.push(landmark)
  }

  // most important first, so a duplicate is always the less important one; ties: with elevation, closer
  candidates.sort(
    (a, b) =>
      b.priority - a.priority ||
      Number(b.ele !== undefined) - Number(a.ele !== undefined) ||
      a.distanceM - b.distanceM ||
      (a.id < b.id ? -1 : 1),
  )
  const kept: Landmark[] = []
  const names: string[] = []
  for (const c of candidates) {
    const name = normaliseName(c.name)
    if (kept.some((k, i) => names[i] === name && planarDistanceM(k, c) < DEDUPE_RADIUS_M)) continue
    kept.push(c)
    names.push(name)
    if (kept.length >= maxCount) break
  }
  return kept.sort((a, b) => a.alongM - b.alongM || b.priority - a.priority)
}

// ---------------------------------------------------------------------------
// 3D labels
// ---------------------------------------------------------------------------

const LABEL_KINDS: Readonly<Record<OsmKind, LabelKind>> = {
  peak: 'peak',
  pass: 'pass',
  hut: 'hut',
  lake: 'water',
  waterfall: 'water',
  place: 'place',
  viewpoint: 'other',
  glacier: 'other',
  waterPoint: 'water',
}

/** Labels of the landmarks of every track: one per OSM element (highest priority kept), at most `maxCount`. */
export function landmarkLabels(perTrack: readonly (readonly Landmark[])[], maxCount = MAX_LANDMARKS): LandmarkLabel[] {
  const byId = new Map<string, Landmark>()
  for (const list of perTrack) {
    for (const l of list) {
      const seen = byId.get(l.id)
      if (!seen || l.priority > seen.priority) byId.set(l.id, l)
    }
  }
  return [...byId.values()]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxCount)
    .map((l) => {
      const label: LandmarkLabel = {
        id: `osm:${l.id}`,
        lon: l.lon,
        lat: l.lat,
        text: l.text,
        kind: LABEL_KINDS[l.kind],
        priority: l.priority,
      }
      if (l.ele !== undefined) label.ele = l.ele
      return label
    })
}

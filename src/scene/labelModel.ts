/**
 * Label model shared by every source of 3D labels on the relief (climbs, GPX waypoints, points of interest placed
 * by hand, external sources registered in `labelSources.ts`), and the pure screen-space rules used by `Labels.tsx`.
 *
 * No React, no renderer: everything here is unit-tested.
 */
import type { Track } from '../core/types'
import type { FilmPoi, PoiIcon } from '../film/model'
import type { Climb, ClimbCategory } from '../flyover/climbs'
import { samplePath, trackPathOf } from '../flyover/path'
import { formatNumber } from '../ui/format'

/** 'poi': a point of interest placed by hand (drawn with a pin instead of the stripe); 'km': a kilometre marker. */
export type LandmarkKind = 'climb' | 'waypoint' | 'peak' | 'pass' | 'hut' | 'water' | 'place' | 'other' | 'poi' | 'km'

export interface LandmarkLabel {
  /** unique across every source (prefix it with the source id) */
  id: string
  lon: number
  lat: number
  /** recorded elevation (metres), used until the terrain under the label is loaded */
  ele?: number
  text: string
  kind: LandmarkKind
  /** when labels collide on screen, the highest priority is shown */
  priority: number
  /** pictogram of a point of interest (kind 'poi') */
  icon?: PoiIcon
}

/**
 * Accent of each kind (stripe on the label panel and anchor dot), from the « Carte alpine » tokens of
 * src/ui/theme.css that read on the ink panel.
 */
export const LABEL_KIND_ACCENTS: Readonly<Record<LandmarkKind, string>> = {
  climb: '#FF8A5C', // --color-accent-light
  pass: '#FF8A5C', // --color-accent-light
  peak: '#FFFFFF', // --color-white
  waypoint: '#A9CCD9', // --color-glacier
  water: '#A9CCD9', // --color-glacier
  hut: '#EAE4D6', // --color-card
  place: '#D6CDBB', // --color-line
  other: '#D6CDBB', // --color-line
  poi: '#FF8A5C', // --color-accent-light
  km: '#EAE4D6', // --color-card
}
export const LABEL_PANEL_COLOR = '#1C2A33' // --color-ink
export const LABEL_TEXT_COLOR = '#FFFFFF' // --color-white

/** Priority of waypoint labels; climbs come above them, hardest first (`climbPriority`). */
export const WAYPOINT_PRIORITY = 50
/** Kilometre markers give way to every named label. */
export const KM_PRIORITY = 20
/** Spacing of the kilometre markers (km) the user can pick; 0 = none. */
export const KM_MARKER_STEPS = [0, 1, 2, 5, 10] as const
/** Points of interest placed by hand come above every other label: the user named them. */
export const POI_PRIORITY = 200
const CATEGORY_RANK: Readonly<Record<ClimbCategory, number>> = { '4': 1, '3': 2, '2': 3, '1': 4, HC: 5 }

export function climbPriority(category: ClimbCategory | null): number {
  return 100 + (category ? CATEGORY_RANK[category] * 10 : 0)
}

/** « Montée 2 · cat. 3 · 1 653 m » (no category below catégorie 4); `index` starts at 0. */
export function climbLabelText(climb: Climb, index: number): string {
  const parts = [`Montée ${index + 1}`]
  if (climb.category) parts.push(climb.category === 'HC' ? 'HC' : `cat. ${climb.category}`)
  parts.push(`${formatNumber(climb.topEleM)} m`)
  return parts.join(' · ')
}

/** One label at the top of each climb of `track`. */
export function climbLabels(track: Track, climbs: readonly Climb[]): LandmarkLabel[] {
  return climbs.map((climb, i) => ({
    id: `climb:${track.id}:${i}`,
    lon: climb.top.lon,
    lat: climb.top.lat,
    ele: climb.topEleM,
    text: climbLabelText(climb, i),
    kind: 'climb',
    priority: climbPriority(climb.category),
  }))
}

/** A marker every `stepKm` along `track` (« 5 km », « 10 km »…), none at the start; same distances as the counters. */
export function kmLabels(track: Track, stepKm: number): LandmarkLabel[] {
  if (!(stepKm > 0)) return []
  const path = trackPathOf(track)
  const out: LandmarkLabel[] = []
  for (let km = stepKm; km * 1000 <= path.lengthM; km += stepKm) {
    const at = samplePath(path, km * 1000)
    out.push({ id: `km:${track.id}:${km}`, lon: at.lon, lat: at.lat, ele: at.ele, text: `${km} km`, kind: 'km', priority: KM_PRIORITY })
  }
  return out
}

/** Labels settings of an older project: no kilometre markers, the usual size and range. */
export function withLabelDefaults(raw: unknown): unknown {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? { kmStep: 0, size: 1, rangeKm: LABEL_FADE_END_M / 1000, ...raw } : raw
}

/** Value checks of the labels settings (shape already checked). */
export function isValidLabelSettings(v: { kmStep: number; size: number; rangeKm: number }): boolean {
  const within = (x: number, r: { min: number; max: number }) => x >= r.min && x <= r.max
  return (KM_MARKER_STEPS as readonly number[]).includes(v.kmStep) && within(v.size, LABEL_SIZE_RANGE) && within(v.rangeKm, LABEL_RANGE_KM)
}

/** One label per GPX waypoint of every track. */
export function waypointLabels(tracks: readonly Track[]): LandmarkLabel[] {
  const out: LandmarkLabel[] = []
  for (const track of tracks) {
    track.waypoints?.forEach((w, i) => {
      const label: LandmarkLabel = {
        id: `wpt:${track.id}:${i}`,
        lon: w.lon,
        lat: w.lat,
        text: w.name,
        kind: 'waypoint',
        priority: WAYPOINT_PRIORITY,
      }
      if (w.ele !== undefined) label.ele = w.ele
      out.push(label)
    })
  }
  return out
}

/** One label per point of interest placed by hand, except those whose name is blank. */
export function poiLabels(pois: readonly FilmPoi[]): LandmarkLabel[] {
  return pois
    .filter((poi) => poi.name.trim() !== '')
    .map((poi) => ({ id: `poi:${poi.id}`, lon: poi.lon, lat: poi.lat, text: poi.name.trim(), kind: 'poi', priority: POI_PRIORITY, icon: poi.icon }))
}

// ---------------------------------------------------------------------------
// Screen-space rules
// ---------------------------------------------------------------------------

/** Labels are fully opaque up to this camera distance (metres)… */
export const LABEL_FADE_START_M = 35_000
/** …and gone beyond this one (the default « Portée »: half of it fully opaque, see `distanceFade`). */
export const LABEL_FADE_END_M = 70_000
/** Common size (multiplier) and range (km, where they are gone) of every label, « Étiquettes dans la vue ». */
export const LABEL_SIZE_RANGE = { min: 0.6, max: 1.6, step: 0.1 } as const
export const LABEL_RANGE_KM = { min: 10, max: 150, step: 5 } as const
/** A label whose line of sight passes this far below the relief is hidden; as far above, fully shown (metres). */
export const LABEL_OCCLUSION_SOFTNESS_M = 20

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Opacity factor of a label at `distanceM` from the camera: opaque up to half of `endM`, gone beyond it. */
export function distanceFade(distanceM: number, endM = LABEL_FADE_END_M): number {
  return 1 - smoothstep(endM / 2, endM, distanceM)
}

/** Opacity factor from the smallest clearance (metres) of the line of sight above the relief. */
export function occlusionFade(clearanceM: number): number {
  return smoothstep(-LABEL_OCCLUSION_SOFTNESS_M, LABEL_OCCLUSION_SOFTNESS_M, clearanceM)
}

/**
 * Final opacity of a label: its view opacity (distance, occlusion) times what the film overlay's opening or
 * closing card leaves (`cardOpacity` in [0, 1], see `cardOpacityAt`), so labels fade out under a card and back.
 */
export function labelOpacity(viewOpacity: number, cardOpacity: number): number {
  return viewOpacity * (1 - Math.min(1, Math.max(0, cardOpacity)))
}

/**
 * Sprite scale (sizeAttenuation off) that makes `px` CSS pixels on screen: three draws such a sprite
 * `scale × projection[5] × viewportHeight / 2` pixels tall (and wide, per unit of scale).
 */
export function spriteScaleForPixels(px: number, viewportHeightPx: number, projectionYY: number): number {
  return (2 * px) / (viewportHeightPx * projectionYY)
}

/** Clearance of a point above the relief (metres), undefined where the terrain is unknown. */
export type ClearanceAt = (x: number, y: number, z: number) => number | undefined

/** Samples along the line of sight, and how close to the label (metres) the relief is ignored. */
export const LINE_OF_SIGHT_SAMPLES = 24
export const LINE_OF_SIGHT_SKIP_END_M = 150

/**
 * Smallest clearance above the relief of the segment camera → anchor (Infinity when nothing is known),
 * ignoring the last `LINE_OF_SIGHT_SKIP_END_M` so the slope under the label does not hide it.
 */
export function lineOfSightClearance(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  clearanceAt: ClearanceAt,
  samples = LINE_OF_SIGHT_SAMPLES,
): number {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const length = Math.hypot(dx, dy, dz)
  if (length === 0) return Infinity
  const tMax = 1 - Math.min(0.5, LINE_OF_SIGHT_SKIP_END_M / length)
  let min = Infinity
  for (let i = 1; i <= samples; i++) {
    const t = (i / samples) * tMax
    const c = clearanceAt(from.x + dx * t, from.y + dy * t, from.z + dz * t)
    if (c !== undefined && c < min) min = c
  }
  return min
}

export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Greedy de-cluttering: visit the candidates by decreasing priority (stable for ties) and keep each one
 * whose rectangle does not intersect an already kept one. Returns one flag per candidate.
 */
export function resolveOverlaps(candidates: readonly { rect: ScreenRect; priority: number }[]): boolean[] {
  const order = candidates.map((_, i) => i).sort((a, b) => candidates[b].priority - candidates[a].priority || a - b)
  const kept: ScreenRect[] = []
  const visible = new Array<boolean>(candidates.length).fill(false)
  for (const i of order) {
    const r = candidates[i].rect
    if (kept.some((k) => r.left < k.right && r.right > k.left && r.top < k.bottom && r.bottom > k.top)) continue
    kept.push(r)
    visible[i] = true
  }
  return visible
}

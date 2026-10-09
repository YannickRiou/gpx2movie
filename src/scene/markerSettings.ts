/**
 * Look of the tracks and of the progress markers (« Trace et marqueur », Survol tab): settings types, defaults
 * (the look before these settings existed), ranges, French labels, and the checks and upgrades used by the
 * project document. Pure: no Three.js, no DOM, so the store and the interface can import it cheaply.
 */
import { inRange, oneOf, withDefaults } from '../core/guards'

// ---------------------------------------------------------------------------
// Track style
// ---------------------------------------------------------------------------

export const TRACK_DASHES = ['plein', 'tirets', 'points'] as const
export type TrackDash = (typeof TRACK_DASHES)[number]

export interface TrackStyle {
  /** line width in pixels of a 1080-pixel frame (times the export render scale, like the labels) */
  width: number
  dash: TrackDash
  /** soft halo of the track colour around the line */
  glow: boolean
  /** « trace qui se dessine »: only the part already travelled by the marker is drawn */
  drawOn: boolean
}

export const TRACK_WIDTH_RANGE = { min: 1, max: 12, step: 0.5 } as const

export const DEFAULT_TRACK_STYLE: TrackStyle = { width: 4, dash: 'plein', glow: false, drawOn: false }

export const TRACK_DASH_LABELS: Record<TrackDash, string> = { plein: 'Plein', tirets: 'Tirets', points: 'Points' }

// ---------------------------------------------------------------------------
// Marker
// ---------------------------------------------------------------------------

export const MARKER_KINDS = ['boule', 'figurine', 'image'] as const
export type MarkerKind = (typeof MARKER_KINDS)[number]

export const MARKER_FIGURES = ['randonneur', 'alpiniste', 'coureur', 'cycliste', 'bikepacking', 'vtt', 'skieur', 'parapente', 'moto', 'voiture', 'avion'] as const
export type MarkerFigure = (typeof MARKER_FIGURES)[number]

export interface MarkerSettings {
  kind: MarkerKind
  /** pictogram of a 'figurine' marker */
  figure: MarkerFigure
  /** picture of an 'image' marker: small square PNG data URL, '' = none (the marker is then a ball) */
  image: string
  /** multiplier of the on-screen size (1 = the ball of a 1000-pixel frame, about 14 pixels across) */
  size: number
  /** a 'figurine' marker bounces and sways with the film time (`figureMotion`) */
  animated: boolean
}

export const MARKER_SIZE_RANGE = { min: 0.5, max: 3, step: 0.25 } as const

/** Bound on the stored picture: a 128-pixel PNG is far below, a pasted photo is not. */
export const MARKER_IMAGE_MAX_CHARS = 300_000

export const DEFAULT_MARKER: MarkerSettings = { kind: 'boule', figure: 'randonneur', image: '', size: 1, animated: false }

/** Steps of an animated figure per second of film, height of its bounce (fraction of the badge) and sway (radians). */
const FIGURE_STEPS_PER_S = 2
const FIGURE_LIFT = 0.08
const FIGURE_SWAY_RAD = (5 * Math.PI) / 180

/**
 * Bounce and sway of an animated figure at film time `timeS`: a function of the time alone, so a paused film keeps
 * its pose and every export frame is the same as the preview. `lift` in [0, FIGURE_LIFT], one bounce per step.
 */
export function figureMotion(timeS: number): { lift: number; tilt: number } {
  const phase = Math.PI * FIGURE_STEPS_PER_S * timeS
  return { lift: FIGURE_LIFT * Math.abs(Math.sin(phase)), tilt: FIGURE_SWAY_RAD * Math.sin(phase) }
}

export const MARKER_KIND_LABELS: Record<MarkerKind, string> = { boule: 'Boule', figurine: 'Figurine', image: 'Image' }

export const MARKER_FIGURE_LABELS: Record<MarkerFigure, string> = {
  randonneur: 'Randonneur',
  alpiniste: 'Alpiniste',
  coureur: 'Coureur',
  cycliste: 'Cycliste',
  bikepacking: 'Bikepacking',
  vtt: 'VTT',
  skieur: 'Skieur',
  parapente: 'Parapente',
  moto: 'Moto',
  voiture: 'Voiture',
  avion: 'Avion léger',
}

// ---------------------------------------------------------------------------
// Project document: value checks (the JSON shape is checked against the defaults) and upgrades
// ---------------------------------------------------------------------------


export function isValidTrackStyle(style: TrackStyle): boolean {
  return inRange(style.width, TRACK_WIDTH_RANGE) && oneOf(TRACK_DASHES, style.dash)
}

export function isValidMarker(marker: MarkerSettings): boolean {
  const image = marker.image === '' || (marker.image.startsWith('data:image/') && marker.image.length <= MARKER_IMAGE_MAX_CHARS)
  return oneOf(MARKER_KINDS, marker.kind) && oneOf(MARKER_FIGURES, marker.figure) && image && inRange(marker.size, MARKER_SIZE_RANGE)
}

export const withTrackStyleDefaults = withDefaults(DEFAULT_TRACK_STYLE)
export const withMarkerDefaults = withDefaults(DEFAULT_MARKER)

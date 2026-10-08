/**
 * Look of the tracks and of the progress markers (« Trace et marqueur », Survol tab): settings types, defaults
 * (the look before these settings existed), ranges, French labels, and the checks and upgrades used by the
 * project document. Pure: no Three.js, no DOM, so the store and the interface can import it cheaply.
 */

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

export const MARKER_FIGURES = ['randonneur', 'coureur', 'cycliste', 'vtt', 'skieur', 'parapente', 'voiture'] as const
export type MarkerFigure = (typeof MARKER_FIGURES)[number]

export interface MarkerSettings {
  kind: MarkerKind
  /** pictogram of a 'figurine' marker */
  figure: MarkerFigure
  /** picture of an 'image' marker: small square PNG data URL, '' = none (the marker is then a ball) */
  image: string
  /** multiplier of the on-screen size (1 = the ball of a 1000-pixel frame, about 14 pixels across) */
  size: number
}

export const MARKER_SIZE_RANGE = { min: 0.5, max: 3, step: 0.25 } as const

/** Bound on the stored picture: a 128-pixel PNG is far below, a pasted photo is not. */
export const MARKER_IMAGE_MAX_CHARS = 300_000

export const DEFAULT_MARKER: MarkerSettings = { kind: 'boule', figure: 'randonneur', image: '', size: 1 }

export const MARKER_KIND_LABELS: Record<MarkerKind, string> = { boule: 'Boule', figurine: 'Figurine', image: 'Image' }

export const MARKER_FIGURE_LABELS: Record<MarkerFigure, string> = {
  randonneur: 'Randonneur',
  coureur: 'Coureur',
  cycliste: 'Cycliste',
  vtt: 'VTT',
  skieur: 'Skieur',
  parapente: 'Parapente',
  voiture: 'Voiture',
}

// ---------------------------------------------------------------------------
// Project document: value checks (the JSON shape is checked against the defaults) and upgrades
// ---------------------------------------------------------------------------

const within = (v: number, range: { min: number; max: number }) => v >= range.min && v <= range.max
const oneOf = (list: readonly string[], v: string) => list.includes(v)

export function isValidTrackStyle(style: TrackStyle): boolean {
  return within(style.width, TRACK_WIDTH_RANGE) && oneOf(TRACK_DASHES, style.dash)
}

export function isValidMarker(marker: MarkerSettings): boolean {
  const image = marker.image === '' || (marker.image.startsWith('data:image/') && marker.image.length <= MARKER_IMAGE_MAX_CHARS)
  return oneOf(MARKER_KINDS, marker.kind) && oneOf(MARKER_FIGURES, marker.figure) && image && within(marker.size, MARKER_SIZE_RANGE)
}

/** Keys of `defaults` missing from `raw` taken from `defaults` (a setting saved before a field was added). */
function withDefaults<T extends object>(defaults: T): (raw: unknown) => unknown {
  return (raw) => (raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? { ...defaults, ...raw } : raw)
}

export const withTrackStyleDefaults = withDefaults(DEFAULT_TRACK_STYLE)
export const withMarkerDefaults = withDefaults(DEFAULT_MARKER)

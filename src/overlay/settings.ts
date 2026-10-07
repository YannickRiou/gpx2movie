/**
 * Film overlay ("habillage") settings: style, widgets and their options. Part of `Settings` (key `overlay`),
 * so they are saved in the project document, undone, and read the same way by the preview and the export.
 *
 * Timings are fractions of the flyover (0 = start, 1 = end) so the cards keep their place at any duration.
 * Pure module (no DOM, no React).
 */

export const OVERLAY_STYLES = ['editorial', 'broadcast', 'app'] as const
export type OverlayStyleId = (typeof OVERLAY_STYLES)[number]

export const OVERLAY_STYLE_LABELS: Record<OverlayStyleId, string> = {
  editorial: 'Éditorial',
  broadcast: 'Diffusion',
  app: 'Application',
}

/** The nine anchors of the safe area. */
export const OVERLAY_ANCHORS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
] as const
export type OverlayAnchor = (typeof OVERLAY_ANCHORS)[number]

export const OVERLAY_ANCHOR_LABELS: Record<OverlayAnchor, string> = {
  'top-left': 'En haut à gauche',
  'top-center': 'En haut au centre',
  'top-right': 'En haut à droite',
  'middle-left': 'Au milieu à gauche',
  center: 'Au centre',
  'middle-right': 'Au milieu à droite',
  'bottom-left': 'En bas à gauche',
  'bottom-center': 'En bas au centre',
  'bottom-right': 'En bas à droite',
}

export const COUNTER_IDS = ['distance', 'altitude', 'ascent', 'time', 'speed', 'heartRate'] as const
export type CounterId = (typeof COUNTER_IDS)[number]

/** Size multiplier of a widget (1 = default size). */
export const WIDGET_SIZE_MIN = 0.5
export const WIDGET_SIZE_MAX = 2
/** Opening card: shown from the start until `end` (fraction of the flyover). */
export const TITLE_END_MIN = 0.03
export const TITLE_END_MAX = 0.3
/** Closing card: shown from `start` to the end. */
export const END_START_MIN = 0.6
export const END_START_MAX = 0.97
/** Elevation profile size, as fractions of the frame width / height. */
export const PROFILE_WIDTH_MIN = 0.1
export const PROFILE_WIDTH_MAX = 0.6
export const PROFILE_HEIGHT_MIN = 0.05
export const PROFILE_HEIGHT_MAX = 0.3
/** Longest side of the logo kept in the settings (pixels). */
export const LOGO_MAX_SIZE_PX = 512

interface Placed {
  enabled: boolean
  anchor: OverlayAnchor
}

interface Sized extends Placed {
  /** multiplier, WIDGET_SIZE_MIN–WIDGET_SIZE_MAX */
  size: number
}

export interface TitleCardSettings extends Sized {
  /** '' = name of the track */
  title: string
  subtitle: string
  /** prefix the subtitle with the date of the track (when it has one) */
  showDate: boolean
  /** end of the card, fraction of the flyover */
  end: number
}

export interface EndCardSettings extends Sized {
  /** '' = name of the track */
  title: string
  /** start of the card, fraction of the flyover */
  start: number
}

export interface CountersSettings extends Sized {
  fields: Record<CounterId, boolean>
}

export interface ProfileSettings extends Placed {
  /** fraction of the frame width */
  width: number
  /** fraction of the frame height */
  height: number
}

export interface LogoSettings extends Sized {
  /** PNG data URL ('' = none), at most LOGO_MAX_SIZE_PX on its longest side: projects stay self-contained */
  image: string
}

export interface TextSettings extends Sized {
  text: string
}

export interface OverlaySettings {
  enabled: boolean
  style: OverlayStyleId
  title: TitleCardSettings
  end: EndCardSettings
  counters: CountersSettings
  profile: ProfileSettings
  logo: LogoSettings
  text: TextSettings
}

export const DEFAULT_OVERLAY: OverlaySettings = {
  enabled: false,
  style: 'editorial',
  title: { enabled: true, anchor: 'center', size: 1, title: '', subtitle: '', showDate: true, end: 0.1 },
  end: { enabled: true, anchor: 'center', size: 1, title: '', start: 0.9 },
  counters: {
    enabled: true,
    anchor: 'top-left',
    size: 1,
    fields: { distance: true, altitude: true, ascent: true, time: true, speed: false, heartRate: false },
  },
  profile: { enabled: true, anchor: 'top-right', width: 0.3, height: 0.12 },
  logo: { enabled: false, anchor: 'bottom-right', size: 1, image: '' },
  text: { enabled: false, anchor: 'bottom-left', size: 1, text: '' },
}

const within = (v: number, min: number, max: number) => v >= min && v <= max
const isAnchor = (v: string) => (OVERLAY_ANCHORS as readonly string[]).includes(v)
const validSized = (w: Sized) => isAnchor(w.anchor) && within(w.size, WIDGET_SIZE_MIN, WIDGET_SIZE_MAX)

/**
 * Value checks of overlay settings whose JSON shape is already known to match `DEFAULT_OVERLAY`
 * (see `SETTING_CHECKS` in the project document): enumerations, ranges, logo format.
 */
export function isValidOverlay(o: OverlaySettings): boolean {
  return (
    (OVERLAY_STYLES as readonly string[]).includes(o.style) &&
    validSized(o.title) &&
    within(o.title.end, TITLE_END_MIN, TITLE_END_MAX) &&
    validSized(o.end) &&
    within(o.end.start, END_START_MIN, END_START_MAX) &&
    validSized(o.counters) &&
    isAnchor(o.profile.anchor) &&
    within(o.profile.width, PROFILE_WIDTH_MIN, PROFILE_WIDTH_MAX) &&
    within(o.profile.height, PROFILE_HEIGHT_MIN, PROFILE_HEIGHT_MAX) &&
    validSized(o.logo) &&
    (o.logo.image === '' || /^data:image\/(png|jpeg|webp);base64,/.test(o.logo.image)) &&
    validSized(o.text)
  )
}

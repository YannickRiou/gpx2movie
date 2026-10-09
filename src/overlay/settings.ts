/**
 * Film overlay ("habillage") settings: style, widgets and their options. Part of `Settings` (key `overlay`),
 * so they are saved in the project document, undone, and read the same way by the preview and the export.
 *
 * Card timings are fractions of the flight (0 = start, 1 = end) so the cards keep their place at any duration;
 * the opening card starts with the film (opening shot included) and the closing card lasts until its end.
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
/** Corners where the source credits can sit (along the edge, outside the safe area). */
export const CREDITS_POSITIONS = ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const
export type CreditsPosition = (typeof CREDITS_POSITIONS)[number]
/** Longest side of the logo kept in the settings (pixels). */
export const LOGO_MAX_SIZE_PX = 512

/** Fonts the user can pick for the titles or the figures: the bundled faces, then a few system families. */
export const OVERLAY_FONT_IDS = ['fraunces', 'plex', 'plex-condensed', 'georgia', 'system', 'mono'] as const
export type OverlayFontId = (typeof OVERLAY_FONT_IDS)[number]

export const OVERLAY_FONT_LABELS: Record<OverlayFontId, string> = {
  fraunces: 'Fraunces',
  plex: 'IBM Plex Sans',
  'plex-condensed': 'IBM Plex Sans Condensed',
  georgia: 'Georgia (système)',
  system: 'Police du système',
  mono: 'Chasse fixe (système)',
}

/**
 * The user's own touches on top of the chosen style; a missing field keeps the style's value.
 * Colours are '#rrggbb' (what `<input type="color">` gives).
 */
export interface OverlayOverrides {
  accent?: string
  text?: string
  /** panel behind the widgets (styles with a panel only) */
  panel?: string
  /** 0–1 */
  panelOpacity?: number
  titleFont?: OverlayFontId
  numberFont?: OverlayFontId
}

interface Placed {
  enabled: boolean
  anchor: OverlayAnchor
  /** this widget's own colours and fonts, on top of the overlay's (`OverlaySettings.overrides`); absent = the same */
  overrides?: OverlayOverrides
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
  /** end of the card, fraction of the flight after the opening shot */
  end: number
}

export interface EndCardSettings extends Sized {
  /** '' = name of the track */
  title: string
  /** start of the card, fraction of the flight (shown until the end of the film, closing shot included) */
  start: number
  /** weather summary line of the outing (when known) */
  showWeather: boolean
  /** « Générique »: one name or line per line, rolling up under the card to the end of the film; absent or blank = none */
  credits?: string
}

/** Longest rolling credits kept (characters). */
export const END_CREDITS_MAX = 2000

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

export interface MiniMapSettings extends Sized {
  /** small north arrow beside the map (north is always up) */
  northArrow: boolean
}

/**
 * Credits of the map, relief, weather and OpenStreetMap sources burned into every frame (their licences require
 * attribution in the published film). Independent of `enabled`: drawn even without the rest of the overlay.
 */
export interface CreditsSettings {
  enabled: boolean
  position: CreditsPosition
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
  /** weather under the marker: condition, temperature, wind (Open-Meteo, when the outing's weather is known) */
  weather: Sized
  /** plan view of the whole track, covered part and marker */
  minimap: MiniMapSettings
  /** ghost race: tracks ranked at the marker, with their gap to the first (2+ tracks, race on) */
  leaderboard: Sized
  credits: CreditsSettings
  /** colours and fonts changed on top of the style; absent = the style as designed */
  overrides?: OverlayOverrides
}

export const DEFAULT_OVERLAY: OverlaySettings = {
  enabled: false,
  style: 'editorial',
  title: { enabled: true, anchor: 'center', size: 1, title: '', subtitle: '', showDate: true, end: 0.1 },
  end: { enabled: true, anchor: 'center', size: 1, title: '', start: 0.9, showWeather: true },
  counters: {
    enabled: true,
    anchor: 'top-left',
    size: 1,
    fields: { distance: true, altitude: true, ascent: true, time: true, speed: false, heartRate: false },
  },
  profile: { enabled: true, anchor: 'top-right', width: 0.3, height: 0.12 },
  logo: { enabled: false, anchor: 'bottom-right', size: 1, image: '' },
  text: { enabled: false, anchor: 'bottom-left', size: 1, text: '' },
  weather: { enabled: false, anchor: 'top-left', size: 1 },
  minimap: { enabled: false, anchor: 'bottom-right', size: 1, northArrow: true },
  leaderboard: { enabled: false, anchor: 'middle-right', size: 1 },
  credits: { enabled: true, position: 'bottom-right' },
}

/** Widgets added after the first saved format: missing from older projects and presets. */
const OVERLAY_ADDED_KEYS: readonly (keyof OverlaySettings)[] = ['minimap', 'credits', 'leaderboard']

/**
 * Raw overlay settings of an older project or preset with the widgets added since filled in with their
 * defaults, so they still load. Applied before the shape check: anything else (other keys, a present but
 * malformed widget) is left as is and still rejected.
 */
export function withOverlayDefaults(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const missing = OVERLAY_ADDED_KEYS.filter((key) => !(key in raw))
  return missing.length === 0 ? raw : { ...Object.fromEntries(missing.map((key) => [key, DEFAULT_OVERLAY[key]])), ...raw }
}

/**
 * Overlay settings with `patch` applied to the overrides (null: back to the style). Unset fields are dropped, and
 * the key itself once nothing is left, so the style as designed equals the defaults again (« modifié » marker).
 */
export function withOverrides(overlay: OverlaySettings, patch: OverlayOverrides | null): OverlaySettings {
  const { overrides, ...rest } = overlay
  const kept = mergeOverrides(overrides, patch)
  return kept ? { ...rest, overrides: kept } : rest
}

/** `overrides` patched (null: none left), fields set to undefined dropped; undefined once nothing is left. */
function mergeOverrides(overrides: OverlayOverrides | undefined, patch: OverlayOverrides | null): OverlayOverrides | undefined {
  const merged = patch === null ? {} : { ...overrides, ...patch }
  const kept: OverlayOverrides = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined))
  return Object.keys(kept).length > 0 ? kept : undefined
}

/** Widgets whose colours and fonts can differ from the rest of the overlay (the logo is an image). */
export const STYLED_WIDGETS = ['title', 'end', 'counters', 'profile', 'weather', 'minimap', 'leaderboard', 'text'] as const
export type StyledWidget = (typeof STYLED_WIDGETS)[number]

/** `overlay` with the overrides of widget `key` patched like `withOverrides` (null: back to the overlay's). */
export function withWidgetOverrides(overlay: OverlaySettings, key: StyledWidget, patch: OverlayOverrides | null): OverlaySettings {
  const { overrides, ...rest } = overlay[key]
  const kept = mergeOverrides(overrides, patch)
  return { ...overlay, [key]: kept ? { ...rest, overrides: kept } : rest }
}

/** Overrides drawn for widget `key`: the overlay's, then the widget's own; undefined when neither has any. */
export function widgetOverrides(overlay: OverlaySettings, key: StyledWidget): OverlayOverrides | undefined {
  const own = overlay[key].overrides
  return own ? { ...overlay.overrides, ...own } : overlay.overrides
}

const within = (v: number, min: number, max: number) => v >= min && v <= max
const isAnchor = (v: string) => (OVERLAY_ANCHORS as readonly string[]).includes(v)
const validSized = (w: Sized) => isAnchor(w.anchor) && within(w.size, WIDGET_SIZE_MIN, WIDGET_SIZE_MAX)

const OVERRIDE_CHECKS: { [K in keyof OverlayOverrides]-?: (v: unknown) => boolean } = {
  accent: isHexColor,
  text: isHexColor,
  panel: isHexColor,
  panelOpacity: (v) => typeof v === 'number' && within(v, 0, 1),
  titleFont: (v) => (OVERLAY_FONT_IDS as readonly unknown[]).includes(v),
  numberFont: (v) => (OVERLAY_FONT_IDS as readonly unknown[]).includes(v),
}

/** '#rrggbb' (either case). */
export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
}

/**
 * Overrides read from a project: absent, or an object of known fields with valid values. Not covered by the
 * shape check of the project document (the key is optional), so everything is checked here.
 */
export function isValidOverrides(o: unknown): boolean {
  if (o === undefined) return true
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false
  return Object.entries(o).every(([key, value]) => Object.hasOwn(OVERRIDE_CHECKS, key) && OVERRIDE_CHECKS[key as keyof OverlayOverrides](value))
}

/**
 * Value checks of overlay settings whose JSON shape is already known to match `DEFAULT_OVERLAY`
 * (see `SETTING_CHECKS` in the project document): enumerations, ranges, logo format, colour and font overrides.
 */
export function isValidOverlay(o: OverlaySettings): boolean {
  return (
    (OVERLAY_STYLES as readonly string[]).includes(o.style) &&
    validSized(o.title) &&
    within(o.title.end, TITLE_END_MIN, TITLE_END_MAX) &&
    validSized(o.end) &&
    within(o.end.start, END_START_MIN, END_START_MAX) &&
    (o.end.credits === undefined || (typeof o.end.credits === 'string' && o.end.credits.length <= END_CREDITS_MAX)) &&
    validSized(o.counters) &&
    isAnchor(o.profile.anchor) &&
    within(o.profile.width, PROFILE_WIDTH_MIN, PROFILE_WIDTH_MAX) &&
    within(o.profile.height, PROFILE_HEIGHT_MIN, PROFILE_HEIGHT_MAX) &&
    validSized(o.logo) &&
    (o.logo.image === '' || /^data:image\/(png|jpeg|webp);base64,/.test(o.logo.image)) &&
    validSized(o.text) &&
    validSized(o.weather) &&
    validSized(o.minimap) &&
    validSized(o.leaderboard) &&
    (CREDITS_POSITIONS as readonly string[]).includes(o.credits.position) &&
    isValidOverrides(o.overrides) &&
    STYLED_WIDGETS.every((key) => isValidOverrides(o[key].overrides))
  )
}

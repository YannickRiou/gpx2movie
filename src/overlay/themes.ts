/**
 * The three overlay styles. They belong to the film, not to the interface: their colours are chosen for
 * legibility over any imagery, from the same family as the charte « Carte alpine » (paper, ink, trail red).
 * Sizes are in overlay units (1 u = 1 % of the shorter side of the frame).
 */
import type { OverlayStyleId } from './settings'

export interface OverlayPanelStyle {
  fill: string
  /** hairline border, none when undefined */
  stroke?: string
  /** corner radius (u) */
  radius: number
  /** drop shadow under the panel */
  shadow?: { color: string; blur: number; offsetY: number }
}

export interface OverlayTheme {
  titleFamily: string
  titleWeight: number
  titleUppercase: boolean
  bodyFamily: string
  numberFamily: string
  numberWeight: number
  labelWeight: number
  labelUppercase: boolean
  /** letter spacing of labels (em) */
  labelTracking: number
  text: string
  textSoft: string
  accent: string
  /** panel behind each widget; none = text on the image with a soft dark scrim and shadow */
  panel: OverlayPanelStyle | null
  /** one panel for all counters (true) or one per counter */
  groupedCounters: boolean
  /** shadow under the text (u), for the styles without panel */
  textShadow?: { color: string; blur: number }
  /** accent bar on the leading edge of panels and cards (u), 0 = none */
  accentBar: number
  profile: { area: string; played: string; line: string; marker: string; markerRing: string }
  /** mini-map: route still ahead, covered part, start and end dots (ringed with `profile.markerRing`) */
  minimap: { route: string; covered: string; start: string; end: string }
  /** source credits: subtle backing and text, legible on snow as on forest */
  credits: { fill: string; text: string }
}

const FRAUNCES = '"Fraunces", Georgia, serif'
const PLEX = '"IBM Plex Sans", system-ui, sans-serif'
const PLEX_CONDENSED = '"IBM Plex Sans Condensed", "IBM Plex Sans", system-ui, sans-serif'

const PAPER = '#F5F2EA'
const INK = '#1C2A33'
const INK_SOFT = '#55626B'
const TRAIL_RED = '#C23B22'
const TRAIL_RED_LIGHT = '#FF8A5C'
const GLACIER = '#A9CCD9'
const MOSS = '#3F6B4A'

export const OVERLAY_THEMES: Record<OverlayStyleId, OverlayTheme> = {
  // light serif titles straight on the image, generous spacing
  editorial: {
    titleFamily: FRAUNCES,
    titleWeight: 300,
    titleUppercase: false,
    bodyFamily: PLEX,
    numberFamily: FRAUNCES,
    numberWeight: 500,
    labelWeight: 500,
    labelUppercase: true,
    labelTracking: 0.16,
    text: '#FFFFFF',
    textSoft: 'rgba(255, 255, 255, 0.86)',
    accent: TRAIL_RED_LIGHT,
    panel: null,
    groupedCounters: true,
    textShadow: { color: 'rgba(0, 0, 0, 0.6)', blur: 0.9 },
    accentBar: 0,
    profile: {
      area: 'rgba(255, 255, 255, 0.28)',
      played: 'rgba(255, 255, 255, 0.7)',
      line: '#FFFFFF',
      marker: TRAIL_RED_LIGHT,
      markerRing: '#FFFFFF',
    },
    minimap: { route: 'rgba(255, 255, 255, 0.5)', covered: TRAIL_RED_LIGHT, start: MOSS, end: '#FFFFFF' },
    credits: { fill: 'rgba(16, 25, 31, 0.6)', text: '#FFFFFF' },
  },
  // dark glass panels, condensed figures, trail-red bar
  broadcast: {
    titleFamily: PLEX_CONDENSED,
    titleWeight: 700,
    titleUppercase: true,
    bodyFamily: PLEX_CONDENSED,
    numberFamily: PLEX_CONDENSED,
    numberWeight: 600,
    labelWeight: 500,
    labelUppercase: true,
    labelTracking: 0.1,
    text: '#FFFFFF',
    textSoft: 'rgba(255, 255, 255, 0.78)',
    accent: TRAIL_RED_LIGHT,
    panel: { fill: 'rgba(16, 25, 31, 0.78)', stroke: 'rgba(255, 255, 255, 0.14)', radius: 0.5 },
    groupedCounters: true,
    accentBar: 0.6,
    profile: {
      area: 'rgba(255, 255, 255, 0.2)',
      played: TRAIL_RED_LIGHT,
      line: '#FFFFFF',
      marker: TRAIL_RED_LIGHT,
      markerRing: '#FFFFFF',
    },
    minimap: { route: 'rgba(255, 255, 255, 0.4)', covered: TRAIL_RED_LIGHT, start: MOSS, end: '#FFFFFF' },
    credits: { fill: 'rgba(16, 25, 31, 0.7)', text: '#FFFFFF' },
  },
  // pale rounded cards, like a navigation app
  app: {
    titleFamily: PLEX,
    titleWeight: 600,
    titleUppercase: false,
    bodyFamily: PLEX,
    numberFamily: PLEX,
    numberWeight: 600,
    labelWeight: 500,
    labelUppercase: false,
    labelTracking: 0,
    text: INK,
    textSoft: INK_SOFT,
    accent: TRAIL_RED,
    panel: {
      fill: 'rgba(245, 242, 234, 0.94)',
      radius: 1.6,
      shadow: { color: 'rgba(0, 0, 0, 0.28)', blur: 1.6, offsetY: 0.3 },
    },
    groupedCounters: false,
    accentBar: 0,
    profile: { area: GLACIER, played: TRAIL_RED, line: INK, marker: TRAIL_RED, markerRing: PAPER },
    minimap: { route: 'rgba(28, 42, 51, 0.35)', covered: TRAIL_RED, start: MOSS, end: INK },
    credits: { fill: 'rgba(245, 242, 234, 0.82)', text: INK },
  },
}

/**
 * Font faces drawn by the overlay. A canvas does not trigger web font downloads by itself: they are
 * requested with `document.fonts.load` before the first frame (see `loadOverlayFonts`).
 */
export const OVERLAY_FONTS: readonly string[] = [
  `300 32px ${FRAUNCES}`,
  `500 32px ${FRAUNCES}`,
  `500 32px ${PLEX}`,
  `600 32px ${PLEX}`,
  `500 32px ${PLEX_CONDENSED}`,
  `600 32px ${PLEX_CONDENSED}`,
  `700 32px ${PLEX_CONDENSED}`,
]

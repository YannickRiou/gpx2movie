/**
 * Poster (« Affiche ») settings: paper format, style, title, subtitle and the key figures shown. Part of `Settings`
 * (key `poster`), so they are saved in the project document and undone like the others; a preset keeps only the
 * style (the title belongs to the project). Pure module (no DOM, no React).
 */
import type { OverlayStyleId } from '../overlay/settings'

/**
 * Paper formats at 300 dpi (A4 2480 × 3508 px, A3 3508 × 4960 px: the long side capped at 4960 px), and a square
 * picture for social networks.
 */
export const POSTER_FORMATS = [
  { id: 'a4-portrait', label: 'A4 portrait', width: 2480, height: 3508 },
  { id: 'a4-landscape', label: 'A4 paysage', width: 3508, height: 2480 },
  { id: 'a3-portrait', label: 'A3 portrait', width: 3508, height: 4960 },
  { id: 'a3-landscape', label: 'A3 paysage', width: 4960, height: 3508 },
  { id: 'square', label: 'Carré (réseaux sociaux)', width: 2160, height: 2160 },
] as const
export type PosterFormatId = (typeof POSTER_FORMATS)[number]['id']

/** The three styles of the film overlay, as posters. */
export const POSTER_STYLES = ['editorial', 'broadcast', 'app'] as const satisfies readonly OverlayStyleId[]
export type PosterStyleId = (typeof POSTER_STYLES)[number]

export const POSTER_FIGURES = ['distance', 'ascent', 'time', 'maxAltitude', 'climbs'] as const
export type PosterFigureId = (typeof POSTER_FIGURES)[number]

export const POSTER_FIGURE_LABELS: Record<PosterFigureId, string> = {
  distance: 'Distance',
  ascent: 'Dénivelé +',
  time: 'Durée',
  maxAltitude: 'Altitude max.',
  climbs: 'Montées',
}

export interface PosterSettings {
  format: PosterFormatId
  style: PosterStyleId
  /** '' = name of the project */
  title: string
  /** line under the title, before the date ('' = date only) */
  subtitle: string
  figures: Record<PosterFigureId, boolean>
  /** weather of the day under the profile (when the outing's weather is known) */
  weather: boolean
  /** « Carte à plat »: the view is a map seen from straight above (imagery tiles), not the 3D overview */
  flat: boolean
}

export const DEFAULT_POSTER: PosterSettings = {
  format: 'a4-portrait',
  style: 'editorial',
  title: '',
  subtitle: '',
  figures: { distance: true, ascent: true, time: true, maxAltitude: true, climbs: true },
  weather: true,
  flat: false,
}

/** Pixel size of a format. */
export function posterSize(format: PosterFormatId): { width: number; height: number } {
  const found = POSTER_FORMATS.find((f) => f.id === format) ?? POSTER_FORMATS[0]
  return { width: found.width, height: found.height }
}

/** Value checks once the JSON shape matches `DEFAULT_POSTER` (`SETTING_CHECKS`): format and style ids. */
export function isValidPoster(p: PosterSettings): boolean {
  return POSTER_FORMATS.some((f) => f.id === p.format) && (POSTER_STYLES as readonly string[]).includes(p.style)
}

/** Fields missing from a poster saved before they were added, taken from `DEFAULT_POSTER` (`SETTING_UPGRADES`). */
export function withPosterDefaults(raw: unknown): unknown {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? { ...DEFAULT_POSTER, ...raw } : raw
}

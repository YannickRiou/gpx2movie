/**
 * Poster layout as pure functions: boxes in pixels for the 3D view, the text panel and each text row, and text
 * fitting (a text is shrunk, then cut with « … », until it fits its box). The box geometry depends only on the size,
 * the style and which rows are present, never on measured text: the size of the 3D view to render is known before
 * the fonts are measured, and the drawing cannot push a row onto its neighbour.
 *
 * Units: 1 u = 1 % of the shorter side. Portrait and square posters stack the view above the text; landscape ones
 * put the text in a column beside the view. Styles: « Éditorial » (paper page, view inset with a margin),
 * « Diffusion » (view full bleed, ink band or column with a trail-red bar), « Application » (view over the whole
 * poster, text on a floating paper card).
 */
import type { PosterStyleId } from './settings'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Rows present on the poster. */
export interface PosterRows {
  subtitle: boolean
  figures: number
  profile: boolean
  weather: boolean
}

export interface PosterFonts {
  title: number
  subtitle: number
  value: number
  label: number
  profile: number
  weather: number
  credits: number
}

export interface PosterLayout {
  width: number
  height: number
  /** 1 % of the shorter side (px) */
  u: number
  /** landscape: text column beside the view */
  side: boolean
  /** where the 3D view goes (whole pixels: its render size) */
  view: Box
  /** backing of the text: ink band or column (Diffusion), paper card (Application); null = the page (Éditorial) */
  panel: Box | null
  /** trail-red bar on the panel's leading edge (Diffusion) */
  accentBar: Box | null
  title: Box
  subtitle: Box | null
  figures: Box[]
  profile: Box | null
  weather: Box | null
  credits: Box
  /** largest font size of each row (px): drawing shrinks a text until it fits */
  fonts: PosterFonts
}

/** Lines of the credits at most (then smaller, then cut). */
export const CREDIT_LINES = 2
/** Above this width / height ratio, the text goes in a column beside the view. */
export const SIDE_RATIO = 1.15

const ELLIPSIS = '…'

/** Heights (u) of the rows and the gaps between them, at scale 1 (portrait). */
const ROW = {
  title: 10,
  afterTitle: 1,
  subtitle: 3.6,
  group: 3.5,
  figure: 9,
  figureGap: 2,
  profile: 12,
  weather: 3,
  credits: CREDIT_LINES * 1.6,
} as const

/** Shares of a figure cell: the value on top, its label under it. */
export const FIGURE_VALUE_SHARE = 0.68

function fontsAt(u: number, s: number): PosterFonts {
  return {
    title: 8 * u * s,
    subtitle: 2.6 * u * s,
    value: 5.4 * u * s,
    label: 1.6 * u * s,
    profile: 1.6 * u * s,
    weather: 2.1 * u * s,
    // the credits keep their size: they must stay legible
    credits: 1.15 * u,
  }
}

interface Stacked {
  title: Box
  subtitle: Box | null
  figures: Box[]
  profile: Box | null
  weather: Box | null
  credits: Box
  height: number
}

/**
 * Text rows from top to bottom in a column at (x, y) of width w. `columns` figure cells per row; `bottom`, when
 * given, pins the credits to that edge (else they follow the other rows).
 */
function stackRows(rows: PosterRows, x: number, y: number, w: number, u: number, s: number, columns: number, bottom?: number): Stacked {
  let cursor = y
  const take = (h: number): Box => {
    const box = { x, y: cursor, w, h }
    cursor += h
    return box
  }
  const title = take(ROW.title * u * s)
  let subtitle: Box | null = null
  if (rows.subtitle) {
    cursor += ROW.afterTitle * u * s
    subtitle = take(ROW.subtitle * u * s)
  }
  const figures: Box[] = []
  if (rows.figures > 0) {
    cursor += ROW.group * u * s
    const perRow = Math.min(columns, rows.figures)
    const gap = ROW.figureGap * u * s
    const cellW = (w - (perRow - 1) * gap) / perRow
    const cellH = ROW.figure * u * s
    const lines = Math.ceil(rows.figures / perRow)
    for (let i = 0; i < rows.figures; i++) {
      const row = Math.floor(i / perRow)
      const col = i % perRow
      figures.push({ x: x + col * (cellW + gap), y: cursor + row * (cellH + gap), w: cellW, h: cellH })
    }
    cursor += lines * cellH + (lines - 1) * gap
  }
  let profile: Box | null = null
  if (rows.profile) {
    cursor += ROW.group * u * s
    profile = take(ROW.profile * u * s)
  }
  let weather: Box | null = null
  if (rows.weather) {
    cursor += ROW.group * u * s * 0.7
    weather = take(ROW.weather * u * s)
  }
  const creditsH = ROW.credits * u
  cursor += ROW.group * u * s * 0.7
  const credits = bottom === undefined ? take(creditsH) : { x, y: Math.max(cursor, bottom - creditsH), w, h: creditsH }
  return { title, subtitle, figures, profile, weather, credits, height: Math.max(cursor, credits.y + creditsH) - y }
}

const rounded = (b: Box): Box => {
  const x = Math.round(b.x)
  const y = Math.round(b.y)
  return { x, y, w: Math.max(1, Math.round(b.x + b.w) - x), h: Math.max(1, Math.round(b.y + b.h) - y) }
}

/** Boxes of a poster of `width` × `height` px in `style` with these rows. */
export function posterLayout(width: number, height: number, style: PosterStyleId, rows: PosterRows): PosterLayout {
  const u = Math.min(width, height) / 100
  const side = width / height > SIDE_RATIO
  // a square poster has less height for the same text: everything a little smaller
  const s = !side && height / width < 1.15 ? 0.7 : 1
  const fonts = fontsAt(u, s)
  const base = { width, height, u, side, fonts }

  if (!side) {
    // measure the text column once (its height does not depend on where it starts)
    const probe = (w: number) => stackRows(rows, 0, 0, w, u, s, Math.max(1, rows.figures)).height
    if (style === 'editorial') {
      const margin = 6 * u
      const gap = 4.5 * u
      const w = width - 2 * margin
      const textH = probe(w)
      const view = rounded({ x: margin, y: margin, w, h: height - 2 * margin - gap - textH })
      const text = stackRows(rows, margin, view.y + view.h + gap, w, u, s, Math.max(1, rows.figures))
      return { ...base, view, panel: null, accentBar: null, ...pick(text) }
    }
    if (style === 'broadcast') {
      const pad = 5 * u
      const inset = 6 * u
      const bar = 0.8 * u
      const w = width - 2 * inset
      const panelH = probe(w) + 2 * pad + bar
      const view = rounded({ x: 0, y: 0, w: width, h: height - panelH })
      const panel = { x: 0, y: view.h, w: width, h: height - view.h }
      const text = stackRows(rows, inset, panel.y + bar + pad, w, u, s, Math.max(1, rows.figures))
      return { ...base, view, panel, accentBar: { x: 0, y: panel.y, w: width, h: bar }, ...pick(text) }
    }
    const margin = 4 * u
    const pad = 4 * u
    const w = width - 2 * margin - 2 * pad
    const cardH = probe(w) + 2 * pad
    const panel = { x: margin, y: height - margin - cardH, w: width - 2 * margin, h: cardH }
    const text = stackRows(rows, margin + pad, panel.y + pad, w, u, s, Math.max(1, rows.figures))
    return { ...base, view: { x: 0, y: 0, w: width, h: height }, panel, accentBar: null, ...pick(text) }
  }

  // landscape: a text column, two figures per row
  const column = 40 * u
  if (style === 'editorial') {
    const margin = 6 * u
    const gap = 5 * u
    const view = rounded({ x: margin, y: margin, w: width - 2 * margin - gap - column, h: height - 2 * margin })
    const text = stackRows(rows, view.x + view.w + gap, margin, column, u, s, 2, height - margin)
    return { ...base, view, panel: null, accentBar: null, ...pick(text) }
  }
  if (style === 'broadcast') {
    const pad = 5 * u
    const bar = 0.8 * u
    const panelW = column + 2 * pad + bar
    const view = rounded({ x: 0, y: 0, w: width - panelW, h: height })
    const panel = { x: view.w, y: 0, w: width - view.w, h: height }
    const text = stackRows(rows, panel.x + bar + pad, pad, column, u, s, 2, height - pad)
    return { ...base, view, panel, accentBar: { x: panel.x, y: 0, w: bar, h: height }, ...pick(text) }
  }
  const margin = 4 * u
  const pad = 4 * u
  const cardH = stackRows(rows, 0, 0, column, u, s, 2).height + 2 * pad
  const panel = { x: width - margin - column - 2 * pad, y: height - margin - cardH, w: column + 2 * pad, h: cardH }
  const text = stackRows(rows, panel.x + pad, panel.y + pad, column, u, s, 2)
  return { ...base, view: { x: 0, y: 0, w: width, h: height }, panel, accentBar: null, ...pick(text) }
}

function pick({ title, subtitle, figures, profile, weather, credits }: Stacked) {
  return { title, subtitle, figures, profile, weather, credits }
}

// ---------------------------------------------------------------------------
// Text fitting
// ---------------------------------------------------------------------------

/** Width (px) of `text` drawn at `px` in the font of the row. */
export type Measure = (text: string, px: number) => number

/** Longest start of `text` that fits `maxWidth` once followed by « … » ('' when even « … » does not). */
export function truncate(measure: Measure, text: string, maxWidth: number, px: number): string {
  if (measure(text, px) <= maxWidth) return text
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (measure(text.slice(0, mid).trimEnd() + ELLIPSIS, px) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  if (lo === 0) return measure(ELLIPSIS, px) <= maxWidth ? ELLIPSIS : ''
  return text.slice(0, lo).trimEnd() + ELLIPSIS
}

/** Font size (≤ maxPx, ≥ minPx) at which `text` fits `maxWidth`, and the text, cut with « … » if even minPx is too wide. */
export function fitText(measure: Measure, text: string, maxWidth: number, maxPx: number, minPx: number): { text: string; px: number } {
  const width = measure(text, maxPx)
  if (width <= maxWidth) return { text, px: maxPx }
  // text width grows about linearly with the size: guess, then step down until it fits
  let px = Math.max(minPx, (maxPx * maxWidth) / width)
  for (let i = 0; i < 8 && px > minPx && measure(text, px) > maxWidth; i++) px = Math.max(minPx, px * 0.97)
  return { text: truncate(measure, text, maxWidth, px), px }
}

/** Words of `text` greedily on lines of `maxWidth`; null when they need more than `maxLines`. */
export function wrapText(measure: Measure, text: string, maxWidth: number, px: number, maxLines: number): string[] | null {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (!line || measure(next, px) <= maxWidth) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines || lines.some((l) => measure(l, px) > maxWidth)) return null
  return lines
}

/**
 * `text` on at most `maxLines` lines of `maxWidth`: at `maxPx` if it fits, else smaller down to `minPx`, else the
 * last line cut with « … ».
 */
export function fitLines(
  measure: Measure,
  text: string,
  maxWidth: number,
  maxPx: number,
  minPx: number,
  maxLines: number,
): { lines: string[]; px: number } {
  for (let px = maxPx; px > minPx; px *= 0.94) {
    const lines = wrapText(measure, text, maxWidth, px, maxLines)
    if (lines) return { lines, px }
  }
  const lines = wrapText(measure, text, maxWidth, minPx, Number.POSITIVE_INFINITY) ?? [text]
  const kept = lines.slice(0, maxLines).map((l) => truncate(measure, l, maxWidth, minPx))
  if (lines.length > maxLines) kept[maxLines - 1] = truncate(measure, `${lines[maxLines - 1]} ${lines[maxLines]}`, maxWidth, minPx)
  return { lines: kept, px: minPx }
}

/**
 * Draws a poster on a 2D context from its layout (layout.ts) and content (content.ts): the 3D view (or, for the live
 * preview before any render, a placeholder with the track's outline), the text panel, title, subtitle, figures,
 * elevation profile, weather and credits. Synchronous; the fonts must be loaded first (`loadOverlayFonts`).
 *
 * The three styles take the fonts of the overlay styles of the same name and the « Carte alpine » colours.
 */
import { SKY_GRADIENT } from '../export/capture'
import type { MiniMapOutline } from '../overlay/data'
import { formatDistance, formatNumber } from '../ui/format'
import type { PosterContent, PosterProfile } from './content'
import { CREDIT_LINES, FIGURE_VALUE_SHARE, fitLines, fitText } from './layout'
import type { Box, Measure, PosterLayout } from './layout'
import type { PosterStyleId } from './settings'

export type PosterContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const FRAUNCES = '"Fraunces", Georgia, serif'
const PLEX = '"IBM Plex Sans", system-ui, sans-serif'
const PLEX_CONDENSED = '"IBM Plex Sans Condensed", "IBM Plex Sans", system-ui, sans-serif'

const PAPER = '#F5F2EA'
const LINE = '#D6CDBB'
const INK = '#1C2A33'
const INK_SOFT = '#55626B'
const TRAIL_RED = '#C23B22'
const TRAIL_RED_LIGHT = '#FF8A5C'
const GLACIER = '#A9CCD9'

interface Font {
  family: string
  weight: number
  uppercase?: boolean
  /** letter spacing (em) */
  tracking?: number
}

export interface PosterTheme {
  page: string
  /** fill of the text panel (Diffusion band, Application card) */
  panel: string
  panelShadow: boolean
  /** corner radius of the panel (u) */
  panelRadius: number
  accent: string
  text: string
  textSoft: string
  rule: string
  /** hairline above the figures */
  figureRule: boolean
  title: Font
  body: Font
  number: Font
  label: Font
  profile: { area: string; line: string }
}

export const POSTER_THEMES: Record<PosterStyleId, PosterTheme> = {
  // a print on map paper: light serif title, serif figures, tracked small capitals
  editorial: {
    page: PAPER,
    panel: PAPER,
    panelShadow: false,
    panelRadius: 0,
    accent: TRAIL_RED,
    text: INK,
    textSoft: INK_SOFT,
    rule: LINE,
    figureRule: true,
    title: { family: FRAUNCES, weight: 300 },
    body: { family: PLEX, weight: 500 },
    number: { family: FRAUNCES, weight: 500 },
    label: { family: PLEX, weight: 600, uppercase: true, tracking: 0.14 },
    profile: { area: GLACIER, line: INK },
  },
  // full-bleed view over an ink band, condensed capitals, trail-red bar
  broadcast: {
    page: INK,
    panel: INK,
    panelShadow: false,
    panelRadius: 0,
    accent: TRAIL_RED_LIGHT,
    text: '#FFFFFF',
    textSoft: 'rgba(255, 255, 255, 0.78)',
    rule: 'rgba(255, 255, 255, 0.18)',
    figureRule: false,
    title: { family: PLEX_CONDENSED, weight: 700, uppercase: true, tracking: 0.02 },
    body: { family: PLEX_CONDENSED, weight: 500 },
    number: { family: PLEX_CONDENSED, weight: 600 },
    label: { family: PLEX_CONDENSED, weight: 500, uppercase: true, tracking: 0.1 },
    profile: { area: 'rgba(255, 255, 255, 0.2)', line: '#FFFFFF' },
  },
  // the view over the whole poster, a pale rounded card like a navigation app
  app: {
    page: PAPER,
    panel: 'rgba(245, 242, 234, 0.96)',
    panelShadow: true,
    panelRadius: 2,
    accent: TRAIL_RED,
    text: INK,
    textSoft: INK_SOFT,
    rule: LINE,
    figureRule: false,
    title: { family: PLEX, weight: 600 },
    body: { family: PLEX, weight: 500 },
    number: { family: PLEX, weight: 600 },
    label: { family: PLEX, weight: 500 },
    profile: { area: GLACIER, line: INK },
  },
}

/** Font faces drawn by the posters (all embedded: they are faces of the overlay, see `OVERLAY_FONTS`). */
export const POSTER_FONTS: readonly string[] = [
  ...new Set(
    Object.values(POSTER_THEMES).flatMap((t) => [t.title, t.body, t.number, t.label].map((f) => `${f.weight} 32px ${f.family}`)),
  ),
]

/** The rendered 3D view, or nothing yet (preview). */
export interface PosterView {
  image: CanvasImageSource
  width: number
  height: number
}

/** Source rectangle of an image of iw × ih covering a box of bw × bh (centred crop). */
export function coverCrop(iw: number, ih: number, bw: number, bh: number): Box {
  const scale = Math.max(bw / iw, bh / ih)
  const w = bw / scale
  const h = bh / scale
  return { x: (iw - w) / 2, y: (ih - h) / 2, w, h }
}

function setFont(ctx: PosterContext, font: Font, px: number): void {
  ctx.font = `${font.weight} ${px}px ${font.family}`
  // letterSpacing: Chrome 99+, Firefox 115+, Safari 18+; plain spacing elsewhere
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(font.tracking ?? 0) * px}px`
}

const caseOf = (text: string, font: Font) => (font.uppercase ? text.toLocaleUpperCase('fr') : text)

function measurer(ctx: PosterContext, font: Font): Measure {
  return (text, px) => {
    setFont(ctx, font, px)
    return ctx.measureText(caseOf(text, font)).width
  }
}

/** One line of text, vertically centred on `cy`. */
function text(ctx: PosterContext, value: string, x: number, cy: number, font: Font, px: number, color: string, align: CanvasTextAlign = 'left'): void {
  setFont(ctx, font, px)
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(caseOf(value, font), x, cy)
}

function roundedRect(ctx: PosterContext, b: Box, r: number): void {
  const radius = Math.min(r, b.w / 2, b.h / 2)
  ctx.beginPath()
  ctx.moveTo(b.x + radius, b.y)
  ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, radius)
  ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, radius)
  ctx.arcTo(b.x, b.y + b.h, b.x, b.y, radius)
  ctx.arcTo(b.x, b.y, b.x + b.w, b.y, radius)
  ctx.closePath()
}

/** Before the first render: the sky of the export and the track seen from above, in trail red. */
function drawPlaceholder(ctx: PosterContext, box: Box, outline: MiniMapOutline | undefined, u: number): void {
  const sky = ctx.createLinearGradient(0, box.y, 0, box.y + box.h)
  sky.addColorStop(0, SKY_GRADIENT[0])
  sky.addColorStop(1, SKY_GRADIENT[1])
  ctx.fillStyle = sky
  ctx.fillRect(box.x, box.y, box.w, box.h)
  if (!outline || outline.x.length < 2 || !(outline.width > 0 || outline.height > 0)) return
  const side = Math.min(box.w, box.h) * 0.6
  const scale = side / Math.max(outline.width, outline.height)
  const ox = box.x + (box.w - outline.width * scale) / 2
  const oy = box.y + (box.h - outline.height * scale) / 2
  ctx.beginPath()
  for (let i = 0; i < outline.x.length; i++) {
    const x = ox + outline.x[i] * scale
    const y = oy + outline.y[i] * scale
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = TRAIL_RED
  ctx.lineWidth = Math.max(1, 0.5 * u)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.stroke()
}

function drawProfile(ctx: PosterContext, box: Box, profile: PosterProfile, theme: PosterTheme, labelPx: number): void {
  const label = measurer(ctx, theme.label)
  const captionH = labelPx * 1.8
  const range = `${formatNumber(profile.minEle)} – ${formatNumber(profile.maxEle)} m`
  const length = formatDistance(profile.lengthM)
  const right = fitText(label, length, box.w / 3, labelPx, labelPx * 0.6)
  const left = fitText(label, `Profil · ${range}`, box.w - label(right.text, right.px) - labelPx * 2, labelPx, labelPx * 0.6)
  text(ctx, left.text, box.x, box.y + captionH / 2, theme.label, left.px, theme.textSoft)
  text(ctx, right.text, box.x + box.w, box.y + captionH / 2, theme.label, right.px, theme.textSoft, 'right')

  const plot = { x: box.x, y: box.y + captionH, w: box.w, h: box.h - captionH }
  const span = Math.max(100, profile.maxEle - profile.minEle)
  const low = (profile.minEle + profile.maxEle) / 2 - span / 2
  const n = profile.ele.length
  const points: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const e = profile.ele[i]
    if (Number.isNaN(e)) continue
    points.push([plot.x + (i / Math.max(1, n - 1)) * plot.w, plot.y + plot.h * (1 - ((e - low) / span) * 0.92)])
  }
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0][0], plot.y + plot.h)
  for (const [x, y] of points) ctx.lineTo(x, y)
  ctx.lineTo(points[points.length - 1][0], plot.y + plot.h)
  ctx.closePath()
  ctx.fillStyle = theme.profile.area
  ctx.fill()
  ctx.beginPath()
  points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.strokeStyle = theme.profile.line
  ctx.lineWidth = Math.max(1, labelPx * 0.14)
  ctx.lineJoin = 'round'
  ctx.stroke()
}

function drawFigures(ctx: PosterContext, layout: PosterLayout, content: PosterContent, theme: PosterTheme): void {
  const cells = layout.figures.slice(0, content.figures.length)
  if (cells.length === 0) return
  const number = measurer(ctx, theme.number)
  const body = measurer(ctx, theme.body)
  const label = measurer(ctx, theme.label)
  const { value: valueMax, label: labelMax } = layout.fonts
  // one size for every value, the largest at which each one (number and unit) fits its cell
  const widthAt = (i: number, px: number) => {
    const f = content.figures[i]
    return number(f.value, px) + (f.unit ? px * 0.2 + body(f.unit, px * 0.45) : 0)
  }
  let valuePx = valueMax
  cells.forEach((cell, i) => {
    const width = widthAt(i, valueMax)
    if (width > cell.w) valuePx = Math.min(valuePx, (valueMax * cell.w) / width)
  })
  valuePx = Math.max(valueMax * 0.4, valuePx)
  if (theme.figureRule) {
    const top = cells[0].y - layout.u * 1.6
    ctx.fillStyle = theme.rule
    ctx.fillRect(cells[0].x, top, cells[cells.length - 1].x + cells[cells.length - 1].w - cells[0].x, Math.max(1, layout.u * 0.12))
  }
  cells.forEach((cell, i) => {
    const f = content.figures[i]
    const valueY = cell.y + (cell.h * FIGURE_VALUE_SHARE) / 2
    text(ctx, f.value, cell.x, valueY, theme.number, valuePx, theme.text)
    if (f.unit) {
      const x = cell.x + number(f.value, valuePx) + valuePx * 0.2
      text(ctx, f.unit, x, valueY + valuePx * 0.12, theme.body, valuePx * 0.45, theme.textSoft)
    }
    const fitted = fitText(label, f.label, cell.w, labelMax, labelMax * 0.6)
    text(ctx, fitted.text, cell.x, cell.y + cell.h * FIGURE_VALUE_SHARE + (cell.h * (1 - FIGURE_VALUE_SHARE)) / 2, theme.label, fitted.px, theme.textSoft)
  })
}

/**
 * The whole poster. `view` null draws the placeholder (with `outline`, the plan of the track) in its place.
 */
export function drawPoster(
  ctx: PosterContext,
  layout: PosterLayout,
  content: PosterContent,
  style: PosterStyleId,
  view: PosterView | null,
  outline?: MiniMapOutline,
): void {
  const theme = POSTER_THEMES[style]
  const { u, fonts } = layout
  ctx.save()
  ctx.fillStyle = theme.page
  ctx.fillRect(0, 0, layout.width, layout.height)

  // 3D view
  ctx.save()
  ctx.beginPath()
  ctx.rect(layout.view.x, layout.view.y, layout.view.w, layout.view.h)
  ctx.clip()
  if (view) {
    const crop = coverCrop(view.width, view.height, layout.view.w, layout.view.h)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(view.image, crop.x, crop.y, crop.w, crop.h, layout.view.x, layout.view.y, layout.view.w, layout.view.h)
  } else drawPlaceholder(ctx, layout.view, outline, u)
  ctx.restore()

  // text panel
  if (layout.panel) {
    ctx.save()
    roundedRect(ctx, layout.panel, theme.panelRadius * u)
    if (theme.panelShadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.28)'
      ctx.shadowBlur = 2 * u
      ctx.shadowOffsetY = 0.4 * u
    }
    ctx.fillStyle = theme.panel
    ctx.fill()
    ctx.restore()
  }
  if (layout.accentBar) {
    ctx.fillStyle = theme.accent
    const b = layout.accentBar
    ctx.fillRect(b.x, b.y, b.w, b.h)
  }

  const title = fitText(measurer(ctx, theme.title), content.title, layout.title.w, fonts.title, fonts.title * 0.45)
  text(ctx, title.text, layout.title.x, layout.title.y + layout.title.h / 2, theme.title, title.px, theme.text)

  if (layout.subtitle && content.subtitle) {
    const sub = fitText(measurer(ctx, theme.body), content.subtitle, layout.subtitle.w, fonts.subtitle, fonts.subtitle * 0.6)
    text(ctx, sub.text, layout.subtitle.x, layout.subtitle.y + layout.subtitle.h / 2, theme.body, sub.px, theme.textSoft)
  }

  drawFigures(ctx, layout, content, theme)

  if (layout.profile && content.profile) drawProfile(ctx, layout.profile, content.profile, theme, fonts.profile)

  if (layout.weather && content.weather) {
    const weather = fitText(measurer(ctx, theme.body), content.weather, layout.weather.w, fonts.weather, fonts.weather * 0.6)
    text(ctx, weather.text, layout.weather.x, layout.weather.y + layout.weather.h / 2, theme.body, weather.px, theme.text)
  }

  // credits of the sources: required by their licences, small but legible
  const credits = layout.credits
  const creditFont: Font = { family: PLEX, weight: 500 }
  const fitted = fitLines(measurer(ctx, creditFont), content.credits.join(' · '), credits.w, fonts.credits, fonts.credits * 0.75, CREDIT_LINES)
  const lineH = credits.h / CREDIT_LINES
  fitted.lines.forEach((line, i) => text(ctx, line, credits.x, credits.y + lineH * (i + 0.5), creditFont, fitted.px, theme.textSoft))
  ctx.restore()
}

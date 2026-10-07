/**
 * Film overlay drawing: one pure, synchronous function of (frame values, settings, frame size) onto a 2D
 * canvas context. The preview and the video export call the same `drawOverlay`, so the film shows exactly
 * what the preview shows.
 *
 * Every dimension derives from the frame size: 1 u = 1 % of its shorter side, safe margins = 5 % of each
 * side. Widgets sharing an anchor are stacked. No DOM access: fonts and the logo image are loaded
 * beforehand (see `assets.ts`).
 */
import { formatDistance, formatDuration, formatNumber } from '../ui/format'
import { overlayFrameAt } from './data'
import type { OverlayFrame, OverlayTrack } from './data'
import type { CounterId, OverlayAnchor, OverlaySettings } from './settings'
import { COUNTER_IDS } from './settings'
import { OVERLAY_THEMES } from './themes'
import type { OverlayTheme } from './themes'

/** On screen (preview) or offscreen (video export). */
export type OverlayContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Size of the frame in the context's user units (CSS pixels in the preview, video pixels in the export). */
export interface OverlaySize {
  width: number
  height: number
}

/** Decoded images used by the overlay (loaded asynchronously before drawing). */
export interface OverlayAssets {
  logo?: { image: CanvasImageSource; width: number; height: number } | null
}

/** Safe area: 5 % of the frame on each side. */
export const SAFE_MARGIN = 0.05
/** Fade lengths of the cards, as fractions of the flyover. */
export const CARD_FADE_IN = 0.01
export const CARD_FADE_OUT = 0.025
/** Smallest elevation range drawn full height (a flat track stays flat), as in the timeline profile. */
const PROFILE_MIN_SPAN_M = 100

/** Short labels drawn in the film. */
export const COUNTER_LABELS: Record<CounterId, string> = {
  distance: 'Distance',
  altitude: 'Altitude',
  ascent: 'D+',
  time: 'Temps',
  speed: 'Vitesse',
  heartRate: 'FC',
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** Opening card: fades in from 0, out before `end` (fractions of the flyover). */
export function titleCardOpacity(progress: number, end: number): number {
  if (progress >= end) return 0
  const fadeIn = Math.min(CARD_FADE_IN, end / 4)
  const fadeOut = Math.min(CARD_FADE_OUT, end / 3)
  return smoothstep(progress / fadeIn) * smoothstep((end - progress) / fadeOut)
}

/** Closing card: fades in after `start`, stays until the end. */
export function endCardOpacity(progress: number, start: number): number {
  return progress <= start ? 0 : smoothstep((progress - start) / CARD_FADE_OUT)
}

/** Seconds -> "1:05:09" (hours always shown, so the counter keeps its width). */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

/** Recorded instant -> "12 juillet 2025" ("1er" for the first day), browser time zone. */
export function formatDateFr(ms: number): string {
  const date = new Date(ms)
  const day = date.getDate()
  return `${day === 1 ? '1er' : day} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

export interface CounterText {
  value: string
  unit: string
}

/** "12,4 km" -> { value: "12,4", unit: "km" } (the unit follows the last ordinary space). */
function splitUnit(text: string): CounterText {
  const i = text.lastIndexOf(' ')
  return i < 0 ? { value: text, unit: '' } : { value: text.slice(0, i), unit: text.slice(i + 1) }
}

/** Text of a counter at this frame; null when the track does not record what it needs. */
export function counterText(id: CounterId, frame: OverlayFrame): CounterText | null {
  switch (id) {
    case 'distance':
      return splitUnit(formatDistance(frame.distanceM))
    case 'altitude':
      return frame.ele === undefined ? null : { value: formatNumber(frame.ele), unit: 'm' }
    case 'ascent':
      return frame.ascentM === undefined ? null : { value: formatNumber(frame.ascentM), unit: 'm' }
    case 'time':
      return frame.elapsedS === undefined ? null : { value: formatElapsed(frame.elapsedS), unit: '' }
    case 'speed':
      return frame.speedKmh === undefined ? null : { value: formatNumber(frame.speedKmh, 1), unit: 'km/h' }
    case 'heartRate':
      return frame.heartRate === undefined ? null : { value: formatNumber(frame.heartRate), unit: 'bpm' }
  }
}

/** Widest text a counter takes during the flyover, so its cell keeps one width (digits measured as "0"). */
function counterTemplate(id: CounterId, track: OverlayTrack): CounterText {
  const s = track.stats
  switch (id) {
    case 'distance':
      return splitUnit(formatDistance(Math.max(s.distanceM, 999)))
    case 'altitude':
      return { value: formatNumber(s.maxEleM ?? 0), unit: 'm' }
    case 'ascent':
      return { value: formatNumber(s.ascentM ?? 0), unit: 'm' }
    case 'time':
      return { value: formatElapsed(s.durationS ?? 0), unit: '' }
    case 'speed':
      return { value: formatNumber(Math.max(10, s.maxSpeedKmh ?? 0), 1), unit: 'km/h' }
    case 'heartRate':
      return { value: '000', unit: 'bpm' }
  }
}

export interface LayoutItem {
  anchor: OverlayAnchor
  width: number
  height: number
}

/**
 * Top-left corner of each item inside the safe area. Items sharing an anchor are stacked vertically in
 * order, `gap` apart: from the top edge, the bottom edge or around the middle; aligned left, centred or right.
 */
export function layoutWidgets(items: readonly LayoutItem[], size: OverlaySize, gap: number): { x: number; y: number }[] {
  const left = size.width * SAFE_MARGIN
  const right = size.width * (1 - SAFE_MARGIN)
  const top = size.height * SAFE_MARGIN
  const bottom = size.height * (1 - SAFE_MARGIN)
  const out = items.map(() => ({ x: 0, y: 0 }))
  const groups = new Map<OverlayAnchor, number[]>()
  items.forEach((item, i) => groups.set(item.anchor, [...(groups.get(item.anchor) ?? []), i]))
  for (const [anchor, indices] of groups) {
    const [row, column] = anchor === 'center' ? ['middle', 'center'] : anchor.split('-')
    const total = indices.reduce((sum, i) => sum + items[i].height, 0) + gap * (indices.length - 1)
    let y = row === 'top' ? top : row === 'bottom' ? bottom - total : (top + bottom) / 2 - total / 2
    for (const i of indices) {
      const w = items[i].width
      out[i].x = column === 'left' ? left : column === 'right' ? right - w : size.width / 2 - w / 2
      out[i].y = y
      y += items[i].height + gap
    }
  }
  return out
}

/** Horizontal alignment of a widget's content from its anchor. */
function alignOf(anchor: OverlayAnchor): CanvasTextAlign {
  return anchor.endsWith('left') ? 'left' : anchor.endsWith('right') ? 'right' : 'center'
}

// ---------------------------------------------------------------------------
// Drawing primitives
// ---------------------------------------------------------------------------

interface Painter {
  ctx: OverlayContext2D
  theme: OverlayTheme
  /** overlay unit (1 % of the shorter side) */
  u: number
  /** device pixels per user unit: shadow blur and offsets ignore the transform */
  px: number
  size: OverlaySize
}

interface TextStyle {
  family: string
  weight: number
  sizePx: number
  color: string
  uppercase?: boolean
  /** em */
  tracking?: number
}

function applyFont(p: Painter, style: TextStyle): void {
  p.ctx.font = `${style.weight} ${style.sizePx}px ${style.family}`
  // letterSpacing: Chrome 99+, Firefox 115+, Safari 18+; plain spacing elsewhere
  if ('letterSpacing' in p.ctx) p.ctx.letterSpacing = `${(style.tracking ?? 0) * style.sizePx}px`
}

const caseOf = (text: string, style: TextStyle) => (style.uppercase ? text.toLocaleUpperCase('fr') : text)

function measure(p: Painter, text: string, style: TextStyle): number {
  applyFont(p, style)
  return p.ctx.measureText(caseOf(text, style)).width
}

/** Text with its alphabetic baseline at y. */
function fillText(p: Painter, text: string, x: number, y: number, style: TextStyle, align: CanvasTextAlign = 'left'): void {
  const { ctx, theme } = p
  applyFont(p, style)
  ctx.fillStyle = style.color
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  if (theme.textShadow) {
    ctx.shadowColor = theme.textShadow.color
    ctx.shadowBlur = theme.textShadow.blur * p.u * p.px
    ctx.shadowOffsetY = 0.1 * p.u * p.px
  }
  ctx.fillText(caseOf(text, style), x, y)
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
}

function roundedRect(ctx: OverlayContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/**
 * Background of a widget: the style's panel (with an accent bar on the `align` side when the style has one),
 * or, for the styles without panel, a soft dark elliptic scrim that keeps light text readable on snow.
 */
function drawPanel(p: Painter, x: number, y: number, w: number, h: number, align: CanvasTextAlign = 'left'): void {
  const { ctx, theme, u } = p
  ctx.save()
  const panel = theme.panel
  if (!panel) {
    const rx = w / 2 + 6 * u
    const ry = h / 2 + 4 * u
    ctx.translate(x + w / 2, y + h / 2)
    ctx.scale(rx, ry)
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.36)')
    gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.24)')
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(0, 0, 1, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  roundedRect(ctx, x, y, w, h, panel.radius * u)
  if (panel.shadow) {
    ctx.shadowColor = panel.shadow.color
    ctx.shadowBlur = panel.shadow.blur * u * p.px
    ctx.shadowOffsetY = panel.shadow.offsetY * u * p.px
  }
  ctx.fillStyle = panel.fill
  ctx.fill()
  ctx.shadowColor = 'transparent'
  if (panel.stroke) {
    ctx.strokeStyle = panel.stroke
    ctx.lineWidth = Math.max(0.1 * u, 1 / p.px)
    ctx.stroke()
  }
  if (theme.accentBar > 0) {
    ctx.clip()
    ctx.fillStyle = theme.accent
    const bar = theme.accentBar * u
    ctx.fillRect(align === 'right' ? x + w - bar : x, y, bar, h)
  }
  ctx.restore()
}

/** Words of `text` packed into lines no wider than `maxWidth` (a single long word overflows). */
function wrapLines(p: Painter, text: string, maxWidth: number, style: TextStyle): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    if (!line || measure(p, candidate, style) <= maxWidth) line = candidate
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  return lines
}

/** `text` cut with an ellipsis to fit `maxWidth`. */
function truncate(p: Painter, text: string, maxWidth: number, style: TextStyle): string {
  if (measure(p, text, style) <= maxWidth) return text
  let cut = text
  while (cut.length > 1 && measure(p, `${cut}…`, style) > maxWidth) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

interface Widget extends LayoutItem {
  opacity: number
  draw(x: number, y: number): void
}

/** x of a line of text in a box, for an alignment. */
const alignX = (align: CanvasTextAlign, x: number, w: number) => (align === 'left' ? x : align === 'right' ? x + w : x + w / 2)

interface Cell {
  label: string
  value: string
  unit: string
  /** width reserved for value + unit */
  valueWidth: number
}

/** Shared layout of label-over-value cells (live counters, closing card statistics). */
function cellMetrics(p: Painter, scale: number) {
  const { theme, u } = p
  const label: TextStyle = {
    family: theme.bodyFamily,
    weight: theme.labelWeight,
    sizePx: 1.5 * u * scale,
    color: theme.textSoft,
    uppercase: theme.labelUppercase,
    tracking: theme.labelTracking,
  }
  const value: TextStyle = { family: theme.numberFamily, weight: theme.numberWeight, sizePx: 4.4 * u * scale, color: theme.text }
  const unit: TextStyle = { family: theme.bodyFamily, weight: theme.labelWeight, sizePx: 1.9 * u * scale, color: theme.textSoft }
  const unitGap = 0.5 * u * scale
  // label caps, gap, value digits: alphabetic baselines from the top of the cell
  const labelBaseline = label.sizePx * 0.74
  const valueBaseline = labelBaseline + 1.2 * u * scale + value.sizePx * 0.74
  return { label, value, unit, unitGap, labelBaseline, valueBaseline, height: valueBaseline + 0.2 * u * scale }
}

function makeCell(p: Painter, m: ReturnType<typeof cellMetrics>, label: string, text: CounterText, template: CounterText): Cell {
  const digits = (s: string) => s.replace(/\d/g, '0')
  const valueWidth =
    Math.max(measure(p, digits(template.value), m.value), measure(p, digits(text.value), m.value)) +
    (text.unit ? m.unitGap + measure(p, text.unit, m.unit) : 0)
  return { label, value: text.value, unit: text.unit, valueWidth }
}

const cellWidth = (p: Painter, m: ReturnType<typeof cellMetrics>, cell: Cell) => Math.max(measure(p, cell.label, m.label), cell.valueWidth)

function drawCell(p: Painter, m: ReturnType<typeof cellMetrics>, cell: Cell, x: number, y: number, w: number, align: CanvasTextAlign): void {
  fillText(p, cell.label, alignX(align, x, w), y + m.labelBaseline, m.label, align)
  const valueW = measure(p, cell.value, m.value)
  const unitW = cell.unit ? m.unitGap + measure(p, cell.unit, m.unit) : 0
  const used = valueW + unitW
  // value + unit as one run, placed like the label
  const left = align === 'left' ? x : align === 'right' ? x + w - used : x + (w - used) / 2
  fillText(p, cell.value, left, y + m.valueBaseline, m.value, 'left')
  if (cell.unit) fillText(p, cell.unit, left + valueW + m.unitGap, y + m.valueBaseline, m.unit, 'left')
}

function countersWidget(p: Painter, frame: OverlayFrame, settings: OverlaySettings, opacity: number): Widget | null {
  const { counters } = settings
  const { theme, u, ctx } = p
  const s = counters.size
  const m = cellMetrics(p, s)
  const cells: Cell[] = []
  for (const id of COUNTER_IDS) {
    if (!counters.fields[id]) continue
    const text = counterText(id, frame)
    if (text) cells.push(makeCell(p, m, COUNTER_LABELS[id], text, counterTemplate(id, frame.track)))
  }
  if (cells.length === 0) return null

  const vertical = counters.anchor === 'middle-left' || counters.anchor === 'middle-right'
  const align: CanvasTextAlign = vertical ? alignOf(counters.anchor) : 'left'
  const grouped = theme.groupedCounters
  const padX = (theme.panel ? 2 : 0.5) * u * s
  const padY = (theme.panel ? 1.6 : 0.5) * u * s
  const gap = (grouped ? 3.2 : 1) * u * s
  const widths = cells.map((c) => cellWidth(p, m, c) + (grouped ? 0 : 2 * padX))
  const cellH = m.height + (grouped ? 0 : 2 * padY)
  const columnW = Math.max(...widths)
  const innerW = vertical ? columnW : widths.reduce((a, b) => a + b, 0) + gap * (cells.length - 1)
  const innerH = vertical ? cellH * cells.length + gap * (cells.length - 1) : cellH
  const extraX = grouped ? 2 * padX + (theme.accentBar ? theme.accentBar * u : 0) : 0
  const extraY = grouped ? 2 * padY : 0

  return {
    anchor: counters.anchor,
    width: innerW + extraX,
    height: innerH + extraY,
    opacity,
    draw(x, y) {
      const barOffset = grouped && theme.accentBar && align !== 'right' ? theme.accentBar * u : 0
      if (grouped) drawPanel(p, x, y, innerW + extraX, innerH + extraY, align)
      let cx = x + (grouped ? padX + barOffset : 0)
      let cy = y + (grouped ? padY : 0)
      cells.forEach((cell, i) => {
        const w = vertical ? columnW : widths[i]
        if (!grouped) drawPanel(p, cx, cy, w, cellH)
        const inset = grouped ? 0 : padX
        drawCell(p, m, cell, cx + inset, cy + (grouped ? 0 : padY), w - 2 * inset, align)
        if (grouped && i < cells.length - 1) {
          // hairline separator in the middle of the gap
          ctx.save()
          ctx.fillStyle = theme.textSoft
          ctx.globalAlpha *= 0.35
          const t = Math.max(0.1 * u, 1 / p.px)
          if (vertical) ctx.fillRect(cx, cy + cellH + gap / 2 - t / 2, columnW, t)
          else ctx.fillRect(cx + w + gap / 2 - t / 2, cy, t, cellH)
          ctx.restore()
        }
        if (vertical) cy += cellH + gap
        else cx += w + gap
      })
    },
  }
}

function profileWidget(p: Painter, frame: OverlayFrame, settings: OverlaySettings, opacity: number): Widget | null {
  const profile = frame.track.profile
  if (!profile) return null
  const { theme, u, ctx, size } = p
  const { anchor, width, height } = settings.profile
  const w = width * size.width
  const h = height * size.height
  const pad = theme.panel ? 1.2 * u : 0
  return {
    anchor,
    width: w,
    height: h,
    opacity,
    draw(x, y) {
      drawPanel(p, x, y, w, h, alignOf(anchor))
      const barOffset = theme.panel && theme.accentBar && alignOf(anchor) !== 'right' ? theme.accentBar * u : 0
      const ix = x + pad + barOffset
      const iy = y + pad + 0.8 * u
      const iw = w - 2 * pad - (theme.accentBar && theme.panel ? theme.accentBar * u : 0)
      const ih = h - 2 * pad - 0.8 * u
      const { ele, minEle, maxEle } = profile
      const span = Math.max(maxEle - minEle, PROFILE_MIN_SPAN_M)
      const n = ele.length
      const xAt = (i: number) => ix + (i / (n - 1)) * iw
      const yAt = (e: number) => iy + ih * (1 - (e - minEle) / span)

      const area = () => {
        ctx.beginPath()
        let open = false
        for (let i = 0; i <= n; i++) {
          const known = i < n && !Number.isNaN(ele[i])
          if (known && !open) {
            ctx.moveTo(xAt(i), iy + ih)
            open = true
          }
          if (known) ctx.lineTo(xAt(i), yAt(ele[i]))
          else if (open) {
            ctx.lineTo(xAt(i - 1), iy + ih)
            ctx.closePath()
            open = false
          }
        }
      }
      ctx.save()
      area()
      ctx.fillStyle = theme.profile.area
      ctx.fill()
      const markerX = ix + frame.progress * iw
      ctx.save()
      ctx.beginPath()
      ctx.rect(ix, iy - u, markerX - ix, ih + 2 * u)
      ctx.clip()
      area()
      ctx.fillStyle = theme.profile.played
      ctx.fill()
      ctx.restore()
      // ridge line
      ctx.beginPath()
      let pen = false
      for (let i = 0; i < n; i++) {
        if (Number.isNaN(ele[i])) {
          pen = false
          continue
        }
        if (pen) ctx.lineTo(xAt(i), yAt(ele[i]))
        else ctx.moveTo(xAt(i), yAt(ele[i]))
        pen = true
      }
      ctx.strokeStyle = theme.profile.line
      ctx.lineWidth = 0.22 * u
      ctx.lineJoin = 'round'
      ctx.stroke()
      // marker
      if (frame.ele !== undefined) {
        ctx.beginPath()
        ctx.arc(markerX, yAt(frame.ele), 0.9 * u, 0, Math.PI * 2)
        ctx.fillStyle = theme.profile.marker
        ctx.fill()
        ctx.lineWidth = 0.35 * u
        ctx.strokeStyle = theme.profile.markerRing
        ctx.stroke()
      }
      ctx.restore()
    },
  }
}

interface CardContent {
  title: string
  subtitle: string
  /** size of the title relative to the opening card */
  titleScale: number
  cells: Cell[]
}

function cardWidget(
  p: Painter,
  content: CardContent,
  anchor: OverlayAnchor,
  scale: number,
  opacity: number,
  cellM?: ReturnType<typeof cellMetrics>,
): Widget {
  const { theme, u, size, ctx } = p
  const align = alignOf(anchor)
  const pad = theme.panel ? 3 * u * scale : 0
  const barW = theme.panel ? theme.accentBar * u : 0
  const maxW = Math.min(size.width * (1 - 2 * SAFE_MARGIN), size.width * 0.72) - 2 * pad - barW

  // title: wrapped on up to three lines, shrunk when longer
  const title: TextStyle = {
    family: theme.titleFamily,
    weight: theme.titleWeight,
    sizePx: (theme.titleUppercase ? 5.6 : 6.6) * u * scale * content.titleScale,
    color: theme.text,
    uppercase: theme.titleUppercase,
    tracking: theme.titleUppercase ? 0.02 : -0.01,
  }
  let lines = content.title ? wrapLines(p, content.title, maxW, title) : []
  for (let i = 0; i < 4 && (lines.length > 3 || lines.some((l) => measure(p, l, title) > maxW)); i++) {
    title.sizePx *= 0.85
    lines = wrapLines(p, content.title, maxW, title)
  }
  const lineH = title.sizePx * 1.1
  const subtitle: TextStyle = {
    family: theme.bodyFamily,
    weight: theme.labelWeight,
    sizePx: 1.9 * u * scale,
    color: theme.textSoft,
    uppercase: theme.labelUppercase,
    tracking: theme.labelUppercase ? 0.18 : 0,
  }
  const sub = content.subtitle ? truncate(p, content.subtitle, maxW, subtitle) : ''
  const ruleW = theme.panel ? 0 : 7 * u * scale
  const ruleGap = 2 * u * scale

  // statistics grid (closing card)
  const cellGap = 3.2 * u * scale
  const cellWs = cellM ? content.cells.map((c) => cellWidth(p, cellM, c)) : []
  const colW = cellWs.length ? Math.max(...cellWs) : 0
  const cols = Math.max(1, Math.min(content.cells.length, Math.floor((maxW + cellGap) / (colW + cellGap))))
  const rows = Math.ceil(content.cells.length / cols)
  const gridW = cols * colW + (cols - 1) * cellGap
  const gridH = cellM ? rows * cellM.height + (rows - 1) * 2 * u * scale : 0

  const titleW = Math.max(0, ...lines.map((l) => measure(p, l, title)))
  const subW = sub ? measure(p, sub, subtitle) : 0
  const innerW = Math.max(titleW, subW, gridW, ruleW)
  const titleH = lines.length ? (lines.length - 1) * lineH + title.sizePx * 0.78 : 0
  const parts = [titleH, sub ? subtitle.sizePx * 0.78 : 0, gridH].filter((h) => h > 0)
  const innerH = parts.reduce((a, b) => a + b, 0) + (parts.length - 1) * (ruleW ? 2 * ruleGap : ruleGap * 1.4)

  return {
    anchor,
    width: innerW + 2 * pad + barW,
    height: innerH + 2 * pad,
    opacity,
    draw(x, y) {
      drawPanel(p, x, y, innerW + 2 * pad + barW, innerH + 2 * pad, align)
      const ix = x + pad + (align === 'right' ? 0 : barW)
      let cy = y + pad
      const between = ruleW ? 2 * ruleGap : ruleGap * 1.4
      lines.forEach((line, i) => fillText(p, line, alignX(align, ix, innerW), cy + title.sizePx * 0.78 + i * lineH, title, align))
      if (titleH) cy += titleH + between
      if (ruleW && titleH && (sub || cellM)) {
        // thin accent rule between the title and what follows
        ctx.fillStyle = theme.accent
        const t = 0.25 * u * scale
        ctx.fillRect(alignX(align, ix, innerW) - (align === 'center' ? ruleW / 2 : align === 'right' ? ruleW : 0), cy - between / 2 - t / 2, ruleW, t)
      }
      if (sub) {
        fillText(p, sub, alignX(align, ix, innerW), cy + subtitle.sizePx * 0.78, subtitle, align)
        cy += subtitle.sizePx * 0.78 + between
      }
      if (cellM) {
        const offset = align === 'left' ? 0 : align === 'right' ? innerW - gridW : (innerW - gridW) / 2
        content.cells.forEach((cell, i) => {
          const col = i % cols
          const row = Math.floor(i / cols)
          // a short last row is centred like the card
          const rowCount = row === rows - 1 ? content.cells.length - row * cols : cols
          const rowShift = align === 'center' ? ((cols - rowCount) * (colW + cellGap)) / 2 : 0
          drawCell(p, cellM, cell, ix + offset + rowShift + col * (colW + cellGap), cy + row * (cellM.height + 2 * u * scale), colW, align)
        })
      }
    },
  }
}

function titleWidget(p: Painter, frame: OverlayFrame, settings: OverlaySettings, opacity: number): Widget {
  const t = settings.title
  const start = frame.track.stats.startTime
  const date = t.showDate && start !== undefined ? formatDateFr(start) : ''
  const subtitle = [date, t.subtitle.trim()].filter(Boolean).join(' · ')
  return cardWidget(p, { title: t.title.trim() || frame.track.name, subtitle, titleScale: 1, cells: [] }, t.anchor, t.size, opacity)
}

function endWidget(p: Painter, frame: OverlayFrame, settings: OverlaySettings, opacity: number): Widget {
  const e = settings.end
  const s = frame.track.stats
  const m = cellMetrics(p, e.size)
  const stats: [string, CounterText | null][] = [
    ['Distance', splitUnit(formatDistance(s.distanceM))],
    ['Dénivelé +', s.ascentM === undefined ? null : { value: formatNumber(s.ascentM), unit: 'm' }],
    ['Altitude max', s.maxEleM === undefined ? null : { value: formatNumber(s.maxEleM), unit: 'm' }],
    ['Durée', s.durationS === undefined || s.durationS <= 0 ? null : { value: formatDuration(s.durationS), unit: '' }],
    ['Vitesse max', s.maxSpeedKmh === undefined ? null : { value: formatNumber(s.maxSpeedKmh, 1), unit: 'km/h' }],
  ]
  const cells = stats.flatMap(([label, text]) => (text ? [makeCell(p, m, label, text, text)] : []))
  return cardWidget(p, { title: e.title.trim() || frame.track.name, subtitle: '', titleScale: 0.6, cells }, e.anchor, e.size, opacity, m)
}

function textWidget(p: Painter, settings: OverlaySettings): Widget | null {
  const { text } = settings
  const content = text.text.trim()
  if (!content) return null
  const { theme, u } = p
  const style: TextStyle = { family: theme.bodyFamily, weight: 500, sizePx: 2.4 * u * text.size, color: theme.text }
  const pad = theme.panel ? 1.4 * u * text.size : 0
  const maxW = p.size.width * (1 - 2 * SAFE_MARGIN) - 2 * pad
  const line = truncate(p, content, maxW, style)
  const w = measure(p, line, style)
  const align = alignOf(text.anchor)
  return {
    anchor: text.anchor,
    width: w + 2 * pad,
    height: style.sizePx * 0.95 + 2 * pad,
    opacity: 1,
    draw(x, y) {
      drawPanel(p, x, y, w + 2 * pad, style.sizePx * 0.95 + 2 * pad, align)
      fillText(p, line, x + pad, y + pad + style.sizePx * 0.75, style, 'left')
    },
  }
}

function logoWidget(p: Painter, settings: OverlaySettings, assets: OverlayAssets): Widget | null {
  const logo = assets.logo
  if (!logo || !settings.logo.image || logo.width <= 0 || logo.height <= 0) return null
  const { u, ctx } = p
  const s = settings.logo.size
  let h = 9 * u * s
  let w = (h * logo.width) / logo.height
  const maxW = 28 * u * s
  if (w > maxW) {
    h *= maxW / w
    w = maxW
  }
  return {
    anchor: settings.logo.anchor,
    width: w,
    height: h,
    opacity: 1,
    draw(x, y) {
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(logo.image, x, y, w, h)
    },
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Draw the overlay of one frame. The context's current transform maps `size` (user units) onto the canvas;
 * the caller clears the canvas first (the overlay only adds). Synchronous and deterministic: the same
 * arguments always give the same image.
 */
export function drawOverlay(
  ctx: OverlayContext2D,
  frame: OverlayFrame,
  settings: OverlaySettings,
  size: OverlaySize,
  assets: OverlayAssets = {},
): void {
  if (!settings.enabled || size.width <= 0 || size.height <= 0) return
  const transform = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null
  const p: Painter = {
    ctx,
    theme: OVERLAY_THEMES[settings.style] ?? OVERLAY_THEMES.editorial,
    u: Math.min(size.width, size.height) / 100,
    px: transform ? Math.hypot(transform.a, transform.b) || 1 : 1,
    size,
  }

  const titleOpacity = settings.title.enabled ? titleCardOpacity(frame.progress, settings.title.end) : 0
  const endOpacity = settings.end.enabled ? endCardOpacity(frame.progress, settings.end.start) : 0
  // live widgets give way to the cards
  const live = 1 - Math.max(titleOpacity, endOpacity)

  ctx.save()
  const widgets: Widget[] = []
  const add = (w: Widget | null) => {
    if (w && w.opacity > 0.001) widgets.push(w)
  }
  if (titleOpacity > 0) add(titleWidget(p, frame, settings, titleOpacity))
  if (endOpacity > 0) add(endWidget(p, frame, settings, endOpacity))
  if (settings.counters.enabled && live > 0) add(countersWidget(p, frame, settings, live))
  if (settings.profile.enabled && live > 0) add(profileWidget(p, frame, settings, live))
  if (settings.text.enabled) add(textWidget(p, settings))
  if (settings.logo.enabled) add(logoWidget(p, settings, assets))

  const positions = layoutWidgets(widgets, size, 2 * p.u)
  widgets.forEach((widget, i) => {
    ctx.save()
    ctx.globalAlpha = widget.opacity
    widget.draw(positions[i].x, positions[i].y)
    ctx.restore()
  })
  ctx.restore()
}

/**
 * `drawOverlay` bound to one track, settings and assets, with the signature of the video export
 * (`DrawOverlay` in src/export/capture.ts): (context, progress, width, height) in video pixels.
 */
export function createOverlayDrawer(track: OverlayTrack, settings: OverlaySettings, assets: OverlayAssets = {}) {
  return (ctx: OverlayContext2D, progress: number, width: number, height: number): void =>
    drawOverlay(ctx, overlayFrameAt(track, progress), settings, { width, height }, assets)
}

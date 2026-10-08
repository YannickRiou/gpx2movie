/**
 * Marker badges drawn on a 2D canvas (no Three.js): the round picture a progress marker shows — a plain disc
 * (« boule »), a pictogram on a coloured disc (« figurine ») or a picture cut to a circle (« image »), each with
 * its ring. Also turns a picture chosen by the user into the small square data URL kept in the settings.
 */
import { FIGURE_GRID, MARKER_FIGURE_PATHS } from './markerFigures'
import type { MarkerFigure } from './markerSettings'

/** `--color-ink` and white of the « Carte alpine » theme. */
export const BADGE_INK = '#1C2A33'
export const BADGE_WHITE = '#FFFFFF'

/** Ring of the figure and picture badges, as a fraction of the badge radius. */
export const BADGE_RING = 0.12
/** Side of the pictogram as a fraction of the radius: its corners stay inside the coloured disc. */
const FIGURE_SCALE = 1.15
/** Stroke of the pictograms on their 24-unit grid (the interface icons use 2; a touch bolder reads better small). */
const FIGURE_STROKE = 2.2
/** Side of the stored marker picture (pixels): enough for a badge of a 4K film, small in the project file. */
export const AVATAR_SIZE_PX = 128

export type Badge =
  /** `ringWidth`: fraction of the radius taken by the ring */
  | { kind: 'disc'; fill: string; ring?: string; ringWidth?: number }
  | { kind: 'figure'; figure: MarkerFigure; fill: string; ring: string; mirrored: boolean }
  | { kind: 'image'; image: CanvasImageSource; width: number; height: number; ring: string }

/** Builds a path from SVG path data (injectable: test environments have no `Path2D`). */
export type PathFactory = (d: string) => Path2D

const defaultPath: PathFactory = (d) => new Path2D(d)

/** Relative luminance (WCAG) of a `#RRGGBB` colour. */
export function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

/** Ink or white, whichever reads better on `fill` (light track colours get an ink pictogram). */
export function readableInk(fill: string): string {
  return luminance(fill) > 0.3 ? BADGE_INK : BADGE_WHITE
}

/** Centred square of a `width × height` picture (the part a round badge shows). */
export function squareCrop(width: number, height: number): { x: number; y: number; side: number } {
  const side = Math.min(width, height)
  return { x: (width - side) / 2, y: (height - side) / 2, side }
}

function fillCircle(ctx: CanvasRenderingContext2D, centre: number, radius: number, color: string): void {
  ctx.beginPath()
  ctx.arc(centre, centre, radius, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
}

function drawFigure(
  ctx: CanvasRenderingContext2D,
  badge: Extract<Badge, { kind: 'figure' }>,
  centre: number,
  radius: number,
  makePath: PathFactory,
): void {
  const scale = (radius * FIGURE_SCALE) / FIGURE_GRID
  ctx.save()
  ctx.translate(centre, centre)
  if (badge.mirrored) ctx.scale(-1, 1)
  ctx.scale(scale, scale)
  ctx.translate(-FIGURE_GRID / 2, -FIGURE_GRID / 2)
  ctx.lineWidth = FIGURE_STROKE
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = readableInk(badge.fill)
  for (const d of MARKER_FIGURE_PATHS[badge.figure]) ctx.stroke(makePath(d))
  ctx.restore()
}

function drawPicture(ctx: CanvasRenderingContext2D, badge: Extract<Badge, { kind: 'image' }>, centre: number, radius: number): void {
  const crop = squareCrop(badge.width, badge.height)
  ctx.save()
  ctx.beginPath()
  ctx.arc(centre, centre, radius, 0, Math.PI * 2)
  ctx.clip()
  ctx.drawImage(badge.image, crop.x, crop.y, crop.side, crop.side, centre - radius, centre - radius, 2 * radius, 2 * radius)
  ctx.restore()
}

/** Draw `badge` filling a `size × size` canvas (transparent around the disc). */
export function drawBadge(ctx: CanvasRenderingContext2D, size: number, badge: Badge, makePath: PathFactory = defaultPath): void {
  const centre = size / 2
  // one pixel of margin keeps the antialiased edge inside the texture
  const radius = centre - 1
  const inner = radius * (1 - BADGE_RING)
  ctx.clearRect(0, 0, size, size)
  switch (badge.kind) {
    case 'disc':
      fillCircle(ctx, centre, radius, badge.ring ?? badge.fill)
      if (badge.ring) fillCircle(ctx, centre, radius * (1 - (badge.ringWidth ?? BADGE_RING)), badge.fill)
      return
    case 'figure':
      fillCircle(ctx, centre, radius, badge.ring)
      fillCircle(ctx, centre, inner, badge.fill)
      drawFigure(ctx, badge, centre, radius, makePath)
      return
    case 'image':
      fillCircle(ctx, centre, radius, badge.ring)
      drawPicture(ctx, badge, centre, inner)
  }
}

/** Decode a picture (the data URL of `settings.marker.image`, or an object URL). */
export function loadMarkerImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image illisible.'))
    image.src = src
  })
}

/** Picture file (photo, avatar) -> its centred square as a PNG data URL of AVATAR_SIZE_PX pixels. */
export async function fileToAvatarDataUrl(file: Blob, size = AVATAR_SIZE_PX): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await loadMarkerImage(url)
    // an SVG without intrinsic size reports 0 × 0: draw it at the target size
    const crop = squareCrop(image.naturalWidth || size, image.naturalHeight || size)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Image illisible.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, crop.x, crop.y, crop.side, crop.side, 0, 0, size, size)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

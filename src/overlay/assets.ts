/**
 * Asynchronous resources of the overlay, loaded before drawing (`drawOverlay` itself stays synchronous):
 * the web fonts of the three styles and the logo image. Also turns an image file chosen by the user into
 * the bounded PNG data URL kept in the settings.
 */
import type { OverlayAssets } from './draw'
import { LOGO_MAX_SIZE_PX } from './settings'
import { OVERLAY_FONTS } from './themes'

/**
 * Resolve once the overlay fonts can be drawn. A canvas never triggers a web font download by itself, so
 * each face is requested explicitly; a face that cannot load falls back to the next family (no rejection).
 */
export async function loadOverlayFonts(fonts: FontFaceSet | undefined = globalThis.document?.fonts): Promise<void> {
  if (!fonts) return
  await Promise.all(OVERLAY_FONTS.map((font) => fonts.load(font).catch(() => [])))
  await fonts.ready
}

/** Size of an image scaled down (never up) so that its longest side is at most `max`. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image illisible.'))
    image.src = src
  })
}

/** Decoded logo for `drawOverlay` (null for an empty data URL). */
export async function loadLogo(dataUrl: string): Promise<OverlayAssets['logo']> {
  if (!dataUrl) return null
  const image = await decode(dataUrl)
  return { image, width: image.naturalWidth, height: image.naturalHeight }
}

/** Image file (PNG, JPEG, WebP, SVG…) -> PNG data URL at most LOGO_MAX_SIZE_PX on its longest side. */
export async function fileToLogoDataUrl(file: Blob, max = LOGO_MAX_SIZE_PX): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await decode(url)
    // an SVG without intrinsic size reports 0 × 0: give it the maximum size
    const { width, height } = fitWithin(image.naturalWidth || max, image.naturalHeight || max, max)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Image illisible.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, width, height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

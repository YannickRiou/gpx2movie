/**
 * Thumbnail of the 3D view for « Mes projets » (taken by ui/library.ts at each write, loaded with the scene). The
 * canvas draws on demand and without `preserveDrawingBuffer`: its picture can only be read in the task that drew it,
 * before the browser composites it. So one frame is asked for (`invalidate`) and copied from R3F's after-effect of
 * that frame (after every root and its post-processing rendered, still in the same animation-frame task) onto a small
 * 2D canvas over the CSS sky (the 3D canvas is transparent without the atmosphere). Nothing in the scene changes:
 * no extra render pass, no buffer kept.
 */
import { addAfterEffect, invalidate } from '@react-three/fiber'
import { SKY_HORIZON_COLOR, SKY_TOP_COLOR } from './FlyoverCanvas'

/** Longest side of a thumbnail (px): twice its size in the list. */
export const THUMBNAIL_MAX_SIDE = 240
const THUMBNAIL_QUALITY = 0.7
/** No frame drawn within this time (export driving the frames, lost context): no thumbnail. */
const CAPTURE_TIMEOUT_MS = 2000

/** The 3D view as a small JPEG data URL; null when it cannot be read (no view, hidden page, no frame, tainted canvas). */
export function captureThumbnail(
  // the view's WebGL canvas, tagged by three.js
  canvas = document.querySelector<HTMLCanvasElement>('.view__stage canvas[data-engine^="three.js"]'),
): Promise<string | null> {
  // a hidden page draws no frame: the write that waits for it (page left) goes on at once
  if (!canvas || canvas.width === 0 || canvas.height === 0 || document.visibilityState === 'hidden') return Promise.resolve(null)
  return new Promise((resolve) => {
    const done = (picture: string | null) => {
      clearTimeout(timer)
      stop()
      resolve(picture)
    }
    const timer = setTimeout(() => done(null), CAPTURE_TIMEOUT_MS)
    const stop = addAfterEffect(() => {
      try {
        done(copyView(canvas))
      } catch {
        done(null) // tainted canvas (a tile without CORS)
      }
    })
    invalidate()
  })
}

function copyView(canvas: HTMLCanvasElement): string | null {
  const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(canvas.width, canvas.height))
  const thumb = document.createElement('canvas')
  thumb.width = Math.max(1, Math.round(canvas.width * scale))
  thumb.height = Math.max(1, Math.round(canvas.height * scale))
  const context = thumb.getContext('2d')
  if (!context) return null
  const sky = context.createLinearGradient(0, 0, 0, thumb.height)
  sky.addColorStop(0, SKY_TOP_COLOR)
  sky.addColorStop(1, SKY_HORIZON_COLOR)
  context.fillStyle = sky
  context.fillRect(0, 0, thumb.width, thumb.height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(canvas, 0, 0, thumb.width, thumb.height)
  return thumb.toDataURL('image/jpeg', THUMBNAIL_QUALITY)
}

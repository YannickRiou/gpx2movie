/**
 * Safe zones of the output formats (« Zones de sécurité », preview only, never exported): pure geometry, as fractions
 * of the frame. Landscape and square formats: the action-safe (93 %) and title-safe (90 %) margins of EBU R 95.
 * Vertical formats (9:16, 4:5): the areas covered by the interface of the vertical video feeds (Reels, TikTok, Shorts),
 * one union of the three measured on a 1080 x 1920 screen; a 4:5 frame is shown full width in the middle of that
 * screen, so only part of these areas covers it.
 */
import type { VideoAspect } from '../export/schedule'
import { VIDEO_ASPECTS } from '../export/schedule'

/** A rectangle in fractions of the frame, from its top left corner. */
export interface FrameBox {
  left: number
  top: number
  width: number
  height: number
}

export interface SafeZoneLayout {
  /** margins drawn as outlines, outermost first */
  guides: { label: string; box: FrameBox }[]
  /** areas hidden by an interface, drawn shaded */
  covered: { label: string; box: FrameBox }[]
}

/** EBU R 95: share of the width and height kept by each margin. */
const TV_MARGINS = [
  { label: 'Action 93 %', keep: 0.93 },
  { label: 'Titres 90 %', keep: 0.9 },
] as const

/** Reference phone screen of the vertical feeds, pixels. */
const PHONE = { width: 1080, height: 1920 } as const

/** Union of the Reels / TikTok / Shorts overlays on the phone screen, pixels (rounded up to the safest value). */
const PHONE_INTERFACE = [
  { label: 'Interface du haut', left: 0, top: 0, width: 1080, height: 220 },
  { label: 'Boutons', left: 920, top: 760, width: 160, height: 720 },
  { label: 'Légende et musique', left: 0, top: 1480, width: 1080, height: 440 },
] as const

function inset(keep: number): FrameBox {
  const margin = (1 - keep) / 2
  return { left: margin, top: margin, width: keep, height: keep }
}

/**
 * The phone interface areas over a frame of `ratio` (width / height) fitted inside the phone screen and centred,
 * clipped to the frame; areas that miss it are left out.
 */
export function phoneInterfaceOver(ratio: number): SafeZoneLayout['covered'] {
  const width = Math.min(PHONE.width, PHONE.height * ratio)
  const height = width / ratio
  const frameLeft = (PHONE.width - width) / 2
  const frameTop = (PHONE.height - height) / 2
  const covered: SafeZoneLayout['covered'] = []
  for (const area of PHONE_INTERFACE) {
    const left = Math.max(area.left, frameLeft)
    const top = Math.max(area.top, frameTop)
    const right = Math.min(area.left + area.width, frameLeft + width)
    const bottom = Math.min(area.top + area.height, frameTop + height)
    if (right <= left || bottom <= top) continue
    covered.push({
      label: area.label,
      box: { left: (left - frameLeft) / width, top: (top - frameTop) / height, width: (right - left) / width, height: (bottom - top) / height },
    })
  }
  return covered
}

/** Guides of an output format. */
export function safeZones(aspect: VideoAspect): SafeZoneLayout {
  const format = VIDEO_ASPECTS.find((a) => a.id === aspect) ?? VIDEO_ASPECTS[0]
  if (format.id === '9:16' || format.id === '4:5') return { guides: [], covered: phoneInterfaceOver(format.x / format.y) }
  return { guides: TV_MARGINS.map((m) => ({ label: m.label, box: inset(m.keep) })), covered: [] }
}

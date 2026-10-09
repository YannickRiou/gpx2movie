import type { CSSProperties } from 'react'
import { create } from 'zustand'
import type { VideoAspect } from '../export/schedule'
import { safeZones } from './safeZoneLayout'
import type { FrameBox } from './safeZoneLayout'

/** Shown or not (preview only: neither saved nor undoable, off at start-up); « G » or the button of the view. */
export const useSafeZonesStore = create<{ visible: boolean; toggle(): void }>()((set) => ({
  visible: false,
  toggle: () => set((s) => ({ visible: !s.visible })),
}))

const percent = (box: FrameBox): CSSProperties => ({
  left: `${box.left * 100}%`,
  top: `${box.top * 100}%`,
  width: `${box.width * 100}%`,
  height: `${box.height * 100}%`,
})

/**
 * « Zones de sécurité » over the framed preview (`.view__stage`): margins of the landscape formats, areas hidden by
 * the vertical video apps (geometry in safeZones.ts). DOM over the canvas: the export never sees it.
 */
export function SafeZones({ aspect }: { aspect: VideoAspect }) {
  const { guides, covered } = safeZones(aspect)
  return (
    <div className="safe-zones" aria-hidden="true">
      {covered.map(({ label, box }) => (
        <div key={label} className="safe-zones__covered" style={percent(box)}>
          <span className="safe-zones__label">{label}</span>
        </div>
      ))}
      {/* the outer margin is labelled in its top left corner, the inner one in its bottom right corner */}
      {guides.map(({ label, box }, i) => (
        <div key={label} className={i === 0 ? 'safe-zones__guide' : 'safe-zones__guide safe-zones__guide--inner'} style={percent(box)}>
          <span className="safe-zones__label">{label}</span>
        </div>
      ))}
    </div>
  )
}

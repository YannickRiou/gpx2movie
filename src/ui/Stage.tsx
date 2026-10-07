import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { VIDEO_ASPECTS } from '../export/schedule'
import { isExportBusy, useExportStore } from '../export/store'
import { OverlayCanvas } from '../overlay/OverlayCanvas'
import { FlyoverCanvas } from '../scene/FlyoverCanvas'
import { useAppStore } from '../state/store'
import { Icon } from './icons'
import { frameRect } from './shell'
import { TrackLegend } from './TrackLegend'

/**
 * Centre of the shell: the 3D view and its overlay framed to the output format (letterbox in ink, the export
 * renders exactly this area), or filling the stage with « Libre »; the « Recadrer » button and the notices
 * (`children`) float over it.
 */
export function Stage({ children }: { children?: ReactNode }) {
  const aspect = useAppStore((s) => {
    if (s.freeFraming) return null
    const a = VIDEO_ASPECTS.find((v) => v.id === s.settings.video.aspect)
    return a ? a.x / a.y : null
  })
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  const trackColored = useAppStore((s) => s.settings.trackColorBy !== 'none')
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  const viewport = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useLayoutEffect(() => {
    const el = viewport.current
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const rect = size && aspect !== null ? frameRect(size.width, size.height, aspect) : null

  return (
    <div ref={viewport} className={aspect === null ? 'view__viewport' : 'view__viewport view__viewport--framed'} role="region" aria-label="Vue 3D">
      {/* .view__stage keeps its name: the overlay canvas and the legend are laid out against it */}
      <div className="view__stage" style={rect ?? undefined}>
        <FlyoverCanvas />
        <OverlayCanvas />
        {trackColored && <TrackLegend />}
      </div>
      {hasTracks && (
        <button
          type="button"
          className="icon-btn icon-btn--float view__fit"
          onClick={() => useAppStore.getState().requestFit()}
          disabled={exporting}
          aria-label="Recadrer la vue"
          data-tip="Recadrer la vue (F)"
          data-tip-side="left"
        >
          <Icon name="crosshair" />
        </button>
      )}
      {children}
    </div>
  )
}

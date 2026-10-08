import { Suspense, lazy, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { VIDEO_ASPECTS } from '../export/schedule'
import { isExportBusy, useExportStore } from '../export/store'
import { OverlayCanvas } from '../overlay/OverlayCanvas'
import { useAppStore } from '../state/store'
import { Icon } from './icons'
import { SafeZones, useSafeZonesStore } from './SafeZones'
import { frameRect } from './shell'
import { withShortcut } from './shortcuts'
import { TrackLegend } from './TrackLegend'

// the 3D scene (three.js, atmosphere, clouds, terrain) is its own chunk: the shell and the welcome card paint first
const FlyoverCanvas = lazy(() => import('../scene/FlyoverCanvas').then((m) => ({ default: m.FlyoverCanvas })))

/**
 * Centre of the shell: the 3D view and its overlay framed to the output format (letterbox in ink, the export
 * renders exactly this area), or filling the stage with « Libre » or without a track; the « Recadrer » and « Zones de
 * sécurité » buttons, the welcome card and the messages (`children`) float over it.
 */
export function Stage({ children }: { children?: ReactNode }) {
  const aspect = useAppStore((s) => {
    // nothing to frame before the first track: the welcome card sits on the whole stage
    if (s.freeFraming || s.tracks.length === 0) return null
    const a = VIDEO_ASPECTS.find((v) => v.id === s.settings.video.aspect)
    return a ? a.x / a.y : null
  })
  const aspectId = useAppStore((s) => s.settings.video.aspect)
  const safeZones = useSafeZonesStore((s) => s.visible)
  const hasArea = useAppStore((s) => s.bounds !== null)
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
        <Suspense>
          <FlyoverCanvas />
        </Suspense>
        <OverlayCanvas />
        {trackColored && <TrackLegend />}
        {rect && safeZones && <SafeZones aspect={aspectId} />}
      </div>
      {hasArea && (
        <button
          type="button"
          className="icon-btn icon-btn--float view__fit"
          onClick={() => useAppStore.getState().requestFit()}
          disabled={exporting}
          aria-label="Recadrer la vue"
          data-tip={withShortcut('Recadrer la vue', 'fit')}
          data-tip-side="left"
        >
          <Icon name="crosshair" />
        </button>
      )}
      {aspect !== null && (
        <button
          type="button"
          className="icon-btn icon-btn--float view__safe-zones"
          onClick={() => useSafeZonesStore.getState().toggle()}
          aria-pressed={safeZones}
          aria-label="Zones de sécurité"
          data-tip={withShortcut('Zones de sécurité (aperçu seulement)', 'safe-zones')}
          data-tip-side="left"
        >
          <Icon name="square-dashed" />
        </button>
      )}
      {children}
    </div>
  )
}

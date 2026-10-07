/**
 * Bridge between the film overlay and the video export: the export draws every frame through the same
 * `drawOverlay` as the preview (OverlayCanvas), so the movie shows exactly what the viewer sees.
 *
 * The export draws synchronously, so the logo is loaded ahead of time, whenever the setting changes.
 */
import type { Track } from '../core/types'
import type { DrawOverlay } from '../export/capture'
import { useAppStore } from '../state/store'
import { loadLogo } from './assets'
import { overlayFrameAt, prepareOverlayTrack } from './data'
import type { OverlayTrack } from './data'
import { drawOverlay } from './draw'
import type { OverlayAssets } from './draw'

export interface OverlayDrawer {
  draw: DrawOverlay
  dispose(): void
}

export function createOverlayDrawer(): OverlayDrawer {
  let track: Track | undefined
  let data: OverlayTrack | null = null
  let logoSource = ''
  let assets: OverlayAssets = {}
  let disposed = false

  const syncLogo = (source: string) => {
    if (source === logoSource) return
    logoSource = source
    assets = {}
    if (!source) return
    loadLogo(source)
      .then((logo) => {
        if (!disposed && logoSource === source) assets = { logo }
      })
      .catch(() => {
        // unreadable image: drawn without logo
      })
  }
  syncLogo(useAppStore.getState().settings.overlay.logo.image)
  const unsubscribe = useAppStore.subscribe((state) => syncLogo(state.settings.overlay.logo.image))

  return {
    draw(ctx, progress, width, height) {
      const { tracks, settings } = useAppStore.getState()
      const first = tracks[0]
      if (!first) return
      if (first !== track || !data) {
        track = first
        data = prepareOverlayTrack(first)
      }
      drawOverlay(ctx, overlayFrameAt(data, progress), settings.overlay, { width, height }, assets)
    },
    dispose() {
      disposed = true
      unsubscribe()
    },
  }
}

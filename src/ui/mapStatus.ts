/**
 * Map state of the status bar (« Carte · 72 % » / « Carte prête »), derived from the terrain stats.
 * Pure: the caller passes the time, so the smoothing is testable.
 */
import type { TerrainStats } from '../core/types'

/** A load shorter than this never shows: a small camera move stays « Carte prête ». */
export const MAP_LOADING_DELAY_MS = 500
/** Shown progress stops here until the view has every tile (never « 100 % » while loading). */
const MAX_LOADING_PROGRESS = 0.99

export type MapPhase = 'idle' | 'loading' | 'ready'

export interface MapStatus {
  /** state of the tiles: nothing yet, view still waiting for tiles, view complete */
  phase: MapPhase
  /** state on screen: a load is shown only once it lasts MAP_LOADING_DELAY_MS */
  shown: MapPhase
  /** share of the view drawn, 0–0.99 while loading and never going back during one load; 1 when ready */
  progress: number
  /** start of the current load, ms */
  since: number
  failed: number
}

export const IDLE_MAP_STATUS: MapStatus = { phase: 'idle', shown: 'idle', progress: 0, since: 0, failed: 0 }

/** Share of the current view already final: drawn tiles over drawn + awaited ones. */
export function viewProgress(stats: TerrainStats): number {
  const pending = stats.pendingVisibleTiles ?? stats.pendingTiles
  const total = stats.visibleTiles + pending
  return total > 0 ? stats.visibleTiles / total : 1
}

export function nextMapStatus(prev: MapStatus, stats: TerrainStats, nowMs: number): MapStatus {
  const failed = stats.failedTiles
  const pending = stats.pendingVisibleTiles ?? stats.pendingTiles
  if (stats.visibleTiles === 0 && stats.loadedTiles === 0 && pending === 0 && failed === 0) return IDLE_MAP_STATUS
  if (pending === 0) return { phase: 'ready', shown: 'ready', progress: 1, since: 0, failed }

  const raw = Math.min(viewProgress(stats), MAX_LOADING_PROGRESS)
  const continuing = prev.phase === 'loading'
  const since = continuing ? prev.since : nowMs
  const progress = continuing ? Math.max(prev.progress, raw) : raw
  // until the delay, the previous resting state stays on screen (nothing at the very start, « Carte prête » later)
  const shown = nowMs - since >= MAP_LOADING_DELAY_MS ? 'loading' : continuing ? prev.shown : prev.phase
  return { phase: 'loading', shown, progress, since, failed }
}

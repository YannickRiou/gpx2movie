/**
 * Export state (zustand), separate from the app store: the panel requests an export, the controller mounted
 * in the 3D scene runs it and reports its progress here.
 *
 * phase: idle → starting (requested, waiting for the controller) → rendering → finalizing → done | error | canceled
 *
 * Also shared with the scene during an export: the render scale (pixel-sized elements grow with the video) and
 * the drape-flush registry (the track and the labels re-drape synchronously instead of after their debounce).
 */
import { create } from 'zustand'
import type { VideoQuality } from './schedule'

export type ExportPhase = 'idle' | 'starting' | 'rendering' | 'finalizing' | 'done' | 'error' | 'canceled'

export interface ExportRequest {
  /** increasing id: the controller runs each request once */
  id: number
  width: number
  height: number
  fps: number
  quality: VideoQuality
  /** film duration of the flyover (progress 0 → 1), seconds */
  durationS: number
  /** progress at film time (variable pacing of the flyover); linear when absent */
  progressAt?: (tS: number) => number
  holdStartS: number
  holdEndS: number
  /** file name without extension */
  baseName: string
}

export interface ExportResult {
  /** object URL of the video blob (revoked by `reset` or the next export) */
  url: string
  fileName: string
  mimeType: string
  sizeBytes: number
  /** e.g. 'mp4/avc' */
  codec: string
  /** frames captured before their terrain had finished loading (per-frame timeout) */
  incompleteFrames: number
}

/** Where the export time goes, accumulated over the frames rendered so far (milliseconds). */
export interface ExportTimings {
  /** distinct images rendered (held frames reuse the previous one) */
  rendered: number
  /** `advance` calls: scene update + WebGL render */
  renderMs: number
  /** waiting for tiles between renders */
  waitMs: number
  /** composing and encoding */
  encodeMs: number
  /** images captured at the per-frame timeout */
  timeouts: number
}

export const EMPTY_TIMINGS: ExportTimings = { rendered: 0, renderMs: 0, waitMs: 0, encodeMs: 0, timeouts: 0 }

/**
 * Short side of the frame at which pixel-sized scene elements (labels, track width) keep their preview size;
 * a 4K film (short side 2160) draws them twice as large, so they cover the same share of the image.
 */
export const RENDER_SCALE_REFERENCE_PX = 1080

export function exportRenderScale(width: number, height: number): number {
  return Math.min(width, height) / RENDER_SCALE_REFERENCE_PX
}

export interface ExportState {
  phase: ExportPhase
  request: ExportRequest | null
  cancelRequested: boolean
  /** frames encoded so far / total */
  frame: number
  frameCount: number
  /** performance.now() when rendering started */
  startedAt: number
  /** estimated remaining time in seconds, null until the first frame */
  etaS: number | null
  result: ExportResult | null
  error: string | null
  timings: ExportTimings
  /** multiplier of pixel-sized scene elements: `exportRenderScale` during an export, 1 otherwise */
  renderScale: number

  start(request: Omit<ExportRequest, 'id'>): void
  cancel(): void
  /** forget the last result (revokes its URL) or error */
  reset(): void

  // reported by the controller
  begin(id: number, frameCount: number, now: number): boolean
  reportFrame(frame: number, now: number, timings?: ExportTimings): void
  setRenderScale(scale: number): void
  finalizing(): void
  complete(result: ExportResult): void
  fail(message: string): void
  canceled(): void
}

export const BUSY_PHASES: readonly ExportPhase[] = ['starting', 'rendering', 'finalizing']

export function isExportBusy(phase: ExportPhase): boolean {
  return BUSY_PHASES.includes(phase)
}

/** Remaining seconds from the average time per frame so far, null before the first frame. */
export function estimateRemainingS(elapsedMs: number, done: number, total: number): number | null {
  if (done <= 0 || elapsedMs < 0) return null
  return ((elapsedMs / done) * Math.max(0, total - done)) / 1000
}

/** `<name><extension>` without the characters file systems reject; 'openflyover' when nothing is left. */
export function videoFileName(name: string, extension: string): string {
  const safe = name
    .replace(/\s+/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/^[\s.-]+|[\s.]+$/g, '')
  return `${safe || 'openflyover'}${extension}`
}

let nextId = 1

const IDLE = {
  phase: 'idle' as ExportPhase,
  request: null,
  cancelRequested: false,
  frame: 0,
  frameCount: 0,
  startedAt: 0,
  etaS: null,
  result: null,
  error: null,
  timings: EMPTY_TIMINGS,
  renderScale: 1,
}

function revoke(result: ExportResult | null): void {
  if (result) URL.revokeObjectURL(result.url)
}

export const useExportStore = create<ExportState>()((set, get) => ({
  ...IDLE,

  start(request) {
    if (isExportBusy(get().phase)) return
    revoke(get().result)
    set({ ...IDLE, phase: 'starting', request: { ...request, id: nextId++ } })
  },

  cancel() {
    const { phase } = get()
    // not picked up by a controller yet: nothing to stop
    if (phase === 'starting') set({ phase: 'canceled', request: null })
    else if (phase === 'rendering' || phase === 'finalizing') set({ cancelRequested: true })
  },

  reset() {
    if (isExportBusy(get().phase)) return
    revoke(get().result)
    set({ ...IDLE })
  },

  begin(id, frameCount, now) {
    const { phase, request } = get()
    if (phase !== 'starting' || request?.id !== id) return false
    set({ phase: 'rendering', frame: 0, frameCount, startedAt: now, etaS: null, timings: EMPTY_TIMINGS })
    return true
  },

  reportFrame(frame, now, timings) {
    const { startedAt, frameCount } = get()
    set({ frame, etaS: estimateRemainingS(now - startedAt, frame, frameCount), ...(timings && { timings: { ...timings } }) })
  },

  setRenderScale(renderScale) {
    if (renderScale !== get().renderScale) set({ renderScale })
  },

  finalizing() {
    set({ phase: 'finalizing', etaS: null })
  },

  complete(result) {
    set({ phase: 'done', request: null, cancelRequested: false, etaS: null, result })
  },

  fail(message) {
    set({ phase: 'error', request: null, cancelRequested: false, etaS: null, error: message })
  },

  canceled() {
    set({ phase: 'canceled', request: null, cancelRequested: false, etaS: null })
  },
}))

/** Back to the initial state (tests). */
export function resetExportStore(): void {
  revoke(useExportStore.getState().result)
  useExportStore.setState({ ...IDLE })
}

// ---------------------------------------------------------------------------
// Drape flushes
// ---------------------------------------------------------------------------

/** Runs a pending debounced re-drape now; returns true when there was one. */
export type DrapeFlush = () => boolean

const drapeFlushes = new Set<DrapeFlush>()

/** Scene components with a debounced re-drape register it here (returns the unregister function). */
export function registerDrapeFlush(flush: DrapeFlush): () => void {
  drapeFlushes.add(flush)
  return () => {
    drapeFlushes.delete(flush)
  }
}

/** Run every pending re-drape now; true when at least one ran (the scene must be rendered again). */
export function flushDrapes(): boolean {
  let flushed = false
  for (const flush of drapeFlushes) flushed = flush() || flushed
  return flushed
}

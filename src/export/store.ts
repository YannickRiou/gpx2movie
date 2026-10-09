/**
 * Export state (zustand), separate from the app store: the panel requests an export, the controller mounted in the 3D
 * scene runs it and reports its progress here. phase: idle > starting > rendering > finalizing > done | error | canceled.
 *
 * Also shared with the scene during an export: the render scale (pixel-sized elements grow with the video) and the
 * drape-flush registry (the track and the labels re-drape synchronously instead of after their debounce).
 * A film goes straight to disk when the platform can stream (`chooseVideoDestination`, asked from the click that starts
 * the export), else it is kept in memory and downloaded at the end.
 */
import { create } from 'zustand'
import type { TrackPath } from '../flyover/path'
import type { Platform, WritableFile } from '../platform'
import { showToast } from '../ui/toast'
import type { VideoQuality } from './schedule'

export type ExportPhase = 'idle' | 'starting' | 'rendering' | 'finalizing' | 'done' | 'error' | 'canceled'

export type StillType = 'image/png' | 'image/jpeg'

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
  /** a still image of this progress instead of the film (the timing fields are then unused) */
  still?: {
    progress: number
    type: StillType
    /** the whole track from the south (overview shot framing) instead of the view at `progress`, no marker */
    overview?: boolean
    /** what the overview frames (default: the first track) */
    framing?: TrackPath
    /** the view drawn without the scene (flat map poster), in place of a 3D render */
    drawView?: (signal: AbortSignal) => Promise<OffscreenCanvas>
    /** draws the rendered image into the final picture (the poster), in place of the film overlay */
    compose?: (view: OffscreenCanvas) => Promise<OffscreenCanvas>
  }
  /** film written to this file while encoding (removed if the export does not finish) */
  destination?: WritableFile
  /** the overlay alone over a transparent background, same frames as the film, no 3D render and no sound (WebM / VP9) */
  overlayOnly?: boolean
}

export interface ExportResult {
  /** object URL of the video or image blob (revoked by `reset` or the next export); null when written to disk */
  url: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  /** e.g. 'mp4/avc', 'png' */
  codec: string
  /** frames captured before their terrain had finished loading (per-frame timeout) */
  incompleteFrames: number
  /** about the soundtrack, shown with the result ('avec le son (AAC)', 'sans le son : …') */
  note?: string
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
  /** seconds per frame and per megapixel of the last film exported (time hint of a batch), kept by `start` and `reset` */
  secondsPerMegapixel: number | null

  start(request: Omit<ExportRequest, 'id'>): void
  cancel(): void
  /** forget the last result (revokes its URL) or error */
  reset(): void
  /** hand the last result over without revoking its URL (a batch keeps every file of its run) */
  takeResult(): ExportResult | null

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

/** Base name of a still image: `<name> <progress in %>`, e.g. 'Tour 42 %'. */
export function stillBaseName(name: string, progress: number): string {
  return `${name} ${Math.round(progress * 100)} %`
}

/** Base name of the overlay alone: `<name> habillage`. */
export function overlayBaseName(name: string): string {
  return `${name} habillage`
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
  if (result?.url) URL.revokeObjectURL(result.url)
}

/** A request that will not run: its destination file is removed. */
function drop(request: Pick<ExportRequest, 'destination'> | null): void {
  void request?.destination?.discard().catch(() => undefined)
}

/** Above this estimate, a film kept in memory (about twice its size at the end) may exhaust the tab. */
export const MEMORY_WARN_BYTES = 1.5e9

/** The size estimate warns: a large film that cannot be written straight to disk. */
export function warnsInMemory(estimatedBytes: number, streamsToDisk: boolean): boolean {
  return !streamsToDisk && estimatedBytes > MEMORY_WARN_BYTES
}

/**
 * Where a film goes: `start: false` when the user closed the save dialog; `destination` when it is written while
 * encoding; neither in memory (no streaming here, or the dialog failed). Call it from the click that starts the
 * export: the browser's picker needs that gesture.
 */
export async function chooseVideoDestination(
  platform: Pick<Platform, 'capabilities' | 'createWritableFile'>,
  fileName: string,
): Promise<{ start: boolean; destination?: WritableFile }> {
  if (!platform.capabilities.canStreamToDisk) return { start: true }
  try {
    const destination = await platform.createWritableFile({ fileName })
    return destination ? { start: true, destination } : { start: false }
  } catch (error) {
    console.warn("[export] écriture directe impossible, film gardé en mémoire :", error)
    showToast({ kind: 'info', text: 'Écriture directe impossible : le film sera téléchargé à la fin.' })
    return { start: true }
  }
}

/** Seconds per frame and per megapixel of a finished film, null when nothing was measured. */
export function filmRate(timings: ExportTimings, frameCount: number, width: number, height: number): number | null {
  const spentMs = timings.renderMs + timings.waitMs + timings.encodeMs
  const megapixels = (width * height) / 1e6
  return frameCount > 0 && spentMs > 0 && megapixels > 0 ? spentMs / 1000 / frameCount / megapixels : null
}

export const useExportStore = create<ExportState>()((set, get) => ({
  ...IDLE,
  secondsPerMegapixel: null,

  start(request) {
    if (isExportBusy(get().phase)) return drop(request)
    revoke(get().result)
    set({ ...IDLE, phase: 'starting', request: { ...request, id: nextId++ } })
  },

  cancel() {
    const { phase, request } = get()
    // not picked up by a controller yet: nothing to stop
    if (phase === 'starting') {
      drop(request)
      set({ phase: 'canceled', request: null })
    } else if (phase === 'rendering' || phase === 'finalizing') set({ cancelRequested: true })
  },

  reset() {
    if (isExportBusy(get().phase)) return
    revoke(get().result)
    set({ ...IDLE })
  },

  takeResult() {
    const { result } = get()
    if (result) set({ result: null })
    return result
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
    const { request, timings, frameCount, secondsPerMegapixel } = get()
    const rate = request && !request.still ? filmRate(timings, frameCount, request.width, request.height) : null
    set({ phase: 'done', request: null, cancelRequested: false, etaS: null, result, secondsPerMegapixel: rate ?? secondsPerMegapixel })
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
  useExportStore.setState({ ...IDLE, secondsPerMegapixel: null })
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

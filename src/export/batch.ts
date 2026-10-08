/**
 * Batch export (« Plusieurs formats »): the same film in several formats in one go, plus optionally a still image and
 * the poster. The jobs run one after the other through the export store and its controller (one export at a time,
 * the view restored after each, the tile cache shared by them), in the order of the format list.
 *
 * Destination: a folder picked once (`pickFolder`) receives every file, named « <projet> – 16x9-1080p.mp4 »; without
 * it, each file kept in memory is saved as soon as it is ready (`save`) and its URL kept for « Enregistrer à nouveau ».
 *
 * Pure (tested): the job list, the names, the estimate, the progress line and `runBatch` (sequencing with an injected
 * runner). `exportJob` drives the real export store; the batch store keeps the selection and the last run.
 */
import { create } from 'zustand'
import type { WritableFolder } from '../platform/folder'
import { VIDEO_ASPECTS, VIDEO_RESOLUTIONS, videoSize } from './schedule'
import type { VideoAspect, VideoResolution } from './schedule'
import { isExportBusy, useExportStore, videoFileName } from './store'
import type { ExportRequest, ExportResult, ExportState, StillType } from './store'

export interface BatchFormat {
  aspect: VideoAspect
  resolution: VideoResolution
}

interface SizedJob extends BatchFormat {
  key: string
  /** shown in the drawer: '16:9 1080p' */
  label: string
  /** in the file names: '16x9-1080p' */
  tag: string
  width: number
  height: number
}

export type BatchJob =
  | (SizedJob & { kind: 'video' })
  /** a still image of the playback position */
  | (SizedJob & { kind: 'still' })
  /** the poster, with its own settings (`startPoster`) */
  | { kind: 'poster'; key: 'poster'; label: string; tag: string }

/** What is ticked in the drawer. */
export interface BatchSelection {
  /** `formatKey` of each film */
  formats: readonly string[]
  still: boolean
  poster: boolean
}

/** '16:9@1080p' */
export function formatKey(aspect: VideoAspect, resolution: VideoResolution): string {
  return `${aspect}@${resolution}`
}

function sized(aspect: VideoAspect, resolution: VideoResolution): SizedJob {
  const r = VIDEO_RESOLUTIONS.find((v) => v.id === resolution) ?? VIDEO_RESOLUTIONS[1]
  return {
    key: formatKey(aspect, resolution),
    aspect,
    resolution,
    label: `${aspect} ${r.label}`,
    tag: `${aspect.replace(':', 'x')}-${r.label}`,
    ...videoSize(aspect, resolution),
  }
}

/**
 * Jobs of a selection: the films in the order of the format list (aspects, then resolutions), unknown or repeated
 * keys dropped, then the still image (at `stillFormat`, the format of the « Vidéo » mode), then the poster.
 */
export function buildBatchJobs(selection: BatchSelection, stillFormat: BatchFormat): BatchJob[] {
  const ticked = new Set(selection.formats)
  const jobs: BatchJob[] = []
  for (const a of VIDEO_ASPECTS)
    for (const r of VIDEO_RESOLUTIONS) if (ticked.has(formatKey(a.id, r.id))) jobs.push({ kind: 'video', ...sized(a.id, r.id) })
  if (selection.still) {
    const job = sized(stillFormat.aspect, stillFormat.resolution)
    jobs.push({ kind: 'still', ...job, key: `still@${job.key}`, label: `Image fixe ${job.label}` })
  }
  if (selection.poster) jobs.push({ kind: 'poster', key: 'poster', label: 'Affiche', tag: 'affiche' })
  return jobs
}

/** File name without extension: « <projet> – 16x9-1080p », « <projet> – image 16x9-1080p », « <projet> – affiche ». */
export function batchBaseName(projectName: string, job: BatchJob): string {
  return `${projectName} – ${job.kind === 'still' ? `image ${job.tag}` : job.tag}`
}

export interface BatchEstimate {
  /** files of the batch */
  files: number
  /** frames to render, every film counted */
  frames: number
  /** size of the films whose codec is known */
  bytes: number
  /** films whose size is unknown (codec not probed yet, or none) */
  unknownSizes: number
  /** rendering time from the speed of the last film exported, null when none was measured */
  seconds: number | null
}

/**
 * Total of a batch: every film has `frames` frames (same film and frame rate), a still or the poster one image.
 * `bytesOf` gives the size of a film (null when unknown); the time is frames × megapixels × `secondsPerMegapixel`.
 */
export function estimateBatch(
  jobs: readonly BatchJob[],
  frames: number,
  bytesOf: (job: Extract<BatchJob, { kind: 'video' }>) => number | null,
  secondsPerMegapixel: number | null,
): BatchEstimate {
  let total = 0
  let bytes = 0
  let unknownSizes = 0
  let megapixelFrames = 0
  for (const job of jobs) {
    if (job.kind !== 'video') {
      total += 1
      continue
    }
    total += frames
    megapixelFrames += (frames * job.width * job.height) / 1e6
    const size = bytesOf(job)
    if (size === null) unknownSizes++
    else bytes += size
  }
  return {
    files: jobs.length,
    frames: total,
    bytes,
    unknownSizes,
    seconds: secondsPerMegapixel === null ? null : megapixelFrames * secondsPerMegapixel,
  }
}

export type BatchStatus = 'pending' | 'running' | 'done' | 'error' | 'canceled'

export type JobOutcome = { status: 'done'; result: ExportResult } | { status: 'error'; error: string } | { status: 'canceled' }

export interface BatchJobState {
  job: BatchJob
  status: BatchStatus
  /** the file (`url` null once written to disk) */
  result?: ExportResult
  error?: string
}

export interface BatchRunner {
  /** export one job; resolves once it has settled (a throw counts as an error of this job) */
  run(job: BatchJob): Promise<JobOutcome>
  /** the user asked to stop */
  canceled(): boolean
  /** every change of the job list */
  report(jobs: readonly BatchJobState[]): void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Run the jobs one after the other. A failed job does not stop the others; a canceled one (or a cancel asked
 * between two jobs) cancels it and every job left.
 */
export async function runBatch(jobs: readonly BatchJob[], runner: BatchRunner): Promise<BatchJobState[]> {
  let states: BatchJobState[] = jobs.map((job) => ({ job, status: 'pending' }))
  const update = (from: number, to: number, patch: Omit<BatchJobState, 'job'>) => {
    states = states.map((s, i) => (i >= from && i < to ? { job: s.job, ...patch } : s))
    runner.report(states)
  }
  for (let i = 0; i < jobs.length; i++) {
    if (runner.canceled()) {
      update(i, jobs.length, { status: 'canceled' })
      break
    }
    update(i, i + 1, { status: 'running' })
    let outcome: JobOutcome
    try {
      outcome = await runner.run(jobs[i])
    } catch (error) {
      outcome = { status: 'error', error: errorMessage(error) }
    }
    update(i, i + 1, outcome)
    if (outcome.status === 'canceled') {
      update(i + 1, jobs.length, { status: 'canceled' })
      break
    }
  }
  return states
}

/** « 2 / 4 · 16:9 1080p · 42 % » for the job running (`fraction` of it done); '' when none is. */
export function batchProgressLabel(jobs: readonly BatchJobState[], fraction: number): string {
  const index = jobs.findIndex((s) => s.status === 'running')
  if (index < 0) return ''
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
  return `${index + 1} / ${jobs.length} · ${jobs[index].job.label} · ${percent} %`
}

/** Counts of a finished run, for its message. */
export function batchSummary(jobs: readonly BatchJobState[]): { done: number; failed: number; canceled: number } {
  return {
    done: jobs.filter((s) => s.status === 'done').length,
    failed: jobs.filter((s) => s.status === 'error').length,
    canceled: jobs.filter((s) => s.status === 'canceled').length,
  }
}

// ---------------------------------------------------------------------------
// One job through the export store
// ---------------------------------------------------------------------------

/** What every job of a run shares. */
export interface BatchContext {
  projectName: string
  /** request fields of the current film, the same for each format */
  film: Pick<ExportRequest, 'fps' | 'quality' | 'durationS' | 'progressAt' | 'holdStartS' | 'holdEndS'>
  still: { progress: number; type: StillType }
  /** receives every file; null: each file kept in memory and handed to `save` */
  folder: WritableFolder | null
  /** extension of the film the browser would encode at this size ('mp4', 'webm'), null when it encodes none */
  containerOf(job: Extract<BatchJob, { kind: 'video' }>): Promise<string | null>
  /** deposit the poster request (`startPoster`); false without a track */
  startPoster(): Promise<boolean>
  /** a file kept in memory, as soon as it is ready (download, platform save) */
  save(result: ExportResult): void
  canceled(): boolean
}

/** Resolves with the export state once the export store is no longer busy. */
function settledExport(): Promise<ExportState> {
  return new Promise((resolve) => {
    let stop = () => {}
    const check = (state: ExportState) => {
      if (isExportBusy(state.phase)) return
      stop()
      resolve(state)
    }
    stop = useExportStore.subscribe(check)
    check(useExportStore.getState())
  })
}

/** An image kept in memory, written into the folder; its URL is then revoked. */
async function writeToFolder(folder: WritableFolder, result: ExportResult & { url: string }): Promise<ExportResult> {
  const bytes = new Uint8Array(await (await fetch(result.url)).arrayBuffer())
  const file = await folder.createFile(result.fileName)
  try {
    await file.write(bytes, 0)
    await file.close()
  } catch (error) {
    await file.discard()
    throw error
  }
  URL.revokeObjectURL(result.url)
  return { ...result, url: null, fileName: file.fileName }
}

/** Hand one job to the export store (or the poster to `startPoster`); the reason when it cannot start. */
async function startJob(job: BatchJob, ctx: BatchContext): Promise<string | null> {
  const store = useExportStore.getState()
  if (job.kind === 'poster') return (await ctx.startPoster()) ? null : 'aucune trace chargée'
  const request = { ...ctx.film, width: job.width, height: job.height, baseName: batchBaseName(ctx.projectName, job) }
  if (job.kind === 'still') {
    store.start({ ...request, still: ctx.still })
    return null
  }
  const container = await ctx.containerOf(job)
  if (!container) return `ce navigateur ne sait pas encoder une vidéo de ${job.width} × ${job.height} pixels`
  const destination = ctx.folder ? await ctx.folder.createFile(videoFileName(request.baseName, `.${container}`)) : undefined
  store.start({ ...request, destination })
  return null
}

/** Export one job through the export store and its controller; resolves once it has settled. */
export async function exportJob(job: BatchJob, ctx: BatchContext): Promise<JobOutcome> {
  const store = useExportStore.getState
  if (isExportBusy(store().phase)) return { status: 'error', error: 'un autre export est en cours' }
  const failure = await startJob(job, ctx)
  if (failure) return { status: 'error', error: failure }
  // asked while the request was being prepared
  if (ctx.canceled()) store().cancel()
  const settled = await settledExport()
  if (settled.phase === 'error') return { status: 'error', error: settled.error ?? 'échec' }
  const result = settled.phase === 'done' ? store().takeResult() : null
  if (!result) return { status: 'canceled' }
  // a film streamed to disk is already in place
  if (result.url === null) return { status: 'done', result }
  if (ctx.folder) {
    try {
      return { status: 'done', result: await writeToFolder(ctx.folder, { ...result, url: result.url }) }
    } catch (error) {
      // the image is not lost: saved like a file kept in memory
      console.warn("[export] écriture dans le dossier impossible, image enregistrée autrement :", error)
    }
  }
  ctx.save(result)
  return { status: 'done', result }
}

// ---------------------------------------------------------------------------
// Batch store
// ---------------------------------------------------------------------------

export type BatchPhase = 'idle' | 'running' | 'finished'

export interface BatchState {
  phase: BatchPhase
  selection: BatchSelection
  /** jobs of the current or last run */
  jobs: BatchJobState[]
  cancelRequested: boolean
  /** folder of the current or last run, null when the files were kept in memory */
  folderName: string | null

  select(patch: Partial<BatchSelection>): void
  /** run the jobs; resolves with their final states (immediately and unchanged when a run is going on) */
  run(jobs: readonly BatchJob[], ctx: Omit<BatchContext, 'canceled'>): Promise<BatchJobState[]>
  /** stop the job running and drop the others */
  cancel(): void
  /** forget the last run (revokes the URLs of the files kept in memory) */
  clear(): void
}

function revokeAll(jobs: readonly BatchJobState[]): void {
  for (const { result } of jobs) if (result?.url) URL.revokeObjectURL(result.url)
}

const DEFAULT_SELECTION: BatchSelection = { formats: [formatKey('16:9', '1080p')], still: false, poster: false }

export const useBatchStore = create<BatchState>()((set, get) => ({
  phase: 'idle',
  selection: DEFAULT_SELECTION,
  jobs: [],
  cancelRequested: false,
  folderName: null,

  select(patch) {
    set({ selection: { ...get().selection, ...patch } })
  },

  async run(jobs, ctx) {
    if (get().phase === 'running') return get().jobs
    revokeAll(get().jobs)
    set({ phase: 'running', jobs: [], cancelRequested: false, folderName: ctx.folder?.name ?? null })
    const canceled = () => get().cancelRequested
    const states = await runBatch(jobs, {
      run: (job) => exportJob(job, { ...ctx, canceled }),
      canceled,
      report: (list) => set({ jobs: [...list] }),
    })
    set({ phase: 'finished', cancelRequested: false })
    return states
  },

  cancel() {
    if (get().phase !== 'running') return
    set({ cancelRequested: true })
    useExportStore.getState().cancel()
  },

  clear() {
    if (get().phase === 'running') return
    revokeAll(get().jobs)
    set({ phase: 'idle', jobs: [], folderName: null })
  },
}))

/** Back to the initial state (tests). */
export function resetBatchStore(): void {
  revokeAll(useBatchStore.getState().jobs)
  useBatchStore.setState({ phase: 'idle', selection: DEFAULT_SELECTION, jobs: [], cancelRequested: false, folderName: null })
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WritableFile } from '../platform'
import type { WritableFolder } from '../platform/folder'
import {
  batchBaseName,
  batchProgressLabel,
  batchSummary,
  buildBatchJobs,
  estimateBatch,
  exportJob,
  formatKey,
  resetBatchStore,
  runBatch,
  useBatchStore,
  type BatchContext,
  type BatchJob,
  type BatchJobState,
  type JobOutcome,
} from './batch'
import { resetExportStore, useExportStore, videoFileName, type ExportRequest } from './store'

const STILL_FORMAT = { aspect: '16:9', resolution: '1080p' } as const

function jobs(...keys: string[]): BatchJob[] {
  return buildBatchJobs({ formats: keys, still: false, poster: false }, STILL_FORMAT)
}

describe('job list', () => {
  it('lists the films in the order of the formats, then the still image and the poster', () => {
    const list = buildBatchJobs(
      {
        formats: [formatKey('9:16', '1080p'), 'nope@720p', formatKey('16:9', '4k'), formatKey('16:9', '1080p'), formatKey('9:16', '1080p')],
        still: true,
        poster: true,
      },
      { aspect: '1:1', resolution: '720p' },
    )
    expect(list.map((j) => j.label)).toEqual(['16:9 1080p', '16:9 4K', '9:16 1080p', 'Image fixe 1:1 720p', 'Affiche'])
    expect(list.map((j) => j.kind)).toEqual(['video', 'video', 'video', 'still', 'poster'])
    expect(list[1]).toMatchObject({ width: 3840, height: 2160, tag: '16x9-4K' })
    expect(list[2]).toMatchObject({ width: 1080, height: 1920 })
    expect(new Set(list.map((j) => j.key)).size).toBe(list.length)
    expect(jobs()).toEqual([])
  })

  it('names the files after the project and the format', () => {
    const [film, still, poster] = buildBatchJobs({ formats: [formatKey('16:9', '1080p')], still: true, poster: true }, STILL_FORMAT)
    expect(videoFileName(batchBaseName('Tour du lac', film), '.mp4')).toBe('Tour du lac – 16x9-1080p.mp4')
    expect(videoFileName(batchBaseName('Tour du lac', still), '.png')).toBe('Tour du lac – image 16x9-1080p.png')
    expect(batchBaseName('Tour du lac', poster)).toBe('Tour du lac – affiche')
  })

  it('estimates the whole batch: frames, known sizes, time from the measured speed', () => {
    const list = buildBatchJobs({ formats: [formatKey('16:9', '1080p'), formatKey('1:1', '720p')], still: true, poster: true }, STILL_FORMAT)
    const bytesOf = (job: { width: number }) => (job.width === 1920 ? 5e6 : null)
    const estimate = estimateBatch(list, 100, bytesOf, 0.5)
    expect(estimate).toMatchObject({ files: 4, frames: 202, bytes: 5e6, unknownSizes: 1 })
    // 100 frames × (2.0736 + 0.5184) MP × 0.5 s
    expect(estimate.seconds).toBeCloseTo(129.6)
    expect(estimateBatch(list, 100, bytesOf, null).seconds).toBeNull()
  })
})

describe('runBatch', () => {
  const done = (job: BatchJob): JobOutcome => ({
    status: 'done',
    result: { url: null, fileName: job.label, mimeType: 'video/mp4', sizeBytes: 1, codec: 'mp4/avc', incompleteFrames: 0 },
  })

  it('runs the jobs one after the other and reports each change', async () => {
    const list = jobs(formatKey('16:9', '1080p'), formatKey('9:16', '1080p'), formatKey('1:1', '1080p'))
    const running: string[] = []
    let active = 0
    const reports: BatchJobState[][] = []
    const states = await runBatch(list, {
      async run(job) {
        active++
        expect(active).toBe(1)
        running.push(job.label)
        await new Promise((r) => setTimeout(r, 1))
        active--
        return job.label === '9:16 1080p' ? { status: 'error', error: 'refusé' } : done(job)
      },
      canceled: () => false,
      report: (s) => reports.push([...s]),
    })
    expect(running).toEqual(['16:9 1080p', '9:16 1080p', '1:1 1080p'])
    expect(states.map((s) => s.status)).toEqual(['done', 'error', 'done'])
    expect(states[1].error).toBe('refusé')
    expect(reports[0].map((s) => s.status)).toEqual(['running', 'pending', 'pending'])
    expect(batchProgressLabel(reports[0], 0.424)).toBe('1 / 3 · 16:9 1080p · 42 %')
    expect(batchProgressLabel(states, 1)).toBe('')
    expect(batchSummary(states)).toEqual({ done: 2, failed: 1, canceled: 0 })
  })

  it('stops at a canceled job, or at a cancel asked between two jobs, and counts a throw as an error', async () => {
    const list = jobs(formatKey('16:9', '1080p'), formatKey('9:16', '1080p'), formatKey('1:1', '1080p'))
    const states = await runBatch(list, {
      run: async (job) => (job.label === '9:16 1080p' ? { status: 'canceled' } : done(job)),
      canceled: () => false,
      report: () => {},
    })
    expect(states.map((s) => s.status)).toEqual(['done', 'canceled', 'canceled'])

    let stop = false
    const run = vi.fn(async (): Promise<JobOutcome> => {
      stop = true
      throw new Error('disque plein')
    })
    const after = await runBatch(list, { run, canceled: () => stop, report: () => {} })
    expect(run).toHaveBeenCalledTimes(1)
    expect(after.map((s) => s.status)).toEqual(['error', 'canceled', 'canceled'])
    expect(after[0].error).toBe('disque plein')
  })
})

// ---------------------------------------------------------------------------
// Through the export store, with a fake controller
// ---------------------------------------------------------------------------

type Behaviour = 'done' | 'error' | 'wait'

/** Picks up every request like `ExportController`, a tick later; 'wait' renders until canceled. */
function fakeController(behaviour: (request: ExportRequest) => Behaviour) {
  const seen: ExportRequest[] = []
  const stop = useExportStore.subscribe((s) => {
    if (s.phase === 'rendering' && s.cancelRequested) return void s.canceled()
    if (s.phase !== 'starting' || !s.request || seen.includes(s.request)) return
    const request = s.request
    seen.push(request)
    setTimeout(() => {
      const store = useExportStore.getState()
      if (!store.begin(request.id, 10, 0)) return
      const what = behaviour(request)
      if (what === 'error') return store.fail('relief introuvable')
      if (what === 'wait') return
      const image = request.still !== undefined
      void request.destination?.close()
      store.complete({
        url: request.destination ? null : `blob:${request.baseName}`,
        fileName: request.destination?.fileName ?? videoFileName(request.baseName, image ? '.png' : '.mp4'),
        mimeType: image ? 'image/png' : 'video/mp4',
        sizeBytes: 3,
        codec: image ? 'png' : 'mp4/avc',
        incompleteFrames: 0,
      })
    }, 1)
  })
  return { seen, stop }
}

function fakeFolder() {
  const files: Record<string, { bytes: number[]; closed: boolean; discarded: boolean }> = {}
  type Entry = (typeof files)[string]
  const folder: WritableFolder = {
    name: 'Films',
    createFile: vi.fn(async (fileName: string): Promise<WritableFile> => {
      const entry: Entry = (files[fileName] = { bytes: [], closed: false, discarded: false })
      return {
        fileName,
        write: async (data) => void entry.bytes.push(...data),
        close: async () => void (entry.closed = true),
        discard: async () => void (entry.discarded = true),
      }
    }),
  }
  return { folder, files }
}

function context(patch: Partial<BatchContext> = {}): BatchContext {
  return {
    projectName: 'Tour',
    film: { fps: 30, quality: 'high', durationS: 10, holdStartS: 1, holdEndS: 2 },
    still: { progress: 0.5, type: 'image/png' },
    folder: null,
    containerOf: async () => 'mp4',
    startPoster: async () => false,
    save: vi.fn(),
    canceled: () => false,
    ...patch,
  }
}

let controller: ReturnType<typeof fakeController> | null = null

beforeEach(() => {
  URL.revokeObjectURL = vi.fn()
  resetExportStore()
  resetBatchStore()
})
afterEach(() => {
  controller?.stop()
  controller = null
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('exportJob', () => {
  const [film, still] = buildBatchJobs({ formats: [formatKey('9:16', '720p')], still: true, poster: false }, STILL_FORMAT)

  it('writes a film into the folder under its batch name', async () => {
    controller = fakeController(() => 'done')
    const { folder, files } = fakeFolder()
    const outcome = await exportJob(film, context({ folder, containerOf: async () => 'webm' }))
    expect(outcome).toMatchObject({ status: 'done', result: { url: null, fileName: 'Tour – 9x16-720p.webm' } })
    expect(controller.seen[0]).toMatchObject({ width: 720, height: 1280, fps: 30, baseName: 'Tour – 9x16-720p' })
    expect(files['Tour – 9x16-720p.webm'].closed).toBe(true)
    expect(useExportStore.getState().result).toBeNull()
  })

  it('saves a file kept in memory as soon as it is ready, and keeps its URL', async () => {
    controller = fakeController(() => 'done')
    const ctx = context()
    const outcome = await exportJob(film, ctx)
    expect(outcome).toMatchObject({ status: 'done', result: { url: 'blob:Tour – 9x16-720p', fileName: 'Tour – 9x16-720p.mp4' } })
    expect(ctx.save).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'Tour – 9x16-720p.mp4' }))
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })

  it('copies a still image into the folder, then frees its URL', async () => {
    controller = fakeController(() => 'done')
    vi.stubGlobal('fetch', async () => ({ arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer }))
    const { folder, files } = fakeFolder()
    const ctx = context({ folder })
    const outcome = await exportJob(still, ctx)
    expect(controller.seen[0].still).toEqual({ progress: 0.5, type: 'image/png' })
    expect(outcome).toMatchObject({ status: 'done', result: { url: null, fileName: 'Tour – image 16x9-1080p.png' } })
    expect(files['Tour – image 16x9-1080p.png']).toEqual({ bytes: [7, 8, 9], closed: true, discarded: false })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:Tour – image 16x9-1080p')
    expect(ctx.save).not.toHaveBeenCalled()
  })

  it('reports a failure, a missing encoder and a missing track', async () => {
    controller = fakeController(() => 'error')
    expect(await exportJob(film, context())).toEqual({ status: 'error', error: 'relief introuvable' })
    expect(await exportJob(film, context({ containerOf: async () => null }))).toMatchObject({ status: 'error' })
    const [poster] = buildBatchJobs({ formats: [], still: false, poster: true }, STILL_FORMAT)
    expect(await exportJob(poster, context())).toEqual({ status: 'error', error: 'aucune trace chargée' })
  })

  it('cancels a request asked to stop while it was prepared (its file removed)', async () => {
    controller = fakeController(() => 'done')
    const { folder, files } = fakeFolder()
    expect(await exportJob(film, context({ folder, canceled: () => true }))).toEqual({ status: 'canceled' })
    expect(files['Tour – 9x16-720p.mp4'].discarded).toBe(true)
  })
})

describe('useBatchStore', () => {
  it('runs every job, then stops the current one and drops the rest on cancel', async () => {
    controller = fakeController((r) => (r.width === 1080 ? 'wait' : 'done'))
    const { folder } = fakeFolder()
    const list = jobs(formatKey('16:9', '720p'), formatKey('1:1', '1080p'), formatKey('4:5', '720p'))
    const running = useBatchStore.getState().run(list, { ...context({ folder }) })
    expect(useBatchStore.getState()).toMatchObject({ phase: 'running', folderName: 'Films' })
    // wait until the square film renders, then cancel
    await new Promise<void>((resolve) => {
      const stop = useExportStore.subscribe((s) => {
        if (s.phase === 'rendering' && s.request?.width === 1080) {
          stop()
          resolve()
        }
      })
    })
    expect(batchProgressLabel(useBatchStore.getState().jobs, 0)).toBe('2 / 3 · 1:1 1080p · 0 %')
    useBatchStore.getState().cancel()
    const states = await running
    expect(states.map((s) => s.status)).toEqual(['done', 'canceled', 'canceled'])
    expect(useBatchStore.getState()).toMatchObject({ phase: 'finished', cancelRequested: false })
    expect(controller.seen).toHaveLength(2)
  })

  it('revokes the files kept in memory when cleared or run again', async () => {
    controller = fakeController(() => 'done')
    const list = jobs(formatKey('16:9', '720p'))
    await useBatchStore.getState().run(list, context())
    expect(useBatchStore.getState().jobs[0].result?.url).toBe('blob:Tour – 16x9-720p')
    useBatchStore.getState().clear()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:Tour – 16x9-720p')
    expect(useBatchStore.getState()).toMatchObject({ phase: 'idle', jobs: [] })
  })
})

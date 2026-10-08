import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMPTY_TIMINGS,
  MEMORY_WARN_BYTES,
  chooseVideoDestination,
  warnsInMemory,
  estimateRemainingS,
  exportRenderScale,
  filmRate,
  flushDrapes,
  isExportBusy,
  registerDrapeFlush,
  resetExportStore,
  overlayBaseName,
  stillBaseName,
  useExportStore,
  videoFileName,
  type ExportRequest,
} from './store'

const REQUEST: Omit<ExportRequest, 'id'> = {
  width: 320,
  height: 180,
  fps: 10,
  quality: 'standard',
  durationS: 2,
  holdStartS: 0,
  holdEndS: 0,
  baseName: 'Tour',
}

const RESULT = {
  url: 'blob:video',
  fileName: 'Tour.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 10,
  codec: 'mp4/avc',
  incompleteFrames: 0,
}

beforeEach(() => {
  URL.revokeObjectURL = vi.fn()
  resetExportStore()
})
afterEach(() => vi.restoreAllMocks())

describe('helpers', () => {
  it('estimates the remaining time from the average frame time', () => {
    expect(estimateRemainingS(1000, 0, 10)).toBeNull()
    expect(estimateRemainingS(2000, 4, 10)).toBeCloseTo(3)
    expect(estimateRemainingS(2000, 10, 10)).toBe(0)
  })

  it('builds safe file names', () => {
    expect(videoFileName('Tour du Mont-Blanc J1', '.mp4')).toBe('Tour du Mont-Blanc J1.mp4')
    expect(videoFileName('a/b:c*?', '.webm')).toBe('a-b-c-.webm')
    expect(videoFileName('  ..\n', '.mp4')).toBe('openflyover.mp4')
    expect(videoFileName('ligne\tun\ndeux', '.mp4')).toBe('ligne un deux.mp4')
  })

  it('names a still image after the progress it shows', () => {
    expect(videoFileName(stillBaseName('Tour', 0.4239), '.png')).toBe('Tour 42 %.png')
    expect(stillBaseName('Tour', 0)).toBe('Tour 0 %')
    expect(stillBaseName('Tour', 1)).toBe('Tour 100 %')
  })

  it('names the overlay alone after the track', () => {
    expect(videoFileName(overlayBaseName('Tour du Mont-Blanc'), '.webm')).toBe('Tour du Mont-Blanc habillage.webm')
  })

  it('knows the busy phases', () => {
    expect(['idle', 'starting', 'rendering', 'finalizing', 'done', 'error', 'canceled'].map((p) => isExportBusy(p as never))).toEqual([
      false,
      true,
      true,
      true,
      false,
      false,
      false,
    ])
  })
})

describe('useExportStore', () => {
  it('runs a request through its phases', () => {
    const store = useExportStore.getState
    store().start(REQUEST)
    const { request } = store()
    expect(store().phase).toBe('starting')
    expect(request).toMatchObject(REQUEST)

    expect(store().begin(request!.id + 1, 20, 0)).toBe(false)
    expect(store().begin(request!.id, 20, 100)).toBe(true)
    expect(store()).toMatchObject({ phase: 'rendering', frame: 0, frameCount: 20, etaS: null })

    store().reportFrame(5, 1100)
    expect(store().frame).toBe(5)
    expect(store().etaS).toBeCloseTo(3)

    store().finalizing()
    expect(store().phase).toBe('finalizing')
    store().complete(RESULT)
    expect(store()).toMatchObject({ phase: 'done', request: null, result: RESULT })
  })

  it('carries a still image request like a film', () => {
    const store = useExportStore.getState
    store().start({ ...REQUEST, still: { progress: 0.25, type: 'image/jpeg' } })
    expect(store().request).toMatchObject({ still: { progress: 0.25, type: 'image/jpeg' } })
    expect(store().begin(store().request!.id, 1, 0)).toBe(true)
    store().complete({ ...RESULT, url: 'blob:image', fileName: 'Tour 25 %.jpg', mimeType: 'image/jpeg', codec: 'jpeg' })
    expect(store()).toMatchObject({ phase: 'done', request: null })
    store().start(REQUEST)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image')
  })

  it('ignores a second start while busy and revokes the previous result on a new export', () => {
    const store = useExportStore.getState
    store().start(REQUEST)
    const id = store().request!.id
    store().start({ ...REQUEST, baseName: 'autre' })
    expect(store().request!.id).toBe(id)

    store().begin(id, 1, 0)
    store().complete(RESULT)
    store().start(REQUEST)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video')
    expect(store().result).toBeNull()
  })

  it('cancels a request not picked up yet immediately, a running one through the controller', () => {
    const store = useExportStore.getState
    store().start(REQUEST)
    store().cancel()
    expect(store()).toMatchObject({ phase: 'canceled', request: null })

    store().start(REQUEST)
    store().begin(store().request!.id, 10, 0)
    store().cancel()
    expect(store()).toMatchObject({ phase: 'rendering', cancelRequested: true })
    store().canceled()
    expect(store()).toMatchObject({ phase: 'canceled', cancelRequested: false, request: null })
  })

  it('records failures and resets', () => {
    const store = useExportStore.getState
    store().start(REQUEST)
    store().begin(store().request!.id, 10, 0)
    store().fail('boom')
    expect(store()).toMatchObject({ phase: 'error', error: 'boom', request: null })
    store().reset()
    expect(store()).toMatchObject({ phase: 'idle', error: null })
  })
})

describe('straight to disk', () => {
  const file = () => ({ fileName: 'Mon film.mp4', write: vi.fn(), close: vi.fn(), discard: vi.fn(async () => undefined) })
  const platform = (canStreamToDisk: boolean, createWritableFile: () => Promise<unknown>) => ({
    capabilities: { isDesktop: false, videoEncoder: 'webcodecs' as const, canStreamToDisk },
    createWritableFile: vi.fn(createWritableFile) as never,
  })

  it('warns about the size only for a large film kept in memory', () => {
    expect(warnsInMemory(MEMORY_WARN_BYTES + 1, false)).toBe(true)
    expect(warnsInMemory(MEMORY_WARN_BYTES, false)).toBe(false)
    expect(warnsInMemory(10 * MEMORY_WARN_BYTES, true)).toBe(false)
  })

  it('chooses the destination: a file, memory, or nothing when the dialog is closed', async () => {
    const destination = file()
    const streaming = platform(true, async () => destination)
    expect(await chooseVideoDestination(streaming, 'Tour.mp4')).toEqual({ start: true, destination })
    expect(streaming.createWritableFile).toHaveBeenCalledWith({ fileName: 'Tour.mp4' })
    expect(await chooseVideoDestination(platform(true, async () => null), 'Tour.mp4')).toEqual({ start: false })
    const memory = platform(false, async () => destination)
    expect(await chooseVideoDestination(memory, 'Tour.mp4')).toEqual({ start: true })
    expect(memory.createWritableFile).not.toHaveBeenCalled()
  })

  it('falls back to memory when the dialog fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing = platform(true, async () => {
      throw new DOMException('no gesture', 'SecurityError')
    })
    expect(await chooseVideoDestination(failing, 'Tour.mp4')).toEqual({ start: true })
  })

  it('removes the file of a request that will not run', () => {
    const running = file()
    useExportStore.getState().start({ ...REQUEST, destination: running })
    const refused = file()
    useExportStore.getState().start({ ...REQUEST, destination: refused })
    expect(refused.discard).toHaveBeenCalled()
    useExportStore.getState().cancel()
    expect(running.discard).toHaveBeenCalled()
    expect(useExportStore.getState().phase).toBe('canceled')
  })

  it('has no URL to revoke for a film already on disk', () => {
    useExportStore.getState().start(REQUEST)
    const { request } = useExportStore.getState()
    useExportStore.getState().begin(request!.id, 1, 0)
    useExportStore.getState().complete({ ...RESULT, url: null })
    useExportStore.getState().reset()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })
})

describe('render scale and timings', () => {
  it('scales pixel-sized elements by the short side of the video, 1 outside an export', () => {
    expect(useExportStore.getState().renderScale).toBe(1)
    expect(exportRenderScale(1920, 1080)).toBe(1)
    expect(exportRenderScale(2160, 3840)).toBe(2)
    expect(exportRenderScale(1280, 720)).toBeCloseTo(2 / 3)
    useExportStore.getState().setRenderScale(2)
    expect(useExportStore.getState().renderScale).toBe(2)
  })

  it('reports a copy of the timings with the frames and clears them on begin', () => {
    const store = useExportStore.getState
    store().start(REQUEST)
    store().begin(store().request!.id, 10, 0)
    const timings = { ...EMPTY_TIMINGS, rendered: 2, renderMs: 30 }
    store().reportFrame(2, 100, timings)
    timings.rendered = 3
    expect(store().timings).toMatchObject({ rendered: 2, renderMs: 30 })
    store().canceled()
    store().start(REQUEST)
    store().begin(store().request!.id, 10, 0)
    expect(store().timings).toEqual(EMPTY_TIMINGS)
  })

  it('keeps the speed of the last film (per frame and megapixel) across exports, not from a still', () => {
    expect(filmRate(EMPTY_TIMINGS, 10, 1000, 1000)).toBeNull()
    expect(filmRate({ ...EMPTY_TIMINGS, renderMs: 3000, waitMs: 1000, encodeMs: 1000 }, 10, 1000, 500)).toBeCloseTo(1)
    const store = useExportStore.getState
    expect(store().secondsPerMegapixel).toBeNull()
    store().start(REQUEST) // 320 × 180
    store().begin(store().request!.id, 10, 0)
    store().reportFrame(10, 100, { ...EMPTY_TIMINGS, rendered: 10, renderMs: 576 })
    store().complete(RESULT)
    expect(store().secondsPerMegapixel).toBeCloseTo(1)
    store().start({ ...REQUEST, still: { progress: 0, type: 'image/png' } })
    store().begin(store().request!.id, 1, 0)
    store().reportFrame(1, 100, { ...EMPTY_TIMINGS, rendered: 1, renderMs: 5000 })
    store().complete(RESULT)
    store().reset()
    expect(store().secondsPerMegapixel).toBeCloseTo(1)
  })

  it('hands its result over without revoking it', () => {
    const store = useExportStore.getState
    store().start(REQUEST)
    store().begin(store().request!.id, 1, 0)
    store().complete(RESULT)
    expect(store().takeResult()).toEqual(RESULT)
    expect(store()).toMatchObject({ phase: 'done', result: null })
    expect(store().takeResult()).toBeNull()
    store().start(REQUEST)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
  })
})

describe('drape flushes', () => {
  it('runs every registered flush and tells whether one had work', () => {
    let pending = true
    const a = vi.fn(() => {
      const ran = pending
      pending = false
      return ran
    })
    const b = vi.fn(() => false)
    const offA = registerDrapeFlush(a)
    const offB = registerDrapeFlush(b)
    expect(flushDrapes()).toBe(true)
    expect(flushDrapes()).toBe(false)
    expect(b).toHaveBeenCalledTimes(2)
    offA()
    offB()
    expect(flushDrapes()).toBe(false)
    expect(a).toHaveBeenCalledTimes(2)
  })
})

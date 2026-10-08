import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TileFetchError, createTileFetcher, fetchTileBlob } from './fetch'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface PendingFetch {
  url: string
  signal: AbortSignal | undefined
  d: Deferred<Response>
}

interface FakeBitmap {
  width: number
  height: number
  close: ReturnType<typeof vi.fn>
}

function okResponse(): Response {
  return { ok: true, status: 200, blob: () => Promise.resolve(new Blob(['tile'])) } as unknown as Response
}

function httpResponse(status: number): Response {
  return { ok: false, status, blob: () => Promise.resolve(new Blob()) } as unknown as Response
}

/** Let every pending microtask / macrotask settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

let pending: PendingFetch[]
let bitmaps: FakeBitmap[]
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>

beforeEach(() => {
  pending = []
  bitmaps = []
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const d = deferred<Response>()
    const signal = init?.signal ?? undefined
    signal?.addEventListener('abort', () => d.reject(new DOMException('aborted', 'AbortError')))
    pending.push({ url, signal, d })
    return d.promise
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      const bitmap: FakeBitmap = { width: 256, height: 256, close: vi.fn() }
      bitmaps.push(bitmap)
      return bitmap
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Request a URL whose fetch is answered immediately with 200. */
async function load(fetcher: ReturnType<typeof createTileFetcher>, url: string): Promise<ImageBitmap> {
  const promise = fetcher.fetchBitmap(url)
  pending[pending.length - 1].d.resolve(okResponse())
  return promise
}

describe('fetchTileBlob', () => {
  it('returns the response blob on success', async () => {
    const promise = fetchTileBlob('https://tiles.test/1/2/3.png')
    pending[0].d.resolve(okResponse())
    await expect(promise).resolves.toBeInstanceOf(Blob)
    expect(fetchMock).toHaveBeenCalledWith('https://tiles.test/1/2/3.png', { signal: undefined })
  })

  it('throws a TileFetchError carrying status and url on HTTP errors', async () => {
    const promise = fetchTileBlob('https://tiles.test/x.png')
    pending[0].d.resolve(httpResponse(403))
    const error = await promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TileFetchError)
    expect(error).toMatchObject({ status: 403, url: 'https://tiles.test/x.png' })
    expect((error as Error).message).toContain('403')
    expect((error as Error).message).toContain('https://tiles.test/x.png')
  })
})

describe('createTileFetcher', () => {
  it('caps concurrency and starts queued requests as slots free up', async () => {
    const fetcher = createTileFetcher({ concurrency: 2, retryDelayMs: 0 })
    const urls = ['a', 'b', 'c', 'd', 'e']
    const promises = urls.map((u) => fetcher.fetchBitmap(u))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetcher.stats).toEqual({ inflight: 2, queued: 3, cached: 0, failed: 0 })

    for (let i = 0; i < urls.length; i++) {
      pending[i].d.resolve(okResponse())
      await flush()
      expect(fetchMock).toHaveBeenCalledTimes(Math.min(urls.length, i + 3))
      expect(fetcher.stats.inflight).toBeLessThanOrEqual(2)
    }

    const results = await Promise.all(promises)
    expect(results).toHaveLength(5)
    expect(fetcher.stats).toEqual({ inflight: 0, queued: 0, cached: 5, failed: 0 })
  })

  it('serves the lowest priority first and re-prioritises a repeated URL', async () => {
    const fetcher = createTileFetcher({ concurrency: 1, retryDelayMs: 0 })
    void fetcher.fetchBitmap('busy')
    void fetcher.fetchBitmap('p5', { priority: 5 })
    void fetcher.fetchBitmap('p1', { priority: 1 })
    void fetcher.fetchBitmap('p3', { priority: 3 })
    void fetcher.fetchBitmap('p5', { priority: 0 }) // same URL, more urgent -> moves to the front
    void fetcher.fetchBitmap('p1', { priority: 9 }) // same URL, less urgent -> keeps priority 1

    expect(fetchMock).toHaveBeenCalledTimes(1)
    for (const expected of ['p5', 'p1', 'p3']) {
      pending[pending.length - 1].d.resolve(okResponse())
      await flush()
      expect(pending[pending.length - 1].url).toBe(expected)
    }
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('de-duplicates concurrent requests for the same URL', async () => {
    const fetcher = createTileFetcher({ retryDelayMs: 0 })
    const a = fetcher.fetchBitmap('u')
    const b = fetcher.fetchBitmap('u')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    pending[0].d.resolve(okResponse())
    const [ba, bb] = await Promise.all([a, b])
    expect(ba).toBe(bb)
    expect(bitmaps).toHaveLength(1)
  })

  it('serves cached bitmaps without refetching', async () => {
    const fetcher = createTileFetcher({ retryDelayMs: 0 })
    const first = await load(fetcher, 'u')
    const second = await fetcher.fetchBitmap('u')
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetcher.stats.cached).toBe(1)
  })

  it('evicts least recently used bitmaps and closes them', async () => {
    const fetcher = createTileFetcher({ maxEntries: 2, retryDelayMs: 0 })
    await load(fetcher, 'a')
    await load(fetcher, 'b')
    await fetcher.fetchBitmap('a') // touch: a becomes the most recently used
    await load(fetcher, 'c') // evicts b

    expect(fetcher.stats.cached).toBe(2)
    expect(bitmaps[0].close).not.toHaveBeenCalled() // a
    expect(bitmaps[1].close).toHaveBeenCalledTimes(1) // b
    expect(bitmaps[2].close).not.toHaveBeenCalled() // c

    await load(fetcher, 'b') // refetched: not in cache any more
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1) // a was the oldest this time
  })

  it('retries once on a network error (TypeError)', async () => {
    const fetcher = createTileFetcher({ retryDelayMs: 0 })
    const promise = fetcher.fetchBitmap('u')
    pending[0].d.reject(new TypeError('Failed to fetch'))
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    pending[1].d.resolve(okResponse())
    const bitmap = await promise
    expect(bitmap).toBe(bitmaps[0])
    expect(fetcher.stats.failed).toBe(0)
  })

  it('gives up after three retries of a network error', async () => {
    const fetcher = createTileFetcher({ retryDelayMs: 0 })
    const promise = fetcher.fetchBitmap('u')
    for (let i = 0; i < 3; i++) {
      pending[i].d.reject(new TypeError('Failed to fetch'))
      await flush()
    }
    pending[3].d.reject(new TypeError('Failed to fetch'))
    await expect(promise).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetcher.stats).toEqual({ inflight: 0, queued: 0, cached: 0, failed: 1 })
  })

  it('retries on server errors (5xx) and 429', async () => {
    const fetcher = createTileFetcher({ retryDelayMs: 0 })
    const promise = fetcher.fetchBitmap('u')
    pending[0].d.resolve(httpResponse(502))
    await flush()
    pending[1].d.resolve(httpResponse(429))
    await flush()
    pending[2].d.resolve(httpResponse(400))
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    // retries bypass the HTTP cache (a cached error would come back)
    expect(fetchMock).toHaveBeenLastCalledWith('u', expect.objectContaining({ cache: 'reload' }))
    pending[3].d.resolve(okResponse())
    const bitmap = await promise
    expect(bitmap).toBe(bitmaps[0])
  })

  it('does not retry on HTTP 404 and rejects with status and url', async () => {
    const fetcher = createTileFetcher({ retryDelayMs: 0 })
    const promise = fetcher.fetchBitmap('https://tiles.test/missing.png')
    pending[0].d.resolve(httpResponse(404))
    const error = await promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TileFetchError)
    expect(error).toMatchObject({ status: 404, url: 'https://tiles.test/missing.png' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetcher.stats.failed).toBe(1)
    expect(fetcher.stats.cached).toBe(0)
  })

  it('rejects a queued request on abort without ever fetching it', async () => {
    const fetcher = createTileFetcher({ concurrency: 1, retryDelayMs: 0 })
    void fetcher.fetchBitmap('busy')
    const controller = new AbortController()
    const promise = fetcher.fetchBitmap('later', { signal: controller.signal })
    expect(fetcher.stats.queued).toBe(1)

    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher.stats.queued).toBe(0)

    pending[0].d.resolve(okResponse())
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetcher.stats.failed).toBe(0)
  })

  it('keeps a shared in-flight request alive while other waiters remain', async () => {
    const fetcher = createTileFetcher({ retryDelayMs: 0 })
    const c1 = new AbortController()
    const c2 = new AbortController()
    const p1 = fetcher.fetchBitmap('u', { signal: c1.signal })
    const p2 = fetcher.fetchBitmap('u', { signal: c2.signal })

    c1.abort()
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' })
    expect(pending[0].signal?.aborted).toBe(false)

    pending[0].d.resolve(okResponse())
    const bitmap = await p2
    expect(bitmap).toBe(bitmaps[0])
    expect(fetcher.stats.cached).toBe(1)
  })

  it('cancels the network request when its last waiter aborts', async () => {
    const fetcher = createTileFetcher({ retryDelayMs: 0 })
    const c1 = new AbortController()
    const c2 = new AbortController()
    const p1 = fetcher.fetchBitmap('u', { signal: c1.signal })
    const p2 = fetcher.fetchBitmap('u', { signal: c2.signal })
    c1.abort()
    c2.abort()
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' })
    await expect(p2).rejects.toMatchObject({ name: 'AbortError' })
    expect(pending[0].signal?.aborted).toBe(true)
    await flush()
    expect(fetcher.stats).toEqual({ inflight: 0, queued: 0, cached: 0, failed: 0 })

    // The URL can be requested again afterwards.
    void fetcher.fetchBitmap('u')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('starts a fresh request when a URL is re-requested right after its in-flight request was cancelled', async () => {
    const fetcher = createTileFetcher({ retryDelayMs: 0 })
    const c1 = new AbortController()
    const p1 = fetcher.fetchBitmap('u', { signal: c1.signal })
    c1.abort()
    // Synchronously, before the aborted fetch has had a chance to reject: a tile culled then
    // visible again in the same frame must not inherit the cancelled request's AbortError.
    const p2 = fetcher.fetchBitmap('u')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(pending[0].signal?.aborted).toBe(true)
    expect(pending[1].signal?.aborted).toBe(false)

    await expect(p1).rejects.toMatchObject({ name: 'AbortError' })
    pending[1].d.resolve(okResponse())
    const bitmap = await p2
    expect(bitmap).toBe(bitmaps[0])
    expect(fetcher.stats).toEqual({ inflight: 0, queued: 0, cached: 1, failed: 0 })
  })

  it('closes and discards a bitmap whose request was cancelled while it was being decoded', async () => {
    const decode = deferred<FakeBitmap>()
    const createImageBitmap = vi.fn(() => decode.promise)
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    const fetcher = createTileFetcher({ retryDelayMs: 0 })
    const controller = new AbortController()
    const promise = fetcher.fetchBitmap('u', { signal: controller.signal })
    pending[0].d.resolve(okResponse())
    await flush() // the blob is downloaded, decoding is in progress
    expect(createImageBitmap).toHaveBeenCalledTimes(1)

    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    const bitmap: FakeBitmap = { width: 256, height: 256, close: vi.fn() }
    decode.resolve(bitmap)
    await flush()

    expect(bitmap.close).toHaveBeenCalledTimes(1)
    expect(fetcher.stats).toEqual({ inflight: 0, queued: 0, cached: 0, failed: 0 })
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const fetcher = createTileFetcher({ retryDelayMs: 0 })
    const controller = new AbortController()
    controller.abort()
    await expect(fetcher.fetchBitmap('u', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clear() closes cached bitmaps and aborts pending work', async () => {
    const fetcher = createTileFetcher({ concurrency: 1, retryDelayMs: 0 })
    await load(fetcher, 'cached')
    const inflight = fetcher.fetchBitmap('inflight')
    const queued = fetcher.fetchBitmap('queued')

    fetcher.clear()

    expect(bitmaps[0].close).toHaveBeenCalledTimes(1)
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    await expect(inflight).rejects.toMatchObject({ name: 'AbortError' })
    expect(pending[1].signal?.aborted).toBe(true)
    await flush()
    expect(fetcher.stats).toEqual({ inflight: 0, queued: 0, cached: 0, failed: 0 })
  })

  it('falls back to an HTMLImageElement when createImageBitmap is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    class FakeImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      width = 256
      height = 256
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('Image', FakeImage)
    const createObjectURL = vi.fn(() => 'blob:tile')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }))

    const fetcher = createTileFetcher({ retryDelayMs: 0 })
    const bitmap = await load(fetcher, 'u')

    expect(bitmap).toBeInstanceOf(FakeImage)
    expect(bitmap.width).toBe(256)
    expect(typeof bitmap.close).toBe('function')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:tile')
  })
})

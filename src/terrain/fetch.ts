/**
 * Tile fetcher: `fetch()` + `createImageBitmap()` behind a priority queue, with bounded concurrency,
 * in-flight de-duplication by URL, an LRU cache of decoded bitmaps, AbortSignal support and automatic
 * retries on transient errors.
 *
 * Lifecycle of a request
 * ----------------------
 *   fetchBitmap(url) -> cache hit? resolve immediately
 *                    -> already queued / in flight? join as an extra waiter (re-prioritise if lower)
 *                    -> otherwise queue; the pump starts up to `concurrency` requests, lowest priority first.
 *   A waiter whose AbortSignal fires is rejected with a DOMException("AbortError"); the underlying network
 *   request is only cancelled when its last waiter leaves.
 *   Evicted bitmaps are closed (`ImageBitmap.close()`) to release GPU/CPU memory promptly.
 *   Cache first: when a registered reader of stored tiles (offline packs, `setStoredTileReader`) covers the URL,
 *   the stored copy is decoded instead of asking the network; a miss or an unreadable copy falls back to the network.
 */
import type { TileFetcher, TileFetcherStats } from '../core/types'

export interface TileFetcherOptions {
  /** Maximum simultaneous network requests. Default 12. */
  concurrency?: number
  /** Maximum decoded bitmaps kept in the LRU cache. Default 600. */
  maxEntries?: number
  /** Pause before the first automatic retry, in milliseconds (×4 before each next one). Default 250. */
  retryDelayMs?: number
  /** Stored tiles read before the network. Default: the reader given to `setStoredTileReader`, read at each request. */
  storedTiles?: StoredTileReader | null
}

/** Tiles kept on this device (offline packs). `covers` is synchronous and cheap: it gates the asynchronous lookup. */
export interface StoredTileReader {
  /** true when a stored pack may hold this URL (its source is in a pack) */
  covers(url: string): boolean
  /** the stored tile, null when none holds it */
  get(url: string): Promise<Blob | null>
}

let storedTileReader: StoredTileReader | null = null

/** Reader used by every fetcher created without `storedTiles` (the offline packs register here at start-up). */
export function setStoredTileReader(reader: StoredTileReader | null): void {
  storedTileReader = reader
}

/** Thrown when the server answers with a non-2xx status. Carries the status and the URL. */
export class TileFetchError extends Error {
  readonly url: string
  readonly status: number

  constructor(url: string, status: number) {
    super(`Tile request failed with HTTP ${status}: ${url}`)
    this.name = 'TileFetchError'
    this.url = url
    this.status = status
  }
}

/** True for the DOMException raised when a request is aborted (ours or the platform's). */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

export function createAbortError(): DOMException {
  return new DOMException('The tile request was aborted.', 'AbortError')
}

/**
 * A 4xx answer on a DEM tile means the source has no data there (Mapterhorn stops at z12 where
 * only Copernicus 30 m exists, swisstopo answers 400 out of bounds...). Such a tile is a leaf:
 * the parent keeps being rendered, nothing is retried and it is not an error for the user. A busy server (408, 429)
 * is not « no data »: the tile is retried later like any failure.
 */
export function isNoDataError(error: unknown): boolean {
  return error instanceof TileFetchError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429
}

/**
 * Network-level failures (`fetch()` rejects with a TypeError on DNS/CORS/connection errors, e.g. a network
 * change), server errors, 429 and 400 are retried; other client errors such as 403/404 are final. Our tile URLs
 * are well formed, so a 400 is a server glitch: the IGN Géoplateforme answered bursts of « Layer … unknown »
 * (400) for valid tiles in October 2026, with `max-age` 21 days, hence the retries bypass the HTTP cache.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof TileFetchError) return error.status >= 500 || error.status === 429 || error.status === 400
  return error instanceof TypeError
}

/**
 * Retries of a transient error, after 250 ms, 1 s and 4 s by default: a failed imagery sub-tile stays grey for
 * the life of its terrain tile, and a short network outage (or a burst of 502) outlasts a single quick retry.
 */
const MAX_RETRIES = 3

/** Wait `ms`, or reject at once when `signal` aborts (a canceled tile frees its slot without waiting). */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(createAbortError())
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(createAbortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Download one tile as a Blob. Rejects with `TileFetchError` on HTTP errors, with the fetch error otherwise.
 * `reload` skips the HTTP cache (a retry must not get a cached error back).
 */
export async function fetchTileBlob(url: string, signal?: AbortSignal, reload = false): Promise<Blob> {
  const response = await fetch(url, reload ? { signal, cache: 'reload' } : { signal })
  if (!response.ok) throw new TileFetchError(url, response.status)
  return response.blob()
}

/**
 * `fetchTileBlob` with the retry policy of the fetcher (network errors, 5xx, 429, 400; 3 retries after
 * `retryDelayMs`, ×4 each time, outside the HTTP cache). Shared by the fetcher and the offline packs.
 */
export async function downloadTile(url: string, signal?: AbortSignal, retryDelayMs = 250): Promise<Blob> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchTileBlob(url, signal, attempt > 0)
    } catch (error) {
      if (signal?.aborted || attempt >= MAX_RETRIES || !isRetryable(error)) throw error
      if (retryDelayMs > 0) await delay(retryDelayMs * 4 ** attempt, signal)
    }
  }
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/** No colour management: elevation tiles must be read back bit-exact; imagery is treated as sRGB anyway. */
const BITMAP_OPTIONS: ImageBitmapOptions = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }

function decodeBlob(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob, BITMAP_OPTIONS)
  return decodeWithImageElement(blob)
}

/**
 * Minimal fallback for environments without `createImageBitmap`: an HTMLImageElement is a valid
 * CanvasImageSource, so we return it with the small part of the ImageBitmap surface we rely on (`close`).
 */
function decodeWithImageElement(blob: Blob): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(Object.assign(image, { close() {} }) as unknown as ImageBitmap)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Image decoding failed.'))
    }
    image.src = objectUrl
  })
}

function closeBitmap(bitmap: ImageBitmap): void {
  if (typeof bitmap.close === 'function') bitmap.close()
}

// ---------------------------------------------------------------------------
// Binary min-heap (priority queue)
// ---------------------------------------------------------------------------

class BinaryHeap<T> {
  private readonly items: T[] = []
  private readonly less: (a: T, b: T) => boolean

  constructor(less: (a: T, b: T) => boolean) {
    this.less = less
  }

  get size(): number {
    return this.items.length
  }

  push(item: T): void {
    const items = this.items
    items.push(item)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(items[i], items[parent])) break
      const tmp = items[i]
      items[i] = items[parent]
      items[parent] = tmp
      i = parent
    }
  }

  pop(): T | undefined {
    const items = this.items
    if (items.length === 0) return undefined
    const top = items[0]
    const last = items.pop() as T
    if (items.length > 0) {
      items[0] = last
      let i = 0
      for (;;) {
        const left = 2 * i + 1
        const right = left + 1
        let smallest = i
        if (left < items.length && this.less(items[left], items[smallest])) smallest = left
        if (right < items.length && this.less(items[right], items[smallest])) smallest = right
        if (smallest === i) break
        const tmp = items[i]
        items[i] = items[smallest]
        items[smallest] = tmp
        i = smallest
      }
    }
    return top
  }

  clear(): void {
    this.items.length = 0
  }
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

interface Waiter {
  resolve: (bitmap: ImageBitmap) => void
  reject: (error: unknown) => void
  signal?: AbortSignal
  onAbort?: () => void
}

interface PendingRequest {
  url: string
  priority: number
  /** Identifies the live heap entry: older entries for the same request are stale and skipped. */
  seq: number
  state: 'queued' | 'inflight' | 'done'
  waiters: Set<Waiter>
  controller: AbortController
}

interface HeapEntry {
  priority: number
  seq: number
  request: PendingRequest
}

export function createTileFetcher(options: TileFetcherOptions = {}): TileFetcher {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 12))
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 600))
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 250)

  /** Insertion order doubles as LRU order: the first key is the least recently used. */
  const cache = new Map<string, ImageBitmap>()
  const requests = new Map<string, PendingRequest>()
  const heap = new BinaryHeap<HeapEntry>(
    (a, b) => a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq),
  )

  let sequence = 0
  let inflight = 0
  let queued = 0
  let failed = 0

  function touch(url: string, bitmap: ImageBitmap): void {
    cache.delete(url)
    cache.set(url, bitmap)
  }

  function store(url: string, bitmap: ImageBitmap): void {
    const previous = cache.get(url)
    if (previous && previous !== bitmap) closeBitmap(previous)
    touch(url, bitmap)
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value as string
      const evicted = cache.get(oldest) as ImageBitmap
      cache.delete(oldest)
      closeBitmap(evicted)
    }
  }

  function settle(request: PendingRequest, outcome: (waiter: Waiter) => void): void {
    for (const waiter of request.waiters) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort)
      outcome(waiter)
    }
    request.waiters.clear()
  }

  /**
   * Called when the last waiter of a request has gone away (or on clear()). The request is unregistered
   * immediately, so a new call for the same URL starts afresh instead of joining a dying request.
   * An in-flight request is aborted and cleans up after itself in `run()`.
   */
  function cancel(request: PendingRequest): void {
    if (request.state === 'done') return
    if (requests.get(request.url) === request) requests.delete(request.url)
    if (request.state === 'queued') {
      request.state = 'done'
      queued--
    } else {
      request.controller.abort()
    }
  }

  async function loadWithRetry(request: PendingRequest): Promise<ImageBitmap> {
    const signal = request.controller.signal
    // no await before the network when no pack covers the URL (same timing as without packs)
    const stored = options.storedTiles === undefined ? storedTileReader : options.storedTiles
    if (stored?.covers(request.url)) {
      try {
        const blob = await stored.get(request.url)
        if (signal.aborted) throw createAbortError()
        if (blob) return await decodeBlob(blob)
      } catch (error) {
        if (signal.aborted) throw error
        // unreadable stored copy: the network below
      }
    }
    return decodeBlob(await downloadTile(request.url, signal, retryDelayMs))
  }

  async function run(request: PendingRequest): Promise<void> {
    request.state = 'inflight'
    queued--
    inflight++
    try {
      const bitmap = await loadWithRetry(request)
      if (request.controller.signal.aborted) {
        // Cancelled while decoding (last waiter gone or clear()): nobody wants it, release it now.
        closeBitmap(bitmap)
        throw createAbortError()
      }
      store(request.url, bitmap)
      settle(request, (waiter) => waiter.resolve(bitmap))
    } catch (error) {
      if (!request.controller.signal.aborted) failed++
      settle(request, (waiter) => waiter.reject(error))
    } finally {
      inflight--
      request.state = 'done'
      if (requests.get(request.url) === request) requests.delete(request.url)
      pump()
    }
  }

  function pump(): void {
    while (inflight < concurrency) {
      const entry = heap.pop()
      if (!entry) return
      const request = entry.request
      if (request.state !== 'queued' || entry.seq !== request.seq) continue // stale entry
      void run(request)
    }
  }

  function fetchBitmap(
    url: string,
    { priority = 0, signal }: { priority?: number; signal?: AbortSignal } = {},
  ): Promise<ImageBitmap> {
    if (signal?.aborted) return Promise.reject(createAbortError())

    const hit = cache.get(url)
    if (hit) {
      touch(url, hit)
      return Promise.resolve(hit)
    }

    return new Promise<ImageBitmap>((resolve, reject) => {
      let request = requests.get(url)
      if (!request) {
        request = {
          url,
          priority,
          seq: ++sequence,
          state: 'queued',
          waiters: new Set(),
          controller: new AbortController(),
        }
        requests.set(url, request)
        queued++
        heap.push({ priority, seq: request.seq, request })
      } else if (request.state === 'queued' && priority < request.priority) {
        // Re-prioritise: push a fresh entry, the older one becomes stale.
        request.priority = priority
        request.seq = ++sequence
        heap.push({ priority, seq: request.seq, request })
      }

      const waiter: Waiter = { resolve, reject }
      request.waiters.add(waiter)
      if (signal) {
        const owner = request
        waiter.signal = signal
        waiter.onAbort = () => {
          owner.waiters.delete(waiter)
          reject(createAbortError())
          if (owner.waiters.size === 0) cancel(owner)
        }
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      pump()
    })
  }

  /** Drops every cached bitmap and cancels all queued / in-flight requests (their waiters get an AbortError). */
  function clear(): void {
    for (const bitmap of cache.values()) closeBitmap(bitmap)
    cache.clear()
    for (const request of Array.from(requests.values())) {
      const wasQueued = request.state === 'queued'
      cancel(request)
      // A queued request has no run() to settle its waiters; an in-flight one settles them when its fetch aborts.
      if (wasQueued) settle(request, (waiter) => waiter.reject(createAbortError()))
    }
    heap.clear()
    failed = 0
  }

  return {
    fetchBitmap,
    get stats(): TileFetcherStats {
      return { inflight, queued, cached: cache.size, failed }
    },
    clear,
  }
}

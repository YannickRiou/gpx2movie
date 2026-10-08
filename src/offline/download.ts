/**
 * Polite download of a pack: 4 requests at a time, the fetcher's retries (`downloadTile`), pause / resume / cancel,
 * a daily limit per provider, tiles the pack already holds skipped (preparing a pack again resumes it). Its
 * dependencies are arguments (tests).
 */
import type { KeyValueStore, TileCache } from '../platform/platform'
import { TileFetchError, downloadTile } from '../terrain/fetch'
import type { PlannedTile } from './plan'
import { offlinePolicy } from './policy'

export const DOWNLOAD_CONCURRENCY = 4
/** failures in a row after which the download stops (network gone) */
export const MAX_FAILURES_IN_A_ROW = 20

export type DownloadState = 'running' | 'paused' | 'done' | 'canceled' | 'limited' | 'failed'

export interface DownloadProgress {
  state: DownloadState
  total: number
  /** tiles handled: stored now, already there, without data or failed */
  done: number
  /** bytes downloaded by this run */
  bytes: number
  /** the source has no tile there (HTTP 4xx): not an error */
  missing: number
  failed: number
  /** provider whose daily limit stopped the download */
  limitedBy?: string
  error?: string
}

export interface DailyQuota {
  /** count one tile for `provider`; false when its limit for today is reached */
  take(provider: string, limit: number | undefined): boolean
}

const QUOTA_KEY = 'openflyover.offline.quota.v1'

/** Tiles downloaded per provider today (local date), kept in the platform storage. */
export function createDailyQuota(storage: KeyValueStore, now: () => Date = () => new Date()): DailyQuota {
  const today = () => {
    const d = now()
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  }
  return {
    take(provider, limit) {
      let state: { day: string; counts: Record<string, number> } = { day: today(), counts: {} }
      try {
        const saved = JSON.parse(storage.get(QUOTA_KEY) ?? 'null') as typeof state | null
        if (saved && saved.day === state.day && typeof saved.counts === 'object') state = saved
      } catch {
        // unreadable: a new day
      }
      const used = state.counts[provider] ?? 0
      if (limit !== undefined && used >= limit) return false
      state.counts[provider] = used + 1
      storage.set(QUOTA_KEY, JSON.stringify(state))
      return true
    },
  }
}

export interface PackDownloadDeps {
  cache: Pick<TileCache, 'has' | 'put'>
  download?: (url: string, signal: AbortSignal) => Promise<Blob>
  quota?: DailyQuota
  concurrency?: number
  onProgress?: (progress: DownloadProgress) => void
}

export interface PackDownload {
  /** settles when the download stops (done, canceled, limited or failed) */
  readonly finished: Promise<DownloadProgress>
  progress(): DownloadProgress
  pause(): void
  resume(): void
  cancel(): void
}

export function startPackDownload(pack: string, tiles: readonly PlannedTile[], deps: PackDownloadDeps): PackDownload {
  const download = deps.download ?? ((url: string, signal: AbortSignal) => downloadTile(url, signal))
  const controller = new AbortController()
  const progress: DownloadProgress = { state: 'running', total: tiles.length, done: 0, bytes: 0, missing: 0, failed: 0 }
  let next = 0
  let failuresInARow = 0
  let wake: (() => void) | null = null
  let paused: Promise<void> | null = null

  const emit = () => deps.onProgress?.({ ...progress })
  const stop = (state: DownloadState, extra: Partial<DownloadProgress> = {}) => {
    if (progress.state === 'running' || progress.state === 'paused') Object.assign(progress, { state }, extra)
    controller.abort()
    wake?.()
  }

  /** false when the tile was left for another day (daily limit); throws when aborted */
  async function handle(tile: PlannedTile): Promise<boolean> {
    if (await deps.cache.has(pack, tile.url)) return true
    const policy = offlinePolicy(tile.sourceId)
    if (!policy.allowed) {
      progress.failed++
      return true
    }
    if (deps.quota && !deps.quota.take(policy.provider, policy.dailyLimit)) {
      stop('limited', { limitedBy: policy.provider })
      return false
    }
    let blob: Blob
    try {
      blob = await download(tile.url, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) throw error
      if (error instanceof TileFetchError && error.status >= 400 && error.status < 500) {
        progress.missing++
        failuresInARow = 0
        return true
      }
      progress.failed++
      if (++failuresInARow >= MAX_FAILURES_IN_A_ROW) stop('failed', { error: 'Le réseau ne répond plus.' })
      return true
    }
    if (controller.signal.aborted) throw new DOMException('Canceled', 'AbortError')
    failuresInARow = 0
    try {
      await deps.cache.put(pack, tile.url, blob)
    } catch (error) {
      stop('failed', { error: `Tuiles non enregistrées : ${error instanceof Error ? error.message : String(error)}` })
      return false
    }
    progress.bytes += blob.size
    return true
  }

  async function worker(): Promise<void> {
    for (;;) {
      while (paused && !controller.signal.aborted) await paused
      if (controller.signal.aborted || next >= tiles.length) return
      let counted: boolean
      try {
        counted = await handle(tiles[next++])
      } catch {
        return // aborted
      }
      if (!counted) return
      progress.done++
      emit()
    }
  }

  const workers = Array.from({ length: Math.max(1, deps.concurrency ?? DOWNLOAD_CONCURRENCY) }, () => worker())
  const finished = Promise.all(workers).then(() => {
    if (progress.state === 'running' || progress.state === 'paused') progress.state = 'done'
    emit()
    return { ...progress }
  })

  return {
    finished,
    progress: () => ({ ...progress }),
    pause() {
      if (progress.state !== 'running') return
      progress.state = 'paused'
      paused = new Promise((resolve) => (wake = resolve))
      emit()
    },
    resume() {
      if (progress.state !== 'paused') return
      progress.state = 'running'
      paused = null
      wake?.()
      wake = null
      emit()
    },
    cancel() {
      paused = null
      stop('canceled')
      emit()
    },
  }
}

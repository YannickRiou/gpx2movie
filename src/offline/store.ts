/**
 * Offline packs in the app: the list, the download running (one at a time) and the fetcher's cache-first reader.
 * `installOfflineTiles()` runs once at start-up.
 */
import { create } from 'zustand'
import type { ImagerySource, TerrainSource } from '../core/types'
import { getPlatform } from '../platform'
import { setStoredTileReader } from '../terrain/fetch'
import { createDailyQuota, startPackDownload } from './download'
import type { DownloadProgress, PackDownload } from './download'
import { createPackRegistry, createStoredTileReader, packIdFor, sourcePrefix } from './packs'
import type { PackInfo, PackRegistry } from './packs'
import type { OfflinePlan } from './plan'

interface OfflineState {
  packs: PackInfo[]
  /** pack being downloaded and its progress */
  job: { packId: string; progress: DownloadProgress } | null
  /** browser storage used / allowed (web only) */
  usage: { usedBytes: number; quotaBytes: number } | null
}

export const useOfflineStore = create<OfflineState>(() => ({ packs: [], job: null, usage: null }))

let registry: PackRegistry | null = null
let running: PackDownload | null = null

function getRegistry(): PackRegistry {
  registry ??= createPackRegistry(getPlatform().storage)
  return registry
}

async function refresh(): Promise<void> {
  const usage = (await getPlatform().tileCache?.size().catch(() => null)) ?? null
  useOfflineStore.setState({ packs: getRegistry().list(), usage })
}

/** Register the packs with the tile fetcher (cache first for their sources) and load the list. */
export function installOfflineTiles(): void {
  const cache = getPlatform().tileCache
  if (!cache) return
  setStoredTileReader(createStoredTileReader(getRegistry(), cache))
  void refresh()
}

export interface PrepareRequest {
  plan: OfflinePlan
  name: string
  terrain: TerrainSource
  imagery: ImagerySource | null
  corridorM: number
}

/** Download a pack (or what it still lacks). Resolves with the final progress. */
export async function preparePack({ plan, name, terrain, imagery, corridorM }: PrepareRequest): Promise<DownloadProgress> {
  const platform = getPlatform()
  const cache = platform.tileCache
  if (!cache) throw new Error('Ce navigateur ne peut pas garder de tuiles.')
  if (running) throw new Error('Une préparation est déjà en cours.')
  const reg = getRegistry()
  const id = packIdFor(plan.tiles)
  const previous = reg.list().find((p) => p.id === id)
  const info: PackInfo = {
    id,
    name,
    createdAt: previous?.createdAt ?? Date.now(),
    terrainSourceId: terrain.id,
    imagerySourceId: imagery?.id ?? null,
    corridorM,
    tiles: plan.tiles.length,
    bytes: previous?.bytes ?? 0,
    complete: false,
    prefixes: [terrain, ...(imagery ? [imagery] : [])].map(sourcePrefix),
  }
  reg.save(info)
  let lastSave = 0
  const download = startPackDownload(id, plan.tiles, {
    cache,
    quota: createDailyQuota(platform.storage),
    onProgress: (progress) => {
      useOfflineStore.setState({ job: { packId: id, progress } })
      // the size of the pack, saved now and then (the page may be closed during the download)
      if (Date.now() - lastSave > 2000) {
        lastSave = Date.now()
        reg.save({ ...info, bytes: info.bytes + progress.bytes })
      }
    },
  })
  running = download
  useOfflineStore.setState({ job: { packId: id, progress: download.progress() } })
  void refresh()
  try {
    const result = await download.finished
    if (result.state === 'canceled' && !previous) {
      reg.remove(id)
      await cache.deletePack(id).catch(() => undefined)
    } else {
      reg.save({ ...info, bytes: info.bytes + result.bytes, complete: result.state === 'done' && result.failed === 0 })
    }
    return result
  } finally {
    running = null
    useOfflineStore.setState({ job: null })
    void refresh()
  }
}

export function pausePack(): void {
  running?.pause()
}

export function resumePack(): void {
  running?.resume()
}

export function cancelPack(): void {
  running?.cancel()
}

export async function deletePack(id: string): Promise<void> {
  if (useOfflineStore.getState().job?.packId === id) return
  getRegistry().remove(id)
  await getPlatform().tileCache?.deletePack(id)
  await refresh()
}

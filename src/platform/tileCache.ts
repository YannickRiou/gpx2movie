/**
 * Offline tiles behind `TileCache` (see platform.ts). Web: Cache Storage, one cache per pack named
 * `openflyover-tiles-v1:<pack>`, the request URL as key; deleting a pack deletes its cache. Desktop: one file per
 * tile under `<app data>/tiles/<pack>/`, named by `tileFileName(url)`; an index of the file names is read once
 * (`readDir`), so a tile no pack holds costs no call to the disk. Both take their storage as an argument (tests).
 */
import type * as TauriFs from '@tauri-apps/plugin-fs'
import { imageTypeOf, tileFileName } from './platform'
import type { TileCache } from './platform'

export const WEB_TILE_CACHE_PREFIX = 'openflyover-tiles-v1:'
/** folder of the packs in the app data folder (the only one the desktop capability opens) */
export const DESKTOP_TILE_ROOT = 'tiles'

const PACK_ID = /^[a-z0-9-]{1,64}$/

function checkPack(pack: string): void {
  if (!PACK_ID.test(pack)) throw new Error(`Identifiant de pack invalide : ${pack}`)
}

export function createWebTileCache(
  storage: Pick<CacheStorage, 'open' | 'keys' | 'delete'>,
  manager?: Partial<Pick<StorageManager, 'estimate' | 'persist'>>,
): TileCache {
  let packIds: Promise<string[]> | null = null
  const opened = new Map<string, Promise<Cache>>()
  let persistAsked = false

  const list = () =>
    (packIds ??= storage
      .keys()
      .then((names) => names.filter((n) => n.startsWith(WEB_TILE_CACHE_PREFIX)).map((n) => n.slice(WEB_TILE_CACHE_PREFIX.length)))
      .catch(() => []))
  const cacheOf = (pack: string) => {
    let cache = opened.get(pack)
    if (!cache) {
      cache = storage.open(WEB_TILE_CACHE_PREFIX + pack)
      opened.set(pack, cache)
    }
    return cache
  }

  return {
    async get(url) {
      for (const pack of await list()) {
        const response = await (await cacheOf(pack)).match(url)
        if (response) return response.blob()
      }
      return null
    },
    async has(pack, url) {
      if (!(await list()).includes(pack)) return false
      return (await (await cacheOf(pack)).match(url)) !== undefined
    },
    async put(pack, url, data) {
      checkPack(pack)
      if (!persistAsked) {
        // ask the browser not to evict the packs when the disk fills up (it may refuse: best effort)
        persistAsked = true
        await manager?.persist?.().catch(() => false)
      }
      const headers = { 'content-type': data.type || 'application/octet-stream' }
      await (await cacheOf(pack)).put(url, new Response(data, { headers }))
      const ids = await list()
      if (!ids.includes(pack)) ids.push(pack)
    },
    async deletePack(pack) {
      opened.delete(pack)
      await storage.delete(WEB_TILE_CACHE_PREFIX + pack)
      const ids = await list()
      if (ids.includes(pack)) ids.splice(ids.indexOf(pack), 1)
    },
    async packs() {
      return [...(await list())]
    },
    async size() {
      const estimate = await manager?.estimate?.().catch(() => null)
      return estimate ? { usedBytes: estimate.usage ?? 0, quotaBytes: estimate.quota ?? 0 } : null
    },
  }
}

type DesktopFs = Pick<typeof TauriFs, 'exists' | 'readDir' | 'readFile' | 'writeFile' | 'mkdir' | 'remove' | 'BaseDirectory'>

/** file name of a tile -> packs holding it */
type TileIndex = Map<string, Set<string>>

function addToIndex(index: TileIndex, fileName: string, pack: string): void {
  let packs = index.get(fileName)
  if (!packs) index.set(fileName, (packs = new Set()))
  packs.add(pack)
}

/** folder of a pack, relative to the app data folder */
const packDir = (pack: string) => `${DESKTOP_TILE_ROOT}/${pack}`

export function createDesktopTileCache(loadFs: () => Promise<DesktopFs>): TileCache {
  let index: Promise<TileIndex> | null = null
  const madeDirs = new Set<string>()

  const fsAndOptions = async () => {
    const fs = await loadFs()
    return { fs, baseDir: fs.BaseDirectory.AppData }
  }

  const readIndex = () =>
    (index ??= (async () => {
      const found: TileIndex = new Map()
      const { fs, baseDir } = await fsAndOptions()
      try {
        if (!(await fs.exists(DESKTOP_TILE_ROOT, { baseDir }))) return found
        for (const dir of await fs.readDir(DESKTOP_TILE_ROOT, { baseDir })) {
          if (!dir.isDirectory || !PACK_ID.test(dir.name)) continue
          madeDirs.add(dir.name)
          for (const file of await fs.readDir(packDir(dir.name), { baseDir })) {
            if (file.isFile) addToIndex(found, file.name, dir.name)
          }
        }
      } catch {
        // unreadable folder: start empty, the next put recreates it
      }
      return found
    })())

  return {
    async get(url) {
      const name = tileFileName(url)
      const packs = (await readIndex()).get(name)
      if (!packs || packs.size === 0) return null
      const { fs, baseDir } = await fsAndOptions()
      for (const pack of packs) {
        try {
          const bytes = await fs.readFile(`${packDir(pack)}/${name}`, { baseDir })
          return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: imageTypeOf(bytes) })
        } catch {
          // removed behind our back: try the next pack
        }
      }
      return null
    },
    async has(pack, url) {
      return (await readIndex()).get(tileFileName(url))?.has(pack) ?? false
    },
    async put(pack, url, data) {
      checkPack(pack)
      const found = await readIndex()
      const { fs, baseDir } = await fsAndOptions()
      if (!madeDirs.has(pack)) {
        await fs.mkdir(packDir(pack), { baseDir, recursive: true })
        madeDirs.add(pack)
      }
      const name = tileFileName(url)
      await fs.writeFile(`${packDir(pack)}/${name}`, new Uint8Array(await data.arrayBuffer()), { baseDir })
      addToIndex(found, name, pack)
    },
    async deletePack(pack) {
      checkPack(pack)
      const found = await readIndex()
      const { fs, baseDir } = await fsAndOptions()
      if (madeDirs.has(pack)) await fs.remove(packDir(pack), { baseDir, recursive: true })
      madeDirs.delete(pack)
      for (const [name, packs] of found) {
        packs.delete(pack)
        if (packs.size === 0) found.delete(name)
      }
    },
    async packs() {
      await readIndex()
      return [...madeDirs]
    },
    async size() {
      return null
    },
  }
}

/**
 * List of the offline packs (name, sources, counts, size), kept in the platform storage beside the tiles, and the
 * reader the tile fetcher asks first. A pack's id is a hash of its tile URLs: preparing the same tracks with the
 * same settings again gives the same pack, which then downloads only what it lacks.
 */
import type { TileSourceBase } from '../core/types'
import type { KeyValueStore, TileCache } from '../platform/platform'
import { tileFileName } from '../platform/platform'
import type { StoredTileReader } from '../terrain/fetch'
import type { PlannedTile } from './plan'

export interface PackInfo {
  id: string
  name: string
  createdAt: number
  terrainSourceId: string
  /** null: relief only */
  imagerySourceId: string | null
  corridorM: number
  /** tiles planned */
  tiles: number
  /** bytes downloaded */
  bytes: number
  complete: boolean
  /** start of the URLs of its sources (what `covers` compares) */
  prefixes: string[]
}

const PACKS_KEY = 'openflyover.offline.v1'

export function packIdFor(tiles: readonly PlannedTile[]): string {
  return `p${tileFileName(tiles.map((t) => t.url).join('\n'))}`
}

/** The fixed start of a source's URLs: its template up to the first placeholder. */
export function sourcePrefix(source: Pick<TileSourceBase, 'urlTemplate'>): string {
  const brace = source.urlTemplate.indexOf('{')
  return brace < 0 ? source.urlTemplate : source.urlTemplate.slice(0, brace)
}

function isPackInfo(value: unknown): value is PackInfo {
  const p = value as PackInfo
  return (
    typeof p === 'object' &&
    p !== null &&
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    typeof p.bytes === 'number' &&
    Array.isArray(p.prefixes) &&
    p.prefixes.every((x) => typeof x === 'string' && x.length > 0)
  )
}

export interface PackRegistry {
  list(): PackInfo[]
  save(info: PackInfo): void
  remove(id: string): void
}

export function createPackRegistry(storage: KeyValueStore): PackRegistry {
  let packs: PackInfo[] = []
  try {
    const raw = JSON.parse(storage.get(PACKS_KEY) ?? '[]') as unknown
    if (Array.isArray(raw)) packs = raw.filter(isPackInfo)
  } catch {
    // unreadable: no pack
  }
  const persist = () => storage.set(PACKS_KEY, JSON.stringify(packs))
  return {
    list: () => [...packs],
    save(info) {
      packs = [...packs.filter((p) => p.id !== info.id), info]
      persist()
    },
    remove(id) {
      packs = packs.filter((p) => p.id !== id)
      persist()
    },
  }
}

/** Cache first for the URLs of a source some pack holds; the others go straight to the network. */
export function createStoredTileReader(registry: PackRegistry, cache: Pick<TileCache, 'get'>): StoredTileReader {
  return {
    covers: (url) => registry.list().some((p) => p.prefixes.some((prefix) => url.startsWith(prefix))),
    get: (url) => cache.get(url),
  }
}

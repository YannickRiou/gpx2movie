/**
 * Multi-level height field: a cache of decoded elevation grids keyed by tile, able to answer
 * "what is the terrain height at lon/lat?" from the deepest loaded tile containing the point.
 *
 * Lookup is O(zoom): starting from the tile of the point at the deepest loaded zoom and walking up
 * through `parentOf`, so it never scans the whole cache. Entries are kept in last-access order so
 * `prune()` can evict the least recently used grids.
 */
import type { HeightGrid, TileKey } from '../core/types'
import { lonLatToTileFrac, parentOf, tileKeyString } from '../geo/mercator'
import { sampleGrid } from './dem'

interface Entry {
  key: TileKey
  grid: HeightGrid
}

export class HeightField {
  /** Insertion order = access order (least recently used first). */
  private readonly entries = new Map<string, Entry>()
  /** Number of loaded tiles per zoom level, to skip empty levels during lookup. */
  private readonly countPerZoom: number[] = []
  private maxZoomLoaded = -1

  get size(): number {
    return this.entries.size
  }

  set(key: TileKey, grid: HeightGrid): void {
    const id = tileKeyString(key)
    if (this.entries.has(id)) {
      this.entries.delete(id)
    } else {
      this.countPerZoom[key.z] = (this.countPerZoom[key.z] ?? 0) + 1
      if (key.z > this.maxZoomLoaded) this.maxZoomLoaded = key.z
    }
    this.entries.set(id, { key: { z: key.z, x: key.x, y: key.y }, grid })
  }

  delete(key: TileKey): boolean {
    const id = tileKeyString(key)
    const entry = this.entries.get(id)
    if (!entry) return false
    this.entries.delete(id)
    this.forget(entry.key.z)
    return true
  }

  has(key: TileKey): boolean {
    return this.entries.has(tileKeyString(key))
  }

  /** Returns the grid and marks it as recently used. */
  get(key: TileKey): HeightGrid | undefined {
    const id = tileKeyString(key)
    const entry = this.entries.get(id)
    if (!entry) return undefined
    this.touch(id, entry)
    return entry.grid
  }

  /**
   * Height (metres, true scale) from the deepest loaded tile containing the point, or undefined when
   * no loaded tile covers it (or every covering tile has nodata there).
   */
  sampleHeight(lon: number, lat: number): number | undefined {
    const zMax = this.maxZoomLoaded
    if (zMax < 0) return undefined

    const frac = lonLatToTileFrac(lon, lat, zMax)
    const n = 2 ** zMax
    if (!(frac.x >= 0 && frac.x < n && frac.y >= 0 && frac.y < n)) return undefined

    let key: TileKey | undefined = { z: zMax, x: Math.floor(frac.x), y: Math.floor(frac.y) }
    while (key) {
      if ((this.countPerZoom[key.z] ?? 0) > 0) {
        const id = tileKeyString(key)
        const entry = this.entries.get(id)
        if (entry) {
          this.touch(id, entry)
          const scale = 2 ** (zMax - key.z)
          const h = sampleGrid(entry.grid, frac.x / scale - key.x, frac.y / scale - key.y)
          if (h === h) return h
        }
      }
      key = parentOf(key)
    }
    return undefined
  }

  /** Evict least recently used grids until at most `maxEntries` remain. Returns the number evicted. */
  prune(maxEntries: number): number {
    const limit = Math.max(0, Math.floor(maxEntries))
    let evicted = 0
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= limit) break
      this.entries.delete(id)
      this.forget(entry.key.z)
      evicted++
    }
    return evicted
  }

  clear(): void {
    this.entries.clear()
    this.countPerZoom.length = 0
    this.maxZoomLoaded = -1
  }

  /** Loaded tile keys, least recently used first. */
  *keys(): IterableIterator<TileKey> {
    for (const entry of this.entries.values()) yield entry.key
  }

  private touch(id: string, entry: Entry): void {
    this.entries.delete(id)
    this.entries.set(id, entry)
  }

  private forget(z: number): void {
    this.countPerZoom[z] = (this.countPerZoom[z] ?? 1) - 1
    if (z === this.maxZoomLoaded && this.countPerZoom[z] <= 0) {
      let top = z - 1
      while (top >= 0 && !(this.countPerZoom[top] > 0)) top--
      this.maxZoomLoaded = top
    }
  }
}

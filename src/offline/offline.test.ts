import { describe, expect, it, vi } from 'vitest'
import type { LonLat, LonLatBounds, TileKey } from '../core/types'
import { tileBounds } from '../geo/mercator'
import { keyValueStore } from '../platform/platform'
import { TileFetchError } from '../terrain/fetch'
import { getImagerySource, getTerrainSource, IMAGERY_SOURCES, TERRAIN_SOURCES } from '../terrain/sources'
import { createDailyQuota, MAX_FAILURES_IN_A_ROW, startPackDownload } from './download'
import type { DownloadProgress } from './download'
import { createPackRegistry, createStoredTileReader, packIdFor, sourcePrefixes } from './packs'
import type { PackInfo } from './packs'
import { LANDSCAPE_LEVELS, planOfflineTiles, splitDistanceM } from './plan'
import type { OfflinePlanInput, PlannedTile } from './plan'
import { offlinePolicy } from './policy'

/** Straight track going east from Chamonix, `lengthKm` long. */
function straightTrack(lengthKm: number): { points: LonLat[]; bounds: LonLatBounds } {
  const start = { lon: 6.87, lat: 45.92 }
  const dLon = lengthKm / (111.32 * Math.cos((start.lat * Math.PI) / 180))
  const points = Array.from({ length: 101 }, (_, i) => ({ lon: start.lon + (dLon * i) / 100, lat: start.lat }))
  return { points, bounds: { west: start.lon, east: start.lon + dLon, south: start.lat, north: start.lat } }
}

function input(overrides: Partial<OfflinePlanInput> = {}): OfflinePlanInput {
  return {
    ...straightTrack(10),
    corridorM: 2_000,
    terrain: getTerrainSource('mapterhorn'),
    imagery: getImagerySource('ign-ortho'),
    imageryZoomOffset: 1,
    cameraHeightM: 400,
    ...overrides,
  }
}

const keyOf = (url: string): TileKey => {
  const [z, x, y] = url.replace('https://tiles.mapterhorn.com/', '').replace('.webp', '').split('/').map(Number)
  return { z, x, y }
}

/** Distance in metres from the straight test track (latitude 45.92, east of 6.87) to a tile, roughly. */
function distanceFromTrackM(key: TileKey, track: LonLatBounds): number {
  const b = tileBounds(key)
  const ky = 111_320
  const kx = 111_320 * Math.cos((45.92 * Math.PI) / 180)
  const dy = Math.max(b.south - track.north, 0, track.south - b.north) * ky
  const dx = Math.max(b.west - track.east, 0, track.west - b.east) * kx
  return Math.hypot(dx, dy)
}

describe('offline policy', () => {
  it('refuses the providers whose terms forbid bulk download', () => {
    expect(offlinePolicy('arcgis-world-imagery').allowed).toBe(false)
    expect(offlinePolicy('arcgis-world-imagery').reason).not.toBe('')
    for (const id of ['opentopomap', 'swisstopo', 'swisstopo-carte']) {
      // personal use: allowed with a low daily cap and a caution
      expect(offlinePolicy(id).allowed, id).toBe(true)
      expect(offlinePolicy(id).personalUse, id).toBe(true)
      expect(offlinePolicy(id).dailyLimit, id).toBeLessThanOrEqual(10_000)
      expect(offlinePolicy(id).reason).not.toBe('')
    }
    for (const id of ['mapterhorn', 'aws-terrarium', 'ign-ortho', 'ign-plan', 'eox-s2cloudless']) expect(offlinePolicy(id).allowed, id).toBe(true)
  })

  it('has a decision for every catalogued source and refuses unknown ones', () => {
    for (const source of [...TERRAIN_SOURCES, ...IMAGERY_SOURCES]) {
      expect(offlinePolicy(source.id).reason, source.id).not.toMatch(/non vérifiées/)
    }
    expect(offlinePolicy('nouvelle-source').allowed).toBe(false)
  })

  it('shares one daily limit between the IGN layers', () => {
    expect(offlinePolicy('ign-ortho').provider).toBe(offlinePolicy('ign-ortho-1950-1965').provider)
    expect(offlinePolicy('ign-ortho').dailyLimit).toBeGreaterThan(0)
    expect(offlinePolicy('aws-terrarium').dailyLimit).toBeUndefined()
  })
})

describe('planOfflineTiles', () => {
  it('splits a tile about 6 tile sizes away at 1080 px, twice as far at 2160 px', () => {
    const key = { z: 14, x: 8505, y: 5824 }
    const r = splitDistanceM(key, 1080)
    const size = 40_075_016.7 * Math.cos((45.9 * Math.PI) / 180) / 2 ** 14
    expect(r / size).toBeCloseTo(6.03, 1)
    expect(splitDistanceM(key, 2160)).toBeCloseTo(2 * r, 6)
  })

  it('goes down to the deepest relief zoom near the track and keeps tiles once', () => {
    const plan = planOfflineTiles(input())
    expect(plan.maxTerrainZoom).toBe(17)
    expect(new Set(plan.tiles.map((t) => t.url)).size).toBe(plan.tiles.length)
    expect(plan.terrainTiles + plan.imageryTiles).toBe(plan.tiles.length)
    // every split loads four children: each level is a multiple of 4 below the roots
    for (const [z, count] of Object.entries(plan.terrainByZoom)) if (Number(z) > Number(Object.keys(plan.terrainByZoom)[0])) expect(count % 4).toBe(0)
  })

  it('keeps the fine levels inside the corridor and the landscape over the whole area', () => {
    const track = straightTrack(10)
    const plan = planOfflineTiles(input({ corridorM: 2_000 }))
    const terrain = plan.tiles.filter((t) => t.sourceId === 'mapterhorn').map((t) => keyOf(t.url))
    const rootZ = Math.min(...terrain.map((k) => k.z))
    for (const key of terrain) {
      if (key.z <= rootZ + LANDSCAPE_LEVELS) continue
      // its parent touched the 1 km half-corridor, so the tile is at most one parent size beyond it
      const parentSize = (40_075_016.7 * Math.cos((45.92 * Math.PI) / 180)) / 2 ** (key.z - 1)
      expect(distanceFromTrackM(key, track.bounds)).toBeLessThanOrEqual(1_000 + parentSize)
    }
    // landscape: the whole level rootZ + 1 is there
    expect(plan.terrainByZoom[rootZ + 1]).toBe(plan.terrainByZoom[rootZ] * 4)
  })

  it('grows with the corridor, the track length and the image height, shrinks with a higher camera', () => {
    const count = (o: Partial<OfflinePlanInput>) => planOfflineTiles(input(o)).tiles.length
    expect(count({ corridorM: 5_000 })).toBeGreaterThan(count({ corridorM: 2_000 }))
    expect(count({ corridorM: 10_000 })).toBeGreaterThan(count({ corridorM: 5_000 }))
    expect(count({ ...straightTrack(20) })).toBeGreaterThan(count({}))
    // a 4K image splits tiles twice as far: more tiles once the corridor is wide enough not to be the limit
    expect(count({ corridorM: 10_000, viewportHeightPx: 2160 })).toBeGreaterThan(count({ corridorM: 10_000 }))
    expect(count({ cameraHeightM: 3_000 })).toBeLessThan(count({}))
  })

  it('stops at the zoom the view uses: maxZoom of the relief, imagery at the zoom offset', () => {
    const aws = planOfflineTiles(input({ terrain: getTerrainSource('aws-terrarium') }))
    expect(aws.maxTerrainZoom).toBe(15)
    const imageryZooms = (offset: number) =>
      Math.max(...planOfflineTiles(input({ imageryZoomOffset: offset })).tiles.filter((t) => t.sourceId === 'ign-ortho').map((t) => Number(/TILEMATRIX=(\d+)/.exec(t.url)?.[1])))
    expect(imageryZooms(0)).toBe(17)
    expect(imageryZooms(1)).toBe(18)
    // EOX stops at 16: deeper terrain tiles reuse (crop) the same imagery tiles
    const eox = planOfflineTiles(input({ imagery: getImagerySource('eox-s2cloudless'), imageryZoomOffset: 2 }))
    expect(eox.imageryTiles).toBeLessThan(eox.terrainTiles * 16)
  })

  it('plans the relief only without imagery, with an estimate from the typical tile sizes', () => {
    const plan = planOfflineTiles(input({ imagery: null }))
    expect(plan.imageryTiles).toBe(0)
    expect(plan.estimatedBytes).toBe(plan.terrainTiles * offlinePolicy('mapterhorn').typicalTileBytes)
  })

  it('gives an honest order of magnitude for a 10 km track and a 2 km corridor', () => {
    const plan = planOfflineTiles(input())
    // ~1 000 relief tiles (~150 MB) and ~4 000 orthophotos (~65 MB): hundreds of MB, not a few
    expect(plan.terrainTiles).toBeGreaterThan(400)
    expect(plan.terrainTiles).toBeLessThan(3_000)
    expect(plan.estimatedBytes).toBeGreaterThan(80e6)
    expect(plan.estimatedBytes).toBeLessThan(600e6)
  })
})

describe('packs', () => {
  const tiles: PlannedTile[] = [
    { url: 'https://tiles.mapterhorn.com/12/1/2.webp', sourceId: 'mapterhorn' },
    { url: 'https://tiles.mapterhorn.com/12/1/3.webp', sourceId: 'mapterhorn' },
  ]

  it('names a pack after its tiles (same plan, same pack)', () => {
    expect(packIdFor(tiles)).toBe(packIdFor([...tiles]))
    expect(packIdFor(tiles)).not.toBe(packIdFor(tiles.slice(0, 1)))
    expect(packIdFor(tiles)).toMatch(/^[a-z0-9-]{1,64}$/)
  })

  it('takes the fixed start of a source URL', () => {
    expect(sourcePrefixes(getTerrainSource('mapterhorn'))).toEqual(['https://tiles.mapterhorn.com/'])
    expect(sourcePrefixes(getImagerySource('ign-ortho'))[0]).toContain('LAYER=ORTHOIMAGERY.ORTHOPHOTOS&')
    expect(sourcePrefixes(getImagerySource('ign-ortho'))).not.toEqual(sourcePrefixes(getImagerySource('ign-plan')))
    // one prefix per subdomain, never a bare « https:// » that every URL starts with
    expect(sourcePrefixes(getImagerySource('opentopomap'))).toEqual(['https://a.tile.opentopomap.org/', 'https://b.tile.opentopomap.org/', 'https://c.tile.opentopomap.org/'])
  })

  it('keeps the list in the storage and ignores damaged entries', () => {
    const storage = keyValueStore(null)
    const info: PackInfo = {
      id: 'p1',
      name: 'Tour',
      createdAt: 1,
      terrainSourceId: 'mapterhorn',
      imagerySourceId: null,
      corridorM: 2000,
      tiles: 2,
      bytes: 10,
      complete: true,
      prefixes: ['https://tiles.mapterhorn.com/'],
    }
    createPackRegistry(storage).save(info)
    storage.set('openflyover.offline.v1', JSON.stringify([...JSON.parse(storage.get('openflyover.offline.v1')!), { id: 3 }]))
    const again = createPackRegistry(storage)
    expect(again.list()).toEqual([info])
    again.remove('p1')
    expect(createPackRegistry(storage).list()).toEqual([])
  })

  it('asks the cache only for the sources a pack holds', async () => {
    const registry = createPackRegistry(keyValueStore(null))
    const cache = { get: vi.fn(async () => new Blob(['x'])) }
    const reader = createStoredTileReader(registry, cache)
    expect(reader.covers(tiles[0].url)).toBe(false)
    registry.save({ id: 'p', name: '', createdAt: 0, terrainSourceId: 'mapterhorn', imagerySourceId: null, corridorM: 0, tiles: 0, bytes: 0, complete: false, prefixes: sourcePrefixes(getTerrainSource('mapterhorn')) })
    expect(reader.covers(tiles[0].url)).toBe(true)
    expect(reader.covers('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/1/0/0.png')).toBe(false)
    expect(await reader.get(tiles[0].url)).toBeInstanceOf(Blob)
  })
})

describe('daily quota', () => {
  it('counts per provider and per day, in the storage', () => {
    const storage = keyValueStore(null)
    let day = new Date(2026, 9, 8, 10)
    const quota = createDailyQuota(storage, () => day)
    expect(quota.take('ign', 2)).toBe(true)
    expect(quota.take('ign', 2)).toBe(true)
    expect(quota.take('ign', 2)).toBe(false)
    expect(quota.take('eox', 2)).toBe(true)
    expect(createDailyQuota(storage, () => day).take('ign', 2)).toBe(false)
    expect(quota.take('aws', undefined)).toBe(true)
    day = new Date(2026, 9, 9, 8)
    expect(quota.take('ign', 2)).toBe(true)
  })
})

describe('startPackDownload', () => {
  const plan = (n: number, sourceId = 'mapterhorn'): PlannedTile[] =>
    Array.from({ length: n }, (_, i) => ({ url: `https://tiles.mapterhorn.com/14/${i}/0.webp`, sourceId }))

  function fakeCache() {
    const stored = new Map<string, Blob>()
    return {
      stored,
      has: vi.fn(async (_pack: string, url: string) => stored.has(url)),
      put: vi.fn(async (_pack: string, url: string, blob: Blob) => void stored.set(url, blob)),
    }
  }

  it('downloads every tile at most 4 at a time and stores it', async () => {
    const cache = fakeCache()
    let inflight = 0
    let peak = 0
    const download = vi.fn(async () => {
      peak = Math.max(peak, ++inflight)
      await new Promise((r) => setTimeout(r, 1))
      inflight--
      return new Blob(['abcd'])
    })
    const result = await startPackDownload('p', plan(20), { cache, download }).finished
    expect(result).toMatchObject({ state: 'done', total: 20, done: 20, bytes: 80, failed: 0 })
    expect(peak).toBe(4)
    expect(cache.stored.size).toBe(20)
  })

  it('skips the tiles the pack already holds (preparing again resumes)', async () => {
    const cache = fakeCache()
    const tiles = plan(6)
    cache.stored.set(tiles[0].url, new Blob(['x']))
    cache.stored.set(tiles[3].url, new Blob(['x']))
    const download = vi.fn(async () => new Blob(['ab']))
    const result = await startPackDownload('p', tiles, { cache, download }).finished
    expect(download).toHaveBeenCalledTimes(4)
    expect(result).toMatchObject({ done: 6, bytes: 8 })
  })

  it('counts a 4xx as a tile without data, other errors as failures, and stops when the network is gone', async () => {
    const cache = fakeCache()
    const tiles = plan(3)
    const download = vi.fn(async (url: string) => {
      if (url === tiles[0].url) throw new TileFetchError(url, 404)
      if (url === tiles[1].url) throw new TypeError('Failed to fetch')
      return new Blob(['a'])
    })
    expect(await startPackDownload('p', tiles, { cache, download, concurrency: 1 }).finished).toMatchObject({ state: 'done', done: 3, missing: 1, failed: 1 })

    // a busy server (429) or an IGN glitch (400) is a failure, not a tile without data
    const busy = vi.fn(async (url: string) => {
      throw new TileFetchError(url, url === tiles[0].url ? 429 : 400)
    })
    expect(await startPackDownload('p', plan(2), { cache: fakeCache(), download: busy, concurrency: 1 }).finished).toMatchObject({ missing: 0, failed: 2 })

    // the storage refusing to answer stops the pack: not complete
    const broken = { ...fakeCache(), has: vi.fn(async () => Promise.reject(new Error('quota'))) }
    const stopped = await startPackDownload('p', plan(2), { cache: broken, download, concurrency: 1 }).finished
    expect(stopped.state).toBe('failed')

    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const result = await startPackDownload('p', plan(100), { cache: fakeCache(), download: offline, concurrency: 1 }).finished
    expect(result.state).toBe('failed')
    expect(offline).toHaveBeenCalledTimes(MAX_FAILURES_IN_A_ROW)
  })

  it('stops at the daily limit of the provider', async () => {
    const quota = { take: vi.fn((_p: string, _l: number | undefined) => quota.take.mock.calls.length <= 3) }
    const result = await startPackDownload('p', plan(10), { cache: fakeCache(), download: async () => new Blob(['a']), quota, concurrency: 1 }).finished
    expect(result).toMatchObject({ state: 'limited', limitedBy: 'mapterhorn', done: 3 })
    expect(quota.take).toHaveBeenCalledWith('mapterhorn', offlinePolicy('mapterhorn').dailyLimit)
  })

  it('never downloads a refused source', async () => {
    const download = vi.fn(async () => new Blob(['a']))
    const result = await startPackDownload('p', plan(2, 'nouvelle-source'), { cache: fakeCache(), download }).finished
    expect(download).not.toHaveBeenCalled()
    expect(result.failed).toBe(2)
  })

  it('pauses, resumes and cancels', async () => {
    const gates: (() => void)[] = []
    const download = vi.fn(() => new Promise<Blob>((resolve) => gates.push(() => resolve(new Blob(['a'])))))
    const updates: DownloadProgress[] = []
    const job = startPackDownload('p', plan(10), { cache: fakeCache(), download, concurrency: 2, onProgress: (p) => updates.push(p) })
    const tick = () => new Promise((r) => setTimeout(r, 0))
    await tick()
    expect(download).toHaveBeenCalledTimes(2)
    job.pause()
    gates.splice(0).forEach((open) => open())
    await tick()
    // the two running tiles finish, nothing new starts
    expect(job.progress()).toMatchObject({ state: 'paused', done: 2 })
    expect(download).toHaveBeenCalledTimes(2)
    job.resume()
    await tick()
    expect(download).toHaveBeenCalledTimes(4)
    job.cancel()
    gates.splice(0).forEach((open) => open())
    const result = await job.finished
    expect(result.state).toBe('canceled')
    expect(download).toHaveBeenCalledTimes(4)
    expect(updates.some((u) => u.state === 'paused')).toBe(true)
  })

  it('stops when the storage refuses a tile', async () => {
    const cache = fakeCache()
    cache.put.mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
    const result = await startPackDownload('p', plan(5), { cache, download: async () => new Blob(['a']), concurrency: 1 }).finished
    expect(result.state).toBe('failed')
    expect(result.error).toMatch(/non enregistrées/)
  })
})

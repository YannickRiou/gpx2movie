import { afterEach, describe, expect, it, vi } from 'vitest'
import { Frustum, Matrix4, Mesh, PerspectiveCamera, Texture, Vector3 } from 'three'
import type { MeshStandardMaterial } from 'three'
import type {
  HeightGrid,
  ImagerySource,
  LonLatBounds,
  TerrainEngineOptions,
  TerrainSource,
  TileFetcher,
  TileKey,
} from '../core/types'
import { createLocalFrame } from '../geo/ellipsoid'
import { tileKeyString, tilesForBounds, zoomForTileBudget } from '../geo/mercator'
import { NO_IMAGERY_COLOR, createTerrainEngine, type EngineDeps, type EngineTuning, type HeightFieldLike } from './engine'
import { TileFetchError } from './fetch'

// The engine wires these as defaults; the tests inject every dependency, so keep them inert.
// `./dem` is NOT mocked: mesh.ts needs its real `sampleGrid`, and `decodeDem` is always injected.
vi.mock('./fetch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./fetch')>()),
  createTileFetcher: vi.fn(() => ({ fetchBitmap: vi.fn(), stats: {}, clear: vi.fn() })),
}))
vi.mock('./heightField', () => ({ HeightField: class {} }))
vi.mock('./imagery', () => ({ loadImageryTexture: vi.fn() }))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TERRAIN: TerrainSource = {
  kind: 'terrain',
  id: 'fake-dem',
  name: 'DEM factice',
  urlTemplate: 'https://dem.test/{z}/{x}/{y}.png',
  minZoom: 0,
  maxZoom: 15,
  tileSize: 256,
  encoding: 'terrarium',
  attribution: 'test',
}
const TERRAIN_B: TerrainSource = { ...TERRAIN, id: 'fake-dem-b', urlTemplate: 'https://dem-b.test/{z}/{x}/{y}.png' }
const IMAGERY: ImagerySource = {
  kind: 'imagery',
  id: 'fake-ortho',
  name: 'Ortho factice',
  urlTemplate: 'https://ortho.test/{z}/{x}/{y}.jpg',
  minZoom: 0,
  maxZoom: 19,
  tileSize: 256,
  attribution: 'test',
}
/** ~46 km x 44 km around the Mont Blanc massif */
const AREA: LonLatBounds = { west: 6.6, south: 45.7, east: 7.2, north: 46.1 }
const FRAME = createLocalFrame(6.9, 45.9)
const ROOT_ZOOM = zoomForTileBudget(AREA, 16, TERRAIN.minZoom, TERRAIN.maxZoom)
const ROOT_KEYS = tilesForBounds(AREA, ROOT_ZOOM)

interface FakeDeps extends EngineDeps {
  /** DEM URLs requested, in order; `signals[i]` is the AbortSignal passed with `fetched[i]` */
  fetched: string[]
  signals: AbortSignal[]
  textures: Texture[]
  /** textures on which `dispose()` was called */
  disposedTextures: Texture[]
  field: Map<string, HeightGrid>
}

interface FakeDepsOptions {
  /** reject DEM fetches whose URL matches */
  failDem?: (url: string) => boolean
  /** error used for a rejected DEM fetch (default: a plain, retryable Error) */
  demError?: (url: string) => Error
  /** reject imagery loads */
  failImagery?: boolean
  /** hold every DEM fetch until `release()` is called */
  deferDem?: boolean
}

function createFakeDeps(options: FakeDepsOptions = {}): FakeDeps & { release: () => void } {
  const fetched: string[] = []
  const textures: Texture[] = []
  const disposedTextures: Texture[] = []
  const signals: AbortSignal[] = []
  const field = new Map<string, HeightGrid>()
  const pending: Array<() => void> = []

  const fetcher: TileFetcher = {
    fetchBitmap: vi.fn((url: string, opts?: { signal?: AbortSignal }) => {
      fetched.push(url)
      if (opts?.signal) signals.push(opts.signal)
      const run = (): Promise<ImageBitmap> => {
        if (opts?.signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
        if (options.failDem?.(url)) return Promise.reject(options.demError?.(url) ?? new Error(`HTTP 404 ${url}`))
        return Promise.resolve({ width: 4, height: 4, close() {} } as unknown as ImageBitmap)
      }
      if (!options.deferDem) return run()
      return new Promise<ImageBitmap>((resolve, reject) => {
        pending.push(() => run().then(resolve, reject))
      })
    }),
    stats: { inflight: 0, queued: 0, cached: 0, failed: 0 },
    clear: vi.fn(),
  }
  const decodeDem = vi.fn((): HeightGrid => ({ width: 4, height: 4, data: new Float32Array(16) }))
  const loadImageryTexture = vi.fn(async () => {
    if (options.failImagery) throw new Error('imagery down')
    const texture = new Texture()
    texture.addEventListener('dispose', () => disposedTextures.push(texture))
    textures.push(texture)
    return texture
  })
  const heightField: HeightFieldLike = {
    set: (key: TileKey, grid: HeightGrid) => {
      field.set(tileKeyString(key), grid)
    },
    delete: (key: TileKey) => field.delete(tileKeyString(key)),
    has: (key: TileKey) => field.has(tileKeyString(key)),
    sampleHeight: vi.fn((lon: number, lat: number) => (field.size > 0 ? lon + lat : undefined)),
    prune: vi.fn((max: number) => {
      let evicted = 0
      while (field.size > max) {
        const first = field.keys().next().value
        if (first === undefined) break
        field.delete(first)
        evicted++
      }
      return evicted
    }),
    clear: vi.fn(() => field.clear()),
  }
  return {
    fetcher,
    decodeDem,
    loadImageryTexture,
    heightField,
    fetched,
    textures,
    disposedTextures,
    signals,
    field,
    release: () => {
      const runs = pending.splice(0)
      for (const run of runs) run()
    },
  }
}

function makeOptions(partial: Partial<TerrainEngineOptions> = {}): TerrainEngineOptions {
  return {
    frame: FRAME,
    terrain: TERRAIN,
    imagery: IMAGERY,
    imageryZoomOffset: 1,
    area: AREA,
    exaggeration: 1,
    errorTargetPx: 8,
    segments: 16,
    ...partial,
  }
}

/** Camera looking straight down at the frame origin from `heightM`. */
function cameraAbove(heightM: number, fov = 50): PerspectiveCamera {
  const camera = new PerspectiveCamera(fov, 1, 1, 5e6)
  camera.position.set(0, heightM, 0)
  camera.up.set(0, 0, -1)
  camera.lookAt(new Vector3(0, 0, 0))
  camera.updateProjectionMatrix()
  return camera
}

function viewFrustum(camera: PerspectiveCamera): Frustum {
  camera.updateMatrixWorld()
  return new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
}

/** Let every pending promise chain settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function meshesOf(engine: { group: { children: unknown[] } }): Mesh[] {
  return engine.group.children.filter((o): o is Mesh => o instanceof Mesh)
}

const engines: Array<{ dispose(): void }> = []
function engineWith(deps: EngineDeps, options: Partial<TerrainEngineOptions> = {}, tuning: Partial<EngineTuning> = {}) {
  const engine = createTerrainEngine(makeOptions(options), deps, tuning)
  engines.push(engine)
  return engine
}

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTerrainEngine', () => {
  it('exposes a group named terrain and empty stats before the first update', () => {
    const engine = engineWith(createFakeDeps())
    expect(engine.group.name).toBe('terrain')
    expect(engine.group.children).toHaveLength(0)
    expect(engine.stats).toEqual({ visibleTiles: 0, loadedTiles: 0, pendingTiles: 0, failedTiles: 0 })
  })

  it('loads the root tiles after a few updates and renders them', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)

    engine.update(camera, 1000)
    expect(engine.stats.loadedTiles).toBe(0)
    expect(engine.stats.pendingTiles).toBe(ROOT_KEYS.length)
    expect(deps.fetched).toHaveLength(ROOT_KEYS.length)
    for (const key of ROOT_KEYS) expect(deps.fetched).toContain(`https://dem.test/${key.z}/${key.x}/${key.y}.png`)

    await settle()
    engine.update(camera, 1000)

    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
    expect(engine.stats.visibleTiles).toBe(ROOT_KEYS.length)
    expect(engine.stats.pendingTiles).toBe(0)
    expect(engine.stats.failedTiles).toBe(0)
    const meshes = meshesOf(engine)
    expect(meshes).toHaveLength(ROOT_KEYS.length)
    for (const mesh of meshes) {
      expect(mesh.visible).toBe(true)
      expect(mesh.name).toMatch(new RegExp(`^${ROOT_ZOOM}/`))
      const material = mesh.material as MeshStandardMaterial
      expect(material.map).toBeInstanceOf(Texture)
      expect(material.roughness).toBe(1)
      expect(material.metalness).toBe(0)
      expect(material.wireframe).toBe(false)
    }
    expect(deps.decodeDem).toHaveBeenCalledTimes(ROOT_KEYS.length)
    expect(deps.loadImageryTexture).toHaveBeenCalledTimes(ROOT_KEYS.length)
    expect(deps.field.size).toBe(ROOT_KEYS.length)
  })

  it('refines by replacement: the parent disappears once its children are ready', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps, { errorTargetPx: 1, maxZoom: ROOT_ZOOM + 1 })
    const camera = cameraAbove(4000)

    engine.update(camera, 1000)
    // unloaded roots already want refinement, so children are queued right behind them
    expect(engine.stats.pendingTiles).toBeGreaterThan(ROOT_KEYS.length)
    await settle()
    engine.update(camera, 1000)
    expect(engine.stats.visibleTiles).toBeGreaterThan(0)

    await settle()
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)

    const visible = meshesOf(engine).filter((m) => m.visible)
    const childVisible = visible.filter((m) => m.name.startsWith(`${ROOT_ZOOM + 1}/`))
    expect(childVisible.length).toBeGreaterThan(0)
    // every visible child's parent is hidden
    for (const mesh of childVisible) {
      const [z, x, y] = mesh.name.split('/').map(Number)
      const parentName = `${z - 1}/${x >> 1}/${y >> 1}`
      const parent = meshesOf(engine).find((m) => m.name === parentName)
      expect(parent?.visible ?? false).toBe(false)
    }
    // the visible meshes outside the view are shadow casters, not counted as drawn tiles
    const view = viewFrustum(camera)
    const drawn = visible.filter((m) => view.intersectsSphere(m.geometry.boundingSphere!))
    expect(drawn.length).toBeLessThan(visible.length)
    expect(engine.stats.visibleTiles).toBe(drawn.length)
    expect(engine.stats.loadedTiles).toBe(meshesOf(engine).length)
  })

  it('makes every tile cast and receive shadows, frustum-culled by three', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps)
    engine.update(cameraAbove(600_000), 1000)
    await settle()
    engine.update(cameraAbove(600_000), 1000)
    const meshes = meshesOf(engine)
    expect(meshes.length).toBeGreaterThan(0)
    for (const mesh of meshes) {
      expect(mesh.castShadow).toBe(true)
      expect(mesh.receiveShadow).toBe(true)
      expect(mesh.frustumCulled).toBe(true)
    }
  })

  it('coalesces onChange to once per update and supports unsubscribe', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    const cb = vi.fn()
    const off = engine.onChange(cb)

    engine.update(camera, 1000)
    expect(cb).not.toHaveBeenCalled()
    await settle()
    engine.update(camera, 1000)
    expect(cb).toHaveBeenCalledTimes(1)
    engine.update(camera, 1000)
    expect(cb).toHaveBeenCalledTimes(1)

    off()
    engine.setOptions({ exaggeration: 2 })
    engine.update(camera, 1000)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('keeps the tile when the imagery fails (grey material, no texture)', async () => {
    const deps = createFakeDeps({ failImagery: true })
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
    expect(engine.stats.failedTiles).toBe(0)
    for (const mesh of meshesOf(engine)) {
      const material = mesh.material as MeshStandardMaterial
      expect(material.map).toBeNull()
      expect(material.color.getHex()).toBe(NO_IMAGERY_COLOR)
    }
  })

  it('marks a tile failed when the DEM fails, retries after the delay, then gives up', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const badUrl = `https://dem.test/${ROOT_KEYS[0].z}/${ROOT_KEYS[0].x}/${ROOT_KEYS[0].y}.png`
    const deps = createFakeDeps({ failDem: (url) => url === badUrl })
    const engine = engineWith(deps, {}, { retryDelayFrames: 3, maxLoadAttempts: 2 })
    const camera = cameraAbove(600_000)
    const badFetches = () => deps.fetched.filter((u) => u === badUrl).length

    engine.update(camera, 1000) // frame 1: first attempt
    await settle() // fails during frame 1 -> retry allowed from frame 4
    engine.update(camera, 1000) // frame 2
    expect(engine.stats.failedTiles).toBe(1)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length - 1)
    expect(badFetches()).toBe(1)
    // The texture fetched alongside the failed DEM is released, not attached to a mesh, and the
    // imagery request of that node is cancelled (shared signal) while the others keep theirs.
    expect(deps.disposedTextures).toHaveLength(1)
    expect(meshesOf(engine).some((m) => (m.material as MeshStandardMaterial).map === deps.disposedTextures[0])).toBe(false)
    const badIndex = deps.fetched.indexOf(badUrl)
    expect(deps.signals[badIndex].aborted).toBe(true)
    expect(deps.signals.filter((s) => s.aborted)).toHaveLength(1)

    engine.update(camera, 1000) // frame 3: retry frame not reached yet
    expect(badFetches()).toBe(1)
    engine.update(camera, 1000) // frame 4: second attempt
    expect(badFetches()).toBe(2)
    expect(engine.stats.pendingTiles).toBe(1)
    await settle()
    for (let i = 0; i < 8; i++) engine.update(camera, 1000)
    // two attempts allowed: no third request, the tile stays failed
    expect(badFetches()).toBe(2)
    expect(engine.stats.failedTiles).toBe(1)
    expect(engine.stats.pendingTiles).toBe(0)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('treats an HTTP 4xx on the DEM as "no data": a leaf that is never retried nor counted as failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const badUrl = `https://dem.test/${ROOT_KEYS[0].z}/${ROOT_KEYS[0].x}/${ROOT_KEYS[0].y}.png`
    const deps = createFakeDeps({ failDem: (url) => url === badUrl, demError: (url) => new TileFetchError(url, 404) })
    const engine = engineWith(deps, {}, { retryDelayFrames: 2, maxLoadAttempts: 3 })
    const camera = cameraAbove(600_000)
    const badFetches = () => deps.fetched.filter((u) => u === badUrl).length

    engine.update(camera, 1000)
    await settle()
    for (let i = 0; i < 12; i++) engine.update(camera, 1000) // well past every retry delay
    expect(badFetches()).toBe(1)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length - 1)
    expect(engine.stats.failedTiles).toBe(0)
    expect(engine.stats.pendingTiles).toBe(0)
    expect(deps.disposedTextures).toHaveLength(1) // the orphan imagery of the no-data tile is released
    expect(warn).not.toHaveBeenCalled()
  })

  it('fails the tile (and frees its load slot) when the geometry cannot be built from the grid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = createFakeDeps()
    let corrupt = true
    const goodGrid = (): HeightGrid => ({ width: 4, height: 4, data: new Float32Array(16) })
    deps.decodeDem = vi.fn((): HeightGrid => {
      if (!corrupt) return goodGrid()
      corrupt = false
      return { width: 4, height: 4, data: undefined as unknown as Float32Array } // crashes the sampler
    })
    const engine = engineWith(deps, {}, { retryDelayFrames: 4, maxConcurrentLoads: ROOT_KEYS.length })
    const camera = cameraAbove(600_000)

    engine.update(camera, 1000) // frame 1
    await settle()
    engine.update(camera, 1000) // frame 2
    expect(engine.stats.failedTiles).toBe(1)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length - 1)
    expect(engine.stats.pendingTiles).toBe(0) // not stuck in 'loading'
    expect(deps.disposedTextures).toHaveLength(1) // the orphan texture of the failed node
    expect(warn).toHaveBeenCalledTimes(1)

    // Retry after the delay: the next decode is fine and the tile recovers.
    for (let i = 0; i < 3; i++) engine.update(camera, 1000) // frames 3-5, retry at frame 5
    expect(engine.stats.pendingTiles).toBe(1)
    await settle()
    engine.update(camera, 1000)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
    expect(engine.stats.failedTiles).toBe(0)
    expect(engine.stats.pendingTiles).toBe(0)
  })

  it('rebuilds loaded geometries lazily when the exaggeration changes', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps, {}, { rebuildsPerFrame: 2 })
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)
    const before = meshesOf(engine).map((m) => m.geometry)
    const disposeSpies = before.map((g) => vi.spyOn(g, 'dispose'))
    const cb = vi.fn()
    engine.onChange(cb)

    engine.setOptions({ exaggeration: 2 })
    expect(cb).not.toHaveBeenCalled()
    const frames = Math.ceil(ROOT_KEYS.length / 2)
    for (let i = 0; i < frames; i++) engine.update(camera, 1000)

    const after = meshesOf(engine).map((m) => m.geometry)
    expect(after).toHaveLength(before.length)
    for (let i = 0; i < before.length; i++) {
      expect(after[i]).not.toBe(before[i])
      expect(disposeSpies[i]).toHaveBeenCalledTimes(1)
    }
    expect(cb).toHaveBeenCalled()
    expect(cb.mock.calls.length).toBeLessThanOrEqual(frames)
    // all geometries are rebuilt within the budget: 2 per frame
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
  })

  it('toggles wireframe on existing materials', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)
    engine.setOptions({ wireframe: true })
    for (const mesh of meshesOf(engine)) expect((mesh.material as MeshStandardMaterial).wireframe).toBe(true)
    engine.setOptions({ wireframe: false })
    for (const mesh of meshesOf(engine)) expect((mesh.material as MeshStandardMaterial).wireframe).toBe(false)
  })

  it('rebuilds everything from the new sources when the terrain source changes', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)
    const oldMeshes = meshesOf(engine)
    const oldTextures = deps.textures.slice()
    const textureDispose = oldTextures.map((t) => vi.spyOn(t, 'dispose'))

    engine.setOptions({ terrain: TERRAIN_B })
    expect(engine.group.children).toHaveLength(0)
    expect(deps.heightField.clear).toHaveBeenCalled()
    for (const spy of textureDispose) expect(spy).toHaveBeenCalled()
    // stats reflect the empty tree right away, not only after the next update()
    expect(engine.stats).toEqual({ visibleTiles: 0, loadedTiles: 0, pendingTiles: 0, failedTiles: 0 })

    engine.update(camera, 1000)
    expect(engine.stats.loadedTiles).toBe(0)
    expect(deps.fetched.some((u) => u.startsWith('https://dem-b.test/'))).toBe(true)
    await settle()
    engine.update(camera, 1000)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
    const newMeshes = meshesOf(engine)
    expect(newMeshes).toHaveLength(ROOT_KEYS.length)
    for (const mesh of newMeshes) expect(oldMeshes).not.toContain(mesh)
  })

  it('does not refetch when an unrelated option changes', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)
    const fetchCount = deps.fetched.length
    engine.setOptions({ errorTargetPx: 5 })
    engine.update(camera, 1000)
    expect(deps.fetched).toHaveLength(fetchCount)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
  })

  it('unloads nodes that are no longer visited and keeps their ancestors', async () => {
    const deps = createFakeDeps()
    // errorTargetPx 8: the 4 km camera refines (it sits inside the root spheres), the 600 km one does not
    const engine = engineWith(deps, { maxZoom: ROOT_ZOOM + 1 }, { unloadAfterFrames: 3, sweepEveryFrames: 1 })
    const near = cameraAbove(4000)
    for (let i = 0; i < 4; i++) {
      engine.update(near, 1000)
      await settle()
    }
    engine.update(near, 1000)
    const childMeshes = meshesOf(engine).filter((m) => m.name.startsWith(`${ROOT_ZOOM + 1}/`))
    expect(childMeshes.length).toBeGreaterThan(0)
    const loadedBefore = engine.stats.loadedTiles

    // Move far away: children are no longer refined, so they stop being visited.
    const far = cameraAbove(600_000)
    const cb = vi.fn()
    engine.onChange(cb)
    for (let i = 0; i < 6; i++) {
      engine.update(far, 1000)
      await settle() // a root that was never on screen while zoomed in loads now
    }

    const remaining = meshesOf(engine)
    expect(remaining.every((m) => m.name.startsWith(`${ROOT_ZOOM}/`))).toBe(true)
    expect(remaining).toHaveLength(ROOT_KEYS.length)
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
    expect(engine.stats.loadedTiles).toBeLessThan(loadedBefore)
    expect(cb).toHaveBeenCalled()
    for (const mesh of childMeshes) expect(engine.group.children).not.toContain(mesh)
  })

  it('aborts in-flight loads and ignores their late results on dispose', async () => {
    const deps = createFakeDeps({ deferDem: true })
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    expect(deps.signals.length).toBe(ROOT_KEYS.length)
    expect(engine.stats.pendingTiles).toBe(ROOT_KEYS.length)

    engine.dispose()
    for (const signal of deps.signals) expect(signal.aborted).toBe(true)
    deps.release()
    await settle()

    expect(engine.group.children).toHaveLength(0)
    expect(engine.stats).toEqual({ visibleTiles: 0, loadedTiles: 0, pendingTiles: 0, failedTiles: 0 })
    expect(deps.heightField.clear).toHaveBeenCalled()
    // the injected fetcher is not owned by the engine
    expect(deps.fetcher.clear).not.toHaveBeenCalled()
    // update after dispose is a no-op
    engine.update(camera, 1000)
    expect(engine.group.children).toHaveLength(0)
  })

  it('frees geometries, textures and materials on dispose', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps)
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)
    const meshes = meshesOf(engine)
    const geometrySpies = meshes.map((m) => vi.spyOn(m.geometry, 'dispose'))
    const materialSpies = meshes.map((m) => vi.spyOn(m.material as MeshStandardMaterial, 'dispose'))
    const textureSpies = deps.textures.map((t) => vi.spyOn(t, 'dispose'))

    engine.dispose()

    for (const spy of [...geometrySpies, ...materialSpies, ...textureSpies]) expect(spy).toHaveBeenCalledTimes(1)
    expect(engine.group.children).toHaveLength(0)
    expect(deps.field.size).toBe(0)
  })

  it('delegates sampleHeight to the height field (true-scale heights)', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps, { exaggeration: 2.5 })
    expect(engine.sampleHeight(6.9, 45.9)).toBeUndefined()
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    expect(engine.sampleHeight(6.9, 45.9)).toBeCloseTo(6.9 + 45.9, 9)
    expect(deps.heightField.sampleHeight).toHaveBeenCalledWith(6.9, 45.9)
  })

  it('prunes the height field cache to the configured number of grids', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps, {}, { heightCacheEntries: 2 })
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    expect(deps.heightField.prune).toHaveBeenCalledWith(2)
    expect(deps.field.size).toBe(2)
  })

  it('counts the height cache budget in 256 px tile equivalents (a 512 px grid weighs four)', async () => {
    const deps = createFakeDeps()
    const engine = engineWith(deps, { terrain: { ...TERRAIN, tileSize: 512 } }, { heightCacheEntries: 8 })
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    expect(deps.heightField.prune).toHaveBeenCalledWith(2)
    expect(deps.field.size).toBe(2)
  })

  it('skips imagery requests for tiles outside the imagery coverage', async () => {
    const deps = createFakeDeps()
    const elsewhere: ImagerySource = { ...IMAGERY, coverage: { west: -10, south: 30, east: -5, north: 35 } }
    const engine = engineWith(deps, { imagery: elsewhere })
    const camera = cameraAbove(600_000)
    engine.update(camera, 1000)
    await settle()
    engine.update(camera, 1000)
    expect(deps.loadImageryTexture).not.toHaveBeenCalled()
    expect(engine.stats.loadedTiles).toBe(ROOT_KEYS.length)
  })
})

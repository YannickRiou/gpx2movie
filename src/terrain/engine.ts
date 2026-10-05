/**
 * Terrain engine: owns the quadtree, streams DEM + imagery tiles, builds meshes into a
 * THREE.Group and drives the level of detail once per frame. Framework-agnostic (no React).
 *
 * Data access (fetcher, DEM decoding, height field, imagery compositing) is injected through
 * `EngineDeps` so the engine can be driven in tests without network, canvas or WebGL.
 *
 * Lifecycle of a node: empty -> loading -> ready | failed. `update()` renders the selection,
 * starts loads within a concurrency budget, rebuilds dirty geometries (exaggeration change) with a
 * per-frame budget and periodically unloads nodes that have not been visited for a while.
 */
import { FrontSide, Group, Mesh, MeshStandardMaterial } from 'three'
import type { PerspectiveCamera, Texture } from 'three'
import type {
  BuildTileGeometryOptions,
  DemEncoding,
  HeightGrid,
  LoadImageryTexture,
  TerrainEngine,
  TerrainEngineOptions,
  TerrainStats,
  TileFetcher,
  TileKey,
} from '../core/types'
import { boundsIntersect, tileGroundSizeM, tileKeyString } from '../geo/mercator'
import { decodeDem as defaultDecodeDem } from './dem'
import { TileFetchError, createTileFetcher } from './fetch'
import { HeightField } from './heightField'
import { loadImageryTexture as defaultLoadImageryTexture } from './imagery'
import { buildTileGeometry } from './mesh'
import {
  TileNode,
  createCameraState,
  createRootNodes,
  createSelectionResult,
  forEachNode,
  selectTiles,
  updateCameraState,
  type QuadtreeContext,
  type SelectionParams,
} from './quadtree'
import { buildTileUrl } from './sources'

// ---------------------------------------------------------------------------
// Dependencies and tuning
// ---------------------------------------------------------------------------

/**
 * The subset of `HeightField` the engine relies on. Without `prune` the engine keeps its own
 * insertion-order LRU and evicts through `delete`; without `clear` it deletes the keys it set.
 * A field that prunes itself must also clear itself (the engine cannot enumerate its entries).
 */
export interface HeightFieldLike {
  set(key: TileKey, grid: HeightGrid): void
  delete(key: TileKey): boolean | void
  has(key: TileKey): boolean
  sampleHeight(lon: number, lat: number): number | undefined
  /** evict least recently used grids down to `maxEntries`; returns the number evicted */
  prune?(maxEntries: number): number
  clear?(): void
}

export interface EngineDeps {
  fetcher: TileFetcher
  decodeDem: (bitmap: ImageBitmap, encoding: DemEncoding) => HeightGrid
  loadImageryTexture: LoadImageryTexture
  heightField: HeightFieldLike
}

/** Knobs that do not belong to the public `TerrainEngineOptions` (mostly for tests and tuning). */
export interface EngineTuning {
  /** nodes loading at the same time */
  maxConcurrentLoads: number
  /** a node not visited by the selection for more than this many frames is unloaded */
  unloadAfterFrames: number
  /** how often the unload sweep runs, in frames */
  sweepEveryFrames: number
  /** dirty geometries rebuilt per frame after an exaggeration change */
  rebuildsPerFrame: number
  /**
   * Decoded grids kept in the height field (LRU), counted in 256 px tile equivalents: a 512 px
   * grid (Mapterhorn, 1 MB of Float32) weighs four entries, so the memory budget stays the same
   * whatever the terrain source (400 x 256 KB = 100 MB).
   */
  heightCacheEntries: number
  /** maximum number of root tiles */
  rootTileBudget: number
  /** a failed node is retried at most this many times */
  maxLoadAttempts: number
  /** frames to wait before retrying a failed node */
  retryDelayFrames: number
  /** skirt depth as a fraction of the tile ground size */
  skirtRatio: number
  /** minimum skirt depth, metres */
  minSkirtDepthM: number
}

export const DEFAULT_TUNING: Readonly<EngineTuning> = {
  maxConcurrentLoads: 24,
  unloadAfterFrames: 120,
  sweepEveryFrames: 30,
  rebuildsPerFrame: 4,
  heightCacheEntries: 400,
  rootTileBudget: 16,
  maxLoadAttempts: 3,
  retryDelayFrames: 300,
  skirtRatio: 0.015,
  minSkirtDepthM: 20,
}

export const DEFAULT_SEGMENTS = 64
export const DEFAULT_ERROR_TARGET_PX = 3
export const DEFAULT_IMAGERY_ZOOM_OFFSET = 1
/** material colour when a tile has no imagery (neutral grey) */
export const NO_IMAGERY_COLOR = 0x8a8f94

/**
 * A 4xx answer on a DEM tile means the source has no data there (Mapterhorn stops at z12 where
 * only Copernicus 30 m exists, swisstopo answers 400 out of bounds...). Such a tile is a leaf:
 * the parent keeps being rendered, nothing is retried and it is not an error for the user.
 */
export function isNoDataError(error: unknown): boolean {
  return error instanceof TileFetchError && error.status >= 400 && error.status < 500
}

interface ResolvedOptions {
  frame: TerrainEngineOptions['frame']
  area: TerrainEngineOptions['area']
  terrain: TerrainEngineOptions['terrain']
  imagery: TerrainEngineOptions['imagery']
  imageryZoomOffset: number
  exaggeration: number
  errorTargetPx: number
  /** effective refinement limit (never above the terrain source) */
  maxZoom: number
  segments: number
  wireframe: boolean
}

function resolveOptions(raw: TerrainEngineOptions): ResolvedOptions {
  const terrainMax = raw.terrain.maxZoom
  return {
    frame: raw.frame,
    area: raw.area,
    terrain: raw.terrain,
    imagery: raw.imagery,
    imageryZoomOffset: raw.imageryZoomOffset ?? DEFAULT_IMAGERY_ZOOM_OFFSET,
    exaggeration: raw.exaggeration ?? 1,
    errorTargetPx: raw.errorTargetPx ?? DEFAULT_ERROR_TARGET_PX,
    maxZoom: Math.max(raw.terrain.minZoom, Math.min(raw.maxZoom ?? terrainMax, terrainMax)),
    segments: Math.max(1, Math.floor(raw.segments ?? DEFAULT_SEGMENTS)),
    wireframe: raw.wireframe ?? false,
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function createTerrainEngine(
  options: TerrainEngineOptions,
  deps: Partial<EngineDeps> = {},
  tuning: Partial<EngineTuning> = {},
): TerrainEngine {
  const cfg: EngineTuning = { ...DEFAULT_TUNING, ...tuning }
  const ownsFetcher = deps.fetcher === undefined
  const io: EngineDeps = {
    fetcher: deps.fetcher ?? createTileFetcher(),
    decodeDem: deps.decodeDem ?? defaultDecodeDem,
    loadImageryTexture: deps.loadImageryTexture ?? defaultLoadImageryTexture,
    heightField: deps.heightField ?? new HeightField(),
  }

  let raw: TerrainEngineOptions = { ...options }
  let opts = resolveOptions(raw)

  const group = new Group()
  group.name = 'terrain'
  group.matrixAutoUpdate = false

  const stats: TerrainStats = { visibleTiles: 0, loadedTiles: 0, pendingTiles: 0, failedTiles: 0 }
  const listeners = new Set<() => void>()

  // Hot-path scratch state, allocated once.
  const cameraState = createCameraState()
  const selection = createSelectionResult()
  const selectionParams: SelectionParams = { errorTargetPx: 0, maxZoom: 0, frame: 0, maxLoadAttempts: cfg.maxLoadAttempts }
  const geometryOptions: BuildTileGeometryOptions = { segments: 0, exaggeration: 1, skirtDepthM: 0 }
  /** nodes whose mesh is currently visible */
  const rendered: TileNode[] = []
  /**
   * Keys pushed into the height field, insertion order: the engine-side LRU for a field that
   * cannot prune itself. Not maintained otherwise (it would grow with every tile ever loaded).
   */
  const trackGridKeys = io.heightField.prune === undefined
  const gridKeys = new Map<string, TileKey>()

  let ctx: QuadtreeContext = { frame: opts.frame, segments: opts.segments, exaggeration: opts.exaggeration }
  let roots: TileNode[] = []
  let frame = 0
  let loadingCount = 0
  let readyCount = 0
  let failedCount = 0
  let dirtyCount = 0
  let changed = false
  let disposed = false

  // --- tree -------------------------------------------------------------------

  function buildTree(): void {
    ctx = { frame: opts.frame, segments: opts.segments, exaggeration: opts.exaggeration }
    roots = createRootNodes(opts.area, opts.terrain.minZoom, opts.maxZoom, ctx, cfg.rootTileBudget)
  }

  function skirtDepthFor(node: TileNode): number {
    return Math.max(cfg.minSkirtDepthM, tileGroundSizeM(node.key) * cfg.skirtRatio) * opts.exaggeration
  }

  function buildGeometryFor(node: TileNode, grid: HeightGrid) {
    geometryOptions.segments = opts.segments
    geometryOptions.exaggeration = opts.exaggeration
    geometryOptions.skirtDepthM = skirtDepthFor(node)
    return buildTileGeometry(node.key, grid, opts.frame, geometryOptions)
  }

  function createMaterial(texture: Texture | undefined): MeshStandardMaterial {
    return new MeshStandardMaterial({
      map: texture ?? null,
      color: texture ? 0xffffff : NO_IMAGERY_COLOR,
      roughness: 1,
      metalness: 0,
      wireframe: opts.wireframe,
      side: FrontSide,
    })
  }

  // --- height field cache ----------------------------------------------------

  /** `heightCacheEntries` is expressed in 256 px tiles: scale it by the grid area of the source. */
  function heightCacheLimit(): number {
    const scale = (256 / opts.terrain.tileSize) ** 2
    return Math.max(1, Math.round(cfg.heightCacheEntries * scale))
  }

  function rememberGrid(key: TileKey, grid: HeightGrid): void {
    const field = io.heightField
    field.set(key, grid)
    const limit = heightCacheLimit()
    if (field.prune) {
      field.prune(limit)
      return
    }
    const id = tileKeyString(key)
    gridKeys.delete(id)
    gridKeys.set(id, key)
    while (gridKeys.size > limit) {
      const oldest = gridKeys.entries().next().value
      if (!oldest) break
      gridKeys.delete(oldest[0])
      field.delete(oldest[1])
    }
  }

  function clearHeightField(): void {
    const field = io.heightField
    if (field.clear) {
      field.clear()
    } else if (trackGridKeys) {
      for (const key of gridKeys.values()) field.delete(key)
    }
    gridKeys.clear()
  }

  // --- loading ------------------------------------------------------------------

  function startLoad(node: TileNode, rank: number): void {
    if (node.state === 'failed' && !node.noData) failedCount--
    const { terrain, imagery, imageryZoomOffset } = opts
    if (terrain.coverage && !boundsIntersect(terrain.coverage, node.bounds)) {
      // No elevation data there: fail permanently without a request (the parent stays rendered).
      markFailed(node, true)
      return
    }
    const token = ++node.loadToken
    const controller = new AbortController()
    const { signal } = controller
    node.abortController = controller
    node.state = 'loading'
    loadingCount++

    const demPromise = io.fetcher
      .fetchBitmap(buildTileUrl(terrain, node.key), { priority: rank, signal })
      .then((bitmap) => io.decodeDem(bitmap, terrain.encoding))

    const wantsImagery = !imagery.coverage || boundsIntersect(imagery.coverage, node.bounds)
    const texturePromise: Promise<Texture | undefined> = wantsImagery
      ? io
          .loadImageryTexture(node.key, imagery, io.fetcher, { zoomOffset: imageryZoomOffset, signal, priority: rank })
          .catch(() => undefined) // imagery failure never fails the node: grey material
      : Promise.resolve(undefined)

    Promise.all([demPromise, texturePromise]).then(
      ([grid, texture]) => {
        if (node.loadToken !== token || disposed) {
          texture?.dispose()
          return
        }
        node.abortController = undefined
        loadingCount--
        try {
          finishLoad(node, grid, texture)
        } catch (error) {
          // A grid the mesh builder rejects must not leave the node 'loading' forever.
          texture?.dispose()
          markFailed(node, false, error)
        }
      },
      (error: unknown) => {
        const cancelled = signal.aborted
        // The DEM is gone: the imagery still in flight is not worth finishing (the texture promise
        // then resolves to undefined), and a texture that already resolved must not leak.
        if (!cancelled) controller.abort()
        void texturePromise.then((texture) => texture?.dispose())
        if (node.loadToken !== token || disposed) return
        node.abortController = undefined
        loadingCount--
        if (cancelled) {
          node.state = 'empty'
          return
        }
        markFailed(node, isNoDataError(error), error)
      },
    )
  }

  /** Attach a decoded tile to the tree (geometry, material, mesh). Throws if the geometry cannot be built. */
  function finishLoad(node: TileNode, grid: HeightGrid, texture: Texture | undefined): void {
    const result = buildGeometryFor(node, grid)
    const mesh = new Mesh(result.geometry, createMaterial(texture))
    mesh.name = node.id
    mesh.frustumCulled = false // the quadtree already culls
    mesh.matrixAutoUpdate = false
    mesh.visible = false
    node.geometry = result.geometry
    node.texture = texture
    node.mesh = mesh
    node.setGeometryBounds(result.geometry)
    group.add(mesh)

    node.grid = grid
    rememberGrid(node.key, grid)
    node.state = 'ready'
    node.failedAttempts = 0
    readyCount++
    changed = true
  }

  /**
   * `permanent` = the source has no data for this tile (outside its coverage, HTTP 4xx): the node
   * becomes a leaf that is never retried and is NOT counted in `stats.failedTiles`. Otherwise the
   * failure is transient (network, 5xx, corrupt tile) and the node is retried after a delay.
   */
  function markFailed(node: TileNode, permanent: boolean, error?: unknown): void {
    node.abortController = undefined
    node.state = 'failed'
    node.noData = permanent
    node.failedAttempts = permanent ? cfg.maxLoadAttempts : node.failedAttempts + 1
    node.retryAtFrame = frame + cfg.retryDelayFrames
    if (permanent) return
    failedCount++
    if (import.meta.env.DEV && error !== undefined) {
      console.warn(`[terrain] tuile ${node.id} : chargement échoué (tentative ${node.failedAttempts})`, error)
    }
  }

  /** Cancel an in-flight load; stale results are ignored through `loadToken`. */
  function cancelLoad(node: TileNode): void {
    node.loadToken++
    if (node.abortController) {
      node.abortController.abort()
      node.abortController = undefined
    }
    if (node.state === 'loading') {
      loadingCount--
      node.state = 'empty'
    }
  }

  /** Free GPU resources and cached grid of one node; the node stays in the tree. */
  function unloadNode(node: TileNode): void {
    cancelLoad(node)
    if (node.mesh) {
      group.remove(node.mesh)
      node.mesh.material.dispose()
      node.mesh = undefined
      changed = true
    }
    if (node.geometry) {
      node.geometry.dispose()
      node.geometry = undefined
    }
    if (node.texture) {
      node.texture.dispose()
      node.texture = undefined
    }
    if (node.state === 'ready') readyCount--
    else if (node.state === 'failed' && !node.noData) failedCount--
    if (node.dirty) {
      node.dirty = false
      dirtyCount--
    }
    node.grid = undefined // the height field keeps its own (LRU) copy
    node.state = 'empty'
    node.noData = false
    node.resetBounds()
  }

  function disposeSubtree(root: TileNode): void {
    forEachNode([root], unloadNode, true)
    root.children = undefined
  }

  function disposeTree(): void {
    for (let i = 0; i < roots.length; i++) disposeSubtree(roots[i])
    roots = []
    rendered.length = 0
    selection.toRender.length = 0
    selection.toLoad.length = 0
    loadingCount = 0
    readyCount = 0
    failedCount = 0
    dirtyCount = 0
  }

  // --- unloading ------------------------------------------------------------------

  function hasRenderedDescendant(node: TileNode): boolean {
    for (let i = 0; i < rendered.length; i++) {
      if (node.isAncestorOf(rendered[i])) return true
    }
    return false
  }

  /**
   * Post-order sweep. Unloads stale nodes (not visited for more than `unloadAfterFrames` and not
   * an ancestor of a rendered node) and collapses idle subtrees. Returns true if the node can be
   * dropped from the tree.
   */
  function sweepNode(node: TileNode, threshold: number): boolean {
    const stale = node.lastVisitedFrame < threshold
    const children = node.children
    if (children) {
      let allDroppable = true
      for (let i = 0; i < 4; i++) {
        if (!sweepNode(children[i], threshold)) allDroppable = false
      }
      if (allDroppable && stale) {
        for (let i = 0; i < 4; i++) {
          if (children[i].state === 'failed' && !children[i].noData) failedCount--
        }
        node.children = undefined
      }
    }
    if (stale && node.parent !== undefined && (node.state === 'ready' || node.state === 'loading')) {
      if (!hasRenderedDescendant(node)) unloadNode(node)
    }
    return stale && node.children === undefined && (node.state === 'empty' || node.state === 'failed')
  }

  function sweep(): void {
    const threshold = frame - cfg.unloadAfterFrames
    for (let i = 0; i < roots.length; i++) sweepNode(roots[i], threshold)
  }

  // --- dirty geometries (exaggeration change) -------------------------------------

  function markAllDirty(): void {
    ctx.exaggeration = opts.exaggeration
    forEachNode(roots, (node) => {
      if (node.state === 'ready' && node.grid) {
        if (!node.dirty) {
          node.dirty = true
          dirtyCount++
        }
      } else if (!node.geometry) {
        node.resetBounds()
      }
    })
  }

  function rebuildGeometry(node: TileNode): void {
    node.dirty = false
    dirtyCount--
    if (!node.grid || !node.mesh) return
    const result = buildGeometryFor(node, node.grid)
    node.geometry?.dispose()
    node.geometry = result.geometry
    node.mesh.geometry = result.geometry
    node.setGeometryBounds(result.geometry)
    changed = true
  }

  function rebuildDirty(): void {
    let budget = cfg.rebuildsPerFrame
    for (let i = 0; i < rendered.length && budget > 0; i++) {
      if (rendered[i].dirty) {
        rebuildGeometry(rendered[i])
        budget--
      }
    }
    if (budget > 0 && dirtyCount > 0) {
      forEachNode(roots, (node) => {
        if (budget > 0 && node.dirty) {
          rebuildGeometry(node)
          budget--
        }
      })
    }
  }

  // --- change notifications ---------------------------------------------------------

  /** `pendingTiles` = nodes loading + nodes the last selection wanted but could not start. */
  function refreshStats(pendingTiles: number): void {
    stats.visibleTiles = rendered.length
    stats.loadedTiles = readyCount
    stats.pendingTiles = pendingTiles
    stats.failedTiles = failedCount
  }

  function flushChange(): void {
    if (!changed) return
    changed = false
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        if (import.meta.env.DEV) console.error('[terrain] onChange listener threw', error)
      }
    }
  }

  // --- public API -------------------------------------------------------------------

  function update(camera: PerspectiveCamera, viewportHeightPx: number): void {
    if (disposed) return
    frame++
    updateCameraState(cameraState, camera, viewportHeightPx)
    selectionParams.errorTargetPx = opts.errorTargetPx
    selectionParams.maxZoom = opts.maxZoom
    selectionParams.frame = frame
    selectTiles(roots, cameraState, selectionParams, selection)

    // Visibility: only the selected nodes draw.
    for (let i = 0; i < rendered.length; i++) {
      const mesh = rendered[i].mesh
      if (mesh) mesh.visible = false
    }
    rendered.length = 0
    const toRender = selection.toRender
    for (let i = 0; i < toRender.length; i++) {
      const node = toRender[i]
      if (node.mesh) {
        node.mesh.visible = true
        rendered.push(node)
      }
    }

    // Loads, highest priority first, within the concurrency budget.
    const toLoad = selection.toLoad
    let started = 0
    for (let i = 0; i < toLoad.length && loadingCount < cfg.maxConcurrentLoads; i++) {
      startLoad(toLoad[i], i)
      started++
    }

    if (dirtyCount > 0) rebuildDirty()
    if (frame % cfg.sweepEveryFrames === 0) sweep()

    refreshStats(loadingCount + (toLoad.length - started))
    flushChange()
  }

  function sampleHeight(lon: number, lat: number): number | undefined {
    return io.heightField.sampleHeight(lon, lat)
  }

  function setOptions(partial: Partial<Omit<TerrainEngineOptions, 'frame' | 'area'>>): void {
    if (disposed) return
    const prev = opts
    raw = { ...raw, ...partial, frame: raw.frame, area: raw.area }
    opts = resolveOptions(raw)

    const terrainChanged = opts.terrain.id !== prev.terrain.id
    const sourcesChanged =
      terrainChanged ||
      opts.imagery.id !== prev.imagery.id ||
      opts.imageryZoomOffset !== prev.imageryZoomOffset ||
      opts.segments !== prev.segments
    if (sourcesChanged) {
      disposeTree()
      if (terrainChanged) clearHeightField()
      buildTree()
      refreshStats(0)
      changed = true
      return
    }
    if (opts.exaggeration !== prev.exaggeration) markAllDirty()
    if (opts.wireframe !== prev.wireframe) {
      forEachNode(roots, (node) => {
        if (node.mesh) node.mesh.material.wireframe = opts.wireframe
      })
    }
    // errorTargetPx and maxZoom are read by the next update()
  }

  function onChange(cb: () => void): () => void {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    disposeTree()
    listeners.clear()
    clearHeightField()
    if (ownsFetcher) io.fetcher.clear()
    group.clear()
    refreshStats(0)
  }

  buildTree()

  return { group, update, sampleHeight, setOptions, onChange, stats, dispose }
}

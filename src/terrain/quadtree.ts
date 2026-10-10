/**
 * Terrain quadtree: tile nodes, conservative bounding volumes and the LOD selection (replacement refinement driven by
 * screen-space error). Pure logic on three's math classes: no WebGL, no DOM. The engine (engine.ts) owns the loading and
 * disposal side effects; this module only decides what to render and what to load, in which order.
 */
import { Frustum, Matrix4, Sphere, Vector3 } from 'three'
import type { BufferGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, Texture } from 'three'
import type { HeightGrid, LocalFrame, LonLatBounds, TileKey } from '../core/types'
import {
  boundsIntersect,
  childrenOf,
  tileBounds,
  tileGroundSizeM,
  tileKeyString,
  tilesForBounds,
  zoomForTileBudget,
} from '../geo/mercator'

export type TileState = 'empty' | 'loading' | 'ready' | 'failed'

/** Height range (metres) assumed for a tile until its DEM is decoded (conservative sphere). */
export const UNLOADED_MIN_HEIGHT_M = -500
export const UNLOADED_MAX_HEIGHT_M = 9000
/** Safety margin applied to the conservative sphere radius (covers the curvature between samples). */
const CONSERVATIVE_SPHERE_MARGIN = 1.02

/** Shared context of every node of one tree (owned by the engine). */
export interface QuadtreeContext {
  frame: LocalFrame
  /** grid segments per tile edge (drives the geometric error) */
  segments: number
  /** vertical exaggeration applied to the conservative height range; default 1 */
  exaggeration?: number
}

export type TileMesh = Mesh<BufferGeometry, MeshStandardMaterial>

export class TileNode {
  readonly key: TileKey
  /** "z/x/y" */
  readonly id: string
  readonly bounds: LonLatBounds
  readonly parent: TileNode | undefined
  readonly ctx: QuadtreeContext
  children: readonly [TileNode, TileNode, TileNode, TileNode] | undefined = undefined

  state: TileState = 'empty'
  mesh: TileMesh | undefined = undefined
  geometry: BufferGeometry | undefined = undefined
  texture: Texture | undefined = undefined
  /** decoded DEM, kept while the node is loaded so the geometry can be rebuilt (exaggeration change) */
  grid: HeightGrid | undefined = undefined
  /** local-frame bounding sphere: tight once the geometry is loaded, conservative otherwise */
  readonly boundingSphere = new Sphere()
  /** world-space size of one grid cell, metres (≈ tileGroundSizeM / segments) */
  readonly geometricError: number

  /** frame counter of the last selection pass that touched this node */
  lastVisitedFrame = -1
  /** engine clock (ms) until which the unload sweep keeps this node: its latest selection pass's `keepUntil` */
  keepUntil = 0
  /** screen-space error from the last selection pass (0 when culled) */
  sse = 0
  /** load priority from the last selection pass (higher = sooner) */
  priority = 0
  /** geometry must be rebuilt from `grid` (exaggeration changed) */
  dirty = false

  /** cancels the in-flight load (engine-owned) */
  abortController: AbortController | undefined = undefined
  /** incremented on every load start / cancel; stale async results compare against it */
  loadToken = 0
  failedAttempts = 0
  /**
   * The source has no data for this tile (outside its coverage, HTTP 4xx): a permanent leaf,
   * never retried, not an error. Only meaningful while `state === 'failed'`.
   */
  noData = false
  /** engine clock (ms) from which a failed node may be retried */
  retryAt = 0

  constructor(key: TileKey, parent: TileNode | undefined, ctx: QuadtreeContext) {
    this.key = key
    this.id = tileKeyString(key)
    this.bounds = tileBounds(key)
    this.parent = parent
    this.ctx = ctx
    this.geometricError = tileGroundSizeM(key) / ctx.segments
    this.resetBounds()
  }

  /** Create the four children on first use. */
  ensureChildren(): readonly [TileNode, TileNode, TileNode, TileNode] {
    if (!this.children) {
      const keys = childrenOf(this.key)
      this.children = [
        new TileNode(keys[0], this, this.ctx),
        new TileNode(keys[1], this, this.ctx),
        new TileNode(keys[2], this, this.ctx),
        new TileNode(keys[3], this, this.ctx),
      ]
    }
    return this.children
  }

  /** Tighten the bounding sphere to a loaded geometry (local frame, identity transform). */
  setGeometryBounds(geometry: BufferGeometry): void {
    if (!geometry.boundingSphere) geometry.computeBoundingSphere()
    this.boundingSphere.copy(geometry.boundingSphere!)
  }

  /** Back to the conservative sphere (after the geometry is disposed, or when the exaggeration changes). */
  resetBounds(): void {
    const scale = this.ctx.exaggeration ?? 1
    computeConservativeSphere(
      this.bounds,
      this.ctx.frame,
      this.boundingSphere,
      UNLOADED_MIN_HEIGHT_M * scale,
      UNLOADED_MAX_HEIGHT_M * scale,
    )
  }

  isAncestorOf(node: TileNode): boolean {
    let p = node.parent
    while (p) {
      if (p === this) return true
      p = p.parent
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// Bounding volumes
// ---------------------------------------------------------------------------

const SAMPLE_FRACTIONS = [0, 0.5, 1] as const
const SAMPLE_POINTS: Vector3[] = Array.from({ length: SAMPLE_FRACTIONS.length ** 2 * 2 }, () => new Vector3())
const boxMin = new Vector3()
const boxMax = new Vector3()

/**
 * Sphere enclosing the tile volume between heights [minHeightM, maxHeightM] (default: the
 * unloaded range). Nine lon/lat samples (corners, edge midpoints, centre) at both heights are
 * projected into the local frame; the sphere is centred on their box with a small margin.
 */
export function computeConservativeSphere(
  bounds: LonLatBounds,
  frame: LocalFrame,
  target = new Sphere(),
  minHeightM = UNLOADED_MIN_HEIGHT_M,
  maxHeightM = UNLOADED_MAX_HEIGHT_M,
): Sphere {
  let n = 0
  for (const fy of SAMPLE_FRACTIONS) {
    const lat = bounds.north + (bounds.south - bounds.north) * fy
    for (const fx of SAMPLE_FRACTIONS) {
      const lon = bounds.west + (bounds.east - bounds.west) * fx
      frame.toLocal(lon, lat, minHeightM, SAMPLE_POINTS[n++])
      frame.toLocal(lon, lat, maxHeightM, SAMPLE_POINTS[n++])
    }
  }
  boxMin.copy(SAMPLE_POINTS[0])
  boxMax.copy(SAMPLE_POINTS[0])
  for (let i = 1; i < n; i++) {
    boxMin.min(SAMPLE_POINTS[i])
    boxMax.max(SAMPLE_POINTS[i])
  }
  target.center.addVectors(boxMin, boxMax).multiplyScalar(0.5)
  let radiusSq = 0
  for (let i = 0; i < n; i++) {
    const d = target.center.distanceToSquared(SAMPLE_POINTS[i])
    if (d > radiusSq) radiusSq = d
  }
  target.radius = Math.sqrt(radiusSq) * CONSERVATIVE_SPHERE_MARGIN
  return target
}

// ---------------------------------------------------------------------------
// Camera state (extracted once per frame; everything below is allocation-free)
// ---------------------------------------------------------------------------

export interface CameraState {
  /** camera position in the local frame */
  position: Vector3
  frustum: Frustum
  /** tan(vertical fov / 2) */
  tanHalfFov: number
  viewportHeightPx: number
}

export function createCameraState(): CameraState {
  return { position: new Vector3(), frustum: new Frustum(), tanHalfFov: 1, viewportHeightPx: 1 }
}

const DEG = Math.PI / 180
const viewProjection = new Matrix4()

/** Refresh `state` from a camera whose world matrix is current (updateMatrixWorld is called here). */
export function updateCameraState(state: CameraState, camera: PerspectiveCamera, viewportHeightPx: number): void {
  camera.updateMatrixWorld()
  viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  state.frustum.setFromProjectionMatrix(viewProjection)
  state.position.setFromMatrixPosition(camera.matrixWorld)
  state.tanHalfFov = Math.tan(camera.fov * 0.5 * DEG)
  state.viewportHeightPx = Math.max(1, viewportHeightPx)
}

/**
 * Screen-space error in pixels: how large one grid cell of the tile appears on screen.
 * sse = geometricError · viewportH / (2 · distance · tan(fov / 2)), distance measured to the
 * nearest point of the bounding sphere (clamped to 1 m, so being inside the sphere refines).
 */
export function screenSpaceError(geometricError: number, sphere: Sphere, camera: CameraState): number {
  const distance = Math.max(1, camera.position.distanceTo(sphere.center) - sphere.radius)
  return (geometricError * camera.viewportHeightPx) / (2 * distance * camera.tanHalfFov)
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface SelectionParams {
  /** refine while sse > errorTargetPx */
  errorTargetPx: number
  /** never create nodes deeper than this zoom */
  maxZoom: number
  /** outside this area, nodes stop at `outerMaxZoom` (when both are set) */
  detailArea?: LonLatBounds
  outerMaxZoom?: number
  /** current frame counter (stamps lastVisitedFrame) */
  frame: number
  /** engine clock (ms): gates retries; default 0 */
  now?: number
  /** stamped on the visited nodes (the latest wins): the sweep keeps them until then; default 0 */
  keepUntil?: number
  /** failed nodes are re-queued at most this many times; default 3 */
  maxLoadAttempts?: number
}

export interface SelectionResult {
  /** ready nodes to draw this frame (no overlap between a node and its descendants) */
  toRender: TileNode[]
  /** nodes that should be loaded, highest priority first */
  toLoad: TileNode[]
  /**
   * In-frustum nodes the view is waiting for (loading or loadable): 0 once the drawn selection is final.
   * Culled nodes (shadow casters, low-priority children) are not counted.
   */
  pendingVisible: number
}

export function createSelectionResult(): SelectionResult {
  return { toRender: [], toLoad: [], pendingVisible: 0 }
}

const DEFAULT_MAX_LOAD_ATTEMPTS = 3

interface SelectionContext {
  camera: CameraState
  params: SelectionParams
  maxLoadAttempts: number
  out: SelectionResult
}

const selectionContext: SelectionContext = {
  camera: createCameraState(),
  params: { errorTargetPx: 3, maxZoom: 0, frame: 0 },
  maxLoadAttempts: DEFAULT_MAX_LOAD_ATTEMPTS,
  out: createSelectionResult(),
}

/**
 * Replacement refinement: a visible node whose sse exceeds the target is split, but its children replace it only when
 * every child in the frustum is ready (the others are queued at low priority); until then the parent keeps being
 * rendered. A node that should be drawn but is not ready is queued and its ready descendants are drawn instead, so the
 * area is never left empty. Never split beyond `maxZoom`. `toLoad` is sorted by priority (visible: sse descending, then
 * culled nodes shallowest first). `out` is reused between calls so the hot path does not allocate.
 */
export function selectTiles(
  roots: readonly TileNode[],
  camera: CameraState,
  params: SelectionParams,
  out: SelectionResult = createSelectionResult(),
): SelectionResult {
  out.toRender.length = 0
  out.toLoad.length = 0
  out.pendingVisible = 0
  const ctx = selectionContext
  ctx.camera = camera
  ctx.params = params
  ctx.maxLoadAttempts = params.maxLoadAttempts ?? DEFAULT_MAX_LOAD_ATTEMPTS
  ctx.out = out
  for (let i = 0; i < roots.length; i++) visit(roots[i], ctx)
  out.toLoad.sort(byPriorityDesc)
  return out
}

function byPriorityDesc(a: TileNode, b: TileNode): number {
  return b.priority - a.priority
}

/** True if the node may be (re)queued for loading. */
export function isLoadable(node: TileNode, now: number, maxLoadAttempts = DEFAULT_MAX_LOAD_ATTEMPTS): boolean {
  if (node.state === 'empty') return true
  if (node.state === 'failed') return node.failedAttempts < maxLoadAttempts && now >= node.retryAt
  return false
}

function queueLoad(node: TileNode, priority: number, ctx: SelectionContext): void {
  node.priority = priority
  const loadable = isLoadable(node, ctx.params.now ?? 0, ctx.maxLoadAttempts)
  if (loadable) ctx.out.toLoad.push(node)
  // visible nodes have a priority >= 0 (their sse), culled ones a negative one; the view waits for a first attempt
  // only, a failed node's retry loads in the background (unreachable hosts would otherwise hold every export frame)
  if (priority >= 0 && node.failedAttempts === 0 && (loadable || node.state === 'loading')) ctx.out.pendingVisible++
}

/** Priority of a culled node: always below any visible node, shallow levels first. */
function culledPriority(node: TileNode): number {
  return -1 - node.key.z
}

/** Mark `node` as touched by this selection pass (casters, unload sweep). */
function stamp(node: TileNode, params: SelectionParams): void {
  node.lastVisitedFrame = params.frame
  node.keepUntil = Math.max(node.keepUntil, params.keepUntil ?? 0)
}

function visit(node: TileNode, ctx: SelectionContext): void {
  const { camera, params } = ctx
  stamp(node, params)
  const visible = camera.frustum.intersectsSphere(node.boundingSphere)
  if (!visible) {
    node.sse = 0
    queueLoad(node, culledPriority(node), ctx)
    return
  }
  const sse = screenSpaceError(node.geometricError, node.boundingSphere, camera)
  node.sse = sse

  const wantRefine = sse > params.errorTargetPx && node.key.z < zoomLimit(node, params)
  if (!wantRefine) {
    renderOrQueue(node, sse, ctx)
    return
  }

  const children = node.ensureChildren()
  let replaceable = true
  for (let i = 0; i < 4; i++) {
    const child = children[i]
    if (child.state !== 'ready' && camera.frustum.intersectsSphere(child.boundingSphere)) {
      replaceable = false
      break
    }
  }

  if (replaceable) {
    for (let i = 0; i < 4; i++) visit(children[i], ctx)
    return
  }

  // Parent stays on screen until the visible children are all ready.
  renderOrQueue(node, sse, ctx)
  for (let i = 0; i < 4; i++) {
    const child = children[i]
    stamp(child, params)
    if (camera.frustum.intersectsSphere(child.boundingSphere)) {
      child.sse = screenSpaceError(child.geometricError, child.boundingSphere, camera)
      queueLoad(child, child.sse, ctx)
    } else {
      child.sse = 0
      queueLoad(child, culledPriority(child), ctx)
    }
  }
}

/** Deepest zoom `node` may refine to: `maxZoom`, or `outerMaxZoom` when it lies outside the detail area. */
export function zoomLimit(node: TileNode, params: SelectionParams): number {
  const { detailArea, outerMaxZoom } = params
  if (!detailArea || outerMaxZoom === undefined || boundsIntersect(node.bounds, detailArea)) return params.maxZoom
  return Math.min(params.maxZoom, outerMaxZoom)
}

/**
 * Draw `node` if it is ready; otherwise queue it and fall back to the best ready descendants in
 * the frustum, which are stamped so the sweep keeps them while the node loads.
 */
function renderOrQueue(node: TileNode, sse: number, ctx: SelectionContext): void {
  if (node.state === 'ready' && node.mesh) {
    node.priority = sse
    ctx.out.toRender.push(node)
    return
  }
  queueLoad(node, sse, ctx)
  if (node.children) renderReadyDescendants(node.children, ctx)
}

function renderReadyDescendants(children: readonly TileNode[], ctx: SelectionContext): void {
  const { camera, params } = ctx
  for (let i = 0; i < 4; i++) {
    const child = children[i]
    if (!camera.frustum.intersectsSphere(child.boundingSphere)) continue
    stamp(child, params)
    if (child.state === 'ready' && child.mesh) ctx.out.toRender.push(child)
    else if (child.children) renderReadyDescendants(child.children, ctx)
  }
}

// ---------------------------------------------------------------------------
// Roots
// ---------------------------------------------------------------------------

/**
 * Root nodes covering `area`: the coarsest zoom that needs at most `tileBudget` tiles, clamped to
 * [minZoom, maxZoom]. Tiles entirely outside the area are never created.
 */
export function createRootNodes(
  area: LonLatBounds,
  minZoom: number,
  maxZoom: number,
  ctx: QuadtreeContext,
  tileBudget = 16,
): TileNode[] {
  const z = zoomForTileBudget(area, tileBudget, minZoom, Math.max(minZoom, maxZoom))
  return tilesForBounds(area, z).map((key) => new TileNode(key, undefined, ctx))
}

/** Depth-first visit of every node of the tree (children before parent when `postOrder`). */
export function forEachNode(roots: readonly TileNode[], fn: (node: TileNode) => void, postOrder = false): void {
  for (let i = 0; i < roots.length; i++) walk(roots[i], fn, postOrder)
}

function walk(node: TileNode, fn: (node: TileNode) => void, postOrder: boolean): void {
  if (!postOrder) fn(node)
  const children = node.children
  if (children) {
    for (let i = 0; i < 4; i++) walk(children[i], fn, postOrder)
  }
  if (postOrder) fn(node)
}

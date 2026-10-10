/**
 * OpenFlyover — shared contracts between modules.
 * Do NOT change the shape of an exported interface without updating ARCHITECTURE.md and every consumer.
 *
 * Coordinate conventions (details: ARCHITECTURE.md "Coordinate conventions")
 * - lon/lat are WGS84 decimal degrees. Scene heights are metres above mean sea level, placed by the local frame as if
 *   they were ellipsoid heights: the scene sits N (geoid undulation) too low, which only matters to what reads it in
 *   true ECEF (atmosphere, clouds: `mslLocalToEcef` in src/geo/geoid.ts).
 * - ECEF is Earth-Centred Earth-Fixed (metres), right-handed, X through lon=0/lat=0, Z through the north pole.
 * - The Three.js scene lives in a LOCAL FRAME tangent to the ellipsoid at the trip centroid: +X east, +Y up, +Z south,
 *   origin at height 0. ECEF -> local conversions run in JS doubles so float32 GPU buffers keep millimetre precision.
 * - Tile keys use the Google/XYZ Web Mercator scheme: y = 0 at the north edge.
 */
import type { BufferGeometry, Group, Matrix4, PerspectiveCamera, Texture, Vector3 } from 'three'

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

export interface LonLat {
  lon: number
  lat: number
}

export interface LonLatBounds {
  west: number
  south: number
  east: number
  north: number
}

/** Local tangent frame (X east, Y up, Z south) centred on `origin`. */
export interface LocalFrame {
  origin: LonLat
  /** ECEF position of the origin (height 0). */
  originEcef: Vector3
  /** local -> ECEF */
  localToEcef: Matrix4
  /** ECEF -> local */
  ecefToLocal: Matrix4
  /** lon/lat in degrees, height in metres -> local Three.js coordinates. */
  toLocal(lon: number, lat: number, height: number, target?: Vector3): Vector3
  /** local Three.js coordinates -> lon/lat degrees + ellipsoid height. */
  toLonLat(local: Vector3): { lon: number; lat: number; height: number }
}

// ---------------------------------------------------------------------------
// Tracks (GPX / FIT)
// ---------------------------------------------------------------------------

export interface TrackPoint {
  lon: number
  lat: number
  /** metres, as recorded by the device (may be undefined) */
  ele?: number
  /** milliseconds since epoch */
  time?: number
  hr?: number
  cad?: number
  power?: number
  temp?: number
}

export interface TrackSegment {
  points: TrackPoint[]
}

export interface TrackStats {
  distanceM: number
  ascentM: number
  descentM: number
  durationS?: number
  minEle?: number
  maxEle?: number
  startTime?: number
  endTime?: number
  pointCount: number
}

export interface Track {
  /** stable unique id (e.g. crypto.randomUUID()) */
  id: string
  name: string
  source: 'gpx' | 'fit' | 'strava'
  activityType?: string
  segments: TrackSegment[]
  stats: TrackStats
  bounds: LonLatBounds
  /** CSS colour used for the 3D line and the UI swatch */
  color: string
  /** named points of the file (GPX <wpt>), attached to the first track of the file; absent when none */
  waypoints?: Waypoint[]
  /**
   * minutes the local clock of the recording was ahead of UTC (FIT activity local timestamp, GPX times written with
   * an offset); absent when the file does not say
   */
  utcOffsetMin?: number
  /** the point times are estimated from a planned departure (« Prévoir la sortie », src/plan/timing.ts), not recorded */
  timesEstimated?: boolean
}

/** A named point stored with a track (GPX <wpt>), not part of the path. */
export interface Waypoint {
  lon: number
  lat: number
  /** metres, as recorded (may be undefined) */
  ele?: number
  name: string
}

// ---------------------------------------------------------------------------
// Tile sources
// ---------------------------------------------------------------------------

/** Google/XYZ scheme, y = 0 at the north edge. */
export interface TileKey {
  z: number
  x: number
  y: number
}

export interface TileSourceBase {
  id: string
  name: string
  /**
   * URL template. Placeholders: {z} {x} {y}, {-y} (TMS-flipped y), {s} (one of `subdomains`).
   * May be a relative path starting with "/" when the Vite dev proxy is used (see vite.config.ts).
   */
  urlTemplate: string
  subdomains?: string[]
  minZoom: number
  maxZoom: number
  /** pixel size of one tile (256 or 512) */
  tileSize: number
  /** attribution text that MUST be displayed in the UI */
  attribution: string
  /** where the source has data; undefined = worldwide */
  coverage?: LonLatBounds
}

/** How elevation is encoded in RGB tiles. */
export type DemEncoding = 'terrarium' | 'mapbox'

export interface TerrainSource extends TileSourceBase {
  kind: 'terrain'
  encoding: DemEncoding
}

export interface ImagerySource extends TileSourceBase {
  kind: 'imagery'
}

/** Decoded elevation tile. Row-major, row 0 = north edge, metres (NaN = nodata). */
export interface HeightGrid {
  width: number
  height: number
  data: Float32Array
}

// ---------------------------------------------------------------------------
// Terrain engine (framework-agnostic, drives a THREE.Group)
// ---------------------------------------------------------------------------

export interface TerrainEngineOptions {
  frame: LocalFrame
  terrain: TerrainSource
  imagery: ImagerySource
  /**
   * Imagery is fetched at zoom (terrain tile z + imageryZoomOffset) and composited into ONE texture
   * per terrain tile (2^offset x 2^offset sub-tiles). 0, 1 or 2. Default 1.
   */
  imageryZoomOffset: number
  /** area of interest (lon/lat); tiles entirely outside are never created */
  area: LonLatBounds
  /**
   * when set, only the tiles touching it refine down to `maxZoom`; the rest of `area` (the distant landscape of a
   * view from very high) stops at a coarse zoom
   */
  detailArea?: LonLatBounds
  /** vertical exaggeration, 1 = true scale */
  exaggeration: number
  /** screen-space error threshold in pixels (refine when error is larger). Default 3. */
  errorTargetPx: number
  /** clamp refinement; default = terrain.maxZoom */
  maxZoom?: number
  /** grid segments per tile edge; default 64 */
  segments?: number
  /** debug: render wireframe */
  wireframe?: boolean
}

export interface TerrainStats {
  visibleTiles: number
  loadedTiles: number
  pendingTiles: number
  failedTiles: number
  /**
   * Tiles the current view still waits for before what it draws is final (in the frustum, loading or
   * queued); excludes shadow casters, off-screen children, prefetches and the retries of failed tiles. Used by the
   * video export.
   */
  pendingVisibleTiles?: number
}

export interface TerrainEngine {
  /** add this to the scene once */
  readonly group: Group
  /** call once per frame before rendering */
  update(camera: PerspectiveCamera, viewportHeightPx: number): void
  /**
   * Terrain height at lon/lat as drawn (the mesh of the tile on screen there, else the deepest loaded tile), in
   * metres (true scale, NOT exaggerated), or undefined if no tile covering the point is loaded yet.
   */
  sampleHeight(lon: number, lat: number): number | undefined
  setOptions(partial: Partial<Omit<TerrainEngineOptions, 'frame' | 'area'>>): void
  /** subscribe to "something became ready/removed" (coalesced to at most once per frame). Returns unsubscribe. */
  onChange(cb: () => void): () => void
  readonly stats: TerrainStats
  /**
   * Request, after the current view's tiles, the missing tiles another camera would draw (e.g. an upcoming
   * frame of the video export). Changes neither what is drawn nor the stats; bounded to part of the load
   * budget. Returns the number of loads started.
   */
  prefetch?(camera: PerspectiveCamera, viewportHeightPx: number): number
  dispose(): void
}

// ---------------------------------------------------------------------------
// Lower-level terrain building blocks (so quadtree/engine and data modules can be built in parallel)
// ---------------------------------------------------------------------------

export interface TileFetcherStats {
  inflight: number
  queued: number
  cached: number
  failed: number
}

/** Fetches and caches decoded ImageBitmaps with concurrency limiting and in-flight de-duplication. */
export interface TileFetcher {
  /**
   * Resolve to a decoded bitmap. `priority` lower = sooner. Rejects on HTTP/network error or abort.
   * Cached results are returned synchronously-resolved.
   */
  fetchBitmap(url: string, options?: { priority?: number; signal?: AbortSignal }): Promise<ImageBitmap>
  readonly stats: TileFetcherStats
  clear(): void
}

export interface BuildTileGeometryOptions {
  /** grid segments per tile edge (vertices = (segments+1)^2 before skirts) */
  segments: number
  exaggeration: number
  /** how far the skirt hangs below the edge, metres (hides cracks between LOD levels) */
  skirtDepthM: number
}

export interface TileGeometryResult {
  geometry: BufferGeometry
  /** min / max of the (exaggerated) heights used, metres */
  minHeight: number
  maxHeight: number
}

export interface LoadImageryOptions {
  zoomOffset: number
  signal?: AbortSignal
  priority?: number
}

export type LoadImageryTexture = (
  key: TileKey,
  source: ImagerySource,
  fetcher: TileFetcher,
  options: LoadImageryOptions,
) => Promise<Texture>

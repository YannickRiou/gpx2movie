/**
 * Application state (zustand). Single store shared by the UI and the 3D scene.
 *
 * Derived values (bounds, frameOrigin) are recomputed eagerly inside the actions so that
 * consumers can subscribe to them with plain selectors and no memoisation.
 */
import { create } from 'zustand'
import type { LonLat, LonLatBounds, TerrainStats, Track } from '../core/types'
import { centroid } from '../geo/ellipsoid'
import { IMAGERY_SOURCES, sourceCovers } from '../terrain/sources'

export interface Settings {
  terrainSourceId: string
  imagerySourceId: string
  imageryZoomOffset: 0 | 1 | 2
  exaggeration: number
  wireframe: boolean
}

export interface AppState {
  tracks: Track[]
  addTracks(tracks: Track[]): void
  removeTrack(id: string): void
  clearTracks(): void
  /** union of track bounds, null when no track */
  bounds: LonLatBounds | null
  /** fixed when the first track is added (its centroid rounded to 0.01°), null when cleared; the 3D local frame origin */
  frameOrigin: LonLat | null
  settings: Settings
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void
  terrainStats: TerrainStats
  setTerrainStats(stats: TerrainStats): void
  /** incremented to ask the camera to fit the current tracks */
  fitRequest: number
  requestFit(): void
  importError: string | null
  setImportError(msg: string | null): void
  loading: boolean
  setLoading(v: boolean): void
}

export const DEFAULT_SETTINGS: Settings = {
  terrainSourceId: 'mapterhorn',
  imagerySourceId: 'arcgis-world-imagery',
  imageryZoomOffset: 1,
  exaggeration: 1,
  wireframe: false,
}

const EMPTY_STATS: TerrainStats = { visibleTiles: 0, loadedTiles: 0, pendingTiles: 0, failedTiles: 0 }

/** Regional imagery sources preferred automatically when a trip lies entirely inside their coverage. */
const AUTO_IMAGERY_IDS = ['ign-ortho', 'swisstopo'] as const

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** Union of the bounds of all tracks; null for an empty list. */
export function unionBounds(tracks: readonly Track[]): LonLatBounds | null {
  if (tracks.length === 0) return null
  const out: LonLatBounds = { ...tracks[0].bounds }
  for (let i = 1; i < tracks.length; i++) {
    const b = tracks[i].bounds
    if (b.west < out.west) out.west = b.west
    if (b.south < out.south) out.south = b.south
    if (b.east > out.east) out.east = b.east
    if (b.north > out.north) out.north = b.north
  }
  return out
}

/** Centroid of a box rounded to 0.01° (stable origin that does not drift with later imports). */
export function computeFrameOrigin(bounds: LonLatBounds): LonLat {
  const c = centroid(bounds)
  return { lon: Math.round(c.lon * 100) / 100, lat: Math.round(c.lat * 100) / 100 }
}

/**
 * Id of the first regional imagery source (in AUTO_IMAGERY_IDS order) whose coverage fully
 * contains `bounds`, or null when none applies.
 *
 * Known limitation: the IGN box over-approximates France (see docs/sources.md), so a trip that
 * crosses into Italy or Switzerland still gets IGN and shows white tiles there; the user can switch
 * the imagery source by hand, which disables this automatic choice.
 */
export function pickRegionalImagery(bounds: LonLatBounds): string | null {
  for (const id of AUTO_IMAGERY_IDS) {
    const source = IMAGERY_SOURCES.find((s) => s.id === id)
    if (source?.coverage && sourceCovers(source, bounds)) return source.id
  }
  return null
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Set once the user picks an imagery source by hand: automatic regional selection then stops.
 * Kept outside the public state on purpose (implementation detail of addTracks / setSetting).
 */
let imageryChosenByUser = false

export const useAppStore = create<AppState>()((set, get) => ({
  tracks: [],
  bounds: null,
  frameOrigin: null,
  settings: { ...DEFAULT_SETTINGS },
  terrainStats: { ...EMPTY_STATS },
  fitRequest: 0,
  importError: null,
  loading: false,

  addTracks(incoming) {
    if (incoming.length === 0) return
    const state = get()
    const tracks = [...state.tracks, ...incoming]
    const bounds = unionBounds(tracks)!
    const frameOrigin = state.frameOrigin ?? computeFrameOrigin(bounds)

    let settings = state.settings
    if (!imageryChosenByUser) {
      const regional = pickRegionalImagery(bounds)
      if (regional && regional !== settings.imagerySourceId) {
        settings = { ...settings, imagerySourceId: regional }
      }
    }

    set({ tracks, bounds, frameOrigin, settings, fitRequest: state.fitRequest + 1, importError: null })
  },

  removeTrack(id) {
    const state = get()
    const tracks = state.tracks.filter((t) => t.id !== id)
    if (tracks.length === state.tracks.length) return
    set({ tracks, bounds: unionBounds(tracks), frameOrigin: tracks.length === 0 ? null : state.frameOrigin })
  },

  clearTracks() {
    set({ tracks: [], bounds: null, frameOrigin: null })
  },

  setSetting(key, value) {
    if (key === 'imagerySourceId') imageryChosenByUser = true
    set({ settings: { ...get().settings, [key]: value } })
  },

  setTerrainStats(stats) {
    set({ terrainStats: stats })
  },

  requestFit() {
    set({ fitRequest: get().fitRequest + 1 })
  },

  setImportError(msg) {
    set({ importError: msg })
  },

  setLoading(v) {
    set({ loading: v })
  },
}))

/** Restore the initial state (tests). */
export function resetAppStore(): void {
  imageryChosenByUser = false
  useAppStore.setState({
    tracks: [],
    bounds: null,
    frameOrigin: null,
    settings: { ...DEFAULT_SETTINGS },
    terrainStats: { ...EMPTY_STATS },
    fitRequest: 0,
    importError: null,
    loading: false,
  })
}

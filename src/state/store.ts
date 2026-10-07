/**
 * Application state (zustand). Single store shared by the UI and the 3D scene.
 *
 * Derived values (bounds, frameOrigin) are recomputed eagerly inside the actions so that
 * consumers can subscribe to them with plain selectors and no memoisation.
 */
import { create } from 'zustand'
import type { LonLat, LonLatBounds, TerrainStats, Track } from '../core/types'
import { DEFAULT_VIDEO_SETTINGS } from '../export/schedule'
import type { VideoSettings } from '../export/schedule'
import { DEFAULT_CAMERA, DEFAULT_FLYOVER_DURATION_S } from '../flyover/cameraSettings'
import type { CameraSettings } from '../flyover/cameraSettings'
import type { TrackColorBy } from '../flyover/trackColor'
import { centroid } from '../geo/ellipsoid'
import { DEFAULT_LANDMARK_SETTINGS } from '../osm/landmarks'
import type { LandmarkSettings } from '../osm/landmarks'
import { DEFAULT_OVERLAY } from '../overlay/settings'
import type { OverlaySettings } from '../overlay/settings'
import { IMAGERY_SOURCES, sourceCovers } from '../terrain/sources'

export interface Settings {
  terrainSourceId: string
  imagerySourceId: string
  imageryZoomOffset: 0 | 1 | 2
  exaggeration: number
  wireframe: boolean
  /** physically based sky, sun light and aerial perspective */
  atmosphere: boolean
  /** cast shadows of the relief (atmosphere only) */
  shadows: boolean
  /** local mean solar time (hours, 12 = solar noon) on the day of the first track */
  sunHour: number
  /** the sun follows the recorded time under the flyover marker when the first track has one (else sunHour) */
  sunFromTrack: boolean
  /** exposure compensation in stops, on top of the automatic exposure (atmosphere only) */
  exposureEv: number
  /** colour the tracks by a recorded quantity ('none' = each track's own colour) */
  trackColorBy: TrackColorBy
  /** flyover camera style and parameters (replaced as a whole, e.g. by a camera preset) */
  camera: CameraSettings
  /** flyover duration at speed x1 (seconds), whatever the track length */
  flyoverDurationS: number
  /** 3D labels on the relief: tops of the detected climbs of the first track, GPX waypoints */
  labels: { climbs: boolean; waypoints: boolean }
  /** historical weather of the first timed track (Open-Meteo archive, network) */
  weather: { enabled: boolean }
  /** film overlay (« habillage »): style and widgets, drawn by src/overlay/draw.ts */
  overlay: OverlaySettings
  /** exported film: size, frame rate, encoding quality */
  video: VideoSettings
  /** OpenStreetMap landmarks along the tracks (Overpass API, network): kinds shown and corridor width */
  landmarks: LandmarkSettings
}

/** Flyover playback along the first track (progress at constant ground speed). */
export interface Playback {
  playing: boolean
  /** 0 = start of the track, 1 = end */
  progress: number
  /** playback speed multiplier, on top of settings.flyoverDurationS */
  speed: number
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
  playback: Playback
  /** starting from the end rewinds to the start */
  setPlaying(v: boolean): void
  /** clamped to [0, 1]; reaching 1 stops the playback */
  setProgress(progress: number): void
  setSpeed(speed: number): void
}

export const DEFAULT_SETTINGS: Settings = {
  terrainSourceId: 'mapterhorn',
  imagerySourceId: 'arcgis-world-imagery',
  imageryZoomOffset: 1,
  exaggeration: 1,
  wireframe: false,
  atmosphere: true,
  shadows: true,
  sunHour: 10,
  sunFromTrack: true,
  exposureEv: 0,
  trackColorBy: 'none',
  camera: DEFAULT_CAMERA,
  flyoverDurationS: DEFAULT_FLYOVER_DURATION_S,
  labels: { climbs: true, waypoints: true },
  weather: { enabled: true },
  overlay: DEFAULT_OVERLAY,
  video: DEFAULT_VIDEO_SETTINGS,
  landmarks: DEFAULT_LANDMARK_SETTINGS,
}

export const DEFAULT_PLAYBACK: Playback = { playing: false, progress: 0, speed: 1 }

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
  playback: { ...DEFAULT_PLAYBACK },

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
    set({
      tracks,
      bounds: unionBounds(tracks),
      frameOrigin: tracks.length === 0 ? null : state.frameOrigin,
      playback: { ...state.playback, playing: false, progress: 0 },
    })
  },

  clearTracks() {
    set({ tracks: [], bounds: null, frameOrigin: null, playback: { ...get().playback, playing: false, progress: 0 } })
  },

  setSetting(key, value) {
    if (key === 'imagerySourceId') imageryChosenByUser = true
    set({ settings: { ...get().settings, [key]: value } })
  },

  setTerrainStats(stats) {
    set({ terrainStats: stats })
  },

  requestFit() {
    const state = get()
    set({ fitRequest: state.fitRequest + 1, playback: { ...state.playback, playing: false } })
  },

  setImportError(msg) {
    set({ importError: msg })
  },

  setLoading(v) {
    set({ loading: v })
  },

  setPlaying(v) {
    const playback = get().playback
    if (playback.playing === v) return
    const progress = v && playback.progress >= 1 ? 0 : playback.progress
    set({ playback: { ...playback, playing: v, progress } })
  },

  setProgress(progress) {
    const playback = get().playback
    const clamped = Math.min(1, Math.max(0, progress))
    const playing = playback.playing && clamped < 1
    if (clamped === playback.progress && playing === playback.playing) return
    set({ playback: { ...playback, progress: clamped, playing } })
  },

  setSpeed(speed) {
    set({ playback: { ...get().playback, speed } })
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
    playback: { ...DEFAULT_PLAYBACK },
  })
}

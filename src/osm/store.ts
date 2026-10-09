/**
 * OpenStreetMap landmarks of every loaded track (zustand), fetched when tracks are loaded and
 * `settings.landmarks.enabled` allows it, and published to the 3D labels (`setLabelSource('osm', …)`).
 *
 * The corridor features of a track (every kind, widest distance) are fetched once (`fetchTrackFeatures`,
 * cached); changing the kinds or the distance only re-filters them here. `syncLandmarks` is idempotent:
 * React effects may call it on every change of the tracks or the setting.
 */
import { create } from 'zustand'
import type { Track } from '../core/types'
import { trackPathOf } from '../flyover/path'
import { setLabelSource, useLabelSources } from '../scene/labelSources'
import { DEFAULT_LANDMARK_SETTINGS, buildLandmarks, landmarkLabels, splitHidden } from './landmarks'
import type { Landmark, LandmarkSettings } from './landmarks'
import { OverpassError, fetchTrackFeatures } from './overpass'
import type { OsmFeature } from './overpass'

export type LandmarkStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface LandmarkState {
  status: LandmarkStatus
  /** why some landmarks are missing (error), in French */
  message: string | null
  /** corridor features per track id (every kind), as fetched */
  features: Readonly<Record<string, readonly OsmFeature[]>>
  /** landmarks per track id after the setting is applied, ordered along the track (hidden ones excluded) */
  landmarks: Readonly<Record<string, readonly Landmark[]>>
  /** landmarks hidden one by one by the user (`settings.hiddenIds`), per track id, ordered along the track */
  hidden: Readonly<Record<string, readonly Landmark[]>>
}

const INITIAL: LandmarkState = { status: 'idle', message: null, features: {}, landmarks: {}, hidden: {} }

export const useLandmarkStore = create<LandmarkState>()(() => ({ ...INITIAL }))

export interface SyncLandmarksDeps {
  fetchFeatures: typeof fetchTrackFeatures
}

/** Requests in flight per track id. */
const pending = new Map<string, AbortController>()
/** Tracks whose last request failed (not retried until `retry`). */
const failed = new Set<string>()
/** tracks and settings of the last `syncLandmarks`, used when a request answers */
let latest: { tracks: readonly Track[]; settings: LandmarkSettings } = { tracks: [], settings: DEFAULT_LANDMARK_SETTINGS }

function errorMessage(e: unknown): string {
  if (e instanceof OverpassError && (e.status === 429 || e.status === 504)) {
    return 'Serveur OpenStreetMap saturé : réessayez dans quelques instants.'
  }
  return 'Impossible de charger les repères OpenStreetMap.'
}

/** Recompute the landmarks of every track from the stored features, the status, and publish the labels. */
function publish(tracks: readonly Track[], settings: LandmarkSettings, message: string | null): void {
  const features = useLandmarkStore.getState().features
  const landmarks: Record<string, Landmark[]> = {}
  const hidden: Record<string, Landmark[]> = {}
  for (const track of tracks) {
    const list = features[track.id]
    if (!list) continue
    const split = splitHidden(buildLandmarks(list, trackPathOf(track), settings), settings.hiddenIds)
    landmarks[track.id] = split.shown
    hidden[track.id] = split.hidden
  }
  const status: LandmarkStatus = pending.size > 0 ? 'loading' : failed.size > 0 ? 'error' : 'ready'
  useLandmarkStore.setState({ status, message: status === 'error' ? message : null, landmarks, hidden })
  setLabelSource('osm', landmarkLabels(Object.values(landmarks)))
}

/**
 * Bring the landmarks in line with the tracks and the setting: idle (and no label) without a track or when
 * disabled; else the features of each new track are fetched, the landmarks of every track re-filtered.
 * `retry` refetches the tracks whose request failed.
 */
export function syncLandmarks(
  tracks: readonly Track[],
  settings: LandmarkSettings,
  { retry = false, deps = { fetchFeatures: fetchTrackFeatures } }: { retry?: boolean; deps?: SyncLandmarksDeps } = {},
): void {
  latest = { tracks, settings }
  if (tracks.length === 0 || !settings.enabled) {
    resetLandmarkStore()
    return
  }
  const ids = new Set(tracks.map((t) => t.id))
  const state = useLandmarkStore.getState()

  // forget removed tracks
  for (const [id, ctrl] of pending) {
    if (!ids.has(id)) {
      ctrl.abort()
      pending.delete(id)
    }
  }
  for (const id of failed) if (!ids.has(id)) failed.delete(id)
  const features: Record<string, readonly OsmFeature[]> = {}
  for (const id of Object.keys(state.features)) if (ids.has(id)) features[id] = state.features[id]
  if (retry) failed.clear()
  useLandmarkStore.setState({ features })

  let message = state.message
  for (const track of tracks) {
    if (features[track.id] || pending.has(track.id) || failed.has(track.id)) continue
    const ctrl = new AbortController()
    pending.set(track.id, ctrl)
    deps.fetchFeatures(track, ctrl.signal).then(
      (list) => {
        if (pending.get(track.id) !== ctrl) return
        pending.delete(track.id)
        useLandmarkStore.setState({ features: { ...useLandmarkStore.getState().features, [track.id]: list } })
        // the tracks and settings of now, not of when the request left (the user may have changed them meanwhile)
        publish(latest.tracks, latest.settings, useLandmarkStore.getState().message)
      },
      (e: unknown) => {
        if (pending.get(track.id) !== ctrl) return
        pending.delete(track.id)
        failed.add(track.id)
        publish(latest.tracks, latest.settings, errorMessage(e))
      },
    )
  }
  if (failed.size === 0) message = null
  publish(tracks, settings, message)
}

/** Back to idle: cancel the requests, forget the features, remove the labels (disable, no track, tests). */
export function resetLandmarkStore(): void {
  for (const ctrl of pending.values()) ctrl.abort()
  pending.clear()
  failed.clear()
  const state = useLandmarkStore.getState()
  if (state.status !== 'idle' || Object.keys(state.features).length > 0) useLandmarkStore.setState({ ...INITIAL })
  if (useLabelSources.getState().sources.osm) setLabelSource('osm', [])
}

/** Water polygons of OpenStreetMap shown in the scene (scene/WaterLayer.tsx), for the source credits. */
export const useWaterStore = create<{ polygons: number }>()(() => ({ polygons: 0 }))

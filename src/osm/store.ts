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
import { buildTrackPath } from '../flyover/path'
import type { TrackPath } from '../flyover/path'
import { setLabelSource, useLabelSources } from '../scene/labelSources'
import { buildLandmarks, landmarkLabels } from './landmarks'
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
  /** landmarks per track id after the setting is applied, ordered along the track */
  landmarks: Readonly<Record<string, readonly Landmark[]>>
}

const INITIAL: LandmarkState = { status: 'idle', message: null, features: {}, landmarks: {} }

export const useLandmarkStore = create<LandmarkState>()(() => ({ ...INITIAL }))

export interface SyncLandmarksDeps {
  fetchFeatures: typeof fetchTrackFeatures
}

/** Requests in flight per track id. */
const pending = new Map<string, AbortController>()
/** Tracks whose last request failed (not retried until `retry`). */
const failed = new Set<string>()
const paths = new WeakMap<Track, TrackPath>()

function pathOf(track: Track): TrackPath {
  let path = paths.get(track)
  if (!path) {
    path = buildTrackPath(track)
    paths.set(track, path)
  }
  return path
}

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
  for (const track of tracks) {
    const list = features[track.id]
    if (list) landmarks[track.id] = buildLandmarks(list, pathOf(track), settings)
  }
  const status: LandmarkStatus = pending.size > 0 ? 'loading' : failed.size > 0 ? 'error' : 'ready'
  useLandmarkStore.setState({ status, message: status === 'error' ? message : null, landmarks })
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
        publish(tracks, settings, useLandmarkStore.getState().message)
      },
      (e: unknown) => {
        if (pending.get(track.id) !== ctrl) return
        pending.delete(track.id)
        failed.add(track.id)
        publish(tracks, settings, errorMessage(e))
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

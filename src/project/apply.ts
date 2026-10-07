/**
 * Bridge between project data and the app store, through the store's public actions only.
 */
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import type { LoadedProject } from './document'

/**
 * Set every key whose value differs from the current settings (generic over the keys of `Settings`).
 * Goes through `setSetting`, so an imagery source restored here counts as chosen by the user and is
 * not replaced by the automatic regional choice.
 */
export function applySettings(next: Settings): void {
  const { settings, setSetting } = useAppStore.getState()
  for (const key of Object.keys(next) as (keyof Settings)[]) {
    if (!Object.is(next[key], settings[key])) setSetting(key, next[key])
  }
}

/** Replace the tracks, settings and playback speed by those of `project`, then fit the camera (addTracks requests it). */
export function applyProject(project: LoadedProject): void {
  const store = useAppStore.getState()
  store.clearTracks()
  store.addTracks(project.tracks)
  // after addTracks, so that the project's imagery source wins over the automatic regional choice
  // (all synchronous: the scene never sees the intermediate source)
  applySettings(project.settings)
  store.setSpeed(project.speed)
  store.setImportError(null)
}

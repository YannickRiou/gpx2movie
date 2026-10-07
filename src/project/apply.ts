/**
 * Bridge between project data and the app store, through the store's public actions only.
 */
import { useMediaStore } from '../film/media'
import { DEFAULT_SETTINGS, useAppStore } from '../state/store'
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

/** Deep equality of settings values (JSON-like: primitives, arrays, plain objects). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return (
    ka.length === kb.length &&
    ka.every((k) => k in b && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  )
}

/** The keys among `keys` whose value differs from `DEFAULT_SETTINGS` (« modifié » marker of a settings group). */
export function modifiedSettings(settings: Settings, keys: readonly (keyof Settings)[]): (keyof Settings)[] {
  return keys.filter((key) => !sameValue(settings[key], DEFAULT_SETTINGS[key]))
}

/**
 * Replace the tracks, settings, pictures of the film and playback speed by those of `project`, then fit the camera
 * (addTracks requests it).
 */
export function applyProject(project: LoadedProject): void {
  const store = useAppStore.getState()
  // pictures first: the film that names them comes with the settings
  useMediaStore.getState().replace(project.media)
  store.clearTracks()
  store.addTracks(project.tracks)
  // after addTracks, so that the project's imagery source wins over the automatic regional choice
  // (all synchronous: the scene never sees the intermediate source)
  applySettings(project.settings)
  store.setSpeed(project.speed)
  store.setImportError(null)
}

/**
 * Named presets of settings, kept in localStorage.
 *
 * Every storage access is wrapped in try/catch: without storage (private browsing, blocked site data,
 * quota) the presets still work for the session, from memory.
 */
import type { Settings } from '../state/store'
import { sanitizeSettings } from './document'

export const PRESETS_STORAGE_KEY = 'openflyover.presets.v1'
export const PRESET_NAME_MAX = 60

export interface Preset {
  name: string
  /** as saved; may miss keys added since, or hold values that are no longer valid */
  settings: Partial<Settings>
}

export interface PresetStore {
  /** sorted by name (French collation) */
  list(): Preset[]
  /** create or replace the preset named `name` (trimmed); throws on an empty name */
  save(name: string, settings: Settings): void
  remove(name: string): void
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export function normalizePresetName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, PRESET_NAME_MAX)
}

/**
 * Settings of `preset` over `base`: valid saved values win, keys missing from the preset (settings added
 * since it was saved) or invalid keep their value from `base` (the current settings).
 */
export function presetSettings(preset: Preset, base: Settings): Settings {
  return sanitizeSettings(preset.settings, base).settings
}

function readPresets(storage: StorageLike | null): Preset[] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(PRESETS_STORAGE_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (p): p is Preset =>
        p !== null && typeof p === 'object' && typeof p.name === 'string' && p.name !== '' && typeof p.settings === 'object' && p.settings !== null,
    )
  } catch {
    return []
  }
}

export function createPresetStore(storage: StorageLike | null): PresetStore {
  let presets = readPresets(storage)
  const write = () => {
    try {
      storage?.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets))
    } catch {
      // storage full or blocked: the presets stay in memory for this session
    }
  }
  return {
    list: () => [...presets].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    save(name, settings) {
      const clean = normalizePresetName(name)
      if (!clean) throw new Error('Donnez un nom au préréglage.')
      presets = [...presets.filter((p) => p.name !== clean), { name: clean, settings: { ...settings } }]
      write()
    },
    remove(name) {
      presets = presets.filter((p) => p.name !== name)
      write()
    },
  }
}

function browserStorage(): StorageLike | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

let appPresets: PresetStore | null = null

/** Presets of the page, backed by localStorage when available. */
export function getPresetStore(): PresetStore {
  appPresets ??= createPresetStore(browserStorage())
  return appPresets
}

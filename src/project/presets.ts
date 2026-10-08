/**
 * Named presets of settings, kept in the platform storage (localStorage).
 *
 * Every storage access is wrapped in try/catch: without storage (private browsing, blocked site data,
 * quota) the presets still work for the session, from memory.
 *
 * A preset keeps the opening and closing shots of the film, not its stops, texts and media: they belong to the
 * track of the project it was saved from. Of the poster it keeps the style, not the format, title and figures.
 */
import type { Film } from '../film/model'
import { getPlatform } from '../platform'
import type { PosterSettings } from '../poster/settings'
import type { Settings } from '../state/store'
import { sanitizeSettings } from './document'

export const PRESETS_STORAGE_KEY = 'openflyover.presets.v1'
export const PRESET_NAME_MAX = 60

/** Settings saved in a preset: the film reduced to its shots, the poster to its style. */
export type PresetSettings = Omit<Partial<Settings>, 'film' | 'poster'> & {
  film?: Pick<Film, 'opening' | 'closing'>
  poster?: Pick<PosterSettings, 'style'>
}

export interface Preset {
  name: string
  /** as saved; may miss keys added since, or hold values that are no longer valid */
  settings: PresetSettings
}

export interface PresetStore {
  /** sorted by name (French collation) */
  list(): Preset[]
  /**
   * create or replace the preset named `name` (trimmed); throws on an empty name. False when the storage refused
   * it (full or blocked): the preset still works for this session.
   */
  save(name: string, settings: Settings): boolean
  remove(name: string): void
}

/** `setItem` may answer false (platform storage) or throw (Storage) when it cannot store. */
type StorageLike = Pick<Storage, 'getItem'> & { setItem(key: string, value: string): boolean | void }

export function normalizePresetName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, PRESET_NAME_MAX)
}

/**
 * Settings of `preset` over `base`: valid saved values win, keys missing from the preset (settings added
 * since it was saved) or invalid keep their value from `base` (the current settings).
 */
export function presetSettings(preset: Preset, base: Settings): Settings {
  const raw: Record<string, unknown> = { ...preset.settings }
  const { film, poster } = preset.settings as Record<string, unknown>
  // only the shots (presets saved with a whole film included): the stops, texts and media stay those of `base`
  if (film !== null && typeof film === 'object') {
    const { opening, closing } = film as Partial<Film>
    raw.film = { ...base.film, opening, closing }
  }
  // only the style: the format, title and figures stay those of `base`
  if (poster !== null && typeof poster === 'object') raw.poster = { ...base.poster, style: (poster as Partial<PosterSettings>).style }
  return sanitizeSettings(raw, base).settings
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
  /** false when the storage refused: the presets stay in memory for this session */
  const write = (): boolean => {
    try {
      return storage !== null && storage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets)) !== false
    } catch {
      return false
    }
  }
  return {
    list: () => [...presets].sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    save(name, settings) {
      const clean = normalizePresetName(name)
      if (!clean) throw new Error('Donnez un nom au préréglage.')
      const film = { opening: settings.film.opening, closing: settings.film.closing }
      const poster = { style: settings.poster.style }
      presets = [...presets.filter((p) => p.name !== clean), { name: clean, settings: { ...settings, film, poster } }]
      return write()
    },
    remove(name) {
      presets = presets.filter((p) => p.name !== name)
      write()
    },
  }
}

/** The platform storage (same key as when it was localStorage directly: the presets already saved are kept). */
function platformStorage(): StorageLike {
  const storage = getPlatform().storage
  return { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) }
}

let appPresets: PresetStore | null = null

/** Presets of the page, backed by the platform storage. */
export function getPresetStore(): PresetStore {
  appPresets ??= createPresetStore(platformStorage())
  return appPresets
}

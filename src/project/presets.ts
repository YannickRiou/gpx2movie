/**
 * Named presets of settings, kept in the platform storage (localStorage).
 *
 * Every storage access is wrapped in try/catch: without storage (private browsing, blocked site data,
 * quota) the presets still work for the session, from memory.
 *
 * A preset keeps every setting or one family of them (`PRESET_SCOPES`). A full one keeps the opening and closing
 * shots of the film, not its stops, texts and media: they belong to the track of the project it was saved from. Of
 * the poster it keeps the style, not the format, title and figures.
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

/**
 * What a preset keeps: every setting, or one family that can be saved and applied on its own (a map style, a
 * track look, an overlay theme, a camera shot); applying it leaves the other settings as they are.
 */
export const PRESET_SCOPES = ['tout', 'carte', 'trace', 'habillage', 'prise-de-vue'] as const
export type PresetScope = (typeof PRESET_SCOPES)[number]

export const PRESET_SCOPE_LABELS: Record<PresetScope, string> = {
  tout: 'Tous les réglages',
  carte: 'Style de carte',
  trace: 'Trace, marqueur et étiquettes',
  habillage: 'Habillage',
  'prise-de-vue': 'Prise de vue (caméra, cadrage, lumière)',
}

/** Settings of each family ('tout': every setting). */
export const PRESET_SCOPE_KEYS: Record<Exclude<PresetScope, 'tout'>, readonly (keyof Settings)[]> = {
  carte: ['terrainSourceId', 'imagerySourceId', 'imageryZoomOffset', 'exaggeration', 'wireframe', 'atmosphere', 'shadows', 'grading', 'weatherScene', 'clouds', 'water'],
  trace: ['trackColorBy', 'trackStyle', 'marker', 'labels'],
  habillage: ['overlay'],
  'prise-de-vue': ['camera', 'sunHour', 'sunDate', 'sunFromTrack', 'exposureEv'],
}

export interface Preset {
  name: string
  /** as saved; may miss keys added since, or hold values that are no longer valid */
  settings: PresetSettings
  /** the family it keeps; absent = every setting (presets saved before the families) */
  scope?: PresetScope
}

export interface PresetStore {
  /** sorted by name (French collation) */
  list(): Preset[]
  /**
   * create or replace the preset named `name` (trimmed); throws on an empty name. False when the storage refused
   * it (full or blocked): the preset still works for this session.
   */
  save(name: string, settings: Settings, scope?: PresetScope): boolean
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
        p !== null &&
        typeof p === 'object' &&
        typeof p.name === 'string' &&
        p.name !== '' &&
        typeof p.settings === 'object' &&
        p.settings !== null &&
        (p.scope === undefined || (PRESET_SCOPES as readonly unknown[]).includes(p.scope)),
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
    save(name, settings, scope = 'tout') {
      const clean = normalizePresetName(name)
      if (!clean) throw new Error('Donnez un nom au préréglage.')
      const preset: Preset =
        scope === 'tout'
          ? { name: clean, settings: { ...settings, film: { opening: settings.film.opening, closing: settings.film.closing }, poster: { style: settings.poster.style } } }
          : { name: clean, scope, settings: Object.fromEntries(PRESET_SCOPE_KEYS[scope].map((key) => [key, settings[key]])) as PresetSettings }
      presets = [...presets.filter((p) => p.name !== clean), preset]
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

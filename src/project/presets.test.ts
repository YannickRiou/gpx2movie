import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../state/store'
import { PRESETS_STORAGE_KEY, createPresetStore, getPresetStore, presetSettings } from './presets'

function memoryStorage(initial?: string) {
  const data = new Map<string, string>()
  if (initial !== undefined) data.set(PRESETS_STORAGE_KEY, initial)
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

const throwing = {
  getItem(): string | null {
    throw new Error('SecurityError')
  },
  setItem() {
    throw new Error('QuotaExceededError')
  },
}

describe('createPresetStore', () => {
  it('saves, lists (sorted), replaces and deletes presets, persisted in storage', () => {
    const storage = memoryStorage()
    const store = createPresetStore(storage)
    expect(store.save('  Vue   aérienne ', { ...DEFAULT_SETTINGS, exaggeration: 2 })).toBe(true)
    store.save('Atmosphère', DEFAULT_SETTINGS)
    store.save('Vue aérienne', { ...DEFAULT_SETTINGS, exaggeration: 3 })
    expect(store.list().map((p) => p.name)).toEqual(['Atmosphère', 'Vue aérienne'])
    expect(store.list()[1].settings.exaggeration).toBe(3)

    const reloaded = createPresetStore(storage)
    expect(reloaded.list()).toEqual(store.list())
    reloaded.remove('Atmosphère')
    expect(createPresetStore(storage).list().map((p) => p.name)).toEqual(['Vue aérienne'])
    expect(() => store.save('   ', DEFAULT_SETTINGS)).toThrow('Donnez un nom au préréglage.')
  })

  it('works from memory without storage or when storage throws or refuses, and says it was not stored', () => {
    const refusing = { getItem: () => null, setItem: () => false }
    for (const storage of [null, throwing, refusing]) {
      const store = createPresetStore(storage)
      expect(store.list()).toEqual([])
      expect(store.save('A', DEFAULT_SETTINGS)).toBe(false)
      expect(store.list().map((p) => p.name)).toEqual(['A'])
      store.remove('A')
      expect(store.list()).toEqual([])
    }
  })

  it('ignores corrupted or foreign content', () => {
    expect(createPresetStore(memoryStorage('{oops')).list()).toEqual([])
    expect(createPresetStore(memoryStorage('{"a":1}')).list()).toEqual([])
    const mixed = JSON.stringify([{ name: 'ok', settings: {} }, { name: 3 }, null, { name: 'x', settings: null }])
    expect(createPresetStore(memoryStorage(mixed)).list()).toEqual([{ name: 'ok', settings: {} }])
  })

  it('keeps the presets of the page in the platform storage, under the localStorage key of before', () => {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify([{ name: 'Ancien', settings: {} }]))
    const store = getPresetStore()
    expect(store.list().map((p) => p.name)).toEqual(['Ancien'])
    store.save('Nouveau', DEFAULT_SETTINGS)
    const stored = JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY) ?? '[]') as { name: string }[]
    expect(stored.map((p) => p.name)).toEqual(['Ancien', 'Nouveau'])
    localStorage.removeItem(PRESETS_STORAGE_KEY)
  })
})

describe('presetSettings', () => {
  it('applies valid saved values over the base and keeps the base elsewhere', () => {
    const base = { ...DEFAULT_SETTINGS, wireframe: true, sunHour: 18 }
    const preset = { name: 'p', settings: { exaggeration: 2, sunHour: 'midi', unknown: 1 } as never }
    expect(presetSettings(preset, base)).toEqual({ ...base, exaggeration: 2 })
  })

  it('keeps the shots of the film only: the stops, texts and media of the current project stay', () => {
    const stop = { id: 'stop-1', atM: 500, durationS: 3, camera: 'fixe' as const }
    const text = { id: 'text-1', startS: 1, durationS: 2, text: 'Départ', anchor: 'center' as const, size: 1 }
    const music = { id: 'music-1', src: 'audio-1', startS: 0, durationS: 30, inS: 0, volume: 1, fadeInS: 0, fadeOutS: 0 }
    const saved = { ...DEFAULT_SETTINGS.film, opening: { style: 'saut' as const, durationS: 3 }, autoStops: false, stops: [stop], audio: [music] }
    const store = createPresetStore(memoryStorage())
    store.save('Plans', { ...DEFAULT_SETTINGS, film: saved })
    expect(store.list()[0].settings.film).toEqual({ opening: saved.opening, closing: saved.closing })

    const base = { ...DEFAULT_SETTINGS, film: { ...DEFAULT_SETTINGS.film, texts: [text] } }
    expect(presetSettings(store.list()[0], base).film).toEqual({ ...base.film, opening: saved.opening })
    // a preset saved with the whole film (before the timeline): same result
    expect(presetSettings({ name: 'old', settings: { film: saved } as never }, base).film).toEqual({ ...base.film, opening: saved.opening })
  })

  it('keeps the style of the poster only: its format, title and figures stay those of the current project', () => {
    const store = createPresetStore(memoryStorage())
    store.save('Affiche', { ...DEFAULT_SETTINGS, poster: { ...DEFAULT_SETTINGS.poster, style: 'broadcast', title: 'Autre sortie', format: 'square' } })
    expect(store.list()[0].settings.poster).toEqual({ style: 'broadcast' })

    const base = { ...DEFAULT_SETTINGS, poster: { ...DEFAULT_SETTINGS.poster, title: 'Ce projet' } }
    expect(presetSettings(store.list()[0], base).poster).toEqual({ ...base.poster, style: 'broadcast' })
    expect(presetSettings({ name: 'bad', settings: { poster: { style: 'neon' } } as never }, base).poster).toBe(base.poster)
  })
})

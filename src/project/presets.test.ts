import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../state/store'
import { PRESETS_STORAGE_KEY, createPresetStore, presetSettings } from './presets'

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
    store.save('  Vue   aérienne ', { ...DEFAULT_SETTINGS, exaggeration: 2 })
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

  it('works from memory without storage or when storage throws', () => {
    for (const storage of [null, throwing]) {
      const store = createPresetStore(storage)
      expect(store.list()).toEqual([])
      store.save('A', DEFAULT_SETTINGS)
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
})

describe('presetSettings', () => {
  it('applies valid saved values over the base and keeps the base elsewhere', () => {
    const base = { ...DEFAULT_SETTINGS, wireframe: true, sunHour: 18 }
    const preset = { name: 'p', settings: { exaggeration: 2, sunHour: 'midi', unknown: 1 } as never }
    expect(presetSettings(preset, base)).toEqual({ ...base, exaggeration: 2 })
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  acceptAttribute,
  detectCapabilities,
  extensionOf,
  fileNameOf,
  isTauriRuntime,
  keyValueStore,
  mimeTypeOf,
  saveFilters,
  selectPlatform,
  videoEncoderMissingHint,
} from './index'

const dialog = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }))
const fs = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => dialog)
vi.mock('@tauri-apps/plugin-fs', () => fs)

describe('detection', () => {
  it('recognises the Tauri webview', () => {
    expect(isTauriRuntime({ isTauri: true })).toBe(true)
    expect(isTauriRuntime({ __TAURI_INTERNALS__: {} })).toBe(true)
    expect(isTauriRuntime({})).toBe(false)
    expect(isTauriRuntime({ isTauri: 'yes' })).toBe(false)
  })

  it('can encode a video only with WebCodecs', () => {
    expect(detectCapabilities({ VideoEncoder: class {} })).toEqual({ isDesktop: false, canEncodeVideo: true })
    expect(detectCapabilities({ isTauri: true })).toEqual({ isDesktop: true, canEncodeVideo: false })
  })

  it('selects the desktop platform inside Tauri, the web one elsewhere', () => {
    expect(selectPlatform({ isTauri: true }).capabilities.isDesktop).toBe(true)
    expect(selectPlatform({}).capabilities.isDesktop).toBe(false)
  })

  it('explains a missing encoder, per target', () => {
    expect(videoEncoderMissingHint({ isDesktop: false, canEncodeVideo: true })).toBeNull()
    expect(videoEncoderMissingHint({ isDesktop: true, canEncodeVideo: false })).toMatch(/application de bureau/)
    expect(videoEncoderMissingHint({ isDesktop: false, canEncodeVideo: false })).toMatch(/WebCodecs/)
  })
})

describe('file names', () => {
  it('takes the last segment of a path with either separator', () => {
    expect(fileNameOf('/home/a/Tour.gpx')).toBe('Tour.gpx')
    expect(fileNameOf('C:\\Users\\a\\Tour.fit')).toBe('Tour.fit')
    expect(fileNameOf('Tour.gpx')).toBe('Tour.gpx')
  })

  it('reads the extension and the type', () => {
    expect(extensionOf('Tour.openflyover.json')).toBe('json')
    expect(extensionOf('.hidden')).toBe('')
    expect(extensionOf('README')).toBe('')
    expect(mimeTypeOf('a.JPG')).toBe('image/jpeg')
    expect(mimeTypeOf('a.fit')).toBe('')
  })

  it('builds the accept attribute and the save filters', () => {
    const filters = [
      { name: 'Traces', extensions: ['gpx', 'FIT'] },
      { name: 'Projets', extensions: ['json', 'gpx'] },
    ]
    expect(acceptAttribute(filters)).toBe('.gpx,.fit,.json')
    expect(saveFilters({ fileName: 'film.mp4' })).toEqual([{ name: 'MP4', extensions: ['mp4'] }])
    expect(saveFilters({ fileName: 'film' })).toEqual([])
    expect(saveFilters({ fileName: 'a.json', filters: [filters[1]] })).toEqual([filters[1]])
  })
})

describe('keyValueStore', () => {
  it('reads and writes the storage', () => {
    const map = new Map<string, string>()
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    }
    const store = keyValueStore(storage)
    store.set('a', '1')
    expect(map.get('a')).toBe('1')
    expect(store.get('a')).toBe('1')
    store.remove('a')
    expect(store.get('a')).toBeNull()
  })

  it('falls back to memory when the storage is missing or throws', () => {
    const fail = () => {
      throw new Error('blocked')
    }
    for (const store of [keyValueStore(null), keyValueStore({ getItem: fail, setItem: fail, removeItem: fail })]) {
      store.set('a', '1')
      expect(store.get('a')).toBe('1')
      store.remove('a')
      expect(store.get('a')).toBeNull()
    }
  })
})

describe('web platform', () => {
  it('downloads the file under its name', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('a.json')
    })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const outcome = await selectPlatform({}).saveFile(new Blob(['{}']), { fileName: 'a.json' })
    expect(outcome).toEqual({ saved: true, fileName: 'a.json' })
    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })

  it('opens the picked files and nothing when the picker is closed', async () => {
    const platform = selectPlatform({})
    const file = new File(['x'], 'a.gpx')
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      expect(this.accept).toBe('.gpx')
      Object.defineProperty(this, 'files', { value: [file] })
      this.dispatchEvent(new Event('change'))
    })
    expect(await platform.openFiles({ filters: [{ name: 'GPX', extensions: ['gpx'] }] })).toEqual([file])
    click.mockImplementation(function (this: HTMLInputElement) {
      this.dispatchEvent(new Event('cancel'))
    })
    expect(await platform.openFiles({ filters: [] })).toEqual([])
    expect(document.querySelector('input[type=file]')).toBeNull()
    click.mockRestore()
  })
})

describe('desktop platform', () => {
  const desktop = () => selectPlatform({ isTauri: true })

  it('writes the bytes at the path chosen in the save dialog', async () => {
    dialog.save.mockResolvedValueOnce('C:\\Films\\Mon film.mp4')
    const outcome = await desktop().saveFile(new Blob([new Uint8Array([1, 2, 3])]), { fileName: 'film.mp4' })
    expect(outcome).toEqual({ saved: true, fileName: 'Mon film.mp4' })
    expect(dialog.save).toHaveBeenCalledWith({ defaultPath: 'film.mp4', filters: [{ name: 'MP4', extensions: ['mp4'] }] })
    const [path, bytes] = fs.writeFile.mock.calls[0] as [string, Uint8Array]
    expect(path).toBe('C:\\Films\\Mon film.mp4')
    expect([...bytes]).toEqual([1, 2, 3])
  })

  it('writes nothing when the save dialog is closed', async () => {
    fs.writeFile.mockClear()
    dialog.save.mockResolvedValueOnce(null)
    expect(await desktop().saveFile(new Blob(['x']), { fileName: 'a.json' })).toEqual({ saved: false })
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it('reads the files picked in the open dialog', async () => {
    dialog.open.mockResolvedValueOnce(['/home/a/Tour.gpx', '/home/a/projet.json'])
    fs.readFile.mockResolvedValue(new TextEncoder().encode('<gpx/>'))
    const files = await desktop().openFiles({ filters: [{ name: 'Traces', extensions: ['gpx', 'json'] }], multiple: true })
    expect(files.map((f) => [f.name, f.type])).toEqual([
      ['Tour.gpx', 'application/gpx+xml'],
      ['projet.json', 'application/json'],
    ])
    expect(await files[0].text()).toBe('<gpx/>')
    dialog.open.mockResolvedValueOnce(null)
    expect(await desktop().openFiles({ filters: [] })).toEqual([])
  })
})

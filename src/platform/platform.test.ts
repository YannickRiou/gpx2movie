import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acceptAttribute,
  detectCapabilities,
  extensionOf,
  fileNameOf,
  isTauriRuntime,
  keyValueStore,
  mimeTypeOf,
  pickerTypes,
  saveFilters,
  selectPlatform,
  videoEncoderMissingHint,
} from './index'

const dialog = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }))
const fs = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  open: vi.fn(),
  remove: vi.fn(async () => undefined),
  SeekMode: { Start: 0 },
}))
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
    expect(detectCapabilities({ VideoEncoder: class {} })).toMatchObject({ isDesktop: false, canEncodeVideo: true })
    expect(detectCapabilities({ isTauri: true })).toMatchObject({ isDesktop: true, canEncodeVideo: false })
  })

  it('streams to disk on the desktop and with the save picker', () => {
    expect(detectCapabilities({ isTauri: true }).canStreamToDisk).toBe(true)
    expect(detectCapabilities({ showSaveFilePicker: () => undefined }).canStreamToDisk).toBe(true)
    expect(detectCapabilities({}).canStreamToDisk).toBe(false)
  })

  it('selects the desktop platform inside Tauri, the web one elsewhere', () => {
    expect(selectPlatform({ isTauri: true }).capabilities.isDesktop).toBe(true)
    expect(selectPlatform({}).capabilities.isDesktop).toBe(false)
  })

  it('explains a missing encoder, per target', () => {
    const caps = (isDesktop: boolean, canEncodeVideo: boolean) => ({ isDesktop, canEncodeVideo, canStreamToDisk: isDesktop })
    expect(videoEncoderMissingHint(caps(false, true))).toBeNull()
    expect(videoEncoderMissingHint(caps(true, false))).toMatch(/application de bureau/)
    expect(videoEncoderMissingHint(caps(false, false))).toMatch(/WebCodecs/)
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
    expect(mimeTypeOf('a.gif')).toBe('image/gif')
    expect(mimeTypeOf('a.avif')).toBe('image/avif')
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

  it('builds the types of the browser save picker', () => {
    expect(pickerTypes([{ name: 'MP4', extensions: ['mp4'] }])).toEqual([{ description: 'MP4', accept: { 'video/mp4': ['.mp4'] } }])
    expect(pickerTypes([{ name: 'Images', extensions: ['JPG', 'jpeg', 'fit'] }])).toEqual([
      { description: 'Images', accept: { 'image/jpeg': ['.jpg', '.jpeg'], 'application/octet-stream': ['.fit'] } },
    ])
  })
})

/** localStorage-like map, refusing new values past `capacity` entries. */
function mapStorage(capacity = Infinity) {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (!map.has(k) && map.size >= capacity) throw new DOMException('full', 'QuotaExceededError')
      map.set(k, v)
    },
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

describe('keyValueStore', () => {
  it('reads and writes the storage', () => {
    const storage = mapStorage()
    const store = keyValueStore(storage)
    expect(store.set('a', '1')).toBe(true)
    expect(storage.map.get('a')).toBe('1')
    expect(store.get('a')).toBe('1')
    store.remove('a')
    expect(store.get('a')).toBeNull()
  })

  it('falls back to memory when the storage is missing or throws, and says so', () => {
    const fail = () => {
      throw new Error('blocked')
    }
    const blocked = { getItem: fail, setItem: fail, removeItem: fail, key: fail, length: 0 }
    for (const store of [keyValueStore(null), keyValueStore(blocked)]) {
      expect(store.set('a', '1')).toBe(false)
      expect(store.get('a')).toBe('1')
      expect(store.keys()).toEqual(['a'])
      store.remove('a')
      expect(store.get('a')).toBeNull()
    }
  })

  it('reports a full storage and keeps the refused value in memory', () => {
    const storage = mapStorage(1)
    const store = keyValueStore(storage)
    expect(store.set('a', 'old')).toBe(true)
    expect(store.set('b', '2')).toBe(false)
    expect(store.get('b')).toBe('2')
    expect(storage.map.has('b')).toBe(false)
    // once there is room again, the value is stored and leaves memory
    store.remove('a')
    expect(store.set('b', '3')).toBe(true)
    expect(storage.map.get('b')).toBe('3')
  })

  it('lists the keys with a prefix, stored or in memory', () => {
    const storage = mapStorage(2)
    const store = keyValueStore(storage)
    store.set('osm.1', 'x')
    store.set('prefs', 'y')
    store.set('osm.2', 'z')
    expect(store.keys('osm.').sort()).toEqual(['osm.1', 'osm.2'])
    expect(store.keys().sort()).toEqual(['osm.1', 'osm.2', 'prefs'])
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

  describe('writable file (save picker)', () => {
    const scope = globalThis as { showSaveFilePicker?: unknown }
    afterEach(() => {
      delete scope.showSaveFilePicker
    })

    /** Picker answering a handle whose writable stream records its calls. */
    function fakePicker() {
      const writable = { write: vi.fn(async () => undefined), close: vi.fn(async () => undefined), abort: vi.fn(async () => undefined) }
      const handle = { name: 'Mon film.mp4', createWritable: vi.fn(async () => writable), remove: vi.fn(async () => undefined) }
      const picker = vi.fn(async () => handle)
      scope.showSaveFilePicker = picker
      return { picker, handle, writable }
    }

    it('writes at the given positions and closes', async () => {
      const { picker, writable, handle } = fakePicker()
      const file = await selectPlatform({}).createWritableFile({ fileName: 'Tour.mp4' })
      expect(picker).toHaveBeenCalledWith({ suggestedName: 'Tour.mp4', types: [{ description: 'MP4', accept: { 'video/mp4': ['.mp4'] } }] })
      expect(file?.fileName).toBe('Mon film.mp4')
      const data = new Uint8Array([1, 2])
      await file?.write(data, 40)
      expect(writable.write).toHaveBeenCalledWith({ type: 'write', data, position: 40 })
      await file?.close()
      await file?.discard()
      expect(writable.close).toHaveBeenCalledTimes(1)
      expect(writable.abort).not.toHaveBeenCalled()
      expect(handle.remove).not.toHaveBeenCalled()
    })

    it('discard aborts the stream and removes the file, once', async () => {
      const { writable, handle } = fakePicker()
      const file = await selectPlatform({}).createWritableFile({ fileName: 'Tour.mp4' })
      await file?.discard()
      await file?.discard()
      expect(writable.abort).toHaveBeenCalledTimes(1)
      expect(handle.remove).toHaveBeenCalledTimes(1)
    })

    it('answers null when the picker is closed and throws without a picker', async () => {
      const { picker } = fakePicker()
      picker.mockRejectedValueOnce(new DOMException('closed', 'AbortError'))
      expect(await selectPlatform({}).createWritableFile({ fileName: 'Tour.mp4' })).toBeNull()
      delete scope.showSaveFilePicker
      await expect(selectPlatform({}).createWritableFile({ fileName: 'Tour.mp4' })).rejects.toThrow(/disque/)
    })
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

  /** File handle of the fs plugin, writing at most `max` bytes per call. */
  function fakeHandle(max = Infinity) {
    const handle = {
      writes: [] as number[][],
      write: vi.fn(async (data: Uint8Array) => {
        const n = Math.min(max, data.length)
        handle.writes.push([...data.subarray(0, n)])
        return n
      }),
      seek: vi.fn(async () => 0),
      close: vi.fn(async () => undefined),
    }
    fs.open.mockResolvedValueOnce(handle)
    return handle
  }

  it('streams to the chosen file, seeking only for out-of-order writes', async () => {
    dialog.save.mockResolvedValueOnce('/films/Tour.mp4')
    const handle = fakeHandle(2)
    const file = await desktop().createWritableFile({ fileName: 'Tour.mp4' })
    expect(fs.open).toHaveBeenCalledWith('/films/Tour.mp4', { write: true, create: true, truncate: true })
    expect(file?.fileName).toBe('Tour.mp4')
    await file?.write(new Uint8Array([1, 2, 3]), 0)
    await file?.write(new Uint8Array([4]), 3)
    expect(handle.seek).not.toHaveBeenCalled()
    await file?.write(new Uint8Array([9]), 1)
    expect(handle.seek).toHaveBeenCalledWith(1, 0)
    expect(handle.writes).toEqual([[1, 2], [3], [4], [9]])
    await file?.close()
    await file?.discard()
    expect(fs.remove).not.toHaveBeenCalled()
  })

  it('removes a discarded file and opens nothing when the dialog is closed', async () => {
    dialog.save.mockResolvedValueOnce('/films/Tour.mp4')
    const handle = fakeHandle()
    const file = await desktop().createWritableFile({ fileName: 'Tour.mp4' })
    await file?.discard()
    await file?.discard()
    expect(handle.close).toHaveBeenCalledTimes(1)
    expect(fs.remove).toHaveBeenCalledTimes(1)
    expect(fs.remove).toHaveBeenCalledWith('/films/Tour.mp4')
    fs.open.mockClear()
    dialog.save.mockResolvedValueOnce(null)
    expect(await desktop().createWritableFile({ fileName: 'Tour.mp4' })).toBeNull()
    expect(fs.open).not.toHaveBeenCalled()
  })
})

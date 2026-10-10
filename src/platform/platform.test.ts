// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acceptAttribute,
  detectCapabilities,
  extensionOf,
  fileNameOf,
  imageTypeOf,
  isTauriRuntime,
  keyValueStore,
  mimeTypeOf,
  pickerTypes,
  saveFilters,
  selectPlatform,
  tileFileName,
  videoEncoderMissingHint,
} from './index'
import type { VideoEncoderKind } from './index'
import { externalLinkOf } from './externalLinks'
import {
  DESKTOP_PROJECT_ROOT,
  MAX_THUMBNAIL_LENGTH,
  WEB_PROJECT_CACHE,
  cleanProjectName,
  createDesktopLibraryFiles,
  createProjectLibrary,
  createWebLibraryFiles,
  isProjectThumbnail,
  parseProjectEntry,
  projectFileNames,
  sortProjectEntries,
} from './projectLibrary'
import { DESKTOP_TILE_ROOT, WEB_TILE_CACHE_PREFIX, createDesktopTileCache, createWebTileCache } from './tileCache'

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

  it('picks the https links that open in a new tab, nothing else', () => {
    const click = (html: string, init: Partial<MouseEvent> = {}) => {
      document.body.innerHTML = html
      return externalLinkOf({ target: document.querySelector('b'), defaultPrevented: false, button: 0, ...init })
    }
    expect(click('<a href="https://open-meteo.com/" target="_blank"><b>x</b></a>')).toBe('https://open-meteo.com/')
    expect(click('<a href="http://a.fr" target="_blank"><b>x</b></a>')).toBeNull()
    expect(click('<a href="https://a.fr"><b>x</b></a>')).toBeNull()
    expect(click('<a href="https://a.fr" target="_blank"><b>x</b></a>', { button: 1 })).toBeNull()
  })

  it('encodes with WebCodecs, else with the native encoder of the desktop app', () => {
    expect(detectCapabilities({ VideoEncoder: class {} })).toMatchObject({ isDesktop: false, videoEncoder: 'webcodecs' })
    expect(detectCapabilities({ isTauri: true, VideoEncoder: class {} }).videoEncoder).toBe('webcodecs')
    expect(detectCapabilities({ isTauri: true })).toMatchObject({ isDesktop: true, videoEncoder: 'native' })
    expect(detectCapabilities({}).videoEncoder).toBeNull()
  })

  it('streams to disk on the desktop and with the save picker', () => {
    expect(detectCapabilities({ isTauri: true }).canStreamToDisk).toBe(true)
    expect(detectCapabilities({ showSaveFilePicker: () => undefined }).canStreamToDisk).toBe(true)
    expect(detectCapabilities({}).canStreamToDisk).toBe(false)
  })

  it('saves through the share sheet on a touch screen without a save picker (iOS, older Android)', () => {
    const touch = { navigator: { share: () => undefined }, matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' }) }
    expect(detectCapabilities(touch).sharesFiles).toBe(true)
    expect(detectCapabilities({ ...touch, showSaveFilePicker: () => undefined }).sharesFiles).toBe(false)
    expect(detectCapabilities({ ...touch, matchMedia: () => ({ matches: false }) }).sharesFiles).toBe(false)
    expect(detectCapabilities({ ...touch, navigator: {} }).sharesFiles).toBe(false)
    expect(detectCapabilities({ ...touch, isTauri: true }).sharesFiles).toBe(false)
    expect(detectCapabilities({}).sharesFiles).toBe(false)
  })

  it('selects the desktop platform inside Tauri, the web one elsewhere', () => {
    expect(selectPlatform({ isTauri: true }).capabilities.isDesktop).toBe(true)
    expect(selectPlatform({}).capabilities.isDesktop).toBe(false)
  })

  it('explains a missing encoder, per target', () => {
    const caps = (isDesktop: boolean, videoEncoder: VideoEncoderKind) => ({ isDesktop, videoEncoder, canStreamToDisk: isDesktop })
    expect(videoEncoderMissingHint(caps(false, 'webcodecs'))).toBeNull()
    expect(videoEncoderMissingHint(caps(true, 'native'))).toMatch(/installez ffmpeg/)
    expect(videoEncoderMissingHint(caps(false, null), false)).toMatch(/Firefox récent/)
    expect(videoEncoderMissingHint(caps(false, null), true)).toMatch(/Chrome \(Android\) ou Safari 16\.4/)
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

  describe('share sheet (phones without a save picker)', () => {
    const touch = { navigator: { share: () => undefined }, matchMedia: () => ({ matches: true }) }
    const stub = (share: (data: ShareData) => Promise<void>, canShare = true) => {
      Object.defineProperty(navigator, 'share', { value: vi.fn(share), configurable: true })
      Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => canShare), configurable: true })
      return navigator.share as ReturnType<typeof vi.fn>
    }
    afterEach(() => {
      Reflect.deleteProperty(navigator, 'share')
      Reflect.deleteProperty(navigator, 'canShare')
    })

    it('hands the file to the share sheet', async () => {
      const share = stub(async () => undefined)
      const outcome = await selectPlatform(touch).saveFile(new Blob(['{}'], { type: 'application/json' }), { fileName: 'Tour.openflyover.json' })
      expect(outcome).toEqual({ saved: true, fileName: 'Tour.openflyover.json' })
      const file = (share.mock.calls[0][0] as ShareData).files?.[0]
      expect(file?.name).toBe('Tour.openflyover.json')
      expect(file?.type).toBe('application/json')
    })

    it('nothing saved when the sheet is closed', async () => {
      stub(async () => Promise.reject(new DOMException('closed', 'AbortError')))
      expect(await selectPlatform(touch).saveFile(new Blob(['x']), { fileName: 'a.png' })).toEqual({ saved: false })
    })

    it('downloads when the sheet does not take the file or refuses (no click left)', async () => {
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
      URL.createObjectURL = vi.fn(() => 'blob:x')
      URL.revokeObjectURL = vi.fn()
      stub(async () => undefined, false)
      expect(await selectPlatform(touch).saveFile(new Blob(['x']), { fileName: 'a.json' })).toEqual({ saved: true, fileName: 'a.json' })
      stub(async () => Promise.reject(new DOMException('no gesture', 'NotAllowedError')))
      expect(await selectPlatform(touch).saveFile(new Blob(['x']), { fileName: 'a.png' })).toEqual({ saved: true, fileName: 'a.png' })
      expect(click).toHaveBeenCalledTimes(2)
      click.mockRestore()
    })

    it('never on a computer: the download as before', async () => {
      const share = stub(async () => undefined)
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
      URL.createObjectURL = vi.fn(() => 'blob:x')
      URL.revokeObjectURL = vi.fn()
      await selectPlatform({ ...touch, matchMedia: () => ({ matches: false }) }).saveFile(new Blob(['x']), { fileName: 'a.png' })
      expect(share).not.toHaveBeenCalled()
      expect(click).toHaveBeenCalledTimes(1)
      click.mockRestore()
    })
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

describe('offline tile cache', () => {
  const URL_A = 'https://tiles.mapterhorn.com/14/1/2.webp'
  const URL_B = 'https://data.geopf.fr/wmts?SERVICE=WMTS&TILEMATRIX=15&TILEROW=3&TILECOL=4'

  it('names a tile file after its URL', () => {
    expect(tileFileName(URL_A)).toMatch(/^[0-9a-f]{28}$/)
    expect(tileFileName(URL_A)).toBe(tileFileName(URL_A))
    expect(tileFileName(URL_A)).not.toBe(tileFileName(URL_A.replace('14/1/2', '14/2/1')))
  })

  it('recognises PNG, JPEG and WebP from their first bytes', () => {
    const bytes = (...values: (number | string)[]) =>
      new Uint8Array(values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])))
    expect(imageTypeOf(bytes(0x89, 'PNG', 13, 10))).toBe('image/png')
    expect(imageTypeOf(bytes(0xff, 0xd8, 0xff))).toBe('image/jpeg')
    expect(imageTypeOf(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe('image/webp')
    expect(imageTypeOf(bytes('GIF8'))).toBe('')
  })

  /** Cache Storage in memory. */
  function fakeCaches() {
    const caches = new Map<string, Map<string, Response>>()
    return {
      caches,
      keys: vi.fn(async () => [...caches.keys()]),
      delete: vi.fn(async (name: string) => caches.delete(name)),
      open: vi.fn(async (name: string) => {
        let entries = caches.get(name)
        if (!entries) caches.set(name, (entries = new Map()))
        const store = entries
        return {
          match: async (url: string) => store.get(url)?.clone(),
          put: async (url: string, response: Response) => void store.set(url, response),
          keys: async () => [...store.keys()].map((url) => ({ url })),
          delete: async (url: string) => store.delete(url),
        } as unknown as Cache
      }),
    }
  }

  it('web: one cache per pack, the URL as key, a pack deleted with its cache', async () => {
    // jsdom's Blob is not Node's: a Response that keeps the Blob as it is
    vi.stubGlobal(
      'Response',
      class {
        readonly body: Blob
        readonly headers: Record<string, string>
        constructor(body: Blob, init: { headers: Record<string, string> }) {
          this.body = body
          this.headers = init.headers
        }
        blob = async () => this.body
        clone = () => this
      },
    )
    const storage = fakeCaches()
    storage.caches.set('autre-cache', new Map())
    const persist = vi.fn(async () => true)
    const cache = createWebTileCache(storage, { persist, estimate: async () => ({ usage: 5, quota: 100 }) })
    expect(await cache.get(URL_A)).toBeNull()
    await cache.put('p1', URL_A, new Blob(['aa'], { type: 'image/webp' }))
    await cache.put('p2', URL_B, new Blob(['bbb']))
    expect(persist).toHaveBeenCalledTimes(1)
    expect([...storage.caches.keys()]).toContain(`${WEB_TILE_CACHE_PREFIX}p1`)
    expect(await (await cache.get(URL_A))?.text()).toBe('aa')
    expect(await cache.has('p1', URL_A)).toBe(true)
    expect(await cache.has('p2', URL_A)).toBe(false)
    expect(await cache.packs()).toEqual(['p1', 'p2'])
    await cache.deletePack('p1')
    expect(await cache.get(URL_A)).toBeNull()
    expect(await cache.get(URL_B)).not.toBeNull()
    expect(await cache.packs()).toEqual(['p2'])
    expect(storage.caches.has('autre-cache')).toBe(true)
    expect(await cache.size()).toEqual({ usedBytes: 5, quotaBytes: 100 })
    await expect(cache.put('../x', URL_A, new Blob())).rejects.toThrow(/invalide/)
    vi.unstubAllGlobals()
  })

  it('web: no tile cache without Cache Storage (page not served over HTTPS)', () => {
    expect(selectPlatform({}).tileCache).toBeNull()
  })

  /** plugin-fs over a map of paths (relative to the app data folder). */
  function fakeFs() {
    const files = new Map<string, Uint8Array>()
    const dirs = new Set<string>()
    const calls: string[] = []
    const fake = {
      files,
      dirs,
      calls,
      BaseDirectory: { AppData: 14 },
      exists: vi.fn(async (path: string) => dirs.has(path) || files.has(path)),
      readDir: vi.fn(async (path: string) => {
        calls.push(`readDir ${path}`)
        const names = new Set<string>()
        for (const p of [...dirs, ...files.keys()]) if (p.startsWith(`${path}/`)) names.add(p.slice(path.length + 1).split('/')[0])
        return [...names].map((name) => ({ name, isDirectory: dirs.has(`${path}/${name}`), isFile: files.has(`${path}/${name}`), isSymlink: false }))
      }),
      readFile: vi.fn(async (path: string) => {
        calls.push(`readFile ${path}`)
        const bytes = files.get(path)
        if (!bytes) throw new Error('missing')
        return bytes
      }),
      writeFile: vi.fn(async (path: string, data: Uint8Array) => void files.set(path, data)),
      rename: vi.fn(async (from: string, to: string) => {
        const bytes = files.get(from)
        if (!bytes) throw new Error('missing')
        files.delete(from)
        files.set(to, bytes)
      }),
      mkdir: vi.fn(async (path: string) => {
        dirs.add(DESKTOP_TILE_ROOT)
        dirs.add(path)
      }),
      remove: vi.fn(async (path: string) => {
        dirs.delete(path)
        files.delete(path)
        for (const p of [...files.keys()]) if (p.startsWith(`${path}/`)) files.delete(p)
      }),
    }
    return fake
  }

  it('desktop: one file per tile under the app data folder, an index read once', async () => {
    const fs = fakeFs()
    const loadFs = async () => fs as never
    const cache = createDesktopTileCache(loadFs)
    expect(await cache.get(URL_A)).toBeNull()
    await cache.put('p1', URL_A, new Blob([new Uint8Array([0xff, 0xd8, 1])]))
    const path = `${DESKTOP_TILE_ROOT}/p1/${tileFileName(URL_A)}`
    expect(fs.files.has(path)).toBe(true)
    expect(fs.writeFile).toHaveBeenCalledWith(path, expect.any(Uint8Array), { baseDir: 14 })
    expect(fs.mkdir).toHaveBeenCalledWith(`${DESKTOP_TILE_ROOT}/p1`, { baseDir: 14, recursive: true })
    const blob = await cache.get(URL_A)
    expect(blob?.type).toBe('image/jpeg')

    // a new session reads the folders once; a tile no pack holds costs no call to the disk
    const again = createDesktopTileCache(loadFs)
    fs.calls.length = 0
    expect(await again.has('p1', URL_A)).toBe(true)
    expect(await again.get(URL_B)).toBeNull()
    expect(await again.get(URL_B)).toBeNull()
    expect(fs.calls).toEqual([`readDir ${DESKTOP_TILE_ROOT}`, `readDir ${DESKTOP_TILE_ROOT}/p1`])
    expect(await again.packs()).toEqual(['p1'])

    await again.put('p2', URL_A, new Blob(['x']))
    await again.deletePack('p1')
    expect(fs.remove).toHaveBeenCalledWith(`${DESKTOP_TILE_ROOT}/p1`, { baseDir: 14, recursive: true })
    expect(await (await again.get(URL_A))?.text()).toBe('x')
    await again.deletePack('p2')
    expect(await again.get(URL_A)).toBeNull()
    expect(await again.size()).toBeNull()
  })

  it('desktop: the platform keeps its tiles behind the same contract', () => {
    expect(selectPlatform({ isTauri: true }).tileCache).not.toBeNull()
  })

  const entry = (id: string, updatedAt: number, name = id) => ({ id, name, updatedAt, summary: '', sizeBytes: 1 })

  it('« Mes projets »: file names from a checked id, names cleaned, most recent first', () => {
    expect(projectFileNames('ab-12')).toEqual({ document: 'ab-12.openflyover.json', entry: 'ab-12.entry.json' })
    expect(() => projectFileNames('../tiles/x')).toThrow(/invalide/)
    expect(() => projectFileNames('')).toThrow(/invalide/)
    expect(cleanProjectName('  Tour   du\nMont-Blanc ')).toBe('Tour du Mont-Blanc')
    expect(cleanProjectName('x'.repeat(200))).toHaveLength(120)
    expect(() => cleanProjectName('   ')).toThrow(/vide/)
    const sorted = sortProjectEntries([entry('a', 1), entry('c', 3, 'Zèbre'), entry('b', 3, 'Âne')])
    expect(sorted.map((e) => e.id)).toEqual(['b', 'c', 'a'])
    expect(parseProjectEntry(JSON.stringify(entry('a', 1)), 'a')).toEqual(entry('a', 1))
    expect(parseProjectEntry(JSON.stringify(entry('a', 1)), 'b')).toBeNull()
    expect(parseProjectEntry('{"id":"a","name":3}', 'a')).toBeNull()
    expect(parseProjectEntry('pas du JSON', 'a')).toBeNull()
  })

  it('« Mes projets » on the desktop: two files per project under the app data folder', async () => {
    const fs = fakeFs()
    let clock = 1000
    let ids = 0
    const library = createProjectLibrary(createDesktopLibraryFiles(async () => fs as never), () => clock++, () => `p${++ids}`)
    expect(await library.list()).toEqual([])

    const first = await library.save(null, { name: ' Mont Blanc ', summary: 'Jour 1 · 12,4 km', text: '{"é":1}' })
    expect(first).toEqual({ id: 'p1', name: 'Mont Blanc', updatedAt: 1000, summary: 'Jour 1 · 12,4 km', sizeBytes: 8 })
    expect(fs.mkdir).toHaveBeenCalledWith(DESKTOP_PROJECT_ROOT, { baseDir: 14, recursive: true })
    // TextEncoder's bytes come from another realm than jsdom's Uint8Array
    // written beside the target, then renamed over it
    expect(fs.writeFile).toHaveBeenCalledWith(`${DESKTOP_PROJECT_ROOT}/p1.openflyover.json.tmp`, expect.anything(), { baseDir: 14 })
    expect(fs.rename).toHaveBeenCalledWith(`${DESKTOP_PROJECT_ROOT}/p1.openflyover.json.tmp`, `${DESKTOP_PROJECT_ROOT}/p1.openflyover.json`, {
      oldPathBaseDir: 14,
      newPathBaseDir: 14,
    })
    expect(fs.files.has(`${DESKTOP_PROJECT_ROOT}/p1.entry.json`)).toBe(true)
    expect([...fs.files.keys()].some((k) => k.endsWith('.tmp'))).toBe(false)
    await library.save(null, { name: 'Écrins', summary: '', text: '{}' })
    // a damaged entry is left out of the list
    fs.files.set(`${DESKTOP_PROJECT_ROOT}/p9.entry.json`, new TextEncoder().encode('{'))

    expect((await library.list()).map((e) => e.name)).toEqual(['Écrins', 'Mont Blanc'])
    expect(await library.load('p1')).toBe('{"é":1}')
    const saved = await library.save('p1', { name: 'Mont Blanc', summary: '', text: '{"v":2}' })
    expect(saved.updatedAt).toBe(1002)
    expect((await library.list())[0].id).toBe('p1')
    expect((await library.rename('p1', 'Tour du Mont-Blanc')).name).toBe('Tour du Mont-Blanc')
    expect(await library.load('p1')).toBe('{"v":2}')

    await library.remove('p1')
    expect(fs.files.has(`${DESKTOP_PROJECT_ROOT}/p1.openflyover.json`)).toBe(false)
    expect((await library.list()).map((e) => e.id)).toEqual(['p2'])
    await expect(library.load('p1')).rejects.toThrow(/plus dans/)
    await expect(library.rename('p1', 'x')).rejects.toThrow(/plus dans/)
    await expect(library.load('../tiles/a')).rejects.toThrow(/invalide/)
  })

  it('« Mes projets » on the web: one cache, the browser asked once to keep it', async () => {
    const storage = fakeCaches()
    const persist = vi.fn(async () => true)
    const library = createProjectLibrary(createWebLibraryFiles(storage, { persist }), () => 5, () => 'w1')
    await library.save(null, { name: 'Vercors', summary: '', text: '{"a":1}' })
    await library.save('w1', { name: 'Vercors', summary: '', text: '{"a":2}' })
    expect(persist).toHaveBeenCalledTimes(1)
    expect([...storage.caches.keys()]).toEqual([WEB_PROJECT_CACHE])
    expect(await library.list()).toEqual([{ id: 'w1', name: 'Vercors', updatedAt: 5, summary: '', sizeBytes: 7 }])
    expect(await library.load('w1')).toBe('{"a":2}')
    await library.remove('w1')
    expect(await library.list()).toEqual([])
  })

  it('« Mes projets »: a thumbnail kept in the entry, older entries without one, bad pictures dropped', async () => {
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQ=='
    expect(isProjectThumbnail(jpeg)).toBe(true)
    expect(isProjectThumbnail('data:text/html;base64,PGI+')).toBe(false)
    expect(isProjectThumbnail('javascript:alert(1)')).toBe(false)
    expect(isProjectThumbnail(`data:image/jpeg;base64,${'A'.repeat(MAX_THUMBNAIL_LENGTH)}`)).toBe(false)
    expect(parseProjectEntry(JSON.stringify({ ...entry('a', 1), thumbnail: 'data:image/svg+xml,<svg/>' }), 'a')).toEqual(entry('a', 1))

    const storage = fakeCaches()
    let ids = 0
    const library = createProjectLibrary(createWebLibraryFiles(storage), () => 5, () => `t${++ids}`)
    // an entry written before thumbnails existed
    await createWebLibraryFiles(storage).write('old.entry.json', JSON.stringify(entry('old', 1)))
    const first = await library.save(null, { name: 'Vercors', summary: '', text: '{}', thumbnail: jpeg })
    expect(first.thumbnail).toBe(jpeg)
    // no new picture (view not readable): the entry keeps its own, also through a rename
    expect((await library.save('t1', { name: 'Vercors', summary: '', text: '{"a":1}' })).thumbnail).toBe(jpeg)
    expect((await library.rename('t1', 'Vercors sud')).thumbnail).toBe(jpeg)
    expect((await library.save(null, { name: 'Écrins', summary: '', text: '{}', thumbnail: 'pas une image' })).thumbnail).toBeUndefined()
    const listed = await library.list()
    expect(listed.map((e) => [e.id, e.thumbnail])).toEqual([
      ['t2', undefined],
      ['t1', jpeg],
      ['old', undefined],
    ])
  })

  it('« Mes projets »: on the desktop, and on the web only with Cache Storage', () => {
    expect(selectPlatform({ isTauri: true }).projectLibrary).not.toBeNull()
    expect(selectPlatform({}).projectLibrary).toBeNull()
  })
})


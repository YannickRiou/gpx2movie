import { afterEach, describe, expect, it, vi } from 'vitest'
import { canPickFolder, joinPath, pickFolder, pickReadableFolder } from './folder'

const dialog = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }))
const fs = vi.hoisted(() => ({
  open: vi.fn(),
  remove: vi.fn(async () => undefined),
  readDir: vi.fn(),
  readFile: vi.fn(async () => new Uint8Array([1, 2])),
  SeekMode: { Start: 0 },
}))
vi.mock('@tauri-apps/plugin-dialog', () => dialog)
vi.mock('@tauri-apps/plugin-fs', () => fs)

afterEach(() => vi.clearAllMocks())

describe('folder', () => {
  it('joins with the separator of the folder', () => {
    expect(joinPath('C:\\Films', 'a.mp4')).toBe('C:\\Films\\a.mp4')
    expect(joinPath('/home/moi/Films', 'a.mp4')).toBe('/home/moi/Films/a.mp4')
    expect(joinPath('/home/moi/', 'a.mp4')).toBe('/home/moi/a.mp4')
  })

  it('can pick a folder on the desktop or with showDirectoryPicker', () => {
    expect(canPickFolder({ isDesktop: true }, {})).toBe(true)
    expect(canPickFolder({ isDesktop: false }, { showDirectoryPicker: () => undefined })).toBe(true)
    expect(canPickFolder({ isDesktop: false }, {})).toBe(false)
  })

  it('web: writes each file in the picked folder and removes a discarded one', async () => {
    const writable = { write: vi.fn(async () => undefined), close: vi.fn(async () => undefined), abort: vi.fn(async () => undefined) }
    const dir = {
      name: 'Films',
      getFileHandle: vi.fn(async (name: string) => ({ name, createWritable: async () => writable })),
      removeEntry: vi.fn(async () => undefined),
    }
    const picker = vi.fn(async () => dir)
    const folder = await pickFolder({ isDesktop: false }, { showDirectoryPicker: picker })
    expect(picker).toHaveBeenCalledWith({ id: 'openflyover-export', mode: 'readwrite' })
    expect(folder?.name).toBe('Films')
    const file = await folder!.createFile('Tour – 16x9-1080p.mp4')
    expect(dir.getFileHandle).toHaveBeenCalledWith('Tour – 16x9-1080p.mp4', { create: true })
    await file.write(new Uint8Array([1]), 0)
    expect(writable.write).toHaveBeenCalledWith({ type: 'write', data: new Uint8Array([1]), position: 0 })
    await file.discard()
    expect(dir.removeEntry).toHaveBeenCalledWith('Tour – 16x9-1080p.mp4')

    picker.mockRejectedValueOnce(new DOMException('closed', 'AbortError'))
    expect(await pickFolder({ isDesktop: false }, { showDirectoryPicker: picker })).toBeNull()
    await expect(pickFolder({ isDesktop: false }, {})).rejects.toThrow(/dossier/)
  })

  it('desktop: opens the files under the folder of the dialog', async () => {
    dialog.open.mockResolvedValueOnce('C:\\Films')
    fs.open.mockResolvedValueOnce({ write: vi.fn(), seek: vi.fn(), close: vi.fn(async () => undefined) })
    const folder = await pickFolder({ isDesktop: true })
    expect(dialog.open).toHaveBeenCalledWith({ directory: true, multiple: false, recursive: false })
    expect(folder?.name).toBe('Films')
    const file = await folder!.createFile('Tour – affiche.png')
    expect(fs.open).toHaveBeenCalledWith('C:\\Films\\Tour – affiche.png', { write: true, create: true, truncate: true })
    expect(file.fileName).toBe('Tour – affiche.png')
    dialog.open.mockResolvedValueOnce(null)
    expect(await pickFolder({ isDesktop: true })).toBeNull()
  })

  it('web: lists the files of the picked folder, without its subfolders', async () => {
    const entries = [
      { kind: 'file', name: 'b.gpx', getFile: async () => new File(['<gpx/>'], 'b.gpx') },
      { kind: 'directory', name: 'photos' },
    ]
    const picker = vi.fn(async () => ({
      name: 'Saison',
      async *values() {
        yield* entries
      },
    }))
    const folder = await pickReadableFolder({ isDesktop: false }, { showDirectoryPicker: picker })
    expect(picker).toHaveBeenCalledWith({ id: 'openflyover-traces', mode: 'read' })
    expect(folder?.name).toBe('Saison')
    expect(folder?.files.map((f) => f.name)).toEqual(['b.gpx'])
    expect(await (await folder!.files[0].read()).text()).toBe('<gpx/>')
    picker.mockRejectedValueOnce(new DOMException('closed', 'AbortError'))
    expect(await pickReadableFolder({ isDesktop: false }, { showDirectoryPicker: picker })).toBeNull()
  })

  it('desktop: reads the files of the folder of the dialog', async () => {
    dialog.open.mockResolvedValueOnce('C:\\Traces')
    fs.readDir.mockResolvedValueOnce([
      { name: 'a.fit', isFile: true, isDirectory: false },
      { name: 'vieux', isFile: false, isDirectory: true },
    ])
    const folder = await pickReadableFolder({ isDesktop: true })
    expect(folder?.name).toBe('Traces')
    expect(folder?.files.map((f) => f.name)).toEqual(['a.fit'])
    const file = await folder!.files[0].read()
    expect(fs.readFile).toHaveBeenCalledWith('C:\\Traces\\a.fit')
    expect(file.name).toBe('a.fit')
    expect(file.size).toBe(2)
  })
})

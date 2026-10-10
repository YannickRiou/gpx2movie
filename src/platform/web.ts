/**
 * Web platform: file input, download through an object URL, localStorage (the behaviour of the static site); files
 * written while produced through `showSaveFilePicker` (File System Access, Chrome and Edge); offline tiles and
 * « Mes projets » in Cache Storage (HTTPS or localhost only).
 */
import { droppedFiles, isAppleMobile, keyValueStore, mimeTypeOf, pickerAccept, pickerTypes, saveFilters } from './platform'
import type { Capabilities, Platform, SaveFileOptions, SaveOutcome, WritableFile } from './platform'
import { createProjectLibrary, createWebLibraryFiles } from './projectLibrary'
import { createWebTileCache } from './tileCache'

/** The part of File System Access used here (not in the DOM typings yet). */
type SaveFilePicker = (options: {
  suggestedName: string
  types: ReturnType<typeof pickerTypes>
}) => Promise<FileSystemFileHandle & { remove?: () => Promise<void> }>

/** Save picker, then a writable stream: Chrome writes to a temporary file, moved in place on close. */
async function createWritableFile(options: SaveFileOptions): Promise<WritableFile | null> {
  const picker = (globalThis as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker
  if (!picker) throw new Error("Ce navigateur ne sait pas écrire directement sur le disque.")
  let handle: Awaited<ReturnType<SaveFilePicker>>
  try {
    // called before any await: the picker needs the user's click
    handle = await picker({ suggestedName: options.fileName, types: pickerTypes(saveFilters(options)) })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
  // the picker created the file: removed by `discard` (Chrome 110+)
  return writableOf(handle, async () => handle.remove?.())
}

/** A file handle open for writing; `remove` deletes the partial file when the export does not finish. */
export async function writableOf(handle: FileSystemFileHandle, remove: () => Promise<void>): Promise<WritableFile> {
  const writable = await handle.createWritable()
  let state: 'open' | 'closed' | 'discarded' = 'open'
  return {
    fileName: handle.name,
    write: (data, position) => writable.write({ type: 'write', data: data as Uint8Array<ArrayBuffer>, position }),
    async close() {
      await writable.close()
      state = 'closed'
    },
    async discard() {
      if (state !== 'open') return
      state = 'discarded'
      await writable.abort().catch(() => undefined)
      await remove().catch(() => undefined)
    },
  }
}

function localStorageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * The share sheet (iOS: « Enregistrer la vidéo » in Photos, « Enregistrer dans Fichiers »), when it takes this file;
 * null when it does not, or refuses (no user gesture left): the caller downloads instead.
 */
async function shareFile(capabilities: Capabilities, file: File): Promise<SaveOutcome | null> {
  if (!capabilities.sharesFiles || !navigator.canShare?.({ files: [file] })) return null
  try {
    await navigator.share({ files: [file] })
    return { saved: true, fileName: file.name }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return { saved: false }
    return null
  }
}

/** Click a download link (the browser saves the file in its download folder). */
function clickDownload(url: string, fileName: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
}

export function createWebPlatform(capabilities: Capabilities): Platform {
  return {
    capabilities,
    storage: keyValueStore(localStorageOrNull()),
    // synchronous up to the click: the picker needs the user's gesture
    openFiles: ({ filters, multiple = false }) =>
      new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = multiple
        input.accept = pickerAccept(filters, isAppleMobile(navigator))
        input.style.display = 'none'
        const done = (files: File[]) => {
          input.remove()
          resolve(files)
        }
        input.addEventListener('change', () => done(Array.from(input.files ?? [])), { once: true })
        input.addEventListener('cancel', () => done([]), { once: true })
        document.body.append(input)
        input.click()
      }),
    async saveFile(data, { fileName }) {
      // called before any await: the share sheet needs the user's click
      const shared = await shareFile(capabilities, new File([data], fileName, { type: data.type || mimeTypeOf(fileName) }))
      if (shared) return shared
      const url = URL.createObjectURL(data)
      clickDownload(url, fileName)
      // released once the click has been handled
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return { saved: true, fileName }
    },
    async saveUrl(url, { fileName }) {
      if (capabilities.sharesFiles) {
        const blob = await (await fetch(url)).blob()
        const shared = await shareFile(capabilities, new File([blob], fileName, { type: blob.type || mimeTypeOf(fileName) }))
        if (shared) return shared
      }
      clickDownload(url, fileName)
      return { saved: true, fileName }
    },
    createWritableFile,
    droppedFiles,
    tileCache: globalThis.caches ? createWebTileCache(globalThis.caches, globalThis.navigator?.storage) : null,
    projectLibrary: globalThis.caches ? createProjectLibrary(createWebLibraryFiles(globalThis.caches, globalThis.navigator?.storage)) : null,
  }
}

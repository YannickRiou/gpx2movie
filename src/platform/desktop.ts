/**
 * Desktop platform (Tauri v2): native open / save dialogs, files read and written by the fs plugin. The Tauri
 * packages are imported on first use, only inside the desktop app. A path picked in a dialog is added to the fs scope
 * by the dialog plugin, so the capabilities (src-tauri/capabilities) grant no other path.
 * Storage stays localStorage: the webview keeps it in the app data folder. A film is written while it is encoded
 * through a file handle (`open`, `seek`, `write`), removed if the export does not finish. Offline tiles are files
 * under `<app data>/tiles/`, « Mes projets » under `<app data>/projects/` (the only folders the capability adds to the
 * fs scope). Closing the window waits for `guardClose` (last write, question when something would be lost).
 */
import { droppedFiles, fileNameOf, keyValueStore, mimeTypeOf, saveFilters } from './platform'
import type { Capabilities, FileFilter, Platform, SaveFileOptions, SaveOutcome, WritableFile } from './platform'
import { createDesktopLibraryFiles, createProjectLibrary } from './projectLibrary'
import { createDesktopTileCache } from './tileCache'

const dialogFilters = (filters: readonly FileFilter[]) => filters.map((f) => ({ name: f.name, extensions: [...f.extensions] }))

async function saveBlob(data: Blob, options: SaveFileOptions): Promise<SaveOutcome> {
  const [{ save }, { writeFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
  const path = await save({ defaultPath: options.fileName, filters: dialogFilters(saveFilters(options)) })
  if (!path) return { saved: false }
  await writeFile(path, new Uint8Array(await data.arrayBuffer()))
  return { saved: true, fileName: fileNameOf(path) }
}

async function createWritableFile(options: SaveFileOptions): Promise<WritableFile | null> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const path = await save({ defaultPath: options.fileName, filters: dialogFilters(saveFilters(options)) })
  return path ? openWritablePath(path) : null
}

/** The file at `path` (created or emptied), open for writing; removed by `discard`. */
export async function openWritablePath(path: string): Promise<WritableFile> {
  const fs = await import('@tauri-apps/plugin-fs')
  const file = await fs.open(path, { write: true, create: true, truncate: true })
  /** cursor of the handle: a seek only for the header patches */
  let cursor = 0
  let state: 'open' | 'closed' | 'discarded' = 'open'
  return {
    fileName: fileNameOf(path),
    path,
    async write(data, position) {
      if (position !== cursor) await file.seek(position, fs.SeekMode.Start)
      for (let offset = 0; offset < data.length; ) {
        const written = await file.write(data.subarray(offset))
        if (written <= 0) throw new Error("L'écriture du fichier s'est arrêtée.")
        offset += written
      }
      cursor = position + data.length
    },
    async close() {
      await file.close()
      state = 'closed'
    },
    async discard() {
      if (state !== 'open') return
      state = 'discarded'
      await file.close().catch(() => undefined)
      await fs.remove(path).catch(() => undefined)
    },
  }
}

export function createDesktopPlatform(capabilities: Capabilities): Platform {
  return {
    capabilities,
    storage: keyValueStore(globalThis.localStorage ?? null),
    async openFiles({ filters, multiple = false }) {
      const [{ open }, { readFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
      const picked = (await open({ multiple, directory: false, filters: dialogFilters(filters) })) as string | string[] | null
      const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked]
      return Promise.all(
        paths.map(async (path) => {
          const name = fileNameOf(path)
          return new File([await readFile(path)], name, { type: mimeTypeOf(name) })
        }),
      )
    },
    saveFile: saveBlob,
    async saveUrl(url, options) {
      return saveBlob(await (await fetch(url)).blob(), options)
    },
    createWritableFile,
    droppedFiles,
    tileCache: createDesktopTileCache(() => import('@tauri-apps/plugin-fs')),
    projectLibrary: createProjectLibrary(createDesktopLibraryFiles(() => import('@tauri-apps/plugin-fs'))),
    guardClose(beforeClose) {
      // with this listener the window no longer closes on its own: Tauri calls it, then `destroy` unless prevented
      const listening = import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow().onCloseRequested(async (event) => {
          if (!(await beforeClose().catch(() => true))) event.preventDefault()
        }),
      )
      return () => void listening.then((unlisten) => unlisten())
    },
    async ask({ title, text, yes, no, cancel }) {
      const { message } = await import('@tauri-apps/plugin-dialog')
      const buttons = no === undefined ? { ok: yes, cancel } : { yes, no, cancel }
      const answer = await message(text, { title, kind: 'warning', buttons })
      return answer === yes ? 'yes' : answer === no ? 'no' : 'cancel'
    },
  }
}

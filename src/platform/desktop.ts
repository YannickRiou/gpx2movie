/**
 * Desktop platform (Tauri v2): native open / save dialogs, files read and written by the fs plugin. The Tauri
 * packages are imported on first use, only inside the desktop app. A path picked in a dialog is added to the fs scope
 * by the dialog plugin, so the capabilities (src-tauri/capabilities) grant no other path.
 * Storage stays localStorage: the webview keeps it in the app data folder.
 */
import { droppedFiles, fileNameOf, keyValueStore, mimeTypeOf, saveFilters } from './platform'
import type { Capabilities, FileFilter, Platform, SaveFileOptions, SaveOutcome } from './platform'

const dialogFilters = (filters: readonly FileFilter[]) => filters.map((f) => ({ name: f.name, extensions: [...f.extensions] }))

async function saveBlob(data: Blob, options: SaveFileOptions): Promise<SaveOutcome> {
  const [{ save }, { writeFile }] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
  const path = await save({ defaultPath: options.fileName, filters: dialogFilters(saveFilters(options)) })
  if (!path) return { saved: false }
  await writeFile(path, new Uint8Array(await data.arrayBuffer()))
  return { saved: true, fileName: fileNameOf(path) }
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
    droppedFiles,
  }
}

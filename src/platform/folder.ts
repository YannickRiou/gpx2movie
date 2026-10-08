/**
 * A folder picked once to receive several files (batch export): `showDirectoryPicker` (File System Access, Chrome and
 * Edge) on the web, the folder dialog on the desktop (the dialog plugin adds the folder's files to the fs scope). Each
 * file is written while it is produced, like `Platform.createWritableFile`.
 */
import { openWritablePath } from './desktop'
import { fileNameOf } from './platform'
import type { Capabilities, WritableFile } from './platform'
import { writableOf } from './web'

export interface WritableFolder {
  /** name of the folder, for the messages */
  readonly name: string
  /** a file of that name in the folder (an existing one is replaced), open for writing */
  createFile(fileName: string): Promise<WritableFile>
}

/** The part of File System Access used here (not in the DOM typings yet). */
type DirectoryPicker = (options: { id?: string; mode: 'readwrite' }) => Promise<
  FileSystemDirectoryHandle & { getFileHandle(name: string, options: { create: boolean }): Promise<FileSystemFileHandle> }
>

/** A folder can be picked here: the desktop app, or a browser with `showDirectoryPicker`. */
export function canPickFolder(capabilities: Pick<Capabilities, 'isDesktop'>, scope: object = globalThis): boolean {
  return capabilities.isDesktop || typeof (scope as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
}

/** `dir` + `name` with the separator `dir` already uses (Windows dialogs return backslashes). */
export function joinPath(dir: string, name: string): string {
  const separator = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return /[\\/]$/.test(dir) ? `${dir}${name}` : `${dir}${separator}${name}`
}

/**
 * Ask for a folder; null when the dialog is closed. On the web, call it from the user's click (before any await).
 */
export async function pickFolder(
  capabilities: Pick<Capabilities, 'isDesktop'>,
  scope: object = globalThis,
): Promise<WritableFolder | null> {
  if (capabilities.isDesktop) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const dir = (await open({ directory: true, multiple: false, recursive: false })) as string | null
    if (!dir) return null
    return { name: fileNameOf(dir.replace(/[\\/]+$/, '')), createFile: (fileName) => openWritablePath(joinPath(dir, fileName)) }
  }
  const picker = (scope as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
  if (!picker) throw new Error('Ce navigateur ne sait pas écrire dans un dossier.')
  let dir: Awaited<ReturnType<DirectoryPicker>>
  try {
    dir = await picker.call(scope, { id: 'openflyover-export', mode: 'readwrite' })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
  return {
    name: dir.name,
    async createFile(fileName) {
      const handle = await dir.getFileHandle(fileName, { create: true })
      return writableOf(handle, () => dir.removeEntry(fileName))
    },
  }
}

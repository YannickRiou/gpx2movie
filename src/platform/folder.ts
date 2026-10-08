/**
 * A folder picked once to receive several files (batch export): `showDirectoryPicker` (File System Access, Chrome and
 * Edge) on the web, the folder dialog on the desktop (the dialog plugin adds the folder's files to the fs scope). Each
 * file is written while it is produced, like `Platform.createWritableFile`. A folder can also be picked to read the
 * files directly inside it (one film per track, `pickReadableFolder`).
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

/** Desktop: the folder at `dir` (in the fs scope: picked in a dialog, or given on the command line). */
export function writableFolderAt(dir: string): WritableFolder {
  return { name: fileNameOf(dir.replace(/[\\/]+$/, '')), createFile: (fileName) => openWritablePath(joinPath(dir, fileName)) }
}

/** Desktop: the files directly inside the folder at `dir` (in the fs scope). */
export async function readableFolderAt(dir: string, fs?: typeof import('@tauri-apps/plugin-fs')): Promise<ReadableFolder> {
  const { readDir, readFile } = fs ?? (await import('@tauri-apps/plugin-fs'))
  const entries = (await readDir(dir)).filter((entry) => entry.isFile)
  const files = entries.map(({ name }) => ({ name, read: async () => new File([await readFile(joinPath(dir, name))], name) }))
  return { name: fileNameOf(dir.replace(/[\\/]+$/, '')), files }
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
    return dir ? writableFolderAt(dir) : null
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

/** A file of a folder picked to be read. */
export interface FolderFile {
  readonly name: string
  read(): Promise<File>
}

export interface ReadableFolder {
  /** name of the folder, for the messages */
  readonly name: string
  /** the files directly inside it (subfolders not read) */
  readonly files: readonly FolderFile[]
}

/** The part of File System Access read here (async iteration is not in the DOM typings used). */
type ReadDirectoryPicker = (options: { id?: string; mode: 'read' }) => Promise<{
  name: string
  values(): AsyncIterable<{ kind: 'file'; name: string; getFile(): Promise<File> } | { kind: 'directory'; name: string }>
}>

/**
 * Ask for a folder to read; null when the dialog is closed. On the web, call it from the user's click (before any
 * await). On the desktop, the dialog adds the folder and the files directly inside it to the fs scope.
 */
export async function pickReadableFolder(
  capabilities: Pick<Capabilities, 'isDesktop'>,
  scope: object = globalThis,
): Promise<ReadableFolder | null> {
  if (capabilities.isDesktop) {
    const [{ open }, fs] = await Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
    const dir = (await open({ directory: true, multiple: false, recursive: false })) as string | null
    return dir ? readableFolderAt(dir, fs) : null
  }
  const picker = (scope as { showDirectoryPicker?: ReadDirectoryPicker }).showDirectoryPicker
  if (!picker) throw new Error('Ce navigateur ne sait pas lire un dossier.')
  let dir: Awaited<ReturnType<ReadDirectoryPicker>>
  try {
    dir = await picker.call(scope, { id: 'openflyover-traces', mode: 'read' })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
  const files: FolderFile[] = []
  for await (const entry of dir.values()) {
    if (entry.kind === 'file') files.push({ name: entry.name, read: () => entry.getFile() })
  }
  return { name: dir.name, files }
}

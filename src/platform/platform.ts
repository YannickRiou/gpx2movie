/**
 * Contract of the platform layer (see index.ts) and its pure helpers, shared by the web and desktop implementations.
 */

/** One line of a file dialog's type list: extensions without the dot. */
export interface FileFilter {
  name: string
  extensions: readonly string[]
}

export interface OpenFilesOptions {
  filters: readonly FileFilter[]
  multiple?: boolean
}

export interface SaveFileOptions {
  /** suggested name; the desktop dialog lets the user change it */
  fileName: string
  /** type list of the desktop dialog (default: the extension of `fileName`) */
  filters?: readonly FileFilter[]
}

/** `saved: false` when the user closed the dialog; `fileName` is the name actually written. */
export type SaveOutcome = { saved: true; fileName: string } | { saved: false }

/** Synchronous like localStorage (preferences and caches are read at start-up). */
export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export interface Capabilities {
  /** running inside the desktop app */
  isDesktop: boolean
  /** WebCodecs is present (missing in WebKitGTK, the Linux webview of the desktop app) */
  canEncodeVideo: boolean
}

export interface Platform {
  readonly capabilities: Capabilities
  readonly storage: KeyValueStore
  /** files picked by the user, empty when the dialog is closed */
  openFiles(options: OpenFilesOptions): Promise<File[]>
  saveFile(data: Blob, options: SaveFileOptions): Promise<SaveOutcome>
  /** same for an object URL already made (export result) */
  saveUrl(url: string, options: SaveFileOptions): Promise<SaveOutcome>
  /** files of an HTML drop (the desktop window keeps HTML drops: `dragDropEnabled: false`) */
  droppedFiles(dataTransfer: DataTransfer | null | undefined): File[]
}

/** Tauri v2 sets `isTauri` (and `__TAURI_INTERNALS__`) on the window of its webview. */
export function isTauriRuntime(scope: object): boolean {
  return (scope as { isTauri?: unknown }).isTauri === true || '__TAURI_INTERNALS__' in scope
}

export function detectCapabilities(scope: object): Capabilities {
  return {
    isDesktop: isTauriRuntime(scope),
    canEncodeVideo: typeof (scope as { VideoEncoder?: unknown }).VideoEncoder === 'function',
  }
}

/** Filters -> `accept` attribute of a file input: ".gpx,.fit,.json". */
export function acceptAttribute(filters: readonly FileFilter[]): string {
  return [...new Set(filters.flatMap((f) => f.extensions.map((e) => `.${e.toLowerCase()}`)))].join(',')
}

/** Last segment of a path, with either separator (Windows dialogs return backslashes). */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Lower-case extension without the dot, '' when there is none. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

const MIME_TYPES: Record<string, string> = {
  gpx: 'application/gpx+xml',
  json: 'application/json',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/** Type of a file read from disk ('' when unknown, as a browser does). */
export function mimeTypeOf(fileName: string): string {
  return MIME_TYPES[extensionOf(fileName)] ?? ''
}

/** Filters of a save dialog: those given, else the extension of the suggested name. */
export function saveFilters(options: SaveFileOptions): FileFilter[] {
  if (options.filters) return [...options.filters]
  const ext = extensionOf(options.fileName)
  return ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : []
}

/** Files of a drop, the same on both targets. */
export function droppedFiles(dataTransfer: DataTransfer | null | undefined): File[] {
  return Array.from(dataTransfer?.files ?? [])
}

/** `storage` (localStorage) behind a store that never throws; memory only when it is missing or blocked. */
export function keyValueStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null): KeyValueStore {
  const memory = new Map<string, string>()
  return {
    get(key) {
      try {
        if (storage) return storage.getItem(key)
      } catch {
        // blocked (private window, quota): memory below
      }
      return memory.get(key) ?? null
    },
    set(key, value) {
      memory.set(key, value)
      try {
        storage?.setItem(key, value)
      } catch {
        // kept in memory for this session
      }
    },
    remove(key) {
      memory.delete(key)
      try {
        storage?.removeItem(key)
      } catch {
        // nothing to do
      }
    },
  }
}

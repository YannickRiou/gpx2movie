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

/**
 * A file being written while it is produced (long films go straight to disk instead of memory). The encoder writes
 * in order, then patches its headers at earlier positions: every write says where it goes.
 */
export interface WritableFile {
  /** name actually chosen in the dialog */
  readonly fileName: string
  write(data: Uint8Array, position: number): Promise<void>
  /** flush and close: the file is complete */
  close(): Promise<void>
  /** stop writing and remove the partial file; safe at any time and more than once, a no-op after `close` */
  discard(): Promise<void>
}

/** Synchronous like localStorage (preferences and caches are read at start-up). */
export interface KeyValueStore {
  get(key: string): string | null
  /** false when the value could not be stored (storage full or unavailable): it is then kept in memory for this session */
  set(key: string, value: string): boolean
  remove(key: string): void
  /** keys starting with `prefix`, stored or kept in memory */
  keys(prefix?: string): string[]
}

export interface Capabilities {
  /** running inside the desktop app */
  isDesktop: boolean
  /** WebCodecs is present (missing in WebKitGTK, the Linux webview of the desktop app) */
  canEncodeVideo: boolean
  /** `createWritableFile` works: desktop, or a browser with `showSaveFilePicker` (Chrome, Edge) */
  canStreamToDisk: boolean
}

export interface Platform {
  readonly capabilities: Capabilities
  readonly storage: KeyValueStore
  /** files picked by the user, empty when the dialog is closed */
  openFiles(options: OpenFilesOptions): Promise<File[]>
  saveFile(data: Blob, options: SaveFileOptions): Promise<SaveOutcome>
  /** same for an object URL already made (export result) */
  saveUrl(url: string, options: SaveFileOptions): Promise<SaveOutcome>
  /**
   * Ask where to save, then hand a file open for writing; null when the dialog is closed. Only when
   * `capabilities.canStreamToDisk`; on the web it must be called from the user's click (before any await).
   */
  createWritableFile(options: SaveFileOptions): Promise<WritableFile | null>
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
    canStreamToDisk:
      isTauriRuntime(scope) || typeof (scope as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function',
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
  gif: 'image/gif',
  avif: 'image/avif',
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

/** `types` of the browser's save picker: one per filter, extensions keyed by their type. */
export function pickerTypes(filters: readonly FileFilter[]): { description: string; accept: Record<string, string[]> }[] {
  return filters.map((f) => {
    const accept: Record<string, string[]> = {}
    for (const ext of f.extensions) (accept[mimeTypeOf(`f.${ext}`) || 'application/octet-stream'] ??= []).push(`.${ext.toLowerCase()}`)
    return { description: f.name, accept }
  })
}

/** Files of a drop, the same on both targets. */
export function droppedFiles(dataTransfer: DataTransfer | null | undefined): File[] {
  return Array.from(dataTransfer?.files ?? [])
}

/** `storage` (localStorage) behind a store that never throws; values it refuses (missing, blocked, full) stay in memory. */
export function keyValueStore(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> | null,
): KeyValueStore {
  /** values the storage refused, for this session */
  const memory = new Map<string, string>()
  return {
    get(key) {
      // a refused value is newer than what the storage may still hold
      const kept = memory.get(key)
      if (kept !== undefined) return kept
      try {
        return storage?.getItem(key) ?? null
      } catch {
        return null // blocked (private window)
      }
    },
    set(key, value) {
      try {
        if (storage) {
          storage.setItem(key, value)
          memory.delete(key)
          return true
        }
      } catch {
        // full or blocked: memory below
      }
      memory.set(key, value)
      return false
    },
    keys(prefix = '') {
      const found = new Set<string>()
      try {
        for (let i = 0; storage && i < storage.length; i++) {
          const key = storage.key(i)
          if (key?.startsWith(prefix)) found.add(key)
        }
      } catch {
        // blocked: memory only
      }
      for (const key of memory.keys()) if (key.startsWith(prefix)) found.add(key)
      return [...found]
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

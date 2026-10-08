/**
 * « Mes projets » behind `ProjectLibrary` (see platform.ts). Each project is two text files named by its id: the
 * document `<id>.openflyover.json` (tens of MB with its pictures and clips) and its entry `<id>.entry.json` (name,
 * date, summary, size), so the list reads only the small files. Desktop: files under `<app data>/projects/` (the
 * capability adds that folder to the fs scope). Web: one Cache Storage cache, `openflyover-projects-v1`. Both take
 * their storage as an argument (tests).
 */
import type * as TauriFs from '@tauri-apps/plugin-fs'
import type { ProjectEntry, ProjectLibrary } from './platform'

/** Named text files in one folder. */
export interface LibraryFiles {
  names(): Promise<string[]>
  /** null when the file does not exist */
  read(name: string): Promise<string | null>
  write(name: string, text: string): Promise<void>
  remove(name: string): Promise<void>
}

/** folder of the projects in the app data folder */
export const DESKTOP_PROJECT_ROOT = 'projects'
export const WEB_PROJECT_CACHE = 'openflyover-projects-v1'
/** key prefix of the files in the web cache (resolved against the page) */
const WEB_PROJECT_URL = '/openflyover-projects/'

const PROJECT_ID = /^[a-z0-9-]{1,64}$/
const DOCUMENT_SUFFIX = '.openflyover.json'
const ENTRY_SUFFIX = '.entry.json'
const MAX_NAME_LENGTH = 120

/** File names of a project; the id is checked first, so a path never comes from outside. */
export function projectFileNames(id: string): { document: string; entry: string } {
  if (!PROJECT_ID.test(id)) throw new Error(`Identifiant de projet invalide : ${id}`)
  return { document: `${id}${DOCUMENT_SUFFIX}`, entry: `${id}${ENTRY_SUFFIX}` }
}

/** Name of an entry: trimmed, spaces collapsed, 120 characters at most. */
export function cleanProjectName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH).trim()
  if (!clean) throw new Error('Le nom du projet est vide.')
  return clean
}

/** Most recent first, then by name. */
export function sortProjectEntries(entries: readonly ProjectEntry[]): ProjectEntry[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, 'fr'))
}

/** The entry stored in `text` for project `id`, null when it is not one (damaged or foreign file). */
export function parseProjectEntry(text: string, id: string): ProjectEntry | null {
  try {
    const raw = JSON.parse(text) as Partial<ProjectEntry>
    const valid =
      raw.id === id &&
      typeof raw.name === 'string' &&
      typeof raw.summary === 'string' &&
      Number.isFinite(raw.updatedAt) &&
      Number.isFinite(raw.sizeBytes)
    return valid ? (raw as ProjectEntry) : null
  } catch {
    return null
  }
}

export function createProjectLibrary(
  files: LibraryFiles,
  now: () => number = Date.now,
  newId: () => string = () => crypto.randomUUID(),
): ProjectLibrary {
  const readEntry = async (id: string) => {
    const text = await files.read(projectFileNames(id).entry)
    const entry = text === null ? null : parseProjectEntry(text, id)
    if (!entry) throw new Error('Ce projet n’est plus dans « Mes projets ».')
    return entry
  }
  const writeEntry = (entry: ProjectEntry) => files.write(projectFileNames(entry.id).entry, JSON.stringify(entry))

  return {
    async list() {
      const ids = (await files.names()).filter((n) => n.endsWith(ENTRY_SUFFIX)).map((n) => n.slice(0, -ENTRY_SUFFIX.length))
      const entries = await Promise.all(ids.filter((id) => PROJECT_ID.test(id)).map((id) => readEntry(id).catch(() => null)))
      return sortProjectEntries(entries.filter((e) => e !== null))
    },
    async save(id, { name, summary, text }) {
      const entry: ProjectEntry = {
        id: id ?? newId(),
        name: cleanProjectName(name),
        updatedAt: now(),
        summary,
        sizeBytes: new TextEncoder().encode(text).length,
      }
      // the document first: an entry never points to a document that was not written
      await files.write(projectFileNames(entry.id).document, text)
      await writeEntry(entry)
      return entry
    },
    async load(id) {
      const text = await files.read(projectFileNames(id).document)
      if (text === null) throw new Error('Ce projet n’est plus dans « Mes projets ».')
      return text
    },
    async rename(id, name) {
      const entry = { ...(await readEntry(id)), name: cleanProjectName(name) }
      await writeEntry(entry)
      return entry
    },
    async remove(id) {
      const { document, entry } = projectFileNames(id)
      await files.remove(entry)
      await files.remove(document)
    },
  }
}

type DesktopFs = Pick<typeof TauriFs, 'exists' | 'readDir' | 'readFile' | 'writeFile' | 'mkdir' | 'remove' | 'BaseDirectory'>

/** Files under `<app data>/projects/`, the folder made on the first write. */
export function createDesktopLibraryFiles(loadFs: () => Promise<DesktopFs>): LibraryFiles {
  let madeDir = false
  const fsAndOptions = async () => {
    const fs = await loadFs()
    return { fs, baseDir: fs.BaseDirectory.AppData }
  }
  const pathOf = (name: string) => `${DESKTOP_PROJECT_ROOT}/${name}`

  return {
    async names() {
      const { fs, baseDir } = await fsAndOptions()
      if (!(await fs.exists(DESKTOP_PROJECT_ROOT, { baseDir }))) return []
      return (await fs.readDir(DESKTOP_PROJECT_ROOT, { baseDir })).filter((e) => e.isFile).map((e) => e.name)
    },
    async read(name) {
      const { fs, baseDir } = await fsAndOptions()
      if (!(await fs.exists(pathOf(name), { baseDir }))) return null
      return new TextDecoder().decode(await fs.readFile(pathOf(name), { baseDir }))
    },
    async write(name, text) {
      const { fs, baseDir } = await fsAndOptions()
      if (!madeDir) {
        await fs.mkdir(DESKTOP_PROJECT_ROOT, { baseDir, recursive: true })
        madeDir = true
      }
      await fs.writeFile(pathOf(name), new TextEncoder().encode(text), { baseDir })
    },
    async remove(name) {
      const { fs, baseDir } = await fsAndOptions()
      if (await fs.exists(pathOf(name), { baseDir })) await fs.remove(pathOf(name), { baseDir })
    },
  }
}

/** Files in one cache of Cache Storage, the browser asked once not to evict them. */
export function createWebLibraryFiles(
  storage: Pick<CacheStorage, 'open'>,
  manager?: Partial<Pick<StorageManager, 'persist'>>,
): LibraryFiles {
  let cache: Promise<Cache> | null = null
  let persistAsked = false
  const open = () => (cache ??= storage.open(WEB_PROJECT_CACHE))
  const keyOf = (name: string) => `${WEB_PROJECT_URL}${name}`

  return {
    async names() {
      return (await (await open()).keys()).map((request) => request.url.slice(request.url.lastIndexOf('/') + 1))
    },
    async read(name) {
      const response = await (await open()).match(keyOf(name))
      return response ? response.text() : null
    },
    async write(name, text) {
      if (!persistAsked) {
        // best effort: the browser may refuse
        persistAsked = true
        await manager?.persist?.().catch(() => false)
      }
      await (await open()).put(keyOf(name), new Response(text, { headers: { 'content-type': 'application/json' } }))
    },
    async remove(name) {
      await (await open()).delete(keyOf(name))
    },
  }
}

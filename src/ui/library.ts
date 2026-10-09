/**
 * « Mes projets » on the app side: the list and the entry of the open project (`useLibraryStore`), keeping the open
 * project in the library, and its autosave a few seconds after each change (never during an export). Storage is the
 * platform's `projectLibrary` (src/platform/projectLibrary.ts). Opening an entry goes through `openProject`. Closing
 * the window or tab writes the last change first, and asks when something would be lost (`installCloseGuard`).
 */
import { errorMessage } from '../core/errors'
import { create } from 'zustand'
import type { Track } from '../core/types'
import { useMediaStore } from '../film/media'
import { getPlatform } from '../platform'
import type { Platform, ProjectEntry, ProjectLibrary } from '../platform'
import { sortProjectEntries } from '../platform/projectLibrary'
import { projectFileName, serializeProject } from '../project/document'
import { useAppStore } from '../state/store'
import type { AppState } from '../state/store'
import { formatDistance, formatNumber } from './format'
import { effectiveProjectName, isProjectDirty } from './shell'
import type { SavedProject } from './shell'
import { showToast } from './toast'

/** Wait after the last change before saving the open entry. */
export const AUTOSAVE_DELAY_MS = 3000

/** "Tour du Mont-Blanc · 42,3 km", "… · 3 traces" when there are several; the track name only when the project has another. */
export function projectSummary(tracks: readonly Track[], projectName = ''): string {
  const first = tracks[0]
  if (!first) return 'Aucune trace'
  const distance = formatDistance(first.stats.distanceM)
  const summary = first.name === projectName ? distance : `${first.name} · ${distance}`
  return tracks.length > 1 ? `${summary} · ${tracks.length} traces` : summary
}

/** 12 300 -> "12 Ko", 4 500 000 -> "4,5 Mo". */
export function formatProjectSize(bytes: number): string {
  return bytes < 1e6 ? `${formatNumber(Math.max(1, bytes / 1e3))} Ko` : `${formatNumber(bytes / 1e6, 1)} Mo`
}

export interface AutosaveOptions {
  delayMs: number
  /** false while a save must wait (export running): tried again after another delay */
  canSave(): boolean
  save(): Promise<void>
  /** first failure since the last success: one message, not one per attempt */
  onError(error: unknown): void
}

export interface Autosave {
  /** the project changed: save after `delayMs` without another change */
  changed(): void
  /** save now if a save is waiting, then resolve once no save is running */
  flush(): Promise<void>
  cancel(): void
}

export function createAutosave({ delayMs, canSave, save, onError }: AutosaveOptions): Autosave {
  let timer: ReturnType<typeof setTimeout> | null = null
  /** saves run one after the other */
  let queue: Promise<void> = Promise.resolve()
  let failing = false

  const attempt = async () => {
    try {
      await save()
      failing = false
    } catch (error) {
      if (!failing) onError(error)
      failing = true
    }
  }
  const run = (): Promise<void> => {
    timer = null
    if (!canSave()) {
      schedule()
      return queue
    }
    queue = queue.then(attempt)
    return queue
  }
  const cancel = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const schedule = () => {
    cancel()
    timer = setTimeout(() => void run(), delayMs)
  }

  return {
    changed: schedule,
    flush() {
      if (timer === null) return queue
      cancel()
      return run()
    },
    cancel,
  }
}

// ---------------------------------------------------------------------------
// Store and actions
// ---------------------------------------------------------------------------

interface LibraryState {
  /** most recent first */
  entries: ProjectEntry[]
  /** entry of the open project, null when it is not kept in « Mes projets » */
  currentId: string | null
}

export const useLibraryStore = create<LibraryState>()(() => ({ entries: [], currentId: null }))

/** settings, tracks and name of the open project at its last write to the library (compared by reference) */
let kept: SavedProject | null = null
/** counts the projects opened, so that a write finishing after another project was opened leaves it alone */
let openedCount = 0

const projectOf = (state: AppState): SavedProject => ({ settings: state.settings, tracks: state.tracks, name: state.projectName })

function putEntry(entry: ProjectEntry): void {
  const { entries } = useLibraryStore.getState()
  useLibraryStore.setState({ entries: sortProjectEntries([entry, ...entries.filter((e) => e.id !== entry.id)]) })
}

/**
 * Write the open project to entry `id` (a new one when null); it becomes the open entry and the top bar shows it saved,
 * unless another project was opened during the write.
 */
async function writeOpenProject(library: ProjectLibrary, id: string | null): Promise<ProjectEntry> {
  const state = useAppStore.getState()
  const snapshot: AppState['savedProject'] = { settings: state.settings, tracks: state.tracks, name: state.projectName }
  const name = effectiveProjectName(state.projectName, state.tracks[0]?.name)
  const text = serializeProject(state, name, useMediaStore.getState().table)
  const opened = openedCount
  const entry = await library.save(id, { name, summary: projectSummary(state.tracks, name), text })
  putEntry(entry)
  if (opened === openedCount) {
    // a change made during the write differs from `snapshot`: saved again by the autosave
    kept = snapshot
    useAppStore.setState({ savedProject: snapshot })
    useLibraryStore.setState({ currentId: entry.id })
  }
  return entry
}

/** The open project now is entry `id` (null: not kept); called by `openProject` once the project is applied. */
export function setOpenEntry(id: string | null): void {
  openedCount++
  kept = id === null ? null : projectOf(useAppStore.getState())
  useLibraryStore.setState({ currentId: id })
}

export async function refreshLibrary(): Promise<void> {
  const library = getPlatform().projectLibrary
  if (!library) return
  try {
    useLibraryStore.setState({ entries: await library.list() })
  } catch (err) {
    showToast({ kind: 'error', text: `Impossible de lire « Mes projets » : ${errorMessage(err)}` })
  }
}

/** true while « Garder dans Mes projets » writes: a second click would create a second entry */
let keeping = false

/** « Garder dans Mes projets »: a new entry for the open project, saved automatically from now on. */
export async function keepOpenProject(): Promise<void> {
  const library = getPlatform().projectLibrary
  if (!library || keeping) return
  keeping = true
  try {
    const entry = await writeOpenProject(library, null)
    showToast({ kind: 'success', text: `Projet « ${entry.name} » gardé dans Mes projets` })
  } catch (err) {
    showToast({ kind: 'error', text: `Impossible de garder le projet : ${errorMessage(err)}` })
  } finally {
    keeping = false
  }
}

/** The document of `entry` as a file for `openProject`, null (with a toast) when it cannot be read. */
export async function libraryFile(entry: ProjectEntry): Promise<File | null> {
  const library = getPlatform().projectLibrary
  if (!library) return null
  try {
    return new File([await library.load(entry.id)], projectFileName(entry.name), { type: 'application/json' })
  } catch (err) {
    showToast({ kind: 'error', text: `Impossible d'ouvrir « ${entry.name} » : ${errorMessage(err)}` })
    return null
  }
}

/** Rename an entry; the open one also takes the name in the top bar (its document follows at the autosave). */
export async function renameEntry(entry: ProjectEntry, name: string): Promise<void> {
  const library = getPlatform().projectLibrary
  if (!library) return
  try {
    const renamed = await library.rename(entry.id, name)
    putEntry(renamed)
    if (useLibraryStore.getState().currentId === entry.id) useAppStore.getState().setProjectName(renamed.name)
  } catch (err) {
    showToast({ kind: 'error', text: `Impossible de renommer « ${entry.name} » : ${errorMessage(err)}` })
  }
}

/** Delete an entry; the open project stays open, no longer kept. */
export async function deleteEntry(entry: ProjectEntry): Promise<void> {
  const library = getPlatform().projectLibrary
  if (!library) return
  try {
    if (useLibraryStore.getState().currentId === entry.id) {
      // no longer kept first, then wait for a write in progress: it would bring the entry back after the removal
      setOpenEntry(null)
      await flushAutosave()
    }
    await library.remove(entry.id)
    useLibraryStore.setState({ entries: useLibraryStore.getState().entries.filter((e) => e.id !== entry.id) })
    showToast({ kind: 'success', text: `Projet « ${entry.name} » supprimé de Mes projets` })
  } catch (err) {
    showToast({ kind: 'error', text: `Impossible de supprimer « ${entry.name} » : ${errorMessage(err)}` })
  }
}

let autosave: Autosave | null = null

/** Save a waiting change of the open entry now (before another project replaces it). */
export function flushAutosave(): Promise<void> {
  return autosave?.flush() ?? Promise.resolve()
}

/** Save the open entry a few seconds after each change of the project, unless `canSave` says to wait. Once, by `App`. */
export function installLibraryAutosave(canSave: () => boolean): () => void {
  const library = getPlatform().projectLibrary
  if (!library) return () => {}
  const saver = createAutosave({
    delayMs: AUTOSAVE_DELAY_MS,
    canSave,
    async save() {
      const id = useLibraryStore.getState().currentId
      if (id !== null && kept && isProjectDirty(projectOf(useAppStore.getState()), kept)) await writeOpenProject(library, id)
    },
    onError: (err) => showToast({ kind: 'error', text: `Enregistrement automatique dans Mes projets impossible : ${errorMessage(err)}` }),
  })
  autosave = saver
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (useLibraryStore.getState().currentId !== null && isProjectDirty(projectOf(state), projectOf(previous))) saver.changed()
  })
  return () => {
    unsubscribe()
    saver.cancel()
    if (autosave === saver) autosave = null
  }
}

// ---------------------------------------------------------------------------
// Closing the window or tab
// ---------------------------------------------------------------------------

/** Longest wait for the last write when the desktop window closes: it closes anyway after that. */
export const CLOSE_FLUSH_TIMEOUT_MS = 4000

/** What closing now would lose: the film being exported, else changes not saved (« Modifié »); null when nothing. */
export type CloseLoss = 'export' | 'changes' | null

export function closeLoss({ exporting, dirty }: { exporting: boolean; dirty: boolean }): CloseLoss {
  return exporting ? 'export' : dirty ? 'changes' : null
}

/** Resolves once `promise` settles, or after `ms` at the latest. */
export function settleWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(done, ms)
    promise.then(done, done)
  })
}

export interface CloseSteps {
  /** write the change waiting for the autosave */
  flush(): Promise<void>
  loss(): CloseLoss
  ask(loss: 'export' | 'changes'): Promise<'save' | 'close' | 'cancel'>
  /** « Enregistrer » (file) */
  save(): Promise<void>
}

/**
 * Desktop window asked to close: true to close it. The last change of a project kept in « Mes projets » is written
 * first (no question then); otherwise a question when something would be lost.
 */
export async function confirmClose(steps: CloseSteps, timeoutMs = CLOSE_FLUSH_TIMEOUT_MS): Promise<boolean> {
  await settleWithin(steps.flush(), timeoutMs)
  const loss = steps.loss()
  if (loss === null) return true
  const answer = await steps.ask(loss)
  if (answer !== 'save') return answer === 'close'
  await steps.save()
  // save dialog closed or write failed: still « Modifié », the window stays open
  return steps.loss() === null
}

const isOpenProjectDirty = () => {
  const state = useAppStore.getState()
  return isProjectDirty(projectOf(state), state.savedProject)
}

/** The question of the desktop window, answered with the step of `confirmClose`. */
async function askBeforeClose(ask: NonNullable<Platform['ask']>, loss: 'export' | 'changes'): Promise<'save' | 'close' | 'cancel'> {
  if (loss === 'export') {
    const answer = await ask({
      title: "Fermer pendant l'export ?",
      text: "Le film en cours d'export sera perdu.",
      yes: 'Fermer quand même',
      cancel: 'Annuler',
    })
    return answer === 'yes' ? 'close' : 'cancel'
  }
  const state = useAppStore.getState()
  const name = effectiveProjectName(state.projectName, state.tracks[0]?.name)
  const answer = await ask({
    title: 'Fermer sans enregistrer ?',
    text: `Les changements de « ${name} » ne sont pas enregistrés.`,
    yes: 'Enregistrer',
    no: 'Fermer sans enregistrer',
    cancel: 'Annuler',
  })
  return answer === 'yes' ? 'save' : answer === 'no' ? 'close' : 'cancel'
}

/**
 * Nothing lost on closing. Page hidden or left: the waiting change is written at once (web: not awaited, a Cache
 * Storage write started there usually ends, but nothing guarantees it). Web: the browser's « quitter le site ? »
 * (its own text) when something would be lost. Desktop: `confirmClose`. Once, by `App`.
 */
export function installCloseGuard(exporting: () => boolean, save: () => Promise<void>): () => void {
  const platform = getPlatform()
  const loss = () => closeLoss({ exporting: exporting(), dirty: isOpenProjectDirty() })
  const flush = () => void flushAutosave()
  const flushIfHidden = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    flush()
    if (loss() === null) return
    event.preventDefault()
    // older browsers ask only when it is set
    event.returnValue = true
  }
  const { ask } = platform
  const stopGuard =
    ask && platform.guardClose
      ? platform.guardClose(() => confirmClose({ flush: flushAutosave, loss, ask: (l) => askBeforeClose(ask, l), save }))
      : null
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', flushIfHidden)
  if (!stopGuard) window.addEventListener('beforeunload', onBeforeUnload)
  return () => {
    window.removeEventListener('pagehide', flush)
    document.removeEventListener('visibilitychange', flushIfHidden)
    window.removeEventListener('beforeunload', onBeforeUnload)
    stopGuard?.()
  }
}

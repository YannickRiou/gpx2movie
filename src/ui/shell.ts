/**
 * Pure logic of the application shell (no React, no DOM): framing of the 3D preview to the output format,
 * keyboard shortcuts, routing of the opened files, roving focus of the tabs, project name and save state.
 */
import type { Track } from '../core/types'
import { DEFAULT_PROJECT_NAME } from '../project/document'
import type { Settings } from '../state/store'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Largest rectangle of ratio `aspect` (width / height) centred in a `width` × `height` stage, in whole pixels
 * (letterbox or pillarbox); the whole stage when `aspect` is null (free framing) or the stage is empty.
 */
export function frameRect(width: number, height: number, aspect: number | null): Rect {
  if (aspect === null || !(aspect > 0) || width <= 0 || height <= 0) {
    return { left: 0, top: 0, width: Math.max(0, width), height: Math.max(0, height) }
  }
  const w = Math.min(width, Math.round(height * aspect))
  const h = Math.min(height, Math.round(w / aspect))
  return { left: Math.floor((width - w) / 2), top: Math.floor((height - h) / 2), width: w, height: h }
}

export type ShellAction = 'save' | 'open' | 'export' | 'fit' | 'toggle-panel'

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/**
 * Shortcut of the shell for a key press, null when none: Ctrl/Cmd+S save, Ctrl/Cmd+O open, Ctrl/Cmd+E export
 * drawer, F fit the view, [ collapse / expand the panel (whatever the modifiers that type it). Undo / redo belong to `installHistoryShortcuts`.
 * `typing` (focus in a text field or a list) disables every shortcut.
 */
export function shellShortcut(e: KeyLike, typing: boolean): ShellAction | null {
  if (typing) return null
  // « [ » needs AltGr (Ctrl+Alt) on French keyboards: the character decides, not the modifiers
  if (e.key === '[') return e.metaKey ? null : 'toggle-panel'
  if (e.altKey) return null
  const key = e.key.toLowerCase()
  if (e.ctrlKey || e.metaKey) {
    if (e.shiftKey) return null
    if (key === 's') return 'save'
    if (key === 'o') return 'open'
    if (key === 'e') return 'export'
    return null
  }
  if (key === 'f' && !e.shiftKey) return 'fit'
  return null
}

/** Files picked with « Ouvrir »: a project (.json) is opened, everything else goes to the track importer. */
export interface OpenedFiles<F> {
  project: F | null
  tracks: F[]
  /** projects beyond the first: one project at a time */
  extraProjects: F[]
}

export function routeOpenedFiles<F extends { name: string }>(files: readonly F[]): OpenedFiles<F> {
  const out: OpenedFiles<F> = { project: null, tracks: [], extraProjects: [] }
  for (const file of files) {
    if (!/\.json$/i.test(file.name)) out.tracks.push(file)
    else if (out.project) out.extraProjects.push(file)
    else out.project = file
  }
  return out
}

/**
 * Index of the tab that takes the focus after `key` in a tab list of `count` tabs (wrapping), null for any
 * other key. Both axes are accepted (vertical rail, horizontal bar on small screens); Home / End.
 */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (current - 1 + count) % count
  if (key === 'ArrowDown' || key === 'ArrowRight') return (current + 1) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

/** Name used for the project file: the typed name, else the first track's, else « Sans titre ». */
export function effectiveProjectName(name: string, firstTrackName: string | undefined): string {
  return name.trim() || firstTrackName || DEFAULT_PROJECT_NAME
}

/** What a saved project contains, as compared by reference with the last save or open. */
export interface SavedProject {
  settings: Settings
  tracks: readonly Track[]
  name: string
}

/** The project changed since `saved` (settings, tracks or name replaced since then). */
export function isProjectDirty(current: SavedProject, saved: SavedProject): boolean {
  return current.settings !== saved.settings || current.tracks !== saved.tracks || current.name !== saved.name
}

// ---------------------------------------------------------------------------
// Side columns: tabs of the left panel and the right dock (export drawer)
// ---------------------------------------------------------------------------

export const SHELL_TABS = ['trace', 'carte', 'survol', 'habillage', 'projet'] as const
export type ShellTab = (typeof SHELL_TABS)[number]

/** Below this window width (px) only one side column is open at a time (panel or dock). */
export const ONE_SIDE_MAX_WIDTH = 1360

export interface ShellState {
  tab: ShellTab
  /** the left panel is folded into the rail */
  collapsed: boolean
  /** the export drawer is open in the right dock */
  dockOpen: boolean
  /** the panel was folded by the opening of the dock: it comes back when the dock closes */
  collapsedByDock: boolean
}

export type ShellEvent =
  /** click on a tab: shows it, or folds the panel when it is already shown */
  | { type: 'click-tab'; tab: ShellTab; narrow: boolean }
  /** keyboard move to a tab: shows it */
  | { type: 'select-tab'; tab: ShellTab; narrow: boolean }
  | { type: 'toggle-panel'; narrow: boolean }
  | { type: 'toggle-dock'; narrow: boolean }
  | { type: 'close-dock' }

/** The panel unfolds; on a narrow window it takes the place of the dock. */
function unfold(state: ShellState, narrow: boolean): ShellState {
  return { ...state, collapsed: false, collapsedByDock: false, dockOpen: narrow ? false : state.dockOpen }
}

function closeDock(state: ShellState): ShellState {
  if (!state.dockOpen) return state
  return state.collapsedByDock
    ? { ...state, dockOpen: false, collapsed: false, collapsedByDock: false }
    : { ...state, dockOpen: false }
}

/** `narrow`: the window is narrower than ONE_SIDE_MAX_WIDTH when the event happens. */
export function shellReducer(state: ShellState, event: ShellEvent): ShellState {
  switch (event.type) {
    case 'click-tab':
      if (event.tab === state.tab && !state.collapsed) return { ...state, collapsed: true, collapsedByDock: false }
      return unfold({ ...state, tab: event.tab }, event.narrow)
    case 'select-tab':
      return unfold({ ...state, tab: event.tab }, event.narrow)
    case 'toggle-panel':
      return state.collapsed ? unfold(state, event.narrow) : { ...state, collapsed: true, collapsedByDock: false }
    case 'toggle-dock':
      if (state.dockOpen) return closeDock(state)
      if (event.narrow && !state.collapsed) return { ...state, dockOpen: true, collapsed: true, collapsedByDock: true }
      return { ...state, dockOpen: true }
    case 'close-dock':
      return closeDock(state)
  }
}

/** Tab and folded panel remembered by the browser (not by the project); defaults for anything unreadable. */
export function parseShellPrefs(raw: string | null): Pick<ShellState, 'tab' | 'collapsed'> {
  const fallback = { tab: 'trace' as ShellTab, collapsed: false }
  if (!raw) return fallback
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== 'object') return fallback
    const { tab, collapsed } = value as Record<string, unknown>
    return {
      tab: (SHELL_TABS as readonly unknown[]).includes(tab) ? (tab as ShellTab) : fallback.tab,
      collapsed: typeof collapsed === 'boolean' ? collapsed : fallback.collapsed,
    }
  } catch {
    return fallback
  }
}

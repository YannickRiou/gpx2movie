/**
 * Pure logic of the application shell (no React, no DOM): framing of the 3D preview to the output format,
 * routing of the opened or dropped files, roving focus of the tabs, project name and save state (shortcuts: `shortcuts.ts`).
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

/** Files picked with « Ouvrir » or dropped on the window: a project (.json) is opened, everything else goes to the track importer. */
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

/** A drag carries files (not text or a link): the window offers to import them. */
export function isFileDrag(types: readonly string[] | null | undefined): boolean {
  return types?.includes('Files') ?? false
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

/**
 * Index of the cell that takes the focus after `key` in a grid of `count` cells, `columns` per row (row by row), null
 * for any other key: the arrows move one cell and stop at the edges, Home / End go to the first / last cell.
 */
export function nextGridIndex(current: number, key: string, columns: number, count: number): number | null {
  if (count <= 0 || columns <= 0) return null
  const col = current % columns
  if (key === 'ArrowLeft') return col > 0 ? current - 1 : current
  if (key === 'ArrowRight') return col < columns - 1 && current + 1 < count ? current + 1 : current
  if (key === 'ArrowUp') return current - columns >= 0 ? current - columns : current
  if (key === 'ArrowDown') return current + columns < count ? current + columns : current
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
// Side columns: tabs of the left panel and the right dock (export drawer, else the inspector of the timeline)
// ---------------------------------------------------------------------------

/** In montage order: the track, the place, the weather, the light, the camera, the lens, the overlay, the project. */
export const SHELL_TABS = ['trace', 'carte', 'meteo', 'lumiere', 'survol', 'objectif', 'habillage', 'projet'] as const
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
  /** a timeline block is selected: the dock shows its inspector (the export drawer goes first) */
  inspecting: boolean
}

export type ShellEvent =
  /** click on a tab: shows it, or folds the panel when it is already shown */
  | { type: 'click-tab'; tab: ShellTab; narrow: boolean }
  /** keyboard move to a tab: shows it */
  | { type: 'select-tab'; tab: ShellTab; narrow: boolean }
  | { type: 'toggle-panel'; narrow: boolean }
  | { type: 'toggle-dock'; narrow: boolean }
  | { type: 'close-dock' }
  /** a timeline block is selected (`open`) or no longer */
  | { type: 'inspect'; open: boolean; narrow: boolean }
  /** the phone timeline unfolds: panel and export drawer make room (one sheet at a time) */
  | { type: 'fold' }

/** The panel unfolds; on a narrow window it takes the place of the dock (drawer and inspector). */
function unfold(state: ShellState, narrow: boolean): ShellState {
  return narrow
    ? { ...state, collapsed: false, collapsedByDock: false, dockOpen: false, inspecting: false }
    : { ...state, collapsed: false, collapsedByDock: false }
}

/** The dock shows nothing any more: the panel folded by its opening comes back. */
function emptyDock(state: ShellState): ShellState {
  return state.collapsedByDock ? { ...state, collapsed: false, collapsedByDock: false } : state
}

function closeDock(state: ShellState): ShellState {
  if (!state.dockOpen) return state
  const closed = { ...state, dockOpen: false }
  return state.inspecting ? closed : emptyDock(closed)
}

/** Something appears in an empty dock: on a narrow window it folds the panel. */
function fillDock(state: ShellState, narrow: boolean): ShellState {
  if (narrow && !state.collapsed) return { ...state, collapsed: true, collapsedByDock: true }
  return state
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
      return fillDock({ ...state, dockOpen: true }, event.narrow)
    case 'close-dock':
      return closeDock(state)
    case 'inspect':
      if (event.open === state.inspecting) return state
      if (!event.open) return state.dockOpen ? { ...state, inspecting: false } : emptyDock({ ...state, inspecting: false })
      return state.dockOpen ? { ...state, inspecting: true } : fillDock({ ...state, inspecting: true }, event.narrow)
    case 'fold':
      return { ...state, collapsed: true, collapsedByDock: false, dockOpen: false }
  }
}

/** Tab and folded panel remembered by the browser (not by the project); defaults for anything unreadable or unknown. */
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

/** Open / folded state of the sections of the panels (`PanelSection`), remembered by the browser by section title. */
export const FOLDS_KEY = 'openflyover.folds.v1'

/** What is remembered: open (true) or folded (false) by section title; nothing for anything unreadable. */
export function parseFoldPrefs(raw: string | null): Record<string, boolean> {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Phone layouts (media queries of shell.css)
// ---------------------------------------------------------------------------

/** Portrait phone: tabs in a bottom bar, panels and drawers as bottom sheets. */
export const BOTTOM_SHEET_QUERY = '(max-width: 699px)'
/** Phone, either way up: top bar actions in a menu, timeline folded into a strip, dialogs full screen. */
export const COMPACT_QUERY = '(max-width: 699px), (max-height: 499px)'

export const matchesQuery = (query: string) => typeof window !== 'undefined' && (window.matchMedia?.(query).matches ?? false)

/** Heights of a bottom sheet, as a fraction of the room above the tab bar. */
export const SHEET_SNAPS = { peek: 0.3, half: 0.55, full: 1 } as const
export type SheetSnap = keyof typeof SHEET_SNAPS
/** How far a flick carries the sheet: its speed (rooms per second) times this (seconds). */
const SHEET_FLICK_S = 0.2

/**
 * Where a bottom sheet released at `fraction` of the room settles, given its speed (rooms per second, up positive):
 * the snap nearest to where the flick carries it, or null (closed) below half the peek.
 */
export function settleSheet(fraction: number, velocity: number): SheetSnap | null {
  const projected = fraction + velocity * SHEET_FLICK_S
  if (projected < SHEET_SNAPS.peek / 2) return null
  let best: SheetSnap = 'peek'
  for (const snap of Object.keys(SHEET_SNAPS) as SheetSnap[]) {
    if (Math.abs(SHEET_SNAPS[snap] - projected) < Math.abs(SHEET_SNAPS[best] - projected)) best = snap
  }
  return best
}

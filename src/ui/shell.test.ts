import { describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import { DEFAULT_SETTINGS } from '../state/store'
import {
  effectiveProjectName,
  frameRect,
  isFileDrag,
  isProjectDirty,
  nextGridIndex,
  nextTabIndex,
  parseShellPrefs,
  routeOpenedFiles,
  shellReducer,
} from './shell'
import type { ShellState } from './shell'

describe('frameRect', () => {
  it('letterboxes a wide format in a taller stage, centred', () => {
    expect(frameRect(1000, 800, 16 / 9)).toEqual({ left: 0, top: 118, width: 1000, height: 563 })
  })

  it('pillarboxes a vertical format', () => {
    const r = frameRect(1000, 800, 9 / 16)
    expect(r.height).toBe(800)
    expect(r.width).toBe(450)
    expect(r.left).toBe(275)
    expect(r.top).toBe(0)
  })

  it('stays inside the stage and keeps the ratio within a pixel', () => {
    for (const aspect of [16 / 9, 9 / 16, 1, 4 / 5, 21 / 9]) {
      for (const [w, h] of [
        [1064, 678],
        [333, 917],
        [1, 1],
      ]) {
        const r = frameRect(w, h, aspect)
        expect(r.left + r.width).toBeLessThanOrEqual(w)
        expect(r.top + r.height).toBeLessThanOrEqual(h)
        expect(Math.abs(r.width - r.height * aspect)).toBeLessThanOrEqual(Math.max(1, aspect))
      }
    }
  })

  it('fills the stage in free framing or for an empty stage', () => {
    expect(frameRect(640, 480, null)).toEqual({ left: 0, top: 0, width: 640, height: 480 })
    expect(frameRect(0, 480, 16 / 9)).toEqual({ left: 0, top: 0, width: 0, height: 480 })
  })
})

describe('routeOpenedFiles', () => {
  it('opens the first project and imports the rest as tracks', () => {
    const files = [{ name: 'a.gpx' }, { name: 'Tour.openflyover.JSON' }, { name: 'b.fit' }, { name: 'c.json' }, { name: 'notes.txt' }]
    const out = routeOpenedFiles(files)
    expect(out.project?.name).toBe('Tour.openflyover.JSON')
    expect(out.tracks.map((f) => f.name)).toEqual(['a.gpx', 'b.fit', 'notes.txt'])
    expect(out.extraProjects.map((f) => f.name)).toEqual(['c.json'])
  })

  it('has no project for tracks only', () => {
    expect(routeOpenedFiles([{ name: 'x.gpx' }]).project).toBeNull()
  })
})

describe('isFileDrag', () => {
  it('is true only when the drag carries files', () => {
    expect(isFileDrag(['Files', 'application/x-moz-file'])).toBe(true)
    expect(isFileDrag(['text/plain', 'text/uri-list'])).toBe(false)
    expect(isFileDrag(undefined)).toBe(false)
  })
})

describe('nextTabIndex', () => {
  it('wraps on both axes and jumps with Home / End', () => {
    expect(nextTabIndex(0, 'ArrowUp', 5)).toBe(4)
    expect(nextTabIndex(4, 'ArrowDown', 5)).toBe(0)
    expect(nextTabIndex(2, 'ArrowLeft', 5)).toBe(1)
    expect(nextTabIndex(2, 'ArrowRight', 5)).toBe(3)
    expect(nextTabIndex(3, 'Home', 5)).toBe(0)
    expect(nextTabIndex(1, 'End', 5)).toBe(4)
    expect(nextTabIndex(1, 'Enter', 5)).toBeNull()
  })
})

describe('nextGridIndex', () => {
  it('moves one cell in a 3 × 3 grid, stops at the edges, jumps with Home / End', () => {
    expect(nextGridIndex(4, 'ArrowLeft', 3, 9)).toBe(3)
    expect(nextGridIndex(4, 'ArrowRight', 3, 9)).toBe(5)
    expect(nextGridIndex(4, 'ArrowUp', 3, 9)).toBe(1)
    expect(nextGridIndex(4, 'ArrowDown', 3, 9)).toBe(7)
    expect(nextGridIndex(3, 'ArrowLeft', 3, 9)).toBe(3)
    expect(nextGridIndex(5, 'ArrowRight', 3, 9)).toBe(5)
    expect(nextGridIndex(1, 'ArrowUp', 3, 9)).toBe(1)
    expect(nextGridIndex(7, 'ArrowDown', 3, 9)).toBe(7)
    expect(nextGridIndex(4, 'Home', 3, 9)).toBe(0)
    expect(nextGridIndex(4, 'End', 3, 9)).toBe(8)
    expect(nextGridIndex(4, ' ', 3, 9)).toBeNull()
  })
})

describe('project name and save state', () => {
  it('falls back on the first track then « Sans titre »', () => {
    expect(effectiveProjectName('  Mon film ', 'Trace')).toBe('Mon film')
    expect(effectiveProjectName(' ', 'Trace')).toBe('Trace')
    expect(effectiveProjectName('', undefined)).toBe('Sans titre')
  })

  it('is dirty once settings, tracks or name are replaced', () => {
    const tracks: Track[] = []
    const saved = { settings: DEFAULT_SETTINGS, tracks, name: 'a' }
    expect(isProjectDirty({ ...saved }, saved)).toBe(false)
    expect(isProjectDirty({ ...saved, settings: { ...DEFAULT_SETTINGS } }, saved)).toBe(true)
    expect(isProjectDirty({ ...saved, tracks: [] }, saved)).toBe(true)
    expect(isProjectDirty({ ...saved, name: 'b' }, saved)).toBe(true)
  })
})

describe('shellReducer', () => {
  const base: ShellState = { tab: 'trace', collapsed: false, dockOpen: false, collapsedByDock: false, inspecting: false }

  it('a click on the open tab folds the panel, another tab unfolds it', () => {
    const folded = shellReducer(base, { type: 'click-tab', tab: 'trace', narrow: false })
    expect(folded.collapsed).toBe(true)
    expect(shellReducer(folded, { type: 'click-tab', tab: 'trace', narrow: false })).toMatchObject({ collapsed: false })
    expect(shellReducer(base, { type: 'click-tab', tab: 'carte', narrow: false })).toMatchObject({ tab: 'carte', collapsed: false })
  })

  it('keyboard selection never folds', () => {
    expect(shellReducer(base, { type: 'select-tab', tab: 'trace', narrow: false }).collapsed).toBe(false)
  })

  it('on a narrow window the dock folds the panel and gives it back when it closes', () => {
    const open = shellReducer(base, { type: 'toggle-dock', narrow: true })
    expect(open).toMatchObject({ dockOpen: true, collapsed: true, collapsedByDock: true })
    expect(shellReducer(open, { type: 'close-dock' })).toMatchObject({ dockOpen: false, collapsed: false, collapsedByDock: false })
  })

  it('on a wide window both columns stay open', () => {
    const open = shellReducer(base, { type: 'toggle-dock', narrow: false })
    expect(open).toMatchObject({ dockOpen: true, collapsed: false })
    expect(shellReducer(open, { type: 'toggle-dock', narrow: false })).toMatchObject({ dockOpen: false, collapsed: false })
  })

  it('a panel folded by the user stays folded when the dock closes', () => {
    const folded = { ...base, collapsed: true }
    const open = shellReducer(folded, { type: 'toggle-dock', narrow: true })
    expect(open.collapsedByDock).toBe(false)
    expect(shellReducer(open, { type: 'close-dock' }).collapsed).toBe(true)
  })

  it('unfolding the panel on a narrow window closes the dock', () => {
    const open = shellReducer(base, { type: 'toggle-dock', narrow: true })
    expect(shellReducer(open, { type: 'toggle-panel', narrow: true })).toMatchObject({ collapsed: false, dockOpen: false })
  })

  it('on a narrow window the inspector folds the panel like the dock, and gives it back once deselected', () => {
    const shown = shellReducer(base, { type: 'inspect', open: true, narrow: true })
    expect(shown).toMatchObject({ inspecting: true, collapsed: true, collapsedByDock: true })
    expect(shellReducer(shown, { type: 'inspect', open: true, narrow: true })).toBe(shown)
    expect(shellReducer(shown, { type: 'inspect', open: false, narrow: true })).toMatchObject({ inspecting: false, collapsed: false })
    expect(shellReducer(base, { type: 'inspect', open: true, narrow: false })).toMatchObject({ inspecting: true, collapsed: false })
  })

  it('the export drawer goes over the inspector: the panel stays folded until both are gone', () => {
    const shown = shellReducer(base, { type: 'inspect', open: true, narrow: true })
    const drawer = shellReducer(shown, { type: 'toggle-dock', narrow: true })
    expect(drawer).toMatchObject({ dockOpen: true, inspecting: true, collapsed: true })
    const back = shellReducer(drawer, { type: 'close-dock' })
    expect(back).toMatchObject({ dockOpen: false, inspecting: true, collapsed: true })
    const deselected = shellReducer(drawer, { type: 'inspect', open: false, narrow: true })
    expect(deselected).toMatchObject({ dockOpen: true, inspecting: false, collapsed: true })
    expect(shellReducer(deselected, { type: 'close-dock' })).toMatchObject({ collapsed: false, collapsedByDock: false })
  })

  it('unfolding the panel on a narrow window hides the inspector too', () => {
    const shown = shellReducer(base, { type: 'inspect', open: true, narrow: true })
    expect(shellReducer(shown, { type: 'toggle-panel', narrow: true })).toMatchObject({ collapsed: false, inspecting: false })
    expect(shellReducer(shown, { type: 'click-tab', tab: 'carte', narrow: false })).toMatchObject({ collapsed: false, inspecting: true })
  })
})

describe('parseShellPrefs', () => {
  it('reads a saved tab and fold, defaults otherwise', () => {
    expect(parseShellPrefs('{"tab":"habillage","collapsed":true}')).toEqual({ tab: 'habillage', collapsed: true })
    expect(parseShellPrefs('{"tab":"export","collapsed":"oui"}')).toEqual({ tab: 'trace', collapsed: false })
    expect(parseShellPrefs('not json')).toEqual({ tab: 'trace', collapsed: false })
    expect(parseShellPrefs(null)).toEqual({ tab: 'trace', collapsed: false })
    expect(parseShellPrefs('null')).toEqual({ tab: 'trace', collapsed: false })
  })
})

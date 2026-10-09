import { Suspense, lazy, useEffect, useReducer, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { useBatchStore } from './export/batch'
import { isExportBusy, useExportStore } from './export/store'
import { addStop, addText } from './film/timeline'
import { getPlatform } from './platform'
import { getSettingsHistory, installHistoryShortcuts, installSliderGestures } from './project/history'
import { editFilm, useFilmClock } from './scene/usePacing'
import { useAppStore } from './state/store'
import { CameraPanel } from './ui/CameraPanel'
import { ClimbList } from './ui/ClimbList'
import { EmptyState } from './ui/EmptyState'
import { FilmInspector } from './ui/FilmInspector'
import { HelpDialog } from './ui/HelpDialog'
import { Icon } from './ui/icons'
import type { IconName } from './ui/icons'
import { LandmarkPanel } from './ui/LandmarkPanel'
import { installCloseGuard, installLibraryAutosave } from './ui/library'
import { OverlayPanel } from './ui/OverlayPanel'
import { PanelSection } from './ui/PanelSection'
import { PoiPanel } from './ui/PoiPanel'
import { RoutePanel } from './ui/RoutePanel'
import { chooseFilesToOpen, openFiles, saveProject } from './ui/projectActions'
import { ProjectPanel } from './ui/ProjectPanel'
import { RoadbookPanel } from './ui/RoadbookPanel'
import { SettingsPanel } from './ui/SettingsPanel'
import { useSafeZonesStore } from './ui/SafeZones'
import { ONE_SIDE_MAX_WIDTH, SHELL_TABS, isFileDrag, nextTabIndex, parseShellPrefs, shellReducer } from './ui/shell'
import type { ShellTab } from './ui/shell'
import { keyFocus, matchShortcut, seekTime, withShortcut } from './ui/shortcuts'
import { Stage } from './ui/Stage'
import { StatusBar } from './ui/StatusBar'
import { Timeline } from './ui/Timeline'
import { Toaster } from './ui/Toaster'
import { TopBar } from './ui/TopBar'
import { TrackList } from './ui/TrackList'
import { WeatherPanel } from './ui/WeatherPanel'
import './ui/app.css'
import './ui/shell.css'

// Loaded right after the first paint, in their own chunks: the export drawer (video, batch, poster) and the offline
// packs are not needed to show the first screen. They stay mounted once loaded (side effects, see the side panel).
const ExportPanel = lazy(() => import('./ui/ExportPanel').then((m) => ({ default: m.ExportPanel })))
const OfflinePanel = lazy(() => import('./ui/OfflinePanel').then((m) => ({ default: m.OfflinePanel })))

const TAB_LABELS: Record<ShellTab, { label: string; icon: IconName }> = {
  trace: { label: 'Trace', icon: 'route' },
  carte: { label: 'Carte', icon: 'map' },
  survol: { label: 'Survol', icon: 'video' },
  habillage: { label: 'Habillage', icon: 'layers' },
  projet: { label: 'Projet', icon: 'folder' },
}

/** tabs that say, without a track, to add one first (Trace has its own empty list, Projet works without one) */
const NO_TRACK_HINT_TABS: readonly ShellTab[] = ['carte', 'survol', 'habillage']

const PREFS_KEY = 'openflyover.shell.v1'

function loadPrefs() {
  try {
    return parseShellPrefs(getPlatform().storage.get(PREFS_KEY))
  } catch {
    return parseShellPrefs(null)
  }
}

const isNarrow = () => window.innerWidth < ONE_SIDE_MAX_WIDTH
/** below this width the panel is a drawer over the view (shell.css): it starts closed and closes on Escape or outside */
const DRAWER_MAX_WIDTH = 1024
const isDrawer = () => window.innerWidth < DRAWER_MAX_WIDTH
// a batch keeps the shell locked between its jobs too (the export store is idle for a moment between two)
const isExporting = () => isExportBusy(useExportStore.getState().phase) || useBatchStore.getState().phase === 'running'
/** a modal dialog (help, sources) is open: it takes the keyboard, Escape closes it */
const isDialogOpen = () => document.querySelector('dialog[open]') !== null

/** Escape is left to an open menu inside this element (it closes itself first). */
const handlesOwnEscape = (target: EventTarget | null) => target instanceof Element && target.closest('[data-local-escape]') !== null

/**
 * ← / → (Shift: 5 s), Home and End move the playhead in film time; S / T add a stop at the marker / a text at the
 * playhead. Its own component: the film clock changes with the settings and must not re-render the shell. Listens in
 * the bubble phase, after a timeline block that moves with the arrows (it prevents the default).
 */
function SeekShortcuts() {
  const clock = useFilmClock()
  const clockRef = useRef(clock)
  useEffect(() => {
    clockRef.current = clock
  }, [clock])

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing || e.defaultPrevented || isDialogOpen()) return
      const action = matchShortcut(e, keyFocus(e.target))
      const store = useAppStore.getState()
      if (!action || store.tracks.length === 0 || isExporting()) return
      const c = clockRef.current
      const total = c.totalTime()
      const playhead = Math.min(store.playback.timeS ?? c.timeAtProgress(store.playback.progress), total)
      if (action === 'add-stop' || action === 'add-text') {
        e.preventDefault()
        if (e.repeat) return
        if (action === 'add-stop') editFilm((f) => addStop(f, Math.round(store.playback.progress * store.tracks[0].stats.distanceM)), { stops: true })
        else editFilm((f) => addText(f, playhead))
        return
      }
      const t = seekTime(action, playhead, total)
      if (t === null) return
      e.preventDefault()
      store.setProgress(c.progressAtTime(t), t < total ? t : null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return null
}

export default function App() {
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  const planning = useAppStore((s) => s.planArea !== null)
  const exportBusy = useExportStore((s) => isExportBusy(s.phase))
  const batchRunning = useBatchStore((s) => s.phase === 'running')
  const exporting = exportBusy || batchRunning
  const selected = useAppStore((s) => s.filmSelection !== null && s.tracks.length > 0)
  const [shell, dispatch] = useReducer(shellReducer, undefined, () => ({
    ...loadPrefs(),
    ...(isDrawer() && { collapsed: true }),
    dockOpen: false,
    collapsedByDock: false,
    inspecting: false,
  }))
  const [dragging, setDragging] = useState(false)
  const helpDialog = useRef<HTMLDialogElement>(null)
  const dockOpen = useRef(shell.dockOpen)
  const collapsedRef = useRef(shell.collapsed)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // desktop: a batch asked on the command line runs once the app is up, then the app quits (export/cliRender.ts)
  useEffect(() => {
    if (getPlatform().capabilities.isDesktop) void import('./export/cliRender').then((m) => m.runCliRenderIfAsked())
  }, [])

  // remember the tab and the folded panel chosen by the user (not a fold caused by the export drawer)
  const keptCollapsed = shell.collapsed && !shell.collapsedByDock
  useEffect(() => {
    // the drawer of a narrow window opens and closes on its own: only the tab is worth keeping then
    if (isDrawer()) return
    try {
      getPlatform().storage.set(PREFS_KEY, JSON.stringify({ tab: shell.tab, collapsed: keptCollapsed }))
    } catch {
      // storage unavailable: the choice lasts for the session
    }
  }, [shell.tab, keptCollapsed])

  useEffect(() => {
    dockOpen.current = shell.dockOpen
  }, [shell.dockOpen])

  useEffect(() => {
    collapsedRef.current = shell.collapsed
    if (shell.collapsed) return
    // drawer mode: a press outside the panel and its rail closes it
    const onPointerDown = (e: PointerEvent) => {
      if (!isDrawer() || !(e.target instanceof Element)) return
      if (e.target.closest('#side-panel, .rail')) return
      dispatch({ type: 'toggle-panel', narrow: true })
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [shell.collapsed])

  // no undo during an export: the film being rendered would change under it
  useEffect(() => installHistoryShortcuts(getSettingsHistory(), window, () => !isExporting()), [])
  useEffect(() => installSliderGestures(getSettingsHistory()), [])
  useEffect(() => installLibraryAutosave(() => !isExporting()), [])
  useEffect(() => installCloseGuard(isExporting, saveProject), [])

  /** a pointer button is down */
  const pressed = useRef(false)
  useEffect(() => {
    const down = () => {
      pressed.current = true
    }
    const up = () => {
      pressed.current = false
    }
    // a release outside the window is not seen: the next move tells
    const move = (e: PointerEvent) => {
      pressed.current = e.buttons !== 0
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('pointermove', move, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('pointermove', move, true)
    }
  }, [])

  // a timeline block selected: its inspector in the dock, after the release of a press (the timeline must not change
  // scale under a drag); the dock given back to the panel (narrow window): deselected
  useEffect(() => {
    const show = () => {
      window.removeEventListener('pointerup', show)
      window.removeEventListener('pointercancel', show)
      dispatch({ type: 'inspect', open: selected, narrow: isNarrow() })
    }
    if (!selected || !pressed.current) {
      show()
      return
    }
    window.addEventListener('pointerup', show)
    window.addEventListener('pointercancel', show)
    return () => {
      window.removeEventListener('pointerup', show)
      window.removeEventListener('pointercancel', show)
    }
  }, [selected])
  useEffect(() => {
    if (!shell.inspecting) useAppStore.getState().setFilmSelection(null)
  }, [shell.inspecting])

  useEffect(() => {
    // capture phase: Escape closes the export drawer, else deselects the timeline block (the dialogs close themselves)
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing || isDialogOpen()) return
      const action = matchShortcut(e, keyFocus(e.target))
      if (!action || action.startsWith('seek') || action.startsWith('add-')) return
      if (action === 'close') {
        if (handlesOwnEscape(e.target)) return
        const store = useAppStore.getState()
        if (dockOpen.current && !isExporting()) dispatch({ type: 'close-dock' })
        else if (store.filmSelection !== null) store.setFilmSelection(null)
        else if (isDrawer() && !collapsedRef.current) dispatch({ type: 'toggle-panel', narrow: true })
        else return
        e.stopPropagation()
      } else if (action === 'help') {
        helpDialog.current?.showModal()
      } else if (action === 'save') {
        if (!isExporting()) saveProject()
      }
      else if (action === 'open') {
        if (!isExporting()) void chooseFilesToOpen()
      } else if (action === 'export') {
        if (!isExporting()) dispatch({ type: 'toggle-dock', narrow: isNarrow() })
      } else if (action === 'fit') {
        if (e.repeat || isExporting() || useAppStore.getState().tracks.length === 0) return
        useAppStore.getState().requestFit()
      } else if (action === 'safe-zones') {
        if (!e.repeat) useSafeZonesStore.getState().toggle()
      } else if (action === 'toggle-panel') {
        if (e.repeat || isExporting()) return
        dispatch({ type: 'toggle-panel', narrow: isNarrow() })
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // files dropped anywhere: tracks imported, a project opened; the timeline keeps its own drop (photos)
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e.dataTransfer?.types)) return
      if (e.defaultPrevented) {
        setDragging(false)
        return
      }
      // without this, the browser would open the dropped file in place of the app
      e.preventDefault()
      const accepted = !isExporting()
      if (e.dataTransfer) e.dataTransfer.dropEffect = accepted ? 'copy' : 'none'
      setDragging(accepted)
    }
    const onDragLeave = (e: DragEvent) => {
      // the pointer left the window
      if (!e.relatedTarget) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      setDragging(false)
      if (e.defaultPrevented || !isFileDrag(e.dataTransfer?.types)) return
      e.preventDefault()
      const files = getPlatform().droppedFiles(e.dataTransfer)
      if (files.length > 0 && !isExporting()) void openFiles(files)
    }
    const stop = () => setDragging(false)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', stop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', stop)
    }
  }, [])

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTabIndex(index, e.key, SHELL_TABS.length)
    if (next === null) return
    e.preventDefault()
    dispatch({ type: 'select-tab', tab: SHELL_TABS[next], narrow: isNarrow() })
    tabRefs.current[next]?.focus()
  }

  const panel = (tab: ShellTab, children: ReactNode) => (
    <div key={tab} id={`tab-panel-${tab}`} className="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} hidden={shell.tab !== tab}>
      {!hasTracks && NO_TRACK_HINT_TABS.includes(tab) && <p className="tab-hint">Ajoutez une trace (onglet Trace) pour voir l’effet de ces réglages.</p>}
      {children}
    </div>
  )

  return (
    <div className="shell">
      <TopBar
        onOpen={() => void chooseFilesToOpen()}
        exportOpen={shell.dockOpen}
        onToggleExport={() => dispatch({ type: 'toggle-dock', narrow: isNarrow() })}
        onHelp={() => helpDialog.current?.showModal()}
      />

      <div className={shell.collapsed ? 'shell__body shell__body--collapsed' : 'shell__body'}>
        <nav className="rail" aria-label="Panneaux">
          <div className="rail__tabs" role="tablist" aria-label="Panneaux de réglages" aria-orientation="vertical">
            {SHELL_TABS.map((tab, i) => {
              const selected = shell.tab === tab
              return (
                <button
                  key={tab}
                  ref={(el) => {
                    tabRefs.current[i] = el
                  }}
                  id={`tab-${tab}`}
                  type="button"
                  role="tab"
                  className="rail__tab"
                  aria-selected={selected}
                  aria-controls={`tab-panel-${tab}`}
                  tabIndex={selected ? 0 : -1}
                  disabled={exporting}
                  data-tip={TAB_LABELS[tab].label}
                  data-tip-side="right"
                  onClick={() => dispatch({ type: 'click-tab', tab, narrow: isNarrow() })}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                >
                  <Icon name={TAB_LABELS[tab].icon} size={22} />
                  <span className="rail__label">{TAB_LABELS[tab].label}</span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className="rail__toggle"
            onClick={() => dispatch({ type: 'toggle-panel', narrow: isNarrow() })}
            disabled={exporting}
            aria-expanded={!shell.collapsed}
            aria-controls="side-panel"
            aria-label={shell.collapsed ? 'Déplier le panneau' : 'Replier le panneau'}
            data-tip={withShortcut(shell.collapsed ? 'Déplier le panneau' : 'Replier le panneau', 'toggle-panel')}
            data-tip-side="right"
          >
            <Icon name={shell.collapsed ? 'panel-left-open' : 'panel-left-close'} />
          </button>
        </nav>

        {/* every tab stays mounted: weather, landmarks and export have side effects */}
        {/* no change to the tracks or the settings while a film is being made: the export reads them live */}
        <aside id="side-panel" className="panel" aria-label="Réglages" hidden={shell.collapsed} inert={exporting}>
          {panel(
            'trace',
            <>
              <TrackList />
              <RoutePanel />
              <PanelSection title="Montées et étiquettes" keys={['labels']} hidden={!hasTracks}>
                <ClimbList />
              </PanelSection>
              <PanelSection title="Feuille de route" hidden={!hasTracks}>
                <RoadbookPanel />
              </PanelSection>
              <PanelSection title="Météo de la sortie" keys={['weather']} hidden={!hasTracks}>
                <WeatherPanel />
              </PanelSection>
              <PanelSection title="Hors ligne" hidden={!hasTracks}>
                <Suspense>
                  <OfflinePanel />
                </Suspense>
              </PanelSection>
            </>,
          )}
          {panel(
            'carte',
            <>
              <SettingsPanel />
              <LandmarkPanel />
              <PoiPanel />
            </>,
          )}
          {panel('survol', <CameraPanel />)}
          {panel('habillage', <OverlayPanel />)}
          {panel('projet', <ProjectPanel />)}
        </aside>

        <main className="view">
          <Stage>
            {!hasTracks && !planning && <EmptyState />}
            <Toaster />
          </Stage>
          <Timeline />
        </main>

        <aside id="export-dock" className="dock" aria-label="Export" hidden={!shell.dockOpen}>
          <Suspense fallback={<p className="field__hint">Chargement…</p>}>
            <ExportPanel onClose={exporting ? undefined : () => dispatch({ type: 'close-dock' })} />
          </Suspense>
        </aside>
        {/* the export drawer goes first */}
        <aside className="dock" aria-label="Inspecteur" hidden={shell.dockOpen || !shell.inspecting} inert={exporting}>
          {shell.inspecting && !shell.dockOpen && <FilmInspector />}
        </aside>
      </div>

      <StatusBar />
      <HelpDialog dialogRef={helpDialog} />
      <SeekShortcuts />
      {dragging && (
        <div className="drop-veil" aria-hidden="true">
          <div className="drop-veil__box">
            <Icon name="upload" size={32} />
            <p className="drop-veil__title">Déposez vos traces GPX ou FIT</p>
            <p className="drop-veil__hint">ou un projet .json</p>
          </div>
        </div>
      )}
    </div>
  )
}

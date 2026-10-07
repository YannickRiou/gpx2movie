import { useEffect, useReducer, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { isExportBusy, useExportStore } from './export/store'
import { getSettingsHistory, installHistoryShortcuts, isTextEntry } from './project/history'
import { useAppStore } from './state/store'
import type { Settings } from './state/store'
import { CameraPanel } from './ui/CameraPanel'
import { ClimbList } from './ui/ClimbList'
import { ExportPanel } from './ui/ExportPanel'
import { Icon } from './ui/icons'
import type { IconName } from './ui/icons'
import { ImportPanel } from './ui/ImportPanel'
import { LandmarkPanel } from './ui/LandmarkPanel'
import { ModifiedMarker } from './ui/ModifiedMarker'
import { OverlayPanel } from './ui/OverlayPanel'
import { importTrackFiles, openProject, saveProject } from './ui/projectActions'
import type { ProjectMessage } from './ui/projectActions'
import { ProjectPanel } from './ui/ProjectPanel'
import { SettingsPanel } from './ui/SettingsPanel'
import { ONE_SIDE_MAX_WIDTH, SHELL_TABS, nextTabIndex, parseShellPrefs, routeOpenedFiles, shellReducer, shellShortcut } from './ui/shell'
import type { ShellTab } from './ui/shell'
import { Stage } from './ui/Stage'
import { StatusBar } from './ui/StatusBar'
import { Timeline } from './ui/Timeline'
import { TopBar } from './ui/TopBar'
import { TrackList } from './ui/TrackList'
import { WeatherPanel } from './ui/WeatherPanel'
import './ui/app.css'
import './ui/shell.css'

const TAB_LABELS: Record<ShellTab, { label: string; icon: IconName }> = {
  trace: { label: 'Trace', icon: 'route' },
  carte: { label: 'Carte', icon: 'map' },
  survol: { label: 'Survol', icon: 'video' },
  habillage: { label: 'Habillage', icon: 'layers' },
  projet: { label: 'Projet', icon: 'folder' },
}

const PREFS_KEY = 'openflyover.shell.v1'

function loadPrefs() {
  try {
    return parseShellPrefs(localStorage.getItem(PREFS_KEY))
  } catch {
    return parseShellPrefs(null)
  }
}

const isNarrow = () => window.innerWidth < ONE_SIDE_MAX_WIDTH
const isExporting = () => isExportBusy(useExportStore.getState().phase)

/** Foldable section of a tab (still mounted when folded: the weather panel syncs the weather store). */
function Fold({ title, keys, hidden, children }: { title: string; keys?: (keyof Settings)[]; hidden: boolean; children: ReactNode }) {
  return (
    <details className="fold" open hidden={hidden}>
      <summary className="fold__summary">
        <h2 className="section-title fold__title">{title}</h2>
        {/* the marker's button must not fold the section */}
        {keys && (
          <span className="fold__marker" onClick={(e) => e.preventDefault()}>
            <ModifiedMarker keys={keys} label={title} />
          </span>
        )}
        <Icon name="chevron-down" size={16} />
      </summary>
      {children}
    </details>
  )
}

export default function App() {
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  const importError = useAppStore((s) => s.importError)
  const exporting = useExportStore((s) => isExportBusy(s.phase))
  const [shell, dispatch] = useReducer(shellReducer, undefined, () => ({ ...loadPrefs(), dockOpen: false, collapsedByDock: false }))
  const [message, setMessage] = useState<ProjectMessage | null>(null)
  const openInput = useRef<HTMLInputElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // remember the tab and the folded panel chosen by the user (not a fold caused by the export drawer)
  const keptCollapsed = shell.collapsed && !shell.collapsedByDock
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ tab: shell.tab, collapsed: keptCollapsed }))
    } catch {
      // storage unavailable: the choice lasts for the session
    }
  }, [shell.tab, keptCollapsed])

  useEffect(() => installHistoryShortcuts(getSettingsHistory()), [])

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.isComposing) return
      const typing = isTextEntry(e.target) || e.target instanceof HTMLSelectElement
      const action = shellShortcut(e, typing)
      if (!action) return
      if (action === 'save') saveProject()
      else if (action === 'open') {
        if (!isExporting()) openInput.current?.click()
      } else if (action === 'export') {
        if (!isExporting()) dispatch({ type: 'toggle-dock', narrow: isNarrow() })
      } else if (action === 'fit') {
        if (e.repeat || isExporting() || useAppStore.getState().tracks.length === 0) return
        useAppStore.getState().requestFit()
      } else if (action === 'toggle-panel') {
        if (e.repeat || isExporting()) return
        dispatch({ type: 'toggle-panel', narrow: isNarrow() })
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const openFiles = async (files: File[]) => {
    const { project, tracks, extraProjects } = routeOpenedFiles(files)
    let next: ProjectMessage | null = null
    if (project) next = await openProject(project)
    if (tracks.length > 0) importTrackFiles(tracks)
    if (extraProjects.length > 0 && !next?.error) {
      const ignored = `Un seul projet à la fois : ${extraProjects.map((f) => `« ${f.name} »`).join(', ')} non ouvert(s).`
      next = { text: next ? `${next.text}\n${ignored}` : ignored, error: false }
    }
    setMessage(next)
  }

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTabIndex(index, e.key, SHELL_TABS.length)
    if (next === null) return
    e.preventDefault()
    dispatch({ type: 'select-tab', tab: SHELL_TABS[next], narrow: isNarrow() })
    tabRefs.current[next]?.focus()
  }

  const panel = (tab: ShellTab, children: ReactNode) => (
    <div key={tab} id={`tab-panel-${tab}`} className="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} hidden={shell.tab !== tab}>
      {children}
    </div>
  )

  return (
    <div className="shell">
      <TopBar
        onOpen={() => openInput.current?.click()}
        exportOpen={shell.dockOpen}
        onToggleExport={() => dispatch({ type: 'toggle-dock', narrow: isNarrow() })}
      />
      <input
        ref={openInput}
        className="visually-hidden"
        type="file"
        multiple
        accept=".gpx,.fit,.json,application/json"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void openFiles(Array.from(e.currentTarget.files ?? []))
          e.currentTarget.value = ''
        }}
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
            data-tip={shell.collapsed ? 'Déplier le panneau ([)' : 'Replier le panneau ([)'}
            data-tip-side="right"
          >
            <Icon name={shell.collapsed ? 'panel-left-open' : 'panel-left-close'} />
          </button>
        </nav>

        {/* every tab stays mounted: weather, landmarks and export have side effects */}
        <aside id="side-panel" className="panel" aria-label="Réglages" hidden={shell.collapsed}>
          {panel(
            'trace',
            <>
              <ImportPanel />
              <TrackList />
              <Fold title="Montées" hidden={!hasTracks}>
                <ClimbList />
              </Fold>
              <Fold title="Météo de la sortie" keys={['weather']} hidden={!hasTracks}>
                <WeatherPanel />
              </Fold>
            </>,
          )}
          {panel(
            'carte',
            <>
              <SettingsPanel />
              <LandmarkPanel />
            </>,
          )}
          {panel('survol', <CameraPanel />)}
          {panel('habillage', <OverlayPanel />)}
          {panel('projet', <ProjectPanel />)}
        </aside>

        <main className="view">
          <Stage>
            {(importError || message) && (
              <div className="notices">
                {importError && (
                  <div className="alert" role="alert">
                    <span className="alert__text">{importError}</span>
                    <button
                      type="button"
                      className="alert__close"
                      aria-label="Fermer le message d'erreur"
                      onClick={() => useAppStore.getState().setImportError(null)}
                    >
                      ×
                    </button>
                  </div>
                )}
                {message && (
                  <div className="alert" role={message.error ? 'alert' : 'status'}>
                    <span className="alert__text">{message.text}</span>
                    <button type="button" className="alert__close" aria-label="Fermer le message" onClick={() => setMessage(null)}>
                      ×
                    </button>
                  </div>
                )}
              </div>
            )}
          </Stage>
          <Timeline />
        </main>

        <aside id="export-dock" className="dock" aria-label="Export" hidden={!shell.dockOpen}>
          <ExportPanel onClose={exporting ? undefined : () => dispatch({ type: 'close-dock' })} />
        </aside>
      </div>

      <StatusBar />
    </div>
  )
}

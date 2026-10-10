import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { VIDEO_ASPECTS } from '../export/schedule'
import { useBatchStore } from '../export/batch'
import { isExportBusy, useExportStore } from '../export/store'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'
import { AspectIcon, Icon } from './icons'
import type { IconName } from './icons'
import { saveProject } from './projectActions'
import { effectiveProjectName, isProjectDirty } from './shell'
import { withShortcut } from './shortcuts'

/** Output format of the preview and of the export: « Libre » (preview only) or one of the video aspects. */
function FormatSwitcher({ disabled }: { disabled: boolean }) {
  const aspect = useAppStore((s) => s.settings.video.aspect)
  const free = useAppStore((s) => s.freeFraming)
  const pick = (id: string | null) => {
    const store = useAppStore.getState()
    const next = VIDEO_ASPECTS.find((a) => a.id === id)
    if (next && next.id !== store.settings.video.aspect) store.setSetting('video', { ...store.settings.video, aspect: next.id })
    store.setFreeFraming(!next)
  }

  return (
    <div className="format-switch" role="radiogroup" aria-label="Format de sortie">
      <label className="format-switch__option" data-tip="Libre : la vue remplit l'écran (aperçu)">
        <input type="radio" name="output-format" checked={free} disabled={disabled} onChange={() => pick(null)} />
        <Icon name="maximize" size={18} />
        <span className="visually-hidden">Libre</span>
      </label>
      {VIDEO_ASPECTS.map((a) => (
        <label key={a.id} className="format-switch__option" data-tip={a.label}>
          <input type="radio" name="output-format" checked={!free && aspect === a.id} disabled={disabled} onChange={() => pick(a.id)} />
          <AspectIcon x={a.x} y={a.y} size={18} />
          <span className="visually-hidden">{a.label}</span>
        </label>
      ))}
    </div>
  )
}

interface MoreItem {
  label: string
  icon: IconName
  onClick(): void
  disabled: boolean
}

/** « Plus d'actions » (phone only, shown by shell.css): the actions of the bar that do not fit. */
function MoreMenu({ items }: { items: MoreItem[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  return (
    <div
      ref={ref}
      className="topbar__more"
      data-local-escape=""
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return
        setOpen(false)
        e.stopPropagation()
      }}
    >
      <button type="button" className="icon-btn" aria-label="Plus d'actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="ellipsis" />
      </button>
      {open && (
        <div className="track-menu topbar__menu" role="menu" aria-label="Plus d'actions">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="track-menu__item"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface TopBarProps {
  /** open the file picker (GPX, FIT or project) */
  onOpen(): void
  exportOpen: boolean
  onToggleExport(): void
  /** open the keyboard shortcuts */
  onHelp(): void
}

/**
 * Top bar: logo, project name (edited in place) and save state, undo / redo, open / save, output format,
 * shortcuts (« ? »), « Exporter » (the export drawer; « 42 % · Annuler » while exporting).
 */
export function TopBar({ onOpen, exportOpen, onToggleExport, onHelp }: TopBarProps) {
  const history = getSettingsHistory()
  const { canUndo, canRedo } = useSyncExternalStore(history.subscribe, history.getState)
  const name = useAppStore((s) => s.projectName)
  const placeholder = useAppStore((s) => effectiveProjectName('', s.tracks[0]?.name))
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  const dirty = useAppStore((s) => isProjectDirty({ settings: s.settings, tracks: s.tracks, name: s.projectName }, s.savedProject))
  const phase = useExportStore((s) => s.phase)
  const percent = useExportStore((s) => (s.frameCount > 0 ? Math.round((s.frame / s.frameCount) * 100) : 0))
  // a batch is busy between two films too (the export store is idle then)
  const batchRunning = useBatchStore((s) => s.phase === 'running')
  const busy = isExportBusy(phase) || batchRunning

  return (
    <header className="topbar">
      <div className="topbar__start">
        <img className="topbar__logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={28} height={28} title="OpenFlyover" />
        <h1 className="visually-hidden">OpenFlyover</h1>
        <input
          className="topbar__name"
          type="text"
          value={name}
          placeholder={placeholder}
          maxLength={120}
          aria-label="Nom du projet"
          title="Nom du projet : cliquez pour le modifier"
          onChange={(e) => useAppStore.getState().setProjectName(e.currentTarget.value)}
        />
        {hasTracks && (
          <span className={dirty ? 'topbar__state topbar__state--dirty' : 'topbar__state'} title={dirty ? 'Modifié depuis le dernier enregistrement (Ctrl+S pour enregistrer)' : 'Aucun changement depuis le dernier enregistrement'}>
            {dirty ? 'Modifié' : 'Enregistré'}
          </span>
        )}
        <span className="topbar__sep" aria-hidden="true" />
        <button type="button" className="icon-btn" onClick={history.undo} disabled={!canUndo || busy} aria-label="Annuler" data-tip={withShortcut('Annuler', 'undo')}>
          <Icon name="undo" />
        </button>
        <button type="button" className="icon-btn" onClick={history.redo} disabled={!canRedo || busy} aria-label="Rétablir" data-tip={withShortcut('Rétablir', 'redo')}>
          <Icon name="redo" />
        </button>
        <button type="button" className="icon-btn icon-btn--label" onClick={onOpen} disabled={busy} data-tip={withShortcut('Ouvrir une trace ou un projet', 'open')}>
          <Icon name="folder-open" />
          <span className="icon-btn__text">Ouvrir</span>
        </button>
        <button type="button" className="icon-btn icon-btn--label" onClick={saveProject} disabled={busy} data-tip={withShortcut('Enregistrer le projet', 'save')}>
          <Icon name="save" />
          <span className="icon-btn__text">Enregistrer</span>
        </button>
      </div>

      <FormatSwitcher disabled={busy} />

      <div className="topbar__end">
        <button type="button" className="icon-btn" onClick={onHelp} aria-label="Raccourcis clavier" data-tip={withShortcut('Raccourcis clavier', 'help')}>
          <Icon name="circle-help" />
        </button>
        <MoreMenu
          items={[
            { label: 'Annuler', icon: 'undo', onClick: history.undo, disabled: !canUndo || busy },
            { label: 'Rétablir', icon: 'redo', onClick: history.redo, disabled: !canRedo || busy },
            { label: 'Ouvrir…', icon: 'folder-open', onClick: onOpen, disabled: busy },
            { label: 'Enregistrer', icon: 'save', onClick: saveProject, disabled: busy },
          ]}
        />
        {busy ? (
          <button
            type="button"
            className="btn btn--primary topbar__export"
            // between two films of a batch the export store is idle: the batch takes the cancel
            onClick={() => (batchRunning ? useBatchStore.getState().cancel() : useExportStore.getState().cancel())}
            disabled={phase === 'finalizing'}
            aria-label={phase === 'finalizing' ? 'Finalisation du fichier' : `Annuler l'export (${percent} %)`}
          >
            {phase === 'finalizing' ? 'Finalisation…' : `${percent} % · Annuler`}
          </button>
        ) : (
          // nothing to export before the first track
          hasTracks && (
            <button
              type="button"
              className="btn btn--primary topbar__export"
              onClick={onToggleExport}
              aria-expanded={exportOpen}
              aria-controls="export-dock"
              data-tip={withShortcut('Exporter une vidéo ou une image', 'export')}
            >
              <Icon name="download" size={18} />
              <span className="icon-btn__text">Exporter</span>
            </button>
          )
        )}
      </div>
    </header>
  )
}

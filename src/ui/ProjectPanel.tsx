import { useEffect, useId, useState } from 'react'
import { getPlatform } from '../platform'
import type { ProjectEntry } from '../platform'
import { applySettings } from '../project/apply'
import { getSettingsHistory } from '../project/history'
import { getPresetStore, normalizePresetName, presetSettings } from '../project/presets'
import { useAppStore } from '../state/store'
import { deleteEntry, formatProjectSize, keepOpenProject, libraryFile, refreshLibrary, renameEntry, useLibraryStore } from './library'
import { openProject } from './projectActions'
import { showToast } from './toast'

/** "Projet" tab: « Mes projets », then the presets of the settings (save, open and undo / redo live in the top bar). */
export function ProjectPanel() {
  return (
    <>
      <LibrarySection />
      <PresetSection />
    </>
  )
}

/** « Mes projets »: the projects kept by the app, most recent first; the open one is highlighted and saved automatically. */
function LibrarySection() {
  const platform = getPlatform()
  const entries = useLibraryStore((s) => s.entries)
  const currentId = useLibraryStore((s) => s.currentId)
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  /** entry being renamed, with the name typed so far */
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  /** entry whose « Supprimer » waits for its confirmation */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const id = useId()

  useEffect(() => {
    void refreshLibrary()
  }, [])

  const open = async (entry: ProjectEntry) => {
    const file = await libraryFile(entry)
    if (file) await openProject(file, entry)
  }

  const rename = async () => {
    const entry = entries.find((e) => e.id === renaming?.id)
    if (!entry || !renaming) return
    await renameEntry(entry, renaming.name)
    setRenaming(null)
  }

  return (
    <section className="settings project" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        Mes projets
      </h2>

      {!platform.projectLibrary ? (
        <p className="tracks__empty">Ce navigateur ne peut pas garder de projets (page non sécurisée, sans HTTPS).</p>
      ) : (
        <>
          <p className="field__hint">
            Gardés {platform.capabilities.isDesktop ? 'sur cet ordinateur' : 'dans ce navigateur'}, enregistrés automatiquement à
            chaque changement.
          </p>
          {currentId === null ? (
            <button type="button" className="btn btn--secondary" onClick={() => void keepOpenProject()} disabled={!hasTracks}>
              Garder dans Mes projets
            </button>
          ) : (
            <p className="field__hint">Le projet ouvert est gardé dans Mes projets.</p>
          )}

          {entries.length === 0 ? (
            <p className="tracks__empty">Aucun projet gardé pour l’instant.</p>
          ) : (
            <ul className="library">
              {entries.map((entry) => {
                const current = entry.id === currentId
                return (
                  <li key={entry.id} className={current ? 'library__item library__item--current' : 'library__item'} aria-current={current || undefined}>
                    {renaming?.id === entry.id ? (
                      <form
                        className="project__row"
                        onSubmit={(e) => {
                          e.preventDefault()
                          void rename()
                        }}
                      >
                        <input
                          className="input"
                          type="text"
                          aria-label="Nouveau nom du projet"
                          value={renaming.name}
                          maxLength={120}
                          autoFocus
                          onChange={(e) => setRenaming({ id: entry.id, name: e.currentTarget.value })}
                          onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                        />
                        <button type="submit" className="btn btn--secondary" disabled={!renaming.name.trim()}>
                          Renommer
                        </button>
                      </form>
                    ) : (
                      <span className="library__name">
                        {entry.name}
                        {current && <span className="library__badge">ouvert</span>}
                      </span>
                    )}
                    <span className="field__hint">{entry.summary}</span>
                    <span className="field__hint">
                      {new Date(entry.updatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
                      {formatProjectSize(entry.sizeBytes)}
                    </span>
                    {confirmingId === entry.id ? (
                      <div className="project__row">
                        <button
                          type="button"
                          className="btn btn--secondary"
                          onClick={() => {
                            setConfirmingId(null)
                            void deleteEntry(entry)
                          }}
                        >
                          Supprimer définitivement
                        </button>
                        <button type="button" className="btn btn--secondary" onClick={() => setConfirmingId(null)}>
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <div className="project__row">
                        <button type="button" className="btn btn--secondary" onClick={() => void open(entry)} disabled={current}>
                          Ouvrir
                        </button>
                        <button type="button" className="btn btn--secondary" onClick={() => setRenaming({ id: entry.id, name: entry.name })}>
                          Renommer
                        </button>
                        <button type="button" className="btn btn--secondary" onClick={() => setConfirmingId(entry.id)}>
                          Supprimer
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

/** Presets of the settings. */
function PresetSection() {
  const history = getSettingsHistory()
  const presetStore = getPresetStore()
  const [presets, setPresets] = useState(() => presetStore.list())
  const [selectedPreset, setSelectedPreset] = useState('')
  const [presetName, setPresetName] = useState('')
  const id = useId()

  const selected = presets.find((p) => p.name === selectedPreset)

  const applyPreset = () => {
    if (!selected) return
    history.transaction(() => applySettings(presetSettings(selected, useAppStore.getState().settings)))
    showToast({ kind: 'success', text: `Préréglage appliqué : ${selected.name}` })
  }

  const savePreset = () => {
    try {
      const stored = presetStore.save(presetName, useAppStore.getState().settings)
      const name = normalizePresetName(presetName)
      setPresets(presetStore.list())
      setSelectedPreset(name)
      setPresetName('')
      showToast(
        stored
          ? { kind: 'success', text: `Préréglage « ${name} » enregistré` }
          : { kind: 'error', text: 'Préréglage non enregistré : stockage du navigateur plein. Il reste utilisable jusqu’à la fermeture de la page.' },
      )
    } catch (err) {
      showToast({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  const deletePreset = () => {
    if (!selected) return
    presetStore.remove(selected.name)
    setPresets(presetStore.list())
    setSelectedPreset('')
  }

  return (
    <section className="settings project" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        Préréglages
      </h2>

      <p className="field__hint">Tous les réglages, sans traces, arrêts, textes ni photos. Gardés dans ce navigateur.</p>

      {presets.length === 0 ? (
        <p className="tracks__empty">Aucun préréglage. Donnez un nom ci-dessous pour garder les réglages actuels.</p>
      ) : (
        <>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-preset`}>
              Préréglage
            </label>
            <select id={`${id}-preset`} className="select" value={selectedPreset} onChange={(e) => setSelectedPreset(e.currentTarget.value)}>
              <option value="">Choisir…</option>
              {presets.map((preset) => (
                <option key={preset.name} value={preset.name}>
                  {preset.name}
                </option>
              ))}
            </select>
          </div>
          <div className="project__row">
            <button type="button" className="btn btn--secondary" onClick={applyPreset} disabled={!selected}>
              Appliquer
            </button>
            <button type="button" className="btn btn--secondary" onClick={deletePreset} disabled={!selected}>
              Supprimer
            </button>
          </div>
        </>
      )}

      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault()
          savePreset()
        }}
      >
        <label className="field__label" htmlFor={`${id}-preset-name`}>
          Nouveau préréglage
        </label>
        <div className="project__row">
          <input
            id={`${id}-preset-name`}
            className="input"
            type="text"
            value={presetName}
            placeholder="Nom du préréglage"
            maxLength={60}
            onChange={(e) => setPresetName(e.currentTarget.value)}
          />
          <button type="submit" className="btn btn--secondary" disabled={!presetName.trim()}>
            Enregistrer
          </button>
        </div>
      </form>

      <p className="field__hint">Ouvrir et enregistrer le projet : barre du haut (Ctrl+O, Ctrl+S).</p>
    </section>
  )
}

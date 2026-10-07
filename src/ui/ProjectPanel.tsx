import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent } from 'react'
import { applyProject, applySettings } from '../project/apply'
import { DEFAULT_PROJECT_NAME, parseProject, projectFileName, serializeProject } from '../project/document'
import { getSettingsHistory, installHistoryShortcuts } from '../project/history'
import { getPresetStore, normalizePresetName, presetSettings } from '../project/presets'
import { useAppStore } from '../state/store'

interface Message {
  text: string
  error: boolean
}

/** Start a download of `text` as `fileName` (object URL released once the click has been handled). */
function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** "Projet" section: name, save / open the project file, undo / redo of the settings, presets. */
export function ProjectPanel() {
  const firstTrackName = useAppStore((s) => s.tracks[0]?.name)
  const history = getSettingsHistory()
  const { canUndo, canRedo } = useSyncExternalStore(history.subscribe, history.getState)
  const presetStore = getPresetStore()
  const [presets, setPresets] = useState(() => presetStore.list())
  const [selectedPreset, setSelectedPreset] = useState('')
  const [presetName, setPresetName] = useState('')
  const [name, setName] = useState('')
  const [message, setMessage] = useState<Message | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const id = useId()

  useEffect(() => installHistoryShortcuts(history), [history])

  const effectiveName = name.trim() || firstTrackName || DEFAULT_PROJECT_NAME
  const selected = presets.find((p) => p.name === selectedPreset)

  const save = () => {
    downloadText(serializeProject(useAppStore.getState(), effectiveName), projectFileName(effectiveName))
    setMessage(null)
  }

  const open = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      const project = parseProject(await file.text())
      applyProject(project)
      history.clear()
      setName(project.name)
      setMessage(project.warnings.length > 0 ? { text: project.warnings.join('\n'), error: false } : null)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      setMessage({ text: `Impossible d'ouvrir « ${file.name} » : ${reason}`, error: true })
    }
  }

  const applyPreset = () => {
    if (!selected) return
    history.transaction(() => applySettings(presetSettings(selected, useAppStore.getState().settings)))
  }

  const savePreset = () => {
    try {
      presetStore.save(presetName, useAppStore.getState().settings)
      setPresets(presetStore.list())
      setSelectedPreset(normalizePresetName(presetName))
      setPresetName('')
      setMessage(null)
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true })
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
        Projet
      </h2>

      <div className="field">
        <label className="field__label" htmlFor={`${id}-name`}>
          Nom du projet
        </label>
        <input
          id={`${id}-name`}
          className="input"
          type="text"
          value={name}
          placeholder={effectiveName}
          maxLength={120}
          onChange={(e) => setName(e.currentTarget.value)}
        />
      </div>

      <button type="button" className="btn btn--secondary btn--block" onClick={save}>
        Enregistrer le projet
      </button>
      <button type="button" className="btn btn--secondary btn--block" onClick={() => fileInput.current?.click()}>
        Ouvrir un projet
      </button>
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".json,application/json"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void open(e)}
      />

      <div className="project__row" role="group" aria-label="Historique des réglages">
        <button type="button" className="btn btn--secondary" onClick={history.undo} disabled={!canUndo} title="Annuler (Ctrl+Z)">
          Annuler
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={history.redo}
          disabled={!canRedo}
          title="Rétablir (Ctrl+Maj+Z ou Ctrl+Y)"
        >
          Rétablir
        </button>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={`${id}-preset`}>
          Préréglages
        </label>
        <select
          id={`${id}-preset`}
          className="select"
          value={selectedPreset}
          onChange={(e) => setSelectedPreset(e.currentTarget.value)}
          disabled={presets.length === 0}
        >
          <option value="">{presets.length === 0 ? 'Aucun préréglage' : 'Choisir un préréglage…'}</option>
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

      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault()
          savePreset()
        }}
      >
        <label className="field__label" htmlFor={`${id}-preset-name`}>
          Enregistrer les réglages actuels sous…
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

      {message && (
        <div className="alert" role={message.error ? 'alert' : 'status'}>
          <span className="alert__text">{message.text}</span>
          <button type="button" className="alert__close" aria-label="Fermer le message" onClick={() => setMessage(null)}>
            ×
          </button>
        </div>
      )}
    </section>
  )
}

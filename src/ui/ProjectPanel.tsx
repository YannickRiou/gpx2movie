import { useId, useState } from 'react'
import { applySettings } from '../project/apply'
import { getSettingsHistory } from '../project/history'
import { getPresetStore, normalizePresetName, presetSettings } from '../project/presets'
import { useAppStore } from '../state/store'
import { showToast } from './toast'

/** "Projet" tab: presets of the settings (save, open and undo / redo live in the top bar). */
export function ProjectPanel() {
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
      presetStore.save(presetName, useAppStore.getState().settings)
      const name = normalizePresetName(presetName)
      setPresets(presetStore.list())
      setSelectedPreset(name)
      setPresetName('')
      showToast({ kind: 'success', text: `Préréglage « ${name} » enregistré` })
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

      <div className="field">
        <label className="field__label" htmlFor={`${id}-preset`}>
          Préréglage
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
    </section>
  )
}

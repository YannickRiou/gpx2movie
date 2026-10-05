import { useId } from 'react'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { IMAGERY_SOURCES, TERRAIN_SOURCES } from '../terrain/sources'
import { formatNumber } from './format'

const ZOOM_OFFSETS: { value: Settings['imageryZoomOffset']; label: string }[] = [
  { value: 0, label: 'Normal' },
  { value: 1, label: 'Fin' },
  { value: 2, label: 'Très fin' },
]

const EXAGGERATION_MIN = 1
const EXAGGERATION_MAX = 2.5
const EXAGGERATION_STEP = 0.1

/** "Réglages" section: terrain / imagery sources, imagery detail, exaggeration, wireframe. */
export function SettingsPanel() {
  const settings = useAppStore((s) => s.settings)
  const setSetting = useAppStore((s) => s.setSetting)
  const id = useId()
  const terrainId = `${id}-terrain`
  const imageryId = `${id}-imagery`
  const exaggerationId = `${id}-exaggeration`
  const wireframeId = `${id}-wireframe`

  return (
    <section className="settings" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        Réglages
      </h2>

      <div className="field">
        <label className="field__label" htmlFor={terrainId}>
          Relief
        </label>
        <select
          id={terrainId}
          className="select"
          value={settings.terrainSourceId}
          onChange={(e) => setSetting('terrainSourceId', e.currentTarget.value)}
        >
          {TERRAIN_SOURCES.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={imageryId}>
          Imagerie
        </label>
        <select
          id={imageryId}
          className="select"
          value={settings.imagerySourceId}
          onChange={(e) => setSetting('imagerySourceId', e.currentTarget.value)}
        >
          {IMAGERY_SOURCES.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="field fieldset">
        <legend className="field__label">Détail imagerie</legend>
        <div className="segmented">
          {ZOOM_OFFSETS.map((option) => (
            <label key={option.value} className="segmented__option">
              <input
                type="radio"
                name={`${id}-zoom-offset`}
                value={option.value}
                checked={settings.imageryZoomOffset === option.value}
                onChange={() => setSetting('imageryZoomOffset', option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor={exaggerationId}>
          Exagération du relief
        </label>
        <div className="range-row">
          <input
            id={exaggerationId}
            className="range"
            type="range"
            min={EXAGGERATION_MIN}
            max={EXAGGERATION_MAX}
            step={EXAGGERATION_STEP}
            value={settings.exaggeration}
            onChange={(e) => setSetting('exaggeration', Number(e.currentTarget.value))}
          />
          <output className="range-row__value" htmlFor={exaggerationId}>
            ×{formatNumber(settings.exaggeration, 1)}
          </output>
        </div>
      </div>

      <label className="checkbox" htmlFor={wireframeId}>
        <input
          id={wireframeId}
          type="checkbox"
          checked={settings.wireframe}
          onChange={(e) => setSetting('wireframe', e.currentTarget.checked)}
        />
        Filaire
      </label>
    </section>
  )
}

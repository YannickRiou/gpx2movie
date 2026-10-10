import { useId } from 'react'
import { getSettingsHistory } from '../project/history'
import { GRADING_PRESETS, GRADING_RANGES, gradingOfPreset, withGradingValue } from '../scene/grading'
import type { GradingValues } from '../scene/grading'
import { useAppStore } from '../state/store'
import { InfoTip, PanelSection, SettingRow } from './PanelSection'
import { formatNumber } from './format'

const SLIDERS: { key: keyof GradingValues; label: string; tip?: string }[] = [
  { key: 'contrast', label: 'Contraste' },
  { key: 'saturation', label: 'Saturation', tip: 'Tout à gauche : noir et blanc.' },
  { key: 'warmth', label: 'Température', tip: 'Vers la gauche plus froid (bleu), vers la droite plus chaud (orangé).' },
  { key: 'vignette', label: 'Vignettage', tip: 'Assombrit les coins de l’image.' },
]

/** −0.25 -> "−25", 0.3 -> "+30", 0 -> "0" */
function formatSigned(v: number): string {
  const percent = Math.round(v * 100)
  return `${percent > 0 ? '+' : percent < 0 ? '−' : ''}${formatNumber(Math.abs(percent))}`
}

/**
 * « Couleurs » (section of the Lumière tab): colour grading of the image, preview and export alike. Preset chips
 * first (one undo step each), then the four sliders, one row each (name and value, slider on demand).
 */
export function GradingPanel() {
  const id = useId()
  const grading = useAppStore((s) => s.settings.grading)
  const setSetting = useAppStore((s) => s.setSetting)

  return (
    <PanelSection title="Couleurs" keys={['grading']}>
      <div className="field">
        <span id={`${id}-presets`} className="field__label">
          Étalonnage
        </span>
        <div className="sun-chips" role="group" aria-labelledby={`${id}-presets`}>
          {GRADING_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="sun-chip"
              aria-pressed={grading.preset === preset.id}
              onClick={() => getSettingsHistory().transaction(() => setSetting('grading', gradingOfPreset(preset.id)))}
            >
              {preset.label}
            </button>
          ))}
        </div>
        {grading.preset === 'personnalise' && <p className="field__hint">Réglage personnalisé.</p>}
      </div>

      {SLIDERS.map(({ key, label, tip }) => {
        const range = GRADING_RANGES[key]
        const inputId = `${id}-${key}`
        const text = key === 'vignette' ? `${formatNumber(Math.round(grading[key] * 100))} %` : formatSigned(grading[key])
        return (
          <SettingRow key={key} label={label} value={text} paths={[`grading.${key}`]}>
            <div className="field">
              <div className="field__label-row">
                <label className="field__label" htmlFor={inputId}>
                  {label}
                </label>
                {tip && <InfoTip text={tip} />}
              </div>
              <div className="range-row">
                <input
                  id={inputId}
                  className="range"
                  type="range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={grading[key]}
                  onChange={(e) => setSetting('grading', withGradingValue(grading, key, Number(e.currentTarget.value)))}
                  aria-valuetext={text}
                />
                <output className="range-row__value" htmlFor={inputId}>
                  {text}
                </output>
              </div>
            </div>
          </SettingRow>
        )
      })}
    </PanelSection>
  )
}

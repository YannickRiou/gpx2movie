import { LENS_RANGES } from '../scene/lens'
import type { LensSettings } from '../scene/lens'
import { useAppStore } from '../state/store'
import { PanelSection, RangeField, SettingRow } from './PanelSection'
import { formatPercent } from './format'

function formatAmount(value: number): string {
  return value > 0 ? formatPercent(value) : 'Non'
}

/** Always open: the three effects that change every shot. */
const SLIDERS: { key: keyof LensSettings; label: string; tip: string }[] = [
  {
    key: 'shutter',
    label: 'Flou de bougé (obturateur)',
    tip: 'Effet de vitesse : les bords de l’image filent vers la direction du mouvement, le centre reste net, selon la vitesse de la caméra. À l’export, chaque image moyenne aussi 8 rendus pendant l’ouverture de l’obturateur (export plus long).',
  },
  { key: 'bloom', label: 'Halo lumineux', tip: 'Les zones claires rayonnent : soleil, neige, reflets sur l’eau.' },
  { key: 'depthOfField', label: 'Profondeur de champ', tip: 'Net sur le marqueur, de plus en plus flou devant et derrière.' },
]

/** « Objectif » tab (scene/lens.ts): motion blur, bloom and depth of field open; flare and bloom radius as rows. */
export function LensPanel() {
  const lens = useAppStore((s) => s.settings.lens)
  const atmosphere = useAppStore((s) => s.settings.atmosphere)
  const setSetting = useAppStore((s) => s.setSetting)
  const set = (key: keyof LensSettings, value: number) => setSetting('lens', { ...lens, [key]: value })

  return (
    <PanelSection title="Effets d’objectif" keys={['lens']}>
      {SLIDERS.map(({ key, label, tip }) => (
        <RangeField key={key} label={label} tip={tip} {...LENS_RANGES[key]} value={lens[key]} format={formatAmount} onChange={(value) => set(key, value)} />
      ))}
      <SettingRow label="Reflet d’objectif" value={formatAmount(lens.flare)} paths={['lens.flare']}>
        <RangeField
          label="Reflet d’objectif"
          tip="Reflets dans l’objectif quand le soleil est dans l’image. Avec l’atmosphère seulement."
          {...LENS_RANGES.flare}
          value={lens.flare}
          format={formatAmount}
          disabled={!atmosphere}
          onChange={(value) => set('flare', value)}
        />
      </SettingRow>
      <SettingRow label="Rayon du halo" value={formatPercent(lens.bloomRadius)} paths={['lens.bloomRadius']}>
        <RangeField
          label="Rayon du halo"
          {...LENS_RANGES.bloomRadius}
          value={lens.bloomRadius}
          format={formatPercent}
          disabled={lens.bloom === 0}
          onChange={(value) => set('bloomRadius', value)}
        />
      </SettingRow>
    </PanelSection>
  )
}

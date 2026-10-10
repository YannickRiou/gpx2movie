import { useId, useMemo } from 'react'
import { climbsOf } from '../flyover/climbs'
import { KM_MARKER_STEPS, LABEL_RANGE_KM, LABEL_SIZE_RANGE } from '../scene/labelModel'
import { useFilmTrack } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { formatAscent, formatDistance, formatNumber } from './format'
import { RangeField, SettingRow } from './PanelSection'

/** 0 -> "Aucune", 1 -> "Tous les kilomètres", 5 -> "Tous les 5 km" */
const kmStepLabel = (step: number) => (step === 0 ? 'Aucune' : step === 1 ? 'Tous les kilomètres' : `Tous les ${step} km`)

/** « Montées » section: climbs detected on the film track (the first one, or the tracks « À la suite »; click = seek the flyover) and the label toggles. */
export function ClimbList() {
  const track = useFilmTrack()
  const labels = useAppStore((s) => s.settings.labels)
  const setSetting = useAppStore((s) => s.setSetting)
  const setProgress = useAppStore((s) => s.setProgress)
  const climbs = useMemo(() => (track ? climbsOf(track) : []), [track])
  const id = useId()

  if (!track) return null
  const hasElevation = track.stats.maxEle !== undefined
  const lengthM = track.stats.distanceM

  return (
    <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title">
        Montées
      </h2>
      {climbs.length === 0 ? (
        <p className="tracks__empty">
          {hasElevation ? 'Aucune montée sur la première trace.' : "La première trace n'a pas d'altitude : pas de montées."}
        </p>
      ) : (
        <ul className="climbs">
          {climbs.map((climb, i) => (
            <li key={i}>
              <button
                type="button"
                className="climb"
                title="Aller au pied de cette montée"
                onClick={() => setProgress(lengthM > 0 ? climb.startDistM / lengthM : 0)}
              >
                <span className={climb.category === 'HC' ? 'climb__badge climb__badge--hc' : 'climb__badge'}>
                  {climb.category === null ? '–' : climb.category === 'HC' ? 'HC' : `cat. ${climb.category}`}
                </span>
                <span className="climb__name">
                  Montée {i + 1} · sommet {formatNumber(climb.topEleM)} m
                </span>
                <span className="climb__meta">
                  {formatDistance(climb.lengthM)} · D+ {formatAscent(climb.gainM)} · {formatNumber(climb.avgGradient * 100, 1)} %
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <fieldset className="field fieldset climbs__labels">
        <legend className="field__label">Étiquettes dans la vue</legend>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={labels.climbs}
            onChange={(e) => setSetting('labels', { ...labels, climbs: e.currentTarget.checked })}
          />
          Sommets des montées
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={labels.waypoints}
            onChange={(e) => setSetting('labels', { ...labels, waypoints: e.currentTarget.checked })}
          />
          Points nommés du fichier GPX
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={labels.endpoints}
            onChange={(e) => setSetting('labels', { ...labels, endpoints: e.currentTarget.checked })}
          />
          Départ et arrivée
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={labels.photos} onChange={(e) => setSetting('labels', { ...labels, photos: e.currentTarget.checked })} />
          Photos, là où elles ont été prises
        </label>
      </fieldset>
      <SettingRow label="Bornes kilométriques" value={kmStepLabel(labels.kmStep)} paths={['labels.kmStep']}>
        <label className="field">
          <span className="field__label">Bornes kilométriques</span>
          <select
            className="select"
            value={labels.kmStep}
            onChange={(e) => setSetting('labels', { ...labels, kmStep: Number(e.currentTarget.value) })}
          >
            {KM_MARKER_STEPS.map((step) => (
              <option key={step} value={step}>
                {kmStepLabel(step)}
              </option>
            ))}
          </select>
        </label>
      </SettingRow>
      <SettingRow label="Taille des étiquettes" value={`×${formatNumber(labels.size, 1)}`} paths={['labels.size']}>
        <RangeField
          label="Taille"
          {...LABEL_SIZE_RANGE}
          value={labels.size}
          format={(v) => `×${formatNumber(v, 1)}`}
          onChange={(size) => setSetting('labels', { ...labels, size })}
        />
      </SettingRow>
      <SettingRow label="Portée des étiquettes" value={`${formatNumber(labels.rangeKm)} km`} paths={['labels.rangeKm']}>
        <RangeField
          label="Portée"
          {...LABEL_RANGE_KM}
          value={labels.rangeKm}
          format={(v) => `${formatNumber(v)} km`}
          onChange={(rangeKm) => setSetting('labels', { ...labels, rangeKm })}
        />
      </SettingRow>
    </section>
  )
}

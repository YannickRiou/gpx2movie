import { useId, useMemo } from 'react'
import { climbsOf } from '../flyover/climbs'
import { KM_MARKER_STEPS, LABEL_RANGE_KM, LABEL_SIZE_RANGE } from '../scene/labelModel'
import { useAppStore } from '../state/store'
import { formatAscent, formatDistance, formatNumber } from './format'
import { RangeField } from './PanelSection'

/** « Montées » section: climbs detected on the first track (click = seek the flyover) and the label toggles. */
export function ClimbList() {
  const track = useAppStore((s) => s.tracks[0])
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
        <label className="field">
          <span className="field__label">Bornes kilométriques</span>
          <select
            className="select"
            value={labels.kmStep}
            onChange={(e) => setSetting('labels', { ...labels, kmStep: Number(e.currentTarget.value) })}
          >
            {KM_MARKER_STEPS.map((step) => (
              <option key={step} value={step}>
                {step === 0 ? 'Aucune' : step === 1 ? 'Tous les kilomètres' : `Tous les ${step} km`}
              </option>
            ))}
          </select>
        </label>
        <RangeField
          label="Taille"
          {...LABEL_SIZE_RANGE}
          value={labels.size}
          format={(v) => `×${formatNumber(v, 1)}`}
          onChange={(size) => setSetting('labels', { ...labels, size })}
        />
        <RangeField
          label="Portée"
          {...LABEL_RANGE_KM}
          value={labels.rangeKm}
          format={(v) => `${formatNumber(v)} km`}
          onChange={(rangeKm) => setSetting('labels', { ...labels, rangeKm })}
        />
      </fieldset>
    </section>
  )
}

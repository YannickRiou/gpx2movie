import { useId, useMemo } from 'react'
import { climbsOf } from '../flyover/climbs'
import { useAppStore } from '../state/store'
import { formatAscent, formatDistance, formatNumber } from './format'

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
          {hasElevation ? 'Aucune montée détectée sur la première trace.' : "La première trace n'a pas d'altitude enregistrée."}
        </p>
      ) : (
        <ul className="climbs">
          {climbs.map((climb, i) => (
            <li key={i}>
              <button
                type="button"
                className="climb"
                title="Aller au pied de la montée"
                onClick={() => setProgress(lengthM > 0 ? climb.startDistM / lengthM : 0)}
              >
                <span className={climb.category === 'HC' ? 'climb__badge climb__badge--hc' : 'climb__badge'}>
                  {climb.category === null ? '–' : climb.category === 'HC' ? 'HC' : `cat. ${climb.category}`}
                </span>
                <span className="climb__name">
                  Montée {i + 1} · {formatNumber(climb.topEleM)} m
                </span>
                <span className="climb__meta">
                  {formatDistance(climb.lengthM)} · D+ {formatAscent(climb.gainM)} · {formatNumber(climb.avgGradient * 100, 1)} %
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="climbs__labels">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={labels.climbs}
            onChange={(e) => setSetting('labels', { ...labels, climbs: e.currentTarget.checked })}
          />
          Étiquettes des sommets de montée
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={labels.waypoints}
            onChange={(e) => setSetting('labels', { ...labels, waypoints: e.currentTarget.checked })}
          />
          Étiquettes des points du fichier GPX
        </label>
      </div>
    </section>
  )
}

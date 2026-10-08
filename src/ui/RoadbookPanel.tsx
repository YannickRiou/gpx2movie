import { useMemo } from 'react'
import { errorText } from '../core/errors'
import { videoFileName } from '../export/store'
import { buildRoadbook, longestSteepText, passageText, roadbookLandmarks, roadbookSummary, roadbookText } from '../plan/roadbook'
import { useLandmarkStore } from '../osm/store'
import { getPlatform } from '../platform'
import { useAppStore } from '../state/store'
import { formatAscent, formatDuration, formatNumber } from './format'
import { Icon } from './icons'
import { showToast } from './toast'

/**
 * « Feuille de route » (foldable section of the Trace tab): summary, then the key points and steep sections of the
 * first track ordered along it (click = seek the flyover there), « Copier » and « Enregistrer (.txt) ». The OSM
 * landmarks come from the corridor features of the landmark store (fetched while « Repères » is on).
 */
export function RoadbookPanel() {
  const track = useAppStore((s) => s.tracks[0])
  const pois = useAppStore((s) => s.settings.film.pois)
  const landmarksOn = useAppStore((s) => s.settings.landmarks.enabled)
  const setProgress = useAppStore((s) => s.setProgress)
  const features = useLandmarkStore((s) => (track ? s.features[track.id] : undefined))
  const landmarkStatus = useLandmarkStore((s) => s.status)
  const roadbook = useMemo(
    () => (track ? buildRoadbook(track, features ? roadbookLandmarks(features, track) : [], pois) : null),
    [track, features, pois],
  )

  if (!track || !roadbook) return null
  const lengthM = track.stats.distanceM
  const hasTimes = roadbook.rows.some((row) => row.timeMs !== undefined)
  const steep = longestSteepText(roadbook)
  const text = () => roadbookText(roadbook, track.name)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text())
      showToast({ kind: 'success', text: 'Feuille de route copiée.' })
    } catch (err) {
      showToast({ kind: 'error', text: `Impossible de copier la feuille de route : ${errorText(err)}` })
    }
  }

  const save = async () => {
    const fileName = videoFileName(`${track.name} - feuille de route`, '.txt')
    try {
      const outcome = await getPlatform().saveFile(new Blob([text()], { type: 'text/plain;charset=utf-8' }), { fileName })
      if (outcome.saved) showToast({ kind: 'success', text: `Enregistrée : ${outcome.fileName}` })
    } catch (err) {
      showToast({ kind: 'error', text: `Impossible d'enregistrer « ${fileName} » : ${errorText(err)}` })
    }
  }

  return (
    <div className="roadbook">
      <p className="roadbook__summary">{roadbookSummary(roadbook)}</p>
      <p className="field__hint">
        {steep ?? 'Aucune pente raide (15 % ou plus sur 100 m).'}
        {steep && ' Pentes sur la trace : onglet Carte, « Couleur de la trace » › Pente.'}
      </p>
      {roadbook.timesEstimated && <p className="field__hint">Heures estimées (≈) à partir du départ prévu.</p>}
      <p className="field__hint" role="status" aria-live="polite">
        {!landmarksOn && "Activez « Repères » dans l'onglet Carte pour ajouter cols, sommets, refuges et points d'eau."}
        {landmarksOn && landmarkStatus === 'loading' && "Recherche des cols, refuges et points d'eau…"}
      </p>

      <div className={hasTimes ? 'roadbook__row roadbook__row--timed roadbook__head' : 'roadbook__row roadbook__head'} aria-hidden="true">
        <span>km</span>
        <span>Lieu</span>
        <span>Alt.</span>
        {hasTimes && <span>Heure</span>}
      </div>
      <ol className="roadbook__rows">
        {roadbook.rows.map((row, i) => (
          <li key={i}>
            <button
              type="button"
              className={hasTimes ? 'roadbook__row roadbook__row--timed' : 'roadbook__row'}
              title="Aller à ce point"
              onClick={() => setProgress(lengthM > 0 ? row.distanceM / lengthM : 0)}
            >
              <span className="roadbook__km">{formatNumber(row.distanceM / 1000, 1)}</span>
              <span className="roadbook__name">
                {row.name}
                <span className="roadbook__meta">
                  {row.detail ? `${row.detail} · ` : ''}D+ {formatAscent(row.ascentM)}
                </span>
              </span>
              <span className="roadbook__ele">{row.eleM === undefined ? '' : `${formatNumber(row.eleM)} m`}</span>
              {hasTimes && (
                <span className="roadbook__time">
                  {passageText(roadbook, row)}
                  {row.sincePreviousS !== undefined && <span className="roadbook__meta">+{formatDuration(row.sincePreviousS)}</span>}
                </span>
              )}
            </button>
          </li>
        ))}
      </ol>

      <div className="project__row">
        <button type="button" className="btn btn--secondary" onClick={() => void copy()}>
          Copier
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => void save()}>
          <Icon name="save" size={16} />
          Enregistrer (.txt)
        </button>
      </div>
    </div>
  )
}

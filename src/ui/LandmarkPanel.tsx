import { useEffect, useId } from 'react'
import { KIND_BADGES, KIND_LABELS, LANDMARK_DISTANCE_RANGE } from '../osm/landmarks'
import { OSM_ATTRIBUTION, OSM_KINDS } from '../osm/overpass'
import { syncLandmarks, useLandmarkStore } from '../osm/store'
import { sequenceLandmarks } from '../flyover/sequence'
import { followLandmarks, setLandmarkTitles, useFilmSequence, useFilmSource } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { Icon } from './icons'
import { PanelSection } from './PanelSection'
import { formatDistance, formatNumber } from './format'

/**
 * « Repères (OpenStreetMap) » (foldable section of the Carte tab): kinds and corridor width, « Ralentir et titrer aux
 * repères », status, the landmarks of the first track ordered along it (click = seek the flyover there; the eye button
 * hides one, kept in the project as `settings.landmarks.hiddenIds`, hidden ones stay listed greyed out) and the ODbL
 * attribution. Also drives the landmark store, and makes the landmark titles of the film again whenever the landmarks
 * of the first track are published (loaded, kinds or distance changed) while that option is on.
 */
export function LandmarkPanel() {
  const id = useId()
  const tracks = useAppStore((s) => s.tracks)
  const settings = useAppStore((s) => s.settings.landmarks)
  const setSetting = useAppStore((s) => s.setSetting)
  const setProgress = useAppStore((s) => s.setProgress)
  const status = useLandmarkStore((s) => s.status)
  const message = useLandmarkStore((s) => s.message)
  // the landmarks along the film: the first track's, or « À la suite » those of every stage
  const { track: first, landmarks } = useFilmSource()
  const sequence = useFilmSequence()
  const hiddenByTrack = useLandmarkStore((s) => s.hidden)
  const hidden = sequence ? sequenceLandmarks(sequence, hiddenByTrack) : first ? hiddenByTrack[first.id] : undefined
  const titles = useAppStore((s) => s.settings.film.landmarkTitles)

  useEffect(() => {
    syncLandmarks(tracks, settings)
  }, [tracks, settings])

  // not on a change of the film: an undone title stays undone until the landmarks change
  useEffect(() => {
    followLandmarks()
    if (landmarks && useAppStore.getState().settings.film.landmarkTitles) setLandmarkTitles(true)
  }, [landmarks])

  if (!first) return null
  const lengthM = first.stats.distanceM
  const list = landmarks ?? []
  const hiddenList = hidden ?? []
  const rows = [
    ...list.map((landmark) => ({ landmark, hidden: false })),
    ...hiddenList.map((landmark) => ({ landmark, hidden: true })),
  ].sort((a, b) => a.landmark.alongM - b.landmark.alongM || b.landmark.priority - a.landmark.priority)
  const setHidden = (landmarkId: string, hide: boolean) => {
    const rest = settings.hiddenIds.filter((hiddenId) => hiddenId !== landmarkId)
    setSetting('landmarks', { ...settings, hiddenIds: hide ? [...rest, landmarkId] : rest })
  }

  return (
    <PanelSection title="Repères (OpenStreetMap)" keys={['landmarks']}>
      <label className="checkbox checkbox--switch" htmlFor={`${id}-enabled`}>
        <input
          id={`${id}-enabled`}
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSetting('landmarks', { ...settings, enabled: e.currentTarget.checked })}
        />
        Sommets, cols, refuges… autour de la trace
      </label>

      {settings.enabled && (
        <fieldset className="field fieldset">
          <legend className="field__label">Types</legend>
          <div className="chips">
            {OSM_KINDS.map((kind) => (
              <label key={kind} className="chip">
                <input
                  type="checkbox"
                  checked={settings.kinds[kind]}
                  onChange={(e) =>
                    setSetting('landmarks', { ...settings, kinds: { ...settings.kinds, [kind]: e.currentTarget.checked } })
                  }
                />
                {KIND_LABELS[kind]}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {settings.enabled && (
        <div className="field">
          <label className="field__label" htmlFor={`${id}-distance`}>
            Distance à la trace
          </label>
          <div className="range-row">
            <input
              id={`${id}-distance`}
              className="range"
              type="range"
              min={LANDMARK_DISTANCE_RANGE.min}
              max={LANDMARK_DISTANCE_RANGE.max}
              step={LANDMARK_DISTANCE_RANGE.step}
              value={settings.maxDistanceM}
              onChange={(e) => setSetting('landmarks', { ...settings, maxDistanceM: Number(e.currentTarget.value) })}
            />
            <output className="range-row__value range-row__value--wide" htmlFor={`${id}-distance`}>
              {formatDistance(settings.maxDistanceM)}
            </output>
          </div>
        </div>
      )}

      {settings.enabled && (
        <div className="field">
          <label className="checkbox checkbox--switch" htmlFor={`${id}-titles`}>
            <input id={`${id}-titles`} type="checkbox" checked={titles} onChange={(e) => setLandmarkTitles(e.currentTarget.checked)} />
            Ralentir et titrer aux repères
          </label>
          <p className="field__hint">
            Le film ralentit aux cols, sommets et refuges sur la trace et affiche leur nom. Retoucher un de ces titres les fige.
          </p>
        </div>
      )}

      <p className="field__hint" role="status" aria-live="polite">
        {!settings.enabled && 'Désactivés : aucune requête envoyée.'}
        {settings.enabled && status === 'loading' && 'Recherche des repères…'}
        {settings.enabled && status === 'error' && message}
        {settings.enabled &&
          status === 'ready' &&
          (rows.length === 0
            ? 'Aucun repère de ces types près de la trace.'
            : list.length === 0
              ? `Tous les repères sont masqués (${hiddenList.length}).`
              : `${list.length} ${list.length > 1 ? 'repères' : 'repère'} le long de la trace` +
                (hiddenList.length > 0 ? ` · ${hiddenList.length} ${hiddenList.length > 1 ? 'masqués' : 'masqué'}` : '') +
                '. Cliquez pour y aller.')}
      </p>

      {settings.enabled && status === 'error' && (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => syncLandmarks(tracks, settings, { retry: true })}>
          Réessayer
        </button>
      )}

      {settings.enabled && rows.length > 0 && (
        <ul className="landmarks">
          {rows.map(({ landmark, hidden: isHidden }) => (
            <li key={landmark.id} className={isHidden ? 'landmark-row landmark-row--hidden' : 'landmark-row'}>
              <button
                type="button"
                className="landmark"
                title={isHidden ? 'Repère masqué · aller à ce repère' : 'Aller à ce repère'}
                onClick={() => setProgress(lengthM > 0 ? landmark.alongM / lengthM : 0)}
              >
                <span className={landmark.kind === 'pass' ? 'landmark__kind landmark__kind--pass' : 'landmark__kind'}>
                  {KIND_BADGES[landmark.kind]}
                </span>
                <span className="landmark__name">{landmark.text}</span>
                <span className="landmark__meta">
                  au km {formatNumber(landmark.alongM / 1000, 1)} · à {formatDistance(landmark.distanceM)} de la trace
                </span>
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={isHidden ? `Afficher le repère ${landmark.text}` : `Masquer le repère ${landmark.text}`}
                data-tip={isHidden ? 'Afficher ce repère' : 'Masquer ce repère'}
                data-tip-side="left"
                onClick={() => setHidden(landmark.id, !isHidden)}
              >
                <Icon name={isHidden ? 'eye-off' : 'eye'} size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {settings.enabled && settings.hiddenIds.length > 0 && (
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={() => setSetting('landmarks', { ...settings, hiddenIds: [] })}
        >
          Réafficher tous les repères masqués
        </button>
      )}

      {settings.enabled && status !== 'idle' && (
        <p className="field__hint">
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            {OSM_ATTRIBUTION}
          </a>
        </p>
      )}
    </PanelSection>
  )
}

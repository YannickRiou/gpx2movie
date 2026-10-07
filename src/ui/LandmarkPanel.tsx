import { useEffect, useId } from 'react'
import { KIND_LABELS, LANDMARK_DISTANCE_RANGE } from '../osm/landmarks'
import { OSM_ATTRIBUTION, OSM_KINDS } from '../osm/overpass'
import type { OsmKind } from '../osm/overpass'
import { syncLandmarks, useLandmarkStore } from '../osm/store'
import { useAppStore } from '../state/store'
import { ModifiedMarker } from './ModifiedMarker'
import { formatDistance, formatNumber } from './format'

/** Badge of each kind in the list (singular). */
const KIND_BADGES: Readonly<Record<OsmKind, string>> = {
  peak: 'Sommet',
  pass: 'Col',
  hut: 'Refuge',
  lake: 'Lac',
  waterfall: 'Cascade',
  place: 'Lieu',
  viewpoint: 'Vue',
  glacier: 'Glacier',
}

/**
 * « Repères (OpenStreetMap) »: kinds and corridor width, status, the landmarks of the first track ordered
 * along it (click = seek the flyover there) and the ODbL attribution. Also drives the landmark store.
 */
export function LandmarkPanel() {
  const id = useId()
  const tracks = useAppStore((s) => s.tracks)
  const settings = useAppStore((s) => s.settings.landmarks)
  const setSetting = useAppStore((s) => s.setSetting)
  const setProgress = useAppStore((s) => s.setProgress)
  const status = useLandmarkStore((s) => s.status)
  const message = useLandmarkStore((s) => s.message)
  const first = tracks[0]
  const landmarks = useLandmarkStore((s) => (first ? s.landmarks[first.id] : undefined))

  useEffect(() => {
    syncLandmarks(tracks, settings)
  }, [tracks, settings])

  if (!first) return null
  const lengthM = first.stats.distanceM
  const list = landmarks ?? []

  return (
    <section className="settings landmarks-panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        Repères (OpenStreetMap)
      </h2>
      <ModifiedMarker keys={['landmarks']} label="Repères" />

      <label className="checkbox" htmlFor={`${id}-enabled`}>
        <input
          id={`${id}-enabled`}
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSetting('landmarks', { ...settings, enabled: e.currentTarget.checked })}
        />
        Rechercher les sommets, cols, refuges… autour de la trace
      </label>

      {settings.enabled && (
        <fieldset className="field fieldset">
          <legend className="field__label">Types affichés</legend>
          <div className="landmarks__kinds">
            {OSM_KINDS.map((kind) => (
              <label key={kind} className="checkbox">
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
            Distance maximale à la trace
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

      <p className="field__hint" role="status" aria-live="polite">
        {!settings.enabled && 'Désactivés : aucune requête n’est envoyée.'}
        {settings.enabled && status === 'loading' && 'Recherche des repères…'}
        {settings.enabled && status === 'error' && message}
        {settings.enabled &&
          status === 'ready' &&
          (list.length === 0
            ? 'Aucun repère de ces types près de la première trace.'
            : `${list.length} ${list.length > 1 ? 'repères' : 'repère'} le long de la première trace.`)}
      </p>

      {settings.enabled && status === 'error' && (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => syncLandmarks(tracks, settings, { retry: true })}>
          Réessayer
        </button>
      )}

      {settings.enabled && list.length > 0 && (
        <ul className="landmarks">
          {list.map((landmark) => (
            <li key={landmark.id}>
              <button
                type="button"
                className="landmark"
                title="Aller à ce repère"
                onClick={() => setProgress(lengthM > 0 ? landmark.alongM / lengthM : 0)}
              >
                <span className={landmark.kind === 'pass' ? 'landmark__kind landmark__kind--pass' : 'landmark__kind'}>
                  {KIND_BADGES[landmark.kind]}
                </span>
                <span className="landmark__name">{landmark.text}</span>
                <span className="landmark__meta">
                  {formatNumber(landmark.alongM / 1000, 1)} km du départ · à {formatDistance(landmark.distanceM)} de la trace
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {settings.enabled && status !== 'idle' && (
        <p className="field__hint">
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
            {OSM_ATTRIBUTION}
          </a>
        </p>
      )}
    </section>
  )
}

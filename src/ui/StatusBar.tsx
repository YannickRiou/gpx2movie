import { useRef } from 'react'
import { useRegionStore } from '../osm/region'
import { useLandmarkStore, useWaterStore } from '../osm/store'
import { overlayCredits } from '../overlay/data'
import { useAppStore } from '../state/store'
import { useWeatherStore } from '../weather/store'
import { Icon } from './icons'

/** French plural: zero and one take the singular. */
function plural(count: number, singular: string, pluralForm: string): string {
  return count > 1 ? pluralForm : singular
}

/**
 * Status strip under the timeline: tile count (« Chargement de la carte » / « Carte chargée »), import spinner and the mandatory source attributions on one line;
 * the ⓘ button opens the full « Sources et licences » text.
 * Only the import status is a live region: the tile counters change several times a second
 * and must not be announced by screen readers.
 */
export function StatusBar() {
  const stats = useAppStore((s) => s.terrainStats)
  const loading = useAppStore((s) => s.loading)
  const terrainSourceId = useAppStore((s) => s.settings.terrainSourceId)
  const imagerySourceId = useAppStore((s) => s.settings.imagerySourceId)
  const weather = useWeatherStore((s) => s.status === 'ready')
  const landmarks = useLandmarkStore((s) => Object.values(s.landmarks).some((list) => list.length > 0))
  // OpenStreetMap is credited for the water and the highlighted region as well as for the landmarks
  const water = useWaterStore((s) => s.polygons > 0)
  const region = useRegionStore((s) => s.region !== null)
  const dialog = useRef<HTMLDialogElement>(null)

  const credits = overlayCredits({ terrainSourceId, imagerySourceId, weather, landmarks: landmarks || water || region })

  return (
    <footer className="status">
      {/* calm: nothing before the first tile, a short count after */}
      {(stats.loadedTiles > 0 || stats.pendingTiles > 0 || stats.failedTiles > 0) && (
        <p className="status__tiles" title="Tuiles de relief et d'imagerie">
          {stats.pendingTiles > 0
            ? `Chargement de la carte · ${stats.pendingTiles} ${plural(stats.pendingTiles, 'tuile', 'tuiles')}`
            : `Carte chargée · ${stats.loadedTiles} ${plural(stats.loadedTiles, 'tuile', 'tuiles')}`}
          {stats.failedTiles > 0 && <span className="status__failed"> · {stats.failedTiles} en erreur</span>}
        </p>
      )}
      {/* always mounted so that assistive tech sees the text change */}
      <p className="status__line" role="status" aria-live="polite" hidden={!loading}>
        <span className="status__spinner" aria-hidden="true" />
        Import en cours…
      </p>
      <p className="status__attribution" title={credits.join('\n')}>
        {credits.join(' · ')}
      </p>
      <button
        type="button"
        className="status__info"
        aria-label="Sources et licences"
        data-tip="Sources et licences"
        data-tip-side="top"
        data-tip-align="end"
        onClick={() => dialog.current?.showModal()}
      >
        <Icon name="info" size={14} />
      </button>

      <dialog ref={dialog} className="sources" aria-labelledby="sources-title">
        <div className="sources__head">
          <h2 id="sources-title" className="sources__title">
            Sources et licences
          </h2>
          <button type="button" className="icon-btn" aria-label="Fermer" data-tip="Fermer (Échap)" data-tip-side="left" onClick={() => dialog.current?.close()}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <ul className="sources__list">
          {credits.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="field__hint">
          Ces mentions sont incrustées dans les films exportés (Habillage, « Crédits des sources »). Polices : Fraunces et
          IBM Plex (SIL Open Font License 1.1). Icônes : Lucide (licence ISC). OpenFlyover est publié sous licence MIT.
        </p>
      </dialog>
    </footer>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useRegionStore } from '../osm/region'
import { useLandmarkStore, useWaterStore } from '../osm/store'
import { overlayCredits } from '../overlay/data'
import { useAppStore } from '../state/store'
import { useWeatherStore, weatherShown } from '../weather/store'
import { formatPercent } from './format'
import { Icon } from './icons'
import { IDLE_MAP_STATUS, MAP_LOADING_DELAY_MS, nextMapStatus, type MapStatus } from './mapStatus'

/** French plural: zero and one take the singular. */
function plural(count: number, singular: string, pluralForm: string): string {
  return count > 1 ? pluralForm : singular
}

/** Map state from the terrain stats, re-read when a load reaches its display delay. */
function useMapStatus(): MapStatus {
  const [status, setStatus] = useState(IDLE_MAP_STATUS)
  useEffect(() => {
    let current = IDLE_MAP_STATUS
    let timer = 0
    const step = () => {
      window.clearTimeout(timer)
      const now = performance.now()
      current = nextMapStatus(current, useAppStore.getState().terrainStats, now)
      setStatus(current)
      if (current.phase === 'loading' && current.shown !== 'loading') {
        timer = window.setTimeout(step, current.since + MAP_LOADING_DELAY_MS - now)
      }
    }
    step()
    const unsubscribe = useAppStore.subscribe((s, prev) => {
      if (s.terrainStats !== prev.terrainStats) step()
    })
    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])
  return status
}

/** Small ring filled with the share of the view drawn; it turns slowly while tiles arrive. */
function ProgressRing({ value }: { value: number }) {
  const circumference = 2 * Math.PI * 5
  return (
    <svg className="status__ring" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <circle cx="6" cy="6" r="5" />
      <circle cx="6" cy="6" r="5" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value)} />
    </svg>
  )
}

/**
 * Status strip under the timeline: map state (« Carte · 72 % » ring while the view waits for tiles, « Carte prête »
 * once it is complete, tiles in error), import spinner and the mandatory source attributions on one line;
 * the ⓘ button opens the full « Sources et licences » text.
 * Only the import status is a live region: the map state changes several times a second
 * and must not be announced by screen readers.
 */
export function StatusBar() {
  const map = useMapStatus()
  const loading = useAppStore((s) => s.loading)
  const terrainSourceId = useAppStore((s) => s.settings.terrainSourceId)
  const imagerySourceId = useAppStore((s) => s.settings.imagerySourceId)
  const weather = useWeatherStore(weatherShown)
  const landmarks = useLandmarkStore((s) => Object.values(s.landmarks).some((list) => list.length > 0))
  // OpenStreetMap is credited for the water and the highlighted region as well as for the landmarks
  const water = useWaterStore((s) => s.polygons > 0)
  const region = useRegionStore((s) => s.region !== null)
  const dialog = useRef<HTMLDialogElement>(null)

  const credits = overlayCredits({ terrainSourceId, imagerySourceId, weather, landmarks: landmarks || water || region })

  return (
    <footer className="status">
      {/* calm: nothing before the first tile, a short load (small camera move) does not show */}
      {map.shown !== 'idle' && (
        <p className="status__map">
          {map.shown === 'loading' ? (
            <span
              className="status__map-state status__map-state--loading"
              title="Relief et imagerie de la vue actuelle"
              role="progressbar"
              aria-label="Chargement de la carte"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(map.progress * 100)}
            >
              <ProgressRing value={map.progress} />
              Carte · {formatPercent(map.progress)}
            </span>
          ) : (
            <span className="status__map-state status__map-state--ready" title="Toutes les tuiles de la vue actuelle sont chargées">
              <Icon name="circle-check" size={12} />
              Carte prête
            </span>
          )}
          {map.failed > 0 && (
            <span
              className="status__failed"
              tabIndex={0}
              data-tip="Réseau ou serveur : nouvel essai automatique"
              data-tip-side="top"
              data-tip-align="start"
            >
              {map.failed} {plural(map.failed, 'tuile', 'tuiles')} en erreur
            </span>
          )}
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

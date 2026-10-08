import { useRef, useState } from 'react'
import { errorMessage } from '../core/errors'
import { assignColors } from '../import'
import { findPlace } from '../osm/geocode'
import { computeRouteTrack, isRouteTrack, planAreaAround, routePointName, useRouteStore } from '../route/planner'
import { useAppStore } from '../state/store'
import { PanelSection } from './PanelSection'
import { Icon } from './icons'
import { showToast } from './toast'

/** A place or coordinates typed by the user: the relief around it is shown, without any track, to draw a route. */
export function PlaceForm({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  return (
    <form
      className={compact ? 'place-form place-form--compact' : 'place-form'}
      onSubmit={(e) => {
        e.preventDefault()
        const text = String(new FormData(e.currentTarget).get('place') ?? '')
        if (!text.trim() || busy) return
        setBusy(true)
        findPlace(text)
          .then((place) => {
            if (!place) {
              showToast({ kind: 'error', text: `Lieu introuvable : « ${text.trim()} ».` })
              return
            }
            useAppStore.getState().setPlanArea(planAreaAround(place.center))
            showToast({ kind: 'info', text: 'Clic droit sur le relief › « Point de passage ici » pour tracer la sortie.' })
          })
          .catch((error: unknown) => showToast({ kind: 'error', text: `Recherche du lieu impossible : ${errorMessage(error)}` }))
          .finally(() => setBusy(false))
      }}
    >
      <label className="field__label" htmlFor={compact ? 'place-compact' : 'place'}>
        Préparer une sortie
      </label>
      <div className="place-form__row">
        <input
          id={compact ? 'place-compact' : 'place'}
          name="place"
          className="input"
          placeholder="Lieu, ou latitude, longitude"
          autoComplete="off"
          disabled={busy}
        />
        <button type="submit" className="btn btn--secondary" disabled={busy}>
          {busy ? 'Recherche…' : 'Afficher'}
        </button>
      </div>
    </form>
  )
}

/**
 * « Reconnaissance » (Trace tab): a route not walked yet. Points placed by a right-click on the relief (`TrackMenu`),
 * listed here; « Calculer l'itinéraire » routes them along the OpenStreetMap paths and adds the result as a track (or
 * replaces the route it was taken from), on which the whole film works. Without a track, a place to show first.
 */
export function RoutePanel() {
  const points = useRouteStore((s) => s.points)
  const status = useRouteStore((s) => s.status)
  const trackId = useRouteStore((s) => s.trackId)
  const hasArea = useAppStore((s) => s.bounds !== null)
  const tracks = useAppStore((s) => s.tracks)
  const routes = tracks.filter(isRouteTrack)
  const abortRef = useRef<AbortController | null>(null)
  const computing = status === 'computing'

  const compute = async () => {
    const route = useRouteStore.getState()
    const controller = new AbortController()
    abortRef.current = controller
    route.setStatus('computing')
    try {
      const store = useAppStore.getState()
      const replaced = store.tracks.find((t) => t.id === route.trackId)
      const track = await computeRouteTrack(route.points, {
        terrainSourceId: store.settings.terrainSourceId,
        name: replaced?.name,
        signal: controller.signal,
      })
      const now = useAppStore.getState()
      if (replaced && now.tracks.includes(replaced)) {
        now.replaceTracks(now.tracks.map((t) => (t === replaced ? { ...track, color: replaced.color } : t)))
      } else {
        now.addTracks(assignColors([track], now.tracks.length))
      }
      useRouteStore.getState().clear()
      const km = (track.stats.distanceM / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })
      showToast({ kind: 'success', text: `Itinéraire : ${km} km, D+ ${Math.round(track.stats.ascentM)} m.` })
    } catch (error) {
      if (!controller.signal.aborted) showToast({ kind: 'error', text: errorMessage(error) })
    } finally {
      abortRef.current = null
      useRouteStore.getState().setStatus('idle')
    }
  }

  return (
    <PanelSection title="Reconnaissance">
      <p className="field__hint">
        Survolez une sortie avant d'y aller : clic droit sur le relief › « Point de passage ici », dans l'ordre, puis
        calculez. L'itinéraire suit les chemins d'OpenStreetMap.
      </p>
      {!hasArea && <PlaceForm compact />}
      {points.length > 0 && (
        <ol className="route-points">
          {points.map((p, i) => (
            <li key={`${p.lon},${p.lat},${i}`} className="route-point">
              <span className="route-point__name">{routePointName(i, points.length)}</span>
              <span className="route-point__at">
                {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Retirer ${routePointName(i, points.length)}`}
                data-tip="Retirer"
                data-tip-side="left"
                disabled={computing}
                onClick={() => useRouteStore.getState().remove(i)}
              >
                <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ol>
      )}
      {computing ? (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => abortRef.current?.abort()}>
          Calcul en cours… Annuler
        </button>
      ) : (
        <button type="button" className="btn btn--primary btn--block" disabled={points.length < 2} onClick={() => void compute()}>
          <Icon name="route" size={16} />
          {trackId ? "Recalculer l'itinéraire" : "Calculer l'itinéraire"}
        </button>
      )}
      {points.length > 0 && !computing && (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => useRouteStore.getState().clear()}>
          Effacer les points
        </button>
      )}
      {points.length === 0 &&
        routes.map((track) => (
          <button key={track.id} type="button" className="btn btn--secondary btn--block" onClick={() => useRouteStore.getState().edit(track)}>
            Modifier « {track.name} »
          </button>
        ))}
      <p className="field__hint">Chemins © contributeurs OpenStreetMap (Overpass) ; lieux : Nominatim.</p>
    </PanelSection>
  )
}

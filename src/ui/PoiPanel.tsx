import { useState } from 'react'
import { nextFilmId } from '../film/model'
import type { FilmPoi } from '../film/model'
import { POI_NAME_MAX, addPoi, poiStopAtM, removePoi, renamePoi } from '../film/pois'
import { addStop } from '../film/timeline'
import { samplePath, trackPathOf } from '../flyover/path'
import { editFilm } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { PanelSection } from './PanelSection'
import { Icon } from './icons'

/**
 * « Points d'intérêt » (foldable section of the Carte tab): the places named by hand, shown as labels in the view and
 * the film. « Ajouter au marqueur » puts one under the marker, its name field focused; each row renames (typing
 * merged into one undo step), makes a stop at the nearest point of the first track, or deletes. A right-click on the
 * relief adds one too (`TrackMenu`).
 */
export function PoiPanel() {
  const track = useAppStore((s) => s.tracks[0])
  const pois = useAppStore((s) => s.settings.film.pois)
  /** the point just added from here, whose name field takes the focus */
  const [added, setAdded] = useState<string | null>(null)
  if (!track) return null

  const addAtMarker = () => {
    const path = trackPathOf(track)
    const at = samplePath(path, useAppStore.getState().playback.progress * path.lengthM)
    setAdded(nextFilmId(useAppStore.getState().settings.film, 'poi'))
    editFilm((film) => ({ film: addPoi(film, at) }))
  }
  const addStopAt = (poi: FilmPoi) => {
    const atM = poiStopAtM(trackPathOf(track), poi)
    if (atM !== undefined) editFilm((film) => addStop(film, atM, { label: poi.name.trim() || undefined }), { stops: true })
  }

  return (
    <PanelSection title="Points d'intérêt">
      <p className="field__hint">
        Vos lieux à vous, affichés comme les repères dans la vue et le film. Aussi par un clic droit sur le relief.
      </p>
      {pois.length > 0 && (
        <ul className="pois">
          {pois.map((poi) => (
            <li key={poi.id} className="poi">
              <input
                className="input"
                aria-label="Nom du point d'intérêt"
                placeholder="Sans nom : pas d'étiquette"
                value={poi.name}
                maxLength={POI_NAME_MAX}
                autoFocus={poi.id === added}
                onFocus={(e) => {
                  if (poi.id === added) e.currentTarget.select()
                }}
                onBlur={() => setAdded(null)}
                onChange={(e) => {
                  const name = e.currentTarget.value
                  editFilm((film) => ({ film: renamePoi(film, poi.id, name) }), { step: false })
                }}
              />
              <button
                type="button"
                className="btn btn--secondary btn--small"
                data-tip="Faire un arrêt au point le plus proche de la trace"
                data-tip-side="left"
                onClick={() => addStopAt(poi)}
              >
                <Icon name="map-pin" size={16} />
                Arrêt
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`Supprimer le point d'intérêt ${poi.name}`}
                data-tip="Supprimer"
                data-tip-side="left"
                onClick={() => editFilm((film) => ({ film: removePoi(film, poi.id) }))}
              >
                <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn--secondary btn--block" onClick={addAtMarker}>
        <Icon name="plus" size={16} />
        Ajouter au marqueur
      </button>
    </PanelSection>
  )
}

import { useId, useMemo } from 'react'
import { filmHighlights, stopCandidates } from '../film/assemble'
import type { FilmHighlight } from '../film/assemble'
import { STOP_DURATION_RANGE } from '../film/model'
import { addStop, removeFilmItem, updateStop } from '../film/timeline'
import { samplePath, trackPathOf } from '../flyover/path'
import { editFilm, setAutoStops, useFilmClock, useFilmSource } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { formatNumber } from './format'
import { Icon } from './icons'
import { PanelSection } from './PanelSection'

/**
 * « Temps forts » (foldable section of the Survol tab): the highlights of the film at a glance, those of the timeline
 * (`filmHighlights`: climb tops, passes and summits detected, then the stops added by hand). A click on a row moves
 * the marker there; « Arrêt dans le film » makes or removes its stop, the duration retouches it. Edits go through
 * `editFilm` like the timeline's: the first one writes the automatic stops out (they no longer follow the track).
 */
export function HighlightsPanel() {
  const { track, landmarks, pacing } = useFilmSource()
  const stops = useFilmClock().stops
  const autoStops = useAppStore((s) => s.settings.film.autoStops)
  const landmarksOn = useAppStore((s) => s.settings.landmarks.enabled)
  const setProgress = useAppStore((s) => s.setProgress)
  const id = useId()
  const highlights = useMemo(
    () => (track ? filmHighlights(stopCandidates({ track, landmarks, pacing }), stops) : []),
    [track, landmarks, pacing, stops],
  )
  if (!track) return null

  const path = trackPathOf(track)
  const lengthM = track.stats.distanceM
  const stopEdit = (edit: Parameters<typeof editFilm>[0], step = true) => editFilm(edit, { stops: true, step })
  const toggle = ({ atM, label, source, stop }: FilmHighlight, on: boolean) =>
    stopEdit((f) => ({ film: on ? addStop(f, atM, { label, source }).film : stop ? removeFilmItem(f, stop.id) : f }))
  const addAtMarker = () => stopEdit((f) => ({ film: addStop(f, Math.round(useAppStore.getState().playback.progress * lengthM)).film }))

  return (
    <PanelSection title="Temps forts">
      <label className="checkbox checkbox--switch">
        <input type="checkbox" checked={autoStops} aria-describedby={`${id}-auto`} onChange={(e) => setAutoStops(e.currentTarget.checked)} />
        Arrêts automatiques
      </label>
      <p id={`${id}-auto`} className="field__hint">
        {autoStops
          ? 'Un arrêt à chaque temps fort détecté. Retoucher un arrêt, ici ou sur la timeline, les fige.'
          : 'Arrêts figés : vous choisissez. Recocher remet un arrêt à chaque temps fort et retire les vôtres.'}
        {!landmarksOn && ' Activez « Repères » (onglet Carte) pour y ajouter cols et sommets.'}
      </p>
      {highlights.length === 0 ? (
        <p className="tracks__empty">Aucun temps fort : ni montée, ni col, ni sommet près de la trace.</p>
      ) : (
        <ol className="highlights">
          {highlights.map((h) => {
            const ele = samplePath(path, h.atM).ele
            const stop = h.stop
            // a detected row keeps its key while its stop comes and goes (the focus stays on its checkbox)
            return (
              <li key={h.source ? `${h.source.kind}-${h.source.ref}` : stop?.id} className="highlight">
                <button type="button" className="highlight__go" title="Aller à ce temps fort" onClick={() => setProgress(lengthM > 0 ? h.atM / lengthM : 0)}>
                  <span className="highlight__name">{h.label}</span>
                  <span className="highlight__meta">
                    km {formatNumber(h.atM / 1000, 1)}
                    {ele !== undefined && ` · ${formatNumber(ele)} m`}
                    {!h.source && ' · ajouté'}
                  </span>
                </button>
                <div className="highlight__stop">
                  {h.source ? (
                    <label className="checkbox">
                      <input type="checkbox" checked={stop !== undefined} onChange={(e) => toggle(h, e.currentTarget.checked)} />
                      Arrêt dans le film
                    </label>
                  ) : (
                    <span className="highlight__added">Arrêt dans le film</span>
                  )}
                  {stop && (
                    <label className="highlight__duration">
                      <input
                        className="input"
                        type="number"
                        aria-label={`Durée de l'arrêt « ${h.label} » (secondes)`}
                        min={STOP_DURATION_RANGE.min}
                        max={STOP_DURATION_RANGE.max}
                        step={STOP_DURATION_RANGE.step}
                        value={stop.durationS}
                        onChange={(e) => {
                          const durationS = e.currentTarget.valueAsNumber
                          if (Number.isFinite(durationS)) stopEdit((f) => ({ film: updateStop(f, stop.id, { durationS }) }), false)
                        }}
                      />
                      s
                    </label>
                  )}
                  {!h.source && (
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Supprimer le temps fort « ${h.label} »`}
                      data-tip="Supprimer"
                      data-tip-side="left"
                      onClick={() => toggle(h, false)}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      <button type="button" className="btn btn--secondary btn--block highlights__add" onClick={addAtMarker}>
        <Icon name="plus" size={16} />
        Ajouter à la position du marqueur
      </button>
    </PanelSection>
  )
}

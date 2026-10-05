import { useAppStore } from '../state/store'
import { formatTrackSummary } from './format'

/** One card per imported track, with a delete button. */
export function TrackList() {
  const tracks = useAppStore((s) => s.tracks)
  const removeTrack = useAppStore((s) => s.removeTrack)

  return (
    <section aria-labelledby="tracks-title">
      <h2 id="tracks-title" className="section-title">
        Traces
      </h2>
      {tracks.length === 0 ? (
        <p className="tracks__empty">Aucune trace pour l'instant. Importez un fichier GPX ou FIT pour commencer.</p>
      ) : (
        <ul className="tracks">
          {tracks.map((track) => (
            <li key={track.id} className="track">
              <span className="track__swatch" style={{ background: track.color }} aria-hidden="true" />
              <span className="track__name" title={track.name}>
                {track.name}
              </span>
              <button
                type="button"
                className="track__delete"
                aria-label={`Supprimer la trace ${track.name}`}
                title="Supprimer la trace"
                onClick={() => removeTrack(track.id)}
              >
                ×
              </button>
              <span className="track__meta">{formatTrackSummary(track.stats)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

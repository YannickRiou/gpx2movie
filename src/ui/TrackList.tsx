import { useId } from 'react'
import type { Track } from '../core/types'
import { RACE_SYNC_LABELS, RACE_SYNC_MODES, raceAt, rankRacers, syncNeedsTime } from '../flyover/race'
import type { Race, RaceSync, Racer } from '../flyover/race'
import { useRace } from '../scene/useRace'
import { useAppStore } from '../state/store'
import { formatDistance, formatDistanceGap, formatTimeGap, formatTrackSummary } from './format'
import { Icon } from './icons'
import { chooseTracksToImport } from './projectActions'

/** Progress steps the leaderboard follows: a few renders per second of its own rows, not one per frame. */
const PROGRESS_STEPS = 1000

/** Hint under the sync select. */
const SYNC_HINTS: Record<RaceSync, string> = {
  elapsed: 'Chaque trace depuis son propre départ : sorties successives sur un même parcours.',
  clock: 'À la même heure enregistrée : sortie en groupe le même jour.',
  distance: 'Au même pourcentage de chaque trace, sans tenir compte du temps.',
}

function gapLabel(racer: Racer): string {
  if (racer.gapMs !== undefined) return formatTimeGap(racer.gapMs)
  if (racer.gapM !== undefined) return formatDistanceGap(racer.gapM)
  return 'réf.'
}

/** Live leaderboard: subscribes to the (quantised) playback progress on its own. */
function RaceBoard({ race, tracks }: { race: Race; tracks: readonly Track[] }) {
  const progress = useAppStore((s) => Math.round(s.playback.progress * PROGRESS_STEPS) / PROGRESS_STEPS)
  const racers = rankRacers(raceAt(race, progress))

  return (
    <ol className="race__board" aria-label="Classement au marqueur">
      {racers.map((racer) => {
        const track = tracks[racer.index]
        if (!track) return null
        return (
          <li key={track.id} className="race__row">
            <span className="race__swatch" style={{ background: track.color }} aria-hidden="true" />
            <span className="race__name" title={track.name}>
              {track.name}
            </span>
            <span className="race__distance">{formatDistance(racer.distanceM)}</span>
            <span className="race__gap" title={racer.index === 0 ? 'Trace de référence, suivie par la caméra' : undefined}>
              {gapLabel(racer)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** « Course fantôme »: replay every track together with the first one (2+ tracks). */
function RacePanel({ tracks }: { tracks: readonly Track[] }) {
  const id = useId()
  const settings = useAppStore((s) => s.settings.race)
  const setSetting = useAppStore((s) => s.setSetting)
  const race = useRace()
  if (!race) return null

  return (
    <div className="settings race" role="group" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="field__label">
        Course fantôme
      </h3>
      <label className="checkbox checkbox--switch" htmlFor={`${id}-enabled`}>
        <input
          id={`${id}-enabled`}
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => setSetting('race', { ...settings, enabled: e.currentTarget.checked })}
        />
        Rejouer toutes les traces avec la première
      </label>

      <div className="field" hidden={!settings.enabled}>
        <label className="field__label" htmlFor={`${id}-sync`}>
          Synchronisation
        </label>
        <select
          id={`${id}-sync`}
          className="select"
          value={race.sync}
          aria-describedby={`${id}-sync-hint`}
          onChange={(e) => setSetting('race', { ...settings, sync: e.currentTarget.value as RaceSync })}
        >
          {RACE_SYNC_MODES.map((mode) => (
            <option key={mode} value={mode} disabled={syncNeedsTime(mode) && !race.timed}>
              {RACE_SYNC_LABELS[mode]}
            </option>
          ))}
        </select>
        <p id={`${id}-sync-hint`} className="field__hint">
          {race.timed
            ? SYNC_HINTS[race.sync]
            : 'Une trace n’est pas horodatée : seule « même distance » est possible.'}
        </p>
      </div>

      {settings.enabled && (
        <>
          <RaceBoard race={race} tracks={tracks} />
          <p className="field__hint">Écart avec la première trace, au même pourcentage du parcours.</p>
        </>
      )}
    </div>
  )
}

/** « + Ajouter »: pick more GPX / FIT files. */
function AddTracksButton() {
  const loading = useAppStore((s) => s.loading)
  return (
    <button
      type="button"
      className="btn btn--secondary btn--small"
      onClick={() => void chooseTracksToImport()}
      disabled={loading}
      data-tip="Ajouter des traces GPX ou FIT (plusieurs à la fois)"
      data-tip-align="end"
    >
      <Icon name="plus" size={16} />
      Ajouter
    </button>
  )
}

/** One card per imported track, with a delete button; the ghost race block from two tracks. */
export function TrackList() {
  const tracks = useAppStore((s) => s.tracks)
  const removeTrack = useAppStore((s) => s.removeTrack)

  return (
    <section aria-labelledby="tracks-title">
      <div className="section-head">
        <h2 id="tracks-title" className="section-title">
          Traces
        </h2>
        <AddTracksButton />
      </div>
      {tracks.length === 0 ? (
        <p className="tracks__empty">Aucune trace. Glissez un fichier GPX ou FIT dans la fenêtre, ou cliquez sur « Ajouter ».</p>
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
                data-tip="Supprimer"
                data-tip-side="left"
                onClick={() => removeTrack(track.id)}
              >
                <Icon name="x" size={16} />
              </button>
              <span className="track__meta">{formatTrackSummary(track.stats)}</span>
            </li>
          ))}
        </ul>
      )}
      {tracks.length >= 2 && <RacePanel tracks={tracks} />}
    </section>
  )
}

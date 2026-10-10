import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Track } from '../core/types'
import { isExportBusy, useExportStore } from '../export/store'
import {
  RACE_CAMERA_LABELS,
  RACE_CAMERAS,
  RACE_SYNC_LABELS,
  RACE_SYNC_MODES,
  STAGE_TRANSITION_LABELS,
  STAGE_TRANSITIONS,
  raceAt,
  rankRacers,
  syncNeedsTime,
} from '../flyover/race'
import type { Race, RaceCamera, RaceSettings, RaceSync, Racer, StageTransition } from '../flyover/race'
import { playsInSequence } from '../flyover/sequence'
import {
  PACE_RANGE,
  PLAN_ACTIVITIES,
  PLAN_ACTIVITY_LABELS,
  localDayAndTime,
  localDepartureMs,
  localUtcOffsetMin,
  planActivityOf,
  withEstimatedTimes,
  withoutTimes,
} from '../plan/timing'
import type { PlanActivity } from '../plan/timing'
import { useRace } from '../scene/useRace'
import { useAppStore } from '../state/store'
import { formatClock, formatDistance, formatDistanceGap, formatNumber, formatTimeGap, formatTrackSummary } from './format'
import { Icon } from './icons'
import { chainLoadedTracks, chooseTracksToImport } from './projectActions'
import { StravaDialog } from './StravaImport'

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

/** « Plusieurs traces »: how the film plays two tracks or more. */
const MULTI_MODES = ['une', 'suite', 'parallele'] as const
type MultiMode = (typeof MULTI_MODES)[number]
const MULTI_MODE_LABELS: Record<MultiMode, string> = { une: 'La première', suite: 'À la suite', parallele: 'En parallèle' }
const MULTI_MODE_HINTS: Record<MultiMode, string> = {
  une: 'Le film survole la première trace, les autres sont seulement dessinées.',
  suite: 'Le film survole les traces l’une après l’autre, dans l’ordre de la liste : chacune garde sa couleur, son nom et ses chiffres.',
  parallele: 'Course fantôme : toutes les traces rejouées ensemble.',
}

function multiModeOf(race: RaceSettings, count: number): MultiMode {
  if (race.enabled) return 'parallele'
  return playsInSequence(race, count) ? 'suite' : 'une'
}

/** The race settings for a mode: the ghost race and the sequence never both on. */
function withMultiMode(race: RaceSettings, mode: MultiMode): RaceSettings {
  const { sequence: _sequence, ...rest } = race
  if (mode === 'parallele') return { ...rest, enabled: true }
  if (mode === 'suite') return { ...rest, enabled: false, sequence: true }
  return { ...rest, enabled: false }
}

/**
 * « Plusieurs traces » (2+ tracks): the first one alone, « À la suite » (stages, their transition and cards) or
 * « En parallèle » (the ghost race: sync, what the camera follows, leaderboard).
 */
function RacePanel({ tracks }: { tracks: readonly Track[] }) {
  const id = useId()
  const settings = useAppStore((s) => s.settings.race)
  const leaderboard = useAppStore((s) => s.settings.overlay.leaderboard)
  const overlayOn = useAppStore((s) => s.settings.overlay.enabled)
  const setSetting = useAppStore((s) => s.setSetting)
  const flyTrack = useAppStore((s) => s.flyTrack)
  const busy = useExportStore((s) => isExportBusy(s.phase))
  const race = useRace()
  if (!race) return null
  const mode = multiModeOf(settings, tracks.length)
  const set = (patch: Partial<RaceSettings>) => setSetting('race', { ...settings, ...patch })
  /** a track of the list is followed by making it the first one; the other entries are camera modes */
  const followCamera = (value: string) => {
    if ((RACE_CAMERAS as readonly string[]).includes(value)) set({ camera: value as RaceCamera })
    else {
      set({ camera: 'premiere' })
      flyTrack(value)
    }
  }
  const camera = settings.camera ?? 'premiere'

  return (
    <div className="settings race" role="group" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="field__label">
        Plusieurs traces
      </h3>
      <div className="segmented" role="radiogroup" aria-labelledby={`${id}-title`} aria-describedby={`${id}-mode-hint`}>
        {MULTI_MODES.map((m) => (
          <label key={m} className="segmented__option">
            <input
              type="radio"
              name={`${id}-mode`}
              value={m}
              checked={mode === m}
              disabled={busy}
              onChange={() => setSetting('race', withMultiMode(settings, m))}
            />
            {MULTI_MODE_LABELS[m]}
          </label>
        ))}
      </div>
      <p id={`${id}-mode-hint`} className="field__hint">
        {MULTI_MODE_HINTS[mode]}
      </p>

      {mode === 'suite' && (
        <>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-transition`}>
              Entre deux étapes
            </label>
            <select
              id={`${id}-transition`}
              className="select"
              value={settings.stageTransition ?? 'fondu-noir'}
              onChange={(e) => set({ stageTransition: e.currentTarget.value as StageTransition })}
            >
              {STAGE_TRANSITIONS.map((t) => (
                <option key={t} value={t}>
                  {STAGE_TRANSITION_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <label className="checkbox checkbox--switch" htmlFor={`${id}-cards`}>
            <input
              id={`${id}-cards`}
              type="checkbox"
              checked={settings.stageCards !== false}
              onChange={(e) => set({ stageCards: e.currentTarget.checked })}
            />
            Carton au début de chaque étape
          </label>
          <p className="field__hint">Nom, date, distance et dénivelé de l’étape. L’ordre est celui de la liste (flèche pour monter une trace).</p>
        </>
      )}

      <div className="field" hidden={mode !== 'parallele'}>
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
          <div className="field">
            <label className="field__label" htmlFor={`${id}-camera`}>
              Caméra sur
            </label>
            <select id={`${id}-camera`} className="select" value={camera} disabled={busy} onChange={(e) => followCamera(e.currentTarget.value)}>
              <option value="premiere">{tracks[0].name}</option>
              {tracks.slice(1).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              {RACE_CAMERAS.filter((c) => c !== 'premiere').map((c) => (
                <option key={c} value={c}>
                  {RACE_CAMERA_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <label className="checkbox checkbox--switch" htmlFor={`${id}-board`}>
            <input
              id={`${id}-board`}
              type="checkbox"
              checked={leaderboard.enabled}
              onChange={(e) => {
                const { overlay } = useAppStore.getState().settings
                setSetting('overlay', { ...overlay, leaderboard: { ...overlay.leaderboard, enabled: e.currentTarget.checked } })
              }}
            />
            Classement à l’image
          </label>
          {leaderboard.enabled && !overlayOn && <p className="field__hint">Visible une fois l’habillage activé.</p>}
          <RaceBoard race={race} tracks={tracks} />
          <p className="field__hint">Écart avec la première trace, au même pourcentage du parcours.</p>
        </>
      )}
    </div>
  )
}

/** « + Ajouter »: a menu to pick more GPX / FIT files or import Strava activities. */
function AddTracksMenu() {
  const loading = useAppStore((s) => s.loading)
  const [open, setOpen] = useState(false)
  const [strava, setStrava] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])
  const items = [
    { label: 'Fichiers GPX ou FIT…', icon: 'upload', onClick: () => void chooseTracksToImport() },
    { label: 'Activités Strava…', icon: 'route', onClick: () => setStrava(true) },
  ] as const

  return (
    <div
      ref={ref}
      className="tracks__add"
      data-local-escape=""
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return
        setOpen(false)
        e.stopPropagation()
      }}
    >
      <button
        type="button"
        className="btn btn--secondary btn--small"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        disabled={loading}
      >
        <Icon name="plus" size={16} />
        Ajouter
      </button>
      {open && (
        <div className="track-menu topbar__menu" role="menu" aria-label="Ajouter des traces">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="track-menu__item"
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
            >
              <Icon name={item.icon} size={18} />
              {item.label}
            </button>
          ))}
        </div>
      )}
      <StravaDialog open={strava} onClose={() => setStrava(false)} />
    </div>
  )
}

/** « Enchaîner en un seul parcours » (2+ tracks): one continuous film instead of a ghost race. */
function ChainTracks({ tracks }: { tracks: readonly Track[] }) {
  const id = useId()
  const loading = useAppStore((s) => s.loading)
  return (
    <div className="field tracks__chain">
      <button
        type="button"
        className="btn btn--secondary btn--block"
        onClick={() => chainLoadedTracks(tracks)}
        disabled={loading}
        aria-describedby={`${id}-hint`}
      >
        <Icon name="spline" size={16} />
        Enchaîner en un seul parcours
      </button>
      <p id={`${id}-hint`} className="field__hint">
        Dans l’ordre des heures de départ, ou de la liste si une trace n’est pas horodatée.
      </p>
    </div>
  )
}

/** Replace one track of the list by its new version (same id: estimated times written or cleared). */
function replaceTrack(next: Track): void {
  const { tracks, replaceTracks } = useAppStore.getState()
  replaceTracks(tracks.map((t) => (t.id === next.id ? next : t)))
}

/** Departure shown when the form opens: the estimated one, else tomorrow at 8 h. */
function initialDeparture(track: Track): { day: string; time: string } {
  if (track.stats.startTime !== undefined) return localDayAndTime(track.stats.startTime)
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return { day: localDayAndTime(tomorrow.getTime()).day, time: '08:00' }
}

/**
 * « Prévoir la sortie » (untimed or already estimated track): departure, activity and pace give estimated times on
 * every point, so the sun, the counters and the weather forecast follow the planned outing.
 */
function OutingPlanForm({ track }: { track: Track }) {
  const id = useId()
  const [departure, setDeparture] = useState(() => initialDeparture(track))
  const [activity, setActivity] = useState<PlanActivity>(() => planActivityOf(track.activityType))
  const [pace, setPace] = useState(1)
  const departureMs = localDepartureMs(departure.day, departure.time)
  const { startTime, endTime } = track.stats

  function apply(e: FormEvent) {
    e.preventDefault()
    if (departureMs === undefined) return
    replaceTrack(withEstimatedTimes(track, { activity, pace, departureMs, utcOffsetMin: localUtcOffsetMin(departureMs) }))
  }

  return (
    <details className="track__plan weather__details">
      <summary className="weather__details-summary">
        Prévoir la sortie
        <Icon name="chevron-down" size={16} />
      </summary>
      <form className="track__plan-form" onSubmit={apply}>
        <div className="track__plan-row">
          <div className="field">
            <label className="field__label" htmlFor={`${id}-day`}>
              Date
            </label>
            <input
              id={`${id}-day`}
              className="input"
              type="date"
              required
              value={departure.day}
              onChange={(e) => setDeparture({ ...departure, day: e.currentTarget.value })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-time`}>
              Départ
            </label>
            <input
              id={`${id}-time`}
              className="input"
              type="time"
              required
              value={departure.time}
              onChange={(e) => setDeparture({ ...departure, time: e.currentTarget.value })}
            />
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-activity`}>
            Activité
          </label>
          <select
            id={`${id}-activity`}
            className="select"
            value={activity}
            onChange={(e) => setActivity(e.currentTarget.value as PlanActivity)}
          >
            {PLAN_ACTIVITIES.map((a) => (
              <option key={a} value={a}>
                {PLAN_ACTIVITY_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-pace`}>
            Rythme
          </label>
          <div className="range-row">
            <input
              id={`${id}-pace`}
              className="range"
              type="range"
              min={PACE_RANGE.min}
              max={PACE_RANGE.max}
              step={PACE_RANGE.step}
              value={pace}
              aria-describedby={`${id}-pace-hint`}
              onChange={(e) => setPace(Number(e.currentTarget.value))}
            />
            <output className="range-row__value" htmlFor={`${id}-pace`}>
              ×{formatNumber(pace, 2)}
            </output>
          </div>
          <p id={`${id}-pace-hint`} className="field__hint">
            Durée multipliée : 1,2 = 20 % plus long. Sans pauses, heure de cet appareil.
          </p>
        </div>
        <button type="submit" className="btn btn--primary btn--block" disabled={departureMs === undefined}>
          Calculer les horaires
        </button>
        {track.timesEstimated && startTime !== undefined && endTime !== undefined && (
          <>
            <p className="field__hint">
              Départ {formatClock(startTime)} · arrivée ≈ {formatClock(endTime)}
            </p>
            <button type="button" className="btn btn--secondary btn--block" onClick={() => replaceTrack(withoutTimes(track))}>
              Effacer les horaires
            </button>
          </>
        )}
      </form>
    </details>
  )
}

/** One card per imported track, with a delete button; chaining and « Plusieurs traces » from two tracks. */
export function TrackList() {
  const tracks = useAppStore((s) => s.tracks)
  const removeTrack = useAppStore((s) => s.removeTrack)
  const setTrackColor = useAppStore((s) => s.setTrackColor)
  const flyTrack = useAppStore((s) => s.flyTrack)
  const moveTrack = useAppStore((s) => s.moveTrack)
  const inSequence = useAppStore((s) => playsInSequence(s.settings.race, s.tracks.length))
  const busy = useExportStore((s) => isExportBusy(s.phase))

  return (
    <section aria-labelledby="tracks-title">
      <div className="section-head">
        <h2 id="tracks-title" className="section-title">
          Traces
        </h2>
        <div className="section-head__actions">
          <AddTracksMenu />
        </div>
      </div>
      {tracks.length === 0 ? (
        <p className="tracks__empty">Aucune trace. Glissez un fichier GPX ou FIT dans la fenêtre, ou cliquez sur « Ajouter ».</p>
      ) : (
        <ul className="tracks">
          {tracks.map((track, index) => (
            <li key={track.id} className="track">
              <label className="track__swatch" style={{ background: track.color }} data-tip="Couleur de la trace">
                <input
                  type="color"
                  className="track__color"
                  value={track.color}
                  aria-label={`Couleur de la trace ${track.name}`}
                  onChange={(e) => setTrackColor(track.id, e.currentTarget.value)}
                />
              </label>
              <span className="track__name" title={track.name}>
                {track.name}
              </span>
              {index > 0 && inSequence && (
                <button
                  type="button"
                  className="track__fly"
                  aria-label={`Monter la trace ${track.name} d’une étape`}
                  data-tip="Monter d’une étape"
                  data-tip-side="left"
                  disabled={busy}
                  onClick={() => moveTrack(track.id, index - 1)}
                >
                  <Icon name="chevron-up" size={16} />
                </button>
              )}
              {index > 0 && !inSequence && (
                <button
                  type="button"
                  className="track__fly"
                  aria-label={`Survoler la trace ${track.name}`}
                  data-tip="Survoler celle-ci (elle passe en tête)"
                  data-tip-side="left"
                  disabled={busy}
                  onClick={() => flyTrack(track.id)}
                >
                  <Icon name="navigation" size={16} />
                </button>
              )}
              <button
                type="button"
                className="track__delete"
                aria-label={`Supprimer la trace ${track.name}`}
                data-tip="Supprimer"
                data-tip-side="left"
                disabled={busy}
                onClick={() => removeTrack(track.id)}
              >
                <Icon name="x" size={16} />
              </button>
              <span className="track__meta">
                {formatTrackSummary(track.stats)}
                {track.timesEstimated && <span className="track__badge">horaires estimés</span>}
              </span>
              {(track.timesEstimated || track.stats.startTime === undefined) && <OutingPlanForm track={track} />}
            </li>
          ))}
        </ul>
      )}
      {tracks.length >= 2 && <ChainTracks tracks={tracks} />}
      {tracks.length >= 2 && <RacePanel tracks={tracks} />}
    </section>
  )
}

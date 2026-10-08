/**
 * « Importer depuis Strava » : a button and its dialog. First the connection with the user's own Strava application
 * (Client ID and Secret, src/strava/api.ts), then the list of their activities to import. Each button (track list,
 * welcome card) has its own dialog, drawn in the page body so a hidden panel never hides it.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { errorText } from '../core/errors'
import { assignColors } from '../import'
import { getPlatform } from '../platform'
import { authorizeInBrowser } from '../platform/oauthRedirect'
import {
  ACTIVITIES_PER_PAGE,
  StravaAuthError,
  authorizeUrl,
  callbackDomain,
  connect,
  disconnect,
  fetchStreams,
  forgetApp,
  listActivities,
  loadApp,
  loadTokens,
  parseCallback,
  saveApp,
} from '../strava/api'
import type { StravaActivity } from '../strava/api'
import { stravaSportLabel, streamsToTrack } from '../strava/track'
import { useAppStore } from '../state/store'
import { formatAscent, formatDistance } from './format'
import { Icon } from './icons'
import { runImport } from './projectActions'

/** `welcome`: the full-width button of the welcome card; otherwise the small one of the track list. */
export function StravaImport({ welcome = false }: { welcome?: boolean }) {
  const loading = useAppStore((s) => s.loading)
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [open])

  return (
    <>
      <button
        type="button"
        className={welcome ? 'btn btn--secondary' : 'btn btn--secondary btn--small'}
        onClick={() => setOpen(true)}
        disabled={loading}
        data-tip={welcome ? undefined : 'Importer des activités Strava'}
        data-tip-align={welcome ? undefined : 'end'}
      >
        {welcome ? 'Importer depuis Strava' : 'Strava'}
      </button>
      {createPortal(
        <dialog ref={dialog} className="sources strava" aria-labelledby={titleId} onClose={() => setOpen(false)}>
          <div className="sources__head">
            <h2 id={titleId} className="sources__title">
              Importer depuis Strava
            </h2>
            <button type="button" className="icon-btn" aria-label="Fermer" data-tip="Fermer (Échap)" data-tip-side="left" onClick={() => setOpen(false)}>
              <Icon name="x" size={18} />
            </button>
          </div>
          {/* mounted while open only: every opening starts again from the stored connection */}
          {open && <StravaBody onImported={() => setOpen(false)} />}
        </dialog>,
        document.body,
      )}
    </>
  )
}

function StravaBody({ onImported }: { onImported(): void }) {
  const [connected, setConnected] = useState(() => loadTokens() !== null)
  const [notice, setNotice] = useState<string | null>(null)
  const signedOut = useCallback((message: string | null) => {
    setNotice(message)
    setConnected(false)
  }, [])
  return connected ? (
    <ActivityPicker onSignedOut={signedOut} onImported={onImported} />
  ) : (
    <ConnectForm
      notice={notice}
      onConnected={() => {
        setNotice(null)
        setConnected(true)
      }}
    />
  )
}

/** « Connecter Strava » : how to create the Strava application, its Client ID and Secret, « Se connecter ». */
function ConnectForm({ notice, onConnected }: { notice: string | null; onConnected(): void }) {
  const id = useId()
  const [saved] = useState(loadApp)
  const [clientId, setClientId] = useState(saved?.clientId ?? '')
  const [clientSecret, setClientSecret] = useState(saved?.clientSecret ?? '')
  const [hasSaved, setHasSaved] = useState(saved !== null)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState(notice)
  const pending = useRef<AbortController | null>(null)
  const { capabilities } = getPlatform()

  // closing the dialog gives up a connection still waiting for Strava
  useEffect(() => () => pending.current?.abort(), [])

  function signIn() {
    const app = { clientId: clientId.trim(), clientSecret: clientSecret.trim() }
    saveApp(app)
    setHasSaved(true)
    setError(null)
    setWaiting(true)
    const state = crypto.randomUUID()
    const controller = new AbortController()
    pending.current = controller
    // on the web this opens the popup: still inside the click
    authorizeInBrowser(capabilities, (redirectUri) => authorizeUrl(app.clientId, redirectUri, state), controller.signal)
      .then((params) => connect(app, parseCallback(params, state)))
      .then(onConnected, (err: unknown) => {
        if (!controller.signal.aborted) setError(errorText(err))
      })
      .finally(() => setWaiting(false))
  }

  function forget() {
    forgetApp()
    setClientId('')
    setClientSecret('')
    setHasSaved(false)
  }

  return (
    <form
      className="strava__body"
      onSubmit={(e) => {
        e.preventDefault()
        signIn()
      }}
    >
      <ol className="strava__steps">
        <li>
          Sur <b>strava.com/settings/api</b>, créez votre application Strava (gratuite) : nom et site au choix,
          « Authorization Callback Domain » : <code>{callbackDomain(location.hostname, capabilities.isDesktop)}</code>.
        </li>
        <li>Copiez ici son Client ID et son Client Secret.</li>
        <li>
          « Se connecter » ouvre Strava {capabilities.isDesktop ? 'dans votre navigateur' : 'dans une fenêtre'} : autorisez
          la lecture de vos activités.
        </li>
        <li>Choisissez les activités à importer.</li>
      </ol>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-client`}>
          Client ID
        </label>
        <input id={`${id}-client`} className="input" inputMode="numeric" autoComplete="off" value={clientId} disabled={waiting} onChange={(e) => setClientId(e.currentTarget.value)} />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-secret`}>
          Client Secret
        </label>
        <input id={`${id}-secret`} className="input" type="password" autoComplete="off" value={clientSecret} disabled={waiting} onChange={(e) => setClientSecret(e.currentTarget.value)} />
      </div>
      <p className="field__hint">
        Ils restent sur cet appareil et ne sont envoyés qu’à Strava. Lecture seule de vos activités, privées comprises, trace
        entière (zones de confidentialité comprises) : pensez-y avant de publier un film.
      </p>
      {error && (
        <p className="field__hint" role="alert">
          {error}
        </p>
      )}
      {waiting ? (
        <div className="strava__actions">
          <p className="field__hint">En attente de votre autorisation sur Strava…</p>
          <button type="button" className="btn btn--secondary" onClick={() => pending.current?.abort()}>
            Annuler
          </button>
        </div>
      ) : (
        <div className="strava__actions">
          {hasSaved && (
            <button type="button" className="btn btn--secondary" onClick={forget}>
              Oublier ces identifiants
            </button>
          )}
          <button type="submit" className="btn btn--primary" disabled={!clientId.trim() || !clientSecret.trim()}>
            Se connecter
          </button>
        </div>
      )}
    </form>
  )
}

/** The athlete's activities, 30 at a time (« Plus »), filtered by name; the ticked ones are imported. */
function ActivityPicker({ onSignedOut, onImported }: { onSignedOut(message: string | null): void; onImported(): void }) {
  const id = useId()
  const [athlete] = useState(() => loadTokens()?.athlete ?? '')
  // a new object loads its page again (« Réessayer » after an error)
  const [request, setRequest] = useState({ page: 1 })
  const [activities, setActivities] = useState<StravaActivity[]>([])
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())

  useEffect(() => {
    const controller = new AbortController()
    listActivities(request.page, controller.signal).then(
      (page) => {
        setActivities((list) => [...list, ...page])
        setMore(page.length === ACTIVITIES_PER_PAGE)
        setBusy(false)
      },
      (err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof StravaAuthError) return onSignedOut(err.message)
        setError(errorText(err))
        setBusy(false)
      },
    )
    return () => controller.abort()
  }, [request, onSignedOut])

  const toggle = (activityId: number) =>
    setSelected((set) => {
      const next = new Set(set)
      if (!next.delete(activityId)) next.add(activityId)
      return next
    })

  /** « Plus », or « Réessayer » the page that failed */
  function loadNext() {
    setBusy(true)
    setError(null)
    setRequest({ page: error ? request.page : request.page + 1 })
  }

  function importSelected() {
    const chosen = activities.filter((a) => selected.has(a.id))
    onImported()
    void runImport(
      chosen.map((activity) => ({
        label: activity.name,
        run: async (colorIndex) => assignColors([streamsToTrack(activity, await fetchStreams(activity.id))], colorIndex),
      })),
    )
  }

  const needle = query.trim().toLowerCase()
  const shown = needle ? activities.filter((a) => a.name.toLowerCase().includes(needle)) : activities

  return (
    <div className="strava__body">
      <div className="strava__actions">
        <p className="field__hint">Connecté à Strava{athlete ? ` : ${athlete}` : ''}</p>
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={() => {
            disconnect()
            onSignedOut(null)
          }}
        >
          Déconnecter
        </button>
      </div>
      <input
        className="input"
        type="search"
        aria-label="Rechercher une activité par son nom"
        placeholder="Rechercher par nom (activités affichées)"
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <ul className="strava__list" aria-describedby={`${id}-status`}>
        {shown.map((activity) => (
          <li key={activity.id}>
            <label className="strava__item">
              <input type="checkbox" checked={selected.has(activity.id)} onChange={() => toggle(activity.id)} />
              <span className="strava__name">{activity.name}</span>
              <span className="strava__meta">
                {[
                  new Date(activity.start_date_local).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
                  stravaSportLabel(activity),
                  formatDistance(activity.distance),
                  `D+ ${formatAscent(activity.total_elevation_gain)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p id={`${id}-status`} className="field__hint">
        {busy ? 'Chargement des activités…' : shown.length === 0 ? 'Aucune activité.' : 'Activités lues sur Strava, affichées à vous seul.'}
      </p>
      {error && (
        <p className="field__hint" role="alert">
          {error}
        </p>
      )}
      <div className="strava__actions">
        {(more || error) && (
          <button type="button" className="btn btn--secondary" onClick={loadNext} disabled={busy}>
            {error ? 'Réessayer' : 'Plus'}
          </button>
        )}
        <button type="button" className="btn btn--primary" onClick={importSelected} disabled={selected.size === 0}>
          Importer{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
      </div>
    </div>
  )
}

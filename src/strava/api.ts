/**
 * Strava API v3 for « Importer depuis Strava ». Strava has no PKCE: exchanging the authorization code needs the client
 * secret. With no server of its own, OpenFlyover lets the user bring their own Strava API application: its Client ID
 * and Secret are kept with the tokens in the platform storage and only ever sent to strava.com. Strava answers browsers
 * with CORS, so the site and the desktop webview call it directly. See ARCHITECTURE.md "Strava import".
 *
 * URL builders, callback parsing, refresh decision and error texts are pure (tested); the rest reads the storage and
 * calls `fetch`.
 */
import { getPlatform } from '../platform'

export const STRAVA_AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize'
export const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token'
const STRAVA_API = 'https://www.strava.com/api/v3'
/** Read only, private activities included, and the whole trace (privacy zones are not cut off). */
export const STRAVA_SCOPE = 'activity:read_all'
export const ACTIVITIES_PER_PAGE = 30
const STREAM_KEYS = 'latlng,time,altitude,heartrate,cadence,watts'
/** The access token (6 h) is renewed this long before it expires. */
const REFRESH_MARGIN_MS = 60_000

const APP_KEY = 'openflyover.strava.app.v1'
const TOKENS_KEY = 'openflyover.strava.tokens.v1'

/** The user's own Strava API application. */
export interface StravaApp {
  clientId: string
  clientSecret: string
}

export interface StravaTokens {
  accessToken: string
  refreshToken: string
  /** ms since 1970 */
  expiresAt: number
  /** athlete's name, shown while connected */
  athlete: string
}

/** The fields of an activity of `/athlete/activities` used here. */
export interface StravaActivity {
  id: number
  name: string
  sport_type?: string
  type?: string
  /** ISO UTC */
  start_date: string
  /** ISO, the wall clock of the place written as UTC */
  start_date_local: string
  /** metres */
  distance: number
  total_elevation_gain: number
  /** seconds ahead of UTC at the start */
  utc_offset?: number
}

/** Streams of `/activities/{id}/streams` (`key_by_type`), each aligned on the same samples; absent when not recorded. */
export interface StravaStreams {
  latlng?: { data: [number, number][] }
  /** seconds since the start */
  time?: { data: number[] }
  altitude?: { data: number[] }
  heartrate?: { data: number[] }
  cadence?: { data: number[] }
  watts?: { data: (number | null)[] }
}

/** The tokens no longer work (access revoked, authorization expired): the user must connect again. */
export class StravaAuthError extends Error {}

// ---------------------------------------------------------------------------
// URLs and pure decisions
// ---------------------------------------------------------------------------

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: STRAVA_SCOPE,
    state,
  })
  return `${STRAVA_AUTHORIZE_URL}?${params}`
}

/** Form body of the token request: first exchange (`code`) or renewal (`refreshToken`). */
export function tokenRequestBody(app: StravaApp, grant: { code: string } | { refreshToken: string }): URLSearchParams {
  const body = new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret })
  if ('code' in grant) {
    body.set('code', grant.code)
    body.set('grant_type', 'authorization_code')
  } else {
    body.set('refresh_token', grant.refreshToken)
    body.set('grant_type', 'refresh_token')
  }
  return body
}

export function activitiesUrl(page: number): string {
  return `${STRAVA_API}/athlete/activities?page=${page}&per_page=${ACTIVITIES_PER_PAGE}`
}

export function streamsUrl(activityId: number): string {
  return `${STRAVA_API}/activities/${activityId}/streams?keys=${STREAM_KEYS}&key_by_type=true`
}

/**
 * « Authorization Callback Domain » to give the Strava application: Strava always accepts localhost and 127.0.0.1
 * (development, and the desktop app which listens on 127.0.0.1), otherwise the host of the site.
 */
export function callbackDomain(hostname: string, isDesktop: boolean): string {
  return isDesktop || hostname === '127.0.0.1' || hostname === 'localhost' ? 'localhost' : hostname
}

/** The authorization code of Strava's redirect (`?state=…&code=…&scope=…`, or `?error=access_denied`). */
export function parseCallback(params: URLSearchParams, expectedState: string): string {
  if (params.get('state') !== expectedState) throw new Error('Réponse de Strava inattendue : recommencez la connexion.')
  if (params.get('error') === 'access_denied') throw new Error('Autorisation refusée sur Strava.')
  const code = params.get('code')
  if (!code) throw new Error('Réponse de Strava inattendue : recommencez la connexion.')
  const scopes = (params.get('scope') ?? '').split(/[ ,]/)
  if (!scopes.includes('activity:read_all') && !scopes.includes('activity:read')) {
    throw new Error('Strava n’autorise pas la lecture de vos activités : reconnectez-vous en la laissant cochée.')
  }
  return code
}

export function needsRefresh(tokens: Pick<StravaTokens, 'expiresAt'>, nowMs: number): boolean {
  return nowMs >= tokens.expiresAt - REFRESH_MARGIN_MS
}

/** Tokens of a token response; the athlete comes with the first exchange only (`previousAthlete` on a renewal). */
export function tokensFromResponse(json: unknown, previousAthlete = ''): StravaTokens {
  const r = (json ?? {}) as { access_token?: unknown; refresh_token?: unknown; expires_at?: unknown; athlete?: { firstname?: unknown; lastname?: unknown } }
  if (typeof r.access_token !== 'string' || typeof r.refresh_token !== 'string' || typeof r.expires_at !== 'number') {
    throw new Error('Réponse de Strava incomplète.')
  }
  const names = [r.athlete?.firstname, r.athlete?.lastname].filter((n): n is string => typeof n === 'string' && n !== '')
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: r.expires_at * 1000,
    athlete: names.length > 0 ? names.join(' ') : previousAthlete,
  }
}

/**
 * Error of a failed Strava answer. A refused application (wrong Client ID / Secret) leaves the form as it is; a
 * refused token or authorization is a `StravaAuthError` (connect again).
 */
export function stravaError(status: number, body: unknown, endpoint: 'token' | 'api'): Error {
  if (status === 429) {
    return new Error('Strava limite les requêtes (100 par quart d’heure, 1 000 par jour) : réessayez dans un quart d’heure.')
  }
  if (endpoint === 'token' && (status === 400 || status === 401)) {
    const resource = (body as { errors?: { resource?: unknown }[] } | null)?.errors?.[0]?.resource
    if (resource === 'Application') return new Error('Client ID ou Client Secret refusé par Strava : vérifiez-les sur strava.com/settings/api.')
    return new StravaAuthError('Autorisation Strava expirée : reconnectez-vous.')
  }
  if (status === 401) return new StravaAuthError('Accès à Strava refusé ou retiré : reconnectez-vous.')
  if (status === 403) return new Error('Strava refuse l’accès à cette activité.')
  if (status === 404) return new Error('Activité introuvable sur Strava.')
  return new Error(`Strava ne répond pas comme prévu (HTTP ${status}).`)
}

// ---------------------------------------------------------------------------
// Storage (this device only)
// ---------------------------------------------------------------------------

function readJson<T>(key: string, isValid: (value: Partial<T>) => boolean): T | null {
  try {
    const value = JSON.parse(getPlatform().storage.get(key) ?? 'null') as Partial<T> | null
    return value && isValid(value) ? (value as T) : null
  } catch {
    return null
  }
}

export function loadApp(): StravaApp | null {
  return readJson<StravaApp>(APP_KEY, (a) => typeof a.clientId === 'string' && typeof a.clientSecret === 'string')
}

export function saveApp(app: StravaApp): void {
  getPlatform().storage.set(APP_KEY, JSON.stringify(app))
}

export function forgetApp(): void {
  getPlatform().storage.remove(APP_KEY)
}

export function loadTokens(): StravaTokens | null {
  return readJson<StravaTokens>(TOKENS_KEY, (t) => typeof t.accessToken === 'string' && typeof t.refreshToken === 'string' && typeof t.expiresAt === 'number')
}

function saveTokens(tokens: StravaTokens): void {
  getPlatform().storage.set(TOKENS_KEY, JSON.stringify(tokens))
}

/** « Déconnecter » : forget the tokens (the application stays, to connect again in one click). */
export function disconnect(): void {
  getPlatform().storage.remove(TOKENS_KEY)
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

async function request(url: string, init: RequestInit, endpoint: 'token' | 'api'): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('Strava est injoignable : vérifiez la connexion internet.')
  }
  const body: unknown = await response.json().catch(() => null)
  if (response.ok) return body
  const error = stravaError(response.status, body, endpoint)
  if (error instanceof StravaAuthError) disconnect()
  throw error
}

async function requestTokens(app: StravaApp, grant: { code: string } | { refreshToken: string }): Promise<unknown> {
  return request(STRAVA_TOKEN_URL, { method: 'POST', body: tokenRequestBody(app, grant) }, 'token')
}

/** Exchange the code of Strava's redirect and keep the tokens. */
export async function connect(app: StravaApp, code: string): Promise<StravaTokens> {
  const tokens = tokensFromResponse(await requestTokens(app, { code }))
  saveTokens(tokens)
  return tokens
}

/** A valid access token, renewed when it is about to expire. */
async function accessToken(): Promise<string> {
  const tokens = loadTokens()
  const app = loadApp()
  if (!tokens || !app) throw new StravaAuthError('Connectez-vous à Strava.')
  if (!needsRefresh(tokens, Date.now())) return tokens.accessToken
  const renewed = tokensFromResponse(await requestTokens(app, { refreshToken: tokens.refreshToken }), tokens.athlete)
  saveTokens(renewed)
  return renewed.accessToken
}

async function apiGet(url: string, signal?: AbortSignal): Promise<unknown> {
  return request(url, { headers: { Authorization: `Bearer ${await accessToken()}` }, signal }, 'api')
}

/** Page `page` (from 1) of the athlete's activities, most recent first. */
export async function listActivities(page: number, signal?: AbortSignal): Promise<StravaActivity[]> {
  const body = await apiGet(activitiesUrl(page), signal)
  return Array.isArray(body) ? (body as StravaActivity[]) : []
}

export async function fetchStreams(activityId: number): Promise<StravaStreams> {
  return ((await apiGet(streamsUrl(activityId))) ?? {}) as StravaStreams
}

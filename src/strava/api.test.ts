import { describe, expect, it } from 'vitest'
import {
  StravaAuthError,
  activitiesUrl,
  authorizeUrl,
  callbackDomain,
  needsRefresh,
  parseCallback,
  streamsUrl,
  stravaError,
  tokenRequestBody,
  tokensFromResponse,
} from './api'

const APP = { clientId: '12345', clientSecret: 'secret' }

describe('URLs', () => {
  it('builds the authorization page with the redirect, the scope and the state', () => {
    const url = new URL(authorizeUrl('12345', 'http://127.0.0.1:5173/oauth-callback.html', 'abc'))
    expect(url.origin + url.pathname).toBe('https://www.strava.com/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '12345',
      redirect_uri: 'http://127.0.0.1:5173/oauth-callback.html',
      response_type: 'code',
      approval_prompt: 'auto',
      scope: 'activity:read_all',
      state: 'abc',
    })
  })

  it('builds the token requests: code exchange and renewal', () => {
    expect(Object.fromEntries(tokenRequestBody(APP, { code: 'c0de' }))).toEqual({
      client_id: '12345',
      client_secret: 'secret',
      code: 'c0de',
      grant_type: 'authorization_code',
    })
    expect(Object.fromEntries(tokenRequestBody(APP, { refreshToken: 'r' }))).toEqual({
      client_id: '12345',
      client_secret: 'secret',
      refresh_token: 'r',
      grant_type: 'refresh_token',
    })
  })

  it('builds the activity list and streams URLs', () => {
    expect(activitiesUrl(2)).toBe('https://www.strava.com/api/v3/athlete/activities?page=2&per_page=30')
    expect(streamsUrl(987)).toBe(
      'https://www.strava.com/api/v3/activities/987/streams?keys=latlng,time,altitude,heartrate,cadence,watts&key_by_type=true',
    )
  })

  it('gives localhost as callback domain for development and the desktop app, else the host of the site', () => {
    expect(callbackDomain('127.0.0.1', false)).toBe('localhost')
    expect(callbackDomain('localhost', false)).toBe('localhost')
    expect(callbackDomain('tauri.localhost', true)).toBe('localhost')
    expect(callbackDomain('flyover.example.org', false)).toBe('flyover.example.org')
  })
})

describe('parseCallback', () => {
  const params = (query: string) => new URLSearchParams(query)

  it('returns the code of a redirect with the expected state and an activity scope', () => {
    expect(parseCallback(params('?state=s1&code=abc&scope=read,activity:read_all'), 's1')).toBe('abc')
    expect(parseCallback(params('state=s1&code=abc&scope=read,activity:read'), 's1')).toBe('abc')
  })

  it('rejects another state, a refusal, a missing code or a scope without activities', () => {
    expect(() => parseCallback(params('state=other&code=abc&scope=activity:read_all'), 's1')).toThrow(/inattendue/)
    expect(() => parseCallback(params('state=s1&error=access_denied'), 's1')).toThrow('Autorisation refusée sur Strava.')
    expect(() => parseCallback(params('state=s1&scope=activity:read_all'), 's1')).toThrow(/inattendue/)
    expect(() => parseCallback(params('state=s1&code=abc&scope=read'), 's1')).toThrow(/lecture de vos activités/)
  })
})

describe('tokens', () => {
  it('renews a token one minute before it expires', () => {
    const tokens = { expiresAt: 10_000_000 }
    expect(needsRefresh(tokens, 10_000_000 - 120_000)).toBe(false)
    expect(needsRefresh(tokens, 10_000_000 - 30_000)).toBe(true)
    expect(needsRefresh(tokens, 10_000_001)).toBe(true)
  })

  it('reads a token response, the athlete of the first exchange kept on renewals', () => {
    const first = tokensFromResponse({
      access_token: 'a',
      refresh_token: 'r',
      expires_at: 1_700_000_000,
      athlete: { firstname: 'Marie', lastname: 'Paradis' },
    })
    expect(first).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 1_700_000_000_000, athlete: 'Marie Paradis' })
    expect(tokensFromResponse({ access_token: 'b', refresh_token: 'r2', expires_at: 1 }, first.athlete).athlete).toBe('Marie Paradis')
    expect(() => tokensFromResponse({ message: 'Bad Request' })).toThrow('Réponse de Strava incomplète.')
  })
})

describe('stravaError', () => {
  it('explains the rate limit', () => {
    expect(stravaError(429, null, 'api').message).toMatch(/100 par quart d’heure, 1 000 par jour/)
    expect(stravaError(429, null, 'token')).not.toBeInstanceOf(StravaAuthError)
  })

  it('asks to connect again when the access is revoked or the authorization expired', () => {
    expect(stravaError(401, null, 'api')).toBeInstanceOf(StravaAuthError)
    const expired = { message: 'Bad Request', errors: [{ resource: 'RefreshToken', field: 'refresh_token', code: 'invalid' }] }
    expect(stravaError(400, expired, 'token')).toBeInstanceOf(StravaAuthError)
  })

  it('keeps the form for a refused application', () => {
    const refused = { message: 'Authorization Error', errors: [{ resource: 'Application', field: '', code: 'invalid' }] }
    const error = stravaError(401, refused, 'token')
    expect(error).not.toBeInstanceOf(StravaAuthError)
    expect(error.message).toMatch(/Client ID ou Client Secret refusé/)
  })

  it('says what else went wrong', () => {
    expect(stravaError(404, null, 'api').message).toBe('Activité introuvable sur Strava.')
    expect(stravaError(403, null, 'api').message).toMatch(/refuse l’accès/)
    expect(stravaError(503, null, 'api').message).toMatch(/HTTP 503/)
  })
})

/**
 * Authorization in the browser for an OAuth provider (Strava), and its redirect back to the app.
 *
 * Web: the provider opens in a popup and redirects it to `/oauth-callback.html` on the same site, a static page that
 * passes its query to this window over a BroadcastChannel and closes; the app window keeps its state (no reload).
 * Desktop: tauri-plugin-oauth listens on a free port of 127.0.0.1 for the redirect, the provider opens in the system
 * browser (tauri-plugin-opener), and the redirect's URL comes back as the `oauth://url` event. The plugins' commands
 * are invoked directly (what their small JS packages do), so no package is added for three calls.
 */
import type { Capabilities } from './platform'

/** Static page of `public/` that receives the redirect on the web. */
const WEB_CALLBACK_PATH = `${import.meta.env.BASE_URL}oauth-callback.html`
const CHANNEL = 'openflyover-oauth'
/** Page the desktop listener answers the browser with. */
const DESKTOP_RESPONSE =
  '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>OpenFlyover</title></head><body style="font-family:system-ui;margin:3rem">' +
  '<p>Connexion transmise à OpenFlyover : vous pouvez fermer cet onglet.</p></body></html>'

function abortError(): DOMException {
  return new DOMException('Connexion annulée', 'AbortError')
}

/**
 * Open the provider's page `urlFor(redirectUri)` and resolve with the query of its redirect. Rejects with an
 * `AbortError` when `signal` aborts. On the web, call it from the user's click (before any await): it opens a popup.
 */
export function authorizeInBrowser(
  capabilities: Pick<Capabilities, 'isDesktop'>,
  urlFor: (redirectUri: string) => string,
  signal: AbortSignal,
): Promise<URLSearchParams> {
  return capabilities.isDesktop ? authorizeOnDesktop(urlFor, signal) : authorizeInPopup(urlFor, signal)
}

function authorizeInPopup(urlFor: (redirectUri: string) => string, signal: AbortSignal): Promise<URLSearchParams> {
  const redirectUri = new URL(WEB_CALLBACK_PATH, location.origin).href
  const popup = window.open(urlFor(redirectUri), CHANNEL, 'popup,width=560,height=760')
  if (!popup) return Promise.reject(new Error('Fenêtre de connexion bloquée : autorisez les fenêtres surgissantes pour ce site.'))
  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(CHANNEL)
    const finish = () => {
      channel.close()
      signal.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      finish()
      popup.close()
      reject(abortError())
    }
    channel.onmessage = (event: MessageEvent) => {
      finish()
      resolve(new URLSearchParams(String(event.data)))
    }
    signal.addEventListener('abort', onAbort)
  })
}

async function authorizeOnDesktop(urlFor: (redirectUri: string) => string, signal: AbortSignal): Promise<URLSearchParams> {
  const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')])
  let received: (url: string) => void = () => undefined
  const redirect = new Promise<string>((resolve) => (received = resolve))
  const unlisten = await listen<string>('oauth://url', (event) => received(event.payload))
  const port = await invoke<number>('plugin:oauth|start', { config: { response: DESKTOP_RESPONSE } })
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(abortError())
    signal.addEventListener('abort', () => reject(abortError()), { once: true })
  })
  try {
    // 127.0.0.1 rather than localhost: the listener is bound to it, and providers accept both
    await invoke('plugin:opener|open_url', { url: urlFor(`http://127.0.0.1:${port}/`) })
    return new URL(await Promise.race([redirect, aborted])).searchParams
  } finally {
    unlisten()
    // the listener stops by itself after the redirect: cancelling it then fails, harmlessly
    void invoke('plugin:oauth|cancel', { port }).catch(() => undefined)
  }
}

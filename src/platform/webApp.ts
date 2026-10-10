/**
 * Installable web app (website only, never in the desktop app): registers the service worker built from
 * `serviceWorker.js`, offers « Nouvelle version disponible » when a new one waits, and tells iOS users once how to add
 * the app to the home screen (iOS has no install prompt). See ARCHITECTURE.md "Installable web app".
 */
import { showToast } from '../ui/toast'
import { getPlatform } from './index'
import { isTauriRuntime } from './platform'

const IOS_HINT_KEY = 'openflyover.iosInstallHint.v1'
const IOS_HINT_DELAY_MS = 4000

export const UPDATE_TEXT = 'Nouvelle version disponible'
export const IOS_INSTALL_TEXT = "Pour installer OpenFlyover : touchez Partager, puis « Sur l'écran d'accueil »."

/** The service worker runs on the built website over HTTPS (or localhost), never inside Tauri nor in development. */
export function shouldRegisterServiceWorker(scope: object, production: boolean): boolean {
  const nav = (scope as { navigator?: object }).navigator
  return (
    production &&
    !isTauriRuntime(scope) &&
    (scope as { isSecureContext?: boolean }).isSecureContext === true &&
    !!nav &&
    'serviceWorker' in nav
  )
}

/** iPhone, iPod or iPad (iPadOS reports a Mac with a touch screen) in a browser tab, not the installed app. */
export function wantsIosInstallHint(nav: { userAgent: string; maxTouchPoints?: number; standalone?: boolean }): boolean {
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1)
  return ios && nav.standalone !== true
}

function offerUpdate(registration: ServiceWorkerRegistration): void {
  const waiting = registration.waiting
  if (!waiting || !navigator.serviceWorker.controller) return
  showToast({
    kind: 'info',
    text: UPDATE_TEXT,
    action: {
      label: 'Recharger',
      run: () => {
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true })
        waiting.postMessage({ type: 'SKIP_WAITING' })
      },
    },
  })
}

async function register(): Promise<void> {
  const base = import.meta.env.BASE_URL
  const registration = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base })
  offerUpdate(registration)
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') offerUpdate(registration)
    })
  })
}

/** Called once at start-up (main.tsx); does nothing in the desktop app. */
export function installWebApp(): void {
  if (!shouldRegisterServiceWorker(globalThis, import.meta.env.PROD)) return
  register().catch((error: unknown) => console.warn('[app] service worker non installé :', error))
  const storage = getPlatform().storage
  if (!wantsIosInstallHint(navigator) || storage.get(IOS_HINT_KEY)) return
  setTimeout(() => {
    storage.set(IOS_HINT_KEY, '1')
    showToast({ kind: 'info', text: IOS_INSTALL_TEXT, action: { label: 'Compris', run: () => undefined } })
  }, IOS_HINT_DELAY_MS)
}

/**
 * Installable web app (website only, never in the desktop app): registers the service worker built from
 * `serviceWorker.js`, looks for a new one while the app is open, offers « Nouvelle version disponible » when it waits,
 * and tells iOS users once how to add the app to the home screen (iOS has no install prompt). See ARCHITECTURE.md "Installable web app".
 */
import { showToast } from '../ui/toast'
import { getPlatform } from './index'
import { isAppleMobile, isTauriRuntime } from './platform'

/** cache where the service worker keeps the files of a share (serviceWorker.js) */
const SHARE_CACHE = 'openflyover-share'
/** query of the page the share target opens */
const SHARE_PARAM = 'partage'
const IOS_HINT_KEY = 'openflyover.iosInstallHint.v1'
const IOS_HINT_DELAY_MS = 4000
/** an open app looks for a new version this often, and when it is shown again (at most once per UPDATE_MIN_GAP_MS) */
export const UPDATE_CHECK_MS = 60 * 60 * 1000
export const UPDATE_MIN_GAP_MS = 10 * 60 * 1000

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

/** iPhone or iPad in a browser tab, not the installed app. */
export function wantsIosInstallHint(nav: { userAgent: string; maxTouchPoints?: number; standalone?: boolean }): boolean {
  return isAppleMobile(nav) && nav.standalone !== true
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

/**
 * Looks for a new version while the app stays open (an installed app may stay open for days): every UPDATE_CHECK_MS
 * and when the page is shown again, never while hidden. A new worker found ends in `offerUpdate`. Returns the cleanup.
 */
export function watchForUpdates(
  registration: { update(): Promise<unknown> },
  doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>,
  now: () => number = Date.now,
): () => void {
  let last = now()
  const check = () => {
    if (doc.visibilityState !== 'visible' || now() - last < UPDATE_MIN_GAP_MS) return
    last = now()
    registration.update().catch(() => undefined) // offline: next time
  }
  const timer = setInterval(check, UPDATE_CHECK_MS)
  doc.addEventListener('visibilitychange', check)
  return () => {
    clearInterval(timer)
    doc.removeEventListener('visibilitychange', check)
  }
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
  watchForUpdates(registration, document)
}

/**
 * Name of a shared file, with the extension the import needs: Android apps may share a track under a bare name.
 * `head`: its first bytes (a FIT header says ".FIT" at byte 8).
 */
export function sharedFileName(name: string, head: Uint8Array): string {
  if (/\.(gpx|fit|json)$/i.test(name)) return name
  if (String.fromCharCode(...head.subarray(8, 12)) === '.FIT') return `${name}.fit`
  if (/<gpx[\s>]/.test(new TextDecoder().decode(head))) return `${name}.gpx`
  return name
}

/** Files of an Android share (share target of the manifest), kept by the service worker; empty otherwise. */
async function takeSharedFiles(): Promise<File[]> {
  const url = new URL(location.href)
  if (!url.searchParams.has(SHARE_PARAM)) return []
  url.searchParams.delete(SHARE_PARAM)
  history.replaceState(history.state, '', url)
  const cache = await caches.open(SHARE_CACHE)
  const files: File[] = []
  for (const request of await cache.keys()) {
    const response = await cache.match(request)
    if (!response) continue
    const blob = await response.blob()
    const name = decodeURIComponent(response.headers.get('x-file-name') ?? '') || 'trace'
    const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer())
    files.push(new File([blob], sharedFileName(name, head), { type: blob.type }))
  }
  await caches.delete(SHARE_CACHE)
  return files
}

/**
 * Called once at start-up (main.tsx); does nothing in the desktop app. `openShared` gets the tracks shared to the
 * installed app (Android).
 */
export function installWebApp(openShared: (files: File[]) => void): void {
  if (!shouldRegisterServiceWorker(globalThis, import.meta.env.PROD)) return
  register().catch((error: unknown) => console.warn('[app] service worker non installé :', error))
  takeSharedFiles()
    .then((files) => files.length > 0 && openShared(files))
    .catch((error: unknown) => console.warn('[app] fichiers partagés illisibles :', error))
  const storage = getPlatform().storage
  if (!wantsIosInstallHint(navigator) || storage.get(IOS_HINT_KEY)) return
  setTimeout(() => {
    storage.set(IOS_HINT_KEY, '1')
    showToast({ kind: 'info', text: IOS_INSTALL_TEXT, action: { label: 'Compris', run: () => undefined } })
  }, IOS_HINT_DELAY_MS)
}

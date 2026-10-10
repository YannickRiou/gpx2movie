/**
 * Service worker of the website (not of the desktop app), emitted as `sw.js` by vite.config.ts, which fills the three
 * constants below. Rules (ARCHITECTURE.md "Installable web app"):
 * - the app shell and the build files are precached at install, in a cache named after the build;
 * - the sky and cloud textures (~12 MB) are cached on first use, in a cache named after their content, kept across
 *   releases;
 * - cross-origin requests (tiles, weather, Overpass, Strava) are never touched: the app has its own tile cache;
 * - a POST of the share target keeps the shared files for the page, which imports them.
 * Never deletes the caches of the app itself (offline packs, « Mes projets »).
 */
/** URLs relative to the scope, filled at build time */
const PRECACHE = /* PRECACHE */ []
/** build hash */
const VERSION = /* VERSION */ 'dev'
/** hash of the sky and cloud textures */
const SKY_VERSION = /* SKY_VERSION */ 'dev'

const SHELL_CACHE = `openflyover-shell-${VERSION}`
const SKY_CACHE = `openflyover-sky-${SKY_VERSION}`
const SHARE_CACHE = 'openflyover-share'
const OWN_CACHES = /^openflyover-(shell|sky)-/
const RUNTIME_PREFIXES = ['atmosphere/', 'clouds/']

const scope = () => self.registration.scope
const local = (url) => (url.startsWith(scope()) ? url.slice(scope().length) : null)

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((path) => new Request(new URL(path, scope()), { cache: 'reload' })))),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => OWN_CACHES.test(n) && n !== SHELL_CACHE && n !== SKY_CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

// the page accepted « Nouvelle version disponible »
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

/** Shared files kept for the page (`takeSharedFiles` in webApp.ts), then the app opened. */
async function receiveShare(request) {
  const form = await request.formData()
  const files = form.getAll('tracks').filter((f) => typeof f !== 'string')
  await caches.delete(SHARE_CACHE)
  const cache = await caches.open(SHARE_CACHE)
  await Promise.all(
    files.map((file, i) =>
      cache.put(new URL(`share/${i}`, scope()), new Response(file, { headers: { 'x-file-name': encodeURIComponent(file.name) } })),
    ),
  )
  return Response.redirect(new URL('./?partage', scope()).href, 303)
}

async function fromCache(cacheName, request) {
  const cache = await caches.open(cacheName)
  // ignoreVary: servers answer `Vary: Origin`, and module scripts are requested with an Origin header
  const hit = await cache.match(request, { ignoreSearch: true, ignoreVary: true })
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const path = local(request.url)
  // another origin (tiles, weather, Overpass, Strava) or outside the scope: the network, untouched
  if (path === null) return
  if (request.method === 'POST' && path === 'share-target') return event.respondWith(receiveShare(request))
  if (request.method !== 'GET') return
  const name = path.split(/[?#]/)[0]
  if (request.mode === 'navigate' && (name === '' || name === 'index.html')) {
    event.respondWith(caches.match(new URL('./', scope()).href, { cacheName: SHELL_CACHE }).then((hit) => hit ?? fetch(request)))
  } else if (PRECACHE.includes(name)) {
    event.respondWith(fromCache(SHELL_CACHE, request))
  } else if (RUNTIME_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    event.respondWith(fromCache(SKY_CACHE, request))
  }
})

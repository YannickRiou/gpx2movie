/**
 * End-to-end smoke tests: the real app in a headless Chromium (software GPU, SwiftShader), one scenario after the
 * other in the same page. Starts its own Vite server on a free port (no file watching, no reload), so the source
 * tree as it is now is tested and the export store can be reached through its module URL.
 *
 *   npm run e2e
 *
 * Environment:
 *   OPENFLYOVER_CHROME            Chromium / Chrome executable (default: Playwright's headless shell when present)
 *   OPENFLYOVER_E2E_SKIP_EXPORT=1 skip the export scenario (the slowest, it needs the tile servers)
 *   OPENFLYOVER_E2E_ONLY=a,b      run only the scenarios whose id is listed (ids: see SCENARIOS)
 *
 * Fails on any console error or page error that is not network noise (ALLOWED_ERRORS). Screenshots of failed
 * scenarios and the downloaded files are kept in the output directory printed at the end.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEFAULT_CHROME = join(
  homedir(),
  '.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',
)
const CHROME = process.env.OPENFLYOVER_CHROME || (existsSync(DEFAULT_CHROME) ? DEFAULT_CHROME : '')
const SKIP_EXPORT = process.env.OPENFLYOVER_E2E_SKIP_EXPORT === '1'
const ONLY = (process.env.OPENFLYOVER_E2E_ONLY ?? '').split(',').filter(Boolean)
const OUT = mkdtempSync(join(tmpdir(), 'openflyover-e2e-'))
const DOWNLOADS = join(OUT, 'downloads')
mkdirSync(DOWNLOADS)

/** Software GPU: generous timeouts. */
const STEP_MS = 60_000
const EXPORT_MS = 600_000

/**
 * Console errors that are network noise, not bugs: tiles, weather, Overpass (slow, rate-limited or refused
 * servers). Everything else fails the scenario.
 */
const ALLOWED_ERRORS = [
  /Failed to load resource: the server responded with a status of (4|5)\d\d/,
  /Failed to load resource: net::ERR_/,
  /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION|TIMED_OUT|NETWORK|HTTP2|QUIC|SSL|ABORTED)/,
  /\b(tile|tuile)s?\b.*(fail|échec|erreur|error)/i,
  /overpass|open-meteo/i,
  // SwiftShader / ANGLE chatter
  /GL_INVALID_|WebGL: too many errors|GPU stall due to ReadPixels/,
]

const log = (...args) => console.log(...args)
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`

// ---------------------------------------------------------------------------------------------------- helpers

/** Waits until `fn` (run in the page) returns a truthy value. */
const until = (page, fn, arg, timeout = STEP_MS) => page.waitForFunction(fn, { timeout, polling: 250 }, arg)

/** Clicks the first visible button whose text contains `text`. */
async function clickButton(page, text, timeout = STEP_MS) {
  const button = await page.waitForSelector(`button::-p-text(${text})`, { visible: true, timeout })
  await button.click()
}

/** Number of blocks in a timeline lane (« Plans », « Arrêts », « Textes »…). */
const laneCount = (page, lane) =>
  page.evaluate(
    (name) => document.querySelectorAll(`[role="group"][aria-label="${name}"] .film-tl__block`).length,
    lane,
  )

/**
 * The 3D scene, loaded in its own chunk after the timeline shows: its WebGL canvas (three.js tags it) is there, so
 * the export controller it holds is mounted.
 */
const waitForScene = (page) => page.waitForSelector('canvas[data-engine^="three.js"]', { timeout: STEP_MS })

/** Takes the keyboard away from any field or button (shortcuts are ignored in a text field). */
const blur = (page) => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())

/** A file that appears in the download folder after `since` (finished: no .crdownload). */
async function waitForDownload(extension, since, timeout = STEP_MS) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const files = readdirSync(DOWNLOADS)
      .filter((name) => name.endsWith(extension))
      .map((name) => ({ name, path: join(DOWNLOADS, name), ...statSync(join(DOWNLOADS, name)) }))
      .filter((f) => f.mtimeMs >= since && f.size > 0)
    if (files.length > 0) return files[0]
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`aucun fichier ${extension} téléchargé en ${seconds(timeout)}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * The app's stores, reached through their module URLs on the dev server (same instances as the app's) and kept on
 * `window.__e2e`. A dynamic import evaluated from the test can fail once with « Promise was collected »: retried.
 */
async function exposeStores(page) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await page.evaluate(async () => {
        const [exportModule, appModule] = await Promise.all([import('/src/export/store.ts'), import('/src/state/store.ts')])
        window.__e2e = { exportStore: exportModule.useExportStore, isExportBusy: exportModule.isExportBusy, appStore: appModule.useAppStore }
        return true
      })
    } catch (error) {
      if (attempt >= 3) throw error
      log(`    accès aux stores : ${error.message}, nouvel essai`)
    }
  }
}

async function waitForExport(page, label) {
  const handle = await until(
    page,
    () => {
      const { phase, result, error, frame, frameCount } = window.__e2e.exportStore.getState()
      if (phase === 'done' || phase === 'error' || phase === 'canceled') return { phase, result, error, frame, frameCount }
      return null
    },
    undefined,
    EXPORT_MS,
  )
  const state = await handle.jsonValue()
  assert(state.phase === 'done', `${label} : phase « ${state.phase} »${state.error ? ` (${state.error})` : ''}`)
  return state
}

/** Size of the blob behind an object URL of the page. */
const blobSize = (page, url) => page.evaluate(async (u) => (await (await fetch(u)).blob()).size, url)

// -------------------------------------------------------------------------------------------------- scenarios

const SCENARIOS = [
  {
    id: 'accueil',
    title: "Accueil vide, puis l'exemple chargé",
    async run({ page, url }) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: STEP_MS })
      await page.waitForSelector('#empty-title::-p-text(Glissez vos traces)', { visible: true, timeout: STEP_MS })
      await clickButton(page, "Essayer avec l'exemple")
      await until(page, () => {
        const lane = document.querySelector('[role="group"][aria-label="Plans"]')
        const text = lane?.textContent ?? ''
        return text.includes('Ouverture') && text.includes('Survol') && text.includes('Clôture')
      })
      assert(!(await page.$('#empty-title')), "l'accueil est resté affiché après le chargement de l'exemple")
      await waitForScene(page)
    },
  },
  {
    id: 'onglets',
    title: 'Onglets du rail et aide des raccourcis',
    async run({ page }) {
      for (const tab of ['trace', 'carte', 'survol', 'habillage', 'projet']) {
        const open = await page.evaluate(
          (t) => document.getElementById(`tab-${t}`)?.getAttribute('aria-selected') === 'true' && !document.getElementById('side-panel')?.hidden,
          tab,
        )
        // a click on the open tab folds the panel
        if (!open) await page.click(`#tab-${tab}`)
        await until(
          page,
          (t) => {
            const panel = document.getElementById(`tab-panel-${t}`)
            return panel && !panel.hidden && !document.getElementById('side-panel')?.hidden && panel.getBoundingClientRect().width > 100
          },
          tab,
        )
      }
      // the « ? » button, then the « ? » key; Escape closes the dialog both times
      await page.click('button[aria-label="Raccourcis clavier"]')
      await page.waitForSelector('dialog.help[open]', { visible: true, timeout: STEP_MS })
      await page.keyboard.press('Escape')
      await until(page, () => !document.querySelector('dialog.help[open]'))
      await blur(page)
      await page.keyboard.press('?')
      await page.waitForSelector('dialog.help[open]', { visible: true, timeout: STEP_MS })
      await page.keyboard.press('Escape')
      await until(page, () => !document.querySelector('dialog.help[open]'))
    },
  },
  {
    id: 'timeline',
    title: 'Timeline : T ajoute un texte, Ctrl+Z le retire, S ajoute un arrêt',
    async run({ page }) {
      await blur(page)
      // into the flyover, away from the opening shot
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
      await page.keyboard.down('Shift')
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
      await page.keyboard.up('Shift')

      const texts = await laneCount(page, 'Textes')
      await page.keyboard.press('t')
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Textes"] .film-tl__block').length === n + 1, [texts])
      await page.keyboard.press('Escape')
      await blur(page)
      await page.keyboard.down('Control')
      await page.keyboard.press('z')
      await page.keyboard.up('Control')
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Textes"] .film-tl__block').length === n, [texts])

      const stops = await laneCount(page, 'Arrêts')
      await blur(page)
      await page.keyboard.press('s')
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Arrêts"] .film-tl__block').length === n + 1, [stops])
      await page.keyboard.press('Escape')
      await blur(page)
      // one text kept for the project round trip
      await page.keyboard.press('t')
      await until(page, ([n]) => document.querySelectorAll('[role="group"][aria-label="Textes"] .film-tl__block').length === n + 1, [texts])
      await page.keyboard.press('Escape')
    },
  },
  {
    id: 'projet',
    title: 'Projet enregistré puis rouvert',
    async run({ page, url }) {
      const before = { texts: await laneCount(page, 'Textes'), stops: await laneCount(page, 'Arrêts') }
      const since = Date.now() - 1000
      await clickButton(page, 'Enregistrer')
      await page.waitForSelector('.toast::-p-text(Projet enregistré)', { visible: true, timeout: STEP_MS })
      const file = await waitForDownload('.json', since)
      const project = JSON.parse(readFileSync(file.path, 'utf8'))
      assert(Array.isArray(project.tracks) && project.tracks.length === 1, 'le projet enregistré ne contient pas la trace')

      // a fresh page (nothing is saved automatically), then « Ouvrir un projet… » of the welcome card
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: STEP_MS })
      await page.waitForSelector('#empty-title', { visible: true, timeout: STEP_MS })
      const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: STEP_MS }), clickButton(page, 'Ouvrir un projet')])
      await chooser.accept([file.path])
      await page.waitForSelector('.toast::-p-text(ouvert)', { visible: true, timeout: STEP_MS })
      await until(page, () => (document.querySelector('[role="group"][aria-label="Plans"]')?.textContent ?? '').includes('Survol'))
      const after = { texts: await laneCount(page, 'Textes'), stops: await laneCount(page, 'Arrêts') }
      assert(
        after.texts === before.texts && after.stops === before.stops,
        `timeline différente après réouverture : avant ${JSON.stringify(before)}, après ${JSON.stringify(after)}`,
      )
    },
  },
  {
    id: 'export',
    title: 'Export : petite vidéo (320 × 180, 2 s, 10 i/s) et image fixe',
    skip: SKIP_EXPORT && 'OPENFLYOVER_E2E_SKIP_EXPORT=1',
    retries: 1,
    async run({ page }) {
      await until(page, () => !!document.querySelector('[role="group"][aria-label="Plans"]'))
      await waitForScene(page)
      await exposeStores(page)
      // after a failed attempt: the previous export stopped first
      await until(
        page,
        () => {
          const { exportStore, isExportBusy } = window.__e2e
          const { phase, cancel } = exportStore.getState()
          if (isExportBusy(phase)) cancel()
          return !isExportBusy(phase)
        },
        undefined,
        EXPORT_MS,
      )
      // no volumetric clouds: far too slow on a software GPU (minutes per frame)
      await page.evaluate(() => {
        const { settings, setSetting } = window.__e2e.appStore.getState()
        setSetting('clouds', { ...settings.clouds, mode: 'aucun' })
      })
      // the film: straight into the export store (the panel's sizes start at 720p)
      let since = Date.now() - 1000
      await page.evaluate(() => {
        const { exportStore } = window.__e2e
        exportStore.getState().reset()
        exportStore.getState().start({
          width: 320,
          height: 180,
          fps: 10,
          quality: 'standard',
          durationS: 2,
          holdStartS: 0,
          holdEndS: 0,
          baseName: 'e2e-film',
        })
      })
      const film = await waitForExport(page, 'vidéo')
      assert(film.result.sizeBytes > 0, 'vidéo vide')
      assert(/^video\//.test(film.result.mimeType), `type inattendu ${film.result.mimeType}`)
      assert((await blobSize(page, film.result.url)) === film.result.sizeBytes, 'taille du fichier vidéo incohérente')
      const video = await waitForDownload(film.result.fileName.slice(film.result.fileName.lastIndexOf('.')), since)
      const head = readFileSync(video.path).subarray(0, 12)
      assert(head.includes('ftyp') || head.readUInt32BE(0) === 0x1a45dfa3, 'le fichier vidéo n\'est ni un MP4 ni un WebM')
      log(`    vidéo : ${film.result.fileName}, ${film.result.codec}, ${video.size} octets, ${film.result.incompleteFrames} image(s) incomplète(s)`)

      // the still image: from the export drawer, at its smallest size
      await page.click('button.topbar__export')
      await page.waitForSelector('#export-dock:not([hidden]) button::-p-text(Image fixe)', { visible: true, timeout: STEP_MS })
      await page.evaluate(() => {
        const select = [...document.querySelectorAll('#export-dock select')].find((s) => [...s.options].some((o) => o.value === '720p'))
        if (!select) throw new Error('sélecteur de résolution introuvable')
        const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set
        setValue.call(select, '720p')
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      since = Date.now() - 1000
      await clickButton(page, 'Image fixe')
      const still = await waitForExport(page, 'image fixe')
      assert(still.result.mimeType === 'image/png' && still.result.sizeBytes > 0, `image fixe : ${still.result.mimeType}, ${still.result.sizeBytes} octets`)
      const png = await waitForDownload('.png', since)
      assert(readFileSync(png.path).subarray(1, 4).toString() === 'PNG', "le fichier image n'est pas un PNG")
      log(`    image : ${still.result.fileName}, ${png.size} octets, ${still.result.incompleteFrames} image(s) incomplète(s)`)
    },
  },
  {
    id: 'reconnaissance',
    title: 'Reconnaissance : relief sans trace, deux points de passage, itinéraire calculé',
    async run({ page, url }) {
      // Overpass answered in the page: a grid of paths every 0.002° around Chamonix (the public servers are not tested)
      const elements = []
      for (let i = 0; i <= 70; i++) {
        const lon = Math.round((6.8 + i * 0.002) * 1000) / 1000
        elements.push({ type: 'way', id: i + 1, tags: { highway: 'path' }, geometry: Array.from({ length: 51 }, (_, k) => ({ lon, lat: Math.round((45.87 + k * 0.002) * 1000) / 1000 })) })
      }
      for (let k = 0; k <= 50; k++) {
        const lat = Math.round((45.87 + k * 0.002) * 1000) / 1000
        elements.push({ type: 'way', id: 100 + k, tags: { highway: 'track' }, geometry: Array.from({ length: 71 }, (_, i) => ({ lon: Math.round((6.8 + i * 0.002) * 1000) / 1000, lat })) })
      }
      // only the Overpass calls answered this way (an interception of every request would break the tiles' CORS)
      await page.evaluateOnNewDocument((body) => {
        const fetch = window.fetch
        window.fetch = (input, init) =>
          /overpass-api\.de|maps\.mail\.ru/.test(String(input?.url ?? input))
            ? Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }))
            : fetch(input, init)
      }, JSON.stringify({ elements }))

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: STEP_MS })
      await page.waitForSelector('#place', { visible: true, timeout: STEP_MS })
      await page.type('#place', '45.92, 6.87')
      await page.keyboard.press('Enter')
      await until(page, () => !document.querySelector('#empty-title'))
      await waitForScene(page)
      // relief drawn under the pointer: the right-click offers « Point de passage ici »
      const canvas = await page.$('canvas[data-engine^="three.js"]')
      for (const [fx, fy] of [[0.4, 0.5], [0.6, 0.55]]) {
        const box = await canvas.boundingBox()
        for (let attempt = 0; ; attempt++) {
          await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, { button: 'right' })
          const item = await page.waitForSelector('button::-p-text(Point de passage ici)', { visible: true, timeout: 5000 }).catch(() => null)
          if (item) {
            await item.click()
            break
          }
          if (attempt >= 10) throw new Error('aucun relief sous le pointeur')
          await page.keyboard.press('Escape')
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      }
      const points = await page.$$eval('.route-point__name', (els) => els.map((e) => e.textContent))
      assert(points.join(',') === 'Départ,Arrivée', `points placés : ${points.join(', ')}`)
      await clickButton(page, "Calculer l'itinéraire")
      await page.waitForSelector('.toast::-p-text(Itinéraire)', { visible: true, timeout: STEP_MS })
      await until(page, () => (document.querySelector('[role="group"][aria-label="Plans"]')?.textContent ?? '').includes('Survol'))
      assert((await page.$$('.route-point')).length === 0, 'les points placés sont restés après le calcul')
    },
  },
]

// ----------------------------------------------------------------------------------------------------- runner

async function startServer() {
  const server = await createServer({
    root: ROOT,
    logLevel: 'warn',
    // its own dependency cache: a dev server of another session may be running
    cacheDir: join(ROOT, 'node_modules/.vite-e2e'),
    server: { host: '127.0.0.1', port: 5280, strictPort: false, hmr: false, watch: null },
  })
  await server.listen()
  return server
}

async function main() {
  if (!CHROME) throw new Error('Chromium introuvable : indiquez son chemin dans OPENFLYOVER_CHROME')
  const started = Date.now()
  const server = await startServer()
  const url = server.resolvedUrls.local[0]
  log(`Serveur ${url} · navigateur ${CHROME}`)

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--window-size=1440,900'],
    defaultViewport: { width: 1440, height: 900 },
    protocolTimeout: EXPORT_MS,
  })
  const results = []
  try {
    const cdp = await browser.target().createCDPSession()
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS })
    const page = await browser.newPage()
    page.setDefaultTimeout(STEP_MS)

    let errors = []
    const record = (text) => {
      if (!ALLOWED_ERRORS.some((re) => re.test(text))) errors.push(text)
    }
    page.on('console', (msg) => {
      // export timings (rendering, waiting for tiles, encoding)
      if (msg.text().startsWith('[export]')) log(`    ${msg.text()}`)
      if (msg.type() !== 'error') return
      const where = msg.location()?.url
      record(`${msg.text()}${where ? ` (${where})` : ''}`)
    })
    page.on('pageerror', (error) => record(`page : ${error.message}`))

    for (const scenario of SCENARIOS) {
      if (ONLY.length > 0 && !ONLY.includes(scenario.id)) continue
      if (scenario.skip) {
        log(`- ${scenario.title} : ignoré (${scenario.skip})`)
        results.push({ scenario, status: 'ignoré', ms: 0 })
        continue
      }
      let attempt = 0
      for (;;) {
        errors = []
        const t0 = Date.now()
        try {
          await scenario.run({ page, url })
          if (errors.length > 0) throw new Error(`erreurs dans la console :\n      ${errors.join('\n      ')}`)
          const ms = Date.now() - t0
          log(`✓ ${scenario.title} (${seconds(ms)}${attempt > 0 ? `, réussi à l'essai ${attempt + 1}` : ''})`)
          results.push({ scenario, status: attempt > 0 ? 'réussi (réessai)' : 'réussi', ms })
          break
        } catch (error) {
          const ms = Date.now() - t0
          const shot = join(OUT, `${scenario.id}-${attempt + 1}.png`)
          await page.screenshot({ path: shot }).catch(() => undefined)
          if (attempt < (scenario.retries ?? 0)) {
            attempt++
            log(`  ${scenario.title} : échec (${error.message}), nouvel essai`)
            continue
          }
          log(`✗ ${scenario.title} (${seconds(ms)})\n    ${error.message}\n    capture : ${shot}`)
          results.push({ scenario, status: 'échec', ms })
          break
        }
      }
    }
  } finally {
    await browser.close().catch(() => undefined)
    await server.close()
  }

  const failed = results.filter((r) => r.status === 'échec').length
  log(`\n${results.length - failed}/${results.length} scénarios sans échec en ${seconds(Date.now() - started)} · fichiers : ${OUT}`)
  process.exitCode = failed > 0 ? 1 : 0
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

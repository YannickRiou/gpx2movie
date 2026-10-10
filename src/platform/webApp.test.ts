import { describe, expect, it } from 'vitest'
import manifestText from '../../public/manifest.webmanifest?raw'
import { shouldRegisterServiceWorker, wantsIosInstallHint } from './webApp'

/** files of public/, as `icons/icon-192.png` */
const PUBLIC_FILES = Object.keys(import.meta.glob('../../public/**/*.{png,svg}')).map((path) => path.replace('../../public/', ''))

interface Manifest {
  id: string
  start_url: string
  scope: string
  display: string
  icons: { src: string; purpose: string }[]
  share_target?: { action: string }
}

const manifest = JSON.parse(manifestText) as Manifest

describe('shouldRegisterServiceWorker', () => {
  const browser = { isSecureContext: true, navigator: { serviceWorker: {} } }

  it('registers on the built website over HTTPS', () => {
    expect(shouldRegisterServiceWorker(browser, true)).toBe(true)
  })

  it('never in the desktop app, in development, over HTTP or without service workers', () => {
    expect(shouldRegisterServiceWorker({ ...browser, isTauri: true }, true)).toBe(false)
    expect(shouldRegisterServiceWorker({ ...browser, __TAURI_INTERNALS__: {} }, true)).toBe(false)
    expect(shouldRegisterServiceWorker(browser, false)).toBe(false)
    expect(shouldRegisterServiceWorker({ ...browser, isSecureContext: false }, true)).toBe(false)
    expect(shouldRegisterServiceWorker({ isSecureContext: true, navigator: {} }, true)).toBe(false)
  })
})

describe('wantsIosInstallHint', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1'
  const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15'
  const android = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36'

  it('iPhone and iPad in a tab', () => {
    expect(wantsIosInstallHint({ userAgent: iphone, standalone: false })).toBe(true)
    expect(wantsIosInstallHint({ userAgent: mac, maxTouchPoints: 5, standalone: false })).toBe(true)
  })

  it('not once installed, nor on a Mac or Android', () => {
    expect(wantsIosInstallHint({ userAgent: iphone, standalone: true })).toBe(false)
    expect(wantsIosInstallHint({ userAgent: mac, maxTouchPoints: 0 })).toBe(false)
    expect(wantsIosInstallHint({ userAgent: android, maxTouchPoints: 5 })).toBe(false)
  })
})

describe('web app manifest', () => {
  it('is standalone, with any and maskable icons that exist', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.map((i) => i.purpose)).toContain('maskable')
    for (const icon of manifest.icons) expect(PUBLIC_FILES).toContain(icon.src)
  })

  it.each(['https://yannickriou.github.io/gpx2movie/', 'https://flyover.example.org/'])('stays under the base %s', (base) => {
    const at = (url: string) => new URL(url, `${base}manifest.webmanifest`).href
    expect(at(manifest.start_url)).toBe(base)
    expect(at(manifest.scope)).toBe(base)
    expect(at(manifest.id)).toBe(base)
    for (const icon of manifest.icons) expect(at(icon.src).startsWith(base)).toBe(true)
    if (manifest.share_target) expect(at(manifest.share_target.action)).toBe(`${base}share-target`)
  })
})

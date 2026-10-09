import { isTauriRuntime } from './platform'

/** The https URL of the new-tab link `event` was fired on, null for anything else. */
export function externalLinkOf(event: Pick<MouseEvent, 'target' | 'defaultPrevented' | 'button'>): string | null {
  if (event.defaultPrevented || event.button !== 0) return null
  const link = (event.target as Element | null)?.closest?.('a[target="_blank"]')
  const href = link?.getAttribute('href')
  return href && /^https:\/\//i.test(href) ? href : null
}

/**
 * Desktop: the webview does not open new windows, so links with `target="_blank"` go to the system browser
 * (tauri-plugin-opener, https only: see the capability). The web keeps its own behaviour.
 */
export function installExternalLinks(scope: Window & typeof globalThis = window): void {
  if (!isTauriRuntime(scope)) return
  scope.document.addEventListener('click', (event) => {
    const url = externalLinkOf(event)
    if (!url) return
    event.preventDefault()
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke('plugin:opener|open_url', { url })).catch(() => undefined)
  })
}

/**
 * Platform layer: what differs between the static web site and the desktop app (Tauri). Choosing files to open,
 * saving a file, the files of a drop, a persistent key / value storage and capability flags. The rest of the app
 * calls `getPlatform()` and never touches a file input, a download link or Tauri itself.
 *
 * Web (`web.ts`): file input, download through an object URL, localStorage. Desktop (`desktop.ts`): native dialogs
 * and disk access through the Tauri dialog and fs plugins, imported only when the page runs inside Tauri, so the web
 * bundle never loads them. Contract and pure helpers (tested): `platform.ts`.
 */
import { createDesktopPlatform } from './desktop'
import { detectCapabilities } from './platform'
import type { Capabilities, Platform } from './platform'
import { createWebPlatform } from './web'

export * from './platform'

/** Platform for this scope (window): desktop inside Tauri, web otherwise. */
export function selectPlatform(scope: object): Platform {
  const capabilities = detectCapabilities(scope)
  return capabilities.isDesktop ? createDesktopPlatform(capabilities) : createWebPlatform(capabilities)
}

let current: Platform | null = null

export function getPlatform(): Platform {
  current ??= selectPlatform(globalThis)
  return current
}

/**
 * Why no video can be encoded here, null when WebCodecs is present (hint of the export panel, shown when no codec was
 * found). Desktop without WebCodecs: ffmpeg is missing.
 */
export function videoEncoderMissingHint(capabilities: Capabilities = getPlatform().capabilities): string | null {
  switch (capabilities.videoEncoder) {
    case 'webcodecs':
      return null
    case 'native':
      return "installez ffmpeg (sudo apt install ffmpeg), qui encode la vidéo sur ce système, puis relancez l'application ; l'image fixe reste disponible ici."
    default:
      return "l'encodage vidéo (WebCodecs) manque. Exportez depuis Chrome, Edge ou un Firefox récent ; l'image fixe reste disponible ici."
  }
}

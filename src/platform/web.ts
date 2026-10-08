/** Web platform: file input, download through an object URL, localStorage (the behaviour of the static site). */
import { acceptAttribute, droppedFiles, keyValueStore } from './platform'
import type { Capabilities, Platform } from './platform'

function localStorageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Click a download link (the browser saves the file in its download folder). */
function clickDownload(url: string, fileName: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
}

export function createWebPlatform(capabilities: Capabilities): Platform {
  return {
    capabilities,
    storage: keyValueStore(localStorageOrNull()),
    // synchronous up to the click: the picker needs the user's gesture
    openFiles: ({ filters, multiple = false }) =>
      new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = multiple
        input.accept = acceptAttribute(filters)
        input.style.display = 'none'
        const done = (files: File[]) => {
          input.remove()
          resolve(files)
        }
        input.addEventListener('change', () => done(Array.from(input.files ?? [])), { once: true })
        input.addEventListener('cancel', () => done([]), { once: true })
        document.body.append(input)
        input.click()
      }),
    async saveFile(data, { fileName }) {
      const url = URL.createObjectURL(data)
      clickDownload(url, fileName)
      // released once the click has been handled
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return { saved: true, fileName }
    },
    async saveUrl(url, { fileName }) {
      clickDownload(url, fileName)
      return { saved: true, fileName }
    },
    droppedFiles,
  }
}

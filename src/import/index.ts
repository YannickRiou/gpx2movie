/**
 * Import entry point: dispatches a File (GPX or FIT) to the right parser and assigns colours.
 */
import type { Track } from '../core/types'
import { parseGpx } from './gpx'

/** Palette for track lines and UI swatches: bright enough to read over orthophotos (balise red first). */
export const TRACK_COLORS: readonly string[] = ['#FF5A36', '#FFC53D', '#5BC0EB', '#FFFFFF', '#B79CFF', '#7AD9A0']

export type SupportedExtension = 'gpx' | 'fit'

/** Lower-cased extension (without the dot) when the format is supported, else undefined. */
export function supportedExtension(fileName: string): SupportedExtension | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim())
  const ext = match?.[1].toLowerCase()
  return ext === 'gpx' || ext === 'fit' ? ext : undefined
}

/** Give each track the colour TRACK_COLORS[(colorIndex + i) % length]. Mutates and returns `tracks`. */
export function assignColors(tracks: Track[], colorIndex = 0): Track[] {
  const n = TRACK_COLORS.length
  const start = ((colorIndex % n) + n) % n
  tracks.forEach((track, i) => {
    track.color = TRACK_COLORS[(start + i) % n]
  })
  return tracks
}

/** Parse GPX text. `colorIndex` is the palette index given to the first returned track. */
export function importText(text: string, fileName: string, colorIndex = 0): Track[] {
  return assignColors(parseGpx(text, fileName), colorIndex)
}

/**
 * Parse a dropped / selected file by extension (.gpx, .fit, case-insensitive).
 * Throws `Error('Format non supporté : …')` for anything else.
 */
export async function importFile(file: File, colorIndex = 0): Promise<Track[]> {
  switch (supportedExtension(file.name)) {
    case 'gpx':
      return importText(await file.text(), file.name, colorIndex)
    case 'fit': {
      // the FIT decoder is loaded on the first .fit file only
      const { parseFit } = await import('./fit')
      return assignColors(await parseFit(await file.arrayBuffer(), file.name), colorIndex)
    }
    default: {
      const shown = /\.[^.]+$/.exec(file.name)?.[0] ?? file.name
      throw new Error(`Format non supporté : ${shown} (formats acceptés : .gpx, .fit)`)
    }
  }
}

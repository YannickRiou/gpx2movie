/**
 * Pictures and video clips of the film's media lane, and the sound files of its music lane: the media table of the
 * project document, file access and decoding of the pictures (the clips: `video.ts`; the music: `audio.ts`).
 *
 * The table maps an id (`film.media[].src`) to the picture, kept downscaled as a JPEG data URL, or to the video
 * clip, kept as is (its original bytes, `MAX_VIDEO_BYTES` at most), each with a small thumbnail, so that a project
 * stays one self-contained file (web and desktop app alike) while the settings and their undo history only hold
 * ids. A sound file is kept as is too (`MAX_AUDIO_BYTES` at most), with a small waveform (`peaks`) instead of a
 * thumbnail. An entry stays in the table when its medium leaves the film (undo brings it back); a saved project keeps
 * only the entries its film uses (`usedMedia`).
 *
 * Files come in through `readMedia(blob)` (`video.ts`: `readPhoto` or `readVideo`): the web file picker and drop
 * give a File, the desktop app will give a Blob read from disk. Drawing reads decoded pictures from
 * `getMediaBitmaps()`: decoded on demand, cached by id, released once the film no longer uses them, a few at most
 * held at once.
 *
 * Unlike the rest of `film/`, this module touches the browser (canvas, createImageBitmap) and holds a store;
 * the table checks, the data URL decoding and the cache (decoder injected) are pure and tested.
 */
import { create } from 'zustand'
import { fitWithin } from '../overlay/assets'
import { useAppStore } from '../state/store'
import { isValidBeats } from './beats'
import type { MusicBeats } from './beats'
import { EXIF_SCAN_BYTES, parseExif } from './exif'
import type { PhotoExif } from './exif'
import type { Film, FilmMedia } from './model'

/** A picture, a video clip or a sound file of the media table, as saved in the project document. */
export interface MediaAsset {
  /**
   * JPEG data URL, at most `PHOTO_MAX_SIDE_PX` on its longest side; a video: the file as an MP4, WebM or QuickTime
   * data URL; a sound: the file as an audio data URL (`AUDIO_TYPES`)
   */
  data: string
  /** JPEG data URL, at most `THUMB_MAX_SIDE_PX` (timeline blocks); none for a sound */
  thumb?: string
  /** picture and video size (none for a sound) */
  width?: number
  height?: number
  /** file name it came from */
  name?: string
  /** video and sound: length of the file (seconds) */
  durationS?: number
  /** sound: loudest level (0–1) of each slice of the file, evenly spread over it (the waveform of the timeline) */
  peaks?: number[]
  /** sound: its tempo and beats (`detectBeats`; absent for a file read before they were, found on demand) */
  beats?: MusicBeats
  /** video: recording start read from the file (ms since epoch), to sync it with the track */
  recordedMs?: number
  /** video: `recordedMs` is only guessed from the date of the file (its last change minus its length) */
  recordedApprox?: boolean
}

export type MediaTable = Record<string, MediaAsset>

export const PHOTO_MAX_SIDE_PX = 2560
export const PHOTO_JPEG_QUALITY = 0.85
export const THUMB_MAX_SIDE_PX = 160
export const THUMB_JPEG_QUALITY = 0.7
/** Largest video file kept in a project (bytes): the project file holds the clip as it is. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024
/** Largest sound file kept in a project (bytes): the project file holds it as it is. */
export const MAX_AUDIO_BYTES = 30 * 1024 * 1024
/** Most values of a waveform (`peaks`). */
export const MAX_PEAKS = 4000
/** Types of the sound files kept in the table (`data:audio/<type>`). */
export const AUDIO_TYPES = ['mpeg', 'mp4', 'aac', 'ogg', 'wav', 'flac', 'webm'] as const
/** Decoded pictures kept at once (a 2560 px picture takes about 20 MB once decoded). */
export const BITMAP_CACHE_LIMIT = 6

// ---------------------------------------------------------------------------
// Table (pure)
// ---------------------------------------------------------------------------

const isImageDataUrl = (v: unknown) => typeof v === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(v)
const isVideoDataUrl = (v: unknown) => typeof v === 'string' && /^data:video\/(mp4|webm|quicktime);base64,/.test(v)
const isAudioDataUrl = (v: unknown) => typeof v === 'string' && new RegExp(`^data:audio/(${AUDIO_TYPES.join('|')});base64,`).test(v)
const isSide = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 16384
const isLength = (v: unknown) => typeof v === 'number' && v > 0 && Number.isFinite(v)
const isPeaks = (v: unknown) =>
  Array.isArray(v) && v.length > 0 && v.length <= MAX_PEAKS && v.every((p) => typeof p === 'number' && p >= 0 && p <= 1)

export function isValidMediaAsset(v: unknown): v is MediaAsset {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const a = v as Record<string, unknown>
  if (isAudioDataUrl(a.data)) {
    return isLength(a.durationS) && isPeaks(a.peaks) && (a.beats === undefined || isValidBeats(a.beats)) && (a.name === undefined || typeof a.name === 'string')
  }
  const video = isVideoDataUrl(a.data)
  const recorded = a.recordedMs === undefined || (video && typeof a.recordedMs === 'number' && Number.isFinite(a.recordedMs))
  return (
    (video ? isLength(a.durationS) : isImageDataUrl(a.data) && a.durationS === undefined) &&
    recorded &&
    (a.recordedApprox === undefined || typeof a.recordedApprox === 'boolean') &&
    isImageDataUrl(a.thumb) &&
    isSide(a.width) &&
    isSide(a.height) &&
    (a.name === undefined || typeof a.name === 'string')
  )
}

/** The entry is a video clip (else a picture). */
export function isVideoAsset(asset: Pick<MediaAsset, 'data'>): boolean {
  return asset.data.startsWith('data:video/')
}

/** The entry is a sound file (music lane). */
export function isAudioAsset(asset: Pick<MediaAsset, 'data'>): boolean {
  return asset.data.startsWith('data:audio/')
}

/** A damaged `beats` of a sound is dropped, not the sound: the beats are found again on demand. */
function withoutBadBeats(asset: unknown): unknown {
  if (asset === null || typeof asset !== 'object' || !('beats' in asset) || isValidBeats(asset.beats)) return asset
  const { beats: _beats, ...rest } = asset
  return rest
}

/** Valid pictures of a loaded media table (the others are left out). */
export function sanitizeMediaTable(raw: unknown): MediaTable {
  const media: MediaTable = {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return media
  for (const [id, asset] of Object.entries(raw)) {
    const entry = withoutBadBeats(asset)
    if (id && isValidMediaAsset(entry)) media[id] = entry
  }
  return media
}

/** The entries of `table` used by the film, media and music (what a saved project keeps). */
export function usedMedia(film: Pick<Film, 'media'> & Partial<Pick<Film, 'audio'>>, table: MediaTable): MediaTable {
  const out: MediaTable = {}
  for (const { src } of [...film.media, ...(film.audio ?? [])]) if (table[src]) out[src] = table[src]
  return out
}

/** Next free id `photo-<n>` (or `video-<n>`, `audio-<n>`) of the table. */
export function nextMediaId(table: MediaTable, prefix: 'photo' | 'video' | 'audio' = 'photo'): string {
  let max = 0
  for (const id of Object.keys(table)) {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `${prefix}-${max + 1}`
}

/** Bytes of a base64 data URL as a Blob of its type. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const type = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'application/octet-stream'
  const binary = atob(dataUrl.slice(comma + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

/** Pictures of the photos shown at film time `timeS` or starting within `aheadS` after it (to decode beforehand). */
export function mediaToLoad(media: readonly FilmMedia[], timeS: number, aheadS = 0): string[] {
  const ids = media.filter((m) => m.kind === 'image' && m.startS <= timeS + aheadS && m.startS + m.durationS > timeS).map((m) => m.src)
  return [...new Set(ids)]
}

// ---------------------------------------------------------------------------
// Store of the table
// ---------------------------------------------------------------------------

interface MediaState {
  table: MediaTable
  /** add pictures under fresh ids (returned in order) */
  add(assets: readonly MediaAsset[]): string[]
  /** replace the whole table (project opened) */
  replace(table: MediaTable): void
}

export const useMediaStore = create<MediaState>()((set, get) => ({
  table: {},
  add(assets) {
    const table = { ...get().table }
    const ids = assets.map((asset) => {
      const id = nextMediaId(table, isVideoAsset(asset) ? 'video' : isAudioAsset(asset) ? 'audio' : 'photo')
      table[id] = asset
      return id
    })
    set({ table })
    return ids
  },
  replace(table) {
    set({ table: { ...table } })
  },
}))

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** `image` (`iw` × `ih`) drawn at most `max` px on its longest side as a JPEG data URL (white under transparent parts). */
export function encodeJpeg(image: CanvasImageSource, iw: number, ih: number, max: number, quality: number): { data: string; width: number; height: number } {
  const { width, height } = fitWithin(iw, ih, max)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Image illisible.')
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, width, height)
  return { data: canvas.toDataURL('image/jpeg', quality), width, height }
}

/**
 * A photo file -> its picture for the media table (upright, downscaled, JPEG) and where and when it was taken
 * (EXIF of a JPEG file). Throws a French message when the browser cannot decode it (HEIC in most browsers).
 */
export async function readPhoto(file: Blob, name?: string): Promise<{ asset: MediaAsset; exif: PhotoExif }> {
  const exif = parseExif(await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer())
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('image illisible ou format non pris en charge (JPEG, PNG ou WebP).')
  }
  try {
    const photo = encodeJpeg(bitmap, bitmap.width, bitmap.height, PHOTO_MAX_SIDE_PX, PHOTO_JPEG_QUALITY)
    const thumb = encodeJpeg(bitmap, bitmap.width, bitmap.height, THUMB_MAX_SIDE_PX, THUMB_JPEG_QUALITY)
    return { asset: { data: photo.data, thumb: thumb.data, width: photo.width, height: photo.height, name }, exif }
  } finally {
    bitmap.close()
  }
}

// ---------------------------------------------------------------------------
// Decoded pictures
// ---------------------------------------------------------------------------

export interface DecodedPicture {
  image: CanvasImageSource
  width: number
  height: number
  close?(): void
}

export interface MediaBitmaps {
  /** decoded picture `id`, undefined while it is not (its decoding starts; listeners are told when it is ready) */
  get(id: string): DecodedPicture | undefined
  /** resolve once the pictures are decoded (those that cannot be are left out) */
  load(ids: readonly string[]): Promise<void>
  /** release the decoded pictures whose id is not in `ids` */
  retain(ids: readonly string[]): void
  subscribe(listener: () => void): () => void
}

/**
 * Cache of decoded pictures by id over a table (`source`), at most `limit` kept (least recently used released
 * first). A picture whose table entry changed (another project opened) is decoded again.
 */
export function createMediaBitmaps(
  source: (id: string) => MediaAsset | undefined,
  decode: (asset: MediaAsset) => Promise<DecodedPicture>,
  limit = BITMAP_CACHE_LIMIT,
): MediaBitmaps {
  const ready = new Map<string, { asset: MediaAsset; picture: DecodedPicture }>()
  const pending = new Map<string, { asset: MediaAsset; promise: Promise<void> }>()
  /** pictures that could not be decoded: not tried again */
  const failed = new WeakSet<MediaAsset>()
  const listeners = new Set<() => void>()

  const release = (id: string) => {
    ready.get(id)?.picture.close?.()
    ready.delete(id)
  }
  const start = (id: string, asset: MediaAsset): Promise<void> => {
    const current = pending.get(id)
    if (current?.asset === asset) return current.promise
    if (failed.has(asset)) return Promise.resolve()
    const promise = decode(asset)
      .then((picture) => {
        if (pending.get(id)?.promise !== promise) return picture.close?.()
        pending.delete(id)
        release(id)
        ready.set(id, { asset, picture })
        while (ready.size > limit) release(ready.keys().next().value as string)
        for (const listener of listeners) listener()
      })
      .catch(() => {
        // unreadable picture: not drawn
        failed.add(asset)
        if (pending.get(id)?.promise === promise) pending.delete(id)
      })
    pending.set(id, { asset, promise })
    return promise
  }
  const lookup = (id: string): { asset: MediaAsset; hit?: DecodedPicture } | undefined => {
    const asset = source(id)
    if (!asset) return undefined
    const entry = ready.get(id)
    if (entry && entry.asset === asset) {
      // most recently used last
      ready.delete(id)
      ready.set(id, entry)
      return { asset, hit: entry.picture }
    }
    return { asset }
  }

  return {
    get(id) {
      const found = lookup(id)
      if (found && !found.hit) void start(id, found.asset)
      return found?.hit
    },
    async load(ids) {
      await Promise.all(
        ids.map((id) => {
          const found = lookup(id)
          return found && !found.hit ? start(id, found.asset) : undefined
        }),
      )
    },
    retain(ids) {
      const keep = new Set(ids)
      for (const id of [...ready.keys()]) if (!keep.has(id)) release(id)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

let appBitmaps: MediaBitmaps | null = null

/** Decoded pictures of the page, over the media table; released when the film stops using them. */
export function getMediaBitmaps(): MediaBitmaps {
  if (appBitmaps) return appBitmaps
  const bitmaps = createMediaBitmaps(
    (id) => useMediaStore.getState().table[id],
    async (asset) => {
      const bitmap = await createImageBitmap(dataUrlToBlob(asset.data))
      return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    },
  )
  useAppStore.subscribe((state, prev) => {
    if (state.settings.film.media !== prev.settings.film.media) bitmaps.retain(state.settings.film.media.map((m) => m.src))
  })
  appBitmaps = bitmaps
  return bitmaps
}

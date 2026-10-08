/**
 * Video clips of the film's media lane: reading a file into the media table, the frames drawn by the preview and
 * the frames decoded by the video export.
 *
 * - `readMedia(blob)` is the way in for every file of the lane (photo or video), so that the desktop app can give a
 *   Blob read from disk, or later a path, behind the same call. A clip is kept as is (no cheap way to downscale it
 *   in the page), so its file must stay under `MAX_VIDEO_BYTES`; it must be an MP4, WebM or QuickTime file whose
 *   video the browser decodes (WebCodecs, the same decoder as the export).
 * - Preview (`getPreviewVideos`): one HTMLVideoElement per clip, playing along during the playback and
 *   paused on the film time when scrubbing; the last frame seeked to is kept while the next seek runs. A clip
 *   following the flight (`sync.follow`) plays at the rate the recorded time passes under the marker, held during
 *   a stop. Its sound is heard only while it plays at ×1 (`clipHasSound`): muted when scrubbing, at any other speed
 *   and when following the flight, where the browser would resample it.
 * - Export (`createExportVideos`): frame-exact and deterministic, never real-time playback: before every frame the
 *   frame of each visible clip at its time in the file is decoded by mediabunny (the last frame starting at or
 *   before that time), reading forward from the previous one. Its sound is decoded once, before the first frame
 *   (`decodeClipSound`), for the mix of the soundtrack (`film/audio.ts`).
 *
 * Browser module (DOM, WebCodecs); the frame logic is written over injected sources and tested.
 */
import type { Input } from 'mediabunny'
import { fitWithin } from '../overlay/assets'
import type { OverlayImage } from '../overlay/draw'
import { useAppStore } from '../state/store'
import { mp4CreationTimeMs, quickTimeDateMs } from './exif'
import type { PhotoExif } from './exif'
import { MAX_VIDEO_BYTES, THUMB_JPEG_QUALITY, THUMB_MAX_SIDE_PX, dataUrlToBlob, encodeJpeg, readPhoto, useMediaStore } from './media'
import type { MediaAsset } from './media'
import { clipHasSound, clipTimeS } from './model'
import type { FilmMedia } from './model'

/** The demuxer (mediabunny, ~700 KB) is loaded on the first clip read or exported, not at startup. */
const mediabunny = () => import('mediabunny')
const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm)$/i

/** The file is a video (by its type, or its extension when the browser gives no type). */
export function isVideoFile(file: { type: string; name?: string }): boolean {
  return file.type.startsWith('video/') || (!file.type && VIDEO_EXTENSIONS.test(file.name ?? ''))
}

/** The file can go on the media lane: a picture or a video. */
export function isMediaFile(file: { type: string; name?: string }): boolean {
  return file.type.startsWith('image/') || isVideoFile(file)
}

const megabytes = (bytes: number) => Math.ceil(bytes / (1024 * 1024))

/** `blob` as a base64 data URL of type `type`. */
export function blobToDataUrl(blob: Blob, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve(`data:${type};base64,${url.slice(url.indexOf(',') + 1)}`)
    }
    reader.onerror = () => reject(new Error('fichier illisible.'))
    reader.readAsDataURL(blob)
  })
}

/**
 * When the clip started recording, to sync it with the track: the date with its time zone of Apple devices, else
 * the creation time of the movie header of an MP4 / QuickTime file, else (flagged approximate) the last change of
 * the file minus its length (a camera writes the file until the recording stops). Nothing when none is known.
 */
async function recordingStart(input: Input, file: Blob, mp4: boolean, durationS: number): Promise<Pick<MediaAsset, 'recordedMs' | 'recordedApprox'>> {
  const tags = await input.getMetadataTags().catch(() => undefined)
  const apple = tags?.raw?.['com.apple.quicktime.creationdate']
  const read = (offset: number, length: number) => file.slice(offset, offset + length).arrayBuffer().then((b) => new Uint8Array(b))
  const recordedMs = (typeof apple === 'string' ? quickTimeDateMs(apple) : undefined) ?? (mp4 ? await mp4CreationTimeMs(read, file.size) : undefined)
  if (recordedMs !== undefined) return { recordedMs }
  const modified = (file as Partial<File>).lastModified
  return typeof modified === 'number' && modified > 0 ? { recordedMs: modified - Math.round(durationS * 1000), recordedApprox: true } : {}
}

/**
 * A video file -> its entry of the media table: the file as it is, its first frame as the thumbnail, its size,
 * length and recording start (`recordingStart`). Throws a French message when it is too large or the browser
 * cannot decode it.
 */
export async function readVideo(file: Blob, name?: string): Promise<{ asset: MediaAsset }> {
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(
      `vidéo trop lourde (${megabytes(file.size)} Mo) : ${megabytes(MAX_VIDEO_BYTES)} Mo au plus, car elle est enregistrée dans le projet. Raccourcissez-la avant de l'ajouter.`,
    )
  }
  const { BlobSource, CanvasSink, Input, MP4, QTFF, WEBM } = await mediabunny()
  const input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF, WEBM] })
  try {
    const format = await input.getFormat().catch(() => null)
    if (!format) throw new Error('format non pris en charge (MP4, WebM ou MOV).')
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('aucune image dans ce fichier.')
    if (!(await track.canDecode())) throw new Error('ce navigateur ne sait pas lire cette vidéo (essayez un MP4 en H.264).')
    const width = await track.getDisplayWidth()
    const height = await track.getDisplayHeight()
    const durationS = Math.round((await track.computeDuration()) * 1000) / 1000
    const size = fitWithin(width, height, THUMB_MAX_SIDE_PX)
    const first = await new CanvasSink(track, { ...size, fit: 'fill' }).getCanvas(await track.getFirstTimestamp())
    if (!first || !(durationS > 0)) throw new Error('vidéo vide ou illisible.')
    const thumb = encodeJpeg(first.canvas, first.canvas.width, first.canvas.height, THUMB_MAX_SIDE_PX, THUMB_JPEG_QUALITY).data
    const type = format === WEBM ? 'video/webm' : format === QTFF ? 'video/quicktime' : 'video/mp4'
    const recorded = await recordingStart(input, file, format !== WEBM, durationS)
    return { asset: { data: await blobToDataUrl(file, type), thumb, width, height, name, durationS, ...recorded } }
  } finally {
    input.dispose()
  }
}

/** Any file of the media lane -> its entry of the media table (and the EXIF of a photo). */
export async function readMedia(file: Blob & { name?: string }, name?: string): Promise<{ asset: MediaAsset; exif?: PhotoExif }> {
  return isVideoFile(file) ? readVideo(file, name) : readPhoto(file, name)
}

const blobs = new WeakMap<MediaAsset, Blob>()

/** Bytes of a clip of the media table (decoded from its data URL once). */
function clipBlob(asset: MediaAsset): Blob {
  let blob = blobs.get(asset)
  if (!blob) {
    blob = dataUrlToBlob(asset.data)
    blobs.set(asset, blob)
  }
  return blob
}

const visibleVideos = (media: readonly FilmMedia[], timeS: number) =>
  media.filter((m) => m.kind === 'video' && m.startS <= timeS && timeS < m.startS + m.durationS)

// ---------------------------------------------------------------------------
// Export: frames decoded at a time
// ---------------------------------------------------------------------------

/** A decoded frame of a clip and its start in the file (seconds). */
export interface ClipFrame extends OverlayImage {
  timestamp: number
}

/** Forward jump (seconds in the file) beyond which a reader starts again from a key frame instead of decoding on. */
export const CLIP_JUMP_S = 2
const EPS = 1e-6

export interface ClipReader {
  /** the last frame starting at or before `timeS` (the first one before it), null for a clip without frames */
  frameAt(timeS: number): Promise<ClipFrame | null>
  close(): Promise<void>
}

/**
 * Frames of one clip by time, read forward: `open(t)` gives the frames in order from the one shown at `t`. Asked
 * times going forward (the export) decode each frame at most once; going back or jumping far ahead opens again.
 */
export function createClipReader(open: (startS: number) => AsyncIterator<ClipFrame>, jumpS = CLIP_JUMP_S): ClipReader {
  let frames: AsyncIterator<ClipFrame> | null = null
  let current: ClipFrame | null = null
  /** next frame after `current`, null at the end */
  let ahead: ClipFrame | null = null
  let lastS = -Infinity
  const pull = async () => {
    const next = await frames!.next()
    return next.done ? null : next.value
  }
  return {
    async frameAt(timeS) {
      // (past the last frame, `ahead` is null: the last frame is held without opening again)
      if (!frames || timeS < lastS - EPS || (ahead && timeS > ahead.timestamp + jumpS)) {
        await frames?.return?.()
        frames = open(timeS)
        current = await pull()
        ahead = current ? await pull() : null
      }
      lastS = timeS
      while (ahead && ahead.timestamp <= timeS + EPS) {
        current = ahead
        ahead = await pull()
      }
      return current
    },
    async close() {
      await frames?.return?.()
      frames = null
      current = ahead = null
    },
  }
}

/** A clip opened for decoding. */
export interface OpenedClip {
  frames(startS: number): AsyncIterator<ClipFrame>
  dispose(): void
}

/** Frames of a clip of the media table through mediabunny (canvases at the display size, rotation applied). */
function openClip(asset: MediaAsset): OpenedClip {
  const opened = mediabunny().then(({ BlobSource, CanvasSink, Input, MP4, QTFF, WEBM }) => {
    const input = new Input({ source: new BlobSource(clipBlob(asset)), formats: [MP4, QTFF, WEBM] })
    const sink = input.getPrimaryVideoTrack().then((track) => {
      if (!track) throw new Error('aucune image')
      // a frame shown and the one after it are held, and mediabunny reuses its canvases in turn
      return new CanvasSink(track, { poolSize: 3 })
    })
    return { input, sink }
  })
  return {
    async *frames(startS) {
      const { sink } = await opened
      for await (const c of (await sink).canvases(startS)) {
        yield { image: c.canvas, width: c.canvas.width, height: c.canvas.height, timestamp: c.timestamp }
      }
    },
    dispose: () => void opened.then(({ input }) => input.dispose(), () => undefined),
  }
}

export interface ExportVideos {
  /**
   * decode the frames of the clips shown at film time `timeS` (throws a French message for an unreadable clip);
   * `recordedMs`: the recorded instant under the marker then, for the clips following the flight (`clipTimeS`)
   */
  load(media: readonly FilmMedia[], timeS: number, recordedMs?: number): Promise<void>
  /** frame of `item` at `clipS` in its file, once loaded for that time */
  get(item: FilmMedia, clipS: number): OverlayImage | undefined
  dispose(): void
}

/** Frames of the clips for the export, one reader per medium of the film (`source`: the media table). */
export function createExportVideos(source: (src: string) => MediaAsset | undefined, open: (asset: MediaAsset) => OpenedClip = openClip): ExportVideos {
  const clips = new Map<string, { asset: MediaAsset; clip: OpenedClip; reader: ClipReader }>()
  const shown = new Map<string, { clipS: number; frame: ClipFrame | null }>()
  return {
    async load(media, timeS, recordedMs) {
      shown.clear()
      for (const item of visibleVideos(media, timeS)) {
        const asset = source(item.src)
        if (!asset) continue
        let entry = clips.get(item.id)
        if (!entry || entry.asset !== asset) {
          entry?.clip.dispose()
          const clip = open(asset)
          entry = { asset, clip, reader: createClipReader((s) => clip.frames(s)) }
          clips.set(item.id, entry)
        }
        const clipS = clipTimeS(item, timeS, recordedMs)
        try {
          shown.set(item.id, { clipS, frame: await entry.reader.frameAt(clipS) })
        } catch {
          throw new Error(`Vidéo « ${asset.name ?? item.src} » illisible pendant l'export.`)
        }
      }
    },
    get(item, clipS) {
      const s = shown.get(item.id)
      return s && Math.abs(s.clipS - clipS) < EPS ? (s.frame ?? undefined) : undefined
    },
    dispose() {
      for (const { clip, reader } of clips.values()) {
        void reader.close().catch(() => undefined)
        clip.dispose()
      }
      clips.clear()
      shown.clear()
    },
  }
}

// ---------------------------------------------------------------------------
// Export: sound decoded at once
// ---------------------------------------------------------------------------

/** Decoded samples of a clip's sound starting at `timestamp` (seconds in the file), one array per channel. */
export interface SoundChunk {
  timestamp: number
  channels: Float32Array[]
}

/**
 * The chunks of a clip's sound joined into `lengthS` seconds from `fromS` in its file, at `sampleRate`: each chunk
 * at its own sample position (so a gap in the file stays silent and the sound never drifts from the frames), the
 * parts before `fromS` or after the end left out. As many channels as the first chunk.
 */
export function joinSoundChunks(chunks: readonly SoundChunk[], fromS: number, lengthS: number, sampleRate: number): Float32Array<ArrayBuffer>[] {
  const length = Math.max(0, Math.ceil(lengthS * sampleRate))
  const out = Array.from({ length: chunks[0]?.channels.length ?? 0 }, () => new Float32Array(length))
  for (const chunk of chunks) {
    const offset = Math.round((chunk.timestamp - fromS) * sampleRate)
    out.forEach((target, c) => {
      const samples = chunk.channels[c]
      if (!samples) return
      const skip = Math.max(0, -offset)
      const at = Math.max(0, offset)
      const n = Math.min(samples.length - skip, length - at)
      if (n > 0) target.set(samples.subarray(skip, skip + n), at)
    })
  }
  return out
}

/**
 * The sound of a clip of the media table from `fromS` for `lengthS` seconds of its file, as one AudioBuffer at the
 * rate of its sound track (mediabunny over WebCodecs, the same decoders as the frames); null for a clip without a
 * sound track. Throws when the browser cannot decode it.
 */
export async function decodeClipSound(asset: MediaAsset, fromS: number, lengthS: number): Promise<AudioBuffer | null> {
  const { AudioBufferSink, BlobSource, Input, MP4, QTFF, WEBM } = await mediabunny()
  const input = new Input({ source: new BlobSource(clipBlob(asset)), formats: [MP4, QTFF, WEBM] })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) return null
    if (!(await track.canDecode())) throw new Error('son illisible')
    const chunks: SoundChunk[] = []
    let sampleRate = 0
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers(fromS, fromS + lengthS)) {
      sampleRate ||= buffer.sampleRate
      chunks.push({ timestamp, channels: Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)) })
    }
    if (chunks.length === 0) return null
    const channels = joinSoundChunks(chunks, fromS, lengthS, sampleRate)
    const sound = new AudioBuffer({ numberOfChannels: channels.length, length: Math.max(1, channels[0].length), sampleRate })
    channels.forEach((samples, c) => sound.copyToChannel(samples, c))
    return sound
  } finally {
    input.dispose()
  }
}

// ---------------------------------------------------------------------------
// Preview: video elements
// ---------------------------------------------------------------------------

/** What the preview needs of a video element (an HTMLVideoElement; a fake in the tests). */
export interface PreviewElement {
  currentTime: number
  readonly duration: number
  readonly paused: boolean
  readonly seeking: boolean
  readonly readyState: number
  readonly videoWidth: number
  readonly videoHeight: number
  playbackRate: number
  muted: boolean
  volume: number
  play(): Promise<void>
  pause(): void
  addEventListener(type: 'loadeddata' | 'seeked', listener: () => void): void
}

/** Drift tolerated while playing along (seconds; a clip following the flight: less), and while paused (about a frame). */
export const PLAY_DRIFT_S = 0.3
export const FOLLOW_DRIFT_S = 0.2
export const SEEK_TOLERANCE_S = 0.02
/** Playback rates of a video element (browsers refuse others); a clip slower than the lowest is held instead. */
export const PLAYBACK_RATE_RANGE = { min: 0.0625, max: 16 } as const
/** HTMLMediaElement.HAVE_CURRENT_DATA */
const HAVE_CURRENT_DATA = 2

/** State of the playback a preview frame is asked for; `muted`: the sound of the preview is cut (timeline button). */
export interface PreviewPlayback {
  playing: boolean
  speed: number
  muted?: boolean
}

export interface PreviewVideos {
  /**
   * frame of `item` at `clipS` in its file: plays along while `playing` (at `rate` seconds of the file per second of
   * film times the playback speed: `clipRateAt` for a clip following the flight; held below the lowest rate), else
   * seeks there; undefined until ready. Its sound is heard only while playing at ×1 (`clipHasSound`, not `muted`).
   */
  frame(item: FilmMedia, clipS: number, playback: PreviewPlayback, rate?: number): OverlayImage | undefined
  /** pause the clips not asked for since the last call */
  settle(): void
  /** drop the elements of the media that are not in `ids` */
  retain(ids: readonly string[]): void
  /** told when a clip has a new frame to show (loaded, seeked) */
  subscribe(listener: () => void): () => void
}

interface PreviewEntry {
  asset: MediaAsset
  el: PreviewElement
  /** last frame seeked to, shown while the next seek runs */
  still: OverlayImage | null
  release(): void
}

/** Video elements of the preview, one per medium, over the media table (`source`). */
export function createPreviewVideos(
  source: (src: string) => MediaAsset | undefined,
  create: (asset: MediaAsset) => { el: PreviewElement; snapshot(): OverlayImage | null; release(): void },
): PreviewVideos {
  const entries = new Map<string, PreviewEntry>()
  const used = new Set<string>()
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const drop = (id: string) => {
    const entry = entries.get(id)
    if (!entry) return
    entry.el.pause()
    entry.release()
    entries.delete(id)
  }
  return {
    frame(item, clipS, { playing, speed, muted = false }, rate = 1) {
      const asset = source(item.src)
      if (!asset) return undefined
      let entry = entries.get(item.id)
      if (!entry || entry.asset !== asset) {
        drop(item.id)
        const made = create(asset)
        const fresh: PreviewEntry = { asset, el: made.el, still: null, release: made.release }
        const onFrame = () => {
          fresh.still = made.snapshot()
          notify()
        }
        made.el.addEventListener('loadeddata', onFrame)
        made.el.addEventListener('seeked', onFrame)
        entries.set(item.id, fresh)
        entry = fresh
      }
      used.add(item.id)
      const el = entry.el
      const end = Math.min(item.outS ?? Infinity, Number.isFinite(el.duration) ? el.duration : Infinity)
      const playRate = Math.round(speed * rate * 100) / 100
      const plays = playing && clipS < end - SEEK_TOLERANCE_S && playRate >= PLAYBACK_RATE_RANGE.min
      // any other speed would resample the sound: heard at ×1 only
      setSound(el, plays && speed === 1 && !muted && clipHasSound(item), item.volume ?? 1)
      if (plays) {
        el.playbackRate = Math.min(PLAYBACK_RATE_RANGE.max, playRate)
        if (el.paused) {
          el.currentTime = clipS
          el.play().catch(() => undefined)
        } else if (Math.abs(el.currentTime - clipS) > (item.sync?.follow ? FOLLOW_DRIFT_S : PLAY_DRIFT_S)) {
          el.currentTime = clipS
        }
      } else {
        if (!el.paused) el.pause()
        const target = Math.min(clipS, end)
        if (!el.seeking && Math.abs(el.currentTime - target) > SEEK_TOLERANCE_S) el.currentTime = target
      }
      if (!el.seeking && el.readyState >= HAVE_CURRENT_DATA && el.videoWidth > 0) {
        return { image: el as unknown as CanvasImageSource, width: el.videoWidth, height: el.videoHeight }
      }
      return entry.still ?? undefined
    },
    settle() {
      for (const [id, entry] of entries) if (!used.has(id) && !entry.el.paused) entry.el.pause()
      used.clear()
    },
    retain(ids) {
      const keep = new Set(ids)
      for (const id of [...entries.keys()]) if (!keep.has(id)) drop(id)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Unmute an element at `volume`, or mute it (only what changed is written). */
function setSound(el: PreviewElement, heard: boolean, volume: number) {
  if (el.muted === heard) el.muted = !heard
  if (heard && el.volume !== volume) el.volume = volume
}

/** Largest side of the frame kept while a seek runs (pixels). */
const STILL_MAX_SIDE_PX = 1920

/** A video element playing a clip of the media table (muted until heard), with the copy of its current frame. */
function videoElement(asset: MediaAsset) {
  const blob = clipBlob(asset)
  // QuickTime files are read by the MP4 demuxer of the browsers
  const url = URL.createObjectURL(blob.type === 'video/quicktime' ? new Blob([blob], { type: 'video/mp4' }) : blob)
  const el = document.createElement('video')
  el.muted = true
  el.playsInline = true
  el.preload = 'auto'
  el.src = url
  const canvas = document.createElement('canvas')
  return {
    el,
    snapshot(): OverlayImage | null {
      if (el.readyState < HAVE_CURRENT_DATA || el.videoWidth === 0) return null
      const { width, height } = fitWithin(el.videoWidth, el.videoHeight, STILL_MAX_SIDE_PX)
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')?.drawImage(el, 0, 0, width, height)
      return { image: canvas, width, height }
    },
    release() {
      el.removeAttribute('src')
      el.load()
      URL.revokeObjectURL(url)
    },
  }
}

let previewVideos: PreviewVideos | null = null

/** Video elements of the page's preview; those of the media that leave the film are dropped. */
export function getPreviewVideos(): PreviewVideos {
  if (previewVideos) return previewVideos
  const videos = createPreviewVideos((id) => useMediaStore.getState().table[id], videoElement)
  useAppStore.subscribe((state, prev) => {
    if (state.settings.film.media !== prev.settings.film.media) videos.retain(state.settings.film.media.map((m) => m.id))
  })
  previewVideos = videos
  return videos
}

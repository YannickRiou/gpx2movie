/**
 * Video encoder — WebCodecs through mediabunny, writing the whole file in memory.
 *
 * Codec choice: MP4 / H.264 (plays everywhere), else MP4 / HEVC, else WebM / VP9, else WebM / VP8, the
 * first one the browser can encode at the requested size, frame rate and bitrate (`canEncodeVideo` asks
 * `VideoEncoder.isConfigSupported`). Frames are captured from a canvas (`CanvasSource`): the caller draws
 * frame i into it, then calls `addFrame(i)`.
 */
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
  canEncodeVideo,
  type VideoCodec,
} from 'mediabunny'
import type { VideoQuality } from './schedule'

export type VideoContainer = 'mp4' | 'webm'

export interface CodecCandidate {
  container: VideoContainer
  codec: VideoCodec
}

/** Preference order: H.264 first for compatibility, VP8 last (largest files). */
export const CODEC_CANDIDATES: readonly CodecCandidate[] = [
  { container: 'mp4', codec: 'avc' },
  { container: 'mp4', codec: 'hevc' },
  { container: 'webm', codec: 'vp9' },
  { container: 'webm', codec: 'vp8' },
]

/** H.264 bits per pixel and per frame for each quality (a sharp orthophoto flyover needs a generous budget). */
export const QUALITY_BITS_PER_PIXEL: Record<VideoQuality, number> = { standard: 0.06, high: 0.1, max: 0.16 }
/** Bitrate relative to H.264 for the same visual quality. */
export const CODEC_BITRATE_FACTOR: Partial<Record<VideoCodec, number>> = { avc: 1, hevc: 0.6, vp9: 0.65, vp8: 1.2 }
export const MIN_BITRATE = 1_000_000
export const MAX_BITRATE = 80_000_000
/** Seconds between key frames. */
export const KEY_FRAME_INTERVAL_S = 2

export const VIDEO_MIME_TYPES: Record<VideoContainer, string> = { mp4: 'video/mp4', webm: 'video/webm' }

/** Target bitrate (bits / s) for a codec at a size, frame rate and quality. */
export function videoBitrate(width: number, height: number, fps: number, quality: VideoQuality, codec: VideoCodec): number {
  const raw = width * height * fps * QUALITY_BITS_PER_PIXEL[quality] * (CODEC_BITRATE_FACTOR[codec] ?? 1)
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, raw)))
}

export interface VideoEncodeOptions {
  width: number
  height: number
  fps: number
  quality: VideoQuality
}

export type CanEncode = typeof canEncodeVideo

/** First candidate the browser can encode with these options, or null. */
export async function pickCodec(
  options: VideoEncodeOptions,
  canEncode: CanEncode = canEncodeVideo,
  candidates: readonly CodecCandidate[] = CODEC_CANDIDATES,
): Promise<CodecCandidate | null> {
  const { width, height, fps, quality } = options
  for (const candidate of candidates) {
    const bitrate = videoBitrate(width, height, fps, quality, candidate.codec)
    try {
      if (await canEncode(candidate.codec, { width, height, frameRate: fps, quality: new Quality({ bitrate }) })) {
        return candidate
      }
    } catch {
      // an invalid configuration for this codec: try the next one
    }
  }
  return null
}

/** Thrown by a session used after `cancel()`. */
export class ExportCanceledError extends Error {
  constructor() {
    super('Export annulé')
    this.name = 'ExportCanceledError'
  }
}

export interface VideoEncodeSession {
  readonly codec: CodecCandidate
  readonly bitrate: number
  readonly mimeType: string
  /** '.mp4' or '.webm' */
  readonly extension: string
  /** Encode the current content of the canvas as frame `index` (timestamp index / fps); respects backpressure. */
  addFrame(index: number): Promise<void>
  /** Finalize the file. */
  finish(): Promise<Blob>
  /** Abort the encoding and drop what was written; later calls reject with ExportCanceledError. */
  cancel(): Promise<void>
}

/**
 * Start an encoding session reading its frames from `canvas` (which must keep the size of the video).
 * Rejects when no codec is available.
 */
export async function createVideoEncoder(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: VideoEncodeOptions,
  canEncode: CanEncode = canEncodeVideo,
): Promise<VideoEncodeSession> {
  const codec = await pickCodec(options, canEncode)
  if (!codec) throw new Error("Ce navigateur ne sait encoder la vidéo dans aucun format (WebCodecs indisponible).")

  const bitrate = videoBitrate(options.width, options.height, options.fps, options.quality, codec.codec)
  const target = new BufferTarget()
  const output = new Output({
    format: codec.container === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target,
  })
  const source = new CanvasSource(canvas, {
    codec: codec.codec,
    quality: new Quality({ bitrate }),
    keyFrameInterval: KEY_FRAME_INTERVAL_S,
  })
  output.addVideoTrack(source, { frameRate: options.fps })
  await output.start()

  const frameDuration = 1 / options.fps
  const mimeType = VIDEO_MIME_TYPES[codec.container]
  let canceled = false

  return {
    codec,
    bitrate,
    mimeType,
    extension: `.${codec.container}`,
    async addFrame(index) {
      if (canceled) throw new ExportCanceledError()
      await source.add(index * frameDuration, frameDuration)
    },
    async finish() {
      if (canceled) throw new ExportCanceledError()
      source.close()
      await output.finalize()
      if (!target.buffer) throw new Error('Le fichier vidéo est vide.')
      return new Blob([target.buffer], { type: mimeType })
    },
    async cancel() {
      if (canceled) return
      canceled = true
      if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel()
    },
  }
}

/**
 * Video encoder — WebCodecs through mediabunny, writing the file in memory or, given a destination, straight to disk.
 * Codec choice (H.264, else HEVC, else VP9, else VP8: first one the browser can encode at the requested size, rate and
 * bitrate), soundtrack and disk layout: ARCHITECTURE.md "Video export".
 *
 * On disk the MP4 has no fast start (`moov` after the frames, header size patched at the end): a plain MP4 every player
 * and editor reads, where a fragmented one is less widely supported.
 * Transparent film (`transparent`): WebM / VP9 whose alpha mediabunny encodes as a second VP9 stream beside each frame
 * (`BlockAdditional`), so the browser only needs a plain VP9 encoder: that is what `pickCodec` checks.
 */
import type { MixedAudio } from '../film/audio'
import type { WritableFile } from '../platform'
import type { AudioCodec, StreamTargetChunk, VideoCodec, canEncodeAudio, canEncodeVideo } from 'mediabunny'
import type { VideoQuality } from './schedule'

/** The muxer (mediabunny, ~700 KB) is loaded on the first export or codec check, not at startup. */
const mediabunny = () => import('mediabunny')

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

/** Only candidate of a transparent film: VP9 with alpha in WebM, read by the editors that take transparent video. */
export const ALPHA_CANDIDATES: readonly CodecCandidate[] = [{ container: 'webm', codec: 'vp9' }]

/** H.264 bits per pixel and per frame for each quality (a sharp orthophoto flyover needs a generous budget). */
export const QUALITY_BITS_PER_PIXEL: Record<VideoQuality, number> = { standard: 0.06, high: 0.1, max: 0.16 }
/** Bitrate relative to H.264 for the same visual quality. */
export const CODEC_BITRATE_FACTOR: Partial<Record<VideoCodec, number>> = { avc: 1, hevc: 0.6, vp9: 0.65, vp8: 1.2 }
export const MIN_BITRATE = 1_000_000
export const MAX_BITRATE = 80_000_000
/** Seconds between key frames. */
export const KEY_FRAME_INTERVAL_S = 2

/** Size of the writes to disk (also what one desktop IPC call carries). */
export const STREAM_CHUNK_BYTES = 4 * 1024 * 1024

/** Audio codecs tried for each container, in order. */
export const AUDIO_CANDIDATES: Record<VideoContainer, readonly AudioCodec[]> = { mp4: ['aac', 'opus'], webm: ['opus'] }
export const AUDIO_BITRATE = 192_000
/** Seconds of sound handed to the muxer ahead of the frame being encoded. */
export const AUDIO_LEAD_S = 1

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
  /** write the film to this file while encoding instead of keeping it in memory */
  destination?: WritableFile
  /** soundtrack from the first frame (none: a silent film) */
  audio?: MixedAudio | null
  /** keep the transparency of the canvas (WebM / VP9, `ALPHA_CANDIDATES`) */
  transparent?: boolean
}

export type CanEncode = typeof canEncodeVideo
export type CanEncodeAudio = typeof canEncodeAudio

/** First audio codec of `container` the browser can encode for this soundtrack, or null. */
export async function pickAudioCodec(
  container: VideoContainer,
  audio: Pick<MixedAudio, 'sampleRate' | 'channels'>,
  canEncode?: CanEncodeAudio,
): Promise<AudioCodec | null> {
  const { Quality, canEncodeAudio } = await mediabunny()
  canEncode ??= canEncodeAudio
  for (const codec of AUDIO_CANDIDATES[container]) {
    try {
      const options = { numberOfChannels: audio.channels.length, sampleRate: audio.sampleRate, quality: new Quality({ bitrate: AUDIO_BITRATE }) }
      if (await canEncode(codec, options)) return codec
    } catch {
      // not this one
    }
  }
  return null
}

/** First candidate the browser can encode with these options, or null. */
export async function pickCodec(
  options: VideoEncodeOptions,
  canEncode?: CanEncode,
  candidates: readonly CodecCandidate[] = CODEC_CANDIDATES,
): Promise<CodecCandidate | null> {
  const { Quality, canEncodeVideo } = await mediabunny()
  canEncode ??= canEncodeVideo
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

/** Candidates matching the extension of the chosen file (the user may have typed `.webm`); all of them otherwise. */
export function candidatesFor(fileName: string | undefined): readonly CodecCandidate[] {
  const ext = fileName?.match(/\.([^.]+)$/)?.[1].toLowerCase()
  const matching = CODEC_CANDIDATES.filter((c) => c.container === ext)
  return matching.length > 0 ? matching : CODEC_CANDIDATES
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
  /** codec of the soundtrack; null when none was given or none can be encoded (the film is silent) */
  readonly audioCodec: AudioCodec | null
  readonly bitrate: number
  readonly mimeType: string
  /** '.mp4' or '.webm' */
  readonly extension: string
  /** Encode the current content of the canvas as frame `index` (timestamp index / fps); respects backpressure. */
  addFrame(index: number): Promise<void>
  /** Finalize the file: the blob in memory, null when it was written to the destination. */
  finish(): Promise<{ blob: Blob | null; sizeBytes: number }>
  /** Abort the encoding and drop what was written (a destination file is removed); later calls reject with ExportCanceledError. */
  cancel(): Promise<void>
}

/** Stream of mediabunny's disk target writing to `file` (chunks at their position). */
function diskStream(file: WritableFile, isCanceled: () => boolean, written: (end: number) => void): WritableStream<StreamTargetChunk> {
  return new WritableStream<StreamTargetChunk>({
    async write({ data, position }) {
      await file.write(data, position)
      written(position + data.length)
    },
    // mediabunny also closes its writer when canceled: a canceled film is removed, not kept
    close: () => (isCanceled() ? file.discard() : file.close()),
    abort: () => file.discard(),
  })
}

/**
 * Start an encoding session reading its frames from `canvas` (which must keep the size of the video).
 * Rejects when no codec is available.
 */
export async function createVideoEncoder(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: VideoEncodeOptions,
  canEncode?: CanEncode,
  canEncodeSound?: CanEncodeAudio,
): Promise<VideoEncodeSession> {
  const { AudioSample, AudioSampleSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, StreamTarget, WebMOutputFormat } =
    await mediabunny()
  const { destination, transparent = false } = options
  const codec = await pickCodec(options, canEncode, transparent ? ALPHA_CANDIDATES : candidatesFor(destination?.fileName))
  if (!codec) throw new Error("Ce navigateur ne sait encoder la vidéo dans aucun format (WebCodecs indisponible).")

  const bitrate = videoBitrate(options.width, options.height, options.fps, options.quality, codec.codec)
  let canceled = false
  let sizeBytes = 0
  const buffer = new BufferTarget()
  const target = destination
    ? new StreamTarget(
        diskStream(destination, () => canceled, (end) => (sizeBytes = Math.max(sizeBytes, end))),
        { chunked: true, chunkSize: STREAM_CHUNK_BYTES },
      )
    : buffer
  const output = new Output({
    format: codec.container === 'mp4' ? new Mp4OutputFormat(destination ? { fastStart: false } : {}) : new WebMOutputFormat(),
    target,
  })
  const source = new CanvasSource(canvas, {
    codec: codec.codec,
    quality: new Quality({ bitrate }),
    keyFrameInterval: KEY_FRAME_INTERVAL_S,
    alpha: transparent ? 'keep' : 'discard',
  })
  output.addVideoTrack(source, { frameRate: options.fps, canBeTransparent: transparent })
  const { audio } = options
  const audioCodec = audio && audio.channels.length > 0 ? await pickAudioCodec(codec.container, audio, canEncodeSound) : null
  const sound = audioCodec ? new AudioSampleSource({ codec: audioCodec, quality: new Quality({ bitrate: AUDIO_BITRATE }) }) : null
  if (sound) output.addAudioTrack(sound)
  await output.start()

  const frameDuration = 1 / options.fps
  const mimeType = VIDEO_MIME_TYPES[codec.container]

  /** samples of the soundtrack already handed to the muxer */
  let sent = 0
  /** hand the soundtrack over up to `untilS` seconds, at most a second per sample */
  const addAudio = async (untilS: number) => {
    if (!sound || !audio) return
    const { sampleRate, channels } = audio
    const until = Math.min(channels[0].length, Math.ceil(untilS * sampleRate))
    while (sent < until) {
      const n = Math.min(until - sent, sampleRate)
      const data = new Float32Array(n * channels.length)
      channels.forEach((channel, c) => data.set(channel.subarray(sent, sent + n), c * n))
      const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: channels.length, sampleRate, timestamp: sent / sampleRate })
      try {
        await sound.add(sample)
      } finally {
        sample.close()
      }
      sent += n
    }
  }

  return {
    codec,
    audioCodec,
    bitrate,
    mimeType,
    extension: `.${codec.container}`,
    async addFrame(index) {
      if (canceled) throw new ExportCanceledError()
      await addAudio((index + 1) * frameDuration + AUDIO_LEAD_S)
      await source.add(index * frameDuration, frameDuration)
    },
    async finish() {
      if (canceled) throw new ExportCanceledError()
      await addAudio(Infinity)
      sound?.close()
      source.close()
      await output.finalize()
      if (destination) return { blob: null, sizeBytes }
      if (!buffer.buffer) throw new Error('Le fichier vidéo est vide.')
      return { blob: new Blob([buffer.buffer], { type: mimeType }), sizeBytes: buffer.buffer.byteLength }
    },
    async cancel() {
      if (canceled) return
      canceled = true
      try {
        if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel()
      } finally {
        // also after a failed write (the stream is errored, mediabunny cannot close it)
        await destination?.discard()
      }
    },
  }
}

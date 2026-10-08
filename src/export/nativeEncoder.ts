/**
 * Native video encoder of the desktop app, where the webview has no WebCodecs (WebKitGTK on Linux): the system's
 * ffmpeg, run by the Rust commands of src-tauri/src/video.rs, writing the file picked in the save dialog. Same
 * contract as the WebCodecs session (`VideoEncodeSession`): each frame of the compositor is read back
 * (`getImageData`) and sent as raw RGBA bytes, a binary body rather than JSON; `video_frame` answers once ffmpeg took
 * it. MP4 / H.264, plus AAC when the film has sound (the mixed soundtrack handed over first as a WAV file); WebM / VP9
 * and Opus when the name typed in the save dialog ends in `.webm`. Never transparent: the overlay alone needs WebCodecs.
 *
 * Also the choice between both encoders: `exportCodec` (what the export panel shows) and `createExportEncoder`.
 */
import type { InvokeArgs, InvokeOptions } from '@tauri-apps/api/core'
import type { MixedAudio } from '../film/audio'
import { getPlatform, type Capabilities } from '../platform'
import {
  ALPHA_CANDIDATES,
  CODEC_CANDIDATES,
  ExportCanceledError,
  VIDEO_MIME_TYPES,
  createVideoEncoder,
  pickCodec,
  videoBitrate,
  type CodecCandidate,
  type VideoEncodeOptions,
  type VideoEncodeSession,
} from './encoder'

export type Invoke = (command: string, args?: InvokeArgs, options?: InvokeOptions) => Promise<unknown>

/** Tauri's `invoke`, loaded on first use: the web build never runs it. */
const tauriInvoke: Invoke = async (command, args, options) => (await import('@tauri-apps/api/core')).invoke(command, args, options)

/** What ffmpeg writes, unless the name typed in the save dialog ends in `.webm` (`NATIVE_WEBM_CODEC`). */
export const NATIVE_CODEC: CodecCandidate = { container: 'mp4', codec: 'avc' }
export const NATIVE_WEBM_CODEC: CodecCandidate = { container: 'webm', codec: 'vp9' }
/** Header naming the session of `video_frame`, whose body is the frame itself. */
export const SESSION_HEADER = 'x-video-session'

/** Codec ffmpeg writes at `path` (same rule as `is_webm` in video.rs). */
export function nativeCodecFor(path: string): CodecCandidate {
  return /\.webm$/i.test(path) ? NATIVE_WEBM_CODEC : NATIVE_CODEC
}

/** True when the system's ffmpeg runs (asked every time: installing it while the app is open is seen). */
export async function nativeVideoAvailable(invoke: Invoke = tauriInvoke): Promise<boolean> {
  return (await invoke('video_available')) === true
}

/** Codec an export would use here: WebCodecs (`pickCodec`), else the system's ffmpeg when installed, else null. */
export async function exportCodec(
  options: VideoEncodeOptions,
  capabilities: Capabilities = getPlatform().capabilities,
  invoke: Invoke = tauriInvoke,
): Promise<CodecCandidate | null> {
  if (capabilities.videoEncoder !== 'native') return pickCodec(options, undefined, options.transparent ? ALPHA_CANDIDATES : CODEC_CANDIDATES)
  return !options.transparent && (await nativeVideoAvailable(invoke)) ? NATIVE_CODEC : null
}

/** Encoding session of an export: WebCodecs, or the native encoder on a desktop without it. */
export function createExportEncoder(
  canvas: OffscreenCanvas,
  options: VideoEncodeOptions,
  capabilities: Capabilities = getPlatform().capabilities,
): Promise<VideoEncodeSession> {
  return capabilities.videoEncoder === 'native' && !options.transparent
    ? createNativeVideoEncoder(canvas, options)
    : createVideoEncoder(canvas, options)
}

/** The soundtrack as a 16-bit PCM WAV file (the second input of ffmpeg). */
export function wavFile({ sampleRate, channels }: MixedAudio): Uint8Array {
  const frames = channels[0]?.length ?? 0
  const blockAlign = channels.length * 2
  const dataBytes = frames * blockAlign
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, channels.length, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let c = 0; c < channels.length; c++) {
    const channel = channels[c]
    for (let i = 0, at = 44 + c * 2; i < frames; i++, at += blockAlign) {
      view.setInt16(at, Math.round(Math.max(-1, Math.min(1, channel[i])) * 32767), true)
    }
  }
  return bytes
}

/**
 * Start ffmpeg on the destination file (it must have a path: picked in the save dialog or in the batch folder) and
 * hand it the frames drawn in `canvas`, which keeps the size of the video.
 */
export async function createNativeVideoEncoder(
  canvas: OffscreenCanvas,
  options: VideoEncodeOptions,
  invoke: Invoke = tauriInvoke,
): Promise<VideoEncodeSession> {
  const { width, height, fps, quality, destination, audio } = options
  if (!destination?.path) throw new Error("Le film doit être écrit sur le disque : choisissez où l'enregistrer.")
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error("Impossible de lire l'image de composition.")
  const sound = audio && audio.channels.length > 0 ? ((await invoke('video_sound', wavFile(audio))) as number) : null
  const id = (await invoke('video_open', { path: destination.path, width, height, fps, quality, sound })) as number
  const frameOptions = { headers: { [SESSION_HEADER]: String(id) } }
  const codec = nativeCodecFor(destination.path)
  let canceled = false

  return {
    codec,
    audioCodec: sound === null ? null : codec.container === 'webm' ? 'opus' : 'aac',
    // ffmpeg aims at a constant quality (crf), not at a bitrate: this one is only the size estimate
    bitrate: videoBitrate(width, height, fps, quality, codec.codec),
    mimeType: VIDEO_MIME_TYPES[codec.container],
    extension: `.${codec.container}`,
    async addFrame() {
      if (canceled) throw new ExportCanceledError()
      const { data } = ctx.getImageData(0, 0, width, height)
      await invoke('video_frame', new Uint8Array(data.buffer, data.byteOffset, data.byteLength), frameOptions)
    },
    async finish() {
      if (canceled) throw new ExportCanceledError()
      const sizeBytes = (await invoke('video_finish', { id })) as number
      // the handle opened by the save dialog wrote nothing: closing it keeps the file of ffmpeg
      await destination.close()
      return { blob: null, sizeBytes }
    },
    async cancel() {
      if (canceled) return
      canceled = true
      try {
        await invoke('video_cancel', { id })
      } finally {
        await destination.discard()
      }
    },
  }
}

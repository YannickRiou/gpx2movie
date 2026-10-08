import { describe, expect, it, vi } from 'vitest'
import type { Capabilities, WritableFile } from '../platform'
import { ExportCanceledError } from './encoder'
import { NATIVE_CODEC, SESSION_HEADER, createNativeVideoEncoder, exportCodec, wavFile, type Invoke } from './nativeEncoder'

const OPTIONS = { width: 4, height: 2, fps: 30, quality: 'high' as const }
const NATIVE: Capabilities = { isDesktop: true, videoEncoder: 'native', canStreamToDisk: true }

/** Fake Tauri commands: records the calls, answers like video.rs; `fail` makes one command reject. */
function fakeInvoke(fail: Partial<Record<string, string>> = {}) {
  const calls: { command: string; args: unknown; options: unknown }[] = []
  const invoke = vi.fn<Invoke>(async (command, args, options) => {
    calls.push({ command, args, options })
    if (fail[command]) throw fail[command]
    return { video_available: true, video_sound: 7, video_open: 3, video_finish: 1234 }[command] ?? null
  })
  return { invoke, calls, commands: () => calls.map((c) => c.command) }
}

function fakeFile(path = '/films/Tour.mp4'): WritableFile & { close: ReturnType<typeof vi.fn>; discard: ReturnType<typeof vi.fn> } {
  return { fileName: 'Tour.mp4', path, write: vi.fn(), close: vi.fn(async () => undefined), discard: vi.fn(async () => undefined) }
}

/** A canvas whose pixels are 0, 1, 2…: what `getImageData` reads back. */
function fakeCanvas(): OffscreenCanvas {
  const data = new Uint8ClampedArray(OPTIONS.width * OPTIONS.height * 4).map((_, i) => i)
  return { getContext: () => ({ getImageData: () => ({ data }) }) } as unknown as OffscreenCanvas
}

describe('exportCodec', () => {
  it('uses ffmpeg on a desktop without WebCodecs, when it is installed', async () => {
    expect(await exportCodec(OPTIONS, NATIVE, fakeInvoke().invoke)).toEqual(NATIVE_CODEC)
    const missing = vi.fn<Invoke>(async () => false)
    expect(await exportCodec(OPTIONS, NATIVE, missing)).toBeNull()
  })

  it('never encodes a transparent film natively', async () => {
    const { invoke } = fakeInvoke()
    expect(await exportCodec({ ...OPTIONS, transparent: true }, NATIVE, invoke)).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('wavFile', () => {
  it('writes 16-bit PCM, channels interleaved', () => {
    const bytes = wavFile({ sampleRate: 48000, channels: [new Float32Array([0, 1]), new Float32Array([-1, 2])] })
    const view = new DataView(bytes.buffer)
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF')
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint32(40, true)).toBe(8)
    // left 0, right -1, left 1, right 2 clipped to 1
    expect([0, 1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([0, -32767, 32767, 32767])
  })
})

describe('createNativeVideoEncoder', () => {
  it('opens ffmpeg on the chosen file and sends each frame as raw bytes', async () => {
    const { invoke, calls, commands } = fakeInvoke()
    const file = fakeFile()
    const session = await createNativeVideoEncoder(fakeCanvas(), { ...OPTIONS, destination: file }, invoke)
    expect(calls[0].args).toEqual({ path: '/films/Tour.mp4', width: 4, height: 2, fps: 30, quality: 'high', sound: null })
    expect(session.audioCodec).toBeNull()
    expect(session.extension).toBe('.mp4')
    await session.addFrame(0)
    const frame = calls[1]
    expect(frame.command).toBe('video_frame')
    expect(frame.args).toBeInstanceOf(Uint8Array)
    expect([...(frame.args as Uint8Array)].slice(0, 4)).toEqual([0, 1, 2, 3])
    expect(frame.options).toEqual({ headers: { [SESSION_HEADER]: '3' } })
    expect(await session.finish()).toEqual({ blob: null, sizeBytes: 1234 })
    expect(commands()).toEqual(['video_open', 'video_frame', 'video_finish'])
    expect(calls[2].args).toEqual({ id: 3 })
    expect(file.close).toHaveBeenCalled()
    expect(file.discard).not.toHaveBeenCalled()
  })

  it('hands the soundtrack over first', async () => {
    const { invoke, calls } = fakeInvoke()
    const audio = { sampleRate: 48000, channels: [new Float32Array(10), new Float32Array(10)] }
    const session = await createNativeVideoEncoder(fakeCanvas(), { ...OPTIONS, destination: fakeFile(), audio }, invoke)
    expect(calls[0].command).toBe('video_sound')
    expect((calls[0].args as Uint8Array).byteLength).toBe(44 + 10 * 4)
    expect(calls[1].args).toMatchObject({ sound: 7 })
    expect(session.audioCodec).toBe('aac')
  })

  it('cancels once, removing the file, and refuses frames afterwards', async () => {
    const { invoke, commands } = fakeInvoke()
    const file = fakeFile()
    const session = await createNativeVideoEncoder(fakeCanvas(), { ...OPTIONS, destination: file }, invoke)
    await session.cancel()
    await session.cancel()
    expect(commands()).toEqual(['video_open', 'video_cancel'])
    expect(file.discard).toHaveBeenCalledTimes(1)
    await expect(session.addFrame(0)).rejects.toBeInstanceOf(ExportCanceledError)
    await expect(session.finish()).rejects.toBeInstanceOf(ExportCanceledError)
  })

  it('surfaces the errors of ffmpeg', async () => {
    const { invoke } = fakeInvoke({ video_frame: 'ffmpeg a échoué : Unknown encoder libx264' })
    const session = await createNativeVideoEncoder(fakeCanvas(), { ...OPTIONS, destination: fakeFile() }, invoke)
    await expect(session.addFrame(0)).rejects.toBe('ffmpeg a échoué : Unknown encoder libx264')
  })

  it('needs a file on disk', async () => {
    const { invoke } = fakeInvoke()
    await expect(createNativeVideoEncoder(fakeCanvas(), OPTIONS, invoke)).rejects.toThrow(/écrit sur le disque/)
    const inMemory = { ...fakeFile(), path: undefined }
    await expect(createNativeVideoEncoder(fakeCanvas(), { ...OPTIONS, destination: inMemory }, invoke)).rejects.toThrow(/écrit sur le disque/)
    expect(invoke).not.toHaveBeenCalled()
  })
})

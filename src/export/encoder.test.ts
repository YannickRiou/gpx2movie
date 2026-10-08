import { beforeEach, describe, expect, it, vi } from 'vitest'

// WebCodecs is not available in jsdom: mediabunny is replaced by a recording fake.
const fake = vi.hoisted(() => ({
  outputs: [] as {
    format: { kind: string; options?: { fastStart?: unknown } }
    state: string
    finalize: () => Promise<void>
    cancel: () => Promise<void>
  }[],
  streams: [] as { options: unknown }[],
  sources: [] as { config: { codec: string; quality: { options: { bitrate: number } } }; added: [number, number][]; closed: boolean }[],
  buffer: new ArrayBuffer(8) as ArrayBuffer | null,
  /** audio sources and what they received: [timestamp, frames, first value of each channel] */
  sounds: [] as { config: { codec: string }; added: [number, number, number[]][]; closed: boolean }[],
  /** order of the calls reaching the tracks: 'v' (a frame), 'a' (a sound sample) */
  calls: [] as string[],
}))

vi.mock('mediabunny', () => {
  class Quality {
    options: unknown
    constructor(options: unknown) {
      this.options = options
    }
  }
  class BufferTarget {
    buffer: ArrayBuffer | null = null
  }
  // like mediabunny: a writer taken at start, chunks at their position, closed on finalize and on cancel
  class StreamTarget {
    writer: WritableStreamDefaultWriter<{ type: 'write'; data: Uint8Array; position: number }> | null = null
    writable: WritableStream
    options: unknown
    constructor(writable: WritableStream, options: unknown) {
      this.writable = writable
      this.options = options
      fake.streams.push(this)
    }
  }
  class Mp4OutputFormat {
    kind = 'mp4'
    options: unknown
    constructor(options?: unknown) {
      this.options = options
    }
  }
  class WebMOutputFormat {
    kind = 'webm'
  }
  class CanvasSource {
    config: unknown
    added: [number, number][] = []
    closed = false
    constructor(_canvas: unknown, config: unknown) {
      this.config = config
      fake.sources.push(this as never)
    }
    async add(timestamp: number, duration: number) {
      this.added.push([timestamp, duration])
      fake.calls.push('v')
    }
    close() {
      this.closed = true
    }
  }
  class AudioSample {
    init: { data: Float32Array; numberOfChannels: number; sampleRate: number; timestamp: number }
    closed = false
    constructor(init: AudioSample['init']) {
      this.init = init
    }
    close() {
      this.closed = true
    }
  }
  class AudioSampleSource {
    config: unknown
    added: [number, number, number[]][] = []
    closed = false
    constructor(config: unknown) {
      this.config = config
      fake.sounds.push(this as never)
    }
    async add(sample: AudioSample) {
      const { data, numberOfChannels, timestamp } = sample.init
      const frames = data.length / numberOfChannels
      this.added.push([timestamp, frames, Array.from({ length: numberOfChannels }, (_, c) => data[c * frames])])
      fake.calls.push('a')
    }
    close() {
      this.closed = true
    }
  }
  class Output {
    format: unknown
    target: BufferTarget | StreamTarget
    state = 'pending'
    constructor({ format, target }: { format: unknown; target: BufferTarget | StreamTarget }) {
      this.format = format
      this.target = target
      fake.outputs.push(this as never)
    }
    addVideoTrack() {}
    audioTracks = 0
    addAudioTrack() {
      this.audioTracks++
    }
    async start() {
      this.state = 'started'
      if (this.target instanceof StreamTarget) this.target.writer = this.target.writable.getWriter()
    }
    async finalize() {
      if (this.target instanceof StreamTarget) {
        const writer = this.target.writer!
        await writer.write({ type: 'write', data: new Uint8Array(10), position: 0 })
        await writer.write({ type: 'write', data: new Uint8Array(4), position: 2 })
        await writer.close()
      } else this.target.buffer = fake.buffer
      this.state = 'finalized'
    }
    async cancel() {
      this.state = 'canceled'
      if (this.target instanceof StreamTarget) await this.target.writer?.close()
    }
  }
  return {
    Quality,
    BufferTarget,
    StreamTarget,
    Mp4OutputFormat,
    WebMOutputFormat,
    CanvasSource,
    AudioSample,
    AudioSampleSource,
    Output,
    canEncodeVideo: vi.fn(),
    canEncodeAudio: vi.fn(async () => false),
  }
})

import {
  AUDIO_LEAD_S,
  CODEC_CANDIDATES,
  ExportCanceledError,
  MAX_BITRATE,
  MIN_BITRATE,
  STREAM_CHUNK_BYTES,
  candidatesFor,
  createVideoEncoder,
  pickAudioCodec,
  pickCodec,
  videoBitrate,
  type CanEncode,
  type CanEncodeAudio,
} from './encoder'

const OPTIONS = { width: 1920, height: 1080, fps: 30, quality: 'high' as const }
const canvas = {} as OffscreenCanvas

/** canEncode stub accepting only the given codecs. */
function supporting(...codecs: string[]): CanEncode & ReturnType<typeof vi.fn> {
  return vi.fn(async (codec: string) => codecs.includes(codec)) as never
}

beforeEach(() => {
  fake.outputs.length = 0
  fake.streams.length = 0
  fake.sources.length = 0
  fake.buffer = new ArrayBuffer(8)
  fake.sounds.length = 0
  fake.calls.length = 0
})

describe('videoBitrate', () => {
  it('scales with pixels, frame rate and quality', () => {
    expect(videoBitrate(1920, 1080, 30, 'high', 'avc')).toBe(Math.round(1920 * 1080 * 30 * 0.1))
    expect(videoBitrate(1920, 1080, 60, 'high', 'avc')).toBe(2 * videoBitrate(1920, 1080, 30, 'high', 'avc'))
    expect(videoBitrate(1920, 1080, 30, 'standard', 'avc')).toBeLessThan(videoBitrate(1920, 1080, 30, 'max', 'avc'))
  })

  it('asks less of the more efficient codecs', () => {
    const avc = videoBitrate(1920, 1080, 30, 'high', 'avc')
    expect(videoBitrate(1920, 1080, 30, 'high', 'hevc')).toBeLessThan(avc)
    expect(videoBitrate(1920, 1080, 30, 'high', 'vp9')).toBeLessThan(avc)
    expect(videoBitrate(1920, 1080, 30, 'high', 'vp8')).toBeGreaterThan(avc)
  })

  it('is clamped', () => {
    expect(videoBitrate(320, 180, 10, 'standard', 'avc')).toBe(MIN_BITRATE)
    expect(videoBitrate(3840, 2160, 60, 'max', 'vp8')).toBe(MAX_BITRATE)
  })
})

describe('pickCodec', () => {
  it('prefers MP4 / H.264', async () => {
    const canEncode = supporting('avc', 'hevc', 'vp9', 'vp8')
    expect(await pickCodec(OPTIONS, canEncode)).toEqual({ container: 'mp4', codec: 'avc' })
    expect(canEncode).toHaveBeenCalledTimes(1)
    const [codec, query] = canEncode.mock.calls[0] as [string, Record<string, unknown>]
    expect(codec).toBe('avc')
    expect(query).toMatchObject({ width: 1920, height: 1080, frameRate: 30 })
    expect(query.quality).toMatchObject({ options: { bitrate: videoBitrate(1920, 1080, 30, 'high', 'avc') } })
  })

  it('falls back to HEVC, then WebM VP9, then VP8', async () => {
    expect(await pickCodec(OPTIONS, supporting('hevc', 'vp8'))).toEqual({ container: 'mp4', codec: 'hevc' })
    expect(await pickCodec(OPTIONS, supporting('vp9', 'vp8'))).toEqual({ container: 'webm', codec: 'vp9' })
    expect(await pickCodec(OPTIONS, supporting('vp8'))).toEqual({ container: 'webm', codec: 'vp8' })
  })

  it('skips a codec whose check throws and returns null when nothing is encodable', async () => {
    const canEncode = vi.fn(async (codec: string) => {
      if (codec === 'avc') throw new TypeError('bad config')
      return codec === 'vp9'
    }) as unknown as CanEncode
    expect(await pickCodec(OPTIONS, canEncode)).toEqual({ container: 'webm', codec: 'vp9' })
    expect(await pickCodec(OPTIONS, supporting())).toBeNull()
  })

  it('checks the actual frame size: a vertical 4K film falls back when H.264 is limited to 4096 × 2304', async () => {
    const limitedAvc = vi.fn(async (codec: string, query: { width: number; height: number }) =>
      codec === 'avc' ? query.width <= 4096 && query.height <= 2304 : codec === 'vp9',
    ) as unknown as CanEncode
    expect(await pickCodec({ ...OPTIONS, width: 3840, height: 2160 }, limitedAvc)).toEqual({ container: 'mp4', codec: 'avc' })
    expect(await pickCodec({ ...OPTIONS, width: 2160, height: 3840 }, limitedAvc)).toEqual({ container: 'webm', codec: 'vp9' })
    expect(await pickCodec({ ...OPTIONS, width: 5040, height: 2160 }, limitedAvc)).toEqual({ container: 'webm', codec: 'vp9' })
  })

  it('tries the candidates in order', () => {
    expect(CODEC_CANDIDATES.map((c) => `${c.container}/${c.codec}`)).toEqual(['mp4/avc', 'mp4/hevc', 'webm/vp9', 'webm/vp8'])
  })
})

describe('createVideoEncoder', () => {
  it('encodes frames at index / fps and returns an MP4 blob', async () => {
    const session = await createVideoEncoder(canvas, OPTIONS, supporting('avc'))
    expect(session.codec).toEqual({ container: 'mp4', codec: 'avc' })
    expect(session.extension).toBe('.mp4')
    expect(session.mimeType).toBe('video/mp4')
    expect(fake.outputs[0].format.kind).toBe('mp4')
    expect(fake.sources[0].config.codec).toBe('avc')
    expect(fake.sources[0].config.quality.options.bitrate).toBe(session.bitrate)

    await session.addFrame(0)
    await session.addFrame(1)
    await session.addFrame(2)
    expect(fake.sources[0].added.map(([t]) => t)).toEqual([0, 1 / 30, 2 / 30])
    expect(fake.sources[0].added[0][1]).toBeCloseTo(1 / 30)

    const { blob, sizeBytes } = await session.finish()
    expect(blob?.type).toBe('video/mp4')
    expect(blob?.size).toBe(8)
    expect(sizeBytes).toBe(8)
    expect(fake.outputs[0].format.options?.fastStart).toBeUndefined()
    expect(fake.sources[0].closed).toBe(true)
    expect(fake.outputs[0].state).toBe('finalized')
  })

  it('writes WebM when only VP9 / VP8 are available', async () => {
    const session = await createVideoEncoder(canvas, OPTIONS, supporting('vp8'))
    expect(session.extension).toBe('.webm')
    expect(fake.outputs[0].format.kind).toBe('webm')
    expect((await session.finish()).blob?.type).toBe('video/webm')
  })

  it('rejects when no codec is available', async () => {
    await expect(createVideoEncoder(canvas, OPTIONS, supporting())).rejects.toThrow(/aucun format/)
    expect(fake.outputs).toHaveLength(0)
  })

  it('cancel aborts the output and refuses later frames', async () => {
    const session = await createVideoEncoder(canvas, OPTIONS, supporting('avc'))
    await session.addFrame(0)
    await session.cancel()
    await session.cancel()
    expect(fake.outputs[0].state).toBe('canceled')
    await expect(session.addFrame(1)).rejects.toBeInstanceOf(ExportCanceledError)
    await expect(session.finish()).rejects.toBeInstanceOf(ExportCanceledError)
  })

  it('reports an empty output', async () => {
    fake.buffer = null
    const session = await createVideoEncoder(canvas, OPTIONS, supporting('avc'))
    await expect(session.finish()).rejects.toThrow(/vide/)
  })
})

/** Destination file recording what reaches it. */
function fakeFile(fileName = 'Tour.mp4') {
  return {
    fileName,
    write: vi.fn(async (_data: Uint8Array, _position: number) => undefined),
    close: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
  }
}

describe('createVideoEncoder on disk', () => {
  it('streams a plain MP4 (no fast start) to the destination, in chunks', async () => {
    const destination = fakeFile()
    const session = await createVideoEncoder(canvas, { ...OPTIONS, destination }, supporting('avc'))
    expect(fake.outputs[0].format.options?.fastStart).toBe(false)
    expect(fake.streams[0].options).toEqual({ chunked: true, chunkSize: STREAM_CHUNK_BYTES })
    await session.addFrame(0)
    const { blob, sizeBytes } = await session.finish()
    expect(blob).toBeNull()
    expect(sizeBytes).toBe(10)
    expect(destination.write.mock.calls.map(([data, position]) => [position, data.length])).toEqual([
      [0, 10],
      [2, 4],
    ])
    expect(destination.close).toHaveBeenCalledTimes(1)
    expect(destination.discard).not.toHaveBeenCalled()
  })

  it('removes the file when canceled (mediabunny closes its writer then)', async () => {
    const destination = fakeFile()
    const session = await createVideoEncoder(canvas, { ...OPTIONS, destination }, supporting('avc'))
    await session.addFrame(0)
    await session.cancel()
    expect(destination.close).not.toHaveBeenCalled()
    expect(destination.discard).toHaveBeenCalled()
    await expect(session.finish()).rejects.toBeInstanceOf(ExportCanceledError)
  })

  it('removes the file even when canceling fails (a write failed)', async () => {
    const destination = fakeFile()
    const session = await createVideoEncoder(canvas, { ...OPTIONS, destination }, supporting('avc'))
    vi.spyOn(fake.outputs[0], 'cancel').mockRejectedValueOnce(new Error('disque plein'))
    await expect(session.cancel()).rejects.toThrow(/disque plein/)
    expect(destination.discard).toHaveBeenCalledTimes(1)
  })

  it('follows the extension of the chosen file', async () => {
    const session = await createVideoEncoder(canvas, { ...OPTIONS, destination: fakeFile('Tour.webm') }, supporting('avc', 'vp9'))
    expect(session.codec).toEqual({ container: 'webm', codec: 'vp9' })
    expect(candidatesFor('Tour.MP4').map((c) => c.container)).toEqual(['mp4', 'mp4'])
    expect(candidatesFor('Tour')).toBe(CODEC_CANDIDATES)
    expect(candidatesFor(undefined)).toBe(CODEC_CANDIDATES)
  })
})

/** Soundtrack of `seconds` at a tiny rate: channel c holds c + sample index / 1000. */
function soundtrack(seconds: number, sampleRate = 10, channels = 2) {
  return {
    sampleRate,
    channels: Array.from({ length: channels }, (_, c) => Float32Array.from({ length: seconds * sampleRate }, (_, i) => c + i / 1000)),
  }
}

describe('soundtrack', () => {
  it('prefers AAC in MP4, else Opus; only Opus in WebM', async () => {
    const audio = soundtrack(1)
    expect(await pickAudioCodec('mp4', audio, supporting('aac', 'opus') as unknown as CanEncodeAudio)).toBe('aac')
    expect(await pickAudioCodec('mp4', audio, supporting('opus') as unknown as CanEncodeAudio)).toBe('opus')
    expect(await pickAudioCodec('webm', audio, supporting('aac') as unknown as CanEncodeAudio)).toBeNull()
    const canEncode = supporting('opus') as unknown as CanEncodeAudio & ReturnType<typeof vi.fn>
    await pickAudioCodec('webm', audio, canEncode)
    expect(canEncode.mock.calls[0][1]).toMatchObject({ numberOfChannels: 2, sampleRate: 10 })
  })

  it('hands the sound over along the frames, about a second ahead, then the rest at the end', async () => {
    // 3 s of sound for a 2 fps film of 6 frames
    const session = await createVideoEncoder(canvas, { ...OPTIONS, fps: 2, audio: soundtrack(3) }, supporting('avc'), supporting('aac') as never)
    expect(session.audioCodec).toBe('aac')
    expect(fake.outputs[0]).toMatchObject({ audioTracks: 1 })
    expect(fake.sounds[0].config).toMatchObject({ codec: 'aac' })
    await session.addFrame(0)
    // frame 0 lasts until 0.5 s: sound up to 0.5 + AUDIO_LEAD_S before it
    expect(fake.sounds[0].added.reduce((n, [, frames]) => n + frames, 0)).toBe((0.5 + AUDIO_LEAD_S) * 10)
    expect(fake.calls).toEqual(['a', 'a', 'v'])
    for (let i = 1; i < 6; i++) await session.addFrame(i)
    await session.finish()
    const added = fake.sounds[0].added
    // contiguous samples of at most a second, planar channels kept apart
    expect(added.map(([t]) => t)).toEqual([0, 1, 1.5, 2, 2.5])
    expect(added.map(([, n]) => n)).toEqual([10, 5, 5, 5, 5])
    expect(added[1][2]).toEqual([Math.fround(0.01), Math.fround(1.01)])
    expect(fake.sounds[0].closed).toBe(true)
  })

  it('encodes a silent film when no audio codec is available', async () => {
    const session = await createVideoEncoder(canvas, { ...OPTIONS, audio: soundtrack(1) }, supporting('avc'), supporting() as never)
    expect(session.audioCodec).toBeNull()
    expect(fake.outputs[0]).toMatchObject({ audioTracks: 0 })
    await session.addFrame(0)
    await session.finish()
    expect(fake.sounds).toHaveLength(0)
  })

  it('has no audio track without music', async () => {
    const session = await createVideoEncoder(canvas, OPTIONS, supporting('avc'), supporting('aac') as never)
    expect(session.audioCodec).toBeNull()
    expect(fake.outputs[0]).toMatchObject({ audioTracks: 0 })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// WebCodecs is not available in jsdom: mediabunny is replaced by a recording fake.
const fake = vi.hoisted(() => ({
  outputs: [] as { format: { kind: string }; state: string; finalize: () => Promise<void>; cancel: () => Promise<void> }[],
  sources: [] as { config: { codec: string; quality: { options: { bitrate: number } } }; added: [number, number][]; closed: boolean }[],
  buffer: new ArrayBuffer(8) as ArrayBuffer | null,
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
  class Mp4OutputFormat {
    kind = 'mp4'
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
    }
    close() {
      this.closed = true
    }
  }
  class Output {
    format: unknown
    target: BufferTarget
    state = 'pending'
    constructor({ format, target }: { format: unknown; target: BufferTarget }) {
      this.format = format
      this.target = target
      fake.outputs.push(this as never)
    }
    addVideoTrack() {}
    async start() {
      this.state = 'started'
    }
    async finalize() {
      this.state = 'finalized'
      this.target.buffer = fake.buffer
    }
    async cancel() {
      this.state = 'canceled'
    }
  }
  return { Quality, BufferTarget, Mp4OutputFormat, WebMOutputFormat, CanvasSource, Output, canEncodeVideo: vi.fn() }
})

import {
  CODEC_CANDIDATES,
  ExportCanceledError,
  MAX_BITRATE,
  MIN_BITRATE,
  createVideoEncoder,
  pickCodec,
  videoBitrate,
  type CanEncode,
} from './encoder'

const OPTIONS = { width: 1920, height: 1080, fps: 30, quality: 'high' as const }
const canvas = {} as OffscreenCanvas

/** canEncode stub accepting only the given codecs. */
function supporting(...codecs: string[]): CanEncode & ReturnType<typeof vi.fn> {
  return vi.fn(async (codec: string) => codecs.includes(codec)) as never
}

beforeEach(() => {
  fake.outputs.length = 0
  fake.sources.length = 0
  fake.buffer = new ArrayBuffer(8)
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

    const blob = await session.finish()
    expect(blob.type).toBe('video/mp4')
    expect(blob.size).toBe(8)
    expect(fake.sources[0].closed).toBe(true)
    expect(fake.outputs[0].state).toBe('finalized')
  })

  it('writes WebM when only VP9 / VP8 are available', async () => {
    const session = await createVideoEncoder(canvas, OPTIONS, supporting('vp8'))
    expect(session.extension).toBe('.webm')
    expect(fake.outputs[0].format.kind).toBe('webm')
    expect((await session.finish()).type).toBe('video/webm')
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

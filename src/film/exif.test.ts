import { describe, expect, it } from 'vitest'
import { mp4CreationTimeMs, parseExif, photoTimeMs, quickTimeDateMs } from './exif'

type Tag = { tag: number; ascii?: string; long?: number; rationals?: [number, number][] }

const TIFF_SIZE = 1024

/** A small JPEG head: SOI, a JFIF segment, the APP1 « Exif » segment with these IFDs, then the start of scan. */
function jpeg({ exif = [], gps = [] }: { exif?: Tag[]; gps?: Tag[] }, little = true): ArrayBuffer {
  const jfif = 18
  const tiffAt = 2 + jfif + 10
  const buffer = new ArrayBuffer(tiffAt + TIFF_SIZE + 2)
  const v = new DataView(buffer)
  v.setUint16(0, 0xffd8)
  v.setUint16(2, 0xffe0)
  v.setUint16(4, jfif - 2)
  v.setUint16(2 + jfif, 0xffe1)
  v.setUint16(4 + jfif, 8 + TIFF_SIZE)
  v.setUint32(6 + jfif, 0x45786966)
  v.setUint16(10 + jfif, 0)
  v.setUint16(tiffAt + TIFF_SIZE, 0xffda)

  const w16 = (o: number, x: number) => v.setUint16(tiffAt + o, x, little)
  const w32 = (o: number, x: number) => v.setUint32(tiffAt + o, x, little)
  let free = 600
  const writeIfd = (at: number, tags: Tag[]) => {
    w16(at, tags.length)
    tags.forEach((t, k) => {
      const e = at + 2 + 12 * k
      w16(e, t.tag)
      if (t.ascii !== undefined) {
        const bytes = [...t.ascii].map((c) => c.charCodeAt(0)).concat(0)
        w16(e + 2, 2)
        w32(e + 4, bytes.length)
        const to = bytes.length <= 4 ? e + 8 : free
        if (bytes.length > 4) {
          w32(e + 8, free)
          free += bytes.length
        }
        bytes.forEach((b, i) => v.setUint8(tiffAt + to + i, b))
      } else if (t.long !== undefined) {
        w16(e + 2, 4)
        w32(e + 4, 1)
        w32(e + 8, t.long)
      } else if (t.rationals) {
        w16(e + 2, 5)
        w32(e + 4, t.rationals.length)
        w32(e + 8, free)
        for (const [num, den] of t.rationals) {
          w32(free, num)
          w32(free + 4, den)
          free += 8
        }
      }
    })
    w32(at + 2 + 12 * tags.length, 0)
  }
  v.setUint16(tiffAt, little ? 0x4949 : 0x4d4d)
  w16(2, 42)
  w32(4, 8)
  writeIfd(8, [
    { tag: 0x8769, long: 100 },
    { tag: 0x8825, long: 300 },
  ])
  writeIfd(100, exif)
  writeIfd(300, gps)
  return buffer
}

/** 45° 55' 12.6" N, 6° 52' 10.8" E */
const GPS: Tag[] = [
  { tag: 1, ascii: 'N' },
  { tag: 2, rationals: [[45, 1], [55, 1], [126, 10]] },
  { tag: 3, ascii: 'E' },
  { tag: 4, rationals: [[6, 1], [52, 1], [108, 10]] },
]
const LAT = 45 + 55 / 60 + 12.6 / 3600
const LON = 6 + 52 / 60 + 10.8 / 3600

describe('parseExif', () => {
  it.each([true, false])('reads the GPS position (little endian %s)', (little) => {
    const exif = parseExif(jpeg({ gps: GPS }, little))
    expect(exif.lat).toBeCloseTo(LAT, 9)
    expect(exif.lon).toBeCloseTo(LON, 9)
    expect(exif.timeMs).toBeUndefined()
  })

  it('signs the southern and western hemispheres, ignores a 0, 0 position', () => {
    const south = GPS.map((t) => (t.tag === 1 ? { tag: 1, ascii: 'S' } : t.tag === 3 ? { tag: 3, ascii: 'W' } : t))
    expect(parseExif(jpeg({ gps: south }))).toMatchObject({ lat: -LAT, lon: -LON })
    const zero = GPS.map((t) => (t.rationals ? { ...t, rationals: [[0, 1], [0, 1], [0, 1]] as [number, number][] } : t))
    expect(parseExif(jpeg({ gps: zero })).lat).toBeUndefined()
  })

  it('capture time: original time with its offset, else GPS time (UTC), else wall clock only', () => {
    const original = { tag: 0x9003, ascii: '2025:07:12 10:32:05' }
    expect(parseExif(jpeg({ exif: [original, { tag: 0x9011, ascii: '+02:00' }] })).timeMs).toBe(Date.UTC(2025, 6, 12, 8, 32, 5))
    const gpsTime: Tag[] = [
      { tag: 7, rationals: [[8, 1], [32, 1], [50, 10]] },
      { tag: 0x1d, ascii: '2025:07:12' },
    ]
    expect(parseExif(jpeg({ exif: [original], gps: gpsTime })).timeMs).toBe(Date.UTC(2025, 6, 12, 8, 32, 5))
    const local = parseExif(jpeg({ exif: [original] }))
    expect(local).toEqual({ localTime: '2025:07:12 10:32:05' })
    // read in the time zone given (the browser's by default)
    expect(photoTimeMs(local, (y, mo, d, h, mi, s) => Date.UTC(y, mo - 1, d, h - 2, mi, s))).toBe(Date.UTC(2025, 6, 12, 8, 32, 5))
    expect(photoTimeMs({ timeMs: 5 })).toBe(5)
    expect(photoTimeMs({})).toBeUndefined()
    // a camera without clock
    expect(parseExif(jpeg({ exif: [{ tag: 0x9003, ascii: '0000:00:00 00:00:00' }] }))).toEqual({})
  })

  it('gives nothing for other files, missing or corrupt blocks', () => {
    expect(parseExif(new ArrayBuffer(0))).toEqual({})
    expect(parseExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).buffer)).toEqual({})
    expect(parseExif(jpeg({}))).toEqual({})
    // cut inside the GPS values
    expect(parseExif(jpeg({ gps: GPS }).slice(0, 2 + 18 + 10 + 330))).toEqual({})
  })
})

/** An MP4 box: 32-bit size, type, content. */
function box(type: string, ...content: Uint8Array[]): Uint8Array {
  const size = 8 + content.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(size)
  new DataView(out.buffer).setUint32(0, size)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  let at = 8
  for (const c of content) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** Movie header content: version, flags, creation time (32 or 64 bits), then filler. */
function mvhd(seconds: number, version = 0): Uint8Array {
  const out = new Uint8Array(version === 1 ? 108 : 96)
  const v = new DataView(out.buffer)
  out[0] = version
  if (version === 1) {
    v.setUint32(4, Math.floor(seconds / 2 ** 32))
    v.setUint32(8, seconds % 2 ** 32)
  } else {
    v.setUint32(4, seconds)
  }
  return out
}

const reader = (file: Uint8Array) => {
  const reads: number[] = []
  const read = async (offset: number, length: number) => {
    reads.push(length)
    return file.slice(offset, offset + length)
  }
  return { read, reads }
}

const MP4_EPOCH_S = 2_082_844_800
const RECORDED = Date.UTC(2024, 5, 12, 8, 15, 30)

describe('mp4CreationTimeMs', () => {
  it('reads the creation time of the movie header, moov at the start or after the media data', async () => {
    const seconds = RECORDED / 1000 + MP4_EPOCH_S
    const moov = box('moov', box('mvhd', mvhd(seconds)), box('trak', new Uint8Array(40)))
    const atStart = new Uint8Array([...box('ftyp', new Uint8Array(12)), ...moov, ...box('mdat', new Uint8Array(5000))])
    expect(await mp4CreationTimeMs(reader(atStart).read, atStart.length)).toBe(RECORDED)
    const atEnd = new Uint8Array([...box('ftyp', new Uint8Array(12)), ...box('mdat', new Uint8Array(5000)), ...moov])
    const { read, reads } = reader(atEnd)
    expect(await mp4CreationTimeMs(read, atEnd.length)).toBe(RECORDED)
    // box headers only: the media data is skipped
    expect(Math.max(...reads)).toBeLessThanOrEqual(16)
    const v1 = box('moov', box('mvhd', mvhd(seconds, 1)))
    expect(await mp4CreationTimeMs(reader(v1).read, v1.length)).toBe(RECORDED)
  })

  it('reads seconds since 1970 written by mistake, ignores unset clocks and other files', async () => {
    const unix = box('moov', box('mvhd', mvhd(RECORDED / 1000)))
    expect(await mp4CreationTimeMs(reader(unix).read, unix.length)).toBe(RECORDED)
    for (const seconds of [0, 86_400, MP4_EPOCH_S]) {
      const file = box('moov', box('mvhd', mvhd(seconds)))
      expect(await mp4CreationTimeMs(reader(file).read, file.length)).toBeUndefined()
    }
    const noMoov = box('ftyp', new Uint8Array(12))
    expect(await mp4CreationTimeMs(reader(noMoov).read, noMoov.length)).toBeUndefined()
    const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(await mp4CreationTimeMs(reader(webm).read, webm.length)).toBeUndefined()
    expect(await mp4CreationTimeMs(() => Promise.reject(new Error('lecture')), 100)).toBeUndefined()
  })
})

describe('quickTimeDateMs', () => {
  it('reads the local date and its offset written by Apple devices', () => {
    expect(quickTimeDateMs('2024-06-12T10:15:30+0200')).toBe(RECORDED)
    expect(quickTimeDateMs('2024-06-12T10:15:30+02:00')).toBe(RECORDED)
    expect(quickTimeDateMs('2024-06-12T08:15:30Z')).toBe(RECORDED)
    expect(quickTimeDateMs('2024-06-12T03:15:30.250-0500')).toBe(RECORDED)
  })

  it('ignores a date without time or time zone', () => {
    expect(quickTimeDateMs('2024')).toBeUndefined()
    expect(quickTimeDateMs('2024-06-12T10:15:30')).toBeUndefined()
    expect(quickTimeDateMs('')).toBeUndefined()
  })
})

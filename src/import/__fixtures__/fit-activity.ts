/**
 * Test helper: a minimal FIT writer (file header, one definition per data message, CRC) to build small activities
 * so the decoder can be exercised end to end under vitest (no binary fixture to maintain).
 */
import { FIT_EPOCH_MS } from '../fit'

const DEG_TO_SEMI = 2 ** 31 / 180

/** Degrees -> FIT semicircles (rounded, as a device would store them). */
export function toSemicircles(deg: number): number {
  return Math.round(deg * DEG_TO_SEMI)
}

/** Epoch ms -> seconds since the FIT epoch. */
export function fitSeconds(ms: number): number {
  return Math.round((ms - FIT_EPOCH_MS) / 1000)
}

/** Base type bytes of the definition messages. */
export const ENUM = 0x00
export const SINT8 = 0x01
export const UINT8 = 0x02
export const UINT16 = 0x84
export const SINT32 = 0x85
export const UINT32 = 0x86
export const BYTE = 0x0d

/** [field number, base type, raw value or array of raw values] */
export type FitField = readonly [number, number, number | readonly number[]]

export interface FitMessage {
  /** Global message number (0 file_id, 18 session, 20 record, 34 activity…). */
  num: number
  fields: FitField[]
  bigEndian?: boolean
  /** Sizes of developer fields appended to the message (filled with 0xff). */
  devFieldSizes?: number[]
  /** Write the data message with a compressed timestamp header carrying this 5-bit time offset. */
  timeOffset?: number
}

/** CRC-16 of the FIT protocol (polynomial 0x8005, reflected). */
function crc16(bytes: readonly number[]): number {
  let crc = 0
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1
  }
  return crc
}

function pushInt(out: number[], value: number, size: number, bigEndian = false): void {
  const bytes = Array.from({ length: size }, (_, i) => (value >>> (8 * i)) & 0xff)
  out.push(...(bigEndian ? bytes.reverse() : bytes))
}

/** Encode messages as a FIT file (local message type 0, a definition before each data message). */
export function encodeFit(messages: FitMessage[]): ArrayBuffer {
  const data: number[] = []
  for (const { num, fields, bigEndian = false, devFieldSizes = [], timeOffset } of messages) {
    data.push(devFieldSizes.length > 0 ? 0x60 : 0x40, 0, bigEndian ? 1 : 0)
    pushInt(data, num, 2, bigEndian)
    data.push(fields.length)
    for (const [field, baseType, value] of fields) data.push(field, sizeOf(baseType) * values(value).length, baseType)
    if (devFieldSizes.length > 0) {
      data.push(devFieldSizes.length)
      devFieldSizes.forEach((size, i) => data.push(i, size, 0))
    }
    data.push(timeOffset === undefined ? 0x00 : 0x80 | (timeOffset & 0x1f))
    for (const [, baseType, value] of fields) for (const v of values(value)) pushInt(data, v, sizeOf(baseType), bigEndian)
    for (const size of devFieldSizes) data.push(...new Array<number>(size).fill(0xff))
  }
  const header = [14, 0x20]
  pushInt(header, 2132, 2)
  pushInt(header, data.length, 4)
  header.push(...Array.from('.FIT', (c) => c.charCodeAt(0)))
  pushInt(header, crc16(header), 2)
  const file = [...header, ...data]
  pushInt(file, crc16(file), 2)
  return new Uint8Array(file).buffer
}

function sizeOf(baseType: number): number {
  return [1, 1, 1, 2, 2, 4, 4, 1, 4, 8, 1, 2, 4, 1][baseType & 0x1f]
}

function values(value: number | readonly number[]): readonly number[] {
  return typeof value === 'number' ? [value] : value
}

/** Copy bytes into a standalone ArrayBuffer (what File.arrayBuffer() hands to parseFit). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export const FIT_ACTIVITY_START = Date.parse('2025-07-12T07:00:00Z')

/**
 * Minimal FIT activity: file_id, 4 records (the second one has no position, like a point recorded
 * before the GPS fix), a session with sport = hiking and an activity recorded at UTC+2. Three positioned points, 180 s
 * long.
 */
export function buildFitActivity(): ArrayBuffer {
  const start = FIT_ACTIVITY_START
  const messages: FitMessage[] = [
    // type = activity, manufacturer = development
    { num: 0, fields: [[0, ENUM, 4], [1, UINT16, 255], [2, UINT16, 1], [4, UINT32, fitSeconds(start)]] },
  ]
  const records = [
    { lat: 45.8911, lon: 6.7986, alt: 1010, hr: 95, cad: 60, temp: 18, power: 0, t: 0 },
    { t: 60 },
    { lat: 45.8905, lon: 6.797, alt: 1032.4, hr: 110, cad: 62, temp: 18, power: 180, t: 120 },
    { lat: 45.8898, lon: 6.7955, alt: 1061, hr: 128, cad: 65, temp: 19, power: 210, t: 180 },
  ]
  for (const r of records) {
    const fields: FitField[] = [[253, UINT32, fitSeconds(start + r.t * 1000)]]
    if (r.lat !== undefined && r.lon !== undefined) {
      const alt = Math.round((r.alt + 500) * 5) // scale 5, offset 500
      fields.push(
        [0, SINT32, toSemicircles(r.lat)],
        [1, SINT32, toSemicircles(r.lon)],
        [78, UINT32, alt],
        [2, UINT16, alt],
        [3, UINT8, r.hr],
        [4, UINT8, r.cad],
        [13, SINT8, r.temp],
        [7, UINT16, r.power],
      )
    }
    messages.push({ num: 20, fields })
  }
  const end = fitSeconds(start + 180_000)
  // session: sport = hiking (17), sub_sport = generic, elapsed and timer times in ms
  messages.push({
    num: 18,
    fields: [
      [253, UINT32, end],
      [2, UINT32, fitSeconds(start)],
      [5, ENUM, 17],
      [6, ENUM, 0],
      [7, UINT32, 180_000],
      [8, UINT32, 180_000],
    ],
  })
  // activity: local_timestamp two hours ahead of the UTC timestamp, one session
  messages.push({ num: 34, fields: [[253, UINT32, end], [5, UINT32, end + 7200], [1, UINT16, 1]] })
  return encodeFit(messages)
}

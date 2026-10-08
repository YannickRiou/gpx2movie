/**
 * Where and when a photo was taken, read from the EXIF block of a JPEG file: GPS position, capture time (with its
 * time zone when the camera wrote one). A tiny pure parser (no DOM, no dependency) over the first bytes of the
 * file; anything unreadable gives an empty result, never an error.
 *
 * Also when a video clip was recorded (`mp4CreationTimeMs`, `quickTimeDateMs`): the creation time of the movie
 * header (`mvhd`) of an MP4 / QuickTime file, and the date with its time zone written by Apple devices.
 */

export interface PhotoExif {
  lon?: number
  lat?: number
  /** capture instant (ms since epoch) when the photo gives its time zone: original time and offset, or GPS time */
  timeMs?: number
  /** wall-clock capture time without time zone ("2024:07:14 10:32:05"), when `timeMs` could not be known */
  localTime?: string
}

/** Bytes of the file that hold the EXIF block (the APP1 segment comes first and is at most 64 KB). */
export const EXIF_SCAN_BYTES = 128 * 1024

const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825
const TAG_DATE_TIME_ORIGINAL = 0x9003
const TAG_OFFSET_TIME_ORIGINAL = 0x9011
const GPS_LAT_REF = 0x0001
const GPS_LAT = 0x0002
const GPS_LON_REF = 0x0003
const GPS_LON = 0x0004
const GPS_TIME = 0x0007
const GPS_DATE = 0x001d

/** Bytes per value of each TIFF type (BYTE, ASCII, SHORT, LONG, RATIONAL, SBYTE, UNDEFINED, SSHORT, SLONG, SRATIONAL). */
const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8 }

interface Entry {
  type: number
  count: number
  /** offset of the value in the view (inline values included) */
  at: number
}

/** Offset of the TIFF header inside the APP1 « Exif » segment of a JPEG, -1 when there is none. */
function findTiff(view: DataView): number {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return -1
  let at = 2
  while (at + 4 <= view.byteLength) {
    if (view.getUint8(at) !== 0xff) return -1
    const marker = view.getUint8(at + 1)
    // start of the image data or end of file: no EXIF before
    if (marker === 0xda || marker === 0xd9) return -1
    const length = view.getUint16(at + 2)
    const isExif =
      marker === 0xe1 &&
      at + 10 <= view.byteLength &&
      view.getUint32(at + 4) === 0x45786966 && // "Exif"
      view.getUint16(at + 8) === 0
    if (isExif) return at + 10
    at += 2 + length
  }
  return -1
}

/** Read the EXIF block of a JPEG file (its first `EXIF_SCAN_BYTES` are enough). */
export function parseExif(buffer: ArrayBuffer): PhotoExif {
  try {
    return readExif(new DataView(buffer))
  } catch {
    // truncated or corrupt block
    return {}
  }
}

function readExif(view: DataView): PhotoExif {
  const tiff = findTiff(view)
  if (tiff < 0 || tiff + 8 > view.byteLength) return {}
  const order = view.getUint16(tiff)
  if (order !== 0x4949 && order !== 0x4d4d) return {}
  const little = order === 0x4949
  const u16 = (at: number) => view.getUint16(at, little)
  const u32 = (at: number) => view.getUint32(at, little)
  if (u16(tiff + 2) !== 42) return {}

  const readIfd = (offset: number): Map<number, Entry> => {
    const entries = new Map<number, Entry>()
    const start = tiff + offset
    if (offset <= 0 || start + 2 > view.byteLength) return entries
    const count = u16(start)
    for (let k = 0; k < count; k++) {
      const e = start + 2 + 12 * k
      if (e + 12 > view.byteLength) break
      const type = u16(e + 2)
      const n = u32(e + 4)
      const size = (TYPE_SIZES[type] ?? 0) * n
      entries.set(u16(e), { type, count: n, at: size <= 4 ? e + 8 : tiff + u32(e + 8) })
    }
    return entries
  }
  const ascii = (entry: Entry | undefined): string | undefined => {
    if (!entry || entry.type !== 2 || entry.at + entry.count > view.byteLength) return undefined
    let text = ''
    for (let i = 0; i < entry.count; i++) {
      const c = view.getUint8(entry.at + i)
      if (c === 0) break
      text += String.fromCharCode(c)
    }
    return text.trim() || undefined
  }
  const rationals = (entry: Entry | undefined): number[] | undefined => {
    if (!entry || entry.type !== 5 || entry.at + 8 * entry.count > view.byteLength) return undefined
    return Array.from({ length: entry.count }, (_, i) => {
      const den = u32(entry.at + 8 * i + 4)
      return den === 0 ? Number.NaN : u32(entry.at + 8 * i) / den
    })
  }
  const offsetOf = (entries: Map<number, Entry>, tag: number) => {
    const entry = entries.get(tag)
    return entry && (entry.type === 4 || entry.type === 13) ? u32(entry.at) : 0
  }

  const ifd0 = readIfd(u32(tiff + 4))
  const exif = readIfd(offsetOf(ifd0, TAG_EXIF_IFD))
  const gps = readIfd(offsetOf(ifd0, TAG_GPS_IFD))
  const out: PhotoExif = {}

  const degrees = (value: number[] | undefined, ref: string | undefined, negative: string, max: number) => {
    if (!value || value.length < 1 || value.some(Number.isNaN)) return undefined
    const d = value[0] + (value[1] ?? 0) / 60 + (value[2] ?? 0) / 3600
    return d <= max ? (ref?.toUpperCase() === negative ? -d : d) : undefined
  }
  const lat = degrees(rationals(gps.get(GPS_LAT)), ascii(gps.get(GPS_LAT_REF)), 'S', 90)
  const lon = degrees(rationals(gps.get(GPS_LON)), ascii(gps.get(GPS_LON_REF)), 'W', 180)
  // 0, 0 is what some cameras write without a fix
  if (lat !== undefined && lon !== undefined && (lat !== 0 || lon !== 0)) {
    out.lat = lat
    out.lon = lon
  }

  const original = ascii(exif.get(TAG_DATE_TIME_ORIGINAL))
  const zoned = original ? zonedTimeMs(original, ascii(exif.get(TAG_OFFSET_TIME_ORIGINAL))) : undefined
  const gpsTime = gpsTimeMs(ascii(gps.get(GPS_DATE)), rationals(gps.get(GPS_TIME)))
  if (zoned !== undefined) out.timeMs = zoned
  else if (gpsTime !== undefined) out.timeMs = gpsTime
  else if (original && parseWallClock(original)) out.localTime = original
  return out
}

/** "2024:07:14 10:32:05" -> its fields, undefined when malformed (cameras write "0000:00:00 00:00:00" without a clock). */
function parseWallClock(text: string): [number, number, number, number, number, number] | undefined {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text)
  if (!m) return undefined
  const fields = m.slice(1).map(Number) as [number, number, number, number, number, number]
  return fields[0] > 1900 && fields[1] >= 1 && fields[1] <= 12 && fields[2] >= 1 ? fields : undefined
}

/** Wall-clock time with an EXIF offset ("+02:00") -> instant; undefined without a valid offset. */
function zonedTimeMs(wall: string, offset: string | undefined): number | undefined {
  const fields = parseWallClock(wall)
  const m = offset ? /^([+-])(\d{2}):(\d{2})$/.exec(offset) : null
  if (!fields || !m) return undefined
  const [y, mo, d, h, mi, s] = fields
  const minutes = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
  return Date.UTC(y, mo - 1, d, h, mi, s) - minutes * 60_000
}

/** GPS date ("2024:07:14") and UTC time (hours, minutes, seconds) -> instant. */
function gpsTimeMs(date: string | undefined, time: number[] | undefined): number | undefined {
  const m = date ? /^(\d{4}):(\d{2}):(\d{2})$/.exec(date) : null
  if (!m || !time || time.length < 3 || time.some(Number.isNaN)) return undefined
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + ((time[0] * 60 + time[1]) * 60 + time[2]) * 1000
}

/**
 * Capture instant of a photo: `timeMs`, else its wall-clock time read in the time zone of `toInstant` (the
 * browser's by default: the camera clock is usually set to where the outing took place). Undefined without time.
 */
export function photoTimeMs(
  exif: PhotoExif,
  toInstant: (y: number, month: number, d: number, h: number, mi: number, s: number) => number = (y, mo, d, h, mi, s) =>
    new Date(y, mo - 1, d, h, mi, s).getTime(),
): number | undefined {
  if (exif.timeMs !== undefined) return exif.timeMs
  const fields = exif.localTime ? parseWallClock(exif.localTime) : undefined
  return fields ? toInstant(...fields) : undefined
}

// ---------------------------------------------------------------------------
// Video clips (MP4 / QuickTime)
// ---------------------------------------------------------------------------

/** Seconds from 1904-01-01 (MP4 epoch) to 1970-01-01 (UTC). */
const MP4_EPOCH_S = 2_082_844_800
/** Recording instants before this are unset camera clocks (0, 1904, 1970…) and are ignored. */
const PLAUSIBLE_FROM_MS = Date.UTC(2000, 0, 1)
const PLAUSIBLE_TO_MS = Date.UTC(2100, 0, 1)
/** Boxes looked at before giving up (a file is a handful of top-level boxes). */
const MAX_BOXES = 2000

const plausible = (ms: number) => ms >= PLAUSIBLE_FROM_MS && ms < PLAUSIBLE_TO_MS

/** Reads `length` bytes at `offset` of the file (fewer at its end). */
export type ReadBytes = (offset: number, length: number) => Promise<Uint8Array>

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])

/** Child box `type` of the boxes in [start, end) of the file: its content offset and end, undefined when absent. */
async function findBox(read: ReadBytes, start: number, end: number, type: string): Promise<{ at: number; end: number } | undefined> {
  let offset = start
  for (let n = 0; n < MAX_BOXES && offset + 8 <= end; n++) {
    const head = await read(offset, 16)
    if (head.length < 8) return undefined
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
    let size = view.getUint32(0)
    let headerSize = 8
    if (size === 1) {
      if (head.length < 16) return undefined
      size = view.getUint32(8) * 2 ** 32 + view.getUint32(12)
      headerSize = 16
    } else if (size === 0) {
      size = end - offset
    }
    if (size < headerSize) return undefined
    if (fourcc(head, 4) === type) return { at: offset + headerSize, end: Math.min(end, offset + size) }
    offset += size
  }
  return undefined
}

/**
 * Recording instant of an MP4 / QuickTime file (ms since epoch): the creation time of its movie header (`moov` ›
 * `mvhd`, seconds since 1904 in UTC; read as seconds since 1970 when an encoder wrote that by mistake). Undefined
 * for another file or an unset camera clock. Only the box headers and the movie header are read (`read`), wherever
 * the `moov` box is (start or end of the file). Note: some cameras write their local time there instead of UTC.
 */
export async function mp4CreationTimeMs(read: ReadBytes, size: number): Promise<number | undefined> {
  try {
    const moov = await findBox(read, 0, size, 'moov')
    const mvhd = moov && (await findBox(read, moov.at, moov.end, 'mvhd'))
    if (!mvhd) return undefined
    const body = await read(mvhd.at, 12)
    if (body.length < 8) return undefined
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
    const seconds = body[0] === 1 ? (body.length < 12 ? Number.NaN : view.getUint32(4) * 2 ** 32 + view.getUint32(8)) : view.getUint32(4)
    if (!Number.isFinite(seconds) || seconds === 0) return undefined
    const ms = (seconds - MP4_EPOCH_S) * 1000
    if (plausible(ms)) return ms
    // before 1970 in the MP4 epoch: seconds since 1970 written by mistake
    return seconds < MP4_EPOCH_S && plausible(seconds * 1000) ? seconds * 1000 : undefined
  } catch {
    return undefined
  }
}

/**
 * Date of a QuickTime metadata entry (`com.apple.quicktime.creationdate`: "2024-06-12T10:15:30+0200", the start of
 * the recording in local time with its offset) -> instant; undefined without a time and a time zone.
 */
export function quickTimeDateMs(text: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):?(\d{2}))$/.exec(text.trim())
  if (!m) return undefined
  const minutes = m[7] === 'Z' ? 0 : (m[8] === '-' ? -1 : 1) * (Number(m[9]) * 60 + Number(m[10]))
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])) - minutes * 60_000
  return plausible(ms) ? ms : undefined
}

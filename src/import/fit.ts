/**
 * FIT activity parser. The decoder is written from the public FIT protocol description and reads only what a track
 * needs: file header, definition and data messages (both byte orders, compressed timestamp headers; developer fields
 * skipped), then the record, session, sport and activity messages. Scale and offset are applied (altitude…) and
 * timestamps stay in seconds since the FIT epoch; positions stay in semicircles: degrees are computed here.
 */
import type { Track, TrackPoint } from '../core/types'
import { buildTrack, isUtcOffsetMin, stripExtension } from './stats'

/** Origin of FIT timestamps, 1989-12-31T00:00:00Z. */
export const FIT_EPOCH_MS = Date.UTC(1989, 11, 31)

/** Decoded record message; `timestamp` in seconds since the FIT epoch (or a Date). */
export interface RecordMesg {
  timestamp?: Date | number
  positionLat?: number
  positionLong?: number
  altitude?: number
  enhancedAltitude?: number
  heartRate?: number
  cadence?: number
  power?: number
  temperature?: number
}

/** The decoded messages the importer reads, named as in the FIT profile. */
export interface FitMessages {
  recordMesgs?: RecordMesg[]
  sessionMesgs?: { sport?: number }[]
  sportMesgs?: { sport?: number }[]
  activityMesgs?: { timestamp?: Date | number; localTimestamp?: number }[]
}

type DecodedField = readonly [name: string, scale?: number, offset?: number]

/** Global message number -> where it goes and which fields are kept (field number -> name, scale, offset). */
const MESSAGES: Readonly<Record<number, { key: keyof FitMessages; fields: Readonly<Record<number, DecodedField>> }>> = {
  20: {
    key: 'recordMesgs',
    fields: {
      253: ['timestamp'],
      0: ['positionLat'],
      1: ['positionLong'],
      2: ['altitude', 5, 500],
      78: ['enhancedAltitude', 5, 500],
      3: ['heartRate'],
      4: ['cadence'],
      7: ['power'],
      13: ['temperature'],
    },
  },
  18: { key: 'sessionMesgs', fields: { 5: ['sport'] } },
  12: { key: 'sportMesgs', fields: { 0: ['sport'] } },
  34: { key: 'activityMesgs', fields: { 253: ['timestamp'], 5: ['localTimestamp'] } },
}

/** Names of the FIT `sport` values (index = value; 254 is "all"). */
const SPORTS = (
  'generic,running,cycling,transition,fitnessEquipment,swimming,basketball,soccer,tennis,americanFootball,training,' +
  'walking,crossCountrySkiing,alpineSkiing,snowboarding,rowing,mountaineering,hiking,multisport,paddling,flying,' +
  'eBiking,motorcycling,boating,driving,golf,hangGliding,horsebackRiding,hunting,fishing,inlineSkating,rockClimbing,' +
  'sailing,iceSkating,skyDiving,snowshoeing,snowmobiling,standUpPaddleboarding,surfing,wakeboarding,waterSkiing,' +
  'kayaking,rafting,windsurfing,kitesurfing,tactical,jumpmaster,boxing,floorClimbing,baseball,,,,diving,,,shooting,,' +
  'winterSport,grinding,,,hiit,videoGaming,racket,wheelchairPushWalk,wheelchairPushRun,meditation,paraSport,discGolf,' +
  'teamSport,cricket,rugby,hockey,lacrosse,volleyball,waterTubing,wakesurfing,waterSport,archery,mixedMartialArts,' +
  'motorSports,snorkeling,dance,jumpRope,poolApnea,mobility,geocaching,canoeing'
).split(',')

/** Size in bytes of each base type (index = base type number). */
const BASE_TYPE_SIZES = [1, 1, 1, 2, 2, 4, 4, 1, 4, 8, 1, 2, 4, 1, 8, 8, 8]

/** Integer value of a single (non-array) field; undefined for the invalid value and the non-integer base types. */
function readInteger(view: DataView, at: number, baseType: number, little: boolean): number | undefined {
  switch (baseType) {
    case 0: // enum
    case 2: // uint8
      return orUndefined(view.getUint8(at), 0xff)
    case 1:
      return orUndefined(view.getInt8(at), 0x7f)
    case 3:
      return orUndefined(view.getInt16(at, little), 0x7fff)
    case 4:
      return orUndefined(view.getUint16(at, little), 0xffff)
    case 5:
      return orUndefined(view.getInt32(at, little), 0x7fffffff)
    case 6:
      return orUndefined(view.getUint32(at, little), 0xffffffff)
    case 10: // uint8z, uint16z, uint32z: 0 is invalid
      return orUndefined(view.getUint8(at), 0)
    case 11:
      return orUndefined(view.getUint16(at, little), 0)
    case 12:
      return orUndefined(view.getUint32(at, little), 0)
    default:
      return undefined
  }
}

function orUndefined(value: number, invalidValue: number): number | undefined {
  return value === invalidValue ? undefined : value
}

/** File header: 12 or 14 bytes, ".FIT" at offset 8, and room for the trailing CRC. */
function isFitHeader(view: DataView, at: number): boolean {
  const size = view.getUint8(at)
  if ((size !== 12 && size !== 14) || view.byteLength < at + size + 2) return false
  return view.getUint32(at + 8, true) === 0x5449462e // ".FIT"
}

interface Definition {
  global: number
  little: boolean
  /** [field number, size, base type] */
  fields: (readonly [number, number, number])[]
  /** Size of the data message, developer fields included. */
  size: number
}

/**
 * Decode the record, session, sport and activity messages of a FIT file (chained files included). Decoding stops at
 * the first truncated or malformed message; what came before is kept and `error` tells why. The CRC is not checked:
 * a damaged file still shows what it holds.
 */
function decodeFit(buffer: ArrayBuffer): { messages: FitMessages; error?: string } {
  const view = new DataView(buffer)
  const messages: FitMessages = {}
  let pos = 0
  try {
    while (pos < view.byteLength) {
      if (!isFitHeader(view, pos)) throw new Error('en-tête « .FIT » absent')
      const end = pos + view.getUint8(pos) + view.getUint32(pos + 4, true)
      pos += view.getUint8(pos)
      const definitions: Definition[] = []
      let lastTimestamp = 0
      while (pos < end) {
        const header = view.getUint8(pos++)
        if ((header & 0xc0) === 0x40) {
          const little = view.getUint8(pos + 1) === 0
          const definition: Definition = { global: view.getUint16(pos + 2, little), little, fields: [], size: 0 }
          const count = view.getUint8(pos + 4)
          pos += 5
          for (let i = 0; i < count; i++, pos += 3) {
            definition.fields.push([view.getUint8(pos), view.getUint8(pos + 1), view.getUint8(pos + 2) & 0x1f])
            definition.size += view.getUint8(pos + 1)
          }
          if (header & 0x20) {
            const devCount = view.getUint8(pos++)
            for (let i = 0; i < devCount; i++, pos += 3) definition.size += view.getUint8(pos + 1)
          }
          definitions[header & 0x0f] = definition
          continue
        }
        const compressed = (header & 0x80) !== 0
        const definition = definitions[compressed ? (header >> 5) & 0x03 : header & 0x0f]
        if (!definition) throw new Error('message sans définition')
        if (pos + definition.size > view.byteLength) throw new RangeError()
        const decoded = MESSAGES[definition.global]
        const mesg: Record<string, number> = {}
        let at = pos
        for (const [num, size, baseType] of definition.fields) {
          // arrays (size > base type size) are not read: none of the kept fields is one
          const value =
            size === BASE_TYPE_SIZES[baseType] ? readInteger(view, at, baseType, definition.little) : undefined
          at += size
          if (value === undefined) continue
          if (num === 253) lastTimestamp = value
          const field = decoded?.fields[num]
          if (field) mesg[field[0]] = value / (field[1] ?? 1) - (field[2] ?? 0)
        }
        if (compressed) {
          // 5-bit offset from the last full timestamp, rolling over every 32 s
          lastTimestamp += ((header & 0x1f) - (lastTimestamp & 0x1f)) & 0x1f
          if (decoded?.fields[253]) mesg.timestamp = lastTimestamp
        }
        pos += definition.size
        if (decoded) ((messages[decoded.key] ??= []) as Record<string, number>[]).push(mesg)
      }
      pos = end + 2 // file CRC
    }
    return { messages }
  } catch (error) {
    return { messages, error: error instanceof RangeError ? 'fichier tronqué' : (error as Error).message }
  }
}

/** 1 semicircle = 180 / 2^31 degrees. */
export const SEMICIRCLES_TO_DEGREES = 180 / 2 ** 31

export function semicirclesToDegrees(semicircles: number): number {
  return semicircles * SEMICIRCLES_TO_DEGREES
}

function invalid(reason: string): Error {
  return new Error(`Fichier FIT invalide : ${reason}`)
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** FIT timestamps are seconds since the FIT epoch (or Date objects). */
function toEpochMs(value: unknown): number | undefined {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : undefined
  }
  const seconds = finite(value)
  return seconds === undefined ? undefined : seconds * 1000 + FIT_EPOCH_MS
}

/** Convert one record message to a TrackPoint; undefined when it carries no valid position. */
export function recordToPoint(record: RecordMesg): TrackPoint | undefined {
  const latSemi = finite(record.positionLat)
  const lonSemi = finite(record.positionLong)
  if (latSemi === undefined || lonSemi === undefined) return undefined
  const lat = semicirclesToDegrees(latSemi)
  const lon = semicirclesToDegrees(lonSemi)
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined

  const point: TrackPoint = { lon, lat }
  const ele = finite(record.enhancedAltitude) ?? finite(record.altitude)
  if (ele !== undefined) point.ele = ele
  const time = toEpochMs(record.timestamp)
  if (time !== undefined) point.time = time
  const hr = finite(record.heartRate)
  if (hr !== undefined) point.hr = hr
  const cad = finite(record.cadence)
  if (cad !== undefined) point.cad = cad
  const power = finite(record.power)
  if (power !== undefined) point.power = power
  const temp = finite(record.temperature)
  if (temp !== undefined) point.temp = temp
  return point
}

/** Sport of the activity ("hiking", "cycling"…) from the session, else the sport message. */
function readSport(messages: FitMessages): string | undefined {
  const sport = messages.sessionMesgs?.[0]?.sport ?? messages.sportMesgs?.[0]?.sport
  if (sport === undefined) return undefined
  return SPORTS[sport] || (sport === 254 ? 'all' : String(sport))
}

/**
 * Offset of the device's local clock from UTC (minutes, to the quarter hour), from the activity message's local
 * timestamp (seconds since the FIT epoch, local time) and timestamp (UTC).
 */
export function readUtcOffset(messages: FitMessages): number | undefined {
  const activity = messages.activityMesgs?.[0]
  const utc = toEpochMs(activity?.timestamp)
  const local = finite(activity?.localTimestamp)
  if (utc === undefined || local === undefined) return undefined
  const offset = Math.round((local * 1000 + FIT_EPOCH_MS - utc) / 900_000) * 15
  return isUtcOffsetMin(offset) ? offset : undefined
}

/**
 * Decode a FIT activity into a single-segment track (laps are not split).
 * Records without a position (indoor, before the GPS fix…) are dropped.
 * Throws `Error('Fichier FIT invalide : …')` when the header is not FIT or no positioned record exists.
 */
export async function parseFit(buffer: ArrayBuffer, fileName: string): Promise<Track[]> {
  if (buffer.byteLength < 14) throw invalid('fichier trop court')
  if (!isFitHeader(new DataView(buffer), 0)) throw invalid('en-tête « .FIT » absent')
  const { messages, error } = decodeFit(buffer)

  const points: TrackPoint[] = []
  for (const record of messages.recordMesgs ?? []) {
    const point = recordToPoint(record)
    if (point) points.push(point)
  }
  if (points.length === 0) {
    throw invalid(error ? `aucun point et erreur de décodage (${error})` : 'aucun enregistrement avec position')
  }

  const track = buildTrack({
    name: stripExtension(fileName) || 'Activité FIT',
    source: 'fit',
    segments: [{ points }],
    activityType: readSport(messages),
  })
  const utcOffsetMin = readUtcOffset(messages)
  if (utcOffsetMin !== undefined) track.utcOffsetMin = utcOffsetMin
  return [track]
}

/**
 * FIT activity parser built on the official @garmin/fitsdk decoder.
 * With the default read options the SDK applies scale/offset (altitude, speed…) and converts
 * timestamps to Date objects, but leaves positions in semicircles: degrees are computed here.
 */
import { Decoder, Stream, Utils } from '@garmin/fitsdk'
import type { FitMessages, RecordMesg } from '@garmin/fitsdk'
import type { Track, TrackPoint } from '../core/types'
import { buildTrack, isUtcOffsetMin, stripExtension } from './stats'

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

/** FIT timestamps are Date objects (default decoder options) or seconds since the FIT epoch. */
function toEpochMs(value: unknown): number | undefined {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? ms : undefined
  }
  const seconds = finite(value)
  return seconds === undefined ? undefined : seconds * 1000 + Utils.FIT_EPOCH_MS
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
  const sport: unknown = messages.sessionMesgs?.[0]?.sport ?? messages.sportMesgs?.[0]?.sport
  if (typeof sport === 'string' && sport !== '') return sport
  if (typeof sport === 'number') return String(sport)
  return undefined
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
  const offset = Math.round((local * 1000 + Utils.FIT_EPOCH_MS - utc) / 900_000) * 15
  return isUtcOffsetMin(offset) ? offset : undefined
}

/**
 * Decode a FIT activity into a single-segment track (laps are not split).
 * Records without a position (indoor, before the GPS fix…) are dropped.
 * Throws `Error('Fichier FIT invalide : …')` when the header is not FIT or no positioned record exists.
 */
export async function parseFit(buffer: ArrayBuffer, fileName: string): Promise<Track[]> {
  if (buffer.byteLength < 14) throw invalid('fichier trop court')
  const stream = Stream.fromArrayBuffer(buffer)
  let isFit = false
  try {
    isFit = Decoder.isFIT(stream)
  } catch {
    isFit = false
  }
  if (!isFit) throw invalid('en-tête « .FIT » absent')

  const decoder = new Decoder(stream)
  const { messages, errors } = decoder.read({ includeUnknownData: false, decodeMemoGlobs: false })

  const points: TrackPoint[] = []
  for (const record of messages.recordMesgs ?? []) {
    const point = recordToPoint(record)
    if (point) points.push(point)
  }
  if (points.length === 0) {
    const detail = errors[0]?.message
    throw invalid(detail ? `aucun point et erreur de décodage (${detail})` : 'aucun enregistrement avec position')
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

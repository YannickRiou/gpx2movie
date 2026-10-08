/**
 * Test helper: builds small FIT activities with the official SDK encoder so the decoder can be
 * exercised end to end under vitest (no binary fixture to maintain).
 */
import { Encoder, Profile, Utils } from '@garmin/fitsdk'
import type { Mesg } from '@garmin/fitsdk'

const DEG_TO_SEMI = 2 ** 31 / 180

/** Degrees -> FIT semicircles (rounded, as a device would store them). */
export function toSemicircles(deg: number): number {
  return Math.round(deg * DEG_TO_SEMI)
}

/** The encoder takes decoded-shaped messages (strings for enums, Dates), which the `Mesg` type does not express. */
export function writeMesg(encoder: Encoder, mesgNum: number, fields: Record<string, unknown>): void {
  encoder.onMesg(mesgNum, fields as Mesg)
}

/** Copy the encoder output into a standalone ArrayBuffer (what File.arrayBuffer() hands to parseFit). */
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
  const encoder = new Encoder()
  const start = FIT_ACTIVITY_START
  writeMesg(encoder, Profile.MesgNum.FILE_ID, {
    type: 'activity',
    manufacturer: 'development',
    product: 1,
    timeCreated: new Date(start),
  })
  const records = [
    { lat: 45.8911, lon: 6.7986, alt: 1010, hr: 95, cad: 60, temp: 18, power: 0, t: 0 },
    { t: 60 },
    { lat: 45.8905, lon: 6.797, alt: 1032.4, hr: 110, cad: 62, temp: 18, power: 180, t: 120 },
    { lat: 45.8898, lon: 6.7955, alt: 1061, hr: 128, cad: 65, temp: 19, power: 210, t: 180 },
  ]
  for (const r of records) {
    const mesg: Record<string, unknown> = { timestamp: new Date(start + r.t * 1000) }
    if (r.lat !== undefined && r.lon !== undefined) {
      mesg.positionLat = toSemicircles(r.lat)
      mesg.positionLong = toSemicircles(r.lon)
      mesg.enhancedAltitude = r.alt
      mesg.altitude = r.alt
      mesg.heartRate = r.hr
      mesg.cadence = r.cad
      mesg.temperature = r.temp
      mesg.power = r.power
    }
    writeMesg(encoder, Profile.MesgNum.RECORD, mesg)
  }
  writeMesg(encoder, Profile.MesgNum.SESSION, {
    timestamp: new Date(start + 180_000),
    startTime: new Date(start),
    sport: 'hiking',
    subSport: 'generic',
    totalElapsedTime: 180,
    totalTimerTime: 180,
  })
  writeMesg(encoder, Profile.MesgNum.ACTIVITY, {
    timestamp: new Date(start + 180_000),
    localTimestamp: (start + 180_000 + 2 * 3_600_000 - Utils.FIT_EPOCH_MS) / 1000,
    numSessions: 1,
  })
  return toArrayBuffer(encoder.close())
}

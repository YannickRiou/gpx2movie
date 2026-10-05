import { Encoder, Profile } from '@garmin/fitsdk'
import { describe, expect, it } from 'vitest'
import { buildFitActivity, toArrayBuffer, toSemicircles, writeMesg } from './__fixtures__/fit-activity'
import { parseFit, recordToPoint, semicirclesToDegrees } from './fit'

describe('semicirclesToDegrees', () => {
  it('maps the semicircle range onto degrees', () => {
    expect(semicirclesToDegrees(0)).toBe(0)
    expect(semicirclesToDegrees(2 ** 31)).toBe(180)
    expect(semicirclesToDegrees(-(2 ** 30))).toBe(-90)
    expect(semicirclesToDegrees(toSemicircles(45.8911))).toBeCloseTo(45.8911, 7)
  })
})

describe('recordToPoint', () => {
  it('drops records without a position and converts the others', () => {
    expect(recordToPoint({ timestamp: new Date(0), heartRate: 100 })).toBeUndefined()
    expect(recordToPoint({ positionLat: null as unknown as number, positionLong: 1 })).toBeUndefined()
    const point = recordToPoint({
      positionLat: toSemicircles(45.5),
      positionLong: toSemicircles(6.5),
      altitude: 1200,
      timestamp: 0, // FIT epoch in seconds
      heartRate: 140,
    })
    expect(point).toBeDefined()
    expect(point?.lat).toBeCloseTo(45.5, 7)
    expect(point?.lon).toBeCloseTo(6.5, 7)
    expect(point?.ele).toBe(1200)
    expect(point?.time).toBe(Date.parse('1989-12-31T00:00:00Z'))
    expect(point?.hr).toBe(140)
    expect(point?.cad).toBeUndefined()
  })

  it('prefers enhancedAltitude over altitude', () => {
    const point = recordToPoint({ positionLat: 1, positionLong: 1, altitude: 10, enhancedAltitude: 12.5 })
    expect(point?.ele).toBe(12.5)
  })
})

describe('parseFit', () => {
  it('decodes an activity encoded with the SDK', async () => {
    const tracks = await parseFit(buildFitActivity(), 'Rando matin.FIT')
    expect(tracks).toHaveLength(1)
    const track = tracks[0]
    expect(track.name).toBe('Rando matin')
    expect(track.source).toBe('fit')
    expect(track.activityType).toBe('hiking')
    expect(track.color).toBe('')
    expect(track.segments).toHaveLength(1)
    expect(track.stats.pointCount).toBe(3)

    const [p0, p1, p2] = track.segments[0].points
    expect(p0.lat).toBeCloseTo(45.8911, 6)
    expect(p0.lon).toBeCloseTo(6.7986, 6)
    expect(p0.ele).toBeCloseTo(1010, 1)
    expect(p0.time).toBe(Date.parse('2025-07-12T07:00:00Z'))
    expect(p0).toMatchObject({ hr: 95, cad: 60, temp: 18, power: 0 })
    expect(p1.ele).toBeCloseTo(1032.4, 1)
    expect(p1.time).toBe(Date.parse('2025-07-12T07:02:00Z'))
    expect(p2).toMatchObject({ hr: 128, cad: 65, temp: 19, power: 210 })

    expect(track.stats.distanceM).toBeGreaterThan(200)
    expect(track.stats.distanceM).toBeLessThan(400)
    expect(track.stats.ascentM).toBeCloseTo(51, 0)
    expect(track.stats.durationS).toBe(180)
    expect(track.bounds.north).toBeCloseTo(45.8911, 6)
  })

  it('keeps the records decoded before a truncation (partial download, interrupted recording)', async () => {
    const whole = buildFitActivity()
    // cut inside the trailing session message: file_id + the 4 records are intact, session and CRC are gone
    const truncated = whole.slice(0, whole.byteLength - 12)
    const tracks = await parseFit(truncated, 'coupe.fit')
    expect(tracks).toHaveLength(1)
    expect(tracks[0].stats.pointCount).toBeGreaterThanOrEqual(1)
    expect(tracks[0].stats.pointCount).toBeLessThanOrEqual(3)
  })

  it('rejects buffers that are not FIT files', async () => {
    await expect(parseFit(new ArrayBuffer(4), 'x.fit')).rejects.toThrow(/^Fichier FIT invalide : /)
    const garbage = new Uint8Array(64).map((_, i) => (i * 37) & 0xff)
    await expect(parseFit(garbage.buffer, 'x.fit')).rejects.toThrow(/^Fichier FIT invalide : /)
    // GPX text dropped with a .fit extension
    const text = new TextEncoder().encode('<?xml version="1.0"?><gpx></gpx>')
    await expect(parseFit(toArrayBuffer(text), 'x.fit')).rejects.toThrow(/^Fichier FIT invalide : /)
  })

  it('rejects a FIT file without any positioned record', async () => {
    const encoder = new Encoder()
    writeMesg(encoder, Profile.MesgNum.FILE_ID, { type: 'activity', manufacturer: 'development', product: 1 })
    writeMesg(encoder, Profile.MesgNum.RECORD, { timestamp: new Date(), heartRate: 90 })
    await expect(parseFit(toArrayBuffer(encoder.close()), 'indoor.fit')).rejects.toThrow(
      /aucun enregistrement avec position/,
    )
  })
})

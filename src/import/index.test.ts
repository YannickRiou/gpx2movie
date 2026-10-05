import { describe, expect, it } from 'vitest'
import gpxText from './__fixtures__/two-segments.gpx?raw'
import { buildFitActivity } from './__fixtures__/fit-activity'
import { TRACK_COLORS, assignColors, importFile, importText, supportedExtension } from './index'

describe('TRACK_COLORS / assignColors', () => {
  it('cycles through the palette from colorIndex', () => {
    expect(TRACK_COLORS).toHaveLength(6)
    const tracks = importText(gpxText, 'a.gpx')
    expect(tracks[0].color).toBe(TRACK_COLORS[0])
    expect(importText(gpxText, 'a.gpx', 5)[0].color).toBe(TRACK_COLORS[5])
    expect(importText(gpxText, 'a.gpx', 6)[0].color).toBe(TRACK_COLORS[0])
    expect(importText(gpxText, 'a.gpx', -1)[0].color).toBe(TRACK_COLORS[5])

    const many = importText(
      `<gpx><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk><trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>`,
      'm.gpx',
      5,
    )
    expect(many.map((t) => t.color)).toEqual([TRACK_COLORS[5], TRACK_COLORS[0]])
    expect(assignColors([], 2)).toEqual([])
  })
})

describe('supportedExtension', () => {
  it('is case-insensitive and rejects other formats', () => {
    expect(supportedExtension('a.gpx')).toBe('gpx')
    expect(supportedExtension('A.GPX')).toBe('gpx')
    expect(supportedExtension('rando.Fit')).toBe('fit')
    expect(supportedExtension('a.gpx.zip')).toBeUndefined()
    expect(supportedExtension('a.kml')).toBeUndefined()
    expect(supportedExtension('gpx')).toBeUndefined()
  })
})

describe('importFile', () => {
  it('imports a GPX File (upper-case extension)', async () => {
    const file = new File([gpxText], 'Montée.GPX', { type: 'application/gpx+xml' })
    const tracks = await importFile(file, 1)
    expect(tracks).toHaveLength(1)
    expect(tracks[0].name).toBe('Montée test')
    expect(tracks[0].color).toBe(TRACK_COLORS[1])
  })

  it('imports a FIT File', async () => {
    const file = new File([buildFitActivity()], 'rando.fit')
    const tracks = await importFile(file)
    expect(tracks).toHaveLength(1)
    expect(tracks[0].source).toBe('fit')
    expect(tracks[0].name).toBe('rando')
    expect(tracks[0].color).toBe(TRACK_COLORS[0])
  })

  it('rejects unsupported formats with a French message', async () => {
    await expect(importFile(new File(['x'], 'trace.kml'))).rejects.toThrow('Format non supporté : .kml')
    await expect(importFile(new File(['x'], 'sansextension'))).rejects.toThrow(/Format non supporté/)
  })

  it('propagates parser errors', async () => {
    await expect(importFile(new File(['<gpx></gpx>'], 'vide.gpx'))).rejects.toThrow(/Fichier GPX invalide/)
  })
})

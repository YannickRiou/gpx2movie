import { describe, expect, it } from 'vitest'
import routeOnlyGpx from './__fixtures__/route-only.gpx?raw'
import twoSegmentsGpx from './__fixtures__/two-segments.gpx?raw'
import { parseGpx } from './gpx'

/** 0.001° of latitude on the haversine sphere (R = 6371008.8 m). */
const M_PER_MILLIDEG_LAT = (6371008.8 * Math.PI) / 180 / 1000

describe('parseGpx', () => {
  it('parses a 2-segment track with extensions, times and stats', () => {
    const tracks = parseGpx(twoSegmentsGpx, 'two-segments.gpx')
    expect(tracks).toHaveLength(1)
    const track = tracks[0]

    expect(track.name).toBe('Montée test')
    expect(track.source).toBe('gpx')
    expect(track.activityType).toBe('hiking')
    expect(track.color).toBe('')
    expect(track.id).toMatch(/^[0-9a-f-]{36}$/)

    // the third (empty) trkseg is dropped, the invalid lat="abc" point is skipped
    expect(track.segments).toHaveLength(2)
    expect(track.segments[0].points).toHaveLength(6)
    expect(track.segments[1].points).toHaveLength(5)
    expect(track.stats.pointCount).toBe(11)

    const first = track.segments[0].points[0]
    expect(first).toMatchObject({ lon: 6.8, lat: 45.9, ele: 1000, hr: 120, cad: 80, temp: 21.5, power: 250 })
    expect(first.time).toBe(Date.parse('2025-07-12T07:00:00Z'))
    expect(track.segments[0].points[1].hr).toBe(125)
    expect(track.segments[0].points[2].hr).toBeUndefined()

    // 5 + 4 steps of 0.001° latitude; no distance between segments
    const expectedDistance = 9 * M_PER_MILLIDEG_LAT
    expect(Math.abs(track.stats.distanceM - expectedDistance) / expectedDistance).toBeLessThan(0.01)

    expect(track.stats.ascentM).toBeCloseTo(50, 0)
    expect(track.stats.descentM).toBeCloseTo(40, 0)
    expect(track.stats.minEle).toBe(1000)
    expect(track.stats.maxEle).toBe(1050)
    expect(track.stats.startTime).toBe(Date.parse('2025-07-12T07:00:00Z'))
    expect(track.stats.endTime).toBe(Date.parse('2025-07-12T07:07:00Z'))
    expect(track.stats.durationS).toBe(420)

    expect(track.bounds).toEqual({ west: 6.8, east: 6.81, south: 45.9, north: 45.905 })
  })

  it('turns a route-only file into a single-segment track named after the metadata', () => {
    const tracks = parseGpx(routeOnlyGpx, 'route-only.gpx')
    expect(tracks).toHaveLength(1)
    expect(tracks[0].name).toBe('Itinéraire planifié')
    expect(tracks[0].source).toBe('gpx')
    expect(tracks[0].segments).toHaveLength(1)
    expect(tracks[0].segments[0].points).toHaveLength(3)
    // the window-5 smoothing flattens a 3-point route, but the net gain (1167 - 1010) is preserved
    const { ascentM, descentM } = tracks[0].stats
    expect(ascentM).toBeGreaterThan(0)
    expect(descentM).toBeGreaterThan(0)
    expect(ascentM - descentM).toBeCloseTo(157, 6)
    expect(tracks[0].stats.minEle).toBe(1010)
    expect(tracks[0].stats.maxEle).toBe(1653)
    expect(tracks[0].stats.durationS).toBeUndefined()
    expect(tracks[0].stats.distanceM).toBeGreaterThan(8_000)
  })

  it('falls back to the file name when neither the track nor the metadata has a name', () => {
    const text = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
      <trkpt lat="45" lon="6"/><trkpt lat="45.001" lon="6"/></trkseg></trk></gpx>`
    expect(parseGpx(text, 'C:\\sorties\\Ma Sortie.GPX')[0].name).toBe('Ma Sortie')
  })

  it('numbers unnamed tracks when a file holds several', () => {
    const text = `<gpx><metadata><name>Multi</name></metadata>
      <trk><trkseg><trkpt lat="45" lon="6"/></trkseg></trk>
      <trk><name>Nommée</name><trkseg><trkpt lat="45" lon="6"/></trkseg></trk>
      <trk><trkseg><trkpt lat="45" lon="6"/></trkseg></trk></gpx>`
    expect(parseGpx(text, 'multi.gpx').map((t) => t.name)).toEqual(['Multi (1)', 'Nommée', 'Multi (3)'])
  })

  it('reads extensions regardless of their namespace prefix', () => {
    const text = `<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:ns3="http://www.garmin.com/xmlschemas/TrackPointExtension/v2">
      <trk><trkseg><trkpt lat="45" lon="6"><extensions><ns3:TrackPointExtension><ns3:hr>99</ns3:hr><ns3:cad>71</ns3:cad></ns3:TrackPointExtension></extensions></trkpt></trkseg></trk></gpx>`
    const point = parseGpx(text, 'x.gpx')[0].segments[0].points[0]
    expect(point.hr).toBe(99)
    expect(point.cad).toBe(71)
  })

  it('ignores points with out-of-range coordinates and unparsable times', () => {
    const text = `<gpx><trk><trkseg>
      <trkpt lat="95" lon="6"/><trkpt lat="45" lon="200"/><trkpt lat="45" lon="6"><time>hier</time><ele>x</ele></trkpt>
      </trkseg></trk></gpx>`
    const track = parseGpx(text, 'x.gpx')[0]
    expect(track.stats.pointCount).toBe(1)
    expect(track.segments[0].points[0]).toEqual({ lon: 6, lat: 45 })
  })

  it('leaves empty <ele> and empty extension elements undefined instead of reading 0', () => {
    const text = `<gpx><trk><trkseg>
      <trkpt lat="45" lon="6"><ele></ele><extensions><hr/><cad> </cad><power>abc</power></extensions></trkpt>
      <trkpt lat="45.001" lon="6"><ele>1200</ele></trkpt>
      </trkseg></trk></gpx>`
    const track = parseGpx(text, 'x.gpx')[0]
    expect(track.segments[0].points[0]).toEqual({ lon: 6, lat: 45 })
    expect(track.stats.minEle).toBe(1200)
    expect(track.stats.maxEle).toBe(1200)
  })

  it('throws a clear error on malformed XML', () => {
    expect(() => parseGpx('<gpx><trk><trkseg><trkpt lat="45" lon="6">', 'bad.gpx')).toThrow(/^Fichier GPX invalide : /)
    expect(() => parseGpx('', 'empty.gpx')).toThrow(/^Fichier GPX invalide : /)
    expect(() => parseGpx('pas du xml du tout', 'text.gpx')).toThrow(/^Fichier GPX invalide : /)
  })

  it('throws when the document has no point', () => {
    expect(() => parseGpx('<gpx xmlns="http://www.topografix.com/GPX/1/1"></gpx>', 'empty.gpx')).toThrow(
      'Fichier GPX invalide : aucun point trouvé',
    )
    expect(() => parseGpx('<gpx><trk><trkseg/></trk></gpx>', 'empty.gpx')).toThrow(/aucun point/)
    expect(() => parseGpx('<kml><Placemark/></kml>', 'x.gpx')).toThrow(/Fichier GPX invalide/)
  })
})

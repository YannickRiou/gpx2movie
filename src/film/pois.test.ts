import { describe, expect, it } from 'vitest'
import { buildTrackPath } from '../flyover/path'
import { buildTrack } from '../import/stats'
import { sanitizeSettings } from '../project/document'
import { DEFAULT_FILM, isValidFilm, withFilmDefaults } from './model'
import type { Film } from './model'
import { POI_NAME_MAX, addPoi, defaultPoiName, poiStopAtM, removePoi, renamePoi } from './pois'

const chalet = { lon: 6.8652345678, lat: 45.9234567891 }

describe('points of interest', () => {
  it('added with the next free id, coordinates at 1e-6°, the name trimmed', () => {
    const film = addPoi(DEFAULT_FILM, chalet, '  Le chalet de Paul ')
    expect(film.pois).toEqual([{ id: 'poi-1', lon: 6.865235, lat: 45.923457, name: 'Le chalet de Paul' }])
    expect(addPoi(film, chalet, 'Pique-nique').pois.map((p) => p.id)).toEqual(['poi-1', 'poi-2'])
    expect(DEFAULT_FILM.pois).toEqual([])
    expect(isValidFilm(film)).toBe(true)
  })

  it('without a name: « Point d’intérêt n »; a long name is cut', () => {
    expect(defaultPoiName(DEFAULT_FILM)).toBe("Point d'intérêt 1")
    expect(addPoi(DEFAULT_FILM, chalet, '   ').pois[0].name).toBe("Point d'intérêt 1")
    expect(addPoi(DEFAULT_FILM, chalet, 'x'.repeat(100)).pois[0].name).toHaveLength(POI_NAME_MAX)
  })

  it('renamed as typed (blank allowed while typing), removed by id; the others unchanged', () => {
    const film = addPoi(addPoi(DEFAULT_FILM, chalet, 'Pique-nique'), chalet, 'Ici j’ai crevé')
    const renamed = renamePoi(film, 'poi-1', 'Pique-nique au lac ')
    expect(renamed.pois.map((p) => p.name)).toEqual(['Pique-nique au lac ', 'Ici j’ai crevé'])
    expect(renamePoi(film, 'poi-2', '').pois[1].name).toBe('')
    expect(removePoi(film, 'poi-1').pois.map((p) => p.id)).toEqual(['poi-2'])
    expect(removePoi(film, 'poi-9')).toEqual(film)
  })

  it('a stop goes to the nearest recorded point of the track, at the metre', () => {
    const track = buildTrack({
      name: 'est',
      source: 'gpx',
      segments: [{ points: [6.8, 6.81, 6.82].map((lon) => ({ lon, lat: 45.9 })) }],
    })
    const path = buildTrackPath(track)
    expect(poiStopAtM(path, { lon: 6.8102, lat: 45.9005 })).toBe(Math.round(path.lengthM / 2))
    expect(poiStopAtM(path, { lon: 7, lat: 45.9 })).toBe(Math.round(path.lengthM))
  })

  it('validated on load: bad coordinates or a shared id reject the film; old films get none', () => {
    const film: Film = addPoi(DEFAULT_FILM, chalet, 'Chalet')
    expect(isValidFilm({ ...film, pois: [{ ...film.pois[0], lat: 91 }] })).toBe(false)
    expect(isValidFilm({ ...film, pois: [{ ...film.pois[0], id: '' }] })).toBe(false)
    const clash = { ...film, stops: [{ id: 'poi-1', atM: 10, durationS: 4, camera: 'orbite' as const }] }
    expect(isValidFilm(clash)).toBe(false)

    const { pois: _none, ...saved } = DEFAULT_FILM
    expect((withFilmDefaults(saved) as Film).pois).toEqual([])
    expect(sanitizeSettings({ film: film }).settings.film.pois).toEqual(film.pois)
    expect(sanitizeSettings({ film: { ...film, pois: [{ id: 'poi-1', lon: 'x', lat: 0, name: 'a' }] } }).invalid).toEqual(['film'])
  })
})

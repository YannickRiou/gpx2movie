import { describe, expect, it } from 'vitest'
import { isValidSetting, parseProject, sanitizeSettings } from '../project/document'
import { DEFAULT_SETTINGS } from '../state/store'
import { DEFAULT_FILM, isValidFilm, nextFilmId, shotDurationS } from './model'
import type { Film, FilmStop, FilmText } from './model'

const stop = (id: string, patch: Partial<FilmStop> = {}): FilmStop => ({ id, atM: 1000, durationS: 3, camera: 'orbite', ...patch })
const text = (id: string, patch: Partial<FilmText> = {}): FilmText => ({
  id,
  startS: 2,
  durationS: 4,
  text: 'Col de Voza',
  anchor: 'bottom-left',
  size: 1,
  ...patch,
})
const film = (patch: Partial<Film>): Film => ({ ...DEFAULT_FILM, ...patch })

describe('film model', () => {
  it('defaults: overview opening and closing, generated stops, empty lanes, valid project setting', () => {
    expect(DEFAULT_SETTINGS.film).toBe(DEFAULT_FILM)
    expect(DEFAULT_FILM.opening.style).toBe('descente')
    expect(DEFAULT_FILM.autoStops).toBe(true)
    expect(isValidFilm(DEFAULT_FILM)).toBe(true)
    expect(isValidSetting('film', DEFAULT_FILM)).toBe(true)
  })

  it('shot duration: none for « aucune »', () => {
    expect(shotDurationS({ style: 'saut', durationS: 4 })).toBe(4)
    expect(shotDurationS({ style: 'aucune', durationS: 4 })).toBe(0)
  })

  it('accepts complete lanes', () => {
    const full = film({
      autoStops: false,
      stops: [stop('stop-1', { label: 'Sommet', source: { kind: 'landmark', ref: 'node/1' } }), stop('auto-4520', { camera: 'fixe' })],
      texts: [text('text-1', { subtitle: '1 653 m' })],
      media: [{ id: 'media-1', startS: 10, durationS: 5, kind: 'image', src: 'data:image/png;base64,AA' }],
    })
    expect(isValidFilm(full)).toBe(true)
    expect(isValidSetting('film', full)).toBe(true)
  })

  it('rejects bad shots, items and duplicate ids', () => {
    const bad: Film[] = [
      film({ opening: { style: 'balayage' as 'saut', durationS: 5 } }),
      film({ closing: { style: 'saut', durationS: 0 } }),
      film({ stops: [stop('stop-1', { camera: 'drone' as 'fixe' })] }),
      film({ stops: [stop('stop-1', { atM: -1 })] }),
      film({ stops: [stop('stop-1', { durationS: 120 })] }),
      film({ stops: [stop('')] }),
      film({ stops: [stop('stop-1', { source: { kind: 'photo' as 'manual' } })] }),
      film({ texts: [text('text-1', { anchor: 'nowhere' as 'center' })] }),
      film({ texts: [text('text-1', { size: 5 })] }),
      film({ texts: [text('text-1', { durationS: 0 })] }),
      film({ media: [{ id: 'media-1', startS: 0, durationS: 5, kind: 'sound' as 'image', src: '' }] }),
      film({ stops: [stop('a')], texts: [text('a')] }),
    ]
    for (const f of bad) expect(isValidFilm(f)).toBe(false)
    expect(isValidSetting('film', { ...DEFAULT_FILM, stops: 'none' })).toBe(false)
  })

  it('older projects and presets without a film get the default (generated stops from their pacing)', () => {
    expect(sanitizeSettings({ flyoverDurationS: 90 }).settings.film).toEqual(DEFAULT_FILM)
    const { settings, invalid } = sanitizeSettings({ film: { ...DEFAULT_FILM, stops: [stop('x', { durationS: -1 })] } })
    expect(invalid).toEqual(['film'])
    expect(settings.film).toEqual(DEFAULT_FILM)
  })

  it('round-trips through the project document', () => {
    const custom = film({ autoStops: false, stops: [stop('stop-2')], texts: [text('text-1')] })
    const doc = {
      format: 'openflyover-project',
      version: 1,
      name: 'n',
      settings: { ...DEFAULT_SETTINGS, film: custom },
      playback: { speed: 1 },
      tracks: [{ id: 't', name: 't', source: 'gpx', color: '#123456', segments: [{ lon: [6.8, 6.81], lat: [45.8, 45.81] }] }],
    }
    expect(parseProject(JSON.stringify(doc)).settings.film).toEqual(custom)
  })

  it('next id: one more than the highest number of the kind', () => {
    const f = film({ stops: [stop('stop-2'), stop('auto-4520'), stop('stop-9')], texts: [text('text-1')] })
    expect(nextFilmId(f, 'stop')).toBe('stop-10')
    expect(nextFilmId(f, 'text')).toBe('text-2')
    expect(nextFilmId(f, 'media')).toBe('media-1')
  })
})

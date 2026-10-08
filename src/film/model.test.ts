import { describe, expect, it } from 'vitest'
import { isValidSetting, parseProject, sanitizeSettings } from '../project/document'
import { DEFAULT_SETTINGS } from '../state/store'
import { DEFAULT_FILM, MEDIA_DEFAULTS, clipTimeS, isValidFilm, nextFilmId, shotDurationS } from './model'
import type { Film, FilmMedia, FilmSpeed, FilmStop, FilmText } from './model'

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
const media = (id: string, patch: Partial<FilmMedia> = {}): FilmMedia => ({
  id,
  startS: 10,
  durationS: 5,
  kind: 'image',
  src: 'photo-1',
  ...MEDIA_DEFAULTS,
  ...patch,
})
const speed = (id: string, fromM: number, toM: number, factor = 2): FilmSpeed => ({ id, fromM, toM, factor })
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
      media: [
        media('media-1'),
        media('media-2', { layout: 'carte', anchor: 'top-right', size: 1.5, kenBurns: false, caption: 'Lac Blanc' }),
        media('media-3', { kind: 'video', src: 'video-1', inS: 2.5, outS: 9, muted: true }),
      ],
    })
    expect(isValidFilm(full)).toBe(true)
    expect(isValidSetting('film', full)).toBe(true)
  })

  it('speed portions: factor ×0,25 to ×4, not overlapping (they may touch), unique ids', () => {
    expect(DEFAULT_FILM.speeds).toEqual([])
    const good = film({ speeds: [speed('speed-2', 3000, 4000, 0.25), speed('speed-1', 1000, 3000, 4)] })
    expect(isValidFilm(good)).toBe(true)
    expect(isValidSetting('film', good)).toBe(true)
    const bad: Film[] = [
      film({ speeds: [speed('speed-1', 1000, 3000), speed('speed-2', 2999, 4000)] }),
      film({ speeds: [speed('speed-1', 1000, 1000)] }),
      film({ speeds: [speed('speed-1', -5, 1000)] }),
      film({ speeds: [speed('speed-1', 0, 1000, 5)] }),
      film({ speeds: [speed('speed-1', 0, 1000, 0.2)] }),
      film({ speeds: [speed('', 0, 1000)] }),
      film({ speeds: [speed('a', 0, 1000)], texts: [text('a')] }),
    ]
    for (const f of bad) expect(isValidFilm(f)).toBe(false)
    // a film saved before the speed portions: none
    const { speeds: _, ...saved } = film({ texts: [text('text-1')] })
    expect(sanitizeSettings({ film: saved }).settings.film).toEqual(film({ texts: [text('text-1')] }))
    expect(nextFilmId(good, 'speed')).toBe('speed-3')
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
      film({ media: [media('media-1', { kind: 'sound' as 'image' })] }),
      film({ media: [media('media-1', { src: '' })] }),
      film({ media: [media('media-1', { layout: 'mosaique' as 'carte' })] }),
      film({ media: [media('media-1', { size: 3 })] }),
      film({ media: [media('media-1', { anchor: 'nowhere' as 'center' })] }),
      film({ media: [media('media-1', { kind: 'video', inS: -1 })] }),
      film({ media: [media('media-1', { kind: 'video', inS: 4, outS: 4 })] }),
      film({ media: [media('media-1', { kind: 'video', muted: 'oui' as unknown as boolean })] }),
      film({ stops: [stop('a')], texts: [text('a')] }),
    ]
    for (const f of bad) expect(isValidFilm(f)).toBe(false)
    expect(isValidSetting('film', { ...DEFAULT_FILM, stops: 'none' })).toBe(false)
  })

  it('older projects keep the stops of their pacing (rythme); new ones stop at every highlight', () => {
    expect(DEFAULT_FILM.autoMode).toBe('temps-forts')
    expect(sanitizeSettings({ flyoverDurationS: 90 }).settings.film).toEqual(DEFAULT_FILM)
    // a film saved before `autoMode` (and its presets): completed, its stops still follow the pacing
    const { autoMode: _, ...saved } = film({ texts: [text('text-1')] })
    expect(sanitizeSettings({ film: saved }).settings.film).toEqual(film({ texts: [text('text-1')], autoMode: 'rythme' }))
    const { settings, invalid } = sanitizeSettings({ film: { ...DEFAULT_FILM, stops: [stop('x', { durationS: -1 })] } })
    expect(invalid).toEqual(['film'])
    expect(settings.film).toEqual(DEFAULT_FILM)
    expect(isValidFilm(film({ autoMode: 'partout' as 'rythme' }))).toBe(false)
    // media saved before their placement get the defaults
    const bare = { id: 'media-1', startS: 10, durationS: 5, kind: 'image', src: 'photo-1' }
    expect(sanitizeSettings({ film: { ...DEFAULT_FILM, media: [bare] } }).settings.film.media).toEqual([media('media-1')])
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
    // a v1 project saved before the film existed: default shots, stops of its pacing
    const { film: _, ...before } = doc.settings
    expect(parseProject(JSON.stringify({ ...doc, settings: before })).settings.film).toEqual(film({ autoMode: 'rythme' }))
  })

  it('time in the file of a video: from its start in the file, held at its end', () => {
    const clip = media('media-1', { kind: 'video', startS: 10, inS: 2 })
    expect(clipTimeS(clip, 10)).toBe(2)
    expect(clipTimeS(clip, 13.5)).toBe(5.5)
    expect(clipTimeS(clip, 8)).toBe(2)
    expect(clipTimeS({ ...clip, outS: 4 }, 13.5)).toBe(4)
    expect(clipTimeS(media('media-2', { startS: 10 }), 11)).toBe(1)
  })

  it('next id: one more than the highest number of the kind', () => {
    const f = film({ stops: [stop('stop-2'), stop('auto-4520'), stop('stop-9')], texts: [text('text-1')] })
    expect(nextFilmId(f, 'stop')).toBe('stop-10')
    expect(nextFilmId(f, 'text')).toBe('text-2')
    expect(nextFilmId(f, 'media')).toBe('media-1')
  })
})

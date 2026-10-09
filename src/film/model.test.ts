import { describe, expect, it } from 'vitest'
import { isValidSetting, parseProject, sanitizeSettings } from '../project/document'
import { DEFAULT_SETTINGS } from '../state/store'
import {
  AUDIO_DEFAULTS,
  DEFAULT_FILM,
  DIP_DEFAULT_S,
  MEDIA_DEFAULTS,
  VIDEO_SOUND_DEFAULTS,
  clipHasSound,
  clipTimeS,
  dipAlpha,
  filmRegionId,
  highlightsRegion,
  isValidFilm,
  nextFilmId,
  shotCuts,
  shotDurationS,
  situationTiming,
  transitionDipAt,
} from './model'
import type { Film, FilmAudio, FilmCameraKey, FilmMedia, FilmSpeed, FilmStop, FilmText } from './model'

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

const music = (id: string, patch: Partial<FilmAudio> = {}): FilmAudio => ({ id, src: 'audio-1', startS: 0, durationS: 30, inS: 0, ...AUDIO_DEFAULTS, ...patch })

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

  it('shot transitions: continuous by default (old films unchanged), checked on load', () => {
    expect(DEFAULT_FILM.opening.transition).toBeUndefined()
    expect(shotCuts(DEFAULT_FILM.opening)).toBe(false)
    expect(shotCuts({ style: 'descente', durationS: 6, transition: 'coupe' })).toBe(true)
    const dipped = film({ opening: { style: 'descente', durationS: 6, transition: 'fondu-noir', dipS: 0.3 }, closing: { style: 'saut', durationS: 5, transition: 'fondu-blanc', dipS: 2 } })
    expect(isValidFilm(dipped)).toBe(true)
    expect(isValidSetting('film', dipped)).toBe(true)
    // a film saved before the transitions loads as it was
    expect(sanitizeSettings({ film: DEFAULT_FILM }).settings.film).toEqual(DEFAULT_FILM)
    const bad: Film[] = [
      film({ opening: { style: 'descente', durationS: 6, transition: 'fondu' as never } }),
      film({ opening: { style: 'descente', durationS: 6, transition: 'fondu-noir', dipS: 0.2 } }),
      film({ closing: { style: 'descente', durationS: 6, transition: 'fondu-noir', dipS: 2.5 } }),
    ]
    for (const f of bad) expect(isValidFilm(f)).toBe(false)
  })

  it('region shot: start height and highlight optional (off by default, old films unchanged), checked on load', () => {
    expect(highlightsRegion(DEFAULT_FILM)).toBe(false)
    const region = film({ opening: { style: 'situation', durationS: 9, startHeight: 'pays', highlight: true } })
    expect(isValidFilm(region)).toBe(true)
    expect(isValidSetting('film', region)).toBe(true)
    expect(highlightsRegion(region)).toBe(true)
    expect(highlightsRegion(film({ closing: { style: 'situation', durationS: 9, highlight: true } }))).toBe(true)
    // only a 'situation' shot highlights it, and only when asked
    expect(highlightsRegion(film({ opening: { style: 'situation', durationS: 9 } }))).toBe(false)
    expect(highlightsRegion(film({ opening: { style: 'descente', durationS: 9, highlight: true } }))).toBe(false)
    const bad: Film[] = [
      film({ opening: { style: 'situation', durationS: 9, startHeight: 'monde' as never } }),
      film({ opening: { style: 'situation', durationS: 9, highlight: 'oui' as never } }),
    ]
    for (const f of bad) expect(isValidFilm(f)).toBe(false)
  })

  it('region shot: place optional (automatic by default), an OSM relation or way, the first highlighting shot’s', () => {
    expect(filmRegionId(DEFAULT_FILM)).toBeNull()
    const park = film({
      opening: { style: 'situation', durationS: 9, highlight: true, regionId: 'relation/3' },
      closing: { style: 'situation', durationS: 9, highlight: true, regionId: 'way/5' },
    })
    expect(isValidFilm(park)).toBe(true)
    expect(filmRegionId(park)).toBe('relation/3')
    expect(filmRegionId({ ...park, opening: { ...park.opening, highlight: false } })).toBe('way/5')
    for (const regionId of ['node/1', 'relation/', 'relation/1a', 3 as never]) {
      expect(isValidFilm(film({ opening: { style: 'situation', durationS: 9, regionId } }))).toBe(false)
    }
  })

  it('region shot: hold optional (none by default), within its range; hold + move = the shot duration', () => {
    expect(isValidFilm(film({ opening: { style: 'situation', durationS: 9, holdS: 3 } }))).toBe(true)
    for (const holdS of [-1, 10.5, '2' as never]) {
      expect(isValidFilm(film({ opening: { style: 'situation', durationS: 9, holdS } }))).toBe(false)
    }
    expect(situationTiming({ durationS: 9 })).toEqual({ holdS: 0, moveS: 9 })
    expect(situationTiming({ durationS: 4, holdS: 6 })).toEqual({ holdS: 4, moveS: 0 })
  })

  it('dip curve: 0 outside its window, symmetric, 1 at the cut', () => {
    expect(dipAlpha(10, 10, 1)).toBe(1)
    expect(dipAlpha(9.5, 10, 1)).toBe(0)
    expect(dipAlpha(10.5, 10, 1)).toBe(0)
    expect(dipAlpha(8, 10, 1)).toBe(0)
    expect(dipAlpha(9.75, 10, 1)).toBeCloseTo(0.5, 12)
    for (const d of [0.05, 0.2, 0.4]) expect(dipAlpha(10 - d, 10, 1)).toBeCloseTo(dipAlpha(10 + d, 10, 1), 12)
    // rising towards the cut, flat at its top
    expect(dipAlpha(9.8, 10, 1)).toBeLessThan(dipAlpha(9.9, 10, 1))
    expect(dipAlpha(9.99, 10, 1)).toBeGreaterThan(0.999)
    expect(dipAlpha(10, 10, 0)).toBe(0)
  })

  it('dip of the film: at the start of the flight for the opening, at its end for the closing, none for a cut or no shot', () => {
    const time = (timeS: number) => ({ timeS, openingS: 6, flightS: 60 })
    const shots = film({
      opening: { style: 'descente', durationS: 6, transition: 'fondu-noir' },
      closing: { style: 'descente', durationS: 5, transition: 'fondu-blanc', dipS: 2 },
    })
    expect(transitionDipAt(shots, time(6))).toEqual({ color: 'black', alpha: 1 })
    expect(transitionDipAt(shots, time(6 - DIP_DEFAULT_S / 2))).toBeNull()
    expect(transitionDipAt(shots, time(6.2))?.color).toBe('black')
    expect(transitionDipAt(shots, time(30))).toBeNull()
    expect(transitionDipAt(shots, time(66))).toEqual({ color: 'white', alpha: 1 })
    expect(transitionDipAt(shots, time(65.5))?.alpha).toBeCloseTo(0.5, 12)
    expect(transitionDipAt(film({ opening: { style: 'descente', durationS: 6, transition: 'coupe' } }), time(6))).toBeNull()
    expect(transitionDipAt(film({ opening: { style: 'aucune', durationS: 6, transition: 'fondu-noir' } }), time(0))).toBeNull()
    expect(transitionDipAt(DEFAULT_FILM, time(6))).toBeNull()
  })

  it('accepts complete lanes', () => {
    const full = film({
      autoStops: false,
      stops: [stop('stop-1', { label: 'Sommet', source: { kind: 'landmark', ref: 'node/1' } }), stop('auto-4520', { camera: 'fixe' })],
      texts: [text('text-1', { subtitle: '1 653 m', color: '#dbe64c', font: 'mono' }), text('text-2', { stopId: 'stop-1' })],
      media: [
        media('media-1'),
        media('media-2', { layout: 'carte', anchor: 'top-right', size: 1.5, kenBurns: false, caption: 'Lac Blanc', stopId: 'auto-4520' }),
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

  it('music clips: volume 0–1, fades 0–30 s, start in the file, unique ids; none in a film saved before', () => {
    expect(DEFAULT_FILM.audio).toEqual([])
    const good = film({ audio: [music('music-1'), music('music-2', { startS: 20, inS: 12.5, volume: 0, fadeInS: 0, fadeOutS: 30 })] })
    expect(isValidFilm(good)).toBe(true)
    expect(isValidSetting('film', good)).toBe(true)
    const bad: Film[] = [
      film({ audio: [music('music-1', { volume: 1.2 })] }),
      film({ audio: [music('music-1', { fadeInS: -1 })] }),
      film({ audio: [music('music-1', { fadeOutS: 31 })] }),
      film({ audio: [music('music-1', { durationS: 0.2 })] }),
      film({ audio: [music('music-1', { inS: -1 })] }),
      film({ audio: [music('music-1', { src: '' })] }),
      film({ audio: [music('a')], texts: [text('a')] }),
    ]
    for (const f of bad) expect(isValidFilm(f)).toBe(false)
    const { audio: _, ...saved } = film({ texts: [text('text-1')] })
    expect(sanitizeSettings({ film: saved }).settings.film).toEqual(film({ texts: [text('text-1')] }))
    expect(nextFilmId(good, 'music')).toBe('music-3')
  })

  it('camera of a stop: as in the film, slow turn, wide view or held', () => {
    for (const camera of ['film', 'orbite', 'large', 'fixe'] as const) expect(isValidFilm(film({ stops: [stop('stop-1', { camera })] }))).toBe(true)
  })

  it('camera keys: framing within the camera ranges, unique ids; none in a film saved before', () => {
    expect(DEFAULT_FILM.cameraKeys).toEqual([])
    const key = (id: string, patch: Partial<FilmCameraKey> = {}): FilmCameraKey => ({ id, atM: 2000, distance: 2, pitchDeg: 60, headingOffsetDeg: -90, ...patch })
    const good = film({ cameraKeys: [key('camera-2', { atM: 500 }), key('camera-1')] })
    expect(isValidFilm(good)).toBe(true)
    expect(isValidSetting('film', good)).toBe(true)
    const bad: Film[] = [
      film({ cameraKeys: [key('camera-1', { atM: -1 })] }),
      film({ cameraKeys: [key('camera-1', { distance: 5 })] }),
      film({ cameraKeys: [key('camera-1', { pitchDeg: 90 })] }),
      film({ cameraKeys: [key('camera-1', { headingOffsetDeg: 200 })] }),
      film({ cameraKeys: [key('')] }),
      film({ cameraKeys: [key('a')], stops: [stop('a')] }),
    ]
    for (const f of bad) expect(isValidFilm(f)).toBe(false)
    const { cameraKeys: _, ...saved } = film({ texts: [text('text-1')] })
    expect(sanitizeSettings({ film: saved }).settings.film).toEqual(film({ texts: [text('text-1')] }))
    expect(nextFilmId(good, 'camera')).toBe('camera-3')
  })

  it('sound of the clips: heard when not muted, silent when saved before it was handled or following the flight', () => {
    const clip = media('media-1', { kind: 'video', src: 'video-1', ...VIDEO_SOUND_DEFAULTS })
    expect(clipHasSound(clip)).toBe(true)
    expect(clipHasSound({ ...clip, muted: true })).toBe(false)
    expect(clipHasSound({ ...clip, muted: undefined })).toBe(false)
    expect(clipHasSound({ ...clip, volume: 0 })).toBe(false)
    expect(clipHasSound({ ...clip, volume: undefined })).toBe(true)
    expect(clipHasSound({ ...clip, sync: { startMs: 0, offsetS: 0, follow: true } })).toBe(false)
    expect(clipHasSound({ ...clip, sync: { startMs: 0, offsetS: 0, follow: false } })).toBe(true)
    expect(clipHasSound({ ...clip, kind: 'image' })).toBe(false)
    expect(isValidFilm(film({ media: [clip], duckMusic: true }))).toBe(true)
    expect(isValidFilm(film({ media: [{ ...clip, volume: 1.5 }] }))).toBe(false)
    expect(isValidFilm(film({ duckMusic: 'oui' as unknown as boolean }))).toBe(false)
    // a film saved before: its clips stay silent, its music is not lowered; the clips saved since keep their sound
    const { duckMusic: _, ...saved } = film({ media: [{ ...clip, muted: undefined, volume: undefined }, { ...clip, id: 'media-2' }] })
    const loaded = sanitizeSettings({ film: saved }).settings.film
    expect(loaded.duckMusic).toBe(false)
    expect(loaded.media.map((m) => m.muted)).toEqual([true, false])
  })

  it('rejects bad shots, items and duplicate ids', () => {
    expect(isValidFilm(film({ opening: { style: 'situation', durationS: 8 }, closing: { style: 'situation', durationS: 6 } }))).toBe(true)
    const bad: Film[] = [
      film({ opening: { style: 'tourbillon' as 'saut', durationS: 5 } }),
      film({ closing: { style: 'saut', durationS: 0 } }),
      film({ stops: [stop('stop-1', { camera: 'drone' as 'fixe' })] }),
      film({ stops: [stop('stop-1', { atM: -1 })] }),
      film({ stops: [stop('stop-1', { durationS: 120 })] }),
      film({ stops: [stop('')] }),
      film({ stops: [stop('stop-1', { source: { kind: 'photo' as 'manual' } })] }),
      film({ texts: [text('text-1', { anchor: 'nowhere' as 'center' })] }),
      film({ texts: [text('text-1', { size: 5 })] }),
      film({ texts: [text('text-1', { durationS: 0 })] }),
      film({ texts: [text('text-1', { color: 'red' })] }),
      film({ texts: [text('text-1', { font: 'comic' as 'mono' })] }),
      film({ media: [media('media-1', { kind: 'sound' as 'image' })] }),
      film({ media: [media('media-1', { src: '' })] }),
      film({ media: [media('media-1', { layout: 'mosaique' as 'carte' })] }),
      film({ media: [media('media-1', { size: 3 })] }),
      film({ media: [media('media-1', { anchor: 'nowhere' as 'center' })] }),
      film({ media: [media('media-1', { kind: 'video', inS: -1 })] }),
      film({ media: [media('media-1', { kind: 'video', inS: 4, outS: 4 })] }),
      film({ media: [media('media-1', { kind: 'video', muted: 'oui' as unknown as boolean })] }),
      film({ stops: [stop('a')], texts: [text('a')] }),
      film({ texts: [text('text-1', { stopId: '' })] }),
      film({ media: [media('media-1', { stopId: 3 as unknown as string })] }),
    ]
    for (const f of bad) expect(isValidFilm(f)).toBe(false)
    expect(isValidSetting('film', { ...DEFAULT_FILM, stops: 'none' })).toBe(false)
  })

  it('loads texts and media attached to a missing stop free, without rejecting the film', () => {
    const own = film({ autoStops: false, stops: [stop('stop-1')] })
    const saved = {
      ...own,
      texts: [text('text-1', { stopId: 'stop-1' }), text('text-2', { stopId: 'stop-9' })],
      media: [{ id: 'media-1', startS: 10, durationS: 5, kind: 'image', src: 'photo-1', stopId: 42 }],
    }
    const { settings, invalid } = sanitizeSettings({ film: saved })
    expect(invalid).toEqual([])
    expect(settings.film.texts).toEqual([text('text-1', { stopId: 'stop-1' }), text('text-2')])
    expect(settings.film.media).toEqual([media('media-1')])
    // generated stops are not the film's own: no attachment to them
    const auto = sanitizeSettings({ film: { ...DEFAULT_FILM, texts: [text('text-1', { stopId: 'auto-4520' })] } })
    expect(auto.settings.film.texts).toEqual([text('text-1')])
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
    // landmark titles: on for new films, off for those saved before them (their flight stays as it was)
    expect(DEFAULT_FILM.landmarkTitles).toBe(true)
    const { landmarkTitles: _t, ...untitled } = film({})
    expect(sanitizeSettings({ film: untitled }).settings.film.landmarkTitles).toBe(false)
    // media saved before their placement get the defaults
    const bare = { id: 'media-1', startS: 10, durationS: 5, kind: 'image', src: 'photo-1' }
    expect(sanitizeSettings({ film: { ...DEFAULT_FILM, media: [bare] } }).settings.film.media).toEqual([media('media-1')])
    // the `epochs` key of earlier versions is dropped, the film still opens
    const old = { ...film({ texts: [text('text-1')] }), epochs: [{ id: 'epoch-1', startS: 4, durationS: 6, imagerySourceId: 'ign-ortho-1950-1965', badge: true }] }
    expect(sanitizeSettings({ film: old })).toEqual({ settings: { ...DEFAULT_SETTINGS, film: film({ texts: [text('text-1')] }) }, invalid: [] })
  })

  it('round-trips through the project document', () => {
    const custom = film({ autoStops: false, stops: [stop('stop-2')], texts: [text('text-1', { stopId: 'stop-2' })] })
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
    expect(parseProject(JSON.stringify({ ...doc, settings: before })).settings.film).toEqual(film({ autoMode: 'rythme', landmarkTitles: false }))
  })

  it('time in the file of a video: from its start in the file, held at its end', () => {
    const clip = media('media-1', { kind: 'video', startS: 10, inS: 2 })
    expect(clipTimeS(clip, 10)).toBe(2)
    expect(clipTimeS(clip, 13.5)).toBe(5.5)
    expect(clipTimeS(clip, 8)).toBe(2)
    expect(clipTimeS({ ...clip, outS: 4 }, 13.5)).toBe(4)
    expect(clipTimeS(media('media-2', { startS: 10 }), 11)).toBe(1)
  })

  it('time in the file of a synced clip following the flight: what it recorded at the instant under the marker', () => {
    const T = Date.UTC(2024, 5, 12, 8, 0, 0)
    const sync = { startMs: T, offsetS: 0, follow: true }
    const clip = media('media-1', { kind: 'video', startS: 10, sync })
    // whatever the film time: the recorded instant decides
    expect(clipTimeS(clip, 10, T + 7_000)).toBe(7)
    expect(clipTimeS(clip, 99, T + 7_000)).toBe(7)
    // held at its start before the recording, at its end in the file after
    expect(clipTimeS(clip, 10, T - 5_000)).toBe(0)
    expect(clipTimeS({ ...clip, inS: 3 }, 10, T + 1_000)).toBe(3)
    expect(clipTimeS({ ...clip, outS: 4 }, 10, T + 7_000)).toBe(4)
    // camera clock correction: recorded 2 s later than its file says
    expect(clipTimeS({ ...clip, sync: { ...sync, offsetS: 2 } }, 10, T + 7_000)).toBe(5)
    // not following, or no recorded time (untimed track): played at ×1 from its start
    expect(clipTimeS({ ...clip, sync: { ...sync, follow: false } }, 13, T + 7_000)).toBe(3)
    expect(clipTimeS(clip, 13)).toBe(3)
  })

  it('checks the sync of a clip', () => {
    const clip = (sync: unknown) => film({ media: [media('media-1', { kind: 'video', sync: sync as FilmMedia['sync'] })] })
    expect(isValidFilm(clip({ startMs: 1_718_179_200_000, offsetS: -3600, follow: true }))).toBe(true)
    for (const bad of [null, {}, { startMs: Number.NaN, offsetS: 0, follow: false }, { startMs: 0, offsetS: 1e6, follow: false }, { startMs: 0, offsetS: 0 }]) {
      expect(isValidFilm(clip(bad))).toBe(false)
    }
  })

  it('next id: one more than the highest number of the kind', () => {
    const f = film({ stops: [stop('stop-2'), stop('auto-4520'), stop('stop-9')], texts: [text('text-1')] })
    expect(nextFilmId(f, 'stop')).toBe('stop-10')
    expect(nextFilmId(f, 'text')).toBe('text-2')
    expect(nextFilmId(f, 'media')).toBe('media-1')
  })
})

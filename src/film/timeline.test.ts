import { describe, expect, it } from 'vitest'
import { buildTrackPath } from '../flyover/path'
import { DEFAULT_PACING } from '../flyover/pacing'
import { buildTrack } from '../import/stats'
import { buildFilmClock } from './clock'
import type { FilmClockInput } from './clock'
import { AUTO_STOP_S, DEFAULT_FILM, MEDIA_DEFAULTS, isValidFilm } from './model'
import type { Film, FilmMedia, FilmStop, FilmText } from './model'
import {
  NEW_MEDIA_S,
  NEW_VIDEO_MAX_S,
  addMedia,
  addStop,
  addText,
  dragFilm,
  fitPxPerS,
  formatFilmTime,
  hasFilmItem,
  photoFilmTime,
  removeFilmItem,
  rulerStep,
  rulerTicks,
  snapTargets,
  snapTime,
  stopPositionAt,
  updateShot,
  updateStop,
  updateMedia,
  updateText,
  zoomAt,
} from './timeline'
import type { DragContext } from './timeline'

const L = 10_000
const D = 60
const stop = (id: string, atM: number, durationS = 4): FilmStop => ({ id, atM, durationS, camera: 'orbite' })
const text = (id: string, startS: number, durationS = 4): FilmText => ({ id, startS, durationS, text: id, anchor: 'center', size: 1 })
const photo = (id: string, startS: number, durationS = 5): FilmMedia => ({ id, startS, durationS, kind: 'image', src: 'photo-1', ...MEDIA_DEFAULTS })
const film: Film = {
  ...DEFAULT_FILM,
  autoStops: false,
  stops: [stop('stop-1', 2000), stop('stop-2', 7000, 2)],
  texts: [text('text-1', 10), text('text-2', 30, 2)],
  media: [photo('media-1', 40)],
}

function contextOf(f: Film, patch: Partial<DragContext> = {}, pacing = { ...DEFAULT_PACING, keepDuration: false }): DragContext {
  const input: FilmClockInput = { opening: f.opening, closing: f.closing, stops: f.stops, lengthM: L, highlightsM: [], durationS: D, pacing }
  const clockOf = (stops: readonly FilmStop[]) => buildFilmClock({ ...input, stops })
  return { clock: clockOf(f.stops), clockOf, lengthM: L, targets: [], targetsM: [], snapS: 0, ...patch }
}

describe('timeline scale', () => {
  it('fits the film, zooms around the pointer', () => {
    expect(fitPxPerS(900, 90)).toBe(10)
    expect(fitPxPerS(0, 90)).toBe(1)
    // time under the pointer (200 px from the left, scrolled by 100 px) stays under it
    const before = (100 + 200) / (10 * 2)
    const { zoom, scrollLeft } = zoomAt(2, 1.5, 200, 100)
    expect(zoom).toBe(3)
    expect((scrollLeft + 200) / (10 * zoom)).toBeCloseTo(before, 12)
    expect(zoomAt(1, 0.5, 200, 0)).toEqual({ zoom: 1, scrollLeft: 0 })
    expect(zoomAt(40, 10, 0, 0).zoom).toBe(50)
  })

  it('ruler: the first step wide enough for a label', () => {
    expect(rulerStep(10)).toBe(10)
    expect(rulerStep(100)).toBe(1)
    expect(rulerStep(1)).toBe(60)
    expect(rulerTicks(25, 10)).toEqual([0, 10, 20])
  })

  it('formats film times as m:ss, tenths on demand', () => {
    expect(formatFilmTime(0)).toBe('0:00')
    expect(formatFilmTime(75.9)).toBe('1:15')
    expect(formatFilmTime(75.44, true)).toBe('1:15,4')
    expect(formatFilmTime(59.96, true)).toBe('1:00,0')
    expect(formatFilmTime(-3)).toBe('0:00')
    expect(formatFilmTime(3600)).toBe('60:00')
  })
})

describe('snapping', () => {
  it('nearest target within the distance', () => {
    expect(snapTime(10.2, [5, 10, 10.5], 0.4)).toBe(10)
    expect(snapTime(10.2, [5, 10.5], 0.4)).toBe(10.5)
    expect(snapTime(10.2, [5, 11], 0.4)).toBe(10.2)
    expect(snapTime(10.2, [10], 0)).toBe(10.2)
  })

  it('targets: film ends, shot edges, other blocks, highlights, playhead', () => {
    const { clock } = contextOf(film)
    const targets = snapTargets(clock, film, [0.5], 12.3, 'text-1')
    const total = clock.totalTime()
    expect(targets).toEqual(expect.arrayContaining([0, total, 6, total - 5, 12.3, 30, 32, clock.stops[0].startS, clock.timeAtProgress(0.5)]))
    expect(targets).not.toContain(10)
    expect(snapTargets(clock, film, [], 0, 'stop-1')).not.toContain(clock.stops[0].startS)
  })
})

describe('placing a stop in time', () => {
  for (const keepDuration of [false, true]) {
    it(`the hold starts at the requested time (keepDuration ${keepDuration})`, () => {
      const ctx = contextOf(film, {}, { ...DEFAULT_PACING, keepDuration })
      for (const target of [9, 20, 40]) {
        const atM = stopPositionAt(ctx.clockOf, film.stops, 'stop-1', target, L)
        const moved = ctx.clockOf(film.stops.map((s) => (s.id === 'stop-1' ? { ...s, atM } : s)))
        expect(moved.stops.find((s) => s.id === 'stop-1')!.holdStartS).toBeCloseTo(target, 3)
      }
      expect(stopPositionAt(ctx.clockOf, film.stops, 'stop-1', -5, L)).toBe(0)
      expect(stopPositionAt(ctx.clockOf, film.stops, 'stop-1', 1e6, L)).toBe(L)
    })
  }
})

describe('dragFilm', () => {
  it('opening end and closing start, clamped, snapped; « aucune » stays', () => {
    const ctx = contextOf(film)
    expect(dragFilm(film, 'opening', 'end', 2, ctx).opening.durationS).toBe(8)
    expect(dragFilm(film, 'opening', 'end', 100, ctx).opening.durationS).toBe(30)
    expect(dragFilm(film, 'closing', 'start', -1.5, ctx).closing.durationS).toBe(6.5)
    expect(dragFilm(film, 'closing', 'start', 10, ctx).closing.durationS).toBe(1)
    expect(dragFilm(film, 'opening', 'end', 1.8, { ...ctx, targets: [8], snapS: 0.5 }).opening.durationS).toBe(8)
    const none = { ...film, opening: { style: 'aucune' as const, durationS: 6 } }
    expect(dragFilm(none, 'opening', 'end', 2, contextOf(none))).toBe(none)
  })

  it('moves a stop along the track (its hold follows the pointer), snaps to a highlight', () => {
    const ctx = contextOf(film)
    const before = ctx.clock.stops.find((s) => s.id === 'stop-1')!
    const moved = dragFilm(film, 'stop-1', 'move', 5, ctx)
    const after = ctx.clockOf(moved.stops).stops.find((s) => s.id === 'stop-1')!
    expect(after.holdStartS).toBeCloseTo(before.holdStartS + 5, 1)
    expect(Number.isInteger(moved.stops[0].atM)).toBe(true)
    expect(moved.stops[1]).toBe(film.stops[1])
    // 5 s ≈ 830 m further (10 km in 60 s); snapping 0.5 s ≈ 76 m: a highlight 30 m away is taken, 400 m is not
    const near = moved.stops[0].atM + 30
    expect(dragFilm(film, 'stop-1', 'move', 5, { ...ctx, targetsM: [near], snapS: 0.5 }).stops[0].atM).toBe(near)
    expect(dragFilm(film, 'stop-1', 'move', 5, { ...ctx, targetsM: [near + 370], snapS: 0.5 }).stops[0].atM).toBe(moved.stops[0].atM)
  })

  it('stretches a stop by its end edge, in proportion to the duration cap', () => {
    expect(dragFilm(film, 'stop-1', 'end', 2, contextOf(film)).stops[0].durationS).toBe(6)
    expect(dragFilm(film, 'stop-1', 'end', -10, contextOf(film)).stops[0].durationS).toBe(0.5)
    // keepDuration: the stops take at most half of the 60 s flight, here shortened by half: 1 s more is 2 s asked
    const big = { ...film, stops: [stop('stop-1', 2000, 40), stop('stop-2', 7000, 20)] }
    const ctx = contextOf(big, {}, { ...DEFAULT_PACING, keepDuration: true })
    const share = ctx.clock.stops[0].addedS / 40
    expect(share).toBeCloseTo(0.5, 9)
    expect(dragFilm(big, 'stop-1', 'end', 1, ctx).stops[0].durationS).toBe(42)
  })

  it('moves and stretches a text by its body and edges, snapping either edge', () => {
    const ctx = contextOf(film)
    expect(dragFilm(film, 'text-1', 'move', 2.5, ctx).texts[0]).toMatchObject({ startS: 12.5, durationS: 4 })
    expect(dragFilm(film, 'text-1', 'move', -20, ctx).texts[0].startS).toBe(0)
    // the end (14 + 1.9) snaps to 16
    expect(dragFilm(film, 'text-1', 'move', 1.9, { ...ctx, targets: [16], snapS: 0.3 }).texts[0].startS).toBe(12)
    expect(dragFilm(film, 'text-1', 'start', -3, ctx).texts[0]).toMatchObject({ startS: 7, durationS: 7 })
    expect(dragFilm(film, 'text-1', 'start', 10, ctx).texts[0]).toMatchObject({ startS: 13.5, durationS: 0.5 })
    expect(dragFilm(film, 'text-1', 'end', 1.234, ctx).texts[0]).toMatchObject({ startS: 10, durationS: 5.23 })
    expect(dragFilm(film, 'text-1', 'end', -10, ctx).texts[0].durationS).toBe(0.5)
    expect(dragFilm(film, 'missing', 'move', 1, ctx)).toBe(film)
  })

  it('moves and stretches a photo like a text', () => {
    const ctx = contextOf(film)
    expect(dragFilm(film, 'media-1', 'move', 2.5, ctx).media[0]).toMatchObject({ startS: 42.5, durationS: 5 })
    expect(dragFilm(film, 'media-1', 'start', -3, ctx).media[0]).toMatchObject({ startS: 37, durationS: 8 })
    expect(dragFilm(film, 'media-1', 'end', 1, { ...ctx, targets: [46.1], snapS: 0.3 }).media[0]).toMatchObject({ startS: 40, durationS: 6.1 })
    expect(dragFilm(film, 'media-1', 'move', 1, ctx).texts).toBe(film.texts)
  })

  it('trims a video by its start edge: its start in the file follows, not before the start of the file', () => {
    const clip: FilmMedia = { ...photo('media-1', 40, 10), kind: 'video', src: 'video-1', kenBurns: false, inS: 2 }
    const f = { ...film, media: [clip] }
    const ctx = contextOf(f)
    expect(dragFilm(f, 'media-1', 'start', 1.5, ctx).media[0]).toMatchObject({ startS: 41.5, durationS: 8.5, inS: 3.5 })
    expect(dragFilm(f, 'media-1', 'start', -5, ctx).media[0]).toMatchObject({ startS: 38, durationS: 12, inS: 0 })
    // moving or stretching the end keeps the start in the file
    expect(dragFilm(f, 'media-1', 'move', 3, ctx).media[0]).toMatchObject({ startS: 43, inS: 2 })
    expect(dragFilm(f, 'media-1', 'end', 3, ctx).media[0]).toMatchObject({ durationS: 13, inS: 2 })
  })
})

describe('edits', () => {
  it('adds a manual stop and a text with fresh ids, valid', () => {
    const a = addStop(film, 4321.5)
    expect(a.id).toBe('stop-3')
    expect(a.film.stops.at(-1)).toEqual({
      id: 'stop-3',
      atM: 4321.5,
      durationS: AUTO_STOP_S,
      camera: 'orbite',
      label: 'Arrêt 3',
      source: { kind: 'manual' },
    })
    const b = addStop(a.film, 100, { label: 'Col', source: { kind: 'landmark', ref: 'node/1' } })
    expect(b.film.stops.at(-1)).toMatchObject({ id: 'stop-4', label: 'Col', source: { kind: 'landmark', ref: 'node/1' } })
    const t = addText(b.film, 12.346)
    expect(t.id).toBe('text-3')
    expect(t.film.texts.at(-1)).toMatchObject({ startS: 12.35, durationS: 4, anchor: 'bottom-center', size: 1 })
    expect(isValidFilm(t.film)).toBe(true)
  })

  it('adds photos one after the other from the playhead, valid', () => {
    const { film: next, ids } = addMedia(film, 12.346, [{ src: 'photo-4' }, { src: 'photo-5' }])
    expect(ids).toEqual(['media-2', 'media-3'])
    expect(next.media.slice(1)).toEqual([
      { id: 'media-2', startS: 12.35, durationS: NEW_MEDIA_S, kind: 'image', src: 'photo-4', ...MEDIA_DEFAULTS },
      { id: 'media-3', startS: 17.35, durationS: NEW_MEDIA_S, kind: 'image', src: 'photo-5', ...MEDIA_DEFAULTS },
    ])
    expect(isValidFilm(next)).toBe(true)
    expect(snapTargets(contextOf(next).clock, next, [], 0)).toEqual(expect.arrayContaining([40, 45, 17.35]))
    expect(removeFilmItem(next, 'media-2').media.map((m) => m.id)).toEqual(['media-1', 'media-3'])
    expect(updateMedia(next, 'media-1', { startS: -1, durationS: 900, layout: 'carte', caption: 'Lac' }).media[0]).toMatchObject({
      startS: 0,
      durationS: 600,
      layout: 'carte',
      caption: 'Lac',
    })
  })

  it('adds videos at their natural length, capped, without Ken Burns, after the photos', () => {
    const { film: next, ids } = addMedia(film, 10, [{ src: 'video-1', videoS: 12.345 }, { src: 'photo-2' }, { src: 'video-2', videoS: 95 }])
    expect(ids).toEqual(['media-2', 'media-3', 'media-4'])
    expect(next.media.slice(1)).toEqual([
      { id: 'media-2', startS: 10, durationS: 12.35, kind: 'video', src: 'video-1', ...MEDIA_DEFAULTS, kenBurns: false },
      { id: 'media-3', startS: 22.35, durationS: NEW_MEDIA_S, kind: 'image', src: 'photo-2', ...MEDIA_DEFAULTS },
      { id: 'media-4', startS: 27.35, durationS: NEW_VIDEO_MAX_S, kind: 'video', src: 'video-2', ...MEDIA_DEFAULTS, kenBurns: false },
    ])
    expect(isValidFilm(next)).toBe(true)
    expect(updateMedia(next, 'media-2', { inS: -3 }).media[1].inS).toBe(0)
    expect(updateMedia(next, 'media-2', { inS: 4.567 }).media[1].inS).toBe(4.57)
  })

  it('removes a stop or a text; updates clamp to the model ranges', () => {
    expect(removeFilmItem(film, 'stop-1').stops.map((s) => s.id)).toEqual(['stop-2'])
    expect(removeFilmItem(film, 'text-2').texts.map((t) => t.id)).toEqual(['text-1'])
    // a shot is not removed: it goes to « aucune »
    expect(removeFilmItem(film, 'opening').opening.style).toBe('aucune')
    expect(removeFilmItem(film, 'opening').stops).toEqual(film.stops)
    expect(updateStop(film, 'stop-1', { durationS: 99, camera: 'fixe', label: 'Sommet' }).stops[0]).toMatchObject({
      durationS: 60,
      camera: 'fixe',
      label: 'Sommet',
    })
    expect(updateText(film, 'text-1', { startS: -2, durationS: 0.1, text: 'Titre' }).texts[0]).toMatchObject({
      startS: 0,
      durationS: 0.5,
      text: 'Titre',
    })
    expect(updateShot(film, 'closing', { style: 'saut', durationS: 0 }).closing).toEqual({ style: 'saut', durationS: 1 })
  })

  it('tells whether a selected item is still in the film', () => {
    const { stops } = contextOf(film).clock
    for (const id of ['opening', 'closing', 'stop-2', 'text-1', 'media-1']) expect(hasFilmItem(film, stops, id)).toBe(true)
    expect(hasFilmItem(film, stops, 'text-9')).toBe(false)
    expect(hasFilmItem(removeFilmItem(film, 'media-1'), stops, 'media-1')).toBe(false)
    // a generated stop is only in the clock
    expect(hasFilmItem(film, [{ id: 'auto-1500' }], 'auto-1500')).toBe(true)
  })
})

describe('placing a photo on the track', () => {
  const T0 = Date.UTC(2025, 6, 12, 6)
  const MIN = 60_000
  // out and back along a parallel: 0.01° of longitude ≈ 775 m at 45.9°, 5 min per point
  const lons = [6.8, 6.81, 6.82, 6.81, 6.8]
  const track = buildTrack({
    name: 'aller-retour',
    source: 'gpx',
    segments: [{ points: lons.map((lon, i) => ({ lon, lat: 45.9, time: T0 + 5 * i * MIN })) }],
  })
  const path = buildTrackPath(track)
  const input: FilmClockInput = {
    opening: { style: 'descente', durationS: 6 },
    closing: { style: 'aucune', durationS: 5 },
    stops: [],
    lengthM: path.lengthM,
    highlightsM: [],
    durationS: 40,
    pacing: { ...DEFAULT_PACING, enabled: false },
  }
  const clock = buildFilmClock(input)
  const at = (distanceM: number) => Math.round(clock.timeAtProgress(distanceM / path.lengthM) * 100) / 100

  it('at the nearest point of the track, on the pass closest to the capture time', () => {
    expect(photoFilmTime(path, clock, { lon: 6.8201, lat: 45.9001 })).toBe(at(path.dist[2]))
    expect(photoFilmTime(path, clock, { lon: 6.81, lat: 45.9 })).toBe(at(path.dist[1]))
    expect(photoFilmTime(path, clock, { lon: 6.81, lat: 45.9, timeMs: T0 + 14 * MIN })).toBe(at(path.dist[3]))
  })

  it('else at the point recorded at the capture time; nothing far from the track or outside the outing', () => {
    expect(photoFilmTime(path, clock, { timeMs: T0 + 2.5 * MIN })).toBe(at(path.dist[1] / 2))
    expect(photoFilmTime(path, clock, { lon: 7.5, lat: 45.9 })).toBeUndefined()
    expect(photoFilmTime(path, clock, { lon: 7.5, lat: 45.9, timeMs: T0 + 5 * MIN })).toBe(at(path.dist[1]))
    expect(photoFilmTime(path, clock, { timeMs: T0 - 10 * MIN })).toBe(at(0))
    expect(photoFilmTime(path, clock, { timeMs: T0 + 3 * 3_600_000 })).toBeUndefined()
    expect(photoFilmTime(path, clock, {})).toBeUndefined()
  })
})

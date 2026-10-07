import { describe, expect, it } from 'vitest'
import { DEFAULT_PACING } from '../flyover/pacing'
import { buildFilmClock } from './clock'
import type { FilmClockInput } from './clock'
import { AUTO_STOP_S, DEFAULT_FILM, isValidFilm } from './model'
import type { Film, FilmStop, FilmText } from './model'
import {
  addStop,
  addText,
  dragFilm,
  fitPxPerS,
  formatFilmTime,
  removeFilmItem,
  rulerStep,
  rulerTicks,
  snapTargets,
  snapTime,
  stopPositionAt,
  updateShot,
  updateStop,
  updateText,
  zoomAt,
} from './timeline'
import type { DragContext } from './timeline'

const L = 10_000
const D = 60
const stop = (id: string, atM: number, durationS = 4): FilmStop => ({ id, atM, durationS, camera: 'orbite' })
const text = (id: string, startS: number, durationS = 4): FilmText => ({ id, startS, durationS, text: id, anchor: 'center', size: 1 })
const film: Film = {
  ...DEFAULT_FILM,
  autoStops: false,
  stops: [stop('stop-1', 2000), stop('stop-2', 7000, 2)],
  texts: [text('text-1', 10), text('text-2', 30, 2)],
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

  it('removes a stop or a text; updates clamp to the model ranges', () => {
    expect(removeFilmItem(film, 'stop-1').stops.map((s) => s.id)).toEqual(['stop-2'])
    expect(removeFilmItem(film, 'text-2').texts.map((t) => t.id)).toEqual(['text-1'])
    expect(removeFilmItem(film, 'opening')).toEqual(film)
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
})

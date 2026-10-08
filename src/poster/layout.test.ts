import { describe, expect, it } from 'vitest'
import { LIST_NAME_SHARE, fitLines, fitText, fitTrackList, posterLayout, truncate, wrapText } from './layout'
import type { Box, Measure, PosterLayout, PosterRows } from './layout'
import { POSTER_FORMATS, POSTER_STYLES } from './settings'

/** a glyph is half the font size wide */
const measure: Measure = (text, px) => text.length * px * 0.5

const FULL: PosterRows = { subtitle: true, figures: 5, profile: true, weather: true, tracks: 0 }
const BARE: PosterRows = { subtitle: false, figures: 0, profile: false, weather: false, tracks: 0 }
/** the longest list (a ghost race keeps the weather of the lead) */
const LIST: PosterRows = { subtitle: true, figures: 5, profile: false, weather: true, tracks: 6 }
const ROWS = [
  FULL,
  BARE,
  LIST,
  { subtitle: true, figures: 3, profile: false, weather: true, tracks: 0 },
  { subtitle: false, figures: 1, profile: true, weather: false, tracks: 0 },
  { subtitle: true, figures: 5, profile: false, weather: false, tracks: 3 },
]

const EPS = 1e-6
const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x - EPS && inner.y >= outer.y - EPS && inner.x + inner.w <= outer.x + outer.w + EPS && inner.y + inner.h <= outer.y + outer.h + EPS
const overlap = (a: Box, b: Box) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS

function textBoxes(l: PosterLayout): Box[] {
  return [l.title, l.subtitle, ...l.figures, ...l.tracks, l.profile, l.weather, l.credits].filter((b): b is Box => b !== null)
}

const cases = POSTER_FORMATS.flatMap((f) => POSTER_STYLES.flatMap((style) => ROWS.map((rows) => ({ f, style, rows }))))

describe('posterLayout', () => {
  it.each(cases)('$f.id $style: rows inside the page and its margins, never on each other nor on the view', ({ f, style, rows }) => {
    const l = posterLayout(f.width, f.height, style, rows)
    const page = { x: 0, y: 0, w: f.width, h: f.height }
    const margin = 3 * l.u
    const safe = { x: margin, y: margin, w: f.width - 2 * margin, h: f.height - 2 * margin }
    expect(inside(l.view, page)).toBe(true)
    for (const v of [l.view.x, l.view.y, l.view.w, l.view.h]) expect(Number.isInteger(v)).toBe(true)
    const boxes = textBoxes(l)
    expect(l.figures).toHaveLength(rows.figures)
    expect(l.tracks).toHaveLength(rows.tracks)
    expect(l.subtitle !== null).toBe(rows.subtitle)
    expect(l.profile !== null).toBe(rows.profile)
    expect(l.weather !== null).toBe(rows.weather)
    for (const box of boxes) {
      expect(box.w).toBeGreaterThan(0)
      expect(box.h).toBeGreaterThan(0)
      expect(inside(box, safe)).toBe(true)
      if (l.panel) expect(inside(box, l.panel)).toBe(true)
      // the Application card floats over a full-page view; elsewhere the text is off the view
      if (style !== 'app') expect(overlap(box, l.view)).toBe(false)
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false)
    if (l.panel) expect(inside(l.panel, page)).toBe(true)
    if (l.accentBar && l.panel) expect(inside(l.accentBar, l.panel)).toBe(true)
  })

  it.each(cases)('$f.id $style: the view keeps most of the poster', ({ f, style, rows }) => {
    const l = posterLayout(f.width, f.height, style, rows)
    expect((l.view.w * l.view.h) / (f.width * f.height)).toBeGreaterThan(0.38)
  })

  it('stacks the text under the view in portrait and square, beside it in landscape', () => {
    const portrait = posterLayout(2480, 3508, 'editorial', FULL)
    expect(portrait.side).toBe(false)
    expect(portrait.title.y).toBeGreaterThan(portrait.view.y + portrait.view.h)
    expect(new Set(portrait.figures.map((b) => b.y)).size).toBe(1)
    const landscape = posterLayout(3508, 2480, 'editorial', FULL)
    expect(landscape.side).toBe(true)
    expect(landscape.title.x).toBeGreaterThan(landscape.view.x + landscape.view.w)
    // two figures per row, credits at the foot of the column
    expect(new Set(landscape.figures.map((b) => b.x)).size).toBe(2)
    expect(landscape.credits.y + landscape.credits.h).toBeCloseTo(2480 - 6 * landscape.u, 6)
    expect(posterLayout(2160, 2160, 'broadcast', FULL).side).toBe(false)
  })

  it('lists the tracks in one column, two on a square poster, filled column after column', () => {
    const portrait = posterLayout(2480, 3508, 'editorial', LIST)
    expect(new Set(portrait.tracks.map((b) => b.x)).size).toBe(1)
    expect(new Set(posterLayout(4960, 3508, 'broadcast', LIST).tracks.map((b) => b.x)).size).toBe(1)
    const square = posterLayout(2160, 2160, 'app', LIST).tracks
    expect(new Set(square.map((b) => b.x)).size).toBe(2)
    expect(square[1].y).toBeGreaterThan(square[0].y)
    expect(square[3].x).toBeGreaterThan(square[2].x)
  })

  it('gives more room to the view when there is less text', () => {
    expect(posterLayout(2480, 3508, 'editorial', BARE).view.h).toBeGreaterThan(posterLayout(2480, 3508, 'editorial', FULL).view.h)
  })
})

describe('text fitting', () => {
  it('sets every line of the list at one size, its figures in columns as wide as their widest text', () => {
    const lines = [
      { distance: '12,4 km', ascent: 'D+ 850 m', date: '12/07/2026' },
      { distance: '112,4 km', ascent: '', date: '' },
    ]
    const roomy = fitTrackList(measure, lines, 1000, 20, 10)
    expect(roomy).toMatchObject({ px: 20, distance: 80, ascent: 80, date: 100, gap: 24 })
    expect(roomy.name).toBeCloseTo(1000 - 260 - 3 * 24, 6)
    // narrow: smaller, until the name keeps its share
    const narrow = fitTrackList(measure, lines, 300, 20, 8)
    expect(narrow.px).toBeLessThan(20)
    expect(narrow.name).toBeGreaterThanOrEqual(300 * LIST_NAME_SHARE)
    expect(narrow.name + narrow.distance + narrow.ascent + narrow.date + 3 * narrow.gap).toBeCloseTo(300, 6)
    // no D+ nor date anywhere: no column, no gap for them
    const bare = fitTrackList(measure, [{ distance: '5 km', ascent: '', date: '' }], 200, 20, 10)
    expect(bare).toMatchObject({ ascent: 0, date: 0, name: 200 - 40 - 24 })
    // too narrow even at the smallest size: the name gets what is left
    expect(fitTrackList(measure, lines, 100, 20, 10)).toMatchObject({ px: 10, name: 0 })
  })

  it('keeps the largest size that fits, shrinks a long text, then cuts it with an ellipsis', () => {
    expect(fitText(measure, 'Col', 100, 20, 10)).toEqual({ text: 'Col', px: 20 })
    const shrunk = fitText(measure, 'Tour du Mont-Blanc', 100, 20, 5)
    expect(shrunk.text).toBe('Tour du Mont-Blanc')
    expect(measure(shrunk.text, shrunk.px)).toBeLessThanOrEqual(100)
    expect(shrunk.px).toBeGreaterThan(10)
    const cut = fitText(measure, 'Tour du Mont-Blanc par les cols', 60, 20, 10)
    expect(cut.px).toBe(10)
    expect(cut.text.endsWith('…')).toBe(true)
    expect(measure(cut.text, cut.px)).toBeLessThanOrEqual(60)
    expect(truncate(measure, 'abc', 1, 10)).toBe('')
  })

  it('wraps credits on the allowed lines, smaller if needed, the last one cut when even the smallest size overflows', () => {
    expect(wrapText(measure, 'aa bb cc', 30, 10, 2)).toEqual(['aa bb', 'cc'])
    expect(wrapText(measure, 'aa bb cc', 10, 10, 2)).toBeNull()
    const credits = 'Relief : Mapterhorn · Imagerie : Esri, Maxar · © contributeurs OpenStreetMap (ODbL)'
    const fit = fitLines(measure, credits, 300, 12, 8, 2)
    expect(fit.lines.length).toBeLessThanOrEqual(2)
    for (const line of fit.lines) expect(measure(line, fit.px)).toBeLessThanOrEqual(300)
    const tight = fitLines(measure, credits, 120, 12, 8, 2)
    expect(tight.px).toBe(8)
    expect(tight.lines).toHaveLength(2)
    expect(tight.lines[1].endsWith('…')).toBe(true)
    for (const line of tight.lines) expect(measure(line, tight.px)).toBeLessThanOrEqual(120)
  })
})

import { describe, expect, it } from 'vitest'
import sampleGpx from '../../public/samples/tour-du-mont-blanc-j1.gpx?raw'
import { buildTrackPath } from '../flyover/path'
import { parseGpx } from '../import/gpx'
import { miniMapOutline } from '../overlay/data'
import { OVERLAY_FONTS } from '../overlay/themes'
import { posterContent } from './content'
import { POSTER_FONTS, coverCrop, drawPoster } from './draw'
import type { PosterContext } from './draw'
import { posterRows } from './export'
import { posterLayout } from './layout'
import { DEFAULT_POSTER, POSTER_FORMATS, POSTER_STYLES } from './settings'

/** 2D context stand-in: records texts (with their measured width) and drawn images; a glyph is half the font size wide. */
function fakeContext() {
  const texts: { text: string; x: number; y: number; width: number; align: string }[] = []
  const images: number[][] = []
  let lines = 0
  const state: Record<string, unknown> = { font: '10px sans-serif', textAlign: 'left' }
  const fontPx = () => Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10)
  const target: Record<string, unknown> = {
    measureText: (text: string) => ({ width: text.length * fontPx() * 0.5 }),
    fillText: (text: string, x: number, y: number) => texts.push({ text, x, y, width: text.length * fontPx() * 0.5, align: String(state.textAlign) }),
    drawImage: (_image: unknown, ...args: number[]) => images.push(args),
    lineTo: () => lines++,
    createLinearGradient: () => ({ addColorStop: () => {} }),
  }
  const ctx = new Proxy(target, {
    get: (t, key: string) => (key in t ? t[key] : key in state ? state[key] : () => undefined),
    set: (_t, key: string, value) => {
      state[key] = value
      return true
    },
    has: () => true,
  })
  return { ctx: ctx as unknown as PosterContext, texts, images, lines: () => lines }
}

const track = parseGpx(sampleGpx, 'tour-du-mont-blanc-j1.gpx')[0]
const credits = ['Relief : Mapterhorn', 'Imagerie : Esri, Maxar, Earthstar Geographics', '© contributeurs OpenStreetMap (ODbL)']
const content = posterContent({ tracks: [track], race: false, poster: { ...DEFAULT_POSTER, subtitle: 'Étape 1' }, projectName: 'Tour du Mont-Blanc', climbs: [4], credits })
/** six outings with long names: the most the list holds */
const outings = Array.from({ length: 6 }, (_, i) => ({ ...track, id: `t${i}`, name: `Sortie numéro ${i + 1} par le très long chemin des crêtes`, color: '#C23B22' }))
const several = posterContent({ tracks: outings, race: false, poster: DEFAULT_POSTER, projectName: 'Été', climbs: outings.map(() => 4), credits })

describe('poster drawing', () => {
  it('draws only embedded faces, all loaded with the overlay ones', () => {
    for (const font of POSTER_FONTS) expect(OVERLAY_FONTS).toContain(font)
  })

  it('crops a view to cover its box, centred', () => {
    expect(coverCrop(200, 100, 100, 100)).toEqual({ x: 50, y: 0, w: 100, h: 100 })
    expect(coverCrop(100, 100, 200, 100)).toEqual({ x: 0, y: 25, w: 100, h: 50 })
  })

  it.each(POSTER_FORMATS.flatMap((f) => POSTER_STYLES.map((style) => ({ f, style }))))(
    '$f.id $style: title, figures and credits drawn inside the page, the view in its box',
    ({ f, style }) => {
      const layout = posterLayout(f.width, f.height, style, posterRows(content))
      const { ctx, texts, images } = fakeContext()
      drawPoster(ctx, layout, content, style, { image: {} as CanvasImageSource, width: layout.view.w, height: layout.view.h })
      // some styles draw capitals
      const drawn = texts.map((t) => t.text.toLocaleLowerCase('fr'))
      expect(drawn).toContain('tour du mont-blanc')
      expect(drawn.some((t) => t.startsWith('étape 1 · '))).toBe(true)
      for (const figure of content.figures) expect(drawn).toContain(figure.label.toLocaleLowerCase('fr'))
      expect(drawn.join(' ')).toContain('relief : mapterhorn')
      for (const t of texts) {
        const left = t.align === 'right' ? t.x - t.width : t.x
        expect(left).toBeGreaterThanOrEqual(0)
        expect(left + t.width).toBeLessThanOrEqual(f.width + 1e-6)
      }
      expect(images).toEqual([[0, 0, layout.view.w, layout.view.h, layout.view.x, layout.view.y, layout.view.w, layout.view.h]])
    },
  )

  it.each(POSTER_FORMATS.flatMap((f) => POSTER_STYLES.map((style) => ({ f, style }))))(
    '$f.id $style: every listed track drawn in its row, its name cut before its figures',
    ({ f, style }) => {
      const layout = posterLayout(f.width, f.height, style, posterRows(several))
      const { ctx, texts } = fakeContext()
      drawPoster(ctx, layout, several, style, null)
      expect(layout.tracks).toHaveLength(6)
      layout.tracks.forEach((row, i) => {
        const inRow = texts.filter((t) => {
          const left = t.align === 'right' ? t.x - t.width : t.x
          return t.y >= row.y && t.y <= row.y + row.h && left >= row.x - 1e-6 && left + t.width <= row.x + row.w + 1e-6
        })
        expect(inRow.map((t) => t.text)).toEqual(
          expect.arrayContaining([expect.stringMatching(new RegExp(`^Sortie numéro ${i + 1}`)), several.tracks[i].distance, several.tracks[i].date]),
        )
      })
    },
  )

  it('shows the plan of the track until a view is rendered', () => {
    const layout = posterLayout(2480, 3508, 'editorial', posterRows(content))
    const outline = miniMapOutline(buildTrackPath(track))
    const { ctx, images, lines } = fakeContext()
    drawPoster(ctx, layout, content, 'editorial', null, outline)
    expect(images).toHaveLength(0)
    expect(lines()).toBeGreaterThan(outline?.x.length ?? 0)
  })
})

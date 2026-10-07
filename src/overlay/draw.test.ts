import { describe, expect, it } from 'vitest'
import sampleGpx from '../../public/samples/tour-du-mont-blanc-j1.gpx?raw'
import { parseGpx } from '../import/gpx'
import { overlayFrameAt, prepareOverlayTrack } from './data'
import {
  SAFE_MARGIN,
  cardOpacityAt,
  counterText,
  drawOverlay,
  endCardOpacity,
  formatDateFr,
  formatElapsed,
  layoutWidgets,
  titleCardOpacity,
} from './draw'
import type { OverlayContext2D } from './draw'
import { DEFAULT_OVERLAY, OVERLAY_ANCHORS, OVERLAY_STYLES } from './settings'
import type { OverlaySettings } from './settings'
import { OPEN_METEO_ATTRIBUTION } from '../weather/openMeteo'
import { WEATHER_VARIABLES } from '../weather/series'
import type { WeatherSeries, WeatherVariable } from '../weather/series'

interface TextCall {
  text: string
  x: number
  y: number
  alpha: number
}

interface PointCall {
  op: string
  x: number
  y: number
  /** arc radius */
  r?: number
}

/** 2D context stand-in: records the texts and path points drawn; a glyph is half the font size wide. */
function fakeContext() {
  const texts: TextCall[] = []
  const calls: string[] = []
  const points: PointCall[] = []
  const state = { font: '10px sans-serif', globalAlpha: 1 }
  const stack: (typeof state)[] = []
  const fontPx = () => Number(/(\d+(?:\.\d+)?)px/.exec(state.font)?.[1] ?? 10)
  const target: Record<string, unknown> = {
    save: () => stack.push({ ...state }),
    restore: () => Object.assign(state, stack.pop()),
    measureText: (text: string) => ({ width: text.length * fontPx() * 0.5 }),
    fillText: (text: string, x: number, y: number) => texts.push({ text, x, y, alpha: state.globalAlpha }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    getTransform: () => ({ a: 2, b: 0 }),
  }
  const ctx = new Proxy(target, {
    get: (t, key: string) => {
      if (key in state) return state[key as keyof typeof state]
      if (key in t) return t[key]
      return (...args: unknown[]) => {
        if (key === 'moveTo' || key === 'lineTo') points.push({ op: key, x: args[0] as number, y: args[1] as number })
        if (key === 'arc') points.push({ op: key, x: args[0] as number, y: args[1] as number, r: args[2] as number })
        return calls.push(`${key}(${args.length})`)
      }
    },
    set: (t, key: string, value) => {
      if (key in state) (state as Record<string, unknown>)[key] = value
      else t[key] = value
      return true
    },
    has: () => true,
  })
  return { ctx: ctx as unknown as OverlayContext2D, texts, calls, points }
}

const sampleTrack = parseGpx(sampleGpx, 'tour-du-mont-blanc-j1.gpx')[0]
const track = prepareOverlayTrack(sampleTrack)
const SIZE = { width: 1920, height: 1080 }
const enabled = (patch: Partial<OverlaySettings> = {}): OverlaySettings => ({ ...DEFAULT_OVERLAY, enabled: true, ...patch })

function draw(progress: number, settings: OverlaySettings) {
  const { ctx, texts, calls } = fakeContext()
  drawOverlay(ctx, overlayFrameAt(track, progress), settings, SIZE)
  return { texts, calls, joined: texts.map((t) => t.text).join(' | ') }
}

describe('card timing', () => {
  it('fades the opening card in, holds it, then fades it out before its end', () => {
    expect(titleCardOpacity(0, 0.1)).toBe(0)
    expect(titleCardOpacity(0.005, 0.1)).toBeCloseTo(0.5, 6)
    expect(titleCardOpacity(0.02, 0.1)).toBe(1)
    expect(titleCardOpacity(0.09, 0.1)).toBeGreaterThan(0)
    expect(titleCardOpacity(0.09, 0.1)).toBeLessThan(1)
    expect(titleCardOpacity(0.1, 0.1)).toBe(0)
  })

  it('shows the closing card from its start to the end', () => {
    expect(endCardOpacity(0.9, 0.9)).toBe(0)
    expect(endCardOpacity(0.91, 0.9)).toBeGreaterThan(0)
    expect(endCardOpacity(0.95, 0.9)).toBe(1)
    expect(endCardOpacity(1, 0.9)).toBe(1)
  })

  it('gives the opacity of whichever card is shown, 0 without overlay or cards', () => {
    const settings = enabled()
    expect(cardOpacityAt(0.005, settings)).toBe(titleCardOpacity(0.005, settings.title.end))
    expect(cardOpacityAt(0.5, settings)).toBe(0)
    expect(cardOpacityAt(0.92, settings)).toBe(endCardOpacity(0.92, settings.end.start))
    expect(cardOpacityAt(0.99, settings)).toBe(1)
    expect(cardOpacityAt(0.99, DEFAULT_OVERLAY)).toBe(0)
    expect(cardOpacityAt(0.02, enabled({ title: { ...DEFAULT_OVERLAY.title, enabled: false } }))).toBe(0)
  })
})

describe('formatting', () => {
  it('formats elapsed time and French dates', () => {
    expect(formatElapsed(0)).toBe('0:00:00')
    expect(formatElapsed(3909.7)).toBe('1:05:09')
    expect(formatDateFr(new Date(2025, 6, 12, 9).getTime())).toBe('12 juillet 2025')
    expect(formatDateFr(new Date(2025, 4, 1, 9).getTime())).toBe('1er mai 2025')
  })

  it('splits counters into value and unit, null when not recorded', () => {
    const frame = overlayFrameAt(track, 0.5)
    expect(counterText('distance', frame)).toEqual({ value: expect.stringMatching(/^\d+,\d$/), unit: 'km' })
    expect(counterText('altitude', frame)?.unit).toBe('m')
    expect(counterText('heartRate', frame)?.unit).toBe('bpm')
    expect(counterText('altitude', { ...frame, ele: undefined })).toBeNull()
  })
})

describe('layoutWidgets', () => {
  const size = { width: 1000, height: 500 }
  it('places each anchor inside the safe area', () => {
    const items = [
      { anchor: 'top-left' as const, width: 100, height: 50 },
      { anchor: 'bottom-right' as const, width: 100, height: 50 },
      { anchor: 'center' as const, width: 200, height: 100 },
      { anchor: 'top-center' as const, width: 200, height: 20 },
    ]
    expect(layoutWidgets(items, size, 10)).toEqual([
      { x: 50, y: 25 },
      { x: 850, y: 425 },
      { x: 400, y: 200 },
      { x: 400, y: 25 },
    ])
  })

  it('stacks the widgets sharing an anchor', () => {
    const items = [
      { anchor: 'bottom-left' as const, width: 100, height: 50 },
      { anchor: 'bottom-left' as const, width: 80, height: 30 },
      { anchor: 'middle-right' as const, width: 100, height: 40 },
      { anchor: 'middle-right' as const, width: 60, height: 40 },
    ]
    expect(layoutWidgets(items, size, 10)).toEqual([
      { x: 50, y: 385 },
      { x: 50, y: 445 },
      { x: 850, y: 205 },
      { x: 890, y: 255 },
    ])
  })
})

describe('drawOverlay', () => {
  it('draws nothing while disabled', () => {
    expect(draw(0.5, DEFAULT_OVERLAY).calls).toEqual([])
  })

  it.each(OVERLAY_STYLES)('style %s: title card, then counters and profile, then closing card', (style) => {
    const settings = enabled({ style })
    const opening = draw(0.02, settings)
    expect(opening.joined.toLowerCase()).toContain('12 juillet 2025')
    expect(opening.joined).not.toMatch(/Distance/i)

    const middle = draw(0.5, settings)
    for (const label of ['Distance', 'Altitude', 'D+', 'Temps']) expect(middle.joined.toLowerCase()).toContain(label.toLowerCase())
    expect(middle.joined).not.toContain('Vitesse')
    expect(middle.calls).toContain('arc(5)') // profile marker

    const closing = draw(0.99, settings)
    for (const label of ['Dénivelé +', 'Altitude max', 'Durée', 'Vitesse max']) expect(closing.joined.toLowerCase()).toContain(label.toLowerCase())

    // every text starts inside the safe area
    for (const { x, y } of [...opening.texts, ...middle.texts, ...closing.texts]) {
      expect(x).toBeGreaterThanOrEqual(SIZE.width * SAFE_MARGIN - 1)
      expect(x).toBeLessThanOrEqual(SIZE.width * (1 - SAFE_MARGIN) + 1)
      expect(y).toBeGreaterThanOrEqual(SIZE.height * SAFE_MARGIN - 1)
      expect(y).toBeLessThanOrEqual(SIZE.height * (1 - SAFE_MARGIN) + 1)
    }
  })

  it('uses the custom titles, the chosen counters and the free text', () => {
    const settings = enabled({
      title: { ...DEFAULT_OVERLAY.title, title: 'Ma sortie', subtitle: 'Chamonix', showDate: false },
      counters: { ...DEFAULT_OVERLAY.counters, fields: { ...DEFAULT_OVERLAY.counters.fields, distance: false, heartRate: true } },
      text: { ...DEFAULT_OVERLAY.text, enabled: true, text: 'avec Marie' },
    })
    const opening = draw(0.02, settings).joined
    expect(opening).toContain('Ma sortie')
    expect(opening).toContain('CHAMONIX')
    expect(opening).not.toContain('2025')
    const middle = draw(0.5, settings).joined
    expect(middle).not.toMatch(/Distance/i)
    expect(middle).toMatch(/FC/)
    expect(middle).toContain('bpm')
    expect(middle).toContain('avec Marie')
  })

  it('crossfades the live widgets with the opening card', () => {
    const { texts } = draw(0.09, enabled())
    const counter = texts.find((t) => t.text.toLowerCase() === 'distance')
    expect(counter?.alpha).toBeGreaterThan(0)
    expect(counter?.alpha).toBeLessThan(1)
  })

  it('is deterministic', () => {
    const settings = enabled({ style: 'broadcast' })
    expect(draw(0.5, settings)).toEqual(draw(0.5, settings))
  })

  it('shows the weather under the marker and on the closing card, with its source', () => {
    const hours = 14
    const constant = (v: number) => new Array<number>(hours).fill(v)
    const values = {} as Record<WeatherVariable, number[]>
    for (const v of WEATHER_VARIABLES) values[v] = constant(0)
    Object.assign(values, { temperature: constant(14), weatherCode: constant(1), windSpeed: constant(12), windDirection: constant(315) })
    const series: WeatherSeries = {
      time: Array.from({ length: hours }, (_, h) => Date.UTC(2025, 6, 12, 5) + h * 3_600_000),
      stations: [{ lon: 6.77, lat: 45.86, values }],
    }
    const withWeather = prepareOverlayTrack(sampleTrack, series)
    const settings = enabled({ weather: { ...DEFAULT_OVERLAY.weather, enabled: true } })
    const render = (progress: number, s = settings) => {
      const { ctx, texts } = fakeContext()
      drawOverlay(ctx, overlayFrameAt(withWeather, progress), s, SIZE)
      return texts.map((t) => t.text).join(' | ')
    }
    const middle = render(0.5)
    expect(middle.toLowerCase()).toContain('plutôt dégagé')
    expect(middle).toContain('°C')
    expect(middle.toLowerCase()).toContain('vent no')
    expect(middle).toContain(OPEN_METEO_ATTRIBUTION)
    const closing = render(0.99, enabled())
    expect(closing.toLowerCase()).toContain("plutôt dégagé · 14 °c · vent jusqu'à 12 km/h")
    expect(closing).toContain(OPEN_METEO_ATTRIBUTION)
    // no weather shown, no credit
    expect(render(0.5, enabled())).not.toContain(OPEN_METEO_ATTRIBUTION)
    expect(draw(0.5, settings).joined).not.toContain(OPEN_METEO_ATTRIBUTION)
  })

  it('draws the logo when its image is loaded', () => {
    const settings = enabled({ logo: { ...DEFAULT_OVERLAY.logo, enabled: true, image: 'data:image/png;base64,AAAA' } })
    const { ctx, calls } = fakeContext()
    drawOverlay(ctx, overlayFrameAt(track, 0.5), settings, SIZE, { logo: { image: {} as CanvasImageSource, width: 400, height: 100 } })
    expect(calls).toContain('drawImage(5)')
  })
})

describe('mini-map', () => {
  const off = <T extends { enabled: boolean }>(w: T): T => ({ ...w, enabled: false })
  /** only the mini-map, with the cards still timing the live widgets */
  const minimapOnly = (patch: Partial<OverlaySettings['minimap']> = {}, style: OverlaySettings['style'] = 'broadcast') =>
    enabled({
      style,
      counters: off(DEFAULT_OVERLAY.counters),
      profile: off(DEFAULT_OVERLAY.profile),
      minimap: { ...DEFAULT_OVERLAY.minimap, enabled: true, ...patch },
    })
  const render = (progress: number, settings: OverlaySettings) => {
    const { ctx, texts, points } = fakeContext()
    drawOverlay(ctx, overlayFrameAt(track, progress), settings, SIZE)
    // the scrim of the editorial style is drawn around the origin of a scaled context
    return { texts, points: points.filter((pt) => !(pt.x === 0 && pt.y === 0 && pt.r === 1)) }
  }
  /** arcs of the mini-map: end dot, start dot, marker */
  const dots = (progress: number, settings = minimapOnly()) => render(progress, settings).points.filter((pt) => pt.op === 'arc')

  it('is off by default', () => {
    expect(DEFAULT_OVERLAY.minimap.enabled).toBe(false)
    expect(draw(0.5, enabled()).texts.map((t) => t.text)).not.toContain('N')
  })

  it('puts the marker on the start dot, then on the end dot', () => {
    const noCards = { ...minimapOnly(), title: off(DEFAULT_OVERLAY.title), end: off(DEFAULT_OVERLAY.end) }
    const [end, start, marker] = dots(0, noCards)
    expect(marker.r).toBeGreaterThan(start.r!)
    expect([marker.x, marker.y]).toEqual([start.x, start.y])
    const last = dots(1, noCards)
    expect([last[2].x, last[2].y]).toEqual([end.x, end.y])
    const middle = dots(0.5, noCards)
    expect([middle[0].x, middle[1].x]).toEqual([end.x, start.x])
    expect([middle[2].x, middle[2].y]).not.toEqual([start.x, start.y])
    expect([middle[2].x, middle[2].y]).not.toEqual([end.x, end.y])
  })

  it('keeps the aspect ratio of the track', () => {
    const outline = track.outline!
    // the first point starts the outline of the panel
    const route = render(0.5, minimapOnly({ northArrow: false })).points.filter((pt) => pt.op !== 'arc').slice(1)
    const xs = route.map((pt) => pt.x)
    const ys = route.map((pt) => pt.y)
    const ratio = (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys))
    expect(ratio).toBeCloseTo(outline.width / outline.height, 6)
  })

  it.each(OVERLAY_STYLES)('style %s: stays inside the safe area at every anchor', (style) => {
    for (const anchor of OVERLAY_ANCHORS) {
      for (const size of [1, 2]) {
        const { texts, points } = render(0.5, minimapOnly({ anchor, size }, style))
        expect(texts.map((t) => t.text)).toEqual(['N'])
        for (const pt of [...points, ...texts]) {
          const r = 'r' in pt ? (pt.r ?? 0) : 0
          expect(pt.x - r).toBeGreaterThanOrEqual(SIZE.width * SAFE_MARGIN - 1)
          expect(pt.x + r).toBeLessThanOrEqual(SIZE.width * (1 - SAFE_MARGIN) + 1)
          expect(pt.y - r).toBeGreaterThanOrEqual(SIZE.height * SAFE_MARGIN - 1)
          expect(pt.y + r).toBeLessThanOrEqual(SIZE.height * (1 - SAFE_MARGIN) + 1)
        }
      }
    }
  })

  it('stacks under another widget of the same anchor', () => {
    const alone = render(0.5, minimapOnly({ anchor: 'top-right' }))
    const withProfile = render(0.5, { ...minimapOnly({ anchor: 'top-right' }), profile: { ...DEFAULT_OVERLAY.profile, anchor: 'top-right' } })
    const shift = DEFAULT_OVERLAY.profile.height * SIZE.height + 2 * (Math.min(SIZE.width, SIZE.height) / 100)
    const n = (r: ReturnType<typeof render>) => r.texts.find((t) => t.text === 'N')!
    expect(n(withProfile).y - n(alone).y).toBeCloseTo(shift, 6)
    expect(n(withProfile).x).toBeCloseTo(n(alone).x, 6)
  })

  it('crossfades with the cards like the other live widgets', () => {
    const settings = minimapOnly()
    const n = (progress: number) => render(progress, settings).texts.find((t) => t.text === 'N')
    expect(n(0.02)).toBeUndefined()
    expect(n(0.09)?.alpha).toBeGreaterThan(0)
    expect(n(0.09)?.alpha).toBeLessThan(1)
    expect(n(0.5)?.alpha).toBe(1)
    expect(n(0.99)).toBeUndefined()
  })

  it('draws the north arrow on request only, and is deterministic', () => {
    expect(render(0.5, minimapOnly({ northArrow: false })).texts).toEqual([])
    for (const style of OVERLAY_STYLES) expect(render(0.37, minimapOnly({}, style))).toEqual(render(0.37, minimapOnly({}, style)))
  })
})

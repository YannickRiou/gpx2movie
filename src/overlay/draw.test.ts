import { describe, expect, it } from 'vitest'
import sampleGpx from '../../public/samples/tour-du-mont-blanc-j1.gpx?raw'
import { parseGpx } from '../import/gpx'
import { overlayFrameAt, prepareOverlayTrack } from './data'
import {
  SAFE_MARGIN,
  counterText,
  createOverlayDrawer,
  drawOverlay,
  endCardOpacity,
  formatDateFr,
  formatElapsed,
  layoutWidgets,
  titleCardOpacity,
} from './draw'
import type { OverlayContext2D } from './draw'
import { DEFAULT_OVERLAY, OVERLAY_STYLES } from './settings'
import type { OverlaySettings } from './settings'

interface TextCall {
  text: string
  x: number
  y: number
  alpha: number
}

/** 2D context stand-in: records the texts drawn; a glyph is half the font size wide. */
function fakeContext() {
  const texts: TextCall[] = []
  const calls: string[] = []
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
      return (...args: unknown[]) => calls.push(`${key}(${args.length})`)
    },
    set: (t, key: string, value) => {
      if (key in state) (state as Record<string, unknown>)[key] = value
      else t[key] = value
      return true
    },
    has: () => true,
  })
  return { ctx: ctx as unknown as OverlayContext2D, texts, calls }
}

const track = prepareOverlayTrack(parseGpx(sampleGpx, 'tour-du-mont-blanc-j1.gpx')[0])
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

  it('is deterministic and matches the export adapter', () => {
    const settings = enabled({ style: 'broadcast' })
    const a = draw(0.5, settings)
    const { ctx, texts, calls } = fakeContext()
    createOverlayDrawer(track, settings)(ctx, 0.5, SIZE.width, SIZE.height)
    expect(texts).toEqual(a.texts)
    expect(calls).toEqual(a.calls)
  })

  it('draws the logo when its image is loaded', () => {
    const settings = enabled({ logo: { ...DEFAULT_OVERLAY.logo, enabled: true, image: 'data:image/png;base64,AAAA' } })
    const { ctx, calls } = fakeContext()
    drawOverlay(ctx, overlayFrameAt(track, 0.5), settings, SIZE, { logo: { image: {} as CanvasImageSource, width: 400, height: 100 } })
    expect(calls).toContain('drawImage(5)')
  })
})

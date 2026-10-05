import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HeightGrid } from '../core/types'
import {
  TERRARIUM_NODATA,
  decodeDem,
  decodeDemPixels,
  decodeMapboxPixel,
  decodeTerrariumPixel,
  gridMinMax,
  sampleGrid,
} from './dem'

type Pixel = [r: number, g: number, b: number, a?: number]

function pixels(...px: Pixel[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px.length * 4)
  px.forEach(([r, g, b, a = 255], i) => out.set([r, g, b, a], i * 4))
  return out
}

function grid(width: number, height: number, values: number[]): HeightGrid {
  return { width, height, data: Float32Array.from(values) }
}

describe('pixel formulas', () => {
  it('terrarium: h = R*256 + G + B/256 - 32768', () => {
    expect(decodeTerrariumPixel(128, 0, 0)).toBe(0)
    expect(decodeTerrariumPixel(131, 232, 128)).toBeCloseTo(1000.5, 9)
    expect(decodeTerrariumPixel(127, 156, 0)).toBe(-100)
    expect(decodeTerrariumPixel(0, 0, 0)).toBe(TERRARIUM_NODATA)
  })

  it('mapbox: h = -10000 + (R*65536 + G*256 + B)*0.1', () => {
    expect(decodeMapboxPixel(1, 134, 160)).toBeCloseTo(0, 9)
    expect(decodeMapboxPixel(1, 182, 217)).toBeCloseTo(1234.5, 9)
    expect(decodeMapboxPixel(0, 0, 0)).toBeCloseTo(-10000, 9)
  })
})

describe('decodeDemPixels', () => {
  it('decodes terrarium pixels, with alpha 0 and the sentinel as NaN', () => {
    const g = decodeDemPixels(pixels([128, 0, 0], [131, 232, 128], [0, 0, 0], [200, 10, 10, 0]), 2, 2, 'terrarium')
    expect(g.width).toBe(2)
    expect(g.height).toBe(2)
    expect(g.data).toBeInstanceOf(Float32Array)
    expect(g.data[0]).toBe(0)
    expect(g.data[1]).toBeCloseTo(1000.5, 5)
    expect(g.data[2]).toBeNaN()
    expect(g.data[3]).toBeNaN()
  })

  it('decodes mapbox pixels, with alpha 0 as NaN', () => {
    const g = decodeDemPixels(pixels([1, 134, 160], [1, 182, 217], [0, 0, 0], [1, 134, 160, 0]), 4, 1, 'mapbox')
    expect(g.data[0]).toBeCloseTo(0, 4)
    expect(g.data[1]).toBeCloseTo(1234.5, 4)
    expect(g.data[2]).toBeCloseTo(-10000, 4)
    expect(g.data[3]).toBeNaN()
  })

  it('keeps row-major order (row 0 first)', () => {
    const g = decodeDemPixels(pixels([128, 1, 0], [128, 2, 0], [128, 3, 0], [128, 4, 0]), 2, 2, 'terrarium')
    expect(Array.from(g.data)).toEqual([1, 2, 3, 4])
  })

  it('rejects a buffer that is too small', () => {
    expect(() => decodeDemPixels(new Uint8ClampedArray(8), 2, 2, 'terrarium')).toThrow(RangeError)
  })
})

describe('decodeDem (canvas read-back)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('draws the bitmap into an OffscreenCanvas and decodes the pixels', () => {
    const ctx = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: pixels([128, 0, 0], [128, 10, 0], [128, 20, 0], [128, 30, 0]) })),
    }
    const created: Array<{ w: number; h: number; opts: unknown }> = []
    class FakeOffscreenCanvas {
      width: number
      height: number
      constructor(w: number, h: number) {
        this.width = w
        this.height = h
        created.push({ w, h, opts: undefined })
      }
      getContext(_type: string, opts: unknown) {
        created[created.length - 1].opts = opts
        return ctx
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)

    const bitmap = { width: 2, height: 2, close() {} } as unknown as ImageBitmap
    const g = decodeDem(bitmap, 'terrarium')

    expect(Array.from(g.data)).toEqual([0, 10, 20, 30])
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 2, 2)
    expect(ctx.getImageData).toHaveBeenCalledWith(0, 0, 2, 2)
    expect(created[0].opts).toEqual({ willReadFrequently: true })
  })
})

describe('sampleGrid', () => {
  // 2x2 grid: a b / c d
  const g2 = grid(2, 2, [10, 20, 30, 40])

  it('returns the corner values at the corners', () => {
    expect(sampleGrid(g2, 0, 0)).toBe(10)
    expect(sampleGrid(g2, 1, 0)).toBe(20)
    expect(sampleGrid(g2, 0, 1)).toBe(30)
    expect(sampleGrid(g2, 1, 1)).toBe(40)
  })

  it('interpolates bilinearly at the centre and along edges', () => {
    expect(sampleGrid(g2, 0.5, 0.5)).toBeCloseTo(25, 9)
    expect(sampleGrid(g2, 0.5, 0)).toBeCloseTo(15, 9)
    expect(sampleGrid(g2, 0, 0.5)).toBeCloseTo(20, 9)
  })

  it('clamps coordinates outside [0, 1]', () => {
    expect(sampleGrid(g2, -1, -1)).toBe(10)
    expect(sampleGrid(g2, 2, 2)).toBe(40)
  })

  it('uses pixel centres (pixel-is-area)', () => {
    const g3 = grid(3, 3, [0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(sampleGrid(g3, 0.5, 0.5)).toBe(4)
    // u = 0.5 / 3 is exactly the centre of column 0, v centre of row 1
    expect(sampleGrid(g3, 0.5 / 3, 0.5)).toBe(3)
    expect(sampleGrid(g3, 1.5 / 3, 2.5 / 3)).toBe(7)
  })

  it('works on a 1x1 grid', () => {
    expect(sampleGrid(grid(1, 1, [42]), 0.3, 0.9)).toBe(42)
  })

  it('ignores NaN neighbours', () => {
    const g = grid(2, 2, [NaN, 20, 30, 40])
    expect(sampleGrid(g, 0.5, 0.5)).toBeCloseTo(30, 9) // mean of the three valid, equal weights
    expect(sampleGrid(g, 1, 1)).toBe(40)
  })

  it('falls back to the mean of valid neighbours when sitting exactly on a nodata pixel', () => {
    const g = grid(2, 2, [NaN, 20, 30, 40])
    expect(sampleGrid(g, 0, 0)).toBeCloseTo(30, 9)
  })

  it('returns NaN only when all four neighbours are NaN', () => {
    expect(sampleGrid(grid(2, 2, [NaN, NaN, NaN, NaN]), 0.5, 0.5)).toBeNaN()
    expect(sampleGrid(grid(3, 3, [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, 5]), 0, 0)).toBeNaN()
    expect(sampleGrid(grid(3, 3, [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, 5]), 1, 1)).toBe(5)
  })

  it('returns NaN for an empty grid', () => {
    expect(sampleGrid(grid(0, 0, []), 0.5, 0.5)).toBeNaN()
  })
})

describe('gridMinMax', () => {
  it('ignores NaN', () => {
    expect(gridMinMax(grid(2, 2, [NaN, 5, -3, 10]))).toEqual({ min: -3, max: 10 })
  })

  it('returns NaN/NaN for a grid without data', () => {
    const r = gridMinMax(grid(1, 2, [NaN, NaN]))
    expect(r.min).toBeNaN()
    expect(r.max).toBeNaN()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasTexture, ClampToEdgeWrapping, LinearMipmapLinearFilter, SRGBColorSpace } from 'three'
import type { ImagerySource, TileFetcher, TileKey } from '../core/types'
import { lonLatToTileFrac } from '../geo/mercator'
import { IMAGERY_FALLBACK_COLOR, loadImageryTexture, planImagerySubtiles } from './imagery'
import { buildTileUrl } from './sources'

function source(overrides: Partial<ImagerySource> = {}): ImagerySource {
  return {
    kind: 'imagery',
    id: 'test',
    name: 'Test',
    urlTemplate: 'https://tiles.test/{z}/{x}/{y}.jpg',
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    attribution: 'test',
    ...overrides,
  }
}

const KEY: TileKey = { z: 10, x: 530, y: 370 }

describe('planImagerySubtiles', () => {
  it('k = 0: one tile at the same zoom', () => {
    const plan = planImagerySubtiles(KEY, source(), 0)
    expect(plan.canvasSize).toBe(256)
    expect(plan.tiles).toEqual([{ key: KEY, dx: 0, dy: 0, dw: 256, dh: 256, sx: 0, sy: 0, sw: 256, sh: 256 }])
  })

  it('k = 1: the 4 children drawn in a 512 px canvas', () => {
    const plan = planImagerySubtiles(KEY, source(), 1)
    expect(plan.canvasSize).toBe(512)
    expect(plan.tiles).toEqual([
      { key: { z: 11, x: 1060, y: 740 }, dx: 0, dy: 0, dw: 256, dh: 256, sx: 0, sy: 0, sw: 256, sh: 256 },
      { key: { z: 11, x: 1061, y: 740 }, dx: 256, dy: 0, dw: 256, dh: 256, sx: 0, sy: 0, sw: 256, sh: 256 },
      { key: { z: 11, x: 1060, y: 741 }, dx: 0, dy: 256, dw: 256, dh: 256, sx: 0, sy: 0, sw: 256, sh: 256 },
      { key: { z: 11, x: 1061, y: 741 }, dx: 256, dy: 256, dw: 256, dh: 256, sx: 0, sy: 0, sw: 256, sh: 256 },
    ])
  })

  it('k = 2: 16 grandchildren in a 1024 px canvas', () => {
    const plan = planImagerySubtiles(KEY, source(), 2)
    expect(plan.canvasSize).toBe(1024)
    expect(plan.tiles).toHaveLength(16)
    const xs = new Set(plan.tiles.map((t) => t.key.x))
    const ys = new Set(plan.tiles.map((t) => t.key.y))
    expect([...xs].sort()).toEqual([2120, 2121, 2122, 2123])
    expect([...ys].sort()).toEqual([1480, 1481, 1482, 1483])
    for (const t of plan.tiles) {
      expect(t.key.z).toBe(12)
      expect([t.dw, t.dh, t.sw, t.sh]).toEqual([256, 256, 256, 256])
      expect(t.dx).toBe((t.key.x - 2120) * 256)
      expect(t.dy).toBe((t.key.y - 1480) * 256)
      expect([t.sx, t.sy]).toEqual([0, 0])
    }
  })

  it('respects the 512 px tile size of a source', () => {
    const plan = planImagerySubtiles(KEY, source({ tileSize: 512 }), 1)
    expect(plan.canvasSize).toBe(1024)
    expect(plan.tiles[3]).toEqual({
      key: { z: 11, x: 1061, y: 741 },
      dx: 512,
      dy: 512,
      dw: 512,
      dh: 512,
      sx: 0,
      sy: 0,
      sw: 512,
      sh: 512,
    })
  })

  it('beyond maxZoom (one level): uses the deepest tiles, scaled up', () => {
    const plan = planImagerySubtiles(KEY, source({ maxZoom: 11 }), 2)
    expect(plan.canvasSize).toBe(1024)
    expect(plan.tiles).toHaveLength(4)
    expect(plan.tiles[0]).toEqual({
      key: { z: 11, x: 1060, y: 740 },
      dx: 0,
      dy: 0,
      dw: 512,
      dh: 512,
      sx: 0,
      sy: 0,
      sw: 256,
      sh: 256,
    })
    expect(plan.tiles[3]).toMatchObject({ key: { z: 11, x: 1061, y: 741 }, dx: 512, dy: 512, dw: 512, dh: 512 })
  })

  it('beyond maxZoom (coarser than the terrain tile): crops the ancestor tile', () => {
    // maxZoom 9 < z 10: the NW quarter of tile 9/265/185 covers 10/530/370.
    const nw = planImagerySubtiles(KEY, source({ maxZoom: 9 }), 1)
    expect(nw.canvasSize).toBe(512)
    expect(nw.tiles).toEqual([
      { key: { z: 9, x: 265, y: 185 }, dx: 0, dy: 0, dw: 512, dh: 512, sx: 0, sy: 0, sw: 128, sh: 128 },
    ])

    // SE quarter for 10/531/371.
    const se = planImagerySubtiles({ z: 10, x: 531, y: 371 }, source({ maxZoom: 9 }), 1)
    expect(se.tiles).toEqual([
      { key: { z: 9, x: 265, y: 185 }, dx: 0, dy: 0, dw: 512, dh: 512, sx: 128, sy: 128, sw: 128, sh: 128 },
    ])

    // Two levels up (maxZoom 8): 1/16th of tile 8/132/92.
    const far = planImagerySubtiles({ z: 10, x: 531, y: 371 }, source({ maxZoom: 8 }), 0)
    expect(far.canvasSize).toBe(256)
    expect(far.tiles).toEqual([
      { key: { z: 8, x: 132, y: 92 }, dx: 0, dy: 0, dw: 256, dh: 256, sx: 192, sy: 192, sw: 64, sh: 64 },
    ])
  })

  it('skips sub-tiles outside the source coverage', () => {
    const france = { west: -5.6, south: 41.2, east: 10.0, north: 51.3 }
    // Terrain tile 10/540/y straddles lon 10.0: at z 11, column 1080 overlaps France, column 1081 does not.
    const f = lonLatToTileFrac(9.9, 46, 10)
    const key = { z: 10, x: Math.floor(f.x), y: Math.floor(f.y) }
    expect(key.x).toBe(540)
    const plan = planImagerySubtiles(key, source({ coverage: france }), 1)
    expect(plan.tiles).toHaveLength(2)
    expect(plan.tiles.every((t) => t.key.x === 1080)).toBe(true)

    // Entirely outside: nothing to draw.
    const australia = lonLatToTileFrac(133, -25, 10)
    const outside = planImagerySubtiles({ z: 10, x: Math.floor(australia.x), y: Math.floor(australia.y) }, source({ coverage: france }), 1)
    expect(outside.tiles).toEqual([])
    expect(outside.canvasSize).toBe(512)
  })

  it('returns no tiles when the effective zoom is below minZoom', () => {
    const plan = planImagerySubtiles(KEY, source({ minZoom: 12 }), 1)
    expect(plan.tiles).toEqual([])
  })

  it('clamps the zoom offset to a sane integer range', () => {
    expect(planImagerySubtiles(KEY, source(), -3).tiles).toHaveLength(1)
    expect(planImagerySubtiles(KEY, source(), 1.9).tiles).toHaveLength(4)
    expect(planImagerySubtiles(KEY, source(), 99).canvasSize).toBe(256 * 16)
  })
})

// ---------------------------------------------------------------------------
// loadImageryTexture
// ---------------------------------------------------------------------------

class FakeContext {
  fillStyle = ''
  imageSmoothingEnabled = false
  imageSmoothingQuality = 'low'
  fillRect = vi.fn()
  drawImage = vi.fn()
}

class FakeOffscreenCanvas {
  width: number
  height: number
  ctx = new FakeContext()
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }
  getContext() {
    return this.ctx
  }
}

interface FetchCall {
  url: string
  priority: number | undefined
  signal: AbortSignal | undefined
}

function fakeFetcher(answer: (url: string) => Promise<ImageBitmap>): TileFetcher & { calls: FetchCall[] } {
  const calls: FetchCall[] = []
  return {
    calls,
    fetchBitmap(url, options = {}) {
      calls.push({ url, priority: options.priority, signal: options.signal })
      if (options.signal?.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
      return new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        answer(url).then(resolve, reject)
      })
    },
    stats: { inflight: 0, queued: 0, cached: 0, failed: 0 },
    clear() {},
  }
}

function bitmapFor(url: string): ImageBitmap {
  return { width: 256, height: 256, url, close() {} } as unknown as ImageBitmap
}

describe('loadImageryTexture', () => {
  beforeEach(() => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('composites every sub-tile and returns an sRGB mipmapped CanvasTexture', async () => {
    const src = source()
    const fetcher = fakeFetcher((url) => Promise.resolve(bitmapFor(url)))
    const texture = await loadImageryTexture(KEY, src, fetcher, { zoomOffset: 1, priority: 7 })

    const plan = planImagerySubtiles(KEY, src, 1)
    expect(fetcher.calls.map((c) => c.url)).toEqual(plan.tiles.map((t) => buildTileUrl(src, t.key)))
    expect(fetcher.calls.every((c) => c.priority === 7)).toBe(true)

    const canvas = texture.image as FakeOffscreenCanvas
    expect(canvas).toBeInstanceOf(FakeOffscreenCanvas)
    expect(canvas.width).toBe(512)
    expect(canvas.ctx.fillStyle).toBe(IMAGERY_FALLBACK_COLOR)
    expect(canvas.ctx.fillRect).toHaveBeenCalledWith(0, 0, 512, 512)
    expect(canvas.ctx.drawImage).toHaveBeenCalledTimes(4)
    plan.tiles.forEach((t, i) => {
      const args = canvas.ctx.drawImage.mock.calls[i]
      expect((args[0] as { url: string }).url).toBe(buildTileUrl(src, t.key))
      expect(args.slice(1)).toEqual([t.sx, t.sy, t.sw, t.sh, t.dx, t.dy, t.dw, t.dh])
    })

    expect(texture).toBeInstanceOf(CanvasTexture)
    expect(texture.colorSpace).toBe(SRGBColorSpace)
    expect(texture.generateMipmaps).toBe(true)
    expect(texture.minFilter).toBe(LinearMipmapLinearFilter)
    expect(texture.anisotropy).toBe(16)
    expect(texture.flipY).toBe(true)
    expect(texture.wrapS).toBe(ClampToEdgeWrapping)
    expect(texture.version).toBeGreaterThan(0) // needsUpdate was set (write-only setter bumping version)
  })

  it('leaves the gaps transparent and premultiplies the texels for dated imagery blended over the current one', async () => {
    const fetcher = fakeFetcher((url) => Promise.resolve(bitmapFor(url)))
    const texture = await loadImageryTexture(KEY, source(), fetcher, { zoomOffset: 1, transparent: true })
    const canvas = texture.image as FakeOffscreenCanvas
    expect(canvas.ctx.fillRect).not.toHaveBeenCalled()
    expect(canvas.ctx.drawImage).toHaveBeenCalledTimes(4)
    expect(texture.premultiplyAlpha).toBe(true)
    const opaque = await loadImageryTexture(KEY, source(), fetcher, { zoomOffset: 1 })
    expect(opaque.premultiplyAlpha).toBe(false)
  })

  it('leaves failed sub-tiles grey without rejecting', async () => {
    const src = source()
    const fetcher = fakeFetcher((url) =>
      url.endsWith('/1061/741.jpg') ? Promise.reject(new Error('HTTP 404')) : Promise.resolve(bitmapFor(url)),
    )
    const texture = await loadImageryTexture(KEY, src, fetcher, { zoomOffset: 1 })
    const canvas = texture.image as FakeOffscreenCanvas
    expect(canvas.ctx.drawImage).toHaveBeenCalledTimes(3)
  })

  it('leaves the area grey when drawing a (closed) bitmap throws', async () => {
    const src = source()
    const fetcher = fakeFetcher((url) => Promise.resolve(bitmapFor(url)))
    const texture = await loadImageryTexture(KEY, src, fetcher, { zoomOffset: 0 })
    expect((texture.image as FakeOffscreenCanvas).ctx.drawImage).toHaveBeenCalledTimes(1)

    // Now make drawImage throw once among four sub-tiles: still resolves.
    class ThrowingCanvas extends FakeOffscreenCanvas {
      constructor(w: number, h: number) {
        super(w, h)
        this.ctx.drawImage.mockImplementationOnce(() => {
          throw new DOMException('detached', 'InvalidStateError')
        })
      }
    }
    vi.stubGlobal('OffscreenCanvas', ThrowingCanvas)
    const texture2 = await loadImageryTexture(KEY, src, fetcher, { zoomOffset: 1 })
    expect((texture2.image as FakeOffscreenCanvas).ctx.drawImage).toHaveBeenCalledTimes(4)
  })

  it('rejects when every sub-tile fails', async () => {
    const fetcher = fakeFetcher(() => Promise.reject(new Error('HTTP 404')))
    await expect(loadImageryTexture(KEY, source(), fetcher, { zoomOffset: 1 })).rejects.toThrow(/10\/530\/370/)
  })

  it('rejects with AbortError when the signal is aborted', async () => {
    const controller = new AbortController()
    const fetcher = fakeFetcher(() => new Promise(() => {})) // never settles unless aborted
    const promise = loadImageryTexture(KEY, source(), fetcher, { zoomOffset: 1, signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })

    // Already aborted: no fetch at all.
    const fetcher2 = fakeFetcher((url) => Promise.resolve(bitmapFor(url)))
    await expect(
      loadImageryTexture(KEY, source(), fetcher2, { zoomOffset: 1, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher2.calls).toHaveLength(0)
  })

  it('rejects with AbortError when the fetcher cancelled every sub-tile (e.g. fetcher.clear())', async () => {
    const fetcher = fakeFetcher(() => Promise.reject(new DOMException('cleared', 'AbortError')))
    await expect(loadImageryTexture(KEY, source(), fetcher, { zoomOffset: 1 })).rejects.toMatchObject({
      name: 'AbortError',
    })
  })

  it('scales the source rectangle when the server returns a tile size other than the catalogue one', async () => {
    // Cropping case (maxZoom 9 < z 10): the plan reads the 128 px NW quarter of a 256 px tile...
    const src = source({ maxZoom: 9 })
    const fetcher = fakeFetcher((url) => Promise.resolve({ width: 512, height: 512, url, close() {} } as unknown as ImageBitmap))
    const texture = await loadImageryTexture(KEY, src, fetcher, { zoomOffset: 1 })
    const args = (texture.image as FakeOffscreenCanvas).ctx.drawImage.mock.calls[0]
    // ...which is the 256 px NW quarter of the 512 px bitmap actually received.
    expect(args.slice(1)).toEqual([0, 0, 256, 256, 0, 0, 512, 512])
  })

  it('returns a plain grey texture when the tile is outside the coverage', async () => {
    const fetcher = fakeFetcher((url) => Promise.resolve(bitmapFor(url)))
    const australia = lonLatToTileFrac(133, -25, 10)
    const key = { z: 10, x: Math.floor(australia.x), y: Math.floor(australia.y) }
    const src = source({ coverage: { west: -5.6, south: 41.2, east: 10.0, north: 51.3 } })
    const texture = await loadImageryTexture(key, src, fetcher, { zoomOffset: 1 })
    expect(fetcher.calls).toHaveLength(0)
    const canvas = texture.image as FakeOffscreenCanvas
    expect(canvas.ctx.fillRect).toHaveBeenCalledWith(0, 0, 512, 512)
    expect(canvas.ctx.drawImage).not.toHaveBeenCalled()
  })

  it('falls back to a DOM canvas when OffscreenCanvas is unavailable', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined)
    const ctx = new FakeContext()
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    try {
      const fetcher = fakeFetcher((url) => Promise.resolve(bitmapFor(url)))
      const texture = await loadImageryTexture(KEY, source(), fetcher, { zoomOffset: 0 })
      expect(texture.image).toBeInstanceOf(HTMLCanvasElement)
      expect((texture.image as HTMLCanvasElement).width).toBe(256)
      expect(ctx.drawImage).toHaveBeenCalledTimes(1)
    } finally {
      getContext.mockRestore()
    }
  })
})

/**
 * Elevation tile decoding (Terrarium / Mapbox Terrain-RGB) and bilinear sampling of height grids.
 *
 * Encodings
 * ---------
 *   terrarium : h = R * 256 + G + B / 256 - 32768             (resolution 1/256 m)
 *   mapbox    : h = -10000 + (R * 65536 + G * 256 + B) * 0.1  (resolution 0.1 m)
 * Pixels with alpha 0, and the Terrarium (0, 0, 0) sentinel (-32768 m), decode to NaN (nodata).
 *
 * Grids are row-major with row 0 at the north edge (see `HeightGrid` in core/types).
 */
import { clamp } from '../core/math'
import type { DemEncoding, HeightGrid } from '../core/types'

/** Height encoded by a Terrarium (0, 0, 0) pixel; several providers use it as a nodata sentinel. */
const TERRARIUM_NODATA = -32768

/**
 * Decode raw RGBA pixels (as returned by `getImageData`) into a height grid. Pure and synchronous.
 * `rgba` must hold at least `width * height * 4` bytes.
 */
export function decodeDemPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  encoding: DemEncoding,
): HeightGrid {
  const count = width * height
  if (rgba.length < count * 4) {
    throw new RangeError(`decodeDemPixels: expected ${count * 4} bytes for ${width}x${height}, got ${rgba.length}`)
  }
  const data = new Float32Array(count)
  if (encoding === 'terrarium') {
    for (let i = 0, p = 0; i < count; i++, p += 4) {
      if (rgba[p + 3] === 0) {
        data[i] = NaN
        continue
      }
      const h = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768
      data[i] = h === TERRARIUM_NODATA ? NaN : h
    }
  } else if (encoding === 'mapbox') {
    for (let i = 0, p = 0; i < count; i++, p += 4) {
      data[i] = rgba[p + 3] === 0 ? NaN : -10000 + (rgba[p] * 65536 + rgba[p + 1] * 256 + rgba[p + 2]) * 0.1
    }
  } else {
    throw new Error(`Unknown DEM encoding: ${String(encoding)}`)
  }
  return { width, height, data }
}

// ---------------------------------------------------------------------------
// Pixel read-back through a (shared) 2D canvas
// ---------------------------------------------------------------------------

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

interface ScratchCanvas {
  canvas: OffscreenCanvas | HTMLCanvasElement
  ctx: Canvas2D
}

let scratch: ScratchCanvas | undefined

export function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** One module-level scratch canvas, grown on demand: decoding is synchronous so sharing is safe. */
function acquireContext(width: number, height: number): Canvas2D {
  if (!scratch || scratch.canvas.width < width || scratch.canvas.height < height) {
    const canvas = createCanvas(
      Math.max(width, scratch?.canvas.width ?? 0),
      Math.max(height, scratch?.canvas.height ?? 0),
    )
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Canvas2D | null
    if (!ctx) throw new Error('2D canvas context unavailable: cannot decode elevation tiles.')
    scratch = { canvas, ctx }
  }
  return scratch.ctx
}

/** Draw an image into the scratch canvas and read its RGBA pixels back (bit-exact for opaque pixels). */
export function readImagePixels(image: CanvasImageSource, width: number, height: number): Uint8ClampedArray {
  const ctx = acquireContext(width, height)
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height).data
}

/** Decode a bitmap elevation tile into a height grid (NaN = nodata). */
export function decodeDem(bitmap: ImageBitmap, encoding: DemEncoding): HeightGrid {
  const { width, height } = bitmap
  return decodeDemPixels(readImagePixels(bitmap, width, height), width, height, encoding)
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/**
 * Bilinear sample at (u, v) in [0, 1] (u east, v south, v = 0 at the north row), clamped to the grid.
 * Pixel-is-area convention: pixel i spans [i / size, (i + 1) / size] and holds the value at its centre.
 * NaN neighbours are ignored; NaN is returned only when all four neighbours are nodata.
 */
export function sampleGrid(grid: HeightGrid, u: number, v: number): number {
  const { width, height, data } = grid
  if (width === 0 || height === 0) return NaN

  const fx = clamp(u * width - 0.5, 0, width - 1)
  const fy = clamp(v * height - 0.5, 0, height - 1)
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const x1 = x0 + 1 < width ? x0 + 1 : x0
  const y1 = y0 + 1 < height ? y0 + 1 : y0
  const tx = fx - x0
  const ty = fy - y0

  const h00 = data[y0 * width + x0]
  const h10 = data[y0 * width + x1]
  const h01 = data[y1 * width + x0]
  const h11 = data[y1 * width + x1]
  const w00 = (1 - tx) * (1 - ty)
  const w10 = tx * (1 - ty)
  const w01 = (1 - tx) * ty
  const w11 = tx * ty

  // Fast path: no nodata around (NaN !== NaN).
  if (h00 === h00 && h10 === h10 && h01 === h01 && h11 === h11) {
    return h00 * w00 + h10 * w10 + h01 * w01 + h11 * w11
  }

  let weighted = 0
  let weightSum = 0
  let plain = 0
  let valid = 0
  if (h00 === h00) {
    weighted += h00 * w00
    weightSum += w00
    plain += h00
    valid++
  }
  if (h10 === h10) {
    weighted += h10 * w10
    weightSum += w10
    plain += h10
    valid++
  }
  if (h01 === h01) {
    weighted += h01 * w01
    weightSum += w01
    plain += h01
    valid++
  }
  if (h11 === h11) {
    weighted += h11 * w11
    weightSum += w11
    plain += h11
    valid++
  }
  if (valid === 0) return NaN
  // Sitting exactly on a nodata pixel: the valid neighbours carry no weight, fall back to their mean.
  return weightSum > 1e-9 ? weighted / weightSum : plain / valid
}

/**
 * GPU and memory budget of the device, read once at start-up where the limits live (canvas pixel ratio, tile caches,
 * imagery texture size, preview clouds, export resolution). Phones and tablets (touch screen as the main pointer) get
 * lower limits; computers keep the values they always had. iOS gives no per-tab WebGL budget and reloads a page that
 * holds too many textures (WebKit bug 300782): the mobile values are conservative. See ARCHITECTURE.md "Device budget".
 */

export type DeviceKind = 'desktop' | 'tablet' | 'phone'

export interface DeviceBudget {
  kind: DeviceKind
  /** pixel ratio cap of the 3D view */
  maxPixelRatio: number
  /** same while the film plays */
  movingPixelRatio: number
  /** decoded tile bitmaps kept by the fetcher (256 px: ~256 KB each) */
  tileBitmaps: number
  /** height grids kept by the terrain engine, in 256 px tiles (~256 KB each) */
  heightGrids: number
  /** finest imagery (`imageryZoomOffset`: texture of 256 × 2^k px per terrain tile) */
  maxImageryZoomOffset: 0 | 1 | 2
  /** still frames the preview clouds average */
  cloudSettleFrames: number
  /** resolution of the preview cloud pass (fraction of the canvas) */
  cloudResolutionScale: number
  /** default rendering of the sea of clouds: « Nappe » ('surface', one draw call) is far cheaper than the ray march */
  seaRender: 'volume' | 'surface'
  /** largest short side of an exported film or still, px */
  maxExportShortSide: number
}

export const DESKTOP_BUDGET: Readonly<DeviceBudget> = {
  kind: 'desktop',
  maxPixelRatio: 2,
  movingPixelRatio: 2,
  tileBitmaps: 600,
  heightGrids: 400,
  maxImageryZoomOffset: 2,
  cloudSettleFrames: 32,
  cloudResolutionScale: 1,
  seaRender: 'volume',
  maxExportShortSide: 2160,
}

const MOBILE_BUDGET: Omit<DeviceBudget, 'kind' | 'maxExportShortSide'> = {
  maxPixelRatio: 2,
  movingPixelRatio: 1.5,
  tileBitmaps: 200,
  heightGrids: 160,
  maxImageryZoomOffset: 1,
  cloudSettleFrames: 16,
  cloudResolutionScale: 0.5,
  seaRender: 'surface',
}

/** Below this short side (CSS px), a touch device is a phone. */
export const PHONE_MAX_SHORT_SIDE = 600
/** `navigator.deviceMemory` (GB, Chrome only, rounded down) at or below which the limits drop further */
export const LOW_MEMORY_GB = 2

export interface DeviceTraits {
  /** touch screen as the main pointer */
  coarsePointer: boolean
  /** short side of the screen, CSS px */
  shortSidePx: number
  /** `navigator.deviceMemory`, undefined where the browser does not tell (Safari, Firefox) */
  memoryGb?: number
}

export function budgetFor({ coarsePointer, shortSidePx, memoryGb }: DeviceTraits): DeviceBudget {
  if (!coarsePointer) return { ...DESKTOP_BUDGET }
  const phone = shortSidePx < PHONE_MAX_SHORT_SIDE
  const budget: DeviceBudget = { ...MOBILE_BUDGET, kind: phone ? 'phone' : 'tablet', maxExportShortSide: phone ? 1080 : 1440 }
  if (memoryGb !== undefined && memoryGb <= LOW_MEMORY_GB) {
    return { ...budget, maxPixelRatio: 1.5, movingPixelRatio: 1, tileBitmaps: 120, heightGrids: 100 }
  }
  return budget
}

/** Traits of the device running `scope` (window); a scope without a screen (tests, workers) reads as a computer. */
export function readDeviceTraits(scope: object): DeviceTraits {
  const s = scope as {
    matchMedia?: (query: string) => MediaQueryList
    screen?: { width: number; height: number }
    navigator?: { deviceMemory?: number }
  }
  return {
    coarsePointer: typeof s.matchMedia === 'function' && s.matchMedia.call(scope, '(pointer: coarse)').matches,
    shortSidePx: s.screen ? Math.min(s.screen.width, s.screen.height) : Infinity,
    memoryGb: s.navigator?.deviceMemory,
  }
}

let current: DeviceBudget | null = null

/** Budget of this device (read once). */
export function deviceBudget(): DeviceBudget {
  current ??= budgetFor(readDeviceTraits(globalThis))
  return current
}

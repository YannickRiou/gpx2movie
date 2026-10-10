import { describe, expect, it } from 'vitest'
import { exportResolutionNote, videoSize } from '../export/schedule'
import { CLOUD_SETTLE_FRAMES } from '../scene/renderOnDemand'
import { DEFAULT_TUNING } from '../terrain/engine'
import { DEFAULT_CLOUDS } from '../weather/sceneClouds'
import { DESKTOP_BUDGET, budgetFor, deviceBudget, readDeviceTraits } from './deviceBudget'

const scope = (coarse: boolean, width: number, height: number, deviceMemory?: number) => ({
  matchMedia: (query: string) => ({ matches: coarse && query === '(pointer: coarse)' }),
  screen: { width, height },
  navigator: { deviceMemory },
})

describe('budgetFor', () => {
  it('keeps the values a computer always had', () => {
    expect(budgetFor({ coarsePointer: false, shortSidePx: 1080 })).toEqual({
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
    })
    // a laptop with little memory is still a computer
    expect(budgetFor({ coarsePointer: false, shortSidePx: 768, memoryGb: 2 })).toEqual(DESKTOP_BUDGET)
  })

  it('lowers the limits of a phone', () => {
    expect(budgetFor({ coarsePointer: true, shortSidePx: 393, memoryGb: 8 })).toEqual({
      kind: 'phone',
      maxPixelRatio: 2,
      movingPixelRatio: 1.5,
      tileBitmaps: 200,
      heightGrids: 160,
      maxImageryZoomOffset: 1,
      cloudSettleFrames: 16,
      cloudResolutionScale: 0.5,
      seaRender: 'surface',
      maxExportShortSide: 1080,
    })
  })

  it('a tablet exports up to 1440p', () => {
    expect(budgetFor({ coarsePointer: true, shortSidePx: 820 })).toMatchObject({ kind: 'tablet', maxExportShortSide: 1440, tileBitmaps: 200 })
  })

  it('lower still with 2 GB or less (Chrome tells, Safari does not)', () => {
    expect(budgetFor({ coarsePointer: true, shortSidePx: 360, memoryGb: 2 })).toMatchObject({
      maxPixelRatio: 1.5,
      movingPixelRatio: 1,
      tileBitmaps: 120,
      heightGrids: 100,
    })
  })
})

describe('readDeviceTraits', () => {
  it('reads the pointer, the screen and the memory', () => {
    expect(readDeviceTraits(scope(true, 390, 844, 4))).toEqual({ coarsePointer: true, shortSidePx: 390, memoryGb: 4 })
    expect(budgetFor(readDeviceTraits(scope(true, 1024, 1366))).kind).toBe('tablet')
    expect(budgetFor(readDeviceTraits(scope(false, 1920, 1080))).kind).toBe('desktop')
  })

  it('a scope without a screen is a computer', () => {
    expect(budgetFor(readDeviceTraits({})).kind).toBe('desktop')
  })
})

describe('where the limits live (computer)', () => {
  it('unchanged on a computer', () => {
    expect(deviceBudget().kind).toBe('desktop')
    expect(DEFAULT_TUNING.heightCacheEntries).toBe(400)
    expect(CLOUD_SETTLE_FRAMES).toBe(32)
    expect(DEFAULT_CLOUDS.seaRender).toBe('volume')
    expect(videoSize('16:9', '4k')).toEqual({ width: 3840, height: 2160 })
    expect(exportResolutionNote('4k')).toBeNull()
  })

  it('a phone renders 4K and 1440p at 1080p, and says so', () => {
    expect(videoSize('16:9', '4k', 1080)).toEqual({ width: 1920, height: 1080 })
    expect(videoSize('9:16', '1440p', 1080)).toEqual({ width: 1080, height: 1920 })
    expect(videoSize('16:9', '720p', 1080)).toEqual({ width: 1280, height: 720 })
    expect(exportResolutionNote('4k', 1080)).toMatch(/limité à 1080p/)
    expect(exportResolutionNote('1080p', 1080)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import type { TerrainStats } from '../core/types'
import { IDLE_MAP_STATUS, nextMapStatus, viewProgress, type MapStatus } from './mapStatus'

function stats(visibleTiles: number, pendingVisibleTiles: number, failedTiles = 0): TerrainStats {
  return { visibleTiles, loadedTiles: visibleTiles, pendingTiles: pendingVisibleTiles, failedTiles, pendingVisibleTiles }
}

/** Feeds the stats in order, `stepMs` apart. */
function run(list: TerrainStats[], stepMs = 250, from: MapStatus = IDLE_MAP_STATUS): MapStatus[] {
  const out: MapStatus[] = []
  let status = from
  list.forEach((s, i) => {
    status = nextMapStatus(status, s, i * stepMs)
    out.push(status)
  })
  return out
}

describe('viewProgress', () => {
  it('is the share of the view drawn', () => {
    expect(viewProgress(stats(18, 2))).toBeCloseTo(0.9)
    expect(viewProgress(stats(0, 10))).toBe(0)
    expect(viewProgress(stats(0, 0))).toBe(1)
  })

  it('falls back on all pending tiles without the visible count', () => {
    expect(viewProgress({ visibleTiles: 3, loadedTiles: 3, pendingTiles: 1, failedTiles: 0 })).toBeCloseTo(0.75)
  })
})

describe('nextMapStatus', () => {
  it('stays idle before the first tile, then ready when the view is complete', () => {
    expect(nextMapStatus(IDLE_MAP_STATUS, stats(0, 0), 0)).toBe(IDLE_MAP_STATUS)
    expect(nextMapStatus(IDLE_MAP_STATUS, stats(40, 0), 0)).toMatchObject({ phase: 'ready', shown: 'ready', progress: 1 })
  })

  it('shows a load only once it lasts, never at 100 % while tiles are awaited', () => {
    const [first, , third] = run([stats(1, 99), stats(50, 50), stats(999, 1)])
    expect(first).toMatchObject({ phase: 'loading', shown: 'idle', progress: 0.01 })
    expect(third).toMatchObject({ shown: 'loading', progress: 0.99 })
  })

  it('keeps « Carte prête » on screen during a short load', () => {
    const ready = nextMapStatus(IDLE_MAP_STATUS, stats(40, 0), 0)
    const [a, b] = run([stats(40, 4), stats(44, 0)], 250, ready)
    expect(a).toMatchObject({ phase: 'loading', shown: 'ready' })
    expect(b).toMatchObject({ phase: 'ready', shown: 'ready' })
  })

  it('never goes back during one load when the camera asks for more tiles', () => {
    const shown = run([stats(10, 10), stats(30, 10), stats(32, 30), stats(60, 2)]).map((s) => s.progress)
    expect(shown[0]).toBeCloseTo(0.5)
    expect(shown[1]).toBeCloseTo(0.75)
    expect(shown[2]).toBeCloseTo(0.75)
    expect(shown[3]).toBeCloseTo(60 / 62)
  })

  it('starts a new load from the view share, not from 0 %', () => {
    const [, , again] = run([stats(10, 10), stats(40, 0), stats(40, 8)])
    expect(again.progress).toBeCloseTo(40 / 48)
  })

  it('carries the failed tiles', () => {
    expect(nextMapStatus(IDLE_MAP_STATUS, stats(40, 0, 3), 0).failed).toBe(3)
    expect(nextMapStatus(IDLE_MAP_STATUS, stats(0, 0, 2), 0)).toMatchObject({ phase: 'ready', failed: 2 })
  })
})

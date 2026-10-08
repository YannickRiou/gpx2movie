import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackPoint } from '../core/types'
import { buildTrack } from '../import/stats'
import { resetAppStore, useAppStore } from '../state/store'

vi.mock('./draw', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./draw')>()
  return { ...actual, drawOverlay: vi.fn() }
})
vi.mock('./assets', () => ({ loadLogo: vi.fn(() => Promise.resolve({ width: 1, height: 1 })) }))

const { drawOverlay } = await import('./draw')
const { createOverlayDrawer } = await import('./exportOverlay')

const points: TrackPoint[] = [
  { lon: 6.8, lat: 45.9, ele: 1000, time: 0 },
  { lon: 6.81, lat: 45.9, ele: 1100, time: 600_000 },
]
const track = buildTrack({ name: 't', source: 'gpx', segments: [{ points }] })
const ctx = {} as OffscreenCanvasRenderingContext2D
const at = (progress: number) => ({ progress, time: { timeS: progress * 10, openingS: 0, flightS: 10, totalS: 10 } })

describe('createOverlayDrawer', () => {
  beforeEach(() => {
    resetAppStore()
    vi.mocked(drawOverlay).mockClear()
  })

  it('draws nothing without a track', () => {
    const drawer = createOverlayDrawer()
    drawer.draw(ctx, at(0.5), 1920, 1080)
    expect(drawOverlay).not.toHaveBeenCalled()
    drawer.dispose()
  })

  it('draws the first track with the overlay settings at the export size', () => {
    useAppStore.getState().addTracks([track])
    const drawer = createOverlayDrawer()
    drawer.draw(ctx, at(0.5), 1920, 1080)
    drawer.draw(ctx, at(0.75), 1920, 1080)
    expect(drawOverlay).toHaveBeenCalledTimes(2)
    const [calledCtx, frame, settings, size, , extras] = vi.mocked(drawOverlay).mock.calls[1]
    expect(calledCtx).toBe(ctx)
    expect(frame.progress).toBe(0.75)
    expect(settings).toBe(useAppStore.getState().settings.overlay)
    expect(size).toEqual({ width: 1920, height: 1080 })
    // film time of the frame, timeline texts, credits of the sources in use
    expect(extras?.time).toEqual(at(0.75).time)
    expect(extras?.texts).toBe(useAppStore.getState().settings.film.texts)
    expect(extras?.credits?.[0]).toMatch(/^Relief : /)
    expect(extras?.credits?.[1]).toMatch(/^Imagerie : /)
    drawer.dispose()
  })

  it('stops following the store once disposed', () => {
    const drawer = createOverlayDrawer()
    drawer.dispose()
    expect(() => useAppStore.getState().addTracks([track])).not.toThrow()
  })
})

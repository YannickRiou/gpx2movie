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

  it('hands the ghost-race leaderboard to the drawing while the race and the widget are on', () => {
    const other = buildTrack({ name: 'u', source: 'gpx', segments: [{ points: points.map((p) => ({ ...p, time: (p.time ?? 0) * 2 })) }] })
    useAppStore.getState().addTracks([track, other])
    const drawer = createOverlayDrawer()
    const leaderboard = () => vi.mocked(drawOverlay).mock.lastCall?.[5]?.leaderboard
    drawer.draw(ctx, at(0.5), 1920, 1080)
    expect(leaderboard()).toBeUndefined()
    const { settings, setSetting } = useAppStore.getState()
    setSetting('race', { ...settings.race, enabled: true })
    setSetting('overlay', { ...settings.overlay, leaderboard: { ...settings.overlay.leaderboard, enabled: true } })
    drawer.draw(ctx, at(0.5), 1920, 1080)
    expect(leaderboard()?.map((row) => [row.rank, row.name, row.gap])).toEqual([
      [1, 't', 'Tête'],
      [2, 'u', '+2 min 30'],
    ])
    drawer.dispose()
  })

  it('« À la suite »: each stage’s own figures, its card and the dip of its cut', () => {
    const other = buildTrack({ name: 'u', source: 'gpx', segments: [{ points: points.map((p) => ({ ...p, lat: p.lat + 0.01 })) }] })
    useAppStore.getState().addTracks([track, other])
    const { settings, setSetting } = useAppStore.getState()
    setSetting('race', { ...settings.race, sequence: true })
    const drawer = createOverlayDrawer()
    // the cut about halfway (two stages of nearly the same length), at film time 5
    const time = (timeS: number) => ({ timeS, openingS: 0, flightS: 10, totalS: 10, cutsS: [5] })
    drawer.draw(ctx, { progress: 0.75, time: time(7.5) }, 1920, 1080)
    const [, frame, , , , extras] = vi.mocked(drawOverlay).mock.lastCall!
    expect(frame.progress).toBeCloseTo(0.5, 3)
    expect(frame.track.name).toBe('t → u')
    expect(extras?.stage).toMatchObject({ name: 'u', index: 1, count: 2, startS: 5 })
    expect(extras?.dip).toBeNull()
    drawer.draw(ctx, { progress: 0.5, time: time(5) }, 1920, 1080)
    expect(vi.mocked(drawOverlay).mock.lastCall?.[5]?.dip).toEqual({ color: 'black', alpha: 1 })
    setSetting('race', { ...settings.race, sequence: true, stageTransition: 'coupe', stageCards: false })
    drawer.draw(ctx, { progress: 0.5, time: time(5) }, 1920, 1080)
    expect(vi.mocked(drawOverlay).mock.lastCall?.[5]).toMatchObject({ dip: null, stage: null })
    drawer.dispose()
  })

  it('stops following the store once disposed', () => {
    const drawer = createOverlayDrawer()
    drawer.dispose()
    expect(() => useAppStore.getState().addTracks([track])).not.toThrow()
  })
})

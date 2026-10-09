import { describe, expect, it, vi } from 'vitest'

const invalidate = vi.hoisted(() => vi.fn())
vi.mock('@react-three/fiber', () => ({ invalidate, useFrame: vi.fn(), useThree: vi.fn() }))

const { CLOUD_SETTLE_FRAMES, MAX_FRAME_DELTA_S, frameDelta, previewCloudPass, sceneChanged, wakeScene } = await import('./renderOnDemand')

describe('render on demand', () => {
  it('wakes the scene for a change of anything but the quiet keys', () => {
    const before = { settings: {}, terrainStats: {}, loading: false }
    expect(sceneChanged({ ...before, terrainStats: { visibleTiles: 3 } }, before)).toBe(false)
    expect(sceneChanged({ ...before, loading: true }, before)).toBe(false)
    expect(sceneChanged({ ...before, settings: { exaggeration: 2 } }, before)).toBe(true)
    expect(sceneChanged(before, before)).toBe(false)
  })

  it('bounds the time step of a frame after a pause', () => {
    expect(frameDelta(0.016)).toBe(0.016)
    expect(frameDelta(12)).toBe(MAX_FRAME_DELTA_S)
  })

  it('asks for a frame when woken', () => {
    invalidate.mockClear()
    wakeScene()
    expect(invalidate).toHaveBeenCalledTimes(1)
  })

  it('upscales the preview clouds while the view changes, then averages the still frames until converged', () => {
    expect(previewCloudPass(0)).toEqual({ upscale: true, alpha: 1, more: true })
    // the first still frame discards the upscaled history, the next ones make a running average
    expect(previewCloudPass(1)).toEqual({ upscale: false, alpha: 1, more: true })
    expect(previewCloudPass(4)).toEqual({ upscale: false, alpha: 1 / 4, more: true })
    expect(previewCloudPass(CLOUD_SETTLE_FRAMES)).toEqual({ upscale: false, alpha: 1 / CLOUD_SETTLE_FRAMES, more: false })
    // frames drawn later for something else (tiles): the average keeps its weight
    expect(previewCloudPass(CLOUD_SETTLE_FRAMES * 3).alpha).toBe(1 / CLOUD_SETTLE_FRAMES)
  })
})

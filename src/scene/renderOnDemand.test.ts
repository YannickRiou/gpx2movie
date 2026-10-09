import { describe, expect, it, vi } from 'vitest'

const invalidate = vi.hoisted(() => vi.fn())
vi.mock('@react-three/fiber', () => ({ invalidate, useFrame: vi.fn(), useThree: vi.fn() }))

const { MAX_FRAME_DELTA_S, frameDelta, sceneChanged, wakeScene } = await import('./renderOnDemand')

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
})

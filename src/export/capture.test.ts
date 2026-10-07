import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTLE, REPLACE_EPSILON, composeFrame, renderSettledFrame, settle, wait, type RenderFrameDeps } from './capture'
import { ExportCanceledError } from './encoder'

/**
 * Fake scene on a virtual clock: each render takes 10 ms, `wait` advances the clock, tiles finish loading at
 * `loadedAt` (one terrain change at that time).
 */
function fakeScene({ loadedAt = 0, canceled = (): boolean => false } = {}) {
  let clock = 1000
  let lastChange = 0
  const renders: number[] = []
  const progress: number[] = []
  const deps: RenderFrameDeps = {
    advance: () => {
      clock += 10
      if (loadedAt > 0 && lastChange < loadedAt + 1000 && clock >= loadedAt + 1000) lastChange = clock
      renders.push(clock)
    },
    pendingTiles: () => (clock < loadedAt + 1000 ? 2 : 0),
    lastChangeAt: () => lastChange,
    now: () => clock,
    wait: async (ms) => {
      clock += ms
    },
    isCanceled: canceled,
    setProgress: (p) => progress.push(p),
  }
  return { deps, renders, progress }
}

describe('settle', () => {
  it('renders the minimum number of frames when the terrain is already complete', async () => {
    const { deps, renders } = fakeScene()
    expect(await settle(deps)).toBe(true)
    expect(renders).toHaveLength(DEFAULT_SETTLE.minAdvances)
  })

  it('waits for pending tiles, then for the quiet period', async () => {
    const { deps } = fakeScene({ loadedAt: 200 })
    expect(await settle(deps)).toBe(true)
    // tiles ready at 1200, plus 250 ms of quiet
    expect(deps.now()).toBeGreaterThanOrEqual(1200 + DEFAULT_SETTLE.quietMs)
    expect(deps.now()).toBeLessThan(1200 + DEFAULT_SETTLE.quietMs + 50)
  })

  it('gives up after the timeout', async () => {
    const { deps } = fakeScene({ loadedAt: 60_000 })
    expect(await settle(deps, { ...DEFAULT_SETTLE, timeoutMs: 500 })).toBe(false)
    expect(deps.now()).toBeLessThan(1000 + 600)
  })

  it('throws when canceled', async () => {
    const { deps } = fakeScene({ loadedAt: 60_000, canceled: () => true })
    await expect(settle(deps)).rejects.toBeInstanceOf(ExportCanceledError)
  })
})

describe('renderSettledFrame', () => {
  it('sets the progress once when no tile arrives', async () => {
    const { deps, progress } = fakeScene()
    expect(await renderSettledFrame(0.25, deps)).toBe(true)
    expect(progress).toEqual([0.25])
  })

  it('places the camera again after tiles arrived', async () => {
    const { deps, progress } = fakeScene({ loadedAt: 100 })
    expect(await renderSettledFrame(0.25, deps)).toBe(true)
    expect(progress).toEqual([0.25, 0.25 + REPLACE_EPSILON])
  })

  it('nudges backwards at the end of the track', async () => {
    const { deps, progress } = fakeScene({ loadedAt: 100 })
    await renderSettledFrame(1, deps)
    expect(progress).toEqual([1, 1 - REPLACE_EPSILON])
  })
})

describe('composeFrame', () => {
  function fakeContext() {
    const calls: string[] = []
    const ctx = {
      createLinearGradient: () => ({ addColorStop: () => calls.push('stop') }),
      fillRect: (...a: number[]) => calls.push(`fill ${a.join(' ')}`),
      drawImage: (_s: unknown, ...a: number[]) => calls.push(`draw ${a.join(' ')}`),
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      fillStyle: '' as unknown,
    }
    return { ctx: ctx as unknown as OffscreenCanvasRenderingContext2D, calls }
  }

  it('paints the sky, scales the WebGL image to the video size and draws the overlay on top', () => {
    const { ctx, calls } = fakeContext()
    const overlay = vi.fn(() => calls.push('overlay'))
    composeFrame(ctx, {} as CanvasImageSource, 0.5, 320, 180, overlay)
    expect(calls).toEqual(['stop', 'stop', 'fill 0 0 320 180', 'draw 0 0 320 180', 'save', 'overlay', 'restore'])
    expect(overlay).toHaveBeenCalledWith(ctx, 0.5, 320, 180)
  })

  it('restores the context when the overlay throws', () => {
    const { ctx, calls } = fakeContext()
    expect(() =>
      composeFrame(ctx, {} as CanvasImageSource, 0, 10, 10, () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(calls.at(-1)).toBe('restore')
  })
})

describe('wait', () => {
  it('resolves with and without a delay', async () => {
    await expect(wait(0)).resolves.toBeUndefined()
    await expect(wait(1)).resolves.toBeUndefined()
  })
})

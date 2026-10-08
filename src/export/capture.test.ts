import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTLE,
  REPLACE_EPSILON,
  REPLACE_TOLERANCE_M,
  composeFrame,
  composeOverlayFrame,
  renderSettledFrame,
  settle,
  wait,
  type RenderFrameDeps,
} from './capture'
import { ExportCanceledError } from './encoder'

/**
 * Fake scene on a virtual clock: each render takes 10 ms, `wait` advances the clock, the view's tiles are
 * ready from `1000 + loadedAt` (which leaves a re-drape pending), the camera placement drifts by `drift` m.
 */
function fakeScene({ loadedAt = 0, canceled = (): boolean => false, drift = 0 } = {}) {
  let clock = 1000
  let drapePending = false
  const renders: number[] = []
  const progress: number[] = []
  const flushes: boolean[] = []
  const deps: RenderFrameDeps = {
    advance: () => {
      clock += 10
      if (loadedAt > 0 && renders.length > 0 && clock >= loadedAt + 1000 && renders.at(-1)! < loadedAt + 1000) drapePending = true
      renders.push(clock)
    },
    pendingTiles: () => (clock < loadedAt + 1000 ? 2 : 0),
    flushDrapes: () => {
      const ran = drapePending
      drapePending = false
      flushes.push(ran)
      return ran
    },
    now: () => clock,
    wait: async (ms) => {
      clock += ms
    },
    isCanceled: canceled,
    setProgress: (p) => progress.push(p),
    cameraDrift: () => drift,
  }
  return { deps, renders, progress, flushes }
}

describe('settle', () => {
  it('renders once when the terrain is already complete', async () => {
    const { deps, renders, flushes } = fakeScene()
    expect(await settle(deps)).toBe(true)
    expect(renders).toHaveLength(1)
    expect(flushes).toEqual([false])
  })

  it('polls until the view has its tiles, then re-drapes and renders once more', async () => {
    const { deps, renders, flushes } = fakeScene({ loadedAt: 200 })
    expect(await settle(deps)).toBe(true)
    expect(deps.now()).toBeGreaterThanOrEqual(1200)
    expect(deps.now()).toBeLessThan(1200 + 60)
    expect(flushes).toEqual([true])
    // the last render follows the flush
    expect(renders.length).toBeGreaterThan(2)
  })

  it('honours a minimum number of renders', async () => {
    const { deps, renders } = fakeScene()
    await settle(deps, { ...DEFAULT_SETTLE, minAdvances: 3 })
    expect(renders).toHaveLength(3)
  })

  it('gives up after the timeout, still flushing the re-drapes', async () => {
    const { deps, flushes } = fakeScene({ loadedAt: 60_000 })
    expect(await settle(deps, { ...DEFAULT_SETTLE, timeoutMs: 500 })).toBe(false)
    expect(deps.now()).toBeLessThan(1000 + 600)
    expect(flushes).toHaveLength(1)
  })

  it('throws when canceled', async () => {
    const { deps } = fakeScene({ loadedAt: 60_000, canceled: () => true })
    await expect(settle(deps)).rejects.toBeInstanceOf(ExportCanceledError)
  })
})

describe('renderSettledFrame', () => {
  it('sets the progress once when the placement does not move', async () => {
    const { deps, progress } = fakeScene({ loadedAt: 100, drift: REPLACE_TOLERANCE_M / 2 })
    expect(await renderSettledFrame(0.25, deps)).toBe(true)
    expect(progress).toEqual([0.25])
  })

  it('places the camera again when the final terrain moves it', async () => {
    const { deps, progress } = fakeScene({ loadedAt: 100, drift: 5 })
    expect(await renderSettledFrame(0.25, deps)).toBe(true)
    expect(progress).toEqual([0.25, 0.25 + REPLACE_EPSILON])
  })

  it('does not place the camera again after a timeout', async () => {
    const { deps, progress } = fakeScene({ loadedAt: 60_000, drift: 5 })
    expect(await renderSettledFrame(0.25, deps, { ...DEFAULT_SETTLE, timeoutMs: 500 })).toBe(false)
    expect(progress).toEqual([0.25])
  })

  it('nudges backwards at the end of the track', async () => {
    const { deps, progress } = fakeScene({ drift: 5 })
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
      clearRect: (...a: number[]) => calls.push(`clear ${a.join(' ')}`),
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
    const at = { progress: 0.5, time: { timeS: 12, openingS: 6, flightS: 20, totalS: 31 } }
    composeFrame(ctx, {} as CanvasImageSource, at, 320, 180, overlay)
    expect(calls).toEqual(['stop', 'stop', 'fill 0 0 320 180', 'draw 0 0 320 180', 'save', 'overlay', 'restore'])
    expect(overlay).toHaveBeenCalledWith(ctx, at, 320, 180)
  })

  it('restores the context when the overlay throws', () => {
    const { ctx, calls } = fakeContext()
    expect(() =>
      composeFrame(ctx, {} as CanvasImageSource, { progress: 0, time: { timeS: 0, openingS: 0, flightS: 1, totalS: 1 } }, 10, 10, () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(calls.at(-1)).toBe('restore')
  })

  it('draws the overlay alone on a cleared, transparent canvas', () => {
    const { ctx, calls } = fakeContext()
    const overlay = vi.fn(() => calls.push('overlay'))
    const at = { progress: 0.5, time: { timeS: 12, openingS: 6, flightS: 20, totalS: 31 } }
    composeOverlayFrame(ctx, at, 320, 180, overlay)
    expect(calls).toEqual(['clear 0 0 320 180', 'save', 'overlay', 'restore'])
    expect(overlay).toHaveBeenCalledWith(ctx, at, 320, 180)
  })
})

describe('wait', () => {
  it('resolves with and without a delay', async () => {
    await expect(wait(0)).resolves.toBeUndefined()
    await expect(wait(1)).resolves.toBeUndefined()
  })
})

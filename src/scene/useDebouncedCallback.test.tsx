import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDebounced } from './useDebouncedCallback'

describe('createDebounced', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('collapses a burst of calls into one trailing call with the last arguments', () => {
    const fn = vi.fn<(a: number, b: string) => void>()
    const debounced = createDebounced(fn, 150)
    debounced(1, 'a')
    debounced(2, 'b')
    debounced(3, 'c')
    expect(fn).not.toHaveBeenCalled()
    expect(debounced.isPending()).toBe(true)
    vi.advanceTimersByTime(149)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3, 'c')
    expect(debounced.isPending()).toBe(false)
  })

  it('restarts the delay on every call', () => {
    const fn = vi.fn()
    const debounced = createDebounced(fn, 100)
    debounced()
    vi.advanceTimersByTime(80)
    debounced()
    vi.advanceTimersByTime(80)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(20)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel drops the pending call', () => {
    const fn = vi.fn()
    const debounced = createDebounced(fn, 100)
    debounced()
    debounced.cancel()
    expect(debounced.isPending()).toBe(false)
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
  })

  it('flush runs the pending call immediately and only once', () => {
    const fn = vi.fn<(v: number) => void>()
    const debounced = createDebounced(fn, 100)
    debounced(7)
    debounced.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(7)
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
    // flush with nothing pending is a no-op
    debounced.flush()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('createDebounced with maxWaitMs', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires at least every maxWaitMs while calls keep arriving, then the trailing call', () => {
    const fn = vi.fn<(v: number) => void>()
    const debounced = createDebounced(fn, 150, { maxWaitMs: 600 })
    // one call per 16 ms frame for 1.5 s: a trailing-only debounce would never fire
    let v = 0
    for (let t = 0; t < 1500; t += 16) {
      debounced(++v)
      vi.advanceTimersByTime(16)
    }
    // max-wait fired at t = 600 (last call before it: #38 at 592 ms) and at t = 1208 (#76 at 1200 ms)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenNthCalledWith(1, 38)
    expect(fn).toHaveBeenNthCalledWith(2, 76)
    // the burst stopped: the trailing call fires 150 ms after the last call with its arguments
    expect(debounced.isPending()).toBe(true)
    vi.advanceTimersByTime(150)
    expect(fn).toHaveBeenCalledTimes(3)
    expect(fn).toHaveBeenLastCalledWith(94)
    expect(debounced.isPending()).toBe(false)
    // and the max-wait timer was cleared with it
    vi.advanceTimersByTime(2000)
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('a trailing call before maxWaitMs clears the max-wait timer', () => {
    const fn = vi.fn()
    const debounced = createDebounced(fn, 100, { maxWaitMs: 500 })
    debounced()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel and flush clear the max-wait timer too', () => {
    const fn = vi.fn()
    const cancelled = createDebounced(fn, 100, { maxWaitMs: 500 })
    cancelled()
    cancelled.cancel()
    vi.advanceTimersByTime(1000)
    expect(fn).not.toHaveBeenCalled()

    const flushed = createDebounced(fn, 100, { maxWaitMs: 500 })
    flushed()
    flushed.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { TOUCH_SETTLE_MS, watchTouchGesture } from './touchGesture'

describe('watchTouchGesture', () => {
  const pointer = (target: EventTarget, type: string, pointerId: number, x: number, pointerType = 'touch') =>
    target.dispatchEvent(Object.assign(new Event(type), { pointerType, pointerId, clientX: x, clientY: 0 }))

  it('is on once a finger moves, off TOUCH_SETTLE_MS after the last one lifts', () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const changes: boolean[] = []
    const stop = watchTouchGesture(target, (active) => changes.push(active))
    pointer(target, 'pointerdown', 1, 0)
    pointer(target, 'pointerdown', 2, 100)
    pointer(target, 'pointermove', 1, 20)
    pointer(target, 'pointermove', 1, 40)
    pointer(target, 'pointerup', 1, 40)
    vi.advanceTimersByTime(TOUCH_SETTLE_MS)
    expect(changes).toEqual([true])
    pointer(target, 'pointercancel', 2, 100)
    vi.advanceTimersByTime(TOUCH_SETTLE_MS - 1)
    expect(changes).toEqual([true])
    vi.advanceTimersByTime(1)
    expect(changes).toEqual([true, false])
    stop()
    vi.useRealTimers()
  })

  it('a touch before the end keeps the gesture; taps and the mouse change nothing', () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const changes: boolean[] = []
    const stop = watchTouchGesture(target, (active) => changes.push(active))
    pointer(target, 'pointerdown', 1, 0, 'mouse')
    pointer(target, 'pointermove', 1, 200, 'mouse')
    pointer(target, 'pointerdown', 2, 0)
    pointer(target, 'pointermove', 2, 3)
    pointer(target, 'pointerup', 2, 3)
    vi.advanceTimersByTime(TOUCH_SETTLE_MS)
    expect(changes).toEqual([])
    pointer(target, 'pointerdown', 3, 0)
    pointer(target, 'pointermove', 3, 50)
    pointer(target, 'pointerup', 3, 50)
    vi.advanceTimersByTime(TOUCH_SETTLE_MS / 2)
    pointer(target, 'pointerdown', 4, 50)
    vi.advanceTimersByTime(TOUCH_SETTLE_MS)
    expect(changes).toEqual([true])
    pointer(target, 'pointerup', 4, 50)
    stop()
    vi.advanceTimersByTime(TOUCH_SETTLE_MS)
    expect(changes).toEqual([true])
    vi.useRealTimers()
  })
})

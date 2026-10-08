import { beforeEach, describe, expect, it } from 'vitest'
import { TOAST_MIN_MS, dismissToast, pushToast, showToast, toastDuration, useToastStore } from './toast'
import type { Toast } from './toast'

const t = (id: number, kind: Toast['kind'] = 'success', text = `m${id}`): Toast => ({ id, kind, text })

describe('pushToast', () => {
  it('adds the message last', () => {
    expect(pushToast([t(1)], t(2)).map((x) => x.id)).toEqual([1, 2])
  })

  it('replaces the same message shown again', () => {
    expect(pushToast([t(1, 'info', 'a'), t(2)], t(3, 'info', 'a')).map((x) => x.id)).toEqual([2, 3])
    // same text, other kind: both stay
    expect(pushToast([t(1, 'info', 'a')], t(2, 'error', 'a')).map((x) => x.id)).toEqual([1, 2])
  })

  it('drops the oldest message that is not an error beyond the limit', () => {
    const list = [t(1, 'error'), t(2), t(3)]
    expect(pushToast(list, t(4), 3).map((x) => x.id)).toEqual([1, 3, 4])
  })

  it('drops the oldest error when only errors are left', () => {
    const list = [t(1, 'error'), t(2, 'error')]
    expect(pushToast(list, t(3, 'error'), 2).map((x) => x.id)).toEqual([2, 3])
    expect(pushToast(list, t(3), 2).map((x) => x.id)).toEqual([2, 3])
  })
})

describe('toastDuration', () => {
  it('lasts 5 s for a short text, longer for a long one, never more than 12 s', () => {
    expect(toastDuration('Projet enregistré')).toBe(TOAST_MIN_MS)
    expect(toastDuration('x'.repeat(150))).toBe(9000)
    expect(toastDuration('x'.repeat(1000))).toBe(12000)
  })
})

describe('toast store', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }))

  it('shows and dismisses by id', () => {
    const a = showToast({ kind: 'success', text: 'a' })
    const b = showToast({ kind: 'error', text: 'b' })
    expect(useToastStore.getState().toasts.map((x) => x.text)).toEqual(['a', 'b'])
    dismissToast(a)
    expect(useToastStore.getState().toasts.map((x) => x.id)).toEqual([b])
    const before = useToastStore.getState()
    dismissToast(a)
    expect(useToastStore.getState()).toBe(before)
  })
})

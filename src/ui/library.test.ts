import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '../core/types'
import { closeLoss, confirmClose, createAutosave, formatProjectSize, projectSummary, settleWithin } from './library'
import type { CloseLoss, CloseSteps } from './library'

const track = (name: string, distanceM: number) => ({ name, stats: { distanceM } }) as Track

describe('« Mes projets »: entry text', () => {
  it('summary: first track and its distance, the count when there are several', () => {
    expect(projectSummary([])).toBe('Aucune trace')
    expect(projectSummary([track('Tour du Mont-Blanc', 42_300)])).toBe('Tour du Mont-Blanc · 42,3 km')
    expect(projectSummary([track('Jour 1', 850), track('Jour 2', 9000), track('Jour 3', 1)])).toBe('Jour 1 · 850 m · 3 traces')
    expect(projectSummary([track('Tour du Mont-Blanc', 42_300)], 'Tour du Mont-Blanc')).toBe('42,3 km')
  })

  it('size in Ko below a megabyte, in Mo above', () => {
    expect(formatProjectSize(200)).toBe('1 Ko')
    expect(formatProjectSize(12_300)).toBe('12 Ko')
    expect(formatProjectSize(4_500_000)).toBe('4,5 Mo')
  })
})

describe('« Mes projets »: autosave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(canSave = () => true) {
    const save = vi.fn(async () => undefined)
    const onError = vi.fn()
    return { save, onError, autosave: createAutosave({ delayMs: 1000, canSave, save, onError }) }
  }

  it('saves once, a delay after the last change', async () => {
    const { save, autosave } = setup()
    autosave.changed()
    await vi.advanceTimersByTimeAsync(800)
    autosave.changed()
    await vi.advanceTimersByTimeAsync(800)
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(save).toHaveBeenCalledTimes(1)
    autosave.changed()
    autosave.cancel()
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('waits while saving is not allowed (export running)', async () => {
    let exporting = true
    const { save, autosave } = setup(() => !exporting)
    autosave.changed()
    await vi.advanceTimersByTimeAsync(3000)
    expect(save).not.toHaveBeenCalled()
    exporting = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('one message per run of failures', async () => {
    const { save, onError, autosave } = setup()
    save.mockRejectedValue(new Error('disque plein'))
    for (let i = 0; i < 3; i++) {
      autosave.changed()
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(save).toHaveBeenCalledTimes(3)
    expect(onError).toHaveBeenCalledTimes(1)
    save.mockResolvedValueOnce(undefined)
    autosave.changed()
    await vi.advanceTimersByTimeAsync(1000)
    autosave.changed()
    await vi.advanceTimersByTimeAsync(1000)
    expect(onError).toHaveBeenCalledTimes(2)
  })

  it('flush saves a waiting change at once, and only then', async () => {
    const { save, autosave } = setup()
    await autosave.flush()
    expect(save).not.toHaveBeenCalled()
    autosave.changed()
    await autosave.flush()
    expect(save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('saves never overlap', async () => {
    const { save, autosave } = setup()
    let running = 0
    let overlapped = false
    save.mockImplementation(async () => {
      running++
      overlapped ||= running > 1
      await new Promise((resolve) => setTimeout(resolve, 3000))
      running--
    })
    autosave.changed()
    await vi.advanceTimersByTimeAsync(1000)
    autosave.changed()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(save).toHaveBeenCalledTimes(2)
    expect(overlapped).toBe(false)
  })
})

describe('closing the window or tab', () => {
  it('loses a running export first, else the changes not saved, else nothing', () => {
    expect(closeLoss({ exporting: false, dirty: false })).toBeNull()
    expect(closeLoss({ exporting: false, dirty: true })).toBe('changes')
    expect(closeLoss({ exporting: true, dirty: false })).toBe('export')
    expect(closeLoss({ exporting: true, dirty: true })).toBe('export')
  })

  describe('desktop window', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    /** `loss` after the flush; `afterSave` once « Enregistrer » ran */
    function steps(loss: CloseLoss, answer: 'save' | 'close' | 'cancel' = 'cancel', afterSave: CloseLoss = null) {
      let current = loss
      return {
        flush: vi.fn(async () => undefined),
        loss: () => current,
        ask: vi.fn(async () => answer),
        save: vi.fn(async () => {
          current = afterSave
        }),
      } satisfies CloseSteps
    }

    it('closes without a question once the last change is written', async () => {
      const s = steps(null)
      expect(await confirmClose(s)).toBe(true)
      expect(s.flush).toHaveBeenCalledTimes(1)
      expect(s.ask).not.toHaveBeenCalled()
    })

    it('asks when something would be lost: close, cancel, or save first', async () => {
      const close = steps('changes', 'close')
      expect(await confirmClose(close)).toBe(true)
      expect(close.ask).toHaveBeenCalledWith('changes')
      expect(await confirmClose(steps('export', 'cancel'))).toBe(false)
      const saved = steps('changes', 'save', null)
      expect(await confirmClose(saved)).toBe(true)
      expect(saved.save).toHaveBeenCalledTimes(1)
      // save dialog closed: still « Modifié »
      expect(await confirmClose(steps('changes', 'save', 'changes'))).toBe(false)
    })

    it('waits for a slow write a few seconds at most', async () => {
      const s = steps(null)
      s.flush.mockReturnValue(new Promise(() => undefined))
      const closing = confirmClose(s, 4000)
      let closed: boolean | null = null
      void closing.then((value) => (closed = value))
      await vi.advanceTimersByTimeAsync(3999)
      expect(closed).toBeNull()
      await vi.advanceTimersByTimeAsync(1)
      expect(closed).toBe(true)
    })

    it('settleWithin: at once when the promise settles, failure included', async () => {
      let settled = false
      void settleWithin(Promise.reject(new Error('disque plein')), 4000).then(() => (settled = true))
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(true)
    })
  })
})

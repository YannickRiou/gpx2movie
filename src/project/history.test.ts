import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTrack } from '../import/stats'
import { DEFAULT_SETTINGS, resetAppStore, useAppStore } from '../state/store'
import { createHistory, getSettingsHistory, installHistoryShortcuts, installSliderGestures, resetSettings } from './history'
import type { History } from './history'

interface Value {
  a: number
  b: number
}

/** Minimal immutable store + history with a manual clock. */
function setup(coalesceMs = 400) {
  let value: Value = { a: 0, b: 0 }
  let time = 0
  const listeners = new Set<(next: Value, prev: Value) => void>()
  const set = (patch: Partial<Value>) => {
    const prev = value
    value = { ...value, ...patch }
    for (const l of listeners) l(value, prev)
  }
  const history = createHistory<Value>({
    get: () => value,
    apply: (v) => set(v),
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    coalesceMs,
    now: () => time,
  })
  return {
    history,
    set,
    get: () => value,
    tick: (ms: number) => {
      time += ms
    },
    listenerCount: () => listeners.size,
  }
}

describe('createHistory', () => {
  it('undoes and redoes separate changes, and a new change clears redo', () => {
    const h = setup()
    expect(h.history.getState()).toEqual({ canUndo: false, canRedo: false })
    h.set({ a: 1 })
    h.tick(1000)
    h.set({ b: 2 })
    h.history.undo()
    expect(h.get()).toEqual({ a: 1, b: 0 })
    h.history.undo()
    expect(h.get()).toEqual({ a: 0, b: 0 })
    expect(h.history.getState()).toEqual({ canUndo: false, canRedo: true })
    h.history.redo()
    h.history.redo()
    expect(h.get()).toEqual({ a: 1, b: 2 })
    h.history.undo()
    h.set({ a: 5 })
    expect(h.history.getState()).toEqual({ canUndo: true, canRedo: false })
    h.history.redo() // no-op
    expect(h.get()).toEqual({ a: 5, b: 0 })
  })

  it('coalesces rapid changes of the same keys into one step (slider drag)', () => {
    const h = setup()
    for (let i = 1; i <= 10; i++) {
      h.set({ a: i / 10 })
      h.tick(100) // window slides with every change
    }
    h.tick(1000)
    h.set({ a: 5 })
    h.history.undo()
    expect(h.get().a).toBe(1)
    h.history.undo()
    expect(h.get().a).toBe(0)
    expect(h.history.getState().canUndo).toBe(false)
  })

  it('keeps a gesture one step however slow, and starts new steps at its start and end', () => {
    const h = setup()
    h.set({ a: 1 })
    h.tick(100)
    const end = h.history.beginGesture()
    for (let i = 2; i <= 5; i++) {
      h.set({ a: i })
      h.tick(1000) // pauses longer than the coalescing window
    }
    end()
    h.set({ a: 6 })
    h.history.undo()
    expect(h.get().a).toBe(5)
    h.history.undo()
    expect(h.get().a).toBe(1)
    h.history.undo()
    expect(h.get().a).toBe(0)
    // after the gesture, slow changes are separate steps again
    h.set({ a: 1 })
    h.tick(1000)
    h.set({ a: 2 })
    h.history.undo()
    expect(h.get().a).toBe(1)
  })

  it('records nothing while suspended, transactions included', () => {
    const h = setup()
    h.set({ a: 1 })
    const resume = h.history.suspend()
    h.tick(1000)
    h.set({ a: 2 })
    h.history.transaction(() => h.set({ b: 2 }))
    h.set({ a: 1, b: 0 })
    resume()
    h.history.undo()
    expect(h.get()).toEqual({ a: 0, b: 0 })
    expect(h.history.getState().canUndo).toBe(false)
  })

  it('does not coalesce changes of different keys, nor across an undo', () => {
    const h = setup()
    h.set({ a: 1 })
    h.tick(50)
    h.set({ b: 1 })
    h.history.undo()
    expect(h.get()).toEqual({ a: 1, b: 0 })
    h.set({ a: 2 })
    h.history.undo()
    expect(h.get()).toEqual({ a: 1, b: 0 })
  })

  it('restores only the keys of the step, keeping changes made outside the history', () => {
    const h = setup()
    h.set({ a: 1 })
    h.history.dispose() // the next change is not recorded
    h.set({ b: 7 })
    h.history.undo()
    expect(h.get()).toEqual({ a: 0, b: 7 })
    h.history.redo()
    expect(h.get()).toEqual({ a: 1, b: 7 })
  })

  it('records a transaction as one step and ignores empty ones', () => {
    const h = setup()
    h.history.transaction(() => {
      h.set({ a: 1 })
      h.set({ b: 1 })
    })
    h.history.transaction(() => {
      h.set({ a: 3 })
      h.set({ a: 1 })
    })
    h.history.undo()
    expect(h.get()).toEqual({ a: 0, b: 0 })
    expect(h.history.getState().canUndo).toBe(false)
  })

  it('notifies on state changes only, clears, and disposes', () => {
    const h = setup()
    const listener = vi.fn()
    const unsubscribe = h.history.subscribe(listener)
    const before = h.history.getState()
    h.set({ a: 1 })
    h.tick(1000)
    h.set({ a: 2 })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(h.history.getState()).not.toBe(before)
    h.history.clear()
    expect(h.history.getState()).toEqual({ canUndo: false, canRedo: false })
    unsubscribe()
    h.history.dispose()
    expect(h.listenerCount()).toBe(0)
  })
})

describe('getSettingsHistory (app store)', () => {
  beforeEach(() => {
    resetAppStore()
    getSettingsHistory().clear()
  })

  it('undoes any setting through setSetting', () => {
    const { setSetting } = useAppStore.getState()
    setSetting('wireframe', true)
    getSettingsHistory().undo()
    expect(useAppStore.getState().settings).toEqual(DEFAULT_SETTINGS)
    getSettingsHistory().redo()
    expect(useAppStore.getState().settings.wireframe).toBe(true)
    // other parts of the state are not recorded
    useAppStore.getState().setSpeed(4)
    getSettingsHistory().undo()
    expect(useAppStore.getState().settings.wireframe).toBe(false)
    expect(useAppStore.getState().playback.speed).toBe(4)
  })

  it('does not record the imagery picked automatically on import', () => {
    const track = buildTrack({ name: 't', source: 'gpx', segments: [{ points: [{ lon: 6.86, lat: 45.92 }] }] })
    useAppStore.getState().setSetting('exaggeration', 2)
    useAppStore.getState().addTracks([track])
    expect(useAppStore.getState().settings.imagerySourceId).toBe('ign-ortho')
    getSettingsHistory().undo()
    expect(useAppStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS, imagerySourceId: 'ign-ortho' })
    expect(getSettingsHistory().getState().canUndo).toBe(false)
  })

  it('resets a group of settings to the defaults in one undo step, leaving the other keys alone', () => {
    const { setSetting } = useAppStore.getState()
    const camera = { ...DEFAULT_SETTINGS.camera, distance: 2 }
    setSetting('camera', camera)
    setSetting('flyoverDurationS', 120)
    setSetting('wireframe', true)
    resetSettings(['camera', 'flyoverDurationS'])
    expect(useAppStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS, wireframe: true })
    getSettingsHistory().undo()
    expect(useAppStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS, camera, flyoverDurationS: 120, wireframe: true })
    getSettingsHistory().redo()
    expect(useAppStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS, wireframe: true })
  })
  it('undoes a reset from its message only while it is still the last change', () => {
    const { setSetting } = useAppStore.getState()
    setSetting('flyoverDurationS', 120)
    const undoReset = resetSettings(['flyoverDurationS'])
    expect(undoReset()).toBe(true)
    expect(useAppStore.getState().settings.flyoverDurationS).toBe(120)
    // a later step: the message's « Annuler » must not undo it
    const undoAgain = resetSettings(['flyoverDurationS'])
    setSetting('wireframe', true)
    expect(undoAgain()).toBe(false)
    expect(useAppStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS, wireframe: true })
    // undone with Ctrl+Z already: nothing more to undo
    getSettingsHistory().undo()
    getSettingsHistory().undo()
    expect(undoAgain()).toBe(false)
    expect(useAppStore.getState().settings.flyoverDurationS).toBe(120)
  })

  it('does not undo an earlier step when the reset changed nothing', () => {
    useAppStore.getState().setSetting('wireframe', true)
    const undoReset = resetSettings(['flyoverDurationS'])
    expect(undoReset()).toBe(false)
    expect(useAppStore.getState().settings.wireframe).toBe(true)
  })
})

describe('installHistoryShortcuts', () => {
  let history: History
  let uninstall: () => void
  beforeEach(() => {
    history = { ...setup().history, undo: vi.fn(), redo: vi.fn() }
    uninstall = installHistoryShortcuts(history)
  })
  afterEach(() => {
    uninstall()
    document.body.innerHTML = ''
  })

  const press = (init: KeyboardEventInit, target: EventTarget = window) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
  }

  it('maps Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y', () => {
    expect(press({ key: 'z', ctrlKey: true }).defaultPrevented).toBe(true)
    press({ key: 'z', metaKey: true })
    expect(history.undo).toHaveBeenCalledTimes(2)
    press({ key: 'Z', ctrlKey: true, shiftKey: true })
    press({ key: 'z', metaKey: true, shiftKey: true })
    press({ key: 'y', ctrlKey: true })
    expect(history.redo).toHaveBeenCalledTimes(3)
  })

  it('ignores other keys and text fields, but not sliders or checkboxes', () => {
    expect(press({ key: 'z' }).defaultPrevented).toBe(false)
    press({ key: 's', ctrlKey: true })
    press({ key: 'z', ctrlKey: true, altKey: true })
    const text = document.body.appendChild(document.createElement('input'))
    const area = document.body.appendChild(document.createElement('textarea'))
    expect(press({ key: 'z', ctrlKey: true }, text).defaultPrevented).toBe(false)
    press({ key: 'z', ctrlKey: true }, area)
    expect(history.undo).not.toHaveBeenCalled()
    const range = document.body.appendChild(document.createElement('input'))
    range.type = 'range'
    press({ key: 'z', ctrlKey: true }, range)
    expect(history.undo).toHaveBeenCalledTimes(1)
  })

  it('removes its listener', () => {
    uninstall()
    press({ key: 'z', ctrlKey: true })
    expect(history.undo).not.toHaveBeenCalled()
  })
})

describe('installSliderGestures', () => {
  const pointer = (type: string, target: EventTarget) => target.dispatchEvent(new Event(type, { bubbles: true }))

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens a gesture on pointer down on a slider and ends it on pointer up or cancel', () => {
    const end = vi.fn()
    const beginGesture = vi.fn(() => end)
    const history = { ...setup().history, beginGesture }
    const uninstall = installSliderGestures(history)
    const range = document.body.appendChild(document.createElement('input'))
    range.type = 'range'
    const button = document.body.appendChild(document.createElement('button'))

    pointer('pointerdown', button)
    expect(beginGesture).not.toHaveBeenCalled()
    pointer('pointerdown', range)
    expect(beginGesture).toHaveBeenCalledTimes(1)
    pointer('pointerup', document.body)
    expect(end).toHaveBeenCalledTimes(1)
    pointer('pointerup', document.body) // nothing left to end
    pointer('pointerdown', range)
    pointer('pointercancel', range)
    expect(end).toHaveBeenCalledTimes(2)

    pointer('pointerdown', range)
    uninstall() // ends the open gesture
    expect(end).toHaveBeenCalledTimes(3)
    pointer('pointerdown', range)
    expect(beginGesture).toHaveBeenCalledTimes(3)
  })
})

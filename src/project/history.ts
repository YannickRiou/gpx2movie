/**
 * Undo / redo of settings changes.
 *
 * `createHistory` is generic: it watches immutable snapshots (any object replaced on every change, such as
 * `settings`) through `subscribe`. Each step keeps only the keys it changed (before / after values), so
 * undo restores those keys and leaves alone what changed outside the history (e.g. the imagery source picked
 * automatically on import). Rapid changes of the same keys (dragging a slider) are coalesced into one step;
 * `transaction` groups several changes (a preset); `beginGesture` keeps one step open however slow the changes (a
 * slider dragged with the pointer, `installSliderGestures`).
 * `getSettingsHistory` binds one instance to `useAppStore`; `installHistoryShortcuts` adds the keyboard;
 * `resetSettings` puts a group of settings back to their defaults as one step (and returns its guarded undo).
 */
import { followFlightTiming } from '../scene/usePacing'
import { DEFAULT_SETTINGS, useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { applySettings } from './apply'

/** Changes of the same keys closer than this (ms) form a single undo step. */
export const COALESCE_MS = 400
export const HISTORY_LIMIT = 100

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
}

export interface History {
  undo(): void
  redo(): void
  /** run `fn` and record every change it makes as a single step */
  transaction(fn: () => void): void
  /** until the returned end is called, changes of the same keys form a single step whatever their spacing */
  beginGesture(): () => void
  /** until the returned resume is called, no change is recorded (a run that puts every setting back at its end) */
  suspend(): () => void
  /** forget every step (e.g. after opening a project) */
  clear(): void
  /** current state; a new object only when it changes (usable with useSyncExternalStore) */
  getState(): HistoryState
  subscribe(listener: () => void): () => void
  /** stop watching the source */
  dispose(): void
}

export interface HistoryOptions<T extends object> {
  get(): T
  apply(value: T): void
  /** call `listener(next, previous)` for every change to record; returns unsubscribe */
  subscribe(listener: (next: T, previous: T) => void): () => void
  coalesceMs?: number
  limit?: number
  now?: () => number
}

/** One undo step: the values of the keys it changed, before and after. */
interface Step<T> {
  before: Partial<T>
  after: Partial<T>
}

/** Keys whose values differ between two snapshots, sorted. */
function changedKeys<T extends object>(a: T, b: T): (keyof T)[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof T)[])
  return [...keys].filter((k) => !Object.is(a[k], b[k])).sort()
}

function pick<T extends object>(value: T, keys: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {}
  for (const key of keys) out[key] = value[key]
  return out
}

export function createHistory<T extends object>(options: HistoryOptions<T>): History {
  const coalesceMs = options.coalesceMs ?? COALESCE_MS
  const limit = options.limit ?? HISTORY_LIMIT
  const now = options.now ?? (() => performance.now())
  let past: Step<T>[] = []
  let future: Step<T>[] = []
  let lastKeys = ''
  let lastAt = -Infinity
  let restoring = false
  let batchDepth = 0
  let batchStart: T | null = null
  let gesture = false
  let suspended = false
  let state: HistoryState = { canUndo: false, canRedo: false }
  const listeners = new Set<() => void>()

  const emit = () => {
    const next = { canUndo: past.length > 0, canRedo: future.length > 0 }
    if (next.canUndo === state.canUndo && next.canRedo === state.canRedo) return
    state = next
    for (const listener of listeners) listener()
  }

  const push = (start: T, end: T) => {
    const keys = changedKeys(start, end)
    if (keys.length === 0) return
    past.push({ before: pick(start, keys), after: pick(end, keys) })
    if (past.length > limit) past.shift()
    future = []
    emit()
  }

  const unsubscribe = options.subscribe((next, previous) => {
    if (restoring || suspended || next === previous) return
    if (batchDepth > 0) {
      batchStart ??= previous
      return
    }
    const keys = changedKeys(next, previous)
    const t = now()
    const id = keys.join('|')
    const top = past.at(-1)
    // in a gesture, only a break (undo, transaction, start or end of the gesture) starts a new step
    const recent = gesture ? lastAt > -Infinity : t - lastAt < coalesceMs
    const coalesce = top !== undefined && id === lastKeys && recent
    lastKeys = id
    lastAt = t
    if (coalesce) Object.assign(top.after, pick(next, keys))
    else push(previous, next)
  })

  const restore = (values: Partial<T>) => {
    restoring = true
    try {
      options.apply({ ...options.get(), ...values })
    } finally {
      restoring = false
    }
    // the next change starts a new step
    lastAt = -Infinity
  }

  return {
    undo() {
      const step = past.pop()
      if (!step) return
      future.push(step)
      restore(step.before)
      emit()
    },
    redo() {
      const step = future.pop()
      if (!step) return
      past.push(step)
      restore(step.after)
      emit()
    },
    transaction(fn) {
      batchDepth++
      try {
        fn()
      } finally {
        batchDepth--
        if (batchDepth === 0 && batchStart) {
          const start = batchStart
          batchStart = null
          lastAt = -Infinity
          push(start, options.get())
        }
      }
    },
    beginGesture() {
      gesture = true
      lastAt = -Infinity
      return () => {
        gesture = false
        lastAt = -Infinity
      }
    },
    suspend() {
      suspended = true
      return () => {
        suspended = false
        lastAt = -Infinity
      }
    },
    clear() {
      past = []
      future = []
      lastAt = -Infinity
      emit()
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: unsubscribe,
  }
}

let appHistory: History | null = null

/** The settings history of the app store (created on first use, lives as long as the page). */
export function getSettingsHistory(): History {
  appHistory ??= createHistory<Settings>({
    get: () => useAppStore.getState().settings,
    apply: applySettings,
    subscribe: (listener) =>
      useAppStore.subscribe((state, previous) => {
        // settings changed together with the tracks or the plan area are a side effect (regional imagery), not a step
        if (state.settings !== previous.settings && state.tracks === previous.tracks && state.planArea === previous.planArea) {
          listener(state.settings, previous.settings)
        }
      }),
  })
  return appHistory
}

/**
 * Put `keys` back to their values in `DEFAULT_SETTINGS`, as a single undo step; the texts and media attached to a stop
 * follow it when the flyover duration or the pacing moves it (`followFlightTiming`). Returns the undo of this reset (the
 * « Annuler » of its message): it undoes only while the settings are still those the reset left, so it never undoes a
 * later step, nor an earlier one when the reset changed nothing; true when it undid.
 */
export function resetSettings(keys: readonly (keyof Settings)[], history: History = getSettingsHistory()): () => boolean {
  const defaults = pick(DEFAULT_SETTINGS, keys)
  const before = useAppStore.getState().settings
  history.transaction(() => {
    applySettings({ ...before, ...defaults })
    followFlightTiming(before)
  })
  const after = useAppStore.getState().settings
  return () => {
    if (after === before || useAppStore.getState().settings !== after) return false
    history.undo()
    return true
  }
}

/**
 * A slider dragged with the pointer is a single undo step from pointer down to pointer up, however slow; keyboard
 * changes keep the usual grouping. Returns the function that removes the listeners.
 */
export function installSliderGestures(history: History, target: Window = window): () => void {
  let end: (() => void) | null = null
  const release = () => {
    end?.()
    end = null
  }
  const onDown = (e: Event) => {
    if (!(e.target instanceof HTMLInputElement) || e.target.type !== 'range') return
    release()
    end = history.beginGesture()
  }
  target.addEventListener('pointerdown', onDown, true)
  target.addEventListener('pointerup', release, true)
  target.addEventListener('pointercancel', release, true)
  return () => {
    target.removeEventListener('pointerdown', onDown, true)
    target.removeEventListener('pointerup', release, true)
    target.removeEventListener('pointercancel', release, true)
    release()
  }
}

/** Inputs where Ctrl+Z belongs to the text field, not to the settings history. */
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image'])

export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true
  return target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type)
}

/**
 * Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z and Ctrl+Y = redo, ignored while typing in a text field.
 * Returns the function that removes the listener.
 */
export function installHistoryShortcuts(history: History, target: Window = window, enabled: () => boolean = () => true): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing || isTextEntry(e.target) || !enabled()) return
    const key = e.key.toLowerCase()
    if (key === 'z') {
      if (e.shiftKey) history.redo()
      else history.undo()
    } else if (key === 'y' && e.ctrlKey && !e.shiftKey) {
      history.redo()
    } else {
      return
    }
    e.preventDefault()
  }
  target.addEventListener('keydown', onKeyDown)
  return () => target.removeEventListener('keydown', onKeyDown)
}

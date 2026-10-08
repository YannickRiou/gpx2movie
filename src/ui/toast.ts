/**
 * Short messages over the view (« toasts »): import, project, presets, export, reset of a settings group.
 * Success and info messages go away on their own (`toastDuration`, paused while hovered or focused); errors stay until
 * closed. The list logic is pure (`pushToast`); `Toaster.tsx` draws the store.
 */
import { create } from 'zustand'

export type ToastKind = 'success' | 'info' | 'error'

export interface ToastAction {
  label: string
  run(): void
}

export interface Toast {
  id: number
  kind: ToastKind
  text: string
  action?: ToastAction
}

export type ToastInput = Omit<Toast, 'id'>

/** Messages shown at once; the oldest that is not an error goes first. */
export const MAX_TOASTS = 4
export const TOAST_MIN_MS = 5000
const TOAST_MAX_MS = 12000
/** reading time per character beyond the minimum */
const TOAST_MS_PER_CHAR = 60

/** How long a success or info message stays: 5 s, longer for a long text (up to 12 s). */
export function toastDuration(text: string): number {
  return Math.min(TOAST_MAX_MS, Math.max(TOAST_MIN_MS, text.length * TOAST_MS_PER_CHAR))
}

/** `list` with `toast` added last: the same message shown again replaces the old one; at most `max` messages. */
export function pushToast(list: readonly Toast[], toast: Toast, max = MAX_TOASTS): Toast[] {
  const next = [...list.filter((t) => t.kind !== toast.kind || t.text !== toast.text), toast]
  while (next.length > max) {
    const oldest = next.findIndex((t) => t.kind !== 'error')
    next.splice(oldest >= 0 && oldest < next.length - 1 ? oldest : 0, 1)
  }
  return next
}

interface ToastState {
  toasts: Toast[]
}

export const useToastStore = create<ToastState>(() => ({ toasts: [] }))

let nextId = 1

/** Show a message; returns its id (for `dismissToast`). */
export function showToast(toast: ToastInput): number {
  const id = nextId++
  useToastStore.setState((s) => ({ toasts: pushToast(s.toasts, { ...toast, id }) }))
  return id
}

export function dismissToast(id: number): void {
  useToastStore.setState((s) => (s.toasts.some((t) => t.id === id) ? { toasts: s.toasts.filter((t) => t.id !== id) } : s))
}

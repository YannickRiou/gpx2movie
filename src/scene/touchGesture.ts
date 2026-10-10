/**
 * Touch gesture on the 3D view: fingers moving the view (orbit, pinch), for FlyoverCanvas to lower the pixel ratio on
 * a phone while they do (core/deviceBudget.ts). The mouse is ignored.
 */

/** A finger that travels this far (CSS px) moves the view: a tap does not. */
const TOUCH_MOVE_PX = 6
/** The gesture lasts this long (ms) after the last finger lifts: the controls' damping, and no flip between gestures. */
export const TOUCH_SETTLE_MS = 400

/**
 * Calls `onChange(true)` once fingers move the view on `target`, `onChange(false)` TOUCH_SETTLE_MS after the last one
 * lifts (a new touch in between keeps the gesture). Touch only: the mouse is ignored. Returns the cleanup.
 */
export function watchTouchGesture(target: EventTarget, onChange: (active: boolean) => void): () => void {
  const starts = new Map<number, { x: number; y: number }>()
  let active = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const onDown = (e: Event) => {
    const p = e as PointerEvent
    if (p.pointerType !== 'touch') return
    starts.set(p.pointerId, { x: p.clientX, y: p.clientY })
    clearTimeout(timer)
  }
  const onMove = (e: Event) => {
    const p = e as PointerEvent
    const start = starts.get(p.pointerId)
    if (active || !start || Math.hypot(p.clientX - start.x, p.clientY - start.y) < TOUCH_MOVE_PX) return
    active = true
    onChange(true)
  }
  const onUp = (e: Event) => {
    if (!starts.delete((e as PointerEvent).pointerId) || starts.size > 0 || !active) return
    timer = setTimeout(() => {
      active = false
      onChange(false)
    }, TOUCH_SETTLE_MS)
  }
  const events: [string, (e: Event) => void][] = [
    ['pointerdown', onDown],
    ['pointermove', onMove],
    ['pointerup', onUp],
    ['pointercancel', onUp],
  ]
  for (const [type, listener] of events) target.addEventListener(type, listener)
  return () => {
    clearTimeout(timer)
    for (const [type, listener] of events) target.removeEventListener(type, listener)
  }
}

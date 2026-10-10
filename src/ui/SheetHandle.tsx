import { useRef } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { SHEET_SNAPS, settleSheet } from './shell'
import type { SheetSnap } from './shell'

/** Travel (CSS pixels) beyond which a press on the handle is a drag, not a tap. */
const DRAG_SLOP_PX = 6
const ORDER = Object.keys(SHEET_SNAPS) as SheetSnap[]

interface Drag {
  sheet: HTMLElement
  y0: number
  h0: number
  /** height from the top of the shell body to the bottom of the sheet */
  room: number
  y: number
  t: number
  /** rooms per second, up positive */
  velocity: number
  moved: boolean
}

const snapOf = (sheet: HTMLElement): SheetSnap => (sheet.dataset.snap as SheetSnap | undefined) ?? 'half'

/**
 * Grip at the top of a bottom sheet (portrait phone only, hidden by shell.css otherwise): drag between the snaps
 * (`data-snap` on its parent: peek, half, full), down past the peek closes; a tap switches half / full, the arrows step.
 */
export function SheetHandle({ onClose }: { onClose(): void }) {
  const drag = useRef<Drag | null>(null)
  const dragged = useRef(false)

  const settle = (sheet: HTMLElement, snap: SheetSnap | null) => {
    sheet.style.height = ''
    sheet.style.transition = ''
    sheet.dataset.snap = snap ?? 'half'
    if (snap === null) onClose()
  }
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    const sheet = e.currentTarget.parentElement
    if (!sheet || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragged.current = false
    drag.current = { sheet, y0: e.clientY, h0: sheet.offsetHeight, room: sheet.offsetTop + sheet.offsetHeight, y: e.clientY, t: e.timeStamp, velocity: 0, moved: false }
  }
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    if (!d) return
    const dt = (e.timeStamp - d.t) / 1000
    if (dt > 0) d.velocity = (d.y - e.clientY) / d.room / dt
    d.y = e.clientY
    d.t = e.timeStamp
    if (!d.moved && Math.abs(e.clientY - d.y0) < DRAG_SLOP_PX) return
    d.moved = true
    d.sheet.style.transition = 'none'
    d.sheet.style.height = `${Math.max(0, Math.min(d.room, d.h0 + d.y0 - e.clientY))}px`
  }
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return
    dragged.current = true
    // a pause before the release is no flick
    const velocity = e.timeStamp - d.t > 100 ? 0 : d.velocity
    settle(d.sheet, settleSheet(d.sheet.offsetHeight / d.room, velocity))
  }
  const onPointerCancel = () => {
    const d = drag.current
    drag.current = null
    if (d) settle(d.sheet, snapOf(d.sheet))
  }
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const sheet = e.currentTarget.parentElement
    if (!sheet || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const i = ORDER.indexOf(snapOf(sheet)) + (e.key === 'ArrowUp' ? 1 : -1)
    settle(sheet, i < 0 ? null : ORDER[Math.min(i, ORDER.length - 1)])
  }

  return (
    <button
      type="button"
      className="sheet-handle"
      aria-label="Agrandir ou réduire le panneau"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        // the click that ends a drag
        if (dragged.current) {
          dragged.current = false
          return
        }
        const sheet = e.currentTarget.parentElement
        if (sheet) settle(sheet, snapOf(sheet) === 'full' ? 'half' : 'full')
      }}
    >
      <span className="sheet-handle__bar" aria-hidden="true" />
    </button>
  )
}

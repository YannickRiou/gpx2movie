/**
 * TrackPicker — direct manipulation of the first track in the 3D view: a click on the line moves the playhead there
 * (film time of that progress), a right-click opens a small menu « Ajouter un arrêt ici » / « Ajouter un texte ici » /
 * « Accélérer / ralentir ici » (`TrackMenu`, DOM, next to the canvas); the cursor becomes a pointer over the line. A press that travels
 * `CLICK_SLOP_PX` or more is a camera drag (OrbitControls), not a click. Nothing during an export.
 *
 * Picking is in screen space (`pickProjectedPath`, pure): samples of the path draped like the line (terrain height, else
 * recorded elevation, × exaggeration + lift), projected with the camera, nearest within `PICK_RADIUS_PX`. A part of the
 * line hidden by the relief can be picked too (the line shows it in transparency).
 */
import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { create } from 'zustand'
import { isExportBusy, useExportStore } from '../export/store'
import { filmClockFor } from '../film/clock'
import { addSpeed, addStop, addText } from '../film/timeline'
import { buildTrackPath, pickProjectedPath, samplePath } from '../flyover/path'
import { useAppStore } from '../state/store'
import { useTerrainContext } from './TerrainLayer'
import { LINE_LIFT_M } from './TrackLines'
import { editFilm, getFilmSource, useFilmClock } from './usePacing'

/** Pointer distance to the line that still picks it (CSS pixels). */
const PICK_RADIUS_PX = 12
/** Travel between press and release beyond which the press was a camera drag. */
const CLICK_SLOP_PX = 4
/** Samples of the path projected on screen (evenly spaced along it; between two of them the pick interpolates). */
const PICK_SAMPLES = 1500
/** Draped positions are recomputed after this delay (the terrain keeps loading finer tiles). */
const DRAPE_TTL_MS = 1000
/** Room the menu needs before it opens on the other side of the pointer (CSS pixels). */
const MENU_ROOM = { width: 220, height: 136 }

interface TrackMenuState {
  /** position in the canvas (CSS pixels), distance along the first track, open towards the left / the top */
  menu: { x: number; y: number; atM: number; left: boolean; up: boolean } | null
}

const useTrackMenu = create<TrackMenuState>(() => ({ menu: null }))
const closeMenu = () => useTrackMenu.setState({ menu: null })
const exporting = () => isExportBusy(useExportStore.getState().phase)

/** Picks the first track under the pointer; mounted inside the terrain layer of the canvas. */
export function TrackPicker() {
  const camera = useThree((s) => s.camera)
  const canvas = useThree((s) => s.gl.domElement)
  const { engine, frame } = useTerrainContext()
  const track = useAppStore((s) => s.tracks[0])
  const exaggeration = useAppStore((s) => s.settings.exaggeration)
  const clock = useFilmClock()
  const clockRef = useRef(clock)
  useEffect(() => {
    clockRef.current = clock
  }, [clock])

  const samples = useMemo(() => {
    const path = track ? buildTrackPath(track) : null
    if (!path || path.count < 2 || path.lengthM <= 0) return null
    const n = PICK_SAMPLES
    const distM = new Float64Array(n)
    const lon = new Float64Array(n)
    const lat = new Float64Array(n)
    const ele = new Float64Array(n)
    for (let k = 0; k < n; k++) {
      distM[k] = (k / (n - 1)) * path.lengthM
      const p = samplePath(path, distM[k])
      lon[k] = p.lon
      lat[k] = p.lat
      ele[k] = p.ele ?? Number.NaN
    }
    return { distM, lon, lat, ele, lengthM: path.lengthM }
  }, [track])
  /** draped local positions (xyz per sample) and when they were computed */
  const drapeRef = useRef<{ at: number; world: Float32Array } | null>(null)

  useEffect(() => {
    drapeRef.current = null
    if (!samples || !frame) return
    const v = new Vector3()
    const screen = new Float32Array(samples.distM.length * 2)

    const drape = () => {
      const now = performance.now()
      const cached = drapeRef.current
      if (cached && now - cached.at < DRAPE_TTL_MS) return cached.world
      const world = cached?.world ?? new Float32Array(samples.distM.length * 3)
      for (let k = 0; k < samples.distM.length; k++) {
        let h = engine?.sampleHeight(samples.lon[k], samples.lat[k])
        if (h === undefined || Number.isNaN(h)) h = Number.isNaN(samples.ele[k]) ? 0 : samples.ele[k]
        frame.toLocal(samples.lon[k], samples.lat[k], h * exaggeration + LINE_LIFT_M, v)
        world[3 * k] = v.x
        world[3 * k + 1] = v.y
        world[3 * k + 2] = v.z
      }
      drapeRef.current = { at: now, world }
      return world
    }

    /** distance along the track under the pointer, undefined when the line is not there */
    const pick = (e: PointerEvent): number | undefined => {
      const rect = canvas.getBoundingClientRect()
      const world = drape()
      for (let k = 0; k < samples.distM.length; k++) {
        v.set(world[3 * k], world[3 * k + 1], world[3 * k + 2]).project(camera)
        const behind = v.z < -1 || v.z > 1
        screen[2 * k] = behind ? Number.NaN : ((v.x + 1) / 2) * rect.width
        screen[2 * k + 1] = behind ? Number.NaN : ((1 - v.y) / 2) * rect.height
      }
      return pickProjectedPath(screen, samples.distM, e.clientX - rect.left, e.clientY - rect.top, PICK_RADIUS_PX)
    }

    let press: { x: number; y: number; button: number } | null = null
    const onPointerDown = (e: PointerEvent) => {
      press = { x: e.clientX, y: e.clientY, button: e.button }
    }
    const onPointerUp = (e: PointerEvent) => {
      const p = press
      press = null
      if (!p || p.button !== e.button || exporting() || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= CLICK_SLOP_PX) return
      const atM = pick(e)
      if (atM === undefined) return
      if (e.button === 0) {
        const clock = clockRef.current
        const progress = atM / samples.lengthM
        const t = clock.timeAtProgress(progress)
        useAppStore.getState().setProgress(progress, t < clock.totalTime() ? t : null)
      } else if (e.button === 2) {
        const rect = canvas.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        useTrackMenu.setState({ menu: { x, y, atM, left: x > rect.width - MENU_ROOM.width, up: y > rect.height - MENU_ROOM.height } })
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (e.buttons !== 0) return
      canvas.style.cursor = !exporting() && pick(e) !== undefined ? 'pointer' : ''
    }
    const onPointerLeave = () => {
      canvas.style.cursor = ''
    }
    // the menu replaces the browser's (the camera pans with a right drag)
    const onContextMenu = (e: MouseEvent) => e.preventDefault()

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('contextmenu', onContextMenu)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('contextmenu', onContextMenu)
      canvas.style.cursor = ''
    }
  }, [samples, frame, engine, exaggeration, camera, canvas])

  useEffect(() => closeMenu, [track])
  return null
}

/**
 * Menu of a right-click on the track (DOM, positioned in the canvas wrapper): add a stop, a text or a speed portion
 * there (×2 from that point; inside a portion, that portion is selected), one undo step each, the new block selected. Closes on Escape, on a click elsewhere, when the focus leaves it and on export.
 */
type Item = 'stop' | 'text' | 'speed'

export function TrackMenu() {
  const menu = useTrackMenu((s) => s.menu)
  const busy = useExportStore((s) => isExportBusy(s.phase))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    ref.current?.querySelector('button')?.focus()
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) closeMenu()
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', closeMenu)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('resize', closeMenu)
    }
  }, [menu])
  useEffect(() => {
    if (busy) closeMenu()
  }, [busy])

  if (!menu || busy) return null
  const add = (what: Item) => {
    closeMenu()
    const source = getFilmSource()
    const lengthM = source.track?.stats.distanceM ?? 0
    if (lengthM <= 0) return
    if (what === 'stop') editFilm((f) => addStop(f, Math.round(menu.atM)), { stops: true })
    else if (what === 'text') editFilm((f) => addText(f, filmClockFor(source).timeAtProgress(menu.atM / lengthM)))
    else {
      const atM = Math.round(menu.atM)
      editFilm((f) => addSpeed(f, atM, lengthM) ?? { film: f, id: f.speeds.find((s) => atM >= s.fromM && atM < s.toM)?.id })
    }
  }
  const items: { what: Item; label: string }[] = [
    { what: 'stop', label: 'Ajouter un arrêt ici' },
    { what: 'text', label: 'Ajouter un texte ici' },
    { what: 'speed', label: 'Accélérer / ralentir ici' },
  ]

  return (
    <div
      ref={ref}
      className="track-menu"
      role="menu"
      aria-label="Ajouter sur la trace"
      data-local-escape=""
      style={{ left: menu.x, top: menu.y, transform: `translate(${menu.left ? '-100%' : '0'}, ${menu.up ? '-100%' : '0'})` }}
      onKeyDown={(e) => {
        const buttons = Array.from(ref.current?.querySelectorAll('button') ?? [])
        const index = buttons.findIndex((b) => b === document.activeElement)
        if (e.key === 'Escape') closeMenu()
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          const step = e.key === 'ArrowDown' ? 1 : -1
          buttons[(index + step + buttons.length) % buttons.length]?.focus()
        } else return
        e.preventDefault()
        e.stopPropagation()
      }}
      onBlur={(e) => {
        // the focus went elsewhere (Tab); a click outside is caught by the pointer listener
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) closeMenu()
      }}
    >
      {items.map((item) => (
        <button key={item.what} type="button" role="menuitem" className="track-menu__item" tabIndex={-1} onClick={() => add(item.what)}>
          {item.label}
        </button>
      ))}
    </div>
  )
}

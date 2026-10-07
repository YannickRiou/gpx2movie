/**
 * Film timeline under the 3D view, in film time (opening and closing included).
 *
 * Bar: play / pause, film time, distance, altitude and recorded time at the marker, add a stop (at the playhead
 * or at a highlight), a text or photos, automatic stops, « modifié » marker of the film, speed, fold. Ruler: click
 * or drag to scrub (also a keyboard slider). Lanes « Plans » (opening, flight with its elevation profile, closing),
 * « Arrêts », « Textes », « Médias » (photos also dropped onto the timeline; those taken along the track can then be
 * placed where they were taken): drag a block to move it, an edge to stretch it, snapping to the other edges, the
 * highlights and the playhead (Alt: no snapping); Ctrl+wheel zooms. Keyboard on a block: arrows nudge (Shift:
 * finer), Delete removes, Escape deselects; Space plays / pauses anywhere outside a control.
 *
 * A gesture is previewed on the timeline only and committed on release as one undo step. Edits are the pure
 * functions of `film/timeline.ts`; editing a stop writes the generated stops out first (`materializeStops`).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { materializeStops, stopCandidates } from '../film/assemble'
import { buildFilmClock, filmClockInputFor } from '../film/clock'
import { photoTimeMs } from '../film/exif'
import { readPhoto, useMediaStore } from '../film/media'
import type { Film, FilmMedia, FilmStop } from '../film/model'
import {
  ZOOM_RANGE,
  addPhotos,
  addStop,
  addText,
  dragFilm,
  fitPxPerS,
  formatFilmTime,
  photoFilmTime,
  removeFilmItem,
  rulerTicks,
  snapTargets,
  updateMedia,
  updateShot,
  zoomAt,
} from '../film/timeline'
import type { DragContext, Grip, TimelineItem } from '../film/timeline'
import { buildTrackPath, elevationProfile, recordedTimeAt, samplePath, type ElevationProfile } from '../flyover/path'
import { getSettingsHistory } from '../project/history'
import { useFilmClock, useFilmSource } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { FilmInspector } from './FilmInspector'
import { formatDistance, formatNumber } from './format'
import { ModifiedMarker } from './ModifiedMarker'

const SPEEDS = [0.5, 1, 2, 4]
/** Profile resolution (samples over the track) and drawing height in viewBox units. */
const PROFILE_SAMPLES = 400
const PROFILE_HEIGHT = 100
/** Smallest elevation range drawn full height: a flat track stays flat instead of magnifying GPS noise. */
const PROFILE_MIN_SPAN_M = 100
/** Blank space at both ends of the lanes, so that the edges of the first and last blocks can be grabbed. */
const PAD_PX = 10
const SNAP_PX = 8
/** Pointer travel before a press on a block becomes a drag (a shorter one only selects). */
const DRAG_THRESHOLD_PX = 3
const NUDGE_S = 1
const FINE_NUDGE_S = 0.1
const WHEEL_ZOOM = 1.2

/** Message under the bar after adding photos: what was added, and the photos that can be placed on the track. */
interface PhotoNotice {
  text: string
  placements: { id: string; startS: number }[]
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

type Gesture =
  | { kind: 'scrub' }
  | { kind: 'edit'; item: TimelineItem; grip: Grip; x0: number; start: Film; ctx: DragContext; result: Film | null }

/** Recorded instant -> "14 h 32", in the browser time zone. */
function formatClock(ms: number): string {
  const date = new Date(ms)
  return `${date.getHours()} h ${String(date.getMinutes()).padStart(2, '0')}`
}

/** Closed SVG area under the profile at abscissas `xs`, one sub-path per run of known elevations. */
function profileAreaPath(profile: ElevationProfile, xs: readonly number[]): string {
  const { ele, minEle, maxEle } = profile
  const span = Math.max(maxEle - minEle, PROFILE_MIN_SPAN_M)
  let d = ''
  let runStart = -1
  for (let i = 0; i <= ele.length; i++) {
    const known = i < ele.length && !Number.isNaN(ele[i])
    if (known) {
      const x = xs[i].toFixed(2)
      const y = (PROFILE_HEIGHT * (1 - 0.9 * ((ele[i] - minEle) / span))).toFixed(1)
      d += runStart < 0 ? `M${x} ${PROFILE_HEIGHT}L${x} ${y}` : `L${x} ${y}`
      if (runStart < 0) runStart = i
    } else if (runStart >= 0) {
      d += `L${xs[i - 1].toFixed(2)} ${PROFILE_HEIGHT}Z`
      runStart = -1
    }
  }
  return d
}

export function Timeline() {
  const source = useFilmSource()
  const { track, film, durationS, pacing, landmarks } = source
  const clock = useFilmClock()
  const { playing, progress, timeS: storedTimeS, speed } = useAppStore((s) => s.playback)
  const setPlaying = useAppStore((s) => s.setPlaying)
  const setProgress = useAppStore((s) => s.setProgress)
  const setSpeed = useAppStore((s) => s.setSpeed)
  const setSetting = useAppStore((s) => s.setSetting)
  const pictures = useMediaStore((s) => s.table)
  const id = useId()
  const clipId = `profile-played-${id.replace(/[^\w-]/g, '')}`

  const path = useMemo(() => (track ? buildTrackPath(track) : null), [track])
  const profile = useMemo(() => (path ? elevationProfile(path, PROFILE_SAMPLES) : undefined), [path])
  const input = useMemo(
    () => filmClockInputFor({ track, film, durationS, pacing, landmarks }),
    [track, film, durationS, pacing, landmarks],
  )
  const candidates = useMemo(() => (track ? stopCandidates({ track, landmarks, pacing }) : []), [track, landmarks, pacing])

  const [selected, setSelected] = useState<TimelineItem | null>(null)
  /** film being dragged (shown on the timeline only), committed on release */
  const [draft, setDraft] = useState<Film | null>(null)
  const [zoom, setZoom] = useState<number>(ZOOM_RANGE.min)
  const [collapsed, setCollapsed] = useState(false)
  const [width, setWidth] = useState(0)
  const [notice, setNotice] = useState<PhotoNotice | null>(null)
  const [reading, setReading] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  /** zoom for the wheel listener */
  const zoomRef = useRef(zoom)
  /** scroll to apply once the zoomed content is laid out */
  const pendingScrollRef = useRef<number | null>(null)

  const shownFilm = draft ?? film
  const shownClock = useMemo(
    () =>
      draft
        ? buildFilmClock({ ...input, opening: draft.opening, closing: draft.closing, stops: draft.autoStops ? input.stops : draft.stops })
        : clock,
    [draft, input, clock],
  )
  const flightXs = useMemo(() => {
    const n = profile?.ele.length ?? 0
    return Array.from({ length: n }, (_, i) => shownClock.timeAtProgress(i / Math.max(1, n - 1)) - shownClock.openingS)
  }, [profile, shownClock])
  const area = useMemo(() => (profile ? profileAreaPath(profile, flightXs) : ''), [profile, flightXs])

  const hasTrack = track !== undefined
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    // Ctrl+wheel zooms around the pointer (a passive React listener could not prevent the page zoom)
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || e.deltaY === 0) return
      e.preventDefault()
      const next = zoomAt(zoomRef.current, e.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM, e.clientX - el.getBoundingClientRect().left, el.scrollLeft)
      pendingScrollRef.current = next.scrollLeft
      setZoom(next.zoom)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      observer.disconnect()
      el.removeEventListener('wheel', onWheel)
    }
  }, [collapsed, hasTrack])

  useLayoutEffect(() => {
    zoomRef.current = zoom
    if (pendingScrollRef.current !== null && scrollerRef.current) scrollerRef.current.scrollLeft = pendingScrollRef.current
    pendingScrollRef.current = null
  }, [zoom])

  useEffect(() => {
    // Space plays / pauses, except in a control that uses it
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== ' ' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const target = e.target
      const control = 'input, textarea, select, button, a[href], [role="slider"]'
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest(control))) return
      const store = useAppStore.getState()
      if (store.tracks.length === 0) return
      e.preventDefault()
      store.setPlaying(!store.playback.playing)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!track || !path) return null

  const lengthM = track.stats.distanceM
  const total = shownClock.totalTime()
  // the scale follows the committed film: it does not change while an edge is dragged
  const pxPerS = fitPxPerS(Math.max(0, width - 2 * PAD_PX), clock.totalTime()) * zoom
  const xOf = (t: number) => PAD_PX + t * pxPerS
  const contentWidth = Math.max(width, Math.ceil(xOf(total) + PAD_PX))
  const playheadS = Math.min(storedTimeS ?? clock.timeAtProgress(progress), clock.totalTime())
  const ele = profile && path.count > 0 ? samplePath(path, progress * path.lengthM).ele : undefined
  // startTime is set as soon as one point has a time: skips the scan of an untimed track
  const time = track.stats.startTime !== undefined && path.count > 0 ? recordedTimeAt(path, progress * path.lengthM) : undefined
  const stoppedAt = (atM: number) => shownClock.stops.some((s) => Math.abs(s.atM - atM) < 1)
  const freeCandidates = candidates.filter((c) => !stoppedAt(c.atM))

  // --- edits -------------------------------------------------------------------------------------------------
  const isStop = (item: TimelineItem) => clock.stops.some((s) => s.id === item)
  const withOwnStops = (f: Film) => materializeStops(f, { track, landmarks, pacing })
  /** one undo step */
  const commit = (next: Film) => {
    if (next !== film) getSettingsHistory().transaction(() => setSetting('film', next))
  }
  /** edits of the inspector and nudges (quick changes of the film are merged into one undo step) */
  const change = (fn: (f: Film) => Film, stops: boolean) => {
    const next = fn(stops ? withOwnStops(film) : film)
    if (next !== film) setSetting('film', next)
  }
  const dragContext = (item: TimelineItem): DragContext => ({
    clock,
    clockOf: (stops: readonly FilmStop[]) => buildFilmClock({ ...input, stops }),
    lengthM,
    targets: snapTargets(clock, film, candidates.map((c) => c.atM / lengthM), playheadS, item),
    targetsM: candidates.map((c) => c.atM),
    snapS: SNAP_PX / pxPerS,
  })
  const remove = (item: TimelineItem) => {
    if (item === 'opening' || item === 'closing') commit(updateShot(film, item, { style: 'aucune' }))
    else commit(removeFilmItem(isStop(item) ? withOwnStops(film) : film, item))
    setSelected(null)
  }
  const addStopAt = (atM: number, patch?: Parameters<typeof addStop>[2]) => {
    const added = addStop(withOwnStops(film), atM, patch)
    commit(added.film)
    setSelected(added.id)
  }
  /** photos added at the playhead, one after the other (one undo step); offers to place them on the track */
  const addPhotoFiles = async (files: readonly File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'))
    const others = files.length - images.length
    const unsupported = others > 0 ? ` ${plural(others, 'fichier ignoré', 'fichiers ignorés')} : seules les photos sont prises en charge (vidéos : bientôt).` : ''
    if (images.length === 0) {
      setNotice({ text: unsupported.trim(), placements: [] })
      return
    }
    const startS = playheadS
    setReading(true)
    const read: Awaited<ReturnType<typeof readPhoto>>[] = []
    const failed: string[] = []
    for (const file of images) {
      try {
        read.push(await readPhoto(file, file.name))
      } catch (err) {
        failed.push(`« ${file.name} » : ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    setReading(false)
    const errors = failed.length > 0 ? ` Non ajoutées : ${failed.join(' ; ')}` : ''
    if (read.length === 0) {
      setNotice({ text: `${errors}${unsupported}`.trim(), placements: [] })
      return
    }
    const srcs = useMediaStore.getState().add(read.map((r) => r.asset))
    const added = addPhotos(useAppStore.getState().settings.film, startS, srcs)
    commit(added.film)
    setSelected(added.ids[0])
    const placements = added.ids.flatMap((photoId, k) => {
      const t = photoFilmTime(path, clock, { lon: read[k].exif.lon, lat: read[k].exif.lat, timeMs: photoTimeMs(read[k].exif) })
      return t === undefined ? [] : [{ id: photoId, startS: t }]
    })
    const n = placements.length
    const located =
      n === 0
        ? ''
        : n === 1
          ? ` ${read.length === 1 ? 'Elle' : "L'une d'elles"} a été prise le long du parcours : la placer au moment où le marqueur y passe ?`
          : ` ${n} ont été prises le long du parcours : les placer au moment où le marqueur y passe ?`
    setNotice({ text: `${plural(read.length, 'photo ajoutée', 'photos ajoutées')} à la tête de lecture.${located}${errors}${unsupported}`, placements })
  }
  const placePhotos = (placements: PhotoNotice['placements']) => {
    commit(placements.reduce((f, p) => updateMedia(f, p.id, { startS: p.startS }), useAppStore.getState().settings.film))
    setNotice(null)
  }
  const toggleAutoStops = (on: boolean) =>
    commit(on ? { ...film, autoStops: true, autoMode: 'temps-forts', stops: [] } : withOwnStops(film))

  // --- pointer -----------------------------------------------------------------------------------------------
  const timeAt = (clientX: number) => (clientX - (contentRef.current?.getBoundingClientRect().left ?? 0) - PAD_PX) / pxPerS
  const seek = (t: number) => {
    const end = clock.totalTime()
    const c = Math.min(end, Math.max(0, t))
    setProgress(clock.progressAtTime(c), c < end ? c : null)
  }
  const onContentPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    gestureRef.current = { kind: 'scrub' }
    seek(timeAt(e.clientX))
  }
  const startEdit = (e: PointerEvent<HTMLElement>, item: TimelineItem, grip: Grip) => {
    if (e.button !== 0) return
    e.stopPropagation()
    setSelected(item)
    contentRef.current?.setPointerCapture(e.pointerId)
    const start = isStop(item) ? withOwnStops(film) : film
    gestureRef.current = { kind: 'edit', item, grip, x0: e.clientX, start, ctx: dragContext(item), result: null }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current
    if (!g) return
    if (g.kind === 'scrub') return seek(timeAt(e.clientX))
    const dx = e.clientX - g.x0
    if (!g.result && Math.abs(dx) < DRAG_THRESHOLD_PX) return
    g.result = dragFilm(g.start, g.item, g.grip, dx / pxPerS, e.altKey ? { ...g.ctx, snapS: 0 } : g.ctx)
    setDraft(g.result)
  }
  const endGesture = (e: PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current
    gestureRef.current = null
    if (g?.kind === 'edit' && g.result && e.type === 'pointerup') commit(g.result)
    setDraft(null)
  }

  // --- keyboard ----------------------------------------------------------------------------------------------
  const onBlockKeyDown = (e: KeyboardEvent<HTMLElement>, item: TimelineItem) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      remove(item)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const step = (e.shiftKey ? FINE_NUDGE_S : NUDGE_S) * (e.key === 'ArrowLeft' ? -1 : 1)
      const grip: Grip = item === 'closing' ? 'start' : item === 'opening' ? 'end' : 'move'
      change((f) => dragFilm(f, item, grip, step, { ...dragContext(item), snapS: 0 }), isStop(item))
    } else {
      return
    }
    e.preventDefault()
  }
  const onRulerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, PageDown: -10, PageUp: 10 }
    if (e.key === 'Home') seek(0)
    else if (e.key === 'End') seek(clock.totalTime())
    else if (e.key in steps) seek(playheadS + steps[e.key] * (e.shiftKey ? 5 : 1))
    else return
    e.preventDefault()
  }
  const zoomBy = (factor: number) => {
    const el = scrollerRef.current
    // keep the playhead in place
    const next = zoomAt(zoom, factor, el ? xOf(playheadS) - el.scrollLeft : 0, el?.scrollLeft ?? 0)
    pendingScrollRef.current = next.scrollLeft
    setZoom(next.zoom)
  }

  // --- blocks ------------------------------------------------------------------------------------------------
  const block = (
    item: TimelineItem,
    startS: number,
    endS: number,
    label: string,
    description: string,
    className: string,
    grips: Grip[],
    thumb?: string,
  ) => (
    <div
      key={item}
      role="button"
      tabIndex={0}
      aria-pressed={selected === item}
      aria-label={`${description}, de ${formatFilmTime(startS)} à ${formatFilmTime(endS)}`}
      title={label}
      className={`film-tl__block ${className}${selected === item ? ' film-tl__block--selected' : ''}`}
      style={{ left: xOf(startS), width: Math.max(0, (endS - startS) * pxPerS) }}
      onPointerDown={(e) => {
        if (grips.includes('move')) return startEdit(e, item, 'move')
        // a shot: select it and scrub
        e.stopPropagation()
        setSelected(item)
        onContentPointerDown(e)
      }}
      onFocus={() => setSelected(item)}
      onKeyDown={(e) => onBlockKeyDown(e, item)}
    >
      {grips.includes('start') && <span className="film-tl__grip film-tl__grip--start" onPointerDown={(e) => startEdit(e, item, 'start')} />}
      {thumb && <img className="film-tl__thumb" src={thumb} alt="" draggable={false} />}
      <span className="film-tl__label">{label}</span>
      {grips.includes('end') && <span className="film-tl__grip film-tl__grip--end" onPointerDown={(e) => startEdit(e, item, 'end')} />}
    </div>
  )
  const opening = shownFilm.opening
  const closing = shownFilm.closing
  const flightStart = shownClock.openingS
  const flightEnd = flightStart + shownClock.flightS
  const ticks = rulerTicks(total, pxPerS)
  const selectedExists =
    selected === 'opening' ||
    selected === 'closing' ||
    shownClock.stops.some((s) => s.id === selected) ||
    shownFilm.texts.some((t) => t.id === selected) ||
    shownFilm.media.some((m) => m.id === selected)
  const mediaLabel = (m: FilmMedia) => m.caption?.trim() || pictures[m.src]?.name || 'Photo'

  return (
    <div
      className="film-tl"
      role="group"
      aria-label={`Timeline du film : ${track.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && selected) {
          setSelected(null)
          e.stopPropagation()
        }
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return
        e.preventDefault()
        void addPhotoFiles(Array.from(e.dataTransfer.files))
      }}
    >
      <div className="film-tl__bar">
        <button
          type="button"
          className="btn btn--primary film-tl__play"
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? 'Mettre en pause' : 'Lancer le film'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="film-tl__time">
          <strong>{formatFilmTime(playheadS, true)}</strong> / {formatFilmTime(clock.totalTime())}
        </span>
        <span className="film-tl__readout">
          {formatDistance(progress * lengthM)} / {formatDistance(lengthM)}
          {ele !== undefined && (
            <>
              {' · '}
              <span className="visually-hidden">Altitude : </span>
              {formatNumber(ele)} m
            </>
          )}
          {time !== undefined && (
            <>
              {' · '}
              <span className="visually-hidden">Heure enregistrée : </span>
              <time dateTime={new Date(time).toISOString()}>{formatClock(time)}</time>
            </>
          )}
        </span>
        <span className="film-tl__spacer" />
        <button type="button" className="film-tl__btn" onClick={() => addStopAt(progress * lengthM)} title="Ajouter un arrêt à la position du marqueur">
          + Arrêt
        </button>
        {freeCandidates.length > 0 && (
          <select
            className="film-tl__select"
            aria-label="Ajouter un arrêt à un temps fort"
            value=""
            onChange={(e) => {
              const c = freeCandidates[Number(e.currentTarget.value)]
              if (c) addStopAt(c.atM, { label: c.label, source: c.source })
            }}
          >
            <option value="" disabled>
              Arrêt à un temps fort…
            </option>
            {freeCandidates.map((c, i) => (
              <option key={`${c.source.kind}-${c.source.ref}`} value={i}>
                {c.label} · {formatDistance(c.atM)}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="film-tl__btn"
          onClick={() => {
            const added = addText(film, playheadS)
            commit(added.film)
            setSelected(added.id)
          }}
          title="Ajouter un texte à la tête de lecture"
        >
          + Texte
        </button>
        <button
          type="button"
          className="film-tl__btn"
          onClick={() => photoInputRef.current?.click()}
          disabled={reading}
          title="Ajouter des photos à la tête de lecture (ou les glisser sur la timeline)"
        >
          {reading ? 'Lecture…' : '+ Photo'}
        </button>
        <input
          ref={photoInputRef}
          className="visually-hidden"
          type="file"
          accept="image/*"
          multiple
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const files = Array.from(e.currentTarget.files ?? [])
            e.currentTarget.value = ''
            if (files.length > 0) void addPhotoFiles(files)
          }}
        />
        <label
          className="film-tl__check"
          title="Arrêts générés aux temps forts (sommets des montées, cols, sommets) ; toute retouche d'un arrêt les fige"
        >
          <input type="checkbox" checked={film.autoStops} onChange={(e) => toggleAutoStops(e.currentTarget.checked)} />
          Arrêts automatiques
        </label>
        <ModifiedMarker keys={['film']} label="Film" />
        <select className="film-tl__select" aria-label="Vitesse de lecture" value={speed} onChange={(e) => setSpeed(Number(e.currentTarget.value))}>
          {SPEEDS.map((value) => (
            <option key={value} value={value}>
              ×{formatNumber(value, value % 1 === 0 ? 0 : 1)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="film-tl__btn film-tl__fold"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls={`${id}-lanes`}
          aria-label={collapsed ? 'Déplier les pistes' : 'Replier les pistes'}
          title={collapsed ? 'Déplier les pistes' : 'Replier les pistes'}
        >
          {collapsed ? '▴' : '▾'}
        </button>
      </div>

      {notice && (
        <div className="film-tl__notice" role="status">
          <span className="film-tl__notice-text">{notice.text}</span>
          {notice.placements.length > 0 && (
            <button type="button" className="film-tl__btn" onClick={() => placePhotos(notice.placements)}>
              Placer sur le parcours
            </button>
          )}
          <button type="button" className="film-tl__btn" onClick={() => setNotice(null)} aria-label="Fermer le message">
            ×
          </button>
        </div>
      )}

      {!collapsed && (
        <div className="film-tl__body" id={`${id}-lanes`}>
          <div className="film-tl__heads">
            <div className="film-tl__head film-tl__head--ruler">
              {[
                { factor: 1 / 1.5, sign: '−', label: 'Zoom arrière', disabled: zoom <= ZOOM_RANGE.min },
                { factor: 1.5, sign: '+', label: 'Zoom avant', disabled: zoom >= ZOOM_RANGE.max },
              ].map(({ factor, sign, label, disabled }) => (
                <button
                  key={sign}
                  type="button"
                  className="film-tl__zoom"
                  onClick={() => zoomBy(factor)}
                  disabled={disabled}
                  aria-label={label}
                  title={`${label} (Ctrl+molette)`}
                >
                  {sign}
                </button>
              ))}
            </div>
            {/* the lanes carry the same names */}
            {['Plans', 'Arrêts', 'Textes', 'Médias'].map((name) => (
              <div key={name} className="film-tl__head" aria-hidden="true">
                {name}
              </div>
            ))}
          </div>
          <div className="film-tl__scroller" ref={scrollerRef}>
            <div
              ref={contentRef}
              className="film-tl__content"
              style={{ width: contentWidth }}
              onPointerDown={onContentPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endGesture}
              onPointerCancel={endGesture}
            >
              <div
                className="film-tl__ruler"
                role="slider"
                tabIndex={0}
                aria-label="Position dans le film"
                aria-valuemin={0}
                aria-valuemax={Math.round(clock.totalTime())}
                aria-valuenow={Math.round(playheadS)}
                aria-valuetext={`${formatFilmTime(playheadS)} sur ${formatFilmTime(clock.totalTime())}`}
                onKeyDown={onRulerKeyDown}
              >
                {ticks.map((t) => (
                  <span key={t} className="film-tl__tick" style={{ left: xOf(t) }}>
                    {formatFilmTime(t)}
                  </span>
                ))}
              </div>

              <div className="film-tl__lane" role="group" aria-label="Plans">
                {block(
                  'opening',
                  0,
                  flightStart,
                  opening.style === 'aucune' ? '' : 'Ouverture',
                  opening.style === 'aucune' ? 'Ouverture : aucune' : 'Ouverture',
                  `film-tl__block--shot${opening.style === 'aucune' ? ' film-tl__block--none' : ''}`,
                  opening.style === 'aucune' ? [] : ['end'],
                )}
                <div className="film-tl__flight" style={{ left: xOf(flightStart), width: (flightEnd - flightStart) * pxPerS }} aria-hidden="true">
                  {profile && shownClock.flightS > 0 && (
                    <svg viewBox={`0 0 ${shownClock.flightS} ${PROFILE_HEIGHT}`} preserveAspectRatio="none">
                      <clipPath id={clipId}>
                        <rect width={Math.max(0, playheadS - flightStart)} height={PROFILE_HEIGHT} />
                      </clipPath>
                      <path className="film-tl__profile-area" d={area} />
                      <path className="film-tl__profile-played" d={area} clipPath={`url(#${clipId})`} />
                    </svg>
                  )}
                  <span className="film-tl__label">Survol · {formatDistance(lengthM)}</span>
                </div>
                {block(
                  'closing',
                  flightEnd,
                  total,
                  closing.style === 'aucune' ? '' : 'Clôture',
                  closing.style === 'aucune' ? 'Clôture : aucune' : 'Clôture',
                  `film-tl__block--shot${closing.style === 'aucune' ? ' film-tl__block--none' : ''}`,
                  closing.style === 'aucune' ? [] : ['start'],
                )}
              </div>

              <div className="film-tl__lane" role="group" aria-label="Arrêts">
                {shownClock.stops.map((s) => {
                  const label = s.label || 'Arrêt'
                  return block(
                    s.id,
                    s.startS,
                    s.endS,
                    label,
                    `Arrêt ${s.camera === 'orbite' ? 'en orbite' : 'caméra fixe'} : ${label}${shownFilm.autoStops ? ' (automatique)' : ''}`,
                    `film-tl__block--stop${shownFilm.autoStops ? ' film-tl__block--auto' : ''}`,
                    ['move', 'end'],
                  )
                })}
              </div>

              <div className="film-tl__lane" role="group" aria-label="Textes">
                {shownFilm.texts.map((t) =>
                  block(t.id, t.startS, t.startS + t.durationS, t.text || 'Texte', `Texte : ${t.text}`, 'film-tl__block--text', [
                    'start',
                    'move',
                    'end',
                  ]),
                )}
              </div>

              <div className="film-tl__lane" role="group" aria-label="Médias">
                {shownFilm.media.map((m) =>
                  block(
                    m.id,
                    m.startS,
                    m.startS + m.durationS,
                    mediaLabel(m),
                    `Photo ${m.layout === 'carte' ? 'en carte' : 'plein écran'} : ${mediaLabel(m)}`,
                    'film-tl__block--media',
                    ['start', 'move', 'end'],
                    pictures[m.src]?.thumb,
                  ),
                )}
              </div>

              <div className="film-tl__playhead" style={{ left: xOf(playheadS) }} aria-hidden="true" />
            </div>
          </div>
        </div>
      )}

      {!collapsed && selected && selectedExists && (
        <FilmInspector
          item={selected}
          film={film}
          clock={clock}
          lengthM={lengthM}
          change={change}
          remove={() => remove(selected)}
          close={() => setSelected(null)}
        />
      )}
    </div>
  )
}

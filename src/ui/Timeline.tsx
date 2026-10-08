/**
 * Film timeline under the 3D view, in film time (opening and closing included).
 *
 * Bar (icon buttons with tooltips): play / pause, stop (back to the first frame), film time, distance, altitude and
 * recorded time at the marker, add a stop (at the playhead or at a highlight), a text or media, speed, zoom (− / slider
 * / + / « Ajuster »), « Options » menu (automatic stops, « modifié » marker of the film), fold. Ruler: click or drag to
 * scrub (also a keyboard slider). Lanes « Plans » (opening, flight with its elevation profile, its stops and its camera
 * keys as diamonds, closing),
 * « Vitesse » (portions of the track flown faster or slower, added at the marker), « Arrêts », « Textes », « Médias » (photos and video clips, also dropped onto the timeline; photos taken along the
 * track can then be placed where they were taken, clips filmed during the outing synced with it), « Musique » (sound files with their waveform, added from the
 * « Options » menu or dropped; played along by the preview, muted by the bar's button, mixed into the export): drag a block to move it, an edge to stretch it, snapping to the other edges, the
 * highlights and the playhead (Alt: no snapping); Ctrl+wheel zooms. Keyboard on a block: arrows nudge (Shift:
 * finer), Delete removes (Escape deselects: `App`); Space plays / pauses anywhere outside a control. The selection
 * lives in the store (`filmSelection`): the inspector of the selected block is in the right dock (`FilmInspector`).
 *
 * A gesture is previewed on the timeline only and committed on release as one undo step. Edits are the pure
 * functions of `film/timeline.ts`; editing a stop writes the generated stops out first (`materializeStops`).
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { errorMessage } from '../core/errors'
import { freezeLandmarkTitles, materializeStops, stopCandidates } from '../film/assemble'
import { AUDIO_FILE_EXTENSIONS, fitFilmToMusic, isAudioFile, musicLengthS, readAudio, startMusicPreview, useMusicPreview, waveformPath } from '../film/audio'
import { beatTicksPath } from '../film/beats'
import { buildFilmClock, filmClockFor, filmClockInputFor } from '../film/clock'
import { photoTimeMs } from '../film/exif'
import { useMediaStore } from '../film/media'
import { isMediaFile, readMedia } from '../film/video'
import { STOP_CAMERA_LABELS, clipHasSound } from '../film/model'
import type { Film, FilmMedia, FilmSpeed, FilmStop } from '../film/model'
import {
  ZOOM_RANGE,
  addMedia,
  addMusic,
  addSpeed,
  addStop,
  addText,
  clipSyncOffsetS,
  dragFilm,
  fitPxPerS,
  formatFilmTime,
  formatSpeedFactor,
  hasFilmItem,
  photoFilmTime,
  removeFilmItem,
  rulerTicks,
  snapTargets,
  syncClip,
  updateMedia,
  zoomAt,
} from '../film/timeline'
import type { DragContext, Grip, TimelineItem } from '../film/timeline'
import { buildTrackPath, elevationProfile, recordedTimeAt, samplePath, type ElevationProfile } from '../flyover/path'
import { getPlatform } from '../platform'
import { modifiedSettings } from '../project/apply'
import { getSettingsHistory } from '../project/history'
import { editFilm, getFilmSource, useFilmClock, useFilmSource } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { formatDistance, formatNumber } from './format'
import { Icon } from './icons'
import type { IconName } from './icons'
import { ModifiedMarker } from './ModifiedMarker'
import { withShortcut } from './shortcuts'
import { showToast } from './toast'

const SPEEDS = [0.5, 1, 2, 4]
/** « Média » picker: pictures and videos recognised on both targets (the desktop types a file by `mimeTypeOf`). */
const MEDIA_FILTERS = [{ name: 'Photos et vidéos', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'mp4', 'm4v', 'mov', 'webm'] }]
const MUSIC_FILTERS = [{ name: 'Musique', extensions: AUDIO_FILE_EXTENSIONS }]
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
const BUTTON_ZOOM = 1.5
/** Zoom slider: position 0..ZOOM_SLIDER_STEPS on a logarithmic scale of ZOOM_RANGE. */
const ZOOM_SLIDER_STEPS = 100
const zoomToSlider = (zoom: number) => Math.round((ZOOM_SLIDER_STEPS * Math.log(zoom / ZOOM_RANGE.min)) / Math.log(ZOOM_RANGE.max / ZOOM_RANGE.min))
const sliderToZoom = (v: number) => ZOOM_RANGE.min * (ZOOM_RANGE.max / ZOOM_RANGE.min) ** (v / ZOOM_SLIDER_STEPS)

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

interface BarButtonProps {
  icon: IconName
  /** accessible name, also the tooltip unless `tip` is given (with the shortcut) */
  name: string
  tip?: string
  /** short visible label (hidden on narrow windows) */
  label?: string
  onClick(): void
  disabled?: boolean
}

/** Icon button of the bar: icon, optional short label, tooltip. */
function BarButton({ icon, name, tip = name, label, onClick, disabled }: BarButtonProps) {
  return (
    <button
      type="button"
      className={label ? 'icon-btn icon-btn--label' : 'icon-btn'}
      onClick={onClick}
      disabled={disabled}
      aria-label={name}
      data-tip={tip}
      data-tip-side="top"
    >
      <Icon name={icon} size={18} />
      {label && <span className="icon-btn__text">{label}</span>}
    </button>
  )
}

/**
 * « Options » of the film, in a small menu over the bar: automatic stops, « modifié » marker of the film. Closes on
 * Escape (before the shell deselects anything), on a click outside and when the focus leaves it.
 */
function FilmOptions({
  autoStops,
  onAutoStops,
  onAddMusic,
  reading,
}: {
  autoStops: boolean
  onAutoStops(on: boolean): void
  onAddMusic(): void
  reading: boolean
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const modified = useAppStore((s) => modifiedSettings(s.settings, ['film']).length > 0)
  useEffect(() => {
    if (!open) return
    const onDown = (e: globalThis.PointerEvent) => {
      if (!(e.target instanceof Node) || !wrapRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
  return (
    <div
      ref={wrapRef}
      className="film-tl__options"
      data-local-escape={open ? '' : undefined}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return
        e.stopPropagation()
        setOpen(false)
        toggleRef.current?.focus()
      }}
      onBlur={(e) => {
        // the focus went elsewhere (Tab); a click outside is caught by the pointer listener
        if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={toggleRef}
        type="button"
        className="icon-btn icon-btn--label"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        data-tip="Options du film"
        data-tip-side="top"
        data-tip-align="end"
        onClick={() => setOpen(!open)}
      >
        <span className="icon-btn__text">Options</span>
        <Icon name="chevron-down" size={16} />
        {modified && (
          <>
            <span className="film-tl__dot" />
            <span className="visually-hidden"> (modifié)</span>
          </>
        )}
      </button>
      {open && (
        <div id={`${id}-menu`} className="film-tl__menu" role="group" aria-label="Options du film">
          <p className="film-tl__menu-title">Options du film</p>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            disabled={reading}
            onClick={() => {
              setOpen(false)
              onAddMusic()
            }}
          >
            <Icon name="music" size={16} />
            Ajouter une musique…
          </button>
          <p className="film-tl__menu-hint">MP3, M4A, OGG, WAV ou FLAC, 30 Mo au plus. Ou glissez le fichier sur la timeline.</p>
          <label className="film-tl__check">
            <input type="checkbox" checked={autoStops} onChange={(e) => onAutoStops(e.currentTarget.checked)} />
            Arrêts automatiques
          </label>
          <p className="film-tl__menu-hint">
            Un arrêt à chaque temps fort : sommets des montées, cols, sommets. Retoucher un arrêt les fige.
          </p>
          <ModifiedMarker keys={['film']} label="Film" />
        </div>
      )}
    </div>
  )
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
  const muted = useMusicPreview((s) => s.muted)
  const id = useId()
  const clipId = `profile-played-${id.replace(/[^\w-]/g, '')}`

  const path = useMemo(() => (track ? buildTrackPath(track) : null), [track])
  const profile = useMemo(() => (path ? elevationProfile(path, PROFILE_SAMPLES) : undefined), [path])
  const input = useMemo(
    () => filmClockInputFor({ track, film, durationS, pacing, landmarks }),
    [track, film, durationS, pacing, landmarks],
  )
  const candidates = useMemo(() => (track ? stopCandidates({ track, landmarks, pacing }) : []), [track, landmarks, pacing])

  const selected = useAppStore((s) => s.filmSelection)
  const setSelected = useAppStore((s) => s.setFilmSelection)
  /** film being dragged (shown on the timeline only), committed on release */
  const [draft, setDraft] = useState<Film | null>(null)
  const [zoom, setZoom] = useState<number>(ZOOM_RANGE.min)
  const [collapsed, setCollapsed] = useState(false)
  const [width, setWidth] = useState(0)
  const [reading, setReading] = useState(false)
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
        ? buildFilmClock({
            ...input,
            opening: draft.opening,
            closing: draft.closing,
            stops: draft.autoStops ? input.stops : draft.stops,
            speeds: draft.speeds,
            cameraKeys: draft.cameraKeys,
          })
        : clock,
    [draft, input, clock],
  )
  const flightXs = useMemo(() => {
    const n = profile?.ele.length ?? 0
    return Array.from({ length: n }, (_, i) => shownClock.timeAtProgress(i / Math.max(1, n - 1)) - shownClock.openingS)
  }, [profile, shownClock])
  const area = useMemo(() => (profile ? profileAreaPath(profile, flightXs) : ''), [profile, flightXs])

  const hasTrack = track !== undefined
  // the selected block went away (undo, other track, generated stops moved): nothing selected
  useEffect(() => {
    if (selected !== null && (!track || !hasFilmItem(film, clock.stops, selected))) setSelected(null)
  }, [selected, track, film, clock, setSelected])

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

  // the music plays along the preview
  useEffect(() => startMusicPreview(), [])

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
  /** one undo step (retouching a landmark title fixes them, as in `editFilm`) */
  const commit = (edited: Film) => {
    const next = freezeLandmarkTitles(film, edited)
    if (next !== film) getSettingsHistory().transaction(() => setSetting('film', next))
  }
  /** nudges with the arrows (quick changes of the film are merged into one undo step) */
  const change = (fn: (f: Film) => Film, stops: boolean) => {
    const next = freezeLandmarkTitles(film, fn(stops ? withOwnStops(film) : film))
    if (next !== film) setSetting('film', next)
  }
  const dragContext = (item: TimelineItem): DragContext => ({
    clock,
    clockOf: (stops: readonly FilmStop[]) => buildFilmClock({ ...input, stops }),
    clockOfSpeeds: (speeds: readonly FilmSpeed[]) => buildFilmClock({ ...input, speeds }),
    lengthM,
    targets: snapTargets(clock, film, candidates.map((c) => c.atM / lengthM), playheadS, item),
    targetsM: candidates.map((c) => c.atM),
    snapS: SNAP_PX / pxPerS,
    audioFileS: (src) => pictures[src]?.durationS,
  })
  const remove = (item: TimelineItem) => editFilm((f) => ({ film: removeFilmItem(f, item), id: null }), { stops: isStop(item) })
  const addStopAt = (atM: number, patch?: Parameters<typeof addStop>[2]) => editFilm((f) => addStop(f, atM, patch), { stops: true })
  /** a portion twice as fast from the marker (one undo step) */
  const addSpeedAt = (atM: number) => {
    const added = addSpeed(film, atM, lengthM)
    if (added) editFilm(() => added)
    else showToast({ kind: 'error', text: 'Pas de place ici : le marqueur est dans une portion de vitesse ou trop près d’une autre.' })
  }
  /** photos and clips added at the playhead, one after the other (one undo step); offers to place photos on the track */
  const addMediaFiles = async (files: readonly File[]) => {
    const images = files.filter(isMediaFile)
    const others = files.length - images.length
    const unsupported = others > 0 ? ` ${plural(others, 'fichier ignoré', 'fichiers ignorés')} : seules les photos et les vidéos sont prises en charge.` : ''
    if (images.length === 0) {
      showToast({ kind: 'error', text: unsupported.trim() })
      return
    }
    const startS = playheadS
    setReading(true)
    const read: Awaited<ReturnType<typeof readMedia>>[] = []
    const failed: string[] = []
    for (const file of images) {
      try {
        read.push(await readMedia(file, file.name))
      } catch (err) {
        failed.push(`« ${file.name} » : ${errorMessage(err)}`)
      }
    }
    setReading(false)
    const errors = failed.length > 0 ? ` Non ajouté : ${failed.join(' ; ')}` : ''
    if (read.length === 0) {
      showToast({ kind: 'error', text: `${errors}${unsupported}`.trim() })
      return
    }
    const srcs = useMediaStore.getState().add(read.map((r) => r.asset))
    const added = addMedia(
      useAppStore.getState().settings.film,
      startS,
      srcs.map((src, k) => ({ src, videoS: read[k].asset.durationS })),
    )
    commit(added.film)
    setSelected(added.ids[0])
    const placements = added.ids.flatMap((photoId, k) => {
      const exif = read[k].exif
      const t = exif ? photoFilmTime(path, clock, { lon: exif.lon, lat: exif.lat, timeMs: photoTimeMs(exif) }) : undefined
      return t === undefined ? [] : [{ id: photoId, startS: t }]
    })
    // clips recorded during the outing (camera clock possibly set to local time: whole hours)
    const syncs = added.ids.flatMap((clipId, k) => {
      const { recordedMs, durationS } = read[k].asset
      const offsetS = recordedMs === undefined || durationS === undefined ? undefined : clipSyncOffsetS(path, recordedMs, durationS)
      return offsetS === undefined ? [] : [{ id: clipId, sync: { startMs: recordedMs!, offsetS, follow: false }, fileS: durationS! }]
    })
    const videos = read.filter((r) => r.asset.durationS !== undefined).length
    const photos = read.length - videos
    const n = placements.length
    const located =
      n === 0
        ? ''
        : n === 1
          ? ` ${photos === 1 ? 'La photo' : "L'une des photos"} a été prise le long du parcours : la placer au moment où le marqueur y passe ?`
          : ` ${n} photos ont été prises le long du parcours : les placer au moment où le marqueur y passe ?`
    const filmed =
      syncs.length === 0
        ? ''
        : syncs.length === 1
          ? ` ${videos === 1 ? 'La vidéo' : "L'une des vidéos"} a été filmée pendant la sortie : la caler sur le parcours ?`
          : ` ${syncs.length} vidéos ont été filmées pendant la sortie : les caler sur le parcours ?`
    /** photos placed, clips synced with the film clock of the moment (one undo step) */
    const place = () =>
      editFilm((f) => {
        const clockNow = filmClockFor(getFilmSource())
        const placed = placements.reduce((g, p) => updateMedia(g, p.id, { startS: p.startS }), f)
        return { film: syncs.reduce((g, c) => syncClip(g, c.id, c.sync, path, clockNow, c.fileS) ?? g, placed) }
      })
    const what = [photos > 0 ? plural(photos, 'photo', 'photos') : '', videos > 0 ? plural(videos, 'vidéo', 'vidéos') : ''].filter(Boolean).join(' et ')
    showToast({
      kind: errors || unsupported ? 'info' : 'success',
      text: `${what} ${read.length > 1 ? 'ajoutées' : 'ajoutée'} à la tête de lecture.${located}${filmed}${errors}${unsupported}`,
      action: n + syncs.length > 0 ? { label: n > 0 ? 'Placer sur le parcours' : 'Caler sur le parcours', run: place } : undefined,
    })
  }
  /** sound files added after the music already there (one undo step); offers to fit the film to the music */
  const addMusicFiles = async (files: readonly File[]) => {
    setReading(true)
    const read: Awaited<ReturnType<typeof readAudio>>[] = []
    const failed: string[] = []
    for (const file of files) {
      try {
        read.push(await readAudio(file, file.name))
      } catch (err) {
        failed.push(`« ${file.name} » : ${errorMessage(err)}`)
      }
    }
    setReading(false)
    const errors = failed.length > 0 ? ` Non ajouté : ${failed.join(' ; ')}` : ''
    if (read.length === 0) {
      showToast({ kind: 'error', text: errors.trim() })
      return
    }
    const first = useAppStore.getState().settings.film.audio.length === 0
    const srcs = useMediaStore.getState().add(read.map((r) => r.asset))
    const added = addMusic(
      useAppStore.getState().settings.film,
      srcs.map((src, k) => ({ src, fileS: read[k].asset.durationS ?? 0 })),
    )
    commit(added.film)
    setSelected(added.ids[0])
    const what = read.length > 1 ? `${read.length} musiques ajoutées` : 'Musique ajoutée'
    showToast({
      kind: errors ? 'info' : 'success',
      text: `${what} ${first ? 'au début du film' : 'à la suite'}. ${read.length > 1 ? 'Elles sont jouées' : 'Elle est jouée'} pendant la lecture et ajoutée${read.length > 1 ? 's' : ''} au film exporté.${errors}`,
      action: { label: 'Caler la durée du film', run: () => showToast(fitFilmToMusic()) },
    })
  }
  const pickMusic = () =>
    void getPlatform()
      .openFiles({ filters: MUSIC_FILTERS, multiple: true })
      .then((files) => (files.length > 0 ? addMusicFiles(files) : undefined))
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
  /** the whole film in the width of the timeline */
  const fitZoom = () => {
    pendingScrollRef.current = 0
    setZoom(ZOOM_RANGE.min)
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
    icon?: IconName,
    extra?: ReactNode,
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
      {extra}
      {thumb && <img className="film-tl__thumb" src={thumb} alt="" draggable={false} />}
      {icon && (
        <span className="film-tl__icon">
          <Icon name={icon} size={12} />
        </span>
      )}
      <span className="film-tl__label">{label}</span>
      {grips.includes('end') && <span className="film-tl__grip film-tl__grip--end" onPointerDown={(e) => startEdit(e, item, 'end')} />}
    </div>
  )
  const opening = shownFilm.opening
  const closing = shownFilm.closing
  const flightStart = shownClock.openingS
  const flightEnd = flightStart + shownClock.flightS
  const ticks = rulerTicks(total, pxPerS)
  const mediaLabel = (m: FilmMedia) => m.caption?.trim() || pictures[m.src]?.name || (m.kind === 'video' ? 'Vidéo' : 'Photo')

  return (
    <div
      className="film-tl"
      role="group"
      aria-label={`Timeline du film : ${track.name}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length === 0) return
        e.preventDefault()
        const files = Array.from(e.dataTransfer.files)
        const sounds = files.filter(isAudioFile)
        const others = files.filter((f) => !isAudioFile(f))
        // one after the other: both read files and show a message
        void (async () => {
          if (sounds.length > 0) await addMusicFiles(sounds)
          if (others.length > 0) await addMediaFiles(others)
        })()
      }}
    >
      <div className="film-tl__bar">
        <button
          type="button"
          className="btn btn--primary film-tl__play"
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? 'Mettre en pause' : 'Lancer le film'}
          data-tip={withShortcut(playing ? 'Pause' : 'Lecture', 'play')}
          data-tip-side="top"
          data-tip-align="start"
        >
          <Icon name={playing ? 'pause' : 'play'} size={16} />
        </button>
        <BarButton
          icon="square"
          name="Arrêter et revenir au début"
          onClick={() => {
            setPlaying(false)
            seek(0)
          }}
        />
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
        <BarButton
          icon="map-pin"
          label="Arrêt"
          name="Ajouter un arrêt à la position du marqueur"
          tip={withShortcut('Ajouter un arrêt à la position du marqueur', 'add-stop')}
          onClick={() => addStopAt(Math.round(progress * lengthM))}
        />
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
        <BarButton
          icon="gauge"
          label="Vitesse"
          name="Accélérer ou ralentir une portion à partir du marqueur"
          tip="Accélérer ou ralentir une portion (1 km à ×2) à partir du marqueur"
          onClick={() => addSpeedAt(Math.round(progress * lengthM))}
        />
        <BarButton
          icon="type"
          label="Texte"
          name="Ajouter un texte à la tête de lecture"
          tip={withShortcut('Ajouter un texte à la tête de lecture', 'add-text')}
          onClick={() => editFilm((f) => addText(f, playheadS))}
        />
        <BarButton
          icon="image"
          label={reading ? 'Lecture…' : 'Média'}
          name={reading ? 'Lecture des fichiers…' : 'Ajouter des photos ou des vidéos à la tête de lecture'}
          tip="Ajouter des photos ou des vidéos (MP4, WebM, MOV ; sans le son) à la tête de lecture, ou les glisser sur la timeline"
          onClick={() =>
            void getPlatform()
              .openFiles({ filters: MEDIA_FILTERS, multiple: true })
              .then((files) => (files.length > 0 ? addMediaFiles(files) : undefined))
          }
          disabled={reading}
        />
        <span className="film-tl__sep" aria-hidden="true" />
        {(film.audio.length > 0 || film.media.some(clipHasSound)) && (
          <BarButton
            icon={muted ? 'volume-x' : 'volume-2'}
            name={muted ? 'Remettre le son' : 'Couper le son'}
            tip={muted ? 'Remettre le son de la lecture' : 'Couper le son de la musique et des vidéos pendant la lecture (le film exporté le garde)'}
            onClick={() => useMusicPreview.getState().setMuted(!muted)}
          />
        )}
        <select className="film-tl__select" aria-label="Vitesse de lecture" value={speed} onChange={(e) => setSpeed(Number(e.currentTarget.value))}>
          {SPEEDS.map((value) => (
            <option key={value} value={value}>
              ×{formatNumber(value, value % 1 === 0 ? 0 : 1)}
            </option>
          ))}
        </select>
        <div className="film-tl__zoom" role="group" aria-label="Zoom de la timeline">
          <BarButton
            icon="zoom-out"
            name="Zoom arrière"
            tip={withShortcut('Zoom arrière', 'zoom')}
            onClick={() => zoomBy(1 / BUTTON_ZOOM)}
            disabled={zoom <= ZOOM_RANGE.min}
          />
          <input
            className="film-tl__zoom-range"
            type="range"
            min={0}
            max={ZOOM_SLIDER_STEPS}
            step={1}
            value={zoomToSlider(zoom)}
            aria-label="Zoom"
            aria-valuetext={`×${formatNumber(zoom, 1)}`}
            onChange={(e) => zoomBy(sliderToZoom(Number(e.currentTarget.value)) / zoom)}
          />
          <BarButton
            icon="zoom-in"
            name="Zoom avant"
            tip={withShortcut('Zoom avant', 'zoom')}
            onClick={() => zoomBy(BUTTON_ZOOM)}
            disabled={zoom >= ZOOM_RANGE.max}
          />
          <BarButton icon="move-horizontal" label="Ajuster" name="Ajuster : voir tout le film" tip="Voir tout le film" onClick={fitZoom} disabled={zoom <= ZOOM_RANGE.min} />
        </div>
        <FilmOptions autoStops={film.autoStops} onAutoStops={toggleAutoStops} onAddMusic={pickMusic} reading={reading} />
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls={`${id}-lanes`}
          aria-label={collapsed ? 'Déplier les pistes' : 'Replier les pistes'}
          data-tip={collapsed ? 'Déplier les pistes' : 'Replier les pistes'}
          data-tip-side="top"
          data-tip-align="end"
        >
          <Icon name={collapsed ? 'panel-bottom-open' : 'panel-bottom-close'} size={18} />
        </button>
      </div>

      {!collapsed && (
        <div className="film-tl__body" id={`${id}-lanes`}>
          <div className="film-tl__heads">
            <div className="film-tl__head film-tl__head--ruler" />
            {/* the lanes carry the same names */}
            {['Plans', 'Vitesse', 'Arrêts', 'Textes', 'Médias', 'Musique'].map((name) => (
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
                  {/* the stops inside the flight: where the flyover holds */}
                  {shownClock.stops.map((s) => (
                    <span
                      key={s.id}
                      className={`film-tl__flight-stop${s.id === selected ? ' film-tl__flight-stop--selected' : ''}`}
                      style={{ left: (s.startS - flightStart) * pxPerS, width: (s.endS - s.startS) * pxPerS }}
                    />
                  ))}
                  <span className="film-tl__label">Survol · {formatDistance(lengthM)}</span>
                </div>
                {shownClock.cameraKeys.map((k) => (
                  <div
                    key={k.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected === k.id}
                    aria-label={`Cadrage de la caméra à ${formatDistance(k.atM)}, à ${formatFilmTime(k.timeS)}`}
                    title="Cadrage de la caméra"
                    className={`film-tl__key${selected === k.id ? ' film-tl__key--selected' : ''}`}
                    style={{ left: xOf(k.timeS) }}
                    onPointerDown={(e) => startEdit(e, k.id, 'move')}
                    onFocus={() => setSelected(k.id)}
                    onKeyDown={(e) => onBlockKeyDown(e, k.id)}
                  />
                ))}
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

              <div className="film-tl__lane" role="group" aria-label="Vitesse">
                {shownClock.speeds.map((s) => {
                  const label = formatSpeedFactor(s.factor)
                  const how = s.factor > 1 ? 'accélérée' : s.factor < 1 ? 'ralentie' : 'à vitesse normale'
                  return block(
                    s.id,
                    s.startS,
                    s.endS,
                    label,
                    `Portion ${how} ${label}, de ${formatDistance(s.fromM)} à ${formatDistance(s.toM)}`,
                    `film-tl__block--speed${s.factor < 1 ? ' film-tl__block--slow' : ''}`,
                    ['start', 'move', 'end'],
                  )
                })}
              </div>

              <div className="film-tl__lane" role="group" aria-label="Arrêts">
                {shownClock.stops.map((s) => {
                  const label = s.label || 'Arrêt'
                  return block(
                    s.id,
                    s.startS,
                    s.endS,
                    label,
                    `Arrêt (caméra : ${STOP_CAMERA_LABELS[s.camera].toLowerCase()}) : ${label}${shownFilm.autoStops ? ' (automatique)' : ''}`,
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
                    `${m.kind === 'video' ? 'Vidéo' : 'Photo'} ${m.layout === 'carte' ? 'en carte' : 'plein écran'} : ${mediaLabel(m)}`,
                    'film-tl__block--media',
                    ['start', 'move', 'end'],
                    pictures[m.src]?.thumb,
                    m.kind === 'video' ? 'video' : undefined,
                  ),
                )}
              </div>

              <div className="film-tl__lane" role="group" aria-label="Musique">
                {shownFilm.audio.length === 0 && (
                  <span className="film-tl__empty" style={{ left: xOf(0) }}>
                    Glissez un fichier audio ici, ou Options › Ajouter une musique
                  </span>
                )}
                {shownFilm.audio.map((a) => {
                  const sound = pictures[a.src]
                  const lengthS = musicLengthS(a, sound?.durationS)
                  const label = sound?.name ?? 'Musique'
                  const wave = sound?.peaks && sound.durationS ? waveformPath(sound.peaks, sound.durationS, a.inS, lengthS) : ''
                  return block(
                    a.id,
                    a.startS,
                    a.startS + a.durationS,
                    label,
                    `Musique : ${label}, volume ${Math.round(a.volume * 100)} %`,
                    'film-tl__block--music',
                    ['start', 'move', 'end'],
                    undefined,
                    'music',
                    wave && (
                      <svg className="film-tl__wave" viewBox={`0 0 ${a.durationS} 1`} preserveAspectRatio="none" aria-hidden="true">
                        <path d={wave} />
                        {sound?.beats && <path className="film-tl__beats" d={beatTicksPath(sound.beats, a.inS, lengthS)} />}
                      </svg>
                    ),
                  )
                })}
              </div>

              <div className="film-tl__playhead" style={{ left: xOf(playheadS) }} aria-hidden="true" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

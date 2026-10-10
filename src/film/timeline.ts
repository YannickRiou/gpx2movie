/**
 * Timeline of the film (`ui/Timeline.tsx`): time <-> pixel scale, ruler, snapping, the edits made by its gestures (drag
 * a block or an edge, nudge, add, remove, attach a text or a medium to a stop), as pure functions. The component only
 * turns pointer and keyboard events into these calls and commits the result as one undo step.
 *
 * Items are selected by id: 'opening', 'closing', or the id of a stop, speed portion, camera key, text, medium or music
 * clip (unique across the film). Times are film times (seconds at x1 from the first frame, opening included).
 */
import { clamp } from '../core/math'
import { CAMERA_RANGES } from '../flyover/cameraSettings'
import type { CameraSettings } from '../flyover/cameraSettings'
import { distanceAtTime, nearestOnPath, recordedTimeAt } from '../flyover/path'
import type { TrackPath } from '../flyover/path'
import type { ClockStop, FilmClock } from './clock'
import {
  AUDIO_DEFAULTS,
  AUDIO_DURATION_RANGE,
  AUTO_STOP_S,
  DEFAULT_FILM,
  FADE_RANGE,
  ITEM_DURATION_RANGE,
  MEDIA_DEFAULTS,
  MIN_SPEED_SPAN_M,
  SHOT_DURATION_RANGE,
  SITUATION_DURATION_S,
  SPEED_FACTOR_RANGE,
  STOP_DURATION_RANGE,
  VIDEO_SOUND_DEFAULTS,
  clipTimeS,
  nextFilmId,
} from './model'
import type { Film, FilmAudio, FilmCameraKey, FilmMedia, FilmShot, FilmSpeed, FilmStop, FilmText, MediaSync } from './model'

export type TimelineItem = 'opening' | 'closing' | string
/** part of a block a gesture holds: its body (move) or one of its edges */
export type Grip = 'move' | 'start' | 'end'

/** times and durations kept at 1/100 s: clean values in the project file */
const roundS = (s: number) => Math.round(s * 100) / 100

// ---------------------------------------------------------------------------
// Scale, ruler, zoom
// ---------------------------------------------------------------------------

export const ZOOM_RANGE = { min: 1, max: 50 } as const

/** Pixels per second at zoom 1: the whole film fits `widthPx`. */
export function fitPxPerS(widthPx: number, totalS: number): number {
  return widthPx > 0 && totalS > 0 ? widthPx / totalS : 1
}

/**
 * Zoom by `factor` keeping the time under `anchorPx` (pixels from the left of the visible area) in place:
 * the new zoom (clamped to `ZOOM_RANGE`) and horizontal scroll.
 */
export function zoomAt(zoom: number, factor: number, anchorPx: number, scrollLeft: number): { zoom: number; scrollLeft: number } {
  const next = clamp(zoom * factor, ZOOM_RANGE.min, ZOOM_RANGE.max)
  return { zoom: next, scrollLeft: Math.max(0, ((scrollLeft + anchorPx) * next) / zoom - anchorPx) }
}

/**
 * Speed of the automatic scroll of the zoomed timeline while a block or the playhead is dragged near one of its
 * edges (pixels per second, negative to the left): zero farther than `edgePx` from both edges, growing linearly to
 * `maxPxPerS` at the edge and beyond it.
 */
export function edgeScrollSpeed(clientX: number, left: number, right: number, edgePx = 48, maxPxPerS = 900): number {
  if (edgePx <= 0 || right - left <= 0) return 0
  const toLeft = clientX - left
  const toRight = right - clientX
  if (toLeft < edgePx && toLeft <= toRight) return -maxPxPerS * Math.min(1, (edgePx - toLeft) / edgePx)
  if (toRight < edgePx) return maxPxPerS * Math.min(1, (edgePx - toRight) / edgePx)
  return 0
}

const TICK_STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

/** Seconds between two labelled ticks: the first step at least `minPx` wide. */
export function rulerStep(pxPerS: number, minPx = 56): number {
  return TICK_STEPS_S.find((step) => step * pxPerS >= minPx) ?? TICK_STEPS_S[TICK_STEPS_S.length - 1]
}

/** Labelled ticks of the ruler, from 0 to `totalS`. */
export function rulerTicks(totalS: number, pxPerS: number, minPx?: number): number[] {
  const step = rulerStep(pxPerS, minPx)
  const ticks: number[] = []
  for (let t = 0; t <= totalS + 1e-9; t += step) ticks.push(t)
  return ticks
}

/** 75.4 -> "1:15", with tenths "1:15,4" (film times are short: minutes are not split into hours). */
export function formatFilmTime(seconds: number, tenths = false): string {
  const t = Math.max(0, seconds)
  const units = tenths ? Math.round(t * 10) : Math.floor(t + 1e-6) * 10
  const m = Math.floor(units / 600)
  const s = String(Math.floor((units % 600) / 10)).padStart(2, '0')
  return tenths ? `${m}:${s},${units % 10}` : `${m}:${s}`
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

/** The nearest target within `thresholdS` of `t`, else `t`. */
export function snapTime(t: number, targets: readonly number[], thresholdS: number): number {
  let best = t
  let bestD = thresholdS
  for (const target of targets) {
    const d = Math.abs(target - t)
    if (d <= bestD) {
      best = target
      bestD = d
    }
  }
  return best
}

/**
 * Times a dragged edge snaps to: start and end of the film, edges of the shots, of the stops, speed portions, texts,
 * media and music clips (but those of `except`), highlights (progress values), playhead.
 */
export function snapTargets(
  clock: FilmClock,
  film: Film,
  highlights: readonly number[],
  playheadS: number,
  except?: TimelineItem,
): number[] {
  const total = clock.totalTime()
  const out = [0, total, clock.openingS, total - clock.closingS, playheadS]
  for (const s of [...clock.stops, ...clock.speeds]) if (s.id !== except) out.push(s.startS, s.endS)
  for (const t of [...film.texts, ...film.media, ...film.audio]) if (t.id !== except) out.push(t.startS, t.startS + t.durationS)
  for (const h of highlights) out.push(clock.timeAtProgress(h))
  return out
}

// ---------------------------------------------------------------------------
// Placing a stop in time
// ---------------------------------------------------------------------------

/** Clock of the film with other stops (same shots, track and pacing). */
export type ClockOfStops = (stops: readonly FilmStop[]) => FilmClock

const BISECTION_STEPS = 32

/**
 * Position in [lo, hi] at which `timeOf` (non-decreasing) reaches `targetS`, by bisection; the nearest end when the
 * target is out of reach.
 */
export function positionAtTime(timeOf: (m: number) => number, targetS: number, lo: number, hi: number): number {
  if (!(hi > lo) || targetS <= timeOf(lo)) return lo
  if (targetS >= timeOf(hi)) return hi
  for (let k = 0; k < BISECTION_STEPS; k++) {
    const mid = (lo + hi) / 2
    if (timeOf(mid) < targetS) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * Position (metres along the track, in [0, `lengthM`]) at which stop `id` starts its hold at film time `holdStartS`:
 * the inverse of the clock for that stop, by bisection (its window moves later as it moves along the track; times
 * inside another stop's window are not reachable and give the nearest position next to it).
 */
export function stopPositionAt(clockOf: ClockOfStops, stops: readonly FilmStop[], id: string, holdStartS: number, lengthM: number): number {
  const holdAt = (atM: number) => {
    const clock = clockOf(stops.map((s) => (s.id === id ? { ...s, atM } : s)))
    return clock.stops.find((s) => s.id === id)?.holdStartS ?? 0
  }
  return positionAtTime(holdAt, holdStartS, 0, lengthM)
}

/** Clock of the film with other speed portions (same shots, track, pacing and stops). */
export type ClockOfSpeeds = (speeds: readonly FilmSpeed[]) => FilmClock

/** Free stretch of the track around portion `id`: from the end of the portion before it to the start of the next. */
function speedRoom(speeds: readonly FilmSpeed[], own: Pick<FilmSpeed, 'id' | 'fromM' | 'toM'>, lengthM: number): { lo: number; hi: number } {
  let lo = 0
  let hi = lengthM
  for (const s of speeds) {
    if (s.id === own.id) continue
    if (s.toM <= own.fromM) lo = Math.max(lo, s.toM)
    else if (s.fromM >= own.toM) hi = Math.min(hi, s.fromM)
  }
  return { lo, hi }
}

// ---------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------

/**
 * What a press on edge grip `grip`, `offsetPx` into a block `widthPx` wide with `grips`, drags: on a movable block,
 * an edge only from the outer third of its side, else the block (on a narrow block the touch grips, or the
 * browser's touch adjustment, reach past it).
 */
export function pressedGrip(grip: Grip, offsetPx: number, widthPx: number, grips: readonly Grip[]): Grip {
  if (!grips.includes('move')) return grip
  if (offsetPx <= widthPx / 3 && grips.includes('start')) return 'start'
  if (offsetPx >= (2 * widthPx) / 3 && grips.includes('end')) return 'end'
  return 'move'
}

export interface DragContext {
  /** clock of the film at the start of the gesture */
  clock: FilmClock
  clockOf: ClockOfStops
  /** length of the first track (metres) */
  lengthM: number
  /** times an edge snaps to (`snapTargets`) */
  targets: readonly number[]
  /** positions a moved stop snaps to (metres along the track: the highlights) */
  targetsM: readonly number[]
  /** snapping distance (seconds; 0 = no snapping) */
  snapS: number
  /** clock with other speed portions (speed portions are left as they are without it) */
  clockOfSpeeds?: ClockOfSpeeds
  /** length of a sound file of the media table (a music clip never plays past the end of its file) */
  audioFileS?: (src: string) => number | undefined
}

const shotDuration = (d: number) => roundS(clamp(d, SHOT_DURATION_RANGE.min, SHOT_DURATION_RANGE.max))
const stopDuration = (d: number) => roundS(clamp(d, STOP_DURATION_RANGE.min, STOP_DURATION_RANGE.max))
const itemDuration = (d: number) => roundS(clamp(d, ITEM_DURATION_RANGE.min, ITEM_DURATION_RANGE.max))
/** longest a music clip may play from `inS` in a file of `fileS` seconds */
const musicMaxS = (inS: number, fileS = Infinity) => Math.max(AUDIO_DURATION_RANGE.min, Math.min(AUDIO_DURATION_RANGE.max, fileS - inS))

/**
 * Music clip `own` after dragging `grip` by `deltaS`: moved (start snapped, else end), or stretched by its end (never
 * past the end of the file), or by its start, which moves its start in the file along (never before the file's).
 */
function dragMusic(own: FilmAudio, grip: Grip, deltaS: number, fileS: number | undefined, snap: (t: number) => number): FilmAudio {
  const start = own.startS
  const end = own.startS + own.durationS
  if (grip === 'move') {
    const snappedStart = snap(start + deltaS)
    const shift = snappedStart !== start + deltaS ? snappedStart - start : snap(end + deltaS) - end
    return { ...own, startS: roundS(Math.max(0, start + shift)) }
  }
  if (grip === 'start') {
    const min = Math.max(0, start - own.inS, end - musicMaxS(0, fileS))
    const s = clamp(snap(start + deltaS), min, end - AUDIO_DURATION_RANGE.min)
    return { ...own, startS: roundS(s), durationS: roundS(end - s), inS: roundS(Math.max(0, own.inS + s - start)) }
  }
  const durationS = clamp(snap(end + deltaS) - start, AUDIO_DURATION_RANGE.min, musicMaxS(own.inS, fileS))
  return { ...own, durationS: roundS(durationS) }
}

function withShot(film: Film, key: 'opening' | 'closing', durationS: number): Film {
  const shot: FilmShot = film[key]
  return shot.style === 'aucune' ? film : { ...film, [key]: { ...shot, durationS: shotDuration(durationS) } }
}

/** Move the stop so that its hold starts `deltaS` later; snaps to a highlight (by position). */
function moveStop(film: Film, stop: ClockStop, deltaS: number, ctx: DragContext): number {
  const { clock, lengthM } = ctx
  const atM = stopPositionAt(ctx.clockOf, film.stops, stop.id, stop.holdStartS + deltaS, lengthM)
  // snapping distance in metres at the mean speed of the flight
  const snapM = clock.flightS > 0 ? (ctx.snapS * lengthM) / clock.flightS : 0
  const snapped = snapTime(atM, ctx.targetsM, snapM)
  return snapped === atM ? Math.round(atM) : snapped
}

/**
 * Portion `own` after dragging `grip` by `deltaS`: the edge held (both for a move) follows the pointer in film time,
 * found in metres on the clock with the portion changed (`ctx.clockOfSpeeds`); never over its neighbours, nor
 * shorter than `MIN_SPEED_SPAN_M`; rounded to the metre.
 */
function dragSpeed(film: Film, own: FilmSpeed, grip: Grip, deltaS: number, ctx: DragContext, snap: (t: number) => number): FilmSpeed {
  const placed = ctx.clock.speeds.find((s) => s.id === own.id)
  const clockOf = ctx.clockOfSpeeds
  if (!placed || !clockOf) return own
  const { lo, hi } = speedRoom(film.speeds, own, ctx.lengthM)
  const timesOf = (fromM: number, toM: number) => {
    const s = clockOf(film.speeds.map((p) => (p.id === own.id ? { ...p, fromM, toM } : p))).speeds.find((p) => p.id === own.id)
    return s ?? placed
  }
  const span = own.toM - own.fromM
  if (grip === 'move') {
    const start = placed.startS + deltaS
    const end = placed.endS + deltaS
    const snappedStart = snap(start)
    let fromM: number
    if (snappedStart === start && snap(end) !== end) {
      fromM = positionAtTime((m) => timesOf(m - span, m).endS, snap(end), lo + span, hi) - span
    } else {
      fromM = positionAtTime((m) => timesOf(m, m + span).startS, snappedStart, lo, hi - span)
    }
    const from = Math.round(clamp(fromM, lo, hi - span))
    return { ...own, fromM: from, toM: from + span }
  }
  if (grip === 'start') {
    const fromM = positionAtTime((m) => timesOf(m, own.toM).startS, snap(placed.startS + deltaS), lo, own.toM - MIN_SPEED_SPAN_M)
    return { ...own, fromM: Math.round(clamp(fromM, lo, own.toM - MIN_SPEED_SPAN_M)) }
  }
  const toM = positionAtTime((m) => timesOf(own.fromM, m).endS, snap(placed.endS + deltaS), own.fromM + MIN_SPEED_SPAN_M, hi)
  return { ...own, toM: Math.round(clamp(toM, own.fromM + MIN_SPEED_SPAN_M, hi)) }
}

/**
 * The film after dragging `grip` of `item` by `deltaS` seconds from the gesture start (`film` is the film at the
 * start, stops written out for a stop): opening end, closing start, stop moved along the track (hold start
 * follows the pointer) or stretched (end edge), speed portion moved or stretched by either edge (in metres along
 * the track), camera key moved along the track, text or medium moved or stretched by either edge. Edges snap to `ctx.targets`; values are clamped
 * to the model ranges. Unknown items and grips leave the film as is.
 */
export function dragFilm(film: Film, item: TimelineItem, grip: Grip, deltaS: number, ctx: DragContext): Film {
  const snap = (t: number) => snapTime(t, ctx.targets, ctx.snapS)
  const { clock } = ctx
  if (item === 'opening') return withShot(film, 'opening', snap(clock.openingS + deltaS))
  if (item === 'closing') {
    const end = clock.totalTime()
    return withShot(film, 'closing', end - snap(end - clock.closingS + deltaS))
  }

  const stop = clock.stops.find((s) => s.id === item)
  if (stop && film.stops.some((s) => s.id === item)) {
    const own = film.stops.find((s) => s.id === item)!
    if (grip === 'move') {
      const atM = moveStop(film, stop, deltaS, ctx)
      return { ...film, stops: film.stops.map((s) => (s.id === item ? { ...s, atM } : s)) }
    }
    if (grip !== 'end') return film
    // the clock may shorten the stops (`keepDuration` cap): stretch in that proportion
    const share = own.durationS > 0 && stop.addedS > 0 ? stop.addedS / own.durationS : 1
    const added = snap(stop.endS + deltaS) - stop.endS
    const durationS = stopDuration(own.durationS + added / share)
    return { ...film, stops: film.stops.map((s) => (s.id === item ? { ...s, durationS } : s)) }
  }

  const key = clock.cameraKeys.find((k) => k.id === item)
  if (key && grip === 'move') {
    // the key follows the pointer in film time: its place is where the marker is then
    const atM = Math.round(clamp(clock.progressAtTime(snap(key.timeS + deltaS)), 0, 1) * ctx.lengthM)
    return { ...film, cameraKeys: film.cameraKeys.map((k) => (k.id === item ? { ...k, atM } : k)) }
  }

  const speed = film.speeds.find((s) => s.id === item)
  if (speed) {
    const next = dragSpeed(film, speed, grip, deltaS, ctx, snap)
    return next.fromM === speed.fromM && next.toM === speed.toM ? film : { ...film, speeds: film.speeds.map((s) => (s.id === item ? next : s)) }
  }

  const music = film.audio.find((a) => a.id === item)
  if (music) {
    const next = dragMusic(music, grip, deltaS, ctx.audioFileS?.(music.src), snap)
    return { ...film, audio: film.audio.map((a) => (a.id === item ? next : a)) }
  }

  const lane = film.texts.some((t) => t.id === item) ? 'texts' : 'media'
  const timed: FilmText | FilmMedia | undefined = film[lane].find((t) => t.id === item)
  if (!timed) return film
  const start = timed.startS
  const end = timed.startS + timed.durationS
  let next: Timed
  if (grip === 'move') {
    const snappedStart = snap(start + deltaS)
    const shift = snappedStart !== start + deltaS ? snappedStart - start : snap(end + deltaS) - end
    next = { startS: roundS(Math.max(0, start + shift)), durationS: timed.durationS }
  } else if (grip === 'start') {
    // a video keeps its frames in place: its start in the file follows the edge (not before the start of the file)
    const inS = 'kind' in timed && timed.kind === 'video' ? (timed.inS ?? 0) : undefined
    const min = Math.max(0, end - ITEM_DURATION_RANGE.max, inS === undefined ? 0 : start - inS)
    const s = clamp(snap(start + deltaS), min, end - ITEM_DURATION_RANGE.min)
    next = { startS: roundS(s), durationS: itemDuration(end - s) }
    if (inS !== undefined) next.inS = roundS(Math.max(0, inS + s - start))
  } else {
    next = { startS: start, durationS: itemDuration(snap(end + deltaS) - start) }
  }
  return lane === 'texts'
    ? { ...film, texts: film.texts.map((t) => (t.id === item ? { ...t, ...next } : t)) }
    : { ...film, media: film.media.map((m) => (m.id === item ? { ...m, ...next } : m)) }
}

/** What a gesture changes on a text or a medium (and the start in the file of a video). */
type Timed = Pick<FilmMedia, 'startS' | 'durationS' | 'inS'>

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/** A stop added at `atM` (manual unless a source is given), orbiting, `AUTO_STOP_S`; with its new id. */
export function addStop(film: Film, atM: number, patch: Partial<Omit<FilmStop, 'id' | 'atM'>> = {}): { film: Film; id: string } {
  const id = nextFilmId(film, 'stop')
  const label = patch.label ?? `Arrêt ${id.slice('stop-'.length)}`
  const stop: FilmStop = { durationS: AUTO_STOP_S, camera: 'orbite', source: { kind: 'manual' }, ...patch, id, atM: Math.max(0, atM), label }
  return { film: { ...film, stops: [...film.stops, stop] }, id }
}

/** Length of a speed portion added on the timeline (metres) and its factor. */
export const NEW_SPEED_M = 1000
export const NEW_SPEED_FACTOR = 2

/**
 * A portion `NEW_SPEED_FACTOR` times faster added from `atM` metres (`NEW_SPEED_M` long, shorter or earlier to stay on
 * the track and off the other portions); with its new id. Null when `atM` is inside a portion or the free room is
 * shorter than `MIN_SPEED_SPAN_M`.
 */
export function addSpeed(film: Film, atM: number, lengthM: number): { film: Film; id: string } | null {
  const at = clamp(atM, 0, lengthM)
  if (film.speeds.some((s) => at >= s.fromM && at < s.toM)) return null
  const { lo, hi } = speedRoom(film.speeds, { id: '', fromM: at, toM: at }, lengthM)
  const toM = Math.min(hi, at + NEW_SPEED_M)
  const fromM = Math.max(lo, Math.min(at, toM - NEW_SPEED_M))
  const from = Math.ceil(fromM)
  const to = Math.floor(toM)
  if (to - from < MIN_SPEED_SPAN_M) return null
  const id = nextFilmId(film, 'speed')
  return { film: { ...film, speeds: [...film.speeds, { id, fromM: from, toM: to, factor: NEW_SPEED_FACTOR }] }, id }
}

/**
 * A camera key added at `atM` with `framing` (rounded); with its id. A key already at that metre takes the framing
 * instead (one key per place).
 */
export function addCameraKey(film: Film, atM: number, framing: Pick<CameraSettings, 'distance' | 'pitchDeg' | 'headingOffsetDeg'>): { film: Film; id: string } {
  const at = Math.max(0, Math.round(atM))
  const there = film.cameraKeys.find((k) => k.atM === at)
  if (there) return { film: updateCameraKey(film, there.id, framing), id: there.id }
  const id = nextFilmId(film, 'camera')
  const { distance, pitchDeg, headingOffsetDeg } = framing
  const key: FilmCameraKey = { id, atM: at, distance, pitchDeg, headingOffsetDeg }
  return { film: updateCameraKey({ ...film, cameraKeys: [...film.cameraKeys, key] }, id, {}), id }
}

/**
 * A camera of its own for a text or a photo shown from film time `startS` to `endS`: a camera key where the marker is at
 * its start (the framing there, to adjust: it is the key returned) and, when the marker moves meanwhile, one at its end
 * keeping the framing that was there, so that the rest of the film is unchanged. `framingAt` gives the framing the
 * film has at a position (camera keys included), `atTime` the position at a film time.
 */
export function addItemCamera(
  film: Film,
  startS: number,
  endS: number,
  atTime: (timeS: number) => number,
  framingAt: (atM: number) => Pick<CameraSettings, 'distance' | 'pitchDeg' | 'headingOffsetDeg'>,
): { film: Film; id: string } {
  const fromM = Math.round(atTime(startS))
  const toM = Math.round(atTime(endS))
  const after = toM > fromM ? addCameraKey(film, toM, framingAt(toM)).film : film
  return addCameraKey(after, fromM, framingAt(fromM))
}

/** Length of a text added on the timeline (seconds). */
export const NEW_TEXT_S = 4

/** A text added at film time `startS`, centred low, normal size, or attached to `stop` (`attachToStop`); with its new id. */
export function addText(film: Film, startS: number, stop: ClockStop | null = null): { film: Film; id: string } {
  const id = nextFilmId(film, 'text')
  const text: FilmText = { id, startS: roundS(Math.max(0, startS)), durationS: NEW_TEXT_S, text: 'Nouveau texte', anchor: 'bottom-center', size: 1 }
  const next = { ...film, texts: [...film.texts, text] }
  return { film: stop ? attachToStop(next, id, stop) : next, id }
}

/** Length of a photo added on the timeline (seconds). */
export const NEW_MEDIA_S = 5
/** Longest a video is when added (seconds; its natural length below that, stretched or trimmed afterwards). */
export const NEW_VIDEO_MAX_S = 30

/**
 * Media added one after the other from film time `startS`, one per entry of the media table (`src`): a photo
 * `NEW_MEDIA_S` long, a video (`videoS`: its length in the file) its natural length up to `NEW_VIDEO_MAX_S`, without
 * Ken Burns, with its sound (`VIDEO_SOUND_DEFAULTS`); `MEDIA_DEFAULTS` placement otherwise. With their new ids.
 */
export function addMedia(film: Film, startS: number, sources: readonly { src: string; videoS?: number }[]): { film: Film; ids: string[] } {
  let next = film
  const ids: string[] = []
  let at = Math.max(0, startS)
  for (const { src, videoS } of sources) {
    const id = nextFilmId(next, 'media')
    const video = videoS !== undefined
    const durationS = video ? itemDuration(Math.min(videoS, NEW_VIDEO_MAX_S)) : NEW_MEDIA_S
    const media: FilmMedia = { id, startS: roundS(at), durationS, kind: video ? 'video' : 'image', src, ...MEDIA_DEFAULTS }
    if (video) Object.assign(media, { kenBurns: false, ...VIDEO_SOUND_DEFAULTS })
    next = { ...next, media: [...next.media, media] }
    ids.push(id)
    at += durationS
  }
  return { film: next, ids }
}

/**
 * Music clips added one after the other, the first at the end of the music already there (the start of the film
 * without any), one per sound file of the media table (`src`, `fileS`: its length): the whole file,
 * `AUDIO_DEFAULTS` volume and fades. With their new ids.
 */
export function addMusic(film: Film, sources: readonly { src: string; fileS: number }[]): { film: Film; ids: string[] } {
  let next = film
  const ids: string[] = []
  let at = film.audio.reduce((end, a) => Math.max(end, a.startS + a.durationS), 0)
  for (const { src, fileS } of sources) {
    const id = nextFilmId(next, 'music')
    const durationS = roundS(clamp(fileS, AUDIO_DURATION_RANGE.min, AUDIO_DURATION_RANGE.max))
    next = { ...next, audio: [...next.audio, { id, src, startS: roundS(at), durationS, inS: 0, ...AUDIO_DEFAULTS }] }
    ids.push(id)
    at += durationS
  }
  return { film: next, ids }
}

/** Farthest a geotagged photo may be from the track to be placed on it (metres). */
export const PHOTO_MAX_OFF_M = 2000
/** Capture instants this long before the start or after the end of the recording place a photo at that end. */
export const PHOTO_TIME_TOLERANCE_MS = 15 * 60_000

/**
 * Film time at which the marker reaches the point of the track where a photo was taken (`place`: EXIF position
 * and / or capture instant): the nearest point of the track, within `PHOTO_MAX_OFF_M` (on an out-and-back, the
 * pass recorded closest to the instant), else the point recorded at that instant (timed track). Undefined when
 * neither matches.
 */
export function photoFilmTime(path: TrackPath, clock: FilmClock, place: { lon?: number; lat?: number; timeMs?: number }): number | undefined {
  if (path.lengthM <= 0) return undefined
  let atM: number | undefined
  if (place.lon !== undefined && place.lat !== undefined) {
    const nearest = nearestOnPath(path, { lon: place.lon, lat: place.lat }, place.timeMs)
    if (nearest && nearest.offM <= PHOTO_MAX_OFF_M) atM = nearest.distanceM
  }
  if (atM === undefined && place.timeMs !== undefined) atM = distanceAtTime(path, place.timeMs, PHOTO_TIME_TOLERANCE_MS)
  return atM === undefined ? undefined : roundS(clock.timeAtProgress(atM / path.lengthM))
}

/** Recorded instants of the first and last timed points of the track (ms), undefined without time. */
function recordedRange(path: TrackPath): { from: number; to: number } | undefined {
  let from = Number.NaN
  let to = Number.NaN
  for (let i = 0; i < path.count; i++) {
    const t = path.time[i]
    if (Number.isNaN(t)) continue
    if (Number.isNaN(from)) from = t
    to = t
  }
  return Number.isNaN(from) ? undefined : { from, to }
}

/** Recorded instant under the marker at film time `timeS` (ms since epoch), undefined for an untimed track. */
export function recordedAtFilmTime(path: TrackPath, clock: Pick<FilmClock, 'progressAtTime'>, timeS: number): number | undefined {
  if (path.count === 0) return undefined
  return recordedTimeAt(path, Math.min(1, Math.max(0, clock.progressAtTime(timeS))) * path.lengthM)
}

/** Most hours tried when a clip does not fall within the outing (camera clock set to local time, written as UTC). */
export const SYNC_MAX_HOURS = 14

/**
 * Clock correction (seconds) under which a clip recorded from `startMs`, `fileS` long, overlaps the recorded outing:
 * 0 when it does as it is, else the whole number of hours nearest to 0 that makes it overlap (a camera set to local
 * time writes it as if it were UTC), undefined when none does or the track has no time.
 */
export function clipSyncOffsetS(path: TrackPath, startMs: number, fileS: number): number | undefined {
  const range = recordedRange(path)
  if (!range) return undefined
  const overlaps = (offsetS: number) => startMs + offsetS * 1000 < range.to && startMs + (offsetS + fileS) * 1000 > range.from
  for (let h = 0; h <= SYNC_MAX_HOURS; h++) {
    for (const offsetS of h === 0 ? [0] : [-h * 3600, h * 3600]) if (overlaps(offsetS)) return offsetS
  }
  return undefined
}

/**
 * Place on the timeline of a synced clip (`media.sync`, `fileS`: its length): it starts when the marker passes the
 * point recorded at its start (at the start of the flight for a clip started before the outing, `inS` skipping the
 * part filmed before); following the flight, it lasts until the marker passes the point recorded at its end (or the
 * end of the outing), else its length in the file from there, at most its current duration. Undefined when the
 * clip does not overlap the outing or the track has no time.
 */
export function syncClipPlacement(
  media: FilmMedia,
  path: TrackPath,
  clock: Pick<FilmClock, 'timeAtProgress'>,
  fileS: number,
): Pick<FilmMedia, 'startS' | 'durationS' | 'inS'> | undefined {
  const range = recordedRange(path)
  if (!media.sync || !range || path.lengthM <= 0) return undefined
  const startMs = media.sync.startMs + media.sync.offsetS * 1000
  const endMs = startMs + fileS * 1000
  if (startMs >= range.to || endMs <= range.from) return undefined
  const filmTimeAt = (ms: number) => clock.timeAtProgress((distanceAtTime(path, ms) ?? 0) / path.lengthM)
  const inS = Math.max(0, (range.from - startMs) / 1000)
  const startS = filmTimeAt(Math.max(startMs, range.from))
  const durationS = media.sync.follow ? filmTimeAt(Math.min(endMs, range.to)) - startS : Math.min(media.durationS, fileS - inS)
  return { startS: roundS(startS), durationS: itemDuration(durationS), inS: roundS(inS) }
}

/**
 * `film` with clip `id` synced (`sync`) and placed by `syncClipPlacement`; undefined when it does not overlap the
 * outing (or is not in the film).
 */
export function syncClip(film: Film, id: string, sync: MediaSync, path: TrackPath, clock: Pick<FilmClock, 'timeAtProgress'>, fileS: number): Film | undefined {
  const media = film.media.find((m) => m.id === id)
  const place = media && syncClipPlacement({ ...media, sync }, path, clock, fileS)
  return place && updateMedia(film, id, { sync, ...place })
}

/** Film time over which the preview measures how fast a clip following the flight plays (seconds). */
export const FOLLOW_RATE_STEP_S = 0.25

/**
 * Seconds of the file played per second of film at film time `timeS`: 1 for a clip that does not follow the flight;
 * following it, how fast the recorded time passes under the marker (0 during a stop: the frame holds).
 */
export function clipRateAt(media: FilmMedia, path: TrackPath, clock: Pick<FilmClock, 'progressAtTime'>, timeS: number): number {
  if (!media.sync?.follow) return 1
  const a = recordedAtFilmTime(path, clock, timeS)
  const b = recordedAtFilmTime(path, clock, timeS + FOLLOW_RATE_STEP_S)
  if (a === undefined || b === undefined) return 1
  return Math.max(0, (clipTimeS(media, timeS + FOLLOW_RATE_STEP_S, b) - clipTimeS(media, timeS, a)) / FOLLOW_RATE_STEP_S)
}

/** `film` without the stop, speed portion, camera key, text, medium or music clip `id`; a shot cannot be removed: it goes to style 'aucune'. */
export function removeFilmItem(film: Film, id: TimelineItem): Film {
  if (id === 'opening' || id === 'closing') return updateShot(film, id, { style: 'aucune' })
  return {
    ...film,
    stops: film.stops.filter((s) => s.id !== id),
    speeds: film.speeds.filter((s) => s.id !== id),
    cameraKeys: film.cameraKeys.filter((k) => k.id !== id),
    texts: film.texts.filter((t) => t.id !== id),
    media: film.media.filter((m) => m.id !== id),
    audio: film.audio.filter((a) => a.id !== id),
  }
}

/**
 * `item` is in the film: a shot (always there), one of the clock's `stops` (generated ones included), a speed portion,
 * a camera key, a text, a medium or a music clip.
 */
export function hasFilmItem(film: Film, stops: readonly { id: string }[], item: TimelineItem): boolean {
  if (item === 'opening' || item === 'closing') return true
  return [stops, film.speeds, film.cameraKeys, film.texts, film.media, film.audio].some((lane) => lane.some((s) => s.id === item))
}

/** Stop `id` with `patch`, duration clamped to its range. */
export function updateStop(film: Film, id: string, patch: Partial<Omit<FilmStop, 'id'>>): Film {
  return {
    ...film,
    stops: film.stops.map((s) => {
      if (s.id !== id) return s
      const next = { ...s, ...patch }
      return { ...next, durationS: stopDuration(next.durationS), atM: Math.max(0, next.atM) }
    }),
  }
}

/** Speed factor clamped to its range, kept at 1/100. */
export const speedFactor = (f: number) => Math.round(clamp(f, SPEED_FACTOR_RANGE.min, SPEED_FACTOR_RANGE.max) * 100) / 100

/** 2 -> "×2", 0.25 -> "×0,25". */
export const formatSpeedFactor = (f: number) => `×${String(Math.round(f * 100) / 100).replace('.', ',')}`

/**
 * Speed portion `id` with `patch`: factor clamped to its range, edges rounded to the metre and kept on the track,
 * off the neighbouring portions and at least `MIN_SPEED_SPAN_M` apart (the edge not in `patch` gives way first).
 */
export function updateSpeed(film: Film, id: string, patch: Partial<Omit<FilmSpeed, 'id'>>, lengthM: number): Film {
  const own = film.speeds.find((s) => s.id === id)
  if (!own) return film
  const { lo, hi } = speedRoom(film.speeds, own, lengthM)
  const minSpan = Math.min(MIN_SPEED_SPAN_M, hi - lo)
  let fromM = Math.round(clamp(patch.fromM ?? own.fromM, lo, hi - minSpan))
  let toM = Math.round(clamp(patch.toM ?? own.toM, lo + minSpan, hi))
  if (toM - fromM < minSpan) {
    if (patch.toM === undefined) toM = Math.min(hi, fromM + minSpan)
    else fromM = Math.max(lo, toM - minSpan)
  }
  const next = { ...own, ...patch, fromM, toM, factor: speedFactor(patch.factor ?? own.factor) }
  return { ...film, speeds: film.speeds.map((s) => (s.id === id ? next : s)) }
}

/**
 * Camera key `id` with `patch`: distance and pitch clamped to the camera ranges, heading brought into -180°..180°
 * (at 1/100 and 1/10°), position to the metre.
 */
export function updateCameraKey(film: Film, id: string, patch: Partial<Omit<FilmCameraKey, 'id'>>): Film {
  const { distance, pitchDeg } = CAMERA_RANGES
  const within = (v: number, r: { min: number; max: number }, per: number) => Math.round(clamp(v, r.min, r.max) * per) / per
  const heading = (deg: number) => Math.round(((((deg + 180) % 360) + 360) % 360) * 10) / 10 - 180
  return {
    ...film,
    cameraKeys: film.cameraKeys.map((k) => {
      if (k.id !== id) return k
      const next = { ...k, ...patch }
      return {
        ...next,
        atM: Math.max(0, Math.round(next.atM)),
        distance: within(next.distance, distance, 100),
        pitchDeg: within(next.pitchDeg, pitchDeg, 10),
        headingOffsetDeg: heading(next.headingOffsetDeg),
      }
    }),
  }
}

/** Text `id` with `patch`, start and duration clamped to their ranges. */
export function updateText(film: Film, id: string, patch: Partial<Omit<FilmText, 'id'>>): Film {
  return {
    ...film,
    texts: film.texts.map((t) => {
      if (t.id !== id) return t
      const next = { ...t, ...patch }
      return { ...next, startS: roundS(Math.max(0, next.startS)), durationS: itemDuration(next.durationS) }
    }),
  }
}

/** Medium `id` with `patch`, start, duration and start in the file (video) clamped to their ranges. */
export function updateMedia(film: Film, id: string, patch: Partial<Omit<FilmMedia, 'id'>>): Film {
  return {
    ...film,
    media: film.media.map((m) => {
      if (m.id !== id) return m
      const next = { ...m, ...patch }
      const inS = next.inS === undefined ? {} : { inS: roundS(Math.max(0, next.inS)) }
      return { ...next, startS: roundS(Math.max(0, next.startS)), durationS: itemDuration(next.durationS), ...inS }
    }),
  }
}

/**
 * Music clip `id` with `patch`: start in the file within it (`fileS`: its length, when known), duration never past
 * its end, volume 0–1 at 1/100, fades within their range.
 */
export function updateMusic(film: Film, id: string, patch: Partial<Omit<FilmAudio, 'id'>>, fileS?: number): Film {
  return {
    ...film,
    audio: film.audio.map((a) => {
      if (a.id !== id) return a
      const next = { ...a, ...patch }
      const inS = roundS(clamp(next.inS, 0, fileS === undefined ? Infinity : Math.max(0, fileS - AUDIO_DURATION_RANGE.min)))
      return {
        ...next,
        startS: roundS(Math.max(0, next.startS)),
        inS,
        durationS: roundS(clamp(next.durationS, AUDIO_DURATION_RANGE.min, musicMaxS(inS, fileS))),
        volume: Math.round(clamp(next.volume, 0, 1) * 100) / 100,
        fadeInS: roundS(clamp(next.fadeInS, FADE_RANGE.min, FADE_RANGE.max)),
        fadeOutS: roundS(clamp(next.fadeOutS, FADE_RANGE.min, FADE_RANGE.max)),
      }
    }),
  }
}

/**
 * Shot `key` with `patch`, duration clamped to its range; a field patched to undefined is removed (back to its
 * default). Switched to 'situation' with its default duration still, the shot gets `SITUATION_DURATION_S`: the dive
 * from the region is long.
 */
export function updateShot(film: Film, key: 'opening' | 'closing', patch: Partial<FilmShot>): Film {
  const before = film[key]
  const longer =
    patch.style === 'situation' && before.style !== 'situation' && patch.durationS === undefined && before.durationS === DEFAULT_FILM[key].durationS
  const shot: Record<string, unknown> = { ...before, ...patch, ...(longer && { durationS: SITUATION_DURATION_S }) }
  for (const field of Object.keys(shot)) if (shot[field] === undefined) delete shot[field]
  const merged = shot as unknown as FilmShot
  return { ...film, [key]: { ...merged, durationS: shotDuration(merged.durationS) } }
}

/** The place highlighted by the 'situation' shots (« Lieu »; null: automatic), the same for the opening and the closing. */
export function setFilmPlace(film: Film, regionId: string | null): Film {
  const patch = { regionId: regionId ?? undefined }
  return updateShot(updateShot(film, 'opening', patch), 'closing', patch)
}

// ---------------------------------------------------------------------------
// Texts and media attached to a stop
// ---------------------------------------------------------------------------

type Attachable = FilmText | FilmMedia

function detach<T extends Attachable>(item: T): T {
  const { stopId: _, ...free } = item
  return free as T
}

/**
 * Text or medium `id` attached to `stop` (a stop of the clock of `film`, its own stops written out), or free again
 * (null). Attached, a text or a video moves to the start of the hold of the stop and a photo is fitted to the hold
 * (shown while the marker holds); freed, it stays where it is.
 */
export function attachToStop(film: Film, id: string, stop: ClockStop | null): Film {
  const attach = <T extends Attachable>(item: T, fit: boolean): T => {
    if (item.id !== id) return item
    if (!stop) return detach(item)
    const startS = roundS(stop.holdStartS)
    return { ...item, stopId: stop.id, startS, durationS: fit ? itemDuration(stop.holdEndS - stop.holdStartS) : item.durationS }
  }
  return { ...film, texts: film.texts.map((t) => attach(t, false)), media: film.media.map((m) => attach(m, m.kind === 'image')) }
}

/** Two film times equal at the rounding of the stored values. */
const sameTime = (a: number, b: number) => Math.abs(a - b) < 0.015

/**
 * `after` (an edit of `before`) with its attached texts and media following their stop: an item the edit did not
 * move or stretch itself keeps its offset to the start of the stop's hold (an item fitted to the hold stays fitted,
 * stretched with it); an item whose stop is not among the film's own stops any more (removed, automatic stops back)
 * becomes free where it is. `clockOf` gives the clock of a film (same track and pacing); `clockBefore` the clock of
 * `before` when the change also moves what the clock is made from (flyover duration, pacing). `after` itself when
 * nothing changes.
 */
export function followStops(
  before: Film,
  after: Film,
  clockOf: (film: Film) => FilmClock,
  clockBefore: (film: Film) => FilmClock = clockOf,
): Film {
  if (!after.texts.some((t) => t.stopId !== undefined) && !after.media.some((m) => m.stopId !== undefined)) return after
  const own = new Set(after.autoStops ? [] : after.stops.map((s) => s.id))
  // only the stops, the speed portions, the shots and the clock (duration, pacing) move a stop in film time
  const moves =
    clockBefore !== clockOf ||
    before.stops !== after.stops ||
    before.speeds !== after.speeds ||
    before.opening !== after.opening ||
    before.closing !== after.closing ||
    before.autoStops !== after.autoStops
  let clocks: { from: FilmClock; to: FilmClock } | undefined
  let changed = false
  const follow = <T extends Attachable>(item: T, previous: readonly T[]): T => {
    if (item.stopId === undefined) return item
    if (!own.has(item.stopId)) {
      changed = true
      return detach(item)
    }
    const old = previous.find((p) => p.id === item.id)
    if (!moves || !old || old.startS !== item.startS || old.durationS !== item.durationS) return item
    clocks ??= { from: clockBefore(before), to: clockOf(after) }
    const from = clocks.from.stops.find((s) => s.id === item.stopId)
    const to = clocks.to.stops.find((s) => s.id === item.stopId)
    if (!from || !to) return item
    const fitted = sameTime(item.startS, from.holdStartS) && sameTime(item.startS + item.durationS, from.holdEndS)
    const startS = roundS(Math.max(0, fitted ? to.holdStartS : item.startS + to.holdStartS - from.holdStartS))
    const durationS = fitted ? itemDuration(to.holdEndS - to.holdStartS) : item.durationS
    if (startS === item.startS && durationS === item.durationS) return item
    changed = true
    return { ...item, startS, durationS }
  }
  const texts = after.texts.map((t) => follow(t, before.texts))
  const media = after.media.map((m) => follow(m, before.media))
  return changed ? { ...after, texts, media } : after
}

/**
 * Timeline of the film (`ui/Timeline.tsx`): time ↔ pixel scale, ruler, snapping, and the edits of the film made
 * by its gestures (drag a block, drag an edge, nudge, add, remove), as pure functions of the film. The component
 * only turns pointer and keyboard events into these calls and commits the result as one undo step.
 *
 * Items are selected by id: 'opening', 'closing', or the id of a stop, a speed portion, a text or a medium (unique
 * across the film).
 * Times are film times (seconds at ×1 from the first frame, opening included).
 */
import { distanceAtTime, nearestOnPath } from '../flyover/path'
import type { TrackPath } from '../flyover/path'
import type { ClockStop, FilmClock } from './clock'
import {
  AUTO_STOP_S,
  ITEM_DURATION_RANGE,
  MEDIA_DEFAULTS,
  MIN_SPEED_SPAN_M,
  SHOT_DURATION_RANGE,
  SPEED_FACTOR_RANGE,
  STOP_DURATION_RANGE,
  nextFilmId,
} from './model'
import type { Film, FilmMedia, FilmShot, FilmSpeed, FilmStop, FilmText } from './model'

export type TimelineItem = 'opening' | 'closing' | string
/** part of a block a gesture holds: its body (move) or one of its edges */
export type Grip = 'move' | 'start' | 'end'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
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
 * Times a dragged edge snaps to: start and end of the film, edges of the shots, of the stops, speed portions, texts
 * and media (but those of `except`), highlights (progress values), playhead.
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
  for (const t of [...film.texts, ...film.media]) if (t.id !== except) out.push(t.startS, t.startS + t.durationS)
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
function positionAtTime(timeOf: (m: number) => number, targetS: number, lo: number, hi: number): number {
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
}

const shotDuration = (d: number) => roundS(clamp(d, SHOT_DURATION_RANGE.min, SHOT_DURATION_RANGE.max))
const stopDuration = (d: number) => roundS(clamp(d, STOP_DURATION_RANGE.min, STOP_DURATION_RANGE.max))
const itemDuration = (d: number) => roundS(clamp(d, ITEM_DURATION_RANGE.min, ITEM_DURATION_RANGE.max))

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
 * the track), text or medium moved or stretched by either edge. Edges snap to `ctx.targets`; values are clamped
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

  const speed = film.speeds.find((s) => s.id === item)
  if (speed) {
    const next = dragSpeed(film, speed, grip, deltaS, ctx, snap)
    return next.fromM === speed.fromM && next.toM === speed.toM ? film : { ...film, speeds: film.speeds.map((s) => (s.id === item ? next : s)) }
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

/** Length of a text added on the timeline (seconds). */
export const NEW_TEXT_S = 4

/** A text added at film time `startS`, centred low, normal size; with its new id. */
export function addText(film: Film, startS: number): { film: Film; id: string } {
  const id = nextFilmId(film, 'text')
  const text: FilmText = { id, startS: roundS(Math.max(0, startS)), durationS: NEW_TEXT_S, text: 'Nouveau texte', anchor: 'bottom-center', size: 1 }
  return { film: { ...film, texts: [...film.texts, text] }, id }
}

/** Length of a photo added on the timeline (seconds). */
export const NEW_MEDIA_S = 5
/** Longest a video is when added (seconds; its natural length below that, stretched or trimmed afterwards). */
export const NEW_VIDEO_MAX_S = 30

/**
 * Media added one after the other from film time `startS`, one per entry of the media table (`src`): a photo
 * `NEW_MEDIA_S` long, a video (`videoS`: its length in the file) its natural length up to `NEW_VIDEO_MAX_S`, without
 * Ken Burns; `MEDIA_DEFAULTS` placement otherwise. With their new ids.
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
    if (video) media.kenBurns = false
    next = { ...next, media: [...next.media, media] }
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

/** `film` without the stop, speed portion, text or media `id`; a shot cannot be removed: it goes to style 'aucune'. */
export function removeFilmItem(film: Film, id: TimelineItem): Film {
  if (id === 'opening' || id === 'closing') return updateShot(film, id, { style: 'aucune' })
  return {
    ...film,
    stops: film.stops.filter((s) => s.id !== id),
    speeds: film.speeds.filter((s) => s.id !== id),
    texts: film.texts.filter((t) => t.id !== id),
    media: film.media.filter((m) => m.id !== id),
  }
}

/**
 * `item` is in the film: a shot (always there), one of the clock's `stops` (generated ones included), a speed portion,
 * a text or a medium.
 */
export function hasFilmItem(film: Film, stops: readonly { id: string }[], item: TimelineItem): boolean {
  if (item === 'opening' || item === 'closing') return true
  return [stops, film.speeds, film.texts, film.media].some((lane) => lane.some((s) => s.id === item))
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

/** Shot `key` with `patch`, duration clamped to its range. */
export function updateShot(film: Film, key: 'opening' | 'closing', patch: Partial<FilmShot>): Film {
  const shot = { ...film[key], ...patch }
  return { ...film, [key]: { ...shot, durationS: shotDuration(shot.durationS) } }
}

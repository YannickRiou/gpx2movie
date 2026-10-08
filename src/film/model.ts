/**
 * The film: what the timeline arranges on top of the flight along the first track (« la base, c'est le GPX »).
 *
 * - `opening` / `closing`: overview shot of the whole track before and after the flight ('aucune' = none).
 * - `stops`: the marker stops at a distance along the first track for a while (camera orbiting or held). While
 *   `autoStops` is set they are generated from the highlights (`autoStops` in `assemble.ts`, so they follow the
 *   OpenStreetMap landmarks loaded later), as `autoMode` says; the first edit on the timeline writes them into
 *   `stops` and clears the flag.
 * - `speeds`: portions of the first track (metres) flown faster or slower by hand (`factor`), not overlapping;
 *   the flight pacing eases into and out of each (`flightPacing`).
 * - `texts` and `media`: items anchored in film time (seconds at ×1 from the very start, opening included), on
 *   their own lanes, drawn by the overlay. A medium names its picture or video clip by id (`src`): the bytes live in the media
 *   table of the project document (`film/media.ts`), so the settings and the undo history stay light.
 * - `audio`: music clips of the soundtrack, in film time too, on the « Musique » lane: played along by the preview
 *   and mixed into the exported film (`film/audio.ts`); their files are in the media table as well.
 *
 * Part of `Settings` (key `film`): saved in the project document, undone, read the same way by the preview and
 * the export. Ids are stable (`stop-3`, `text-1`, `auto-4520` for a generated stop) so the timeline can select
 * an item across edits. Pure module (no DOM, no React, no Three, no store).
 */
import { OVERLAY_ANCHORS, WIDGET_SIZE_MAX, WIDGET_SIZE_MIN } from '../overlay/settings'
import type { OverlayAnchor } from '../overlay/settings'

export const SHOT_STYLES = ['aucune', 'descente', 'saut'] as const
/** 'descente': the camera glides from the overview down to the flight; 'saut': overview held, then a quick move. */
export type ShotStyle = (typeof SHOT_STYLES)[number]

export interface FilmShot {
  style: ShotStyle
  /** seconds at ×1 (unused with 'aucune') */
  durationS: number
}

export const STOP_CAMERAS = ['orbite', 'fixe'] as const
/** 'orbite': the camera turns around the stop and comes back; 'fixe': the flight camera holds. */
export type StopCamera = (typeof STOP_CAMERAS)[number]

export const STOP_SOURCES = ['climb', 'landmark', 'waypoint', 'manual'] as const
export type StopSourceKind = (typeof STOP_SOURCES)[number]

export interface FilmStop {
  id: string
  /** distance along the first track (metres, same scale as `buildTrackPath`) */
  atM: number
  /** time added to the film (seconds at ×1, eases in and out included) */
  durationS: number
  camera: StopCamera
  label?: string
  /** what the stop was made for: climb index, OSM id, waypoint index */
  source?: { kind: StopSourceKind; ref?: string }
}

export interface FilmText {
  id: string
  /** film time of its appearance and how long it stays (seconds at ×1) */
  startS: number
  durationS: number
  text: string
  subtitle?: string
  /** same placement as the overlay text widget: one of the nine anchors, size multiplier */
  anchor: OverlayAnchor
  size: number
}

export const AUTO_STOP_MODES = ['temps-forts', 'rythme'] as const
/**
 * How the automatic stops are made. 'temps-forts' (new projects): one at every highlight whatever the pacing,
 * `AUTO_STOP_S` each, camera orbiting (highlights are climb tops, passes and summits); 'rythme' (projects saved
 * before the timeline): the pauses of the pacing, only while it is on, `pauseS` each, camera held.
 */
export type AutoStopMode = (typeof AUTO_STOP_MODES)[number]

/** 'image': a photo; 'video': a video clip (shown without its sound). */
export const MEDIA_KINDS = ['image', 'video'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

export const MEDIA_LAYOUTS = ['plein-ecran', 'carte'] as const
/** 'plein-ecran': the photo covers the 3D view; 'carte': a framed photo card at an anchor of the overlay. */
export type MediaLayout = (typeof MEDIA_LAYOUTS)[number]

export interface FilmMedia {
  id: string
  /** film time of its appearance and how long it stays (seconds at ×1) */
  startS: number
  durationS: number
  kind: MediaKind
  /** id of the picture in the media table of the project document */
  src: string
  layout: MediaLayout
  /** card placement (one of the nine anchors) and size multiplier; the caption of a full-screen photo goes there too */
  anchor: OverlayAnchor
  size: number
  /** slow zoom and pan over a full-screen photo (not used by a video) */
  kenBurns: boolean
  caption?: string
  /** video: where the clip starts and ends in the file (seconds; default its start and its end) */
  inS?: number
  outS?: number
  /** video: reserved, the sound of the clips is not handled yet */
  muted?: boolean
  /** video synced with the recorded track (« Caler sur le parcours »), see `MediaSync` */
  sync?: MediaSync
}

/**
 * A clip synced with the recorded track: when it was recorded and how its time follows the flight. Its place on
 * the timeline is set by `syncClipPlacement` (film/timeline.ts) when it is synced or its offset changes.
 */
export interface MediaSync {
  /** recording start of the clip (ms since epoch, from the file) */
  startMs: number
  /** correction of the camera clock (seconds; positive: the clip was recorded later than its file says) */
  offsetS: number
  /**
   * the clip's time follows the flight: the frame shown is the one recorded when the athlete was where the marker
   * is (slow-downs, speed portions and stops of the film included; during a stop the frame holds)
   */
  follow: boolean
}

/** Range of the clock correction of a synced clip (seconds): a day either way covers time zones. */
export const SYNC_OFFSET_RANGE = { min: -86_400, max: 86_400 } as const

export interface FilmSpeed {
  id: string
  /** portion of the first track (metres, `fromM` < `toM`) */
  fromM: number
  toM: number
  /** local ground speed multiplied by this (2 = twice as fast, 0.5 = half as fast) */
  factor: number
}

export interface FilmAudio {
  id: string
  /** id of the sound file in the media table of the project document */
  src: string
  /** film time at which it starts and how long it plays (seconds at ×1; never past the end of the file) */
  startS: number
  durationS: number
  /** where it starts in the file (seconds) */
  inS: number
  /** 0 (silent) to 1 (as recorded) */
  volume: number
  /** linear fades at its start and its end (seconds; shortened in proportion when they overlap) */
  fadeInS: number
  fadeOutS: number
}

/** Volume and fades of a music clip added on the timeline. */
export const AUDIO_DEFAULTS: Pick<FilmAudio, 'volume' | 'fadeInS' | 'fadeOutS'> = { volume: 1, fadeInS: 0.5, fadeOutS: 2 }
/** Ranges of a music clip (also its validity ranges in a loaded project), seconds. */
export const AUDIO_DURATION_RANGE = { min: 0.5, max: 3600 } as const
export const FADE_RANGE = { min: 0, max: 30, step: 0.5 } as const

/** Range of the speed factor (also its validity range in a loaded project). */
export const SPEED_FACTOR_RANGE = { min: 0.25, max: 4 } as const
/** Shortest speed portion made on the timeline (metres). */
export const MIN_SPEED_SPAN_M = 50

/** Placement of a photo added on the timeline (and of a medium saved before these fields existed). */
export const MEDIA_DEFAULTS: Pick<FilmMedia, 'layout' | 'anchor' | 'size' | 'kenBurns'> = {
  layout: 'plein-ecran',
  anchor: 'bottom-left',
  size: 1,
  kenBurns: true,
}

export interface Film {
  opening: FilmShot
  closing: FilmShot
  /** stops generated from the pacing highlights (`stops` ignored) until the user edits them */
  autoStops: boolean
  autoMode: AutoStopMode
  stops: FilmStop[]
  /** sorted by position or not, never overlapping */
  speeds: FilmSpeed[]
  texts: FilmText[]
  media: FilmMedia[]
  /** music of the soundtrack (they may overlap: mixed) */
  audio: FilmAudio[]
}

/** Slider ranges (also the validity ranges of a loaded project), seconds. */
export const SHOT_DURATION_RANGE = { min: 1, max: 30, step: 0.5 } as const
export const STOP_DURATION_RANGE = { min: 0.5, max: 60, step: 0.5 } as const
export const ITEM_DURATION_RANGE = { min: 0.5, max: 600, step: 0.5 } as const
/** Length of a generated stop ('temps-forts') and of a stop added on the timeline (seconds). */
export const AUTO_STOP_S = 4

export const DEFAULT_FILM: Film = {
  opening: { style: 'descente', durationS: 6 },
  closing: { style: 'descente', durationS: 5 },
  autoStops: true,
  autoMode: 'temps-forts',
  stops: [],
  speeds: [],
  texts: [],
  media: [],
  audio: [],
}

/**
 * Time in the file of a video shown at film time `timeS`: its start in the file (`inS`) plus the time since the
 * clip appeared, held at its end in the file (`outS`; past the end of the file, its last frame is held). A synced
 * clip following the flight (`sync.follow`) shows instead what it recorded at `recordedMs`, the recorded instant
 * under the marker at that film time (ms since epoch; without it, as an unsynced clip), within `inS` and `outS`.
 */
export function clipTimeS(media: Pick<FilmMedia, 'startS' | 'inS' | 'outS' | 'sync'>, timeS: number, recordedMs?: number): number {
  const follows = media.sync?.follow && recordedMs !== undefined && Number.isFinite(recordedMs)
  const t = follows
    ? Math.max(media.inS ?? 0, (recordedMs - media.sync!.startMs) / 1000 - media.sync!.offsetS)
    : (media.inS ?? 0) + Math.max(0, timeS - media.startS)
  return media.outS === undefined ? t : Math.min(t, media.outS)
}

/** Film time taken by an opening or closing shot. */
export function shotDurationS(shot: FilmShot): number {
  return shot.style === 'aucune' ? 0 : shot.durationS
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

export type FilmItemKind = 'stop' | 'speed' | 'text' | 'media' | 'music'

/** Next free id `<kind>-<n>` of the film (one more than the highest number used by that kind). */
export function nextFilmId(film: Film, kind: FilmItemKind): string {
  const lanes = { stop: film.stops, speed: film.speeds, text: film.texts, media: film.media, music: film.audio }
  const items: readonly { id: string }[] = lanes[kind]
  const pattern = new RegExp(`^${kind}-(\\d+)$`)
  let max = 0
  for (const { id } of items) {
    const match = pattern.exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `${kind}-${max + 1}`
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const within = (v: unknown, min: number, max: number) => typeof v === 'number' && v >= min && v <= max
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const oneOf = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v)
const optionalString = (v: unknown) => v === undefined || typeof v === 'string'
const isId = (v: unknown) => typeof v === 'string' && v !== ''

export function isValidShot(shot: unknown): shot is FilmShot {
  return isRecord(shot) && oneOf(SHOT_STYLES, shot.style) && within(shot.durationS, SHOT_DURATION_RANGE.min, SHOT_DURATION_RANGE.max)
}

export function isValidStop(stop: unknown): stop is FilmStop {
  if (!isRecord(stop)) return false
  const source = stop.source
  return (
    isId(stop.id) &&
    within(stop.atM, 0, Number.MAX_VALUE) &&
    within(stop.durationS, STOP_DURATION_RANGE.min, STOP_DURATION_RANGE.max) &&
    oneOf(STOP_CAMERAS, stop.camera) &&
    optionalString(stop.label) &&
    (source === undefined || (isRecord(source) && oneOf(STOP_SOURCES, source.kind) && optionalString(source.ref)))
  )
}

export function isValidSpeed(speed: unknown): speed is FilmSpeed {
  return (
    isRecord(speed) &&
    isId(speed.id) &&
    within(speed.fromM, 0, Number.MAX_VALUE) &&
    within(speed.toM, 0, Number.MAX_VALUE) &&
    (speed.toM as number) > (speed.fromM as number) &&
    within(speed.factor, SPEED_FACTOR_RANGE.min, SPEED_FACTOR_RANGE.max)
  )
}

/** No two portions overlap (they may touch). */
function apart(speeds: readonly FilmSpeed[]): boolean {
  const sorted = [...speeds].sort((a, b) => a.fromM - b.fromM)
  return sorted.every((s, i) => i === 0 || sorted[i - 1].toM <= s.fromM)
}

/** Shared by texts and media: id, start in film time, duration. */
function isValidTimed(item: Record<string, unknown>): boolean {
  return isId(item.id) && within(item.startS, 0, Number.MAX_VALUE) && within(item.durationS, ITEM_DURATION_RANGE.min, ITEM_DURATION_RANGE.max)
}

export function isValidText(text: unknown): text is FilmText {
  return (
    isRecord(text) &&
    isValidTimed(text) &&
    typeof text.text === 'string' &&
    optionalString(text.subtitle) &&
    oneOf(OVERLAY_ANCHORS, text.anchor) &&
    within(text.size, WIDGET_SIZE_MIN, WIDGET_SIZE_MAX)
  )
}

export function isValidMedia(media: unknown): media is FilmMedia {
  if (!isRecord(media)) return false
  const inS = media.inS ?? 0
  return (
    isValidTimed(media) &&
    oneOf(MEDIA_KINDS, media.kind) &&
    isId(media.src) &&
    oneOf(MEDIA_LAYOUTS, media.layout) &&
    oneOf(OVERLAY_ANCHORS, media.anchor) &&
    within(media.size, WIDGET_SIZE_MIN, WIDGET_SIZE_MAX) &&
    typeof media.kenBurns === 'boolean' &&
    optionalString(media.caption) &&
    within(inS, 0, Number.MAX_VALUE) &&
    (media.outS === undefined || within(media.outS, (inS as number) + 0.01, Number.MAX_VALUE)) &&
    (media.muted === undefined || typeof media.muted === 'boolean') &&
    (media.sync === undefined || isValidSync(media.sync))
  )
}

function isValidSync(sync: unknown): sync is MediaSync {
  return (
    isRecord(sync) &&
    typeof sync.startMs === 'number' &&
    Number.isFinite(sync.startMs) &&
    within(sync.offsetS, SYNC_OFFSET_RANGE.min, SYNC_OFFSET_RANGE.max) &&
    typeof sync.follow === 'boolean'
  )
}

export function isValidAudio(audio: unknown): audio is FilmAudio {
  return (
    isRecord(audio) &&
    isId(audio.id) &&
    isId(audio.src) &&
    within(audio.startS, 0, Number.MAX_VALUE) &&
    within(audio.durationS, AUDIO_DURATION_RANGE.min, AUDIO_DURATION_RANGE.max) &&
    within(audio.inS, 0, Number.MAX_VALUE) &&
    within(audio.volume, 0, 1) &&
    within(audio.fadeInS, FADE_RANGE.min, FADE_RANGE.max) &&
    within(audio.fadeOutS, FADE_RANGE.min, FADE_RANGE.max)
  )
}

/**
 * Value checks of a film whose top-level shape already matches `DEFAULT_FILM` (see `SETTING_CHECKS` in the
 * project document): shots, every item of every lane, speed portions apart, ids unique across the film.
 */
export function isValidFilm(film: Film): boolean {
  if (!isValidShot(film.opening) || !isValidShot(film.closing) || typeof film.autoStops !== 'boolean') return false
  if (!oneOf(AUTO_STOP_MODES, film.autoMode)) return false
  if (!film.stops.every(isValidStop) || !film.texts.every(isValidText) || !film.media.every(isValidMedia)) return false
  if (!film.speeds.every(isValidSpeed) || !apart(film.speeds) || !film.audio.every(isValidAudio)) return false
  const ids = [...film.stops, ...film.speeds, ...film.texts, ...film.media, ...film.audio].map((item) => item.id)
  return new Set(ids).size === ids.length
}

/**
 * Fill-in of a film saved before a field existed (`SETTING_UPGRADES`): missing fields from `DEFAULT_FILM`, except
 * `autoMode`, which keeps the automatic stops of those films following the pacing ('rythme') as they did; media
 * saved before their placement get `MEDIA_DEFAULTS`; a film saved before the music gets no music (`audio: []`).
 */
export function withFilmDefaults(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const film = { ...DEFAULT_FILM, autoMode: 'rythme', ...raw }
  return Array.isArray(film.media) ? { ...film, media: film.media.map((m: unknown) => (isRecord(m) ? { ...MEDIA_DEFAULTS, ...m } : m)) } : film
}

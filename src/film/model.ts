/**
 * The film: what the timeline arranges on top of the flight along the first track (« la base, c'est le GPX »).
 *
 * - `opening` / `closing`: overview shot of the whole track before and after the flight ('aucune' = none), joined to
 *   it by a continuous move, a cut or a dip to black or white (`transition`).
 * - `stops`: the marker stops at a distance along the first track for a while (camera as in the film, orbiting,
 *   pulled back or held). While
 *   `autoStops` is set they are generated from the highlights (`autoStops` in `assemble.ts`, so they follow the
 *   OpenStreetMap landmarks loaded later), as `autoMode` says; the first edit on the timeline writes them into
 *   `stops` and clears the flag.
 * - `speeds`: portions of the first track (metres) flown faster or slower by hand (`factor`), not overlapping;
 *   the flight pacing eases into and out of each (`flightPacing`).
 * - `cameraKeys`: framings of the flight camera at a distance along the first track (`keyedCamera`).
 * - `texts` and `media`: items anchored in film time (seconds at ×1 from the very start, opening included), on
 *   their own lanes, drawn by the overlay. A medium names its picture or video clip by id (`src`): the bytes live in the media
 *   table of the project document (`film/media.ts`), so the settings and the undo history stay light.
 * - `audio`: music clips of the soundtrack, in film time too, on the « Musique » lane: played along by the preview
 *   and mixed into the exported film (`film/audio.ts`); their files are in the media table as well. The sound of the
 *   video clips joins that mix (`clipHasSound`), and `duckMusic` lowers the music under it.
 * - `pois`: points of interest named by hand (« Le chalet de Paul »), drawn as labels on the relief like the
 *   OpenStreetMap landmarks (`poiLabels`, scene/labelModel.ts); edited by `film/pois.ts`.
 *
 * Part of `Settings` (key `film`): saved in the project document, undone, read the same way by the preview and
 * the export. Ids are stable (`stop-3`, `text-1`, `auto-4520` for a generated stop) so the timeline can select
 * an item across edits. Pure module (no DOM, no React, no Three, no store).
 */
import { isRecord, oneOf } from '../core/guards'
import { smootherstep } from '../core/math'
import { CAMERA_RANGES } from '../flyover/cameraSettings'
import { OVERLAY_ANCHORS, OVERLAY_FONT_IDS, WIDGET_SIZE_MAX, WIDGET_SIZE_MIN, isHexColor } from '../overlay/settings'
import type { OverlayAnchor, OverlayFontId } from '../overlay/settings'

export const SHOT_STYLES = ['aucune', 'descente', 'saut', 'situation', 'balayage'] as const
/**
 * 'descente': the camera glides from the overview down to the flight; 'saut': overview held, then a quick move;
 * 'situation': like 'descente', from much higher above the region (closing: back up to it); 'balayage': the
 * overview turns slowly around the track, then glides down to the flight (closing: up, then the turn).
 */
export type ShotStyle = (typeof SHOT_STYLES)[number]

export const SHOT_TRANSITIONS = ['enchaine', 'coupe', 'fondu-noir', 'fondu-blanc'] as const
/**
 * How a shot joins the flight (opening: at its end; closing: at its start). 'enchaine': one continuous camera move
 * (the shot's style); 'coupe': the wide view held over the whole shot, cut to (or from) the flight at the boundary;
 * 'fondu-noir' / 'fondu-blanc': the same cut, at the darkest (lightest) point of a dip of the image (`transitionDipAt`).
 */
export type ShotTransition = (typeof SHOT_TRANSITIONS)[number]
export const SHOT_TRANSITION_LABELS: Record<ShotTransition, string> = {
  enchaine: 'Enchaîné',
  coupe: 'Coupe',
  'fondu-noir': 'Fondu au noir',
  'fondu-blanc': 'Fondu au blanc',
}

export interface FilmShot {
  style: ShotStyle
  /** seconds at ×1 (unused with 'aucune') */
  durationS: number
  /** default 'enchaine' (films saved before the transitions keep their continuous move) */
  transition?: ShotTransition
  /** length of a dip, centred on the cut (seconds at ×1; default `DIP_DEFAULT_S`) */
  dipS?: number
  /** 'situation': how high the shot starts (default 'region') */
  startHeight?: StartHeight
  /** 'situation': highlight the administrative region of the outing (OpenStreetMap) and frame it; default off */
  highlight?: boolean
  /**
   * 'situation' with `highlight`: the place highlighted (« Lieu »), an OSM area containing the track ("relation/123",
   * "way/45"); absent = the automatic administrative region. One place per film: `setFilmPlace` writes both shots.
   */
  regionId?: string
  /**
   * 'situation': seconds the region view is held (« Maintien »: at the start of the opening, at the end of the
   * closing) within `durationS`; the rest is the move (« Plongée »). Default 0: one move over the whole shot.
   */
  holdS?: number
}

export const START_HEIGHTS = ['region', 'pays'] as const
/** Height of the region view of a 'situation' shot (flyover/filmCamera.ts `regionDistanceM`). */
export type StartHeight = (typeof START_HEIGHTS)[number]
export const START_HEIGHT_LABELS: Record<StartHeight, string> = { region: 'Région', pays: 'Pays' }

/** The film opens or closes on a 'situation' shot that highlights the region (osm/region.ts is then asked for it). */
export function highlightsRegion(film: Pick<Film, 'opening' | 'closing'>): boolean {
  return [film.opening, film.closing].some((shot) => shot.style === 'situation' && shot.highlight === true)
}
/** Place chosen for the region highlight (`regionId` of the first shot that highlights it), null: automatic. */
export function filmRegionId(film: Pick<Film, 'opening' | 'closing'>): string | null {
  const shot = [film.opening, film.closing].find((s) => s.style === 'situation' && s.highlight === true)
  return shot?.regionId ?? null
}
/** Form of a stored place: an OSM relation or way. */
export const isRegionId = (v: unknown): v is string => typeof v === 'string' && /^(relation|way)\/\d+$/.test(v)
/** Duration given to a shot switched to 'situation' while it had its default duration (seconds): the dive is long. */
export const SITUATION_DURATION_S = 9
/** Hold on the region view of a 'situation' shot (seconds; also its validity range in a loaded project). */
export const SITUATION_HOLD_RANGE = { min: 0, max: 10, step: 0.5 } as const

/** Hold of a 'situation' shot and its move (seconds), within its duration: hold + move = `durationS`. */
export function situationTiming(shot: Pick<FilmShot, 'durationS' | 'holdS'>): { holdS: number; moveS: number } {
  const holdS = Math.min(Math.max(0, shot.holdS ?? 0), shot.durationS)
  return { holdS, moveS: shot.durationS - holdS }
}

/** Length of a dip to black or white (also its validity range in a loaded project), seconds. */
export const DIP_DURATION_RANGE = { min: 0.3, max: 2, step: 0.1 } as const
export const DIP_DEFAULT_S = 1

export const STOP_CAMERAS = ['film', 'orbite', 'large', 'fixe'] as const
/**
 * Camera during a stop. 'film': the flight camera goes on (the marker holds, so does the camera, but the orbit and
 * cinema styles keep moving); 'orbite': the camera turns around the stop and comes back; 'large': it pulls back and
 * up and comes back; 'fixe': the framing holds, the motion of the orbit and cinema styles too.
 */
export type StopCamera = (typeof STOP_CAMERAS)[number]
export const STOP_CAMERA_LABELS: Record<StopCamera, string> = { film: 'Comme le film', orbite: 'Tour lent', large: 'Vue large', fixe: 'Fixe' }

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
  /** its own text colour '#rrggbb' and font; absent = those of the overlay */
  color?: string
  font?: OverlayFontId
  /** stop the text is attached to (`attachToStop`): it follows the stop when it moves, free again once it is gone */
  stopId?: string
}

export const AUTO_STOP_MODES = ['temps-forts', 'rythme'] as const
/**
 * How the automatic stops are made. 'temps-forts' (new projects): one at every highlight whatever the pacing,
 * `AUTO_STOP_S` each, camera orbiting (highlights are climb tops, passes and summits); 'rythme' (projects saved
 * before the timeline): the pauses of the pacing, only while it is on, `pauseS` each, camera as in the film.
 */
export type AutoStopMode = (typeof AUTO_STOP_MODES)[number]

/** 'image': a photo; 'video': a video clip (with its sound unless muted, see `clipHasSound`). */
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
  /** video: its sound left out (true for clips saved before the sound was handled: their films stay as they were) */
  muted?: boolean
  /** video: volume of its sound, 0 (silent) to 1 (as recorded, the default) */
  volume?: number
  /** video synced with the recorded track (« Caler sur le parcours »), see `MediaSync` */
  sync?: MediaSync
  /** stop the medium is attached to, like a text's (an attached photo is shown during the hold of the stop) */
  stopId?: string
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

/**
 * A framing of the flight camera at a place of the first track: distance, pitch and heading offset, same meaning
 * and ranges as the camera settings. The camera eases from one key to the next, and from the film's settings into
 * the first key and back to them after the last one (`keyedCamera`, flyover/filmCamera.ts).
 */
/** A point of interest placed by hand: a name at a place on the ground, shown as a label in the view and the film. */
export const POI_ICONS = ['epingle', 'refuge', 'bivouac', 'sommet', 'vue', 'photo', 'drapeau', 'eau', 'repas'] as const
export type PoiIcon = (typeof POI_ICONS)[number]
export const POI_ICON_LABELS: Record<PoiIcon, string> = {
  epingle: 'Épingle',
  refuge: 'Refuge',
  bivouac: 'Bivouac',
  sommet: 'Sommet',
  vue: 'Point de vue',
  photo: 'Photo',
  drapeau: 'Drapeau',
  eau: 'Eau',
  repas: 'Repas',
}

export interface FilmPoi {
  id: string
  lon: number
  lat: number
  name: string
  /** pictogram of its label; absent = 'epingle' */
  icon?: PoiIcon
}

export interface FilmCameraKey {
  id: string
  /** distance along the first track (metres, same scale as `buildTrackPath`) */
  atM: number
  distance: number
  pitchDeg: number
  headingOffsetDeg: number
}

/** Range of the speed factor (also its validity range in a loaded project). */
export const SPEED_FACTOR_RANGE = { min: 0.25, max: 4 } as const
/** Shortest speed portion made on the timeline (metres). */
export const MIN_SPEED_SPAN_M = 50

/** Sound of a video clip added on the timeline: heard, as recorded. */
export const VIDEO_SOUND_DEFAULTS: Pick<FilmMedia, 'muted' | 'volume'> = { muted: false, volume: 1 }

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
  /** sorted by position or not */
  cameraKeys: FilmCameraKey[]
  texts: FilmText[]
  media: FilmMedia[]
  /** music of the soundtrack (they may overlap: mixed) */
  audio: FilmAudio[]
  /** the music is lowered while a video clip with sound plays (« Baisser la musique sous les vidéos ») */
  duckMusic: boolean
  /** points of interest placed by hand (labels only: they change neither the flight nor its time) */
  pois: FilmPoi[]
  /**
   * slow-downs and titles made at the landmarks as they load (« Ralentir et titrer aux repères », `withLandmarkTitles`
   * in `assemble.ts`); off for the films saved before it, cleared by retouching one of those items
   */
  landmarkTitles: boolean
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
  cameraKeys: [],
  texts: [],
  media: [],
  audio: [],
  duckMusic: false,
  pois: [],
  landmarkTitles: true,
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

/**
 * The clip is heard in the film: a video not muted, at a volume above 0, not following the flight (its time in the
 * file then runs at the pace of the marker: resampled, its sound would be ugly, so it stays silent, in the preview
 * as in the export). A clip without `muted` was saved before the sound was handled: silent.
 */
export function clipHasSound(media: Pick<FilmMedia, 'kind' | 'muted' | 'volume' | 'sync'>): boolean {
  return media.kind === 'video' && media.muted === false && (media.volume ?? 1) > 0 && !media.sync?.follow
}

/** Film time taken by an opening or closing shot. */
export function shotDurationS(shot: FilmShot): number {
  return shot.style === 'aucune' ? 0 : shot.durationS
}

/** The shot cuts to or from the flight ('coupe' and the dips) instead of moving into it. */
export function shotCuts(shot: FilmShot): boolean {
  return (shot.transition ?? 'enchaine') !== 'enchaine'
}

/** Colour of the dip of a shot, null without one (no dip transition, or no shot). */
export function shotDipColor(shot: FilmShot): 'black' | 'white' | null {
  if (shotDurationS(shot) === 0) return null
  return shot.transition === 'fondu-noir' ? 'black' : shot.transition === 'fondu-blanc' ? 'white' : null
}

/** Full-frame colour layer over the image at a film time. */
export interface TransitionDip {
  color: 'black' | 'white'
  /** 0 (clear) to 1 (the whole frame of that colour) */
  alpha: number
}

/** Opacity of a dip `lengthS` long centred on `cutS`, at `timeS`: 0 outside, up to 1 at the cut by smootherstep, symmetric. */
export function dipAlpha(timeS: number, cutS: number, lengthS: number): number {
  if (!(lengthS > 0)) return 0
  return smootherstep(1 - Math.abs(timeS - cutS) / (lengthS / 2))
}

/**
 * Dip of the image at film time `time.timeS`, null when none: the opening's centred on the start of the flight
 * (`openingS`), the closing's on its end; the stronger one where they meet (a very short flight). A pure function of
 * the film time, drawn by the overlay in the preview and the export alike.
 */
export function transitionDipAt(
  film: Pick<Film, 'opening' | 'closing'>,
  time: { timeS: number; openingS: number; flightS: number },
): TransitionDip | null {
  let dip: TransitionDip | null = null
  const cuts: [FilmShot, number][] = [
    [film.opening, time.openingS],
    [film.closing, time.openingS + time.flightS],
  ]
  for (const [shot, cutS] of cuts) {
    const color = shotDipColor(shot)
    const alpha = color ? dipAlpha(time.timeS, cutS, shot.dipS ?? DIP_DEFAULT_S) : 0
    if (color && alpha > (dip?.alpha ?? 0)) dip = { color, alpha }
  }
  return dip
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

export type FilmItemKind = 'stop' | 'speed' | 'camera' | 'text' | 'media' | 'music' | 'poi'

/** Next free id `<kind>-<n>` of the film (one more than the highest number used by that kind). */
export function nextFilmId(film: Film, kind: FilmItemKind): string {
  const lanes = {
    stop: film.stops,
    speed: film.speeds,
    camera: film.cameraKeys,
    text: film.texts,
    media: film.media,
    music: film.audio,
    poi: film.pois,
  }
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
const optionalString = (v: unknown) => v === undefined || typeof v === 'string'
const isId = (v: unknown) => typeof v === 'string' && v !== ''
const optionalId = (v: unknown) => v === undefined || isId(v)

export function isValidShot(shot: unknown): shot is FilmShot {
  return (
    isRecord(shot) &&
    oneOf(SHOT_STYLES, shot.style) &&
    within(shot.durationS, SHOT_DURATION_RANGE.min, SHOT_DURATION_RANGE.max) &&
    (shot.transition === undefined || oneOf(SHOT_TRANSITIONS, shot.transition)) &&
    (shot.dipS === undefined || within(shot.dipS, DIP_DURATION_RANGE.min, DIP_DURATION_RANGE.max)) &&
    (shot.startHeight === undefined || oneOf(START_HEIGHTS, shot.startHeight)) &&
    (shot.highlight === undefined || typeof shot.highlight === 'boolean') &&
    (shot.regionId === undefined || isRegionId(shot.regionId)) &&
    (shot.holdS === undefined || within(shot.holdS, SITUATION_HOLD_RANGE.min, SITUATION_HOLD_RANGE.max))
  )
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

export function isValidPoi(poi: unknown): poi is FilmPoi {
  return (
    isRecord(poi) &&
    isId(poi.id) &&
    within(poi.lon, -180, 180) &&
    within(poi.lat, -90, 90) &&
    typeof poi.name === 'string' &&
    (poi.icon === undefined || oneOf(POI_ICONS, poi.icon))
  )
}

export function isValidCameraKey(key: unknown): key is FilmCameraKey {
  if (!isRecord(key)) return false
  const { distance, pitchDeg, headingOffsetDeg } = CAMERA_RANGES
  return (
    isId(key.id) &&
    within(key.atM, 0, Number.MAX_VALUE) &&
    within(key.distance, distance.min, distance.max) &&
    within(key.pitchDeg, pitchDeg.min, pitchDeg.max) &&
    within(key.headingOffsetDeg, headingOffsetDeg.min, headingOffsetDeg.max)
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
    within(text.size, WIDGET_SIZE_MIN, WIDGET_SIZE_MAX) &&
    (text.color === undefined || isHexColor(text.color)) &&
    (text.font === undefined || oneOf(OVERLAY_FONT_IDS, text.font)) &&
    optionalId(text.stopId)
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
    (media.volume === undefined || within(media.volume, 0, 1)) &&
    (media.sync === undefined || isValidSync(media.sync)) &&
    optionalId(media.stopId)
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
  if (typeof film.duckMusic !== 'boolean' || typeof film.landmarkTitles !== 'boolean') return false
  if (!oneOf(AUTO_STOP_MODES, film.autoMode)) return false
  if (!film.stops.every(isValidStop) || !film.texts.every(isValidText) || !film.media.every(isValidMedia)) return false
  if (!film.speeds.every(isValidSpeed) || !apart(film.speeds) || !film.audio.every(isValidAudio)) return false
  if (!film.cameraKeys.every(isValidCameraKey) || !film.pois.every(isValidPoi)) return false
  const ids = [...film.stops, ...film.speeds, ...film.cameraKeys, ...film.texts, ...film.media, ...film.audio, ...film.pois].map((item) => item.id)
  return new Set(ids).size === ids.length
}

/**
 * Fill-in of a film saved before a field existed (`SETTING_UPGRADES`): missing fields from `DEFAULT_FILM`, except
 * `autoMode`, which keeps the automatic stops of those films following the pacing ('rythme') as they did; media
 * saved before their placement get `MEDIA_DEFAULTS`; a film saved before the music gets no music (`audio: []`), one
 * saved before the camera keys none (`cameraKeys: []`), one saved before the points of interest none (`pois: []`),
 * one saved before the landmark titles none (`landmarkTitles: false`: its flight stays as it was);
 * video clips saved before their sound was handled stay silent (`muted: true`). The `epochs` key of earlier versions
 * is dropped. A text or a medium attached to a stop the film does not own (generated stops, unknown id) is loaded free.
 */
export function withFilmDefaults(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const { epochs: _dropped, ...saved } = raw
  const film: Record<string, unknown> = { ...DEFAULT_FILM, autoMode: 'rythme', landmarkTitles: false, ...saved }
  const own = film.autoStops === false && Array.isArray(film.stops) ? film.stops.filter(isRecord).map((s) => s.id) : []
  const attached = (item: unknown) => {
    if (!isRecord(item) || !('stopId' in item) || own.includes(item.stopId)) return item
    const { stopId: _, ...free } = item
    return free
  }
  if (Array.isArray(film.texts)) film.texts = film.texts.map(attached)
  if (Array.isArray(film.media)) film.media = film.media.map((m: unknown) => attached(withMediaDefaults(m)))
  return film
}

function withMediaDefaults(media: unknown): unknown {
  if (!isRecord(media)) return media
  const silent = media.kind === 'video' && media.muted === undefined ? { muted: true } : {}
  return { ...MEDIA_DEFAULTS, ...media, ...silent }
}

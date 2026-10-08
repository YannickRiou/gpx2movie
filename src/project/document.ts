/**
 * Project document: one self-contained, versioned JSON file holding every setting, the tracks and the pictures
 * of the film (media table, `film/media.ts`).
 * Pure functions (no store, no DOM): `serializeProject` / `parseProject`, settings sanitising and
 * the version migration chain. Applying a parsed project to the store lives in `apply.ts`.
 *
 * Settings are handled generically over the keys of `DEFAULT_SETTINGS`: a new setting is saved,
 * validated (against the type of its default) and restored without touching this file. Add an entry
 * to `SETTING_CHECKS` only when a value of the right type can still be invalid (enum, catalogue id, range).
 */
import type { Track, TrackPoint, TrackSegment, Waypoint } from '../core/types'
import { sanitizeMediaTable, usedMedia } from '../film/media'
import type { MediaTable } from '../film/media'
import { isValidFilm, withFilmDefaults } from '../film/model'
import { FLYOVER_DURATION_RANGE, isValidCamera } from '../flyover/cameraSettings'
import { isValidPacing } from '../flyover/pacing'
import { isValidRace } from '../flyover/race'
import { TRACK_COLORS } from '../import'
import { buildTrack, isUtcOffsetMin } from '../import/stats'
import { isValidVideoSettings, withVideoDefaults } from '../export/schedule'
import { LANDMARK_DISTANCE_RANGE } from '../osm/landmarks'
import { isValidOverlay, withOverlayDefaults } from '../overlay/settings'
import { TRACK_COLOR_MODES } from '../flyover/trackColor'
import { DEFAULT_PLAYBACK, DEFAULT_SETTINGS } from '../state/store'
import type { AppState, Settings } from '../state/store'
import { IMAGERY_SOURCES, TERRAIN_SOURCES } from '../terrain/sources'

export const PROJECT_FORMAT = 'openflyover-project'
export const PROJECT_VERSION = 2
/** Suffix of saved project files (`<name>.openflyover.json`). */
export const PROJECT_FILE_SUFFIX = '.openflyover.json'
export const DEFAULT_PROJECT_NAME = 'Sans titre'

/** Optional per-point values, stored as columns (null where a point has no value). */
const OPTIONAL_FIELDS = ['ele', 'time', 'hr', 'cad', 'power', 'temp'] as const
type OptionalField = (typeof OPTIONAL_FIELDS)[number]

/** Decimal places kept per column: 1e-7° ≈ 1 cm, centimetres for elevations, whole milliseconds. */
const DECIMALS: Record<'lon' | 'lat' | OptionalField, number> = {
  lon: 7,
  lat: 7,
  ele: 2,
  time: 0,
  hr: 2,
  cad: 2,
  power: 2,
  temp: 2,
}

/** One track segment, column-oriented (`lon[i]`, `lat[i]`, `ele[i]`… describe point i). */
export type ProjectSegment = { lon: number[]; lat: number[] } & Partial<Record<OptionalField, (number | null)[]>>

/** A track as stored in the file: stats and bounds are recomputed on load. */
export interface ProjectTrack {
  id: string
  name: string
  source: Track['source']
  activityType?: string
  color: string
  segments: ProjectSegment[]
  /** GPX waypoints (`Track.waypoints`), omitted when the track has none */
  waypoints?: Waypoint[]
  /** `Track.utcOffsetMin`, omitted when unknown */
  utcOffsetMin?: number
}

export interface ProjectDocument {
  format: typeof PROJECT_FORMAT
  version: typeof PROJECT_VERSION
  name: string
  settings: Settings
  playback: { speed: number }
  tracks: ProjectTrack[]
  /** pictures of the film by id (`film.media[].src`), omitted when the film has none */
  media?: MediaTable
}

/** A parsed and validated project, ready to be applied to the store. */
export interface LoadedProject {
  name: string
  settings: Settings
  speed: number
  tracks: Track[]
  /** pictures of the film (empty for projects without photos) */
  media: MediaTable
  /** non-fatal problems (settings replaced by their default value), in French */
  warnings: string[]
}

export type ProjectSource = Pick<AppState, 'tracks' | 'settings' | 'playback'>

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Extra checks for settings whose type alone does not make them valid. */
export const SETTING_CHECKS: { [K in keyof Settings]?: (value: Settings[K]) => boolean } = {
  terrainSourceId: (id) => TERRAIN_SOURCES.some((s) => s.id === id),
  imagerySourceId: (id) => IMAGERY_SOURCES.some((s) => s.id === id),
  imageryZoomOffset: (v) => v === 0 || v === 1 || v === 2,
  exaggeration: (v) => v > 0,
  sunHour: (v) => v >= 0 && v <= 24,
  camera: isValidCamera,
  flyoverDurationS: (v) => v >= FLYOVER_DURATION_RANGE.min && v <= FLYOVER_DURATION_RANGE.max,
  pacing: isValidPacing,
  film: isValidFilm,
  exposureEv: (v) => v >= -4 && v <= 4,
  weatherScene: (v) => v.strength >= 0 && v.strength <= 1,
  trackColorBy: (v) => (TRACK_COLOR_MODES as readonly string[]).includes(v),
  overlay: isValidOverlay,
  video: isValidVideoSettings,
  landmarks: (v) => v.maxDistanceM >= LANDMARK_DISTANCE_RANGE.min && v.maxDistanceM <= LANDMARK_DISTANCE_RANGE.max,
  race: isValidRace,
}

/**
 * Fill-ins for settings whose shape grew after projects were saved, applied to the raw value before it is
 * validated (e.g. overlay widgets added since: older projects and presets keep loading).
 */
export const SETTING_UPGRADES: { [K in keyof Settings]?: (raw: unknown) => unknown } = {
  overlay: withOverlayDefaults,
  video: withVideoDefaults,
  film: withFilmDefaults,
}

/** True when `value` has the JSON shape of `reference` (finite numbers, same keys for objects). */
function sameShape(value: unknown, reference: unknown): boolean {
  if (typeof reference === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (reference === null || typeof reference !== 'object') return typeof value === typeof reference
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(reference)) {
    return Array.isArray(value) && (reference.length === 0 || value.every((v) => sameShape(v, reference[0])))
  }
  if (Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return Object.entries(reference).every(([k, ref]) => sameShape(record[k], ref))
}

export function isValidSetting<K extends keyof Settings>(key: K, value: unknown): value is Settings[K] {
  if (!sameShape(value, DEFAULT_SETTINGS[key])) return false
  const check = SETTING_CHECKS[key] as ((v: Settings[K]) => boolean) | undefined
  return check ? check(value as Settings[K]) : true
}

/**
 * Every key of `DEFAULT_SETTINGS` taken from `raw` when valid, else from `base`.
 * Unknown keys are ignored; `invalid` lists the keys present in `raw` but rejected.
 */
export function sanitizeSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): { settings: Settings; invalid: string[] } {
  const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const settings = { ...base }
  const invalid: string[] = []
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (!(key in record)) continue
    const upgrade = SETTING_UPGRADES[key]
    const value = upgrade ? upgrade(record[key]) : record[key]
    if (isValidSetting(key, value)) (settings as Record<string, unknown>)[key] = value
    else invalid.push(key)
  }
  return { settings, invalid }
}

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

function round(value: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

function encodeSegment(segment: TrackSegment): ProjectSegment {
  const points = segment.points
  const out: ProjectSegment = {
    lon: points.map((p) => round(p.lon, DECIMALS.lon)),
    lat: points.map((p) => round(p.lat, DECIMALS.lat)),
  }
  for (const field of OPTIONAL_FIELDS) {
    if (!points.some((p) => p[field] !== undefined)) continue
    out[field] = points.map((p) => {
      const v = p[field]
      return v === undefined || !Number.isFinite(v) ? null : round(v, DECIMALS[field])
    })
  }
  return out
}

function encodeWaypoint(w: Waypoint): Waypoint {
  const out: Waypoint = { lon: round(w.lon, DECIMALS.lon), lat: round(w.lat, DECIMALS.lat), name: w.name }
  if (w.ele !== undefined && Number.isFinite(w.ele)) out.ele = round(w.ele, DECIMALS.ele)
  return out
}

export function toProjectDocument(state: ProjectSource, name: string, media: MediaTable = {}): ProjectDocument {
  const pictures = usedMedia(state.settings.film, media)
  const doc: ProjectDocument = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: name.trim() || DEFAULT_PROJECT_NAME,
    settings: { ...state.settings },
    playback: { speed: state.playback.speed },
    tracks: state.tracks.map((track) => {
      const out: ProjectTrack = { id: track.id, name: track.name, source: track.source, color: track.color, segments: [] }
      if (track.activityType) out.activityType = track.activityType
      out.segments = track.segments.map(encodeSegment)
      if (track.waypoints?.length) out.waypoints = track.waypoints.map(encodeWaypoint)
      if (track.utcOffsetMin !== undefined) out.utcOffsetMin = track.utcOffsetMin
      return out
    }),
  }
  if (Object.keys(pictures).length > 0) doc.media = pictures
  return doc
}

/** JSON text of the project: header and settings indented, one line per track, then one line per picture. */
export function serializeProject(state: ProjectSource, name: string, media: MediaTable = {}): string {
  const { tracks, media: pictures, ...head } = toProjectDocument(state, name, media)
  const headJson = JSON.stringify(head, null, 2)
  const tracksJson = tracks.length === 0 ? '[]' : `[\n${tracks.map((t) => `    ${JSON.stringify(t)}`).join(',\n')}\n  ]`
  const entries = Object.entries(pictures ?? {})
  const mediaJson =
    entries.length === 0 ? '' : `,\n  "media": {\n${entries.map(([id, a]) => `    ${JSON.stringify(id)}: ${JSON.stringify(a)}`).join(',\n')}\n  }`
  // headJson ends with "\n}"
  return `${headJson.slice(0, -2)},\n  "tracks": ${tracksJson}${mediaJson}\n}\n`
}

/** File name for a project: characters forbidden by common file systems replaced by "-". */
export function projectFileName(name: string): string {
  const safe = name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim()
    .replace(/^\.+/, '')
  return `${safe || 'projet'}${PROJECT_FILE_SUFFIX}`
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

export type ProjectMigration = (doc: Record<string, unknown>) => Record<string, unknown>

/** `MIGRATIONS[n]` upgrades a document from version n to n + 1. */
export const MIGRATIONS: Readonly<Record<number, ProjectMigration>> = {
  // v2: the film's automatic stops no longer need the pacing; a v1 project without a film keeps the stops of its
  // pacing (`withFilmDefaults` completes the film from the defaults)
  1: (doc) => (isRecord(doc.settings) && !('film' in doc.settings) ? { ...doc, settings: { ...doc.settings, film: { autoMode: 'rythme' } } } : doc),
}

/** Run the migrations from `doc.version` up to `target`; the returned document has `version: target`. */
export function migrateProject(
  doc: Record<string, unknown>,
  migrations: Readonly<Record<number, ProjectMigration>> = MIGRATIONS,
  target: number = PROJECT_VERSION,
): Record<string, unknown> {
  const version = doc.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('Projet invalide : numéro de version (« version ») absent ou incorrect.')
  }
  if (version > target) {
    throw new Error(
      `Ce projet utilise le format v${version}, plus récent que celui de cette version d'OpenFlyover (v${target}). ` +
        "Mettez l'application à jour pour l'ouvrir.",
    )
  }
  let current = doc
  for (let v = version; v < target; v++) {
    const migrate = migrations[v]
    if (!migrate) throw new Error(`Impossible de convertir ce projet du format v${v} vers v${v + 1}.`)
    current = { ...migrate(current), version: v + 1 }
  }
  return current
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function decodeSegment(raw: unknown, where: string): TrackSegment {
  if (!isRecord(raw)) throw new Error(`${where} : segment invalide.`)
  const { lon, lat } = raw
  if (!Array.isArray(lon) || !Array.isArray(lat) || lon.length !== lat.length) {
    throw new Error(`${where} : colonnes « lon » et « lat » absentes ou de longueurs différentes.`)
  }
  const points: TrackPoint[] = []
  for (let i = 0; i < lon.length; i++) {
    const x = lon[i]
    const y = lat[i]
    if (typeof x !== 'number' || typeof y !== 'number' || !(Math.abs(x) <= 180) || !(Math.abs(y) <= 90)) {
      throw new Error(`${where} : coordonnées invalides au point ${i + 1}.`)
    }
    points.push({ lon: x, lat: y })
  }
  for (const field of OPTIONAL_FIELDS) {
    const column = raw[field]
    if (column === undefined) continue
    if (!Array.isArray(column) || column.length !== points.length) {
      throw new Error(`${where} : colonne « ${field} » invalide (${points.length} valeurs attendues).`)
    }
    column.forEach((v: unknown, i) => {
      if (v === null) return
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(`${where} : valeur « ${field} » invalide au point ${i + 1}.`)
      }
      points[i][field] = v
    })
  }
  return { points }
}

function decodeWaypoint(raw: unknown, where: string): Waypoint {
  if (!isRecord(raw)) throw new Error(`${where} : description invalide.`)
  const { lon, lat, ele, name } = raw
  if (typeof lon !== 'number' || typeof lat !== 'number' || !(Math.abs(lon) <= 180) || !(Math.abs(lat) <= 90)) {
    throw new Error(`${where} : coordonnées invalides.`)
  }
  const waypoint: Waypoint = { lon, lat, name: typeof name === 'string' ? name : '' }
  if (typeof ele === 'number' && Number.isFinite(ele)) waypoint.ele = ele
  return waypoint
}

function decodeTrack(raw: unknown, index: number): Track {
  const label = `Trace n°${index + 1}`
  if (!isRecord(raw)) throw new Error(`${label} : description invalide.`)
  if (typeof raw.id !== 'string' || raw.id === '') throw new Error(`${label} : identifiant (« id ») manquant.`)
  if (raw.source !== 'gpx' && raw.source !== 'fit') throw new Error(`${label} : origine (« source ») inconnue.`)
  if (!Array.isArray(raw.segments)) throw new Error(`${label} : segments manquants.`)
  const segments = raw.segments.map((s, i) => decodeSegment(s, `${label}, segment ${i + 1}`))
  if (!segments.some((s) => s.points.length > 0)) throw new Error(`${label} : aucun point.`)

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : label
  const activityType = typeof raw.activityType === 'string' ? raw.activityType : undefined
  const track = buildTrack({ name, source: raw.source, segments, activityType })
  if (raw.waypoints !== undefined) {
    if (!Array.isArray(raw.waypoints)) throw new Error(`${label} : liste des points (« waypoints ») invalide.`)
    if (raw.waypoints.length > 0) track.waypoints = raw.waypoints.map((w, i) => decodeWaypoint(w, `${label}, point ${i + 1}`))
  }
  if (isUtcOffsetMin(raw.utcOffsetMin)) track.utcOffsetMin = raw.utcOffsetMin
  track.id = raw.id
  track.color =
    typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : TRACK_COLORS[index % TRACK_COLORS.length]
  return track
}

/** Parse and validate a project file. Throws an Error with a French message when it cannot be opened. */
export function parseProject(text: string): LoadedProject {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error("Fichier de projet illisible : ce n'est pas du JSON valide.")
  }
  if (!isRecord(raw) || raw.format !== PROJECT_FORMAT) {
    throw new Error("Ce fichier n'est pas un projet OpenFlyover (champ « format » absent ou inconnu).")
  }
  const doc = migrateProject(raw)

  if (!Array.isArray(doc.tracks)) throw new Error('Projet invalide : liste des traces (« tracks ») manquante.')
  const tracks = doc.tracks.map(decodeTrack)
  const ids = new Set<string>()
  for (const track of tracks) {
    if (ids.has(track.id)) throw new Error(`Projet invalide : deux traces portent l'identifiant « ${track.id} ».`)
    ids.add(track.id)
  }

  const warnings: string[] = []
  const { settings, invalid } = sanitizeSettings(doc.settings)
  if (invalid.length > 0) {
    warnings.push(`Réglages invalides remplacés par leur valeur par défaut : ${invalid.join(', ')}.`)
  }
  // photos whose picture is missing or unreadable are left out of the film
  const media = sanitizeMediaTable(doc.media)
  const kept = settings.film.media.filter((m) => m.kind !== 'image' || media[m.src])
  const removed = settings.film.media.length - kept.length
  if (removed > 0) {
    warnings.push(`${removed} photo${removed > 1 ? 's' : ''} sans image lisible dans le projet, retirée${removed > 1 ? 's' : ''} du film.`)
    settings.film = { ...settings.film, media: kept }
  }
  const rawSpeed = isRecord(doc.playback) ? doc.playback.speed : undefined
  const speedValid = typeof rawSpeed === 'number' && Number.isFinite(rawSpeed) && rawSpeed > 0
  if (rawSpeed !== undefined && !speedValid) warnings.push('Vitesse de lecture invalide : vitesse ×1 utilisée.')

  return {
    name: typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : DEFAULT_PROJECT_NAME,
    settings,
    speed: speedValid ? rawSpeed : DEFAULT_PLAYBACK.speed,
    tracks,
    media,
    warnings,
  }
}

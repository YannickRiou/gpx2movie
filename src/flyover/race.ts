/**
 * Ghost race (« course fantôme »): several tracks replayed together during the flyover of the first one.
 *
 * The playback progress p stays the distance fraction of the lead track (tracks[0], followed by the camera);
 * this module places every other track for that p, as a pure function of p (each exported frame stays
 * independent). Sync modes:
 *
 * - `elapsed`: same elapsed recorded time since each track's own start (successive outings, or friends who
 *   did not start together). The lead's time at p is its first arrival at distance p · L.
 * - `clock`: same absolute recorded time (group outing on the same day). Before its start a track waits at
 *   its start, after its end it stays at its end.
 * - `distance`: same distance fraction of each own track (works without timestamps).
 *
 * The time modes need timestamps on every track, otherwise the race falls back to `distance` for all.
 *
 * Time ↔ distance: each track gets a time per point, points without time bridged by distance between their
 * timed neighbours, then made non-decreasing (running maximum against GPS clock glitches). Time → position
 * interpolates linearly in time between two consecutive points: the marker holds still during a stop
 * (time passes, distance does not) and glides across a gap between two segments. Distance → time is the
 * first arrival (start of a stop). Both are binary searches: O(log n) per track and per frame.
 *
 * Gaps (leaderboard): « the same point » is the same fraction of each own track — exact only when the tracks
 * follow the same route, an approximation otherwise (two recordings of one route differ by a few %).
 * - time modes: difference between the race times at which the racer and the lead reached the furthest point
 *   both have reached, the one still behind counting the current time (classic live gap: « the lead went
 *   through here 1 min 20 ago »). Positive = behind the lead.
 * - `distance` with timestamps: difference of the elapsed times needed to reach the current fraction.
 * - `distance` without timestamps: difference of the distances covered (metres, negative = behind).
 *
 * Pure functions (no DOM, no React, no Three, no store).
 */
import { oneOf } from '../core/guards'
import { firstIndexAtOrAbove, lastIndexAtOrBelow } from '../core/math'
import type { Track } from '../core/types'
import { samplePath, type TrackPath } from './path'
import { smoothedTrackPath } from './smooth'

export const RACE_SYNC_MODES = ['elapsed', 'clock', 'distance'] as const
export type RaceSync = (typeof RACE_SYNC_MODES)[number]

/**
 * What the flight camera follows during a ghost race (`flyover/follow.ts`): the lead track (the first one, as before),
 * the racer ahead, or all the racers framed together.
 */
export const RACE_CAMERAS = ['premiere', 'tete', 'ensemble'] as const
export type RaceCamera = (typeof RACE_CAMERAS)[number]

/** Transition between two stages « À la suite »: a plain cut, or the cut at the darkest (lightest) point of a dip. */
export const STAGE_TRANSITIONS = ['coupe', 'fondu-noir', 'fondu-blanc'] as const
export type StageTransition = (typeof STAGE_TRANSITIONS)[number]

/**
 * « Plusieurs traces »: by default the first track is flown and the others are only drawn; « En parallèle » replays
 * them all together (`enabled`, the ghost race); « À la suite » flies them one after the other (`sequence`,
 * flyover/sequence.ts). The optional fields are absent from projects saved before them: their film is unchanged.
 */
export interface RaceSettings {
  /** « En parallèle »: show a moving marker on every other track during the flyover */
  enabled: boolean
  /** how the other tracks are synchronised with the lead */
  sync: RaceSync
  /** ghost race: what the camera follows (absent = 'premiere') */
  camera?: RaceCamera
  /** « À la suite »: the tracks flown one after the other in list order (ignored while `enabled`) */
  sequence?: boolean
  /** « À la suite »: a card with the name and figures of each stage as it starts (absent = true) */
  stageCards?: boolean
  /** « À la suite »: how one stage cuts to the next (absent = 'fondu-noir') */
  stageTransition?: StageTransition
}

export const DEFAULT_RACE: RaceSettings = { enabled: false, sync: 'elapsed' }

export const RACE_CAMERA_LABELS: Record<RaceCamera, string> = {
  premiere: 'Première trace',
  tete: 'Celle en tête',
  ensemble: 'Toutes les traces',
}

export const STAGE_TRANSITION_LABELS: Record<StageTransition, string> = {
  coupe: 'Coupe',
  'fondu-noir': 'Fondu au noir',
  'fondu-blanc': 'Fondu au blanc',
}

export const RACE_SYNC_LABELS: Record<RaceSync, string> = {
  elapsed: 'Temps écoulé',
  clock: 'Heure réelle',
  distance: 'Même distance',
}

/** Modes that need timestamps on every track. */
export function syncNeedsTime(sync: RaceSync): boolean {
  return sync !== 'distance'
}

export function isValidRace(race: RaceSettings): boolean {
  return (
    (RACE_SYNC_MODES as readonly string[]).includes(race.sync) &&
    (race.camera === undefined || oneOf(RACE_CAMERAS, race.camera)) &&
    (race.sequence === undefined || typeof race.sequence === 'boolean') &&
    (race.stageCards === undefined || typeof race.stageCards === 'boolean') &&
    (race.stageTransition === undefined || oneOf(STAGE_TRANSITIONS, race.stageTransition))
  )
}

/** Fractions closer than this are the same point (racers side by side). */
const SAME_FRACTION = 1e-9

// ---------------------------------------------------------------------------
// Per-track tables
// ---------------------------------------------------------------------------

export interface RaceTrack {
  path: TrackPath
  /** time of every point (ms since epoch), bridged and non-decreasing; null without usable timestamps */
  times: Float64Array | null
  /** first and last time (ms), NaN when untimed */
  startMs: number
  endMs: number
}

/**
 * Time per point: own time when recorded, else interpolated by distance between the nearest timed points
 * (the only side's time at the ends), then running maximum. Null when fewer than two distinct times.
 */
export function prepareRaceTrack(path: TrackPath): RaceTrack {
  const { count, time, dist } = path
  const untimed: RaceTrack = { path, times: null, startMs: Number.NaN, endMs: Number.NaN }
  const timed: number[] = []
  for (let i = 0; i < count; i++) if (!Number.isNaN(time[i])) timed.push(i)
  if (timed.length === 0) return untimed

  const times = new Float64Array(count)
  /** index in `timed` of the last timed point at or before i */
  let k = -1
  for (let i = 0; i < count; i++) {
    while (k + 1 < timed.length && timed[k + 1] <= i) k++
    const before = k >= 0 ? timed[k] : -1
    const after = k + 1 < timed.length ? timed[k + 1] : -1
    if (before === i) times[i] = time[i]
    else if (before < 0) times[i] = time[after]
    else if (after < 0) times[i] = time[before]
    else {
      const span = dist[after] - dist[before]
      times[i] = span > 0 ? time[before] + (time[after] - time[before]) * ((dist[i] - dist[before]) / span) : time[before]
    }
  }
  for (let i = 1; i < count; i++) if (times[i] < times[i - 1]) times[i] = times[i - 1]
  const startMs = times[0]
  const endMs = times[count - 1]
  return endMs > startMs ? { path, times, startMs, endMs } : untimed
}

const cache = new WeakMap<Track, { smoothingM: number; prepared: RaceTrack }>()

/**
 * `prepareRaceTrack(smoothedTrackPath(track, smoothingM))`: the racer follows its smoothed line
 * (`trackStyle.smoothingM`, recorded distances and times kept). Cached per track object for the last smoothing.
 */
export function raceTrackOf(track: Track, smoothingM: number): RaceTrack {
  const cached = cache.get(track)
  if (cached && cached.smoothingM === smoothingM) return cached.prepared
  const prepared = prepareRaceTrack(smoothedTrackPath(track, smoothingM))
  cache.set(track, { smoothingM, prepared })
  return prepared
}

/** Where a marker stands. */
export interface RacePosition {
  lon: number
  lat: number
  /** interpolated recorded elevation, undefined when unknown */
  ele?: number
  /** distance covered along the own track (metres) */
  distanceM: number
}

/** Linear interpolation between points a and b of the path. */
function between(path: TrackPath, a: number, b: number, t: number): RacePosition {
  const { lon, lat, ele, dist } = path
  const out: RacePosition = {
    lon: lon[a] + (lon[b] - lon[a]) * t,
    lat: lat[a] + (lat[b] - lat[a]) * t,
    distanceM: dist[a] + (dist[b] - dist[a]) * t,
  }
  if (!Number.isNaN(ele[a]) && !Number.isNaN(ele[b])) out.ele = ele[a] + (ele[b] - ele[a]) * t
  return out
}

/**
 * Position at recorded time `timeMs` (clamped to the recording: at the start before it, at the end after it).
 * Requires a timed track.
 */
export function positionAtTime(track: RaceTrack, timeMs: number): RacePosition {
  const { path, times } = track
  if (!times || path.count === 0) throw new RangeError('positionAtTime : trace sans horodatage')
  const t = Math.min(track.endMs, Math.max(track.startMs, timeMs))
  const lo = Math.max(0, lastIndexAtOrBelow(times, t))
  if (lo === path.count - 1) return between(path, lo, lo, 0)
  return between(path, lo, lo + 1, (t - times[lo]) / (times[lo + 1] - times[lo]))
}

/** Position at `distanceM` along the track (clamped), as `samplePath`. */
export function positionAtDistance(track: RaceTrack, distanceM: number): RacePosition {
  const { path } = track
  const d = Math.min(path.lengthM, Math.max(0, distanceM))
  const s = samplePath(path, d)
  const out: RacePosition = { lon: s.lon, lat: s.lat, distanceM: d }
  if (s.ele !== undefined) out.ele = s.ele
  return out
}

/** Recorded time (ms) of the first arrival at `distanceM` (clamped). Requires a timed track. */
export function arrivalTime(track: RaceTrack, distanceM: number): number {
  const { path, times } = track
  if (!times || path.count === 0) throw new RangeError('arrivalTime : trace sans horodatage')
  const { dist } = path
  const d = Math.min(path.lengthM, Math.max(0, distanceM))
  const lo = Math.min(path.count - 1, firstIndexAtOrAbove(dist, d))
  if (lo === 0) return times[0]
  const a = lo - 1
  return times[a] + (times[lo] - times[a]) * ((d - dist[a]) / (dist[lo] - dist[a]))
}

// ---------------------------------------------------------------------------
// Race
// ---------------------------------------------------------------------------

export interface Race {
  /** lead first; tracks without points are kept (their racer is omitted) so indices match the input */
  tracks: readonly RaceTrack[]
  /** sync mode actually used (`distance` when a time mode was asked for and a track lacks timestamps) */
  sync: RaceSync
  /** every track has usable timestamps */
  timed: boolean
}

export function buildRace(tracks: readonly RaceTrack[], sync: RaceSync): Race {
  const timed = tracks.length > 0 && tracks.every((t) => t.times !== null)
  return { tracks, sync: syncNeedsTime(sync) && !timed ? 'distance' : sync, timed }
}

export interface Racer extends RacePosition {
  /** index of the track in the race (0 = lead) */
  index: number
  /** distance covered / own track length (0..1) */
  fraction: number
  /** reached its end */
  finished: boolean
  /** time gap to the lead (ms, positive = behind); time modes and timed `distance` races, undefined for the lead */
  gapMs?: number
  /** distance gap to the lead (m, negative = behind); untimed `distance` races, undefined for the lead */
  gapM?: number
}

function fractionOf(track: RaceTrack, distanceM: number): number {
  return track.path.lengthM > 0 ? distanceM / track.path.lengthM : 1
}

/** Race time of the first arrival at `fraction`: absolute in `clock` mode, else elapsed since the own start. */
function raceTimeAt(track: RaceTrack, fraction: number, sync: RaceSync): number {
  const t = arrivalTime(track, fraction * track.path.lengthM)
  return sync === 'clock' ? t : t - track.startMs
}

/** Every racer (lead included, index 0) at lead progress `progress` (clamped to [0, 1]), in track order. */
export function raceAt(race: Race, progress: number): Racer[] {
  const { tracks, sync } = race
  const lead = tracks[0]
  if (!lead || lead.path.count === 0) return []
  const p = Math.min(1, Math.max(0, progress))
  const timeSync = syncNeedsTime(sync)
  /** current race time: the lead's first arrival at p */
  const now = timeSync ? raceTimeAt(lead, p, sync) : 0

  const racers: Racer[] = []
  tracks.forEach((track, index) => {
    if (track.path.count === 0) return
    let position: RacePosition
    if (index === 0) position = positionAtDistance(track, p * track.path.lengthM)
    else if (sync === 'elapsed') position = positionAtTime(track, track.startMs + now)
    else if (sync === 'clock') position = positionAtTime(track, now)
    else position = positionAtDistance(track, p * track.path.lengthM)
    const fraction = index === 0 ? p : fractionOf(track, position.distanceM)
    const racer: Racer = { ...position, index, fraction, finished: fraction >= 1 }
    if (index > 0) {
      if (timeSync) {
        if (fraction < p - SAME_FRACTION) racer.gapMs = now - raceTimeAt(lead, fraction, sync)
        else if (fraction > p + SAME_FRACTION) racer.gapMs = raceTimeAt(track, p, sync) - now
        // same point (both finished, both at the start…): difference of the arrivals there, a racer still
        // waiting at its start counting the current time
        else racer.gapMs = Math.min(raceTimeAt(track, p, sync), now) - Math.min(raceTimeAt(lead, p, sync), now)
      } else if (race.timed) {
        racer.gapMs = raceTimeAt(track, p, 'elapsed') - raceTimeAt(lead, p, 'elapsed')
      } else {
        const leadDistance = p * lead.path.lengthM
        racer.gapM = position.distanceM - leadDistance
      }
    }
    racers.push(racer)
  })
  return racers
}

/**
 * Leaderboard order: furthest fraction first, then (same point, e.g. all finished) smallest time gap or
 * largest distance gap, the lead counting 0, then track order.
 */
export function rankRacers(racers: readonly Racer[]): Racer[] {
  return [...racers].sort((a, b) => {
    if (Math.abs(a.fraction - b.fraction) > SAME_FRACTION) return b.fraction - a.fraction
    const byTime = (a.gapMs ?? 0) - (b.gapMs ?? 0)
    if (byTime !== 0) return byTime
    const byDistance = (b.gapM ?? 0) - (a.gapM ?? 0)
    if (byDistance !== 0) return byDistance
    return a.index - b.index
  })
}

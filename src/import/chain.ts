/**
 * « Enchaîner en un seul parcours »: several tracks (a trek recorded one file per day, an outing recorded in two files)
 * become one track flown as a single film. Each source track keeps its segments, so the jump from one recording to the
 * next is neither drawn nor counted (see `computeStats`, `buildTrackPath`). Pure functions.
 */
import type { Track } from '../core/types'
import { buildTrack } from './stats'

/** Longest pause between two recordings of one import for which the import offers to chain them (ms). */
export const CHAIN_OFFER_MAX_GAP_MS = 24 * 3600 * 1000

/** A common prefix shorter than this, or without a letter, does not name the chain. */
const MIN_PREFIX_LENGTH = 3
const SEPARATOR = /[\s\-_.,(]/
const TRAILING_SEPARATORS = /[\s\-_.,(]+$/

function isTimed(track: Track): boolean {
  return track.stats.startTime !== undefined && track.stats.endTime !== undefined
}

const startOf = (track: Track): number => track.stats.startTime ?? 0
const endOf = (track: Track): number => track.stats.endTime ?? 0

/** Order of the chain: by start time when every track is timed, else the list order. */
export function chainOrder(tracks: readonly Track[]): Track[] {
  if (!tracks.every(isTimed)) return [...tracks]
  return [...tracks].sort((a, b) => startOf(a) - startOf(b))
}

/** First two consecutive tracks of a time-ordered chain whose recordings overlap, else undefined. */
function firstOverlap(ordered: readonly Track[]): [Track, Track] | undefined {
  for (let i = 1; i < ordered.length; i++) {
    if (startOf(ordered[i]) < endOf(ordered[i - 1])) return [ordered[i - 1], ordered[i]]
  }
  return undefined
}

/** `text` up to its last separator (the unfinished last word removed). */
function dropLastWord(text: string): string {
  let end = text.length
  while (end > 0 && !SEPARATOR.test(text[end - 1])) end--
  return text.slice(0, end)
}

/** Longest start shared by every name, cut back to a whole word, without trailing separators. */
function commonWordPrefix(names: readonly string[]): string {
  let length = 0
  while (names.every((name) => length < name.length && name[length] === names[0][length])) length++
  const prefix = names[0].slice(0, length)
  const endsAWord = names.every((name) => length === name.length || SEPARATOR.test(name[length]))
  return (endsAWord ? prefix : dropLastWord(prefix)).replace(TRAILING_SEPARATORS, '')
}

/** « Tour du Mont-Blanc » for « Tour du Mont-Blanc J1 » … « Tour du Mont-Blanc J3 », else « first → last ». */
export function chainName(names: readonly string[]): string {
  const prefix = commonWordPrefix(names)
  if (prefix.length >= MIN_PREFIX_LENGTH && /\p{L}/u.test(prefix)) return prefix
  return `${names[0]} → ${names[names.length - 1]}`
}

/**
 * One track running through `tracks` in `chainOrder`: their segments one after the other, their waypoints, new id,
 * stats and bounds recomputed; colour, source, activity and clock offset of the first. Throws `Error` with a message
 * for the user below two tracks, or when two timed recordings overlap (a group outing: a ghost race, not a chain).
 */
export function chainTracks(tracks: readonly Track[]): Track {
  if (tracks.length < 2) throw new Error('Il faut au moins deux traces à enchaîner.')
  const ordered = chainOrder(tracks)
  const overlap = ordered.every(isTimed) ? firstOverlap(ordered) : undefined
  if (overlap) {
    throw new Error(
      `« ${overlap[0].name} » et « ${overlap[1].name} » ont été enregistrées en même temps : impossible de les enchaîner.`,
    )
  }
  const first = ordered[0]
  const track = buildTrack({
    name: chainName(ordered.map((t) => t.name)),
    source: first.source,
    segments: ordered.flatMap((t) => t.segments),
    activityType: first.activityType,
  })
  track.color = first.color
  const waypoints = ordered.flatMap((t) => t.waypoints ?? [])
  if (waypoints.length > 0) track.waypoints = waypoints
  if (first.utcOffsetMin !== undefined) track.utcOffsetMin = first.utcOffsetMin
  return track
}

/** `all` with the tracks of `chained` replaced by `merged`, at the place of the first of them. */
export function replaceByChain(all: readonly Track[], chained: readonly Track[], merged: Track): Track[] {
  const ids = new Set(chained.map((t) => t.id))
  const at = all.findIndex((t) => ids.has(t.id))
  const rest = all.filter((t) => !ids.has(t.id))
  rest.splice(at < 0 ? rest.length : at, 0, merged)
  return rest
}

/**
 * True when the tracks of one import follow each other in time: all timed, each starting after the previous one ends
 * and less than `CHAIN_OFFER_MAX_GAP_MS` later. The import then offers to chain them.
 */
export function followEachOther(tracks: readonly Track[]): boolean {
  if (tracks.length < 2 || !tracks.every(isTimed)) return false
  const ordered = chainOrder(tracks)
  return ordered.slice(1).every((track, i) => {
    const gapMs = startOf(track) - endOf(ordered[i])
    return gapMs >= 0 && gapMs < CHAIN_OFFER_MAX_GAP_MS
  })
}

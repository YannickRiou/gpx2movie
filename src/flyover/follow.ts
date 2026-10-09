/**
 * What the flight camera follows when several tracks are played (`FilmViewOptions.follow`, flyover/filmCamera.ts):
 * « À la suite » the stage under the marker, on its own path (a cut at each stage change); « En parallèle » the racer
 * ahead (`tete`) or all the racers framed together (`ensemble`); 'premiere': the first track.
 * A function of the film progress only (`raceAt` is), so the preview and the export place the camera alike.
 */
import type { Track } from '../core/types'
import type { FollowedFlight } from './filmCamera'
import { buildRace, raceAt, raceTrackOf, rankRacers } from './race'
import type { RaceSettings } from './race'
import { filmSequenceOf, stageAt } from './sequence'

export type FollowFlight = (progress: number) => FollowedFlight | null

/** The follow of the film for these tracks and settings, null when the camera flies the film track itself. */
export function filmFollowOf(tracks: readonly Track[], race: RaceSettings, smoothingM: number): FollowFlight | null {
  const sequence = filmSequenceOf(tracks, race)
  if (sequence) {
    return (progress) => {
      const at = stageAt(sequence, progress)
      // the stage's smoothed path, cached per track (the same line as the one drawn)
      return { path: raceTrackOf(at.stage.track, smoothingM).path, progress: at.progress }
    }
  }
  const camera = race.camera ?? 'premiere'
  if (!race.enabled || tracks.length < 2 || camera === 'premiere') return null
  const built = buildRace(
    tracks.map((t) => raceTrackOf(t, smoothingM)),
    race.sync,
  )
  return (progress) => {
    const racers = raceAt(built, progress)
    const lead = built.tracks[0]
    if (racers.length === 0) return null
    if (camera === 'ensemble') return { path: lead.path, progress, group: racers }
    const ranked = rankRacers(racers)
    const ahead = ranked.find((r) => !r.finished) ?? ranked[0]
    return { path: built.tracks[ahead.index].path, progress: ahead.fraction, markerOnFilm: true }
  }
}

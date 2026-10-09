import { useMemo } from 'react'
import { buildRace, raceTrackOf } from '../flyover/race'
import type { Race } from '../flyover/race'
import { useAppStore } from '../state/store'

/**
 * Ghost race of the loaded tracks for the current sync setting (memoised, tables cached per track), shared by
 * the 3D markers (RaceMarkers) and the leaderboard of the track list. Null with fewer than two tracks.
 */
export function useRace(): Race | null {
  const tracks = useAppStore((s) => s.tracks)
  const sync = useAppStore((s) => s.settings.race.sync)
  const smoothingM = useAppStore((s) => s.settings.trackStyle.smoothingM)
  return useMemo(
    () => (tracks.length >= 2 ? buildRace(tracks.map((t) => raceTrackOf(t, smoothingM)), sync) : null),
    [tracks, sync, smoothingM],
  )
}

import { useMemo } from 'react'
import { buildPacing } from '../flyover/pacing'
import type { Pacing } from '../flyover/pacing'
import { useLandmarkStore } from '../osm/store'
import { useAppStore } from '../state/store'

/**
 * Pacing of the first track for the current settings and OpenStreetMap landmarks (memoised), shared by the
 * playback (FlyoverRig) and the camera panel (film duration).
 */
export function usePacing(): Pacing {
  const track = useAppStore((s) => s.tracks[0])
  const durationS = useAppStore((s) => s.settings.flyoverDurationS)
  const settings = useAppStore((s) => s.settings.pacing)
  const landmarks = useLandmarkStore((s) => (track ? s.landmarks[track.id] : undefined))
  return useMemo(() => buildPacing({ track, durationS, settings, landmarks }), [track, durationS, settings, landmarks])
}

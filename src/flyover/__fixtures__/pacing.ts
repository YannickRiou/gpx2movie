import type { Track } from '../../core/types'
import type { Landmark } from '../../osm/landmarks'
import { pacingFromHighlights, pacingHighlights } from '../pacing'
import type { Pacing, PacingSettings } from '../pacing'

/** Test helper: the pacing of the flyover of `track` alone, the reference the film clock must replay. */
export function buildPacing({
  track,
  durationS,
  settings,
  landmarks = [],
}: {
  track: Track | undefined
  durationS: number
  settings: PacingSettings
  landmarks?: readonly Landmark[]
}): Pacing {
  if (!track || !settings.enabled) return pacingFromHighlights(0, [], durationS, settings)
  return pacingFromHighlights(track.stats.distanceM, pacingHighlights(track, settings, landmarks), durationS, settings)
}

import type { LocalFrame, TerrainEngine } from '../core/types'
import type { FilmClock } from '../film/clock'
import { computeFilmView, type FilmView } from '../flyover/filmCamera'
import { filmFollowOf } from '../flyover/follow'
import type { TrackPath } from '../flyover/path'
import { useRegionStore } from '../osm/region'
import { useAppStore } from '../state/store'
import { LINE_LIFT_M, type HeightSampler } from './TrackLines'

/** Camera placement of FlyoverRig at `progress` and film time `timeS` with the terrain loaded now (same inputs as the rig). */
export function filmViewAt(
  path: TrackPath,
  clock: FilmClock,
  progress: number,
  timeS: number | null,
  frame: LocalFrame,
  engine: TerrainEngine | null,
  aspect: number,
): FilmView {
  const { settings, tracks } = useAppStore.getState()
  const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
  return computeFilmView(path, clock, timeS ?? clock.timeAtProgress(progress), progress, frame, sampler, {
    exaggeration: settings.exaggeration,
    liftM: LINE_LIFT_M,
    camera: settings.camera,
    durationS: settings.flyoverDurationS,
    aspect,
    region: useRegionStore.getState().frame,
    follow: filmFollowOf(tracks, settings.race, settings.trackStyle.smoothingM),
  })
}

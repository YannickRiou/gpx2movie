/**
 * FlyoverRig — plays the film along the first track: advances the store's playback progress and film time on the film
 * clock (`film/clock.ts`), moves the marker on the draped track (`markerSprite.ts`) and drives the camera
 * (`flyover/filmCamera.ts`; with several tracks, `flyover/follow.ts` gives the stage or the racers). See
 * ARCHITECTURE.md "Flyover".
 *
 * The view is a pure function of the progress, the film time and the settings (no smoothing state), so the video
 * export renders any frame independently by setting both.
 *
 * The camera is driven while playing (orbit controls disabled) and whenever the progress, the film time of a view that
 * moves with time, or the camera and film settings change while paused; otherwise the user orbits freely.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Sprite, Vector3 } from 'three'
import { filmViewMovesWithTime, situationFramingOf, situationTarget } from '../flyover/filmCamera'
import { filmFollowOf } from '../flyover/follow'
import { smoothedTrackPath } from '../flyover/smooth'
import { registerFramingCapture, useRegionStore } from '../osm/region'
import { useAppStore } from '../state/store'
import { filmViewAt } from './filmView'
import { useTerrainContext } from './TerrainLayer'
import { frameDelta } from './renderOnDemand'
import { headsLeft, LEAD_MARKER_COLORS, placeMarker, useMarkerImage } from './markerSprite'
import { figureMotion } from './markerSettings'
import { useFilmClock, useFilmTrack } from './usePacing'
import type { HeightSampler } from './TrackLines'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** What FlyoverRig needs from the default controls (drei OrbitControls with makeDefault). */
interface DefaultControls {
  target: Vector3
  enabled: boolean
}

export function FlyoverRig() {
  const track = useFilmTrack()
  const tracks = useAppStore((s) => s.tracks)
  const race = useAppStore((s) => s.settings.race)
  const smoothingM = useAppStore((s) => s.settings.trackStyle.smoothingM)
  const { engine, frame } = useTerrainContext()
  const controls = useThree((s) => s.controls) as unknown as DefaultControls | null

  // the marker and the camera follow the same smoothed positions as the drawn line (TrackLines)
  const path = useMemo(() => (track ? smoothedTrackPath(track, smoothingM) : null), [track, smoothingM])
  const follow = useMemo(() => filmFollowOf(tracks, race, smoothingM), [tracks, race, smoothingM])
  const clock = useFilmClock()
  /** clock the store's film time was computed with */
  const clockRef = useRef(clock)
  const markerRef = useRef<Sprite>(null)
  const markerImage = useMarkerImage(useAppStore((s) => s.settings.marker.image))
  /** view the camera was last placed for; start at the mount values so the initial fit is kept */
  const { playback: mount, settings: mountSettings } = useAppStore.getState()
  const mountTimeS = mount.timeS ?? clock.timeAtProgress(mount.progress)
  const appliedRef = useRef({
    progress: mount.progress,
    timeS: mountTimeS,
    timed: filmViewMovesWithTime(clock.stateAt(mountTimeS), mountSettings.camera),
  })
  const appliedSettingsRef = useRef(mountSettings)
  const appliedRegionRef = useRef(useRegionStore.getState().frame)
  const camera = useThree((s) => s.camera)

  // « Capturer la vue actuelle »: the framing of this camera around the target of the region view
  useEffect(() => {
    if (!path || path.count === 0 || !frame) return
    return registerFramingCapture((highlighted) => {
      const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
      const { exaggeration } = useAppStore.getState().settings
      const region = highlighted ? useRegionStore.getState().frame : null
      return situationFramingOf(camera.position, situationTarget(path, frame, sampler, exaggeration, region))
    })
  }, [path, frame, engine, camera])

  useFrame(({ camera, size, gl }, delta) => {
    const store = useAppStore.getState()
    const { playing, speed } = store.playback
    const { settings } = store
    // after a change of the film, keep the film time (the timeline edits in film time) and take its progress
    if (clockRef.current !== clock) {
      clockRef.current = clock
      const { timeS } = store.playback
      if (timeS !== null) {
        const t = Math.min(timeS, clock.totalTime())
        store.setProgress(clock.progressAtTime(t), t < clock.totalTime() ? t : null)
      }
    }
    if (playing) {
      const { progress, timeS } = useAppStore.getState().playback
      // resynchronise after a scrub or a change of the film (no film time)
      const from = timeS === null ? clock.positionAt(progress) : { timeS, progress }
      const position = clock.advance(from, frameDelta(delta), speed)
      // the film ends at its total time, after the closing: without a film time, progress 1 stops the playback
      store.setProgress(position.progress, position.timeS < clock.totalTime() ? position.timeS : null)
    }
    const { progress, timeS: storedTimeS } = useAppStore.getState().playback
    const timeS = storedTimeS ?? clock.timeAtProgress(progress)

    if (controls) controls.enabled = !playing
    const marker = markerRef.current
    if (!marker) return
    if (!path || path.count === 0 || !frame) {
      marker.visible = false
      return
    }

    // the highlighted region a 'situation' shot frames, once loaded (osm/region.ts)
    const region = useRegionStore.getState().frame
    // the export places its camera with the same function
    const view = filmViewAt(path, clock, progress, timeS, frame, engine, size.height > 0 ? size.width / size.height : 1, follow)
    marker.visible = true

    const applied = appliedSettingsRef.current
    const cameraChanged =
      settings.camera !== applied.camera ||
      settings.flyoverDurationS !== applied.flyoverDurationS ||
      settings.film !== applied.film ||
      settings.race !== applied.race ||
      region !== appliedRegionRef.current
    const placed = appliedRef.current
    const timed = filmViewMovesWithTime(clock.stateAt(timeS), settings.camera)
    const moved = progress !== placed.progress || ((timed || placed.timed) && timeS !== placed.timeS)
    if (playing || moved || cameraChanged) {
      appliedRef.current = { progress, timeS, timed }
      appliedSettingsRef.current = settings
      appliedRegionRef.current = region
      camera.position.copy(view.position)
      camera.lookAt(view.target)
      controls?.target.copy(view.target)
    }
    // after the camera move: the figure faces the way the track runs in this very frame
    const look = { marker: settings.marker, image: markerImage, allowImage: true }
    const mirrored = settings.marker.kind === 'figurine' && headsLeft(path, progress * path.lengthM, view.marker, frame, camera)
    const motion = settings.marker.kind === 'figurine' && settings.marker.animated ? figureMotion(timeS) : undefined
    placeMarker(marker, view.marker, camera, look, LEAD_MARKER_COLORS, mirrored, 1 / gl.toneMappingExposure, motion)
  })

  // unlit and drawn over the terrain: readable on the track colour and on dark forest alike
  return (
    <sprite ref={markerRef} name="flyover-marker" visible={false} renderOrder={2}>
      <spriteMaterial depthTest={false} depthWrite={false} />
    </sprite>
  )
}

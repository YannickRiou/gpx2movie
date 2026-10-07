/**
 * FlyoverRig — plays the film along the first track: advances the store's playback progress and film time on
 * the film clock (`film/clock.ts`: opening shot, flight over `settings.flyoverDurationS` at speed x1 with the
 * slow-downs of `settings.pacing` and the stops of `settings.film`, closing shot), moves a progress marker on the
 * draped track and drives the camera (`flyover/filmCamera.ts`: overview shots, stops, flight in the style of
 * `settings.camera`).
 *
 * The view is a pure function of the progress, the film time and the settings (no smoothing state), so they
 * always give the same frame: the video export renders any frame independently by setting both.
 *
 * The camera is driven while playing (orbit controls disabled) and whenever the progress, the film time of a
 * view that moves with time (shots, orbiting stops, time-based styles: export) or the camera and film settings
 * change while paused (timeline scrubbing, camera panel); otherwise the user orbits freely around the marker.
 */
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Mesh, Vector3 } from 'three'
import { computeFilmView, filmViewMovesWithTime } from '../flyover/filmCamera'
import { buildTrackPath } from '../flyover/path'
import { useAppStore } from '../state/store'
import { useTerrainContext } from './TerrainLayer'
import { useFilmClock } from './usePacing'
import { LINE_LIFT_M, type HeightSampler } from './TrackLines'

/** Marker radius as a fraction of its distance to the camera (constant on-screen size, ~7 px at 1000 px). */
export const MARKER_SCREEN_FACTOR = 0.007
/** Unlit and drawn over the terrain: readable on the track colour and on dark forest alike. */
export const MARKER_COLOR = '#FFFFFF'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** What FlyoverRig needs from the default controls (drei OrbitControls with makeDefault). */
interface DefaultControls {
  target: Vector3
  enabled: boolean
}

export function FlyoverRig() {
  const track = useAppStore((s) => s.tracks[0])
  const { engine, frame } = useTerrainContext()
  const controls = useThree((s) => s.controls) as unknown as DefaultControls | null

  const path = useMemo(() => (track ? buildTrackPath(track) : null), [track])
  const clock = useFilmClock()
  /** clock the store's film time was computed with */
  const clockRef = useRef(clock)
  const markerRef = useRef<Mesh>(null)
  /** view the camera was last placed for; start at the mount values so the initial fit is kept */
  const { playback: mount, settings: mountSettings } = useAppStore.getState()
  const mountTimeS = mount.timeS ?? clock.timeAtProgress(mount.progress)
  const appliedRef = useRef({
    progress: mount.progress,
    timeS: mountTimeS,
    timed: filmViewMovesWithTime(clock.stateAt(mountTimeS), mountSettings.camera.style),
  })
  const appliedSettingsRef = useRef(mountSettings)

  useFrame(({ camera, size }, delta) => {
    const store = useAppStore.getState()
    const { playing, speed } = store.playback
    const { settings } = store
    // a film time belongs to its clock: after a change, start again from the progress
    if (clockRef.current !== clock) {
      clockRef.current = clock
      if (store.playback.timeS !== null) store.setProgress(store.playback.progress)
    }
    if (playing) {
      const { progress, timeS } = useAppStore.getState().playback
      // resynchronise after a scrub or a change of the film (no film time)
      const from = timeS === null ? clock.positionAt(progress) : { timeS, progress }
      const position = clock.advance(from, delta, speed)
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

    const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
    const view = computeFilmView(path, clock, timeS, progress, frame, sampler, {
      exaggeration: settings.exaggeration,
      liftM: LINE_LIFT_M,
      camera: settings.camera,
      durationS: settings.flyoverDurationS,
      aspect: size.height > 0 ? size.width / size.height : 1,
    })
    marker.visible = true
    marker.position.copy(view.marker)

    const applied = appliedSettingsRef.current
    const cameraChanged =
      settings.camera !== applied.camera || settings.flyoverDurationS !== applied.flyoverDurationS || settings.film !== applied.film
    const placed = appliedRef.current
    const timed = filmViewMovesWithTime(clock.stateAt(timeS), settings.camera.style)
    const moved = progress !== placed.progress || ((timed || placed.timed) && timeS !== placed.timeS)
    if (playing || moved || cameraChanged) {
      appliedRef.current = { progress, timeS, timed }
      appliedSettingsRef.current = settings
      camera.position.copy(view.position)
      camera.lookAt(view.target)
      controls?.target.copy(view.target)
    }
    marker.scale.setScalar(Math.max(1, camera.position.distanceTo(view.marker) * MARKER_SCREEN_FACTOR))
  })

  return (
    <mesh ref={markerRef} name="flyover-marker" visible={false} renderOrder={2}>
      <sphereGeometry args={[1, 24, 16]} />
      <meshBasicMaterial color={MARKER_COLOR} depthTest={false} depthWrite={false} />
    </mesh>
  )
}

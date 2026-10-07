/**
 * FlyoverRig — plays the flyover along the first track: advances the store's playback progress and film time
 * (over `settings.flyoverDurationS` at speed x1, through the slow-downs and pauses of `settings.pacing`, see
 * `flyover/pacing.ts`, final pause included), moves a progress marker on the draped track and drives the camera in
 * the style of `settings.camera` (see `flyover/camera.ts`).
 *
 * The view is a pure function of the progress, the film time and the settings (no smoothing state), so they
 * always give the same frame: the video export renders any frame independently by setting both.
 *
 * The camera is driven while playing (orbit controls disabled) and whenever the progress, the film time of a
 * time-based style (export) or the camera settings change while paused (timeline scrubbing, camera panel);
 * otherwise the user orbits freely around the marker.
 */
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Mesh, Vector3 } from 'three'
import { computeCameraView, movesWithTime } from '../flyover/camera'
import { buildTrackPath } from '../flyover/path'
import { useAppStore } from '../state/store'
import { useTerrainContext } from './TerrainLayer'
import { usePacing } from './usePacing'
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
  const pacing = usePacing()
  /** pacing the store's film time was computed with */
  const pacingRef = useRef(pacing)
  const markerRef = useRef<Mesh>(null)
  /** view the camera was last placed for; start at the mount values so the initial fit is kept */
  const { playback: mount, settings: mountSettings } = useAppStore.getState()
  const appliedRef = useRef({ progress: mount.progress, timeS: mount.timeS ?? pacing.timeAtProgress(mount.progress) })
  const appliedSettingsRef = useRef(mountSettings)

  useFrame(({ camera }, delta) => {
    const store = useAppStore.getState()
    const { playing, speed } = store.playback
    const { settings } = store
    // a film time belongs to its pacing: after a change, start again from the progress
    if (pacingRef.current !== pacing) {
      pacingRef.current = pacing
      if (store.playback.timeS !== null) store.setProgress(store.playback.progress)
    }
    if (playing) {
      const { progress, timeS } = useAppStore.getState().playback
      // resynchronise after a scrub, a rewind or a change of pacing (no film time)
      const from = timeS === null ? pacing.positionAt(progress) : { timeS, progress }
      const position = pacing.advance(from, delta, speed)
      // the film ends at its total time, after the final pause: without a film time, progress 1 stops the playback
      store.setProgress(position.progress, position.timeS < pacing.totalTime() ? position.timeS : null)
    }
    const { progress, timeS: storedTimeS } = useAppStore.getState().playback
    const timeS = storedTimeS ?? pacing.timeAtProgress(progress)

    if (controls) controls.enabled = !playing
    const marker = markerRef.current
    if (!marker) return
    if (!path || path.count === 0 || !frame) {
      marker.visible = false
      return
    }

    const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
    const view = computeCameraView(path, progress, frame, sampler, {
      exaggeration: settings.exaggeration,
      liftM: LINE_LIFT_M,
      camera: settings.camera,
      durationS: settings.flyoverDurationS,
      timeS,
    })
    marker.visible = true
    marker.position.copy(view.target)

    const applied = appliedSettingsRef.current
    const cameraChanged = settings.camera !== applied.camera || settings.flyoverDurationS !== applied.flyoverDurationS
    const placed = appliedRef.current
    const moved = progress !== placed.progress || (movesWithTime(settings.camera.style) && timeS !== placed.timeS)
    if (playing || moved || cameraChanged) {
      appliedRef.current = { progress, timeS }
      appliedSettingsRef.current = settings
      camera.position.copy(view.position)
      camera.lookAt(view.target)
      controls?.target.copy(view.target)
    }
    marker.scale.setScalar(Math.max(1, camera.position.distanceTo(view.target) * MARKER_SCREEN_FACTOR))
  })

  return (
    <mesh ref={markerRef} name="flyover-marker" visible={false} renderOrder={2}>
      <sphereGeometry args={[1, 24, 16]} />
      <meshBasicMaterial color={MARKER_COLOR} depthTest={false} depthWrite={false} />
    </mesh>
  )
}

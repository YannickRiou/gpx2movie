/**
 * FlyoverRig — plays the flyover along the first track: advances the store's playback progress (over
 * `settings.flyoverDurationS` at speed x1, or through the slow-downs and pauses of `settings.pacing`, see
 * `flyover/pacing.ts`), moves a progress marker on the draped track and drives the camera in the style of
 * `settings.camera` (see `flyover/camera.ts`).
 *
 * The view is a pure function of the progress and the settings (no smoothing state), so a given progress
 * always gives the same frame: the future video export can render any frame independently.
 *
 * The camera is driven while playing (orbit controls disabled) and whenever the progress or the camera
 * settings change while paused (timeline scrubbing, camera panel); otherwise the user orbits freely around
 * the marker.
 */
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Mesh, Vector3 } from 'three'
import { computeCameraView } from '../flyover/camera'
import { advanceProgress } from '../flyover/cameraSettings'
import type { Pacing, PacingPosition } from '../flyover/pacing'
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
  /** film time of the last progress set by the playback: progress alone cannot tell where a pause is at */
  const clockRef = useRef<{ pacing: Pacing; position: PacingPosition } | null>(null)
  const markerRef = useRef<Mesh>(null)
  /** progress and settings the camera was last placed for; start at the mount values so the initial fit is kept */
  const appliedRef = useRef(useAppStore.getState().playback.progress)
  const appliedSettingsRef = useRef(useAppStore.getState().settings)

  useFrame(({ camera }, delta) => {
    const store = useAppStore.getState()
    const { playing, speed } = store.playback
    const { settings } = store
    if (playing && !settings.pacing.enabled) {
      store.setProgress(advanceProgress(store.playback.progress, delta, speed, settings.flyoverDurationS))
    } else if (playing) {
      const clock = clockRef.current
      const current = store.playback.progress
      // resynchronise after a scrub, a rewind or a change of pacing
      const from = clock && clock.pacing === pacing && clock.position.progress === current ? clock.position : pacing.positionAt(current)
      const position = pacing.advance(from, delta, speed)
      clockRef.current = { pacing, position }
      store.setProgress(position.progress)
    }
    const { progress } = useAppStore.getState().playback

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
    })
    marker.visible = true
    marker.position.copy(view.target)

    const applied = appliedSettingsRef.current
    const cameraChanged = settings.camera !== applied.camera || settings.flyoverDurationS !== applied.flyoverDurationS
    if (playing || progress !== appliedRef.current || cameraChanged) {
      appliedRef.current = progress
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

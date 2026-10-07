/**
 * FlyoverRig — plays the flyover along the first track: advances the store's playback progress, moves a
 * progress marker on the draped track and drives a chase camera.
 *
 * The chase view is a pure function of the progress (no smoothing state), so a given progress always gives
 * the same frame: the future video export can render any frame independently.
 *
 * The camera is driven while playing (orbit controls disabled) and whenever the progress changes while
 * paused (timeline scrubbing); otherwise the user orbits freely around the marker.
 */
import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3, type Mesh } from 'three'
import type { LocalFrame } from '../core/types'
import { buildTrackPath, samplePath, type TrackPath } from '../flyover/path'
import { useAppStore } from '../state/store'
import { useTerrainContext } from './TerrainLayer'
import { LINE_LIFT_M, type HeightSampler } from './TrackLines'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Flyover duration at speed x1, whatever the track length (seconds). */
export const FLYOVER_BASE_DURATION_S = 60

/** Heading = direction of the chord [d - w, d + w]; w = this fraction of the track, clamped. */
export const HEADING_WINDOW_FRACTION = 0.02
export const HEADING_WINDOW_MIN_M = 150
export const HEADING_WINDOW_MAX_M = 1_500
/** Camera distance behind the marker = this fraction of the track, clamped. */
export const CHASE_DISTANCE_FRACTION = 0.04
export const CHASE_DISTANCE_MIN_M = 600
export const CHASE_DISTANCE_MAX_M = 4_000
/** Camera pitch above the horizon. */
export const CHASE_PITCH_RAD = (30 * Math.PI) / 180
/** The camera never goes closer than this to the (exaggerated) ground below it (metres). */
export const MIN_GROUND_CLEARANCE_M = 80
/**
 * Terrain samples along the sight line camera → marker (fractions 0 .. LINE_OF_SIGHT_MAX_FRACTION); the
 * clearance tapers from MIN_GROUND_CLEARANCE_M under the camera to 0 at the marker.
 */
export const LINE_OF_SIGHT_SAMPLES = 12
export const LINE_OF_SIGHT_MAX_FRACTION = 0.9

/** Marker radius as a fraction of its distance to the camera (constant on-screen size, ~7 px at 1000 px). */
export const MARKER_SCREEN_FACTOR = 0.007
/** Unlit and drawn over the terrain: readable on the track colour and on dark forest alike. */
export const MARKER_COLOR = '#FFFFFF'

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Progress after `deltaS` seconds of playback, clamped to 1. */
export function advanceProgress(progress: number, deltaS: number, speed: number): number {
  return Math.min(1, progress + (deltaS * speed) / FLYOVER_BASE_DURATION_S)
}

export interface ChaseView {
  /** marker position on the draped track, local frame */
  target: Vector3
  position: Vector3
}

/**
 * Chase camera at `progress` along `path`: behind the marker (along the smoothed heading), CHASE_PITCH_RAD
 * above the horizon, never under MIN_GROUND_CLEARANCE_M above the terrain, and raised (pitch steepens)
 * until the sight line to the marker clears the terrain in between.
 * Heights: terrain sample, else recorded elevation, else 0; times `exaggeration`.
 */
export function computeChaseView(
  path: TrackPath,
  progress: number,
  frame: LocalFrame,
  sample: HeightSampler | null,
  exaggeration: number,
): ChaseView {
  const length = path.lengthM
  const d = clamp(progress, 0, 1) * length

  const at = samplePath(path, d)
  const ground = (sample?.(at.lon, at.lat) ?? at.ele ?? 0) * exaggeration
  const target = frame.toLocal(at.lon, at.lat, ground + LINE_LIFT_M)

  // Heading from a chord around the marker: wide enough to ignore GPS jitter and switchbacks.
  const w = clamp(length * HEADING_WINDOW_FRACTION, HEADING_WINDOW_MIN_M, HEADING_WINDOW_MAX_M)
  const behind = samplePath(path, d - w)
  const ahead = samplePath(path, d + w)
  const a = frame.toLocal(behind.lon, behind.lat, 0)
  const b = frame.toLocal(ahead.lon, ahead.lat, 0)
  const heading = new Vector3(b.x - a.x, 0, b.z - a.z)
  if (heading.lengthSq() < 1) heading.set(0, 0, -1) // no motion: look north
  heading.normalize()

  const distance = clamp(length * CHASE_DISTANCE_FRACTION, CHASE_DISTANCE_MIN_M, CHASE_DISTANCE_MAX_M)
  const position = target
    .clone()
    .addScaledVector(heading, -distance * Math.cos(CHASE_PITCH_RAD))
    .setY(target.y + distance * Math.sin(CHASE_PITCH_RAD))

  if (sample) {
    // The sight line at fraction f (0 = camera) has height y + (target.y - y) * f; keep it above the ground.
    const point = new Vector3()
    let minY = position.y
    for (let i = 0; i <= LINE_OF_SIGHT_SAMPLES; i++) {
      const f = (i / LINE_OF_SIGHT_SAMPLES) * LINE_OF_SIGHT_MAX_FRACTION
      point.lerpVectors(position, target, f).setY(target.y)
      const at = frame.toLonLat(point)
      const ground = sample(at.lon, at.lat)
      if (ground === undefined) continue
      const clearance = MIN_GROUND_CLEARANCE_M * (1 - f)
      const floorY = frame.toLocal(at.lon, at.lat, ground * exaggeration + clearance, point).y
      minY = Math.max(minY, (floorY - target.y * f) / (1 - f))
    }
    position.y = minY
  }
  return { target, position }
}

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
  const markerRef = useRef<Mesh>(null)
  /** progress the camera was last placed for; starts at the mount value so the initial fit is kept */
  const appliedRef = useRef(useAppStore.getState().playback.progress)

  useFrame(({ camera }, delta) => {
    const store = useAppStore.getState()
    const { playing, speed } = store.playback
    if (playing) store.setProgress(advanceProgress(store.playback.progress, delta, speed))
    const { progress } = useAppStore.getState().playback

    if (controls) controls.enabled = !playing
    const marker = markerRef.current
    if (!marker) return
    if (!path || path.count === 0 || !frame) {
      marker.visible = false
      return
    }

    const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
    const view = computeChaseView(path, progress, frame, sampler, store.settings.exaggeration)
    marker.visible = true
    marker.position.copy(view.target)

    if (playing || progress !== appliedRef.current) {
      appliedRef.current = progress
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

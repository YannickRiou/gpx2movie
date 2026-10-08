/**
 * CameraRig — orbit controls plus "fit to tracks".
 *
 * A fit is performed when the store's `fitRequest` counter changes, and once when bounds first appear
 * while the rig is mounted. The first fit snaps (no fly-in from the default camera spot); later fits
 * animate position and target over ~800 ms with ease-in-out. Any user interaction cancels the animation.
 */
import { useCallback, useEffect, useRef, type ComponentRef } from 'react'
import { invalidate, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Box3, Vector3 } from 'three'
import type { LocalFrame, LonLatBounds, Track } from '../core/types'
import { centroid } from '../geo/ellipsoid'
import { useAppStore } from '../state/store'
import { useTerrainContext } from './TerrainLayer'
import { frameDelta } from './renderOnDemand'

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MIN_DISTANCE_M = 30
export const MAX_DISTANCE_M = 400_000
/** 85° from the zenith: the camera never goes below the horizon. */
export const MAX_POLAR_ANGLE_RAD = (85 * Math.PI) / 180
export const DAMPING_FACTOR = 0.08

export const FIT_DURATION_MS = 800
export const FIT_MIN_DISTANCE_M = 2_000
export const FIT_DISTANCE_FACTOR = 1.4
/** Camera pitch above the horizon when fitting. */
export const FIT_PITCH_RAD = (40 * Math.PI) / 180
/** Ground height assumed when neither the terrain nor the tracks give one (metres). */
export const DEFAULT_GROUND_HEIGHT_M = 1_000

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

export interface FitView {
  /** orbit target: centre of the bounds at ground height, local frame */
  target: Vector3
  /** camera position: south-east of the target, FIT_PITCH_RAD above the horizon */
  position: Vector3
  distance: number
}

/**
 * Unit vector from the target to the camera: south-east (+X east, +Z south) and FIT_PITCH_RAD above the
 * horizon.
 */
export function fitViewDirection(): Vector3 {
  const horizontal = Math.cos(FIT_PITCH_RAD) / Math.SQRT2
  return new Vector3(horizontal, Math.sin(FIT_PITCH_RAD), horizontal)
}

/**
 * Where to put the camera so the whole box is in view: target = centre of the local box spanned by the
 * four bounds corners at `groundHeightM`, distance = max(FIT_MIN_DISTANCE_M, FIT_DISTANCE_FACTOR x diagonal).
 */
export function computeFitView(bounds: LonLatBounds, frame: LocalFrame, groundHeightM: number): FitView {
  const box = new Box3()
  const corner = new Vector3()
  box.expandByPoint(frame.toLocal(bounds.west, bounds.south, groundHeightM, corner))
  box.expandByPoint(frame.toLocal(bounds.east, bounds.south, groundHeightM, corner))
  box.expandByPoint(frame.toLocal(bounds.east, bounds.north, groundHeightM, corner))
  box.expandByPoint(frame.toLocal(bounds.west, bounds.north, groundHeightM, corner))

  const target = box.getCenter(new Vector3())
  const diagonal = box.getSize(new Vector3()).length()
  const distance = Math.max(FIT_MIN_DISTANCE_M, FIT_DISTANCE_FACTOR * diagonal)
  const position = fitViewDirection().multiplyScalar(distance).add(target)
  return { target, position, distance }
}

export function easeInOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** Mean of the tracks' recorded elevation ranges, or undefined when no track has elevation data. */
export function meanTrackElevation(tracks: readonly Track[]): number | undefined {
  let sum = 0
  let n = 0
  for (const track of tracks) {
    const { minEle, maxEle } = track.stats
    if (minEle === undefined || maxEle === undefined) continue
    sum += (minEle + maxEle) / 2
    n++
  }
  return n > 0 ? sum / n : undefined
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FitAnimation {
  fromPosition: Vector3
  fromTarget: Vector3
  toPosition: Vector3
  toTarget: Vector3
  elapsedMs: number
}

export function CameraRig() {
  const bounds = useAppStore((s) => s.bounds)
  const fitRequest = useAppStore((s) => s.fitRequest)
  const { engine, frame } = useTerrainContext()

  const controlsRef = useRef<OrbitControlsImpl>(null)
  const animationRef = useRef<FitAnimation | null>(null)
  /** fitRequest value already handled, null when no fit has been done for the current bounds */
  const handledFitRef = useRef<number | null>(null)

  useEffect(() => {
    if (!bounds || !frame) {
      handledFitRef.current = null
      animationRef.current = null
      return
    }
    if (handledFitRef.current === fitRequest) return
    const controls = controlsRef.current
    if (!controls) return

    const firstFit = handledFitRef.current === null
    handledFitRef.current = fitRequest

    const { tracks, settings } = useAppStore.getState()
    const centre = centroid(bounds)
    const ground = engine?.sampleHeight(centre.lon, centre.lat) ?? meanTrackElevation(tracks) ?? DEFAULT_GROUND_HEIGHT_M
    const view = computeFitView(bounds, frame, ground * settings.exaggeration)

    if (firstFit) {
      animationRef.current = null
      controls.object.position.copy(view.position)
      controls.target.copy(view.target)
      controls.update()
      return
    }
    animationRef.current = {
      fromPosition: controls.object.position.clone(),
      fromTarget: controls.target.clone(),
      toPosition: view.position,
      toTarget: view.target,
      elapsedMs: 0,
    }
  }, [bounds, frame, fitRequest, engine])

  useFrame((_, delta) => {
    const animation = animationRef.current
    const controls = controlsRef.current
    if (!animation || !controls) return
    // first frame after an idle canvas: a bounded step, then one frame after another until the end
    animation.elapsedMs += frameDelta(delta) * 1000
    invalidate()
    const t = Math.min(1, animation.elapsedMs / FIT_DURATION_MS)
    const k = easeInOutCubic(t)
    controls.object.position.lerpVectors(animation.fromPosition, animation.toPosition, k)
    controls.target.lerpVectors(animation.fromTarget, animation.toTarget, k)
    controls.update()
    if (t >= 1) animationRef.current = null
  })

  const cancelAnimation = useCallback(() => {
    animationRef.current = null
  }, [])

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={DAMPING_FACTOR}
      maxPolarAngle={MAX_POLAR_ANGLE_RAD}
      minDistance={MIN_DISTANCE_M}
      maxDistance={MAX_DISTANCE_M}
      screenSpacePanning={false}
      onStart={cancelAnimation}
    />
  )
}

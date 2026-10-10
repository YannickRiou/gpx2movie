/**
 * CameraRig — orbit controls plus "fit to tracks".
 *
 * A fit runs when the store's `fitRequest` counter changes, and once when bounds first appear. The first fit snaps;
 * later ones animate position and target over ~800 ms, cancelled by any user interaction.
 *
 * Whenever the controls move the camera, or the ground changes under a camera sitting still, it is lifted to stay
 * FREE_CAMERA_CLEARANCE_M above the draped relief (one sample, and a frame drawn only if it moved). Nothing is sampled
 * otherwise, nor while the film plays or a video is exported (FlyoverRig drives the camera then).
 *
 * Touch: one finger orbits, two pinch to zoom and pan (the controls' own touch handling); a double tap fits, like F.
 */
import { useCallback, useEffect, useMemo, useRef, type ComponentRef } from 'react'
import { invalidate, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Box3, Vector3 } from 'three'
import type { LocalFrame, LonLatBounds, Track } from '../core/types'
import { isExportBusy, useExportStore } from '../export/store'
import { centroid } from '../geo/ellipsoid'
import { useAppStore } from '../state/store'
import { useTerrainContext } from './TerrainLayer'
import { frameDelta, wakeScene } from './renderOnDemand'
import type { HeightSampler } from './TrackLines'

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
/** Two taps closer than this in time (ms) and space (CSS pixels) are a double tap. */
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 30
export const FIT_MIN_DISTANCE_M = 2_000
export const FIT_DISTANCE_FACTOR = 1.4
/** Camera pitch above the horizon when fitting. */
export const FIT_PITCH_RAD = (40 * Math.PI) / 180
/** Ground height assumed when neither the terrain nor the tracks give one (metres). */
export const DEFAULT_GROUND_HEIGHT_M = 1_000
/**
 * Height the free camera keeps above the (exaggerated) ground right under it (metres). The engine always has its
 * finest tiles under the camera, but their mesh (`segments` cells per tile) cuts the corners of the elevation grid
 * the height is sampled from, by a few tens of metres on steep relief: this margin keeps the camera above the drawn
 * surface. Constant, since the ground under the camera is never the coarse distant one; below the flyover's
 * MIN_GROUND_CLEARANCE_M (80 m), so a view placed by the flyover is never moved.
 */
export const FREE_CAMERA_CLEARANCE_M = 30

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

const _floor = new Vector3()

/**
 * Raise `position` (local frame, changed in place) to `clearanceM` above the (exaggerated) ground under it; true
 * when it moved. Left as is where the terrain is not known.
 */
export function liftAboveGround(
  position: Vector3,
  frame: LocalFrame,
  sample: HeightSampler,
  exaggeration: number,
  clearanceM = FREE_CAMERA_CLEARANCE_M,
): boolean {
  const at = frame.toLonLat(position)
  const ground = sample(at.lon, at.lat)
  if (ground === undefined) return false
  const floorY = frame.toLocal(at.lon, at.lat, ground * exaggeration + clearanceM, _floor).y
  if (position.y >= floorY) return false
  position.y = floorY
  return true
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

/** A double tap with one finger on the view fits it to the tracks (touch only: the mouse keeps its double click free). */
function useDoubleTapFit() {
  const canvas = useThree((s) => s.gl.domElement)
  useEffect(() => {
    let fingers = 0
    let press: { x: number; y: number } | null = null
    let lastTap: { t: number; x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      fingers++
      press = fingers === 1 ? { x: e.clientX, y: e.clientY } : null
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      fingers = Math.max(0, fingers - 1)
      const tap = press !== null && Math.hypot(e.clientX - press.x, e.clientY - press.y) < DOUBLE_TAP_PX / 3
      press = null
      if (!tap || e.type === 'pointercancel') {
        lastTap = null
        return
      }
      if (lastTap && e.timeStamp - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_PX) {
        lastTap = null
        if (!isExportBusy(useExportStore.getState().phase)) useAppStore.getState().requestFit()
      } else {
        lastTap = { t: e.timeStamp, x: e.clientX, y: e.clientY }
      }
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    }
  }, [canvas])
}

export function CameraRig() {
  useDoubleTapFit()
  const bounds = useAppStore((s) => s.bounds)
  const fitRequest = useAppStore((s) => s.fitRequest)
  const exaggeration = useAppStore((s) => s.settings.exaggeration)
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

  const sampler = useMemo<HeightSampler | null>(() => (engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null), [engine])
  // fired by the controls only when they moved the camera, damping and fit included; true when it lifted the camera
  const keepAboveGround = useCallback(() => {
    const controls = controlsRef.current
    if (!controls || !sampler || !frame) return false
    const { playback, settings } = useAppStore.getState()
    if (playback.playing || isExportBusy(useExportStore.getState().phase)) return false
    const camera = controls.object
    if (!liftAboveGround(camera.position, frame, sampler, settings.exaggeration)) return false
    camera.lookAt(controls.target)
    return true
  }, [sampler, frame])
  // the ground changing under a camera sitting still: finer tiles (at most once per frame) or another exaggeration
  useEffect(() => {
    const lift = () => {
      if (keepAboveGround()) wakeScene()
    }
    lift()
    return engine?.onChange(lift)
  }, [engine, exaggeration, keepAboveGround])

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
      onChange={keepAboveGround}
    />
  )
}

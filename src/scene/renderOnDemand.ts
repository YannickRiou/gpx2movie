/**
 * Rendering on demand: the canvas (`frameloop="demand"`) draws only while something moves, instead of 60 times a
 * second while the view sits still. A frame is asked for:
 * - every frame while the film plays, while terrain tiles are loading and during a camera fit (their own `useFrame`);
 * - for WAKE_FRAMES frames after any change of the stores the scene reads (settings, film, playback, tracks, weather,
 *   labels, export), after a re-drape or a texture load (`wakeScene`): long enough for the temporal upscaling of
 *   the clouds to converge (~16 frames) and for effects run just after the change;
 * - by the orbit controls themselves (drei invalidates on each change, damping included), on a resize and by R3F on
 *   prop changes.
 * The video export drives its frames itself (`frameloop` 'never', see ExportController).
 */
import { useEffect } from 'react'
import { invalidate, useFrame, useThree } from '@react-three/fiber'
import { DefaultLoadingManager } from 'three'
import { useExportStore } from '../export/store'
import { useAppStore } from '../state/store'
import { useWeatherStore } from '../weather/store'
import { useLabelSources } from './labelSources'
import { useTerrainContext } from './TerrainLayer'

/** Frames drawn after a change (~0.5 s at 60 frames per second). */
export const WAKE_FRAMES = 30
/** Longest time step a frame may take after an idle period (seconds): playback and animations do not jump. */
export const MAX_FRAME_DELTA_S = 0.25

let remaining = 0
/** true once no frame was asked for: the clock still counts the pause */
let idle = false
let sceneClock: { getDelta(): number } | null = null

/** Draw the next `frames` frames (default WAKE_FRAMES). */
export function wakeScene(frames = WAKE_FRAMES): void {
  remaining = Math.max(remaining, frames)
  // the first frame after a pause would get the whole pause as its time step: start the step from now
  if (idle) {
    sceneClock?.getDelta()
    idle = false
  }
  invalidate()
}

/** Time step of a frame, bounded: the first frame after an idle period would otherwise span the whole pause. */
export function frameDelta(delta: number): number {
  return Math.min(delta, MAX_FRAME_DELTA_S)
}

/** Keys of the app store whose change does not touch the scene (`terrainStats` is written by the scene itself). */
const QUIET_KEYS = new Set(['terrainStats', 'loading'])

/** True when a change of the app store from `previous` to `state` may change the scene (any key but the quiet ones). */
export function sceneChanged<T extends object>(state: T, previous: T): boolean {
  return (Object.keys(state) as (keyof T)[]).some((key) => !QUIET_KEYS.has(key as string) && state[key] !== previous[key])
}

/** Mounted once inside the terrain layer: keeps frames coming while needed (see above). */
export function useRenderOnDemand(): void {
  const { engine } = useTerrainContext()
  const clock = useThree((s) => s.clock)
  useEffect(() => {
    sceneClock = clock
    return () => {
      if (sceneClock === clock) sceneClock = null
    }
  }, [clock])

  useFrame(() => {
    const busy = useAppStore.getState().playback.playing || (engine?.stats.pendingTiles ?? 0) > 0
    if (remaining > 0) remaining--
    if (busy || remaining > 0) invalidate()
    else idle = true
  })

  useEffect(() => {
    const wake = () => wakeScene()
    const unsubscribe = [
      useAppStore.subscribe((state, previous) => {
        if (sceneChanged(state, previous)) wake()
      }),
      useWeatherStore.subscribe(wake),
      useLabelSources.subscribe(wake),
      useExportStore.subscribe(wake),
    ]
    // textures of the sky and the clouds load through three's loaders
    const { onLoad, onProgress } = DefaultLoadingManager
    DefaultLoadingManager.onLoad = () => {
      onLoad?.()
      wake()
    }
    DefaultLoadingManager.onProgress = (...args) => {
      onProgress?.(...args)
      wake()
    }
    wake()
    return () => {
      for (const stop of unsubscribe) stop()
      DefaultLoadingManager.onLoad = onLoad
      DefaultLoadingManager.onProgress = onProgress
    }
  }, [])
}

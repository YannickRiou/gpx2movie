/**
 * TerrainLayer — owns the terrain engine lifecycle (create / configure / dispose) and shares the engine
 * and the local tangent frame with sibling scene components through React context.
 *
 * The engine is created in an effect, never in useMemo: React StrictMode double-invokes effects, and
 * "create in the effect body, dispose in its cleanup" is the only pattern that cannot leak GPU resources.
 *
 * The engine is recreated only when the local frame changes or when the tracks grow outside the area the
 * current engine was built for; settings changes are forwarded with `engine.setOptions`.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import type { PerspectiveCamera } from 'three'
import type { LocalFrame, LonLatBounds, TerrainEngine, TerrainEngineOptions, TerrainStats } from '../core/types'
import { createLocalFrame, expandBounds } from '../geo/ellipsoid'
import { createTerrainEngine } from '../terrain/engine'
import { getImagerySource, getTerrainSource } from '../terrain/sources'
import { useAppStore, type Settings } from '../state/store'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Margin added around the union of the track bounds to define the terrain area of interest. */
export const AREA_MARGIN_M = 25_000
/** Minimum size of the terrain area across, so short tracks still get a landscape around them. */
export const AREA_MIN_SIZE_M = 40_000
/** Screen-space error threshold handed to the engine (pixels). */
export const ERROR_TARGET_PX = 3
/** How often terrain stats are pushed to the store (seconds): 4 Hz. */
export const STATS_INTERVAL_S = 0.25

export const EMPTY_TERRAIN_STATS: TerrainStats = { visibleTiles: 0, loadedTiles: 0, pendingTiles: 0, failedTiles: 0 }

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface TerrainContextValue {
  /** null until the engine has been created (first effect) or when no track is loaded */
  engine: TerrainEngine | null
  /** local tangent frame of the current trip, null when no track is loaded */
  frame: LocalFrame | null
}

export const TerrainEngineContext = createContext<TerrainContextValue>({ engine: null, frame: null })

export function useTerrainContext(): TerrainContextValue {
  return useContext(TerrainEngineContext)
}

export function useTerrainEngine(): TerrainEngine | null {
  return useContext(TerrainEngineContext).engine
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** True when `inner` lies entirely inside `outer` (no antimeridian handling). */
export function boundsContain(outer: LonLatBounds, inner: LonLatBounds): boolean {
  return (
    inner.west >= outer.west && inner.east <= outer.east && inner.south >= outer.south && inner.north <= outer.north
  )
}

/**
 * Area the engine should be built for: keep the previous area while it still covers the desired one
 * (avoids tearing the whole terrain down for a nearby track), otherwise switch to the desired area.
 */
export function resolveEngineArea(previous: LonLatBounds | null, desired: LonLatBounds): LonLatBounds {
  return previous && boundsContain(previous, desired) ? previous : desired
}

export function statsEqual(a: TerrainStats, b: TerrainStats): boolean {
  return (
    a.visibleTiles === b.visibleTiles &&
    a.loadedTiles === b.loadedTiles &&
    a.pendingTiles === b.pendingTiles &&
    a.failedTiles === b.failedTiles
  )
}

/** The subset of engine options that is driven by the user settings. */
export type EngineSettingsOptions = Pick<
  TerrainEngineOptions,
  'terrain' | 'imagery' | 'imageryZoomOffset' | 'exaggeration' | 'wireframe'
>

export function engineOptionsFromSettings(settings: Settings): EngineSettingsOptions {
  return {
    terrain: getTerrainSource(settings.terrainSourceId),
    imagery: getImagerySource(settings.imagerySourceId),
    imageryZoomOffset: settings.imageryZoomOffset,
    exaggeration: settings.exaggeration,
    wireframe: settings.wireframe,
  }
}

/** Keys of `next` whose value differs from `prev` (sources compared by id), or null when nothing changed. */
export function diffEngineOptions(
  prev: EngineSettingsOptions,
  next: EngineSettingsOptions,
): Partial<EngineSettingsOptions> | null {
  const partial: Partial<EngineSettingsOptions> = {}
  let changed = false
  if (prev.terrain.id !== next.terrain.id) {
    partial.terrain = next.terrain
    changed = true
  }
  if (prev.imagery.id !== next.imagery.id) {
    partial.imagery = next.imagery
    changed = true
  }
  if (prev.imageryZoomOffset !== next.imageryZoomOffset) {
    partial.imageryZoomOffset = next.imageryZoomOffset
    changed = true
  }
  if (prev.exaggeration !== next.exaggeration) {
    partial.exaggeration = next.exaggeration
    changed = true
  }
  if (prev.wireframe !== next.wireframe) {
    partial.wireframe = next.wireframe
    changed = true
  }
  return changed ? partial : null
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface TerrainLayerProps {
  /** Scene components that need the engine (TrackLines, CameraRig...). */
  children?: ReactNode
}

interface AppliedOptions {
  engine: TerrainEngine
  options: EngineSettingsOptions
}

export function TerrainLayer({ children }: TerrainLayerProps) {
  const frameOrigin = useAppStore((s) => s.frameOrigin)
  const bounds = useAppStore((s) => s.bounds)
  const settings = useAppStore((s) => s.settings)
  const setTerrainStats = useAppStore((s) => s.setTerrainStats)

  // Local frame: depends on the origin values only, so a store update that keeps the same origin
  // does not rebuild the frame (and therefore does not recreate the engine).
  const originLon = frameOrigin?.lon
  const originLat = frameOrigin?.lat
  const frame = useMemo<LocalFrame | null>(
    () => (originLon === undefined || originLat === undefined ? null : createLocalFrame(originLon, originLat)),
    [originLon, originLat],
  )

  // Area of interest: sticky while the previous area still covers the tracks. The previous area is
  // kept in state and adjusted during render (React's "store information from previous renders"
  // pattern): the extra render only happens when the area actually changes.
  const desiredArea = useMemo<LonLatBounds | null>(
    () => (bounds ? expandBounds(bounds, AREA_MARGIN_M, AREA_MIN_SIZE_M) : null),
    [bounds],
  )
  const [previousArea, setPreviousArea] = useState<LonLatBounds | null>(null)
  const area = desiredArea ? resolveEngineArea(previousArea, desiredArea) : null
  if (area !== previousArea) setPreviousArea(area)

  // Engine lifecycle.
  const [engine, setEngine] = useState<TerrainEngine | null>(null)
  const appliedRef = useRef<AppliedOptions | null>(null)
  const lastStatsRef = useRef<TerrainStats | null>(null)
  const statsClockRef = useRef(0)

  useEffect(() => {
    if (!frame || !area) return undefined
    // Read the settings imperatively: they are forwarded by the effect below, so they must not be a
    // dependency here (a settings change must never recreate the engine).
    const options = engineOptionsFromSettings(useAppStore.getState().settings)
    const created = createTerrainEngine({ frame, area, errorTargetPx: ERROR_TARGET_PX, ...options })
    appliedRef.current = { engine: created, options }
    lastStatsRef.current = null
    statsClockRef.current = 0
    setEngine(created)

    return () => {
      setEngine((current) => (current === created ? null : current))
      if (appliedRef.current?.engine === created) appliedRef.current = null
      created.group.removeFromParent()
      created.dispose()
      lastStatsRef.current = null
      setTerrainStats({ ...EMPTY_TERRAIN_STATS })
    }
  }, [frame, area, setTerrainStats])

  // Forward settings changes (only the keys that actually changed).
  useEffect(() => {
    if (!engine) return
    const next = engineOptionsFromSettings(settings)
    const applied = appliedRef.current
    const partial = applied && applied.engine === engine ? diffEngineOptions(applied.options, next) : next
    if (!partial) return
    engine.setOptions(partial)
    appliedRef.current = { engine, options: next }
  }, [engine, settings])

  // Per-frame update + throttled stats (4 Hz, only when values change).
  useFrame(({ camera, size }, delta) => {
    if (!engine) return
    const perspective = camera as PerspectiveCamera
    if (!perspective.isPerspectiveCamera) return
    engine.update(perspective, size.height)

    statsClockRef.current += delta
    if (statsClockRef.current < STATS_INTERVAL_S) return
    statsClockRef.current = 0
    const stats = engine.stats
    if (lastStatsRef.current && statsEqual(lastStatsRef.current, stats)) return
    const snapshot: TerrainStats = { ...stats }
    lastStatsRef.current = snapshot
    setTerrainStats(snapshot)
  })

  const value = useMemo<TerrainContextValue>(() => ({ engine, frame }), [engine, frame])

  return (
    <TerrainEngineContext.Provider value={value}>
      {engine && <primitive key={engine.group.uuid} object={engine.group} dispose={null} />}
      {children}
    </TerrainEngineContext.Provider>
  )
}

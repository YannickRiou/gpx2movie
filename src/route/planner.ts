/**
 * Reconnaissance: a route not walked yet, drawn by placing points on the relief, routed along the OpenStreetMap ways
 * (`graph.ts`), with heights read from the elevation tiles, and turned into an ordinary track (no times) so that the
 * whole film works on it. The placed points are kept as the waypoints of the track (« Départ », « Étape n »,
 * « Arrivée »): saved with the project, shown as labels, and the starting point of a new draft.
 *
 * The draft (points being placed) lives in `useRouteStore`, outside the settings: not in presets nor in undo.
 */
import { create } from 'zustand'
import type { LonLat, LonLatBounds, Track, TrackPoint, Waypoint } from '../core/types'
import { expandBounds } from '../geo/lonLat'
import { buildTrack, densify } from '../import/stats'
import { MAX_PATHS_SPAN_DEG, fetchPaths, type OsmWay } from '../osm/paths'
import { fetchHeights } from '../terrain/heightAt'
import { POI_PRIORITY } from '../scene/labelModel'
import { setLabelSource } from '../scene/labelSources'
import { getTerrainSource } from '../terrain/sources'
import { RouteError, buildGraph, routeThrough } from './graph'

/** Ways fetched this far around the placed points (metres): room for a detour. */
export const ROUTE_MARGIN_M = 2000
/** Spacing of the points of the computed track (metres). */
export const ROUTE_STEP_M = 20
export const MAX_ROUTE_POINTS = 25

/** Side of the area shown around a place typed in « Préparer une sortie » (metres). */
export const PLAN_AREA_SIZE_M = 12_000

/** The area shown, without any track, around `center`. */
export function planAreaAround(center: LonLat): LonLatBounds {
  return expandBounds({ west: center.lon, east: center.lon, south: center.lat, north: center.lat }, 0, PLAN_AREA_SIZE_M)
}

/** A route computed here: its waypoints go from « Départ » to « Arrivée ». */
export function isRouteTrack(track: Track): boolean {
  const w = track.waypoints
  return !!w && w.length >= 2 && w[0].name === 'Départ' && w[w.length - 1].name === 'Arrivée'
}

/** Name of the i-th of `count` placed points. */
export function routePointName(i: number, count: number): string {
  if (i === 0) return 'Départ'
  return i === count - 1 ? 'Arrivée' : `Étape ${i}`
}

export interface RouteDeps {
  fetchPaths: (b: { west: number; south: number; east: number; north: number }, signal?: AbortSignal) => Promise<OsmWay[]>
  fetchHeights: (points: readonly LonLat[], signal?: AbortSignal) => Promise<(number | undefined)[]>
}

/** The track of the route through `points` (at least two). Throws a `RouteError` with a French message. */
export async function computeRouteTrack(
  points: readonly LonLat[],
  options: { terrainSourceId: string; name?: string; signal?: AbortSignal },
  deps: RouteDeps = {
    fetchPaths,
    fetchHeights: (p, signal) => fetchHeights(p, getTerrainSource(options.terrainSourceId), signal),
  },
): Promise<Track> {
  if (points.length < 2) throw new RouteError('Placez au moins un départ et une arrivée.')
  const lons = points.map((p) => p.lon)
  const lats = points.map((p) => p.lat)
  const box = expandBounds(
    { west: Math.min(...lons), east: Math.max(...lons), south: Math.min(...lats), north: Math.max(...lats) },
    ROUTE_MARGIN_M,
  )
  if (box.east - box.west > MAX_PATHS_SPAN_DEG || box.north - box.south > MAX_PATHS_SPAN_DEG) {
    throw new RouteError('Points trop éloignés : une reconnaissance tient dans une trentaine de kilomètres.')
  }
  const ways = await deps.fetchPaths(box, options.signal)
  if (ways.length === 0) throw new RouteError("Aucun chemin OpenStreetMap autour de ces points.")
  const route = densify(routeThrough(buildGraph(ways), points), ROUTE_STEP_M)
  const heights = await deps.fetchHeights(route, options.signal)
  const trackPoints: TrackPoint[] = route.map((p, i) => (heights[i] === undefined ? { lon: p.lon, lat: p.lat } : { lon: p.lon, lat: p.lat, ele: Math.round(heights[i]! * 10) / 10 }))
  const track = buildTrack({ name: options.name ?? 'Reconnaissance', source: 'gpx', segments: [{ points: trackPoints }] })
  track.waypoints = points.map((p, i): Waypoint => ({ lon: p.lon, lat: p.lat, name: routePointName(i, points.length) }))
  return track
}

export type RouteStatus = 'idle' | 'computing'

interface RouteState {
  /** points being placed, in order */
  points: LonLat[]
  status: RouteStatus
  /** id of the track the draft was started from (recomputing replaces it) */
  trackId: string | null
  add(p: LonLat): void
  remove(index: number): void
  move(index: number, by: -1 | 1): void
  clear(): void
  /** start a new draft from the waypoints of a route track */
  edit(track: Track): void
  setStatus(status: RouteStatus): void
}

export const useRouteStore = create<RouteState>((set) => ({
  points: [],
  status: 'idle',
  trackId: null,
  add: (p) => set((s) => (s.points.length >= MAX_ROUTE_POINTS ? s : { points: [...s.points, { lon: p.lon, lat: p.lat }] })),
  remove: (index) => set((s) => ({ points: s.points.filter((_, i) => i !== index) })),
  move: (index, by) =>
    set((s) => {
      const to = index + by
      if (to < 0 || to >= s.points.length) return s
      const points = s.points.slice()
      ;[points[index], points[to]] = [points[to], points[index]]
      return { points }
    }),
  clear: () => set({ points: [], trackId: null }),
  edit: (track) => set({ points: (track.waypoints ?? []).map((w) => ({ lon: w.lon, lat: w.lat })), trackId: track.id }),
  setStatus: (status) => set({ status }),
}))

// the points being placed, as pins on the relief (above the waypoints of a computed route, which share their place)
useRouteStore.subscribe((state, previous) => {
  if (state.points === previous.points) return
  setLabelSource(
    'route',
    state.points.map((p, i) => ({
      id: `route:${i}`,
      lon: p.lon,
      lat: p.lat,
      text: routePointName(i, state.points.length),
      kind: 'poi' as const,
      priority: POI_PRIORITY + 1,
    })),
  )
})

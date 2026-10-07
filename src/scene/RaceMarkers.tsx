/**
 * RaceMarkers — ghost race (« course fantôme »): one marker on every track but the first, placed by
 * `raceAt(race, progress)` (see `flyover/race.ts`) for the current playback progress, in the track's colour
 * with a thin ink halo. Same constant screen size as the flyover marker, unlit, drawn over the terrain,
 * height = (terrain ?? recorded elevation ?? 0) × exaggeration + LINE_LIFT_M like the lead marker. The camera
 * keeps following the first track (FlyoverRig); mounted after it so the progress of this frame is used.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { SphereGeometry } from 'three'
import type { Group, Mesh, MeshBasicMaterial } from 'three'
import { raceAt } from '../flyover/race'
import { useAppStore } from '../state/store'
import { MARKER_SCREEN_FACTOR } from './FlyoverRig'
import { useTerrainContext } from './TerrainLayer'
import { LINE_LIFT_M } from './TrackLines'
import { useRace } from './useRace'

/** Halo radius relative to the coloured disc. */
export const RACE_HALO_SCALE = 1.35
/** `--color-ink` of the theme. */
export const RACE_HALO_COLOR = '#1C2A33'

export function RaceMarkers() {
  const tracks = useAppStore((s) => s.tracks)
  const enabled = useAppStore((s) => s.settings.race.enabled)
  const race = useRace()
  const { engine, frame } = useTerrainContext()
  const geometry = useMemo(() => new SphereGeometry(1, 24, 16), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  const groupRef = useRef<Group>(null)
  /** marker of tracks[i + 1] */
  const markersRef = useRef<(Group | null)[]>([])

  useFrame(({ camera, gl }) => {
    const group = groupRef.current
    if (!group) return
    group.visible = enabled && race !== null && frame !== null
    if (!group.visible || !race || !frame) return
    const { playback, settings } = useAppStore.getState()
    const markers = markersRef.current
    for (const marker of markers) if (marker) marker.visible = false
    // unlit colours divided by the exposure, as the track lines (see applyExposure)
    const gain = 1 / gl.toneMappingExposure

    for (const racer of raceAt(race, playback.progress)) {
      const marker = racer.index > 0 ? markers[racer.index - 1] : null
      const track = tracks[racer.index]
      if (!marker || !track) continue
      const sampled = engine?.sampleHeight(racer.lon, racer.lat)
      const ground = sampled !== undefined && !Number.isNaN(sampled) ? sampled : (racer.ele ?? 0)
      frame.toLocal(racer.lon, racer.lat, ground * settings.exaggeration + LINE_LIFT_M, marker.position)
      marker.scale.setScalar(Math.max(1, camera.position.distanceTo(marker.position) * MARKER_SCREEN_FACTOR))
      const [halo, core] = (marker.children as Mesh[]).map((mesh) => mesh.material as MeshBasicMaterial)
      halo.color.set(RACE_HALO_COLOR).multiplyScalar(gain)
      core.color.set(track.color).multiplyScalar(gain)
      marker.visible = true
    }
  })

  return (
    <group ref={groupRef} name="race-markers" visible={false}>
      {tracks.slice(1).map((track, i) => (
        <group
          key={track.id}
          name={`race-marker-${track.id}`}
          visible={false}
          ref={(g) => {
            markersRef.current[i] = g
          }}
        >
          {/* halo then disc, both over the terrain, under the lead marker (renderOrder 2) */}
          <mesh geometry={geometry} scale={RACE_HALO_SCALE} renderOrder={1.5}>
            <meshBasicMaterial color={RACE_HALO_COLOR} depthTest={false} depthWrite={false} />
          </mesh>
          <mesh geometry={geometry} renderOrder={1.75}>
            <meshBasicMaterial color={track.color} depthTest={false} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

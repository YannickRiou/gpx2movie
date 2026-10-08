/**
 * RaceMarkers — ghost race (« course fantôme »): one marker on every track but the first, placed by
 * `raceAt(race, progress)` (see `flyover/race.ts`) for the current playback progress. Same kind of marker as the
 * lead (`settings.marker`, see `markerSprite.ts`) in the track's colour with an ink ring; a picture stays the
 * lead's own, so the racers then show their ball. Same constant screen size as the lead marker, unlit, drawn over
 * the terrain, height = (terrain ?? recorded elevation ?? 0) × exaggeration + LINE_LIFT_M like the lead marker.
 * The camera keeps following the first track (FlyoverRig); mounted after it so the progress and the camera of
 * this frame are used.
 */
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, Sprite } from 'three'
import { raceAt } from '../flyover/race'
import { useAppStore } from '../state/store'
import { headsLeft, placeMarker, racerMarkerColors } from './markerSprite'
import { useTerrainContext } from './TerrainLayer'
import { LINE_LIFT_M } from './TrackLines'
import { useRace } from './useRace'

export function RaceMarkers() {
  const tracks = useAppStore((s) => s.tracks)
  const enabled = useAppStore((s) => s.settings.race.enabled)
  const race = useRace()
  const { engine, frame } = useTerrainContext()
  const groupRef = useRef<Group>(null)
  /** marker of tracks[i + 1] */
  const markersRef = useRef<(Sprite | null)[]>([])

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
    const look = { marker: settings.marker, image: null, allowImage: false }

    for (const racer of raceAt(race, playback.progress)) {
      const marker = racer.index > 0 ? markers[racer.index - 1] : null
      const track = tracks[racer.index]
      if (!marker || !track) continue
      const sampled = engine?.sampleHeight(racer.lon, racer.lat)
      const ground = sampled !== undefined && !Number.isNaN(sampled) ? sampled : (racer.ele ?? 0)
      const position = frame.toLocal(racer.lon, racer.lat, ground * settings.exaggeration + LINE_LIFT_M, marker.position)
      const { path } = race.tracks[racer.index]
      const mirrored = settings.marker.kind === 'figurine' && headsLeft(path, racer.distanceM, position, frame, camera)
      placeMarker(marker, position, camera, look, racerMarkerColors(track.color), mirrored, gain)
      marker.visible = true
    }
  })

  return (
    <group ref={groupRef} name="race-markers" visible={false}>
      {tracks.slice(1).map((track, i) => (
        // over the terrain, under the lead marker (renderOrder 2)
        <sprite
          key={track.id}
          name={`race-marker-${track.id}`}
          visible={false}
          renderOrder={1.5}
          ref={(sprite) => {
            markersRef.current[i] = sprite
          }}
        >
          <spriteMaterial depthTest={false} depthWrite={false} />
        </sprite>
      ))}
    </group>
  )
}

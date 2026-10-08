import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { createLocalFrame } from '../geo/ellipsoid'
import { buildTrackPath } from '../flyover/path'
import type { Track } from '../core/types'
import { DEFAULT_MARKER } from './markerSettings'
import { BADGE_SCALE, headsLeft, LEAD_MARKER_COLORS, markerBadge, RACE_HALO_SCALE, racerMarkerColors } from './markerSprite'

const look = (kind: 'boule' | 'figurine' | 'image', allowImage = true) => ({
  marker: { ...DEFAULT_MARKER, kind },
  image: { naturalWidth: 10, naturalHeight: 10, src: 'data:image/png;base64,AA' } as HTMLImageElement,
  allowImage,
})

describe('markerBadge', () => {
  it('keeps the former balls: plain white for the lead, track colour in an ink halo for a racer', () => {
    expect(markerBadge(look('boule'), LEAD_MARKER_COLORS, false)).toMatchObject({ badge: { kind: 'disc', fill: '#FFFFFF' }, diameter: 1 })
    const racer = markerBadge(look('boule'), racerMarkerColors('#5BC0EB'), false)
    expect(racer.diameter).toBe(RACE_HALO_SCALE)
    expect(racer.badge).toMatchObject({ kind: 'disc', fill: '#5BC0EB' })
  })

  it('draws larger badges for a figure or a picture, the racers keeping their ball instead of the picture', () => {
    const figure = markerBadge(look('figurine'), LEAD_MARKER_COLORS, true)
    expect(figure).toMatchObject({ badge: { kind: 'figure', mirrored: true }, diameter: BADGE_SCALE })
    expect(figure.key).not.toBe(markerBadge(look('figurine'), LEAD_MARKER_COLORS, false).key)
    expect(markerBadge(look('image'), LEAD_MARKER_COLORS, false).badge.kind).toBe('image')
    expect(markerBadge(look('image', false), racerMarkerColors('#5BC0EB'), false).badge.kind).toBe('disc')
  })
})

describe('headsLeft', () => {
  const frame = createLocalFrame(6.5, 45.5)
  const track = {
    segments: [{ points: [{ lon: 6.49, lat: 45.5 }, { lon: 6.51, lat: 45.5 }] }],
  } as unknown as Track
  const path = buildTrackPath(track)
  const at = frame.toLocal(6.5, 45.5, 0)

  function cameraLooking(from: Vector3): PerspectiveCamera {
    const camera = new PerspectiveCamera(50, 1, 1, 1e6)
    camera.position.copy(at).add(from)
    camera.lookAt(at)
    return camera
  }

  it('follows the screen direction of the track around the marker', () => {
    const up = frame.toLocal(6.5, 45.5, 1).sub(at)
    const south = frame.toLocal(6.5, 45.49, 0).sub(at)
    // seen from the south, an eastward track runs to the right; from the north, to the left
    const fromSouth = cameraLooking(south.clone().multiplyScalar(0.5).addScaledVector(up, 300))
    const fromNorth = cameraLooking(south.clone().multiplyScalar(-0.5).addScaledVector(up, 300))
    expect(headsLeft(path, path.lengthM / 2, at, frame, fromSouth)).toBe(false)
    expect(headsLeft(path, path.lengthM / 2, at, frame, fromNorth)).toBe(true)
  })
})

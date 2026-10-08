/**
 * Progress markers as camera-facing sprites: the lead marker of FlyoverRig and the ghost racers of RaceMarkers.
 * Each marker is one Sprite showing a badge texture chosen by `settings.marker` (ball, pictogram or picture),
 * with the constant on-screen size of the original ball. A pictogram is mirrored to move the way its track heads
 * on screen, from the track itself around the marker, so every frame of the film gets the same figure whatever
 * frames came before (the export renders any frame on its own).
 */
import { useEffect, useState } from 'react'
import { wakeScene } from './renderOnDemand'
import { CanvasTexture, SRGBColorSpace, Vector3 } from 'three'
import type { Camera, Sprite, SpriteMaterial, Texture } from 'three'
import type { LocalFrame } from '../core/types'
import { samplePath } from '../flyover/path'
import type { TrackPath } from '../flyover/path'
import { BADGE_INK, BADGE_WHITE, drawBadge, loadMarkerImage } from './markerBadge'
import type { Badge } from './markerBadge'
import type { MarkerSettings } from './markerSettings'

/** Ball radius as a fraction of its distance to the camera (constant on-screen size, ~7 px at 1000 px). */
export const MARKER_SCREEN_FACTOR = 0.007
/** Diameter of the pictogram and picture badges relative to the ball: room for a readable figure. */
export const BADGE_SCALE = 2.2
/** Ink halo of the racers' balls relative to their coloured disc. */
export const RACE_HALO_SCALE = 1.35
/** Track length looked at on each side of the marker to tell which way it heads on screen (metres). */
export const HEADING_WINDOW_M = 60
/** Side of the badge textures (pixels): sharp up to a large badge in a 4K film. */
const TEXTURE_PX = 256
/** Textures kept for reuse (pictograms × mirror × colours stay far below). */
const TEXTURE_CACHE_SIZE = 48

/** Colours of one marker: the lead (white ball, ink badge) or a racer (its track colour, ink ring). */
export interface MarkerColors {
  ball: string
  /** halo around the ball, null for none */
  ballRing: string | null
  badgeFill: string
  badgeRing: string
}

export const LEAD_MARKER_COLORS: MarkerColors = { ball: BADGE_WHITE, ballRing: null, badgeFill: BADGE_INK, badgeRing: BADGE_WHITE }

export function racerMarkerColors(trackColor: string): MarkerColors {
  return { ball: trackColor, ballRing: BADGE_INK, badgeFill: trackColor, badgeRing: BADGE_INK }
}

/** What a marker shows: the settings, plus the decoded picture (null while loading or for none). */
export interface MarkerLook {
  marker: MarkerSettings
  image: HTMLImageElement | null
  /** the racers show no picture (it is the lead's): a ball instead */
  allowImage: boolean
}

/** Badge of a marker, its cache key and its diameter in ball diameters. */
export interface MarkerBadge {
  key: string
  badge: Badge
  diameter: number
}

export function markerBadge(look: MarkerLook, colors: MarkerColors, mirrored: boolean): MarkerBadge {
  const { marker, image } = look
  if (marker.kind === 'figurine') {
    const badge: Badge = { kind: 'figure', figure: marker.figure, fill: colors.badgeFill, ring: colors.badgeRing, mirrored }
    return { key: `figure:${marker.figure}:${colors.badgeFill}:${colors.badgeRing}:${mirrored}`, badge, diameter: BADGE_SCALE }
  }
  if (marker.kind === 'image' && look.allowImage && image) {
    const badge: Badge = { kind: 'image', image, width: image.naturalWidth, height: image.naturalHeight, ring: colors.badgeRing }
    return { key: `image:${colors.badgeRing}:${image.src}`, badge, diameter: BADGE_SCALE }
  }
  if (colors.ballRing) {
    const badge: Badge = { kind: 'disc', fill: colors.ball, ring: colors.ballRing, ringWidth: 1 - 1 / RACE_HALO_SCALE }
    return { key: `disc:${colors.ball}:${colors.ballRing}`, badge, diameter: RACE_HALO_SCALE }
  }
  return { key: `disc:${colors.ball}`, badge: { kind: 'disc', fill: colors.ball }, diameter: 1 }
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

const textures = new Map<string, Texture>()

function createBadgeTexture(badge: Badge): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_PX
  canvas.height = TEXTURE_PX
  const ctx = canvas.getContext('2d')
  if (ctx) drawBadge(ctx, TEXTURE_PX, badge)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** Texture of `badge`, drawn once per key; the oldest one is released past TEXTURE_CACHE_SIZE. */
export function badgeTexture({ key, badge }: MarkerBadge): Texture {
  let texture = textures.get(key)
  if (texture) return texture
  texture = createBadgeTexture(badge)
  textures.set(key, texture)
  if (textures.size > TEXTURE_CACHE_SIZE) {
    const [oldestKey, oldest] = textures.entries().next().value as [string, Texture]
    textures.delete(oldestKey)
    oldest.dispose()
  }
  return texture
}

// ---------------------------------------------------------------------------
// Per-frame placement
// ---------------------------------------------------------------------------

const behindLocal = new Vector3()
const aheadLocal = new Vector3()
/**
 * True when the track runs right to left on screen around `distanceM`: the points HEADING_WINDOW_M behind and
 * ahead of the marker, at the marker's height, projected with the camera of this frame.
 */
export function headsLeft(path: TrackPath, distanceM: number, at: Vector3, frame: LocalFrame, camera: Camera): boolean {
  // the rig may have just moved the camera: project with this frame's view, not the last render's
  camera.updateMatrixWorld()
  const { height } = frame.toLonLat(at)
  const behind = samplePath(path, Math.max(0, distanceM - HEADING_WINDOW_M))
  const ahead = samplePath(path, Math.min(path.lengthM, distanceM + HEADING_WINDOW_M))
  frame.toLocal(behind.lon, behind.lat, height, behindLocal).project(camera)
  frame.toLocal(ahead.lon, ahead.lat, height, aheadLocal).project(camera)
  return aheadLocal.x < behindLocal.x
}

/**
 * Put `sprite` at `position` with the badge of `look`, at the constant on-screen size times `marker.size`, its
 * colours divided by the exposure (`gain`) like the track lines.
 */
export function placeMarker(sprite: Sprite, position: Vector3, camera: Camera, look: MarkerLook, colors: MarkerColors, mirrored: boolean, gain: number): void {
  const badge = markerBadge(look, colors, mirrored)
  const material = sprite.material as SpriteMaterial
  const texture = badgeTexture(badge)
  if (material.map !== texture) material.map = texture
  material.color.setScalar(gain)
  const radius = Math.max(1, camera.position.distanceTo(position) * MARKER_SCREEN_FACTOR) * look.marker.size
  sprite.position.copy(position)
  sprite.scale.setScalar(2 * radius * badge.diameter)
}

/** Decoded picture of `settings.marker.image` (null while loading, for none or for an unreadable one). */
export function useMarkerImage(dataUrl: string): HTMLImageElement | null {
  const [loaded, setLoaded] = useState<{ src: string; image: HTMLImageElement } | null>(null)
  useEffect(() => {
    if (!dataUrl) return
    let alive = true
    loadMarkerImage(dataUrl).then(
      (image) => {
        if (!alive) return
        setLoaded({ src: dataUrl, image })
        wakeScene()
      },
      () => alive && setLoaded(null),
    )
    return () => {
      alive = false
    }
  }, [dataUrl])
  return loaded && loaded.src === dataUrl ? loaded.image : null
}

/**
 * Labels — names anchored on the draped relief, drawn inside WebGL so a canvas capture (video export)
 * includes them: tops of the climbs of the first track, GPX waypoints of every track, and every external
 * source registered in `labelSources.ts`.
 *
 * Each label is a Sprite (sizeAttenuation off, so a constant size on screen) whose canvas texture holds an
 * ink panel with white text, a stem and an anchor dot in the accent of its kind. Sprites skip the depth
 * test; instead, every frame, a label fades out when its line of sight passes under the relief or when it
 * is far away, and colliding labels are dropped by priority; they also fade out while an opening or closing
 * card of the film overlay is shown. Opacity is a pure function of the view, the progress, the film time and
 * the overlay settings (no temporal smoothing) so any frame renders the same in isolation.
 *
 * Anchors are draped like the track (terrain height, else the recorded elevation, × exaggeration) and
 * re-draped (debounced) whenever the terrain engine reports new tiles. Must be rendered inside TerrainLayer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { CanvasTexture, Group, type Camera, LinearFilter, SRGBColorSpace, Sprite, SpriteMaterial, Vector3 } from 'three'
import type { LocalFrame, TerrainEngine } from '../core/types'
import { registerDrapeFlush, useExportStore } from '../export/store'
import { climbsOf } from '../flyover/climbs'
import { cardOpacityAt, overlayTime } from '../overlay/draw'
import { useAppStore } from '../state/store'
import {
  LABEL_KIND_ACCENTS,
  LABEL_PANEL_COLOR,
  LABEL_TEXT_COLOR,
  climbLabels,
  distanceFade,
  labelOpacity,
  lineOfSightClearance,
  occlusionFade,
  resolveOverlaps,
  spriteScaleForPixels,
  waypointLabels,
  type LandmarkKind,
  type LandmarkLabel,
  type ScreenRect,
} from './labelModel'
import { externalLabels, useLabelSources } from './labelSources'
import { useFilmClock } from './usePacing'
import { useTerrainContext } from './TerrainLayer'
import {
  REDRAPE_DEBOUNCE_MS,
  REDRAPE_MAX_WAIT_MS,
  buildDrapeBuffer,
  computeDrapedPositions,
  type DrapeBuffer,
  type HeightSampler,
} from './TrackLines'
import { useDebouncedCallback } from './useDebouncedCallback'

/** Label text size and panel geometry (CSS pixels). */
export const LABEL_FONT_PX = 13
const PANEL_H = 24
const PAD_X = 8
const STRIPE_W = 3
const STEM_H = 10
const DOT_R = 4
/** Texture pixels per CSS pixel (sharp on high-density screens). */
const TEXTURE_SCALE = 2
const MAX_CHARS = 40
/** Drawn after the terrain, the track and the flyover marker. */
export const LABEL_RENDER_ORDER = 10
/** Below this opacity a label is not drawn and does not reserve screen space. */
const MIN_OPACITY = 0.02

interface LabelTexture {
  texture: CanvasTexture
  /** CSS pixels */
  width: number
  height: number
  /** sprite.center.y: the anchor dot, as a fraction of the height from the bottom */
  anchorY: number
}

function labelFont(scale: number): string {
  return `600 ${LABEL_FONT_PX * scale}px "IBM Plex Sans", system-ui, sans-serif`
}

/** Canvas texture of one label, or null where 2D canvases are unavailable (jsdom). */
function drawLabelTexture(rawText: string, kind: LandmarkKind): LabelTexture | null {
  const text = rawText.length > MAX_CHARS ? `${rawText.slice(0, MAX_CHARS - 1)}…` : rawText
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const s = TEXTURE_SCALE
  ctx.font = labelFont(s)
  const width = Math.ceil(STRIPE_W + 2 * PAD_X + ctx.measureText(text).width / s)
  const height = PANEL_H + STEM_H + 2 * DOT_R + 2
  canvas.width = width * s
  canvas.height = height * s
  ctx.scale(s, s)
  const accent = LABEL_KIND_ACCENTS[kind]

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(0, 0, width, PANEL_H, 5)
  ctx.clip()
  ctx.fillStyle = LABEL_PANEL_COLOR
  ctx.globalAlpha = 0.9
  ctx.fillRect(0, 0, width, PANEL_H)
  ctx.globalAlpha = 1
  ctx.fillStyle = accent
  ctx.fillRect(0, 0, STRIPE_W, PANEL_H)
  ctx.restore()

  ctx.font = labelFont(1)
  ctx.fillStyle = LABEL_TEXT_COLOR
  ctx.textBaseline = 'middle'
  ctx.fillText(text, STRIPE_W + PAD_X, PANEL_H / 2 + 0.5)

  const cx = width / 2
  const dotY = PANEL_H + STEM_H + 1 + DOT_R
  ctx.strokeStyle = LABEL_PANEL_COLOR
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx, PANEL_H)
  ctx.lineTo(cx, dotY)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(cx, dotY, DOT_R, 0, Math.PI * 2)
  ctx.fillStyle = accent
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.stroke()

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  return { texture, width, height, anchorY: (DOT_R + 1) / height }
}

interface LabelEntry {
  label: LandmarkLabel
  sprite: Sprite
  material: SpriteMaterial
  tex: LabelTexture
}

interface LabelSet {
  entries: LabelEntry[]
  buffer: DrapeBuffer
  positions: Float32Array
}

function disposeLabelSet(set: LabelSet | null): void {
  if (!set) return
  for (const entry of set.entries) {
    entry.sprite.removeFromParent()
    entry.material.dispose()
  }
}

function drapeLabelSet(set: LabelSet, engine: TerrainEngine | null, exaggeration: number): void {
  const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
  computeDrapedPositions(set.buffer, sampler, exaggeration, set.positions)
  set.entries.forEach((entry, i) => entry.sprite.position.fromArray(set.positions, i * 3))
}

const cameraPosition = new Vector3()
const projected = new Vector3()
const probe = new Vector3()

/**
 * Per-frame visibility: distance and occlusion fades, screen culling, de-cluttering by priority, fade under the
 * overlay cards (`cardOpacity`), constant screen size (times `renderScale`, > 1 for a video larger than the
 * preview), and colour divided by the renderer exposure (unlit sprites, like the track).
 */
function updateLabelSet(
  set: LabelSet,
  camera: Camera,
  size: { width: number; height: number },
  exposure: number,
  engine: TerrainEngine | null,
  frame: LocalFrame | null,
  exaggeration: number,
  cardOpacity: number,
  renderScale = 1,
): void {
  if (labelOpacity(1, cardOpacity) < MIN_OPACITY) {
    for (const entry of set.entries) entry.sprite.visible = false
    return
  }
  camera.getWorldPosition(cameraPosition)
  const pixel = spriteScaleForPixels(1, size.height, camera.projectionMatrix.elements[5]) * renderScale
  const clearanceAt =
    engine && frame
      ? (x: number, y: number, z: number) => {
          const p = frame.toLonLat(probe.set(x, y, z))
          const ground = engine.sampleHeight(p.lon, p.lat)
          return ground === undefined ? undefined : p.height - ground * exaggeration
        }
      : null

  const candidates: { rect: ScreenRect; priority: number }[] = []
  const shown: { entry: LabelEntry; opacity: number }[] = []
  for (const entry of set.entries) {
    const { sprite, tex } = entry
    sprite.visible = false
    let opacity = distanceFade(cameraPosition.distanceTo(sprite.position))
    if (opacity < MIN_OPACITY) continue
    projected.copy(sprite.position).project(camera)
    if (projected.z > 1 || Math.abs(projected.x) > 1.2 || Math.abs(projected.y) > 1.2) continue
    if (clearanceAt) opacity *= occlusionFade(lineOfSightClearance(cameraPosition, sprite.position, clearanceAt))
    if (opacity < MIN_OPACITY) continue
    const x = ((projected.x + 1) / 2) * size.width
    const y = ((1 - projected.y) / 2) * size.height
    const w = tex.width * renderScale
    const h = tex.height * renderScale
    const below = h * tex.anchorY
    candidates.push({
      rect: { left: x - w / 2, right: x + w / 2, top: y - h + below, bottom: y + below },
      priority: entry.label.priority,
    })
    shown.push({ entry, opacity })
  }
  const visible = resolveOverlaps(candidates)
  shown.forEach(({ entry, opacity }, i) => {
    if (!visible[i]) return
    entry.sprite.visible = true
    entry.sprite.scale.set(entry.tex.width * pixel, entry.tex.height * pixel, 1)
    entry.material.opacity = labelOpacity(opacity, cardOpacity)
    entry.material.color.setScalar(1 / exposure)
  })
}

export function Labels() {
  const tracks = useAppStore((s) => s.tracks)
  const show = useAppStore((s) => s.settings.labels)
  const exaggeration = useAppStore((s) => s.settings.exaggeration)
  const sources = useLabelSources((s) => s.sources)
  const { engine, frame } = useTerrainContext()

  const groupRef = useRef<Group>(null)
  const setRef = useRef<LabelSet | null>(null)
  const texturesRef = useRef(new Map<string, LabelTexture>())
  const [fontVersion, setFontVersion] = useState(0)
  const texturesFontRef = useRef(0)

  const labels = useMemo(() => {
    const out: LandmarkLabel[] = []
    const first = tracks[0]
    if (show.climbs && first) out.push(...climbLabels(first, climbsOf(first)))
    if (show.waypoints) out.push(...waypointLabels(tracks))
    out.push(...externalLabels(sources))
    return out
  }, [tracks, show, sources])

  // Redraw the textures once the web font is available (the first ones may use the fallback font).
  useEffect(() => {
    let alive = true
    document.fonts
      ?.load(labelFont(1))
      .then(() => {
        if (alive) setFontVersion((v) => v + 1)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const drape = useCallback(
    (current: TerrainEngine | null, factor: number) => {
      if (setRef.current) drapeLabelSet(setRef.current, current, factor)
    },
    [],
  )

  // Build the sprites (textures are cached by kind and text, redrawn when the web font arrives), then drape them.
  useEffect(() => {
    const group = groupRef.current
    if (!group) return
    disposeLabelSet(setRef.current)
    setRef.current = null
    const textures = texturesRef.current
    if (texturesFontRef.current !== fontVersion) {
      for (const tex of textures.values()) tex.texture.dispose()
      textures.clear()
      texturesFontRef.current = fontVersion
    }
    const used = new Set<string>()
    const entries: LabelEntry[] = []
    if (frame) {
      for (const label of labels) {
        const key = `${label.kind}\n${label.text}`
        let tex = textures.get(key)
        if (!tex) {
          tex = drawLabelTexture(label.text, label.kind) ?? undefined
          if (!tex) continue
          textures.set(key, tex)
        }
        used.add(key)
        const material = new SpriteMaterial({
          map: tex.texture,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          sizeAttenuation: false,
        })
        const sprite = new Sprite(material)
        sprite.name = `label:${label.id}`
        sprite.center.set(0.5, tex.anchorY)
        sprite.renderOrder = LABEL_RENDER_ORDER
        sprite.visible = false
        group.add(sprite)
        entries.push({ label, sprite, material, tex })
      }
    }
    for (const [key, tex] of textures) {
      if (used.has(key)) continue
      tex.texture.dispose()
      textures.delete(key)
    }
    if (!frame || entries.length === 0) return
    const buffer = buildDrapeBuffer(entries.map((e) => e.label), frame)
    setRef.current = { entries, buffer, positions: new Float32Array(buffer.count * 3) }
    drape(engine, exaggeration)
  }, [labels, frame, engine, exaggeration, fontVersion, drape])

  const redrape = useDebouncedCallback(drape, REDRAPE_DEBOUNCE_MS, REDRAPE_MAX_WAIT_MS)
  // the video export runs the pending re-drape right away instead of waiting for the debounce
  useEffect(
    () =>
      registerDrapeFlush(() => {
        const pending = redrape.isPending()
        redrape.flush()
        return pending
      }),
    [redrape],
  )
  useEffect(() => {
    if (!engine) return
    const unsubscribe = engine.onChange(() => redrape(engine, exaggeration))
    return () => {
      unsubscribe()
      redrape.cancel()
    }
  }, [engine, exaggeration, redrape])

  useEffect(
    () => () => {
      disposeLabelSet(setRef.current)
      setRef.current = null
      for (const tex of texturesRef.current.values()) tex.texture.dispose()
      texturesRef.current.clear()
    },
    [],
  )

  // the overlay cards are timed in film time
  const clock = useFilmClock()
  const clockRef = useRef(clock)
  useEffect(() => {
    clockRef.current = clock
  })

  useFrame(({ camera, gl, size }) => {
    if (!setRef.current) return
    const { playback, settings } = useAppStore.getState()
    const card = cardOpacityAt(overlayTime(clockRef.current, playback.progress, playback.timeS), settings.overlay)
    const { renderScale } = useExportStore.getState()
    updateLabelSet(setRef.current, camera, size, gl.toneMappingExposure, engine, frame, exaggeration, card, renderScale)
  })

  return <group ref={groupRef} name="labels" />
}

/**
 * RegionHighlight — the administrative region of the outing (osm/region.ts) seen from the region view of a
 * 'situation' shot that highlights it, inside TerrainLayer: outside darkened, glowing light border, name in the
 * middle of the region, an orange dot at the outing.
 *
 * The region is asked for (`syncRegion`, Overpass queue and cache) only while such a shot is in the film. No region
 * (none found, offline, failed query): nothing is drawn and the shot frames the track as before.
 *
 * Geometry built once per region (scene/regionMesh.ts); its border points, the dot and the name are draped like the
 * track and re-draped (debounced, flushed by the video export) when tiles arrive, the corners of the darkened box lie
 * far beyond the frame. Everything skips the depth test and is drawn after the terrain and the track line, in this
 * order: the darkened outside (one mesh), the glow and the line of the border (two LineSegments2 on one geometry), the
 * dot and the name (sprites of a constant screen size). Unlit colours divided by the exposure, like the track.
 * Opacity is a pure function of the film time (`regionHighlightOpacity`): whole at the top of the shot, gone during
 * the dive, so the preview and the export draw the same frames. Hidden on the poster's overview still.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type InterleavedBufferAttribute,
} from 'three'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import type { TerrainEngine } from '../core/types'
import { isExportBusy, registerDrapeFlush, useExportStore } from '../export/store'
import { highlightsRegion } from '../film/model'
import { REGION_AREA_MARGIN_M, regionHighlightOpacity } from '../flyover/filmCamera'
import { centroid } from '../geo/lonLat'
import { syncRegion, useRegionStore } from '../osm/region'
import { useAppStore } from '../state/store'
import { LABEL_KIND_ACCENTS, LABEL_PANEL_COLOR, spriteScaleForPixels } from './labelModel'
import { buildRegionMesh, ringSegments } from './regionMesh'
import { wakeScene } from './renderOnDemand'
import { useTerrainContext } from './TerrainLayer'
import { REDRAPE_DEBOUNCE_MS, REDRAPE_MAX_WAIT_MS, buildDrapeBuffer, computeDrapedPositions } from './TrackLines'
import { createGlowMaterial } from './trackLineStyle'
import { useDebouncedCallback } from './useDebouncedCallback'
import { useFilmClock } from './usePacing'

/** Ink over the outside of the region, at this opacity. */
const DARK = new Color(LABEL_PANEL_COLOR)
const DARK_OPACITY = 0.55
const BORDER_PX = 2
const BORDER_GLOW_PX = 16
/** Diameter of the outing's dot and size of the name (CSS pixels, × the export render scale). */
const DOT_PX = 16
const DOT_COLOR = LABEL_KIND_ACCENTS.climb
const NAME_FONT_PX = 28
const NAME_PAD_PX = 12
/** Texture pixels per CSS pixel. */
const TEXTURE_SCALE = 2
/** After the terrain and the track line, under its hidden-part pass (1), the flyover marker (2) and the labels. */
const RENDER_ORDER = 0.5
const MIN_OPACITY = 0.002

const nameFont = (scale: number) => `600 ${NAME_FONT_PX * scale}px "IBM Plex Sans", system-ui, sans-serif`

function canvasTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  return texture
}

/** The orange dot with a white ring; null where 2D canvases are unavailable (jsdom). */
function drawDotTexture(): CanvasTexture | null {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = DOT_PX * TEXTURE_SCALE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const c = canvas.width / 2
  ctx.beginPath()
  ctx.arc(c, c, c - TEXTURE_SCALE * 2, 0, Math.PI * 2)
  ctx.fillStyle = DOT_COLOR
  ctx.fill()
  ctx.lineWidth = TEXTURE_SCALE * 2.5
  ctx.strokeStyle = '#FFFFFF'
  ctx.stroke()
  return canvasTexture(canvas)
}

/** The name, white with a dark halo; null where 2D canvases are unavailable. */
function drawNameTexture(text: string): { texture: CanvasTexture; width: number; height: number } | null {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.font = nameFont(TEXTURE_SCALE)
  const width = Math.ceil(ctx.measureText(text).width / TEXTURE_SCALE + 2 * NAME_PAD_PX)
  const height = NAME_FONT_PX + 2 * NAME_PAD_PX
  canvas.width = width * TEXTURE_SCALE
  canvas.height = height * TEXTURE_SCALE
  ctx.scale(TEXTURE_SCALE, TEXTURE_SCALE)
  ctx.font = nameFont(1)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = LABEL_PANEL_COLOR
  ctx.shadowBlur = 8
  ctx.fillStyle = '#FFFFFF'
  ctx.fillText(text, width / 2, height / 2)
  return { texture: canvasTexture(canvas), width, height }
}

export function RegionHighlight() {
  const track = useAppStore((s) => s.tracks[0])
  const wanted = useAppStore((s) => highlightsRegion(s.settings.film))
  const exaggeration = useAppStore((s) => s.settings.exaggeration)
  const region = useRegionStore((s) => s.region)
  const { engine, frame } = useTerrainContext()
  const clock = useFilmClock()
  const clockRef = useRef(clock)
  useEffect(() => {
    clockRef.current = clock
  })

  // one region per track box, only while a shot highlights it (syncRegion is idempotent); forgotten on unmount
  useEffect(() => syncRegion(track?.bounds ?? null, wanted), [track, wanted])
  useEffect(() => () => syncRegion(null, false), [])

  const parts = useMemo(() => {
    const dark = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({ color: DARK, transparent: true, depthTest: false, depthWrite: false }),
    )
    const glowMaterial = createGlowMaterial(new Color('#FFFFFF'), 1, 1)
    glowMaterial.depthTest = false
    const lineMaterial = new LineMaterial({ worldUnits: false, transparent: true, depthTest: false, depthWrite: false })
    const glow = new LineSegments2(new LineSegmentsGeometry(), glowMaterial)
    const line = new LineSegments2(glow.geometry, lineMaterial)
    const dotTexture = drawDotTexture()
    const sprite = (map: CanvasTexture | null) =>
      new Sprite(new SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }))
    const dot = sprite(dotTexture)
    const name = sprite(null)
    const group = new Group()
    group.name = 'region-highlight'
    group.visible = false
    ;[dark, glow, line, dot, name].forEach((object, i) => {
      object.renderOrder = RENDER_ORDER + i / 100
      object.frustumCulled = false
      object.raycast = () => {}
      group.add(object)
    })
    return { group, dark, glow, line, dot, name, dotTexture }
  }, [])
  useEffect(
    () => () => {
      const { dark, glow, line, dot, name, dotTexture } = parts
      dark.geometry.dispose()
      dark.material.dispose()
      glow.geometry.dispose()
      glow.material.dispose()
      line.material.dispose()
      dot.material.dispose()
      name.material.dispose()
      dotTexture?.dispose()
    },
    [parts],
  )

  // the name, redrawn once the web font is there
  const [fontVersion, setFontVersion] = useState(0)
  useEffect(() => {
    let alive = true
    document.fonts
      ?.load(nameFont(1))
      .then(() => alive && setFontVersion((v) => v + 1))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  const nameText = region?.name ?? ''
  /** CSS size of the name's texture, null without one */
  const nameSizeRef = useRef<{ width: number; height: number } | null>(null)
  useEffect(() => {
    const drawn = nameText ? drawNameTexture(nameText) : null
    nameSizeRef.current = drawn
    parts.name.material.map = drawn?.texture ?? null
    parts.name.material.needsUpdate = true
    wakeScene()
    return () => drawn?.texture.dispose()
  }, [parts, nameText, fontVersion])

  // geometry of the region: its vertices, then the dot and the name, draped together
  const built = useMemo(() => {
    if (!region || !frame || !track) return null
    const outing = centroid(track.bounds)
    const mesh = buildRegionMesh(region, outing, REGION_AREA_MARGIN_M)
    const count = mesh.lonLat.length / 2
    const points = Array.from({ length: count }, (_, i) => ({ lon: mesh.lonLat[2 * i], lat: mesh.lonLat[2 * i + 1] }))
    const buffer = buildDrapeBuffer([...points, outing, mesh.labelAt], frame)
    const positions = new Float32Array(buffer.count * 3)
    const darkGeometry = new BufferGeometry()
    darkGeometry.setAttribute('position', new BufferAttribute(positions.subarray(0, count * 3), 3))
    darkGeometry.setIndex(new BufferAttribute(mesh.index, 1))
    const lineGeometry = new LineSegmentsGeometry().setPositions(ringSegments(positions, mesh.ringStarts))
    return { mesh, count, buffer, positions, darkGeometry, lineGeometry }
  }, [region, frame, track])
  useEffect(() => {
    if (!built) return
    const { dark, glow, line } = parts
    const previous = [dark.geometry, glow.geometry]
    dark.geometry = built.darkGeometry
    glow.geometry = line.geometry = built.lineGeometry
    for (const geometry of previous) geometry.dispose()
    return () => {
      built.darkGeometry.dispose()
      built.lineGeometry.dispose()
    }
  }, [parts, built])

  const drape = useCallback(
    (current: TerrainEngine | null, factor: number) => {
      if (!built) return
      const sampler = current ? (lon: number, lat: number) => current.sampleHeight(lon, lat) : null
      computeDrapedPositions(built.buffer, sampler, factor, built.positions)
      built.darkGeometry.getAttribute('position').needsUpdate = true
      const segments = built.lineGeometry.getAttribute('instanceStart') as InterleavedBufferAttribute
      ringSegments(built.positions, built.mesh.ringStarts, segments.data.array as Float32Array)
      segments.data.needsUpdate = true
      parts.dot.position.fromArray(built.positions, built.count * 3)
      parts.name.position.fromArray(built.positions, (built.count + 1) * 3)
      wakeScene()
    },
    [parts, built],
  )
  useEffect(() => drape(engine, exaggeration), [drape, engine, exaggeration])

  const redrape = useDebouncedCallback(drape, REDRAPE_DEBOUNCE_MS, REDRAPE_MAX_WAIT_MS)
  useEffect(() => {
    if (!engine) return
    const unsubscribe = engine.onChange(() => redrape(engine, exaggeration))
    return () => {
      unsubscribe()
      redrape.cancel()
    }
  }, [engine, exaggeration, redrape])
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

  useFrame(({ camera, gl, size }) => {
    const { group, dark, glow, line, dot, name } = parts
    const { playback } = useAppStore.getState()
    const { phase, request, renderScale } = useExportStore.getState()
    const c = clockRef.current
    const poster = isExportBusy(phase) && request?.still?.overview === true
    const opacity = built && !poster ? regionHighlightOpacity(c, playback.timeS ?? c.timeAtProgress(playback.progress)) : 0
    group.visible = opacity > MIN_OPACITY
    if (!group.visible) return
    const gain = 1 / gl.toneMappingExposure
    dark.material.color.copy(DARK).multiplyScalar(gain)
    dark.material.opacity = DARK_OPACITY * opacity
    // the glow is blended by its maximum: faded through its colour
    glow.material.color.setScalar(gain * opacity)
    glow.material.linewidth = BORDER_GLOW_PX * renderScale
    line.material.color.setScalar(gain)
    line.material.opacity = opacity
    line.material.linewidth = BORDER_PX * renderScale
    const pixel = spriteScaleForPixels(1, size.height, camera.projectionMatrix.elements[5]) * renderScale
    dot.scale.set(DOT_PX * pixel, DOT_PX * pixel, 1)
    dot.material.color.setScalar(gain)
    dot.material.opacity = opacity
    const nameSize = nameSizeRef.current
    name.visible = nameSize !== null
    if (nameSize) name.scale.set(nameSize.width * pixel, nameSize.height * pixel, 1)
    name.material.color.setScalar(gain)
    name.material.opacity = opacity
  })

  return <primitive object={parts.group} dispose={null} />
}

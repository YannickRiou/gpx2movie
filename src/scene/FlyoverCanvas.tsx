/**
 * FlyoverCanvas — the React Three Fiber root of the viewer.
 *
 * With the atmosphere setting on (default), AtmosphereLayer draws the sky, lights the terrain from the
 * real sun position and tone-maps the frame. Without it, the canvas is transparent (alpha) over a CSS sky
 * gradient (glacier blue at the top, map paper at the horizon) and lit by a fixed hemisphere + a sun from
 * the south-east. With no track loaded the scene is left empty; otherwise the terrain layer provides the
 * engine to the track lines, the camera rigs and the atmosphere. `TrackPicker` makes the first track clickable (playhead,
 * right-click menu drawn by `TrackMenu` over the canvas). Frames are drawn on demand only (`renderOnDemand.ts`).
 *
 * Shadow maps are enabled (PCF) but only the atmosphere's sun casts them (terrainShadow.ts); the fixed lights do not.
 *
 * Without the atmosphere, tone mapping is disabled (`flat`): orthophotos are display-referred images already, a filmic curve
 * would only remap their colours. The light intensities are chosen so the lit terrain stays close to the
 * texture brightness: three.js shades a Lambert surface as albedo x irradiance / pi, so a flat tile facing
 * the sky receives (hemisphere + sun x sin(sun elevation)) / pi = (1.2 + 2.0 x 0.79) / pi = 0.88 of its
 * albedo and a slope facing the sun peaks just under 1.0 (nothing clips).
 *
 * The colour grading (`settings.grading`) closes the post-processing of the atmosphere; without it, `GradingComposer`
 * grades the image over the same sky gradient, only while the grading is not « Naturel » or an « Objectif » effect is on
 * (scene/GradingComposer.tsx).
 */
import { Suspense, lazy, useEffect, useMemo, type CSSProperties } from 'react'
import { Canvas } from '@react-three/fiber'
import { useAppStore } from '../state/store'
import { ExportController } from '../export/ExportController'
import { CAMERA_FOV_DEG } from '../flyover/filmCamera'
import { createOverlayDrawer } from '../overlay/exportOverlay'
import { CameraRig } from './CameraRig'
import { FlyoverRig } from './FlyoverRig'
import { isIdentityGrading } from './grading'
import { lensActive } from './lens'
import { Labels } from './Labels'
import { RaceMarkers } from './RaceMarkers'
import { RegionHighlight } from './RegionHighlight'
import { useRenderOnDemand } from './renderOnDemand'
import { TerrainLayer } from './TerrainLayer'
import { TrackLines } from './TrackLines'
import { WaterLayer } from './WaterLayer'
import { TrackMenu, TrackPicker } from './TrackPicker'

// sky, clouds, post-processing and the geoid grid (~550 KB): loaded with the first track, not at startup
const AtmosphereLayer = lazy(() => import('./AtmosphereLayer').then((m) => ({ default: m.AtmosphereLayer })))
// post-processing without the atmosphere: only once a colour grading other than « Naturel » or a lens effect is chosen
const GradingComposer = lazy(() => import('./GradingComposer').then((m) => ({ default: m.GradingComposer })))

export const SKY_TOP_COLOR = '#A9CCD9'
export const SKY_HORIZON_COLOR = '#F5F2EA'

const HEMISPHERE_SKY = '#ffffff'
const HEMISPHERE_GROUND = '#6b7a8f'
export const HEMISPHERE_INTENSITY = 1.2
/** Sun direction: south-east (+X east, +Z south), ~52° above the horizon; far enough to behave as a directional light. */
export const SUN_POSITION: readonly [number, number, number] = [0.6e5, 1e5, 0.5e5]
export const SUN_INTENSITY = 2.0

/** Camera spot before the first fit (the rig snaps to the tracks as soon as they exist). */
const CAMERA = { fov: CAMERA_FOV_DEG, near: 1, far: 5e6, position: [0, 2000, 3000] as [number, number, number] }
/** `high-performance`: on a machine with two GPUs (laptops), ask for the discrete one for the scene and the export. */
const GL = { antialias: true, logarithmicDepthBuffer: true, alpha: true, powerPreference: 'high-performance' as const }

const wrapperStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  background: `linear-gradient(180deg, ${SKY_TOP_COLOR} 0%, ${SKY_HORIZON_COLOR} 100%)`,
}

const canvasStyle: CSSProperties = { position: 'absolute', inset: 0 }

export interface FlyoverCanvasProps {
  className?: string
  style?: CSSProperties
}

/** Frames only while something moves (see renderOnDemand.ts). */
function RenderOnDemand() {
  useRenderOnDemand()
  return null
}

export function FlyoverCanvas({ className, style }: FlyoverCanvasProps) {
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  const atmosphere = useAppStore((s) => s.settings.atmosphere)
  const postProcessed = useAppStore((s) => !isIdentityGrading(s.settings.grading) || lensActive(s.settings.lens, false))
  // the video export draws the film overlay through the same code as the preview
  const overlayDrawer = useMemo(createOverlayDrawer, [])
  useEffect(() => () => overlayDrawer.dispose(), [overlayDrawer])

  return (
    <div className={className} style={style ? { ...wrapperStyle, ...style } : wrapperStyle}>
      <Canvas gl={GL} camera={CAMERA} dpr={[1, 2]} frameloop="demand" flat shadows="percentage" style={canvasStyle}>
        {!atmosphere && (
          <>
            <hemisphereLight color={HEMISPHERE_SKY} groundColor={HEMISPHERE_GROUND} intensity={HEMISPHERE_INTENSITY} />
            <directionalLight position={SUN_POSITION} intensity={SUN_INTENSITY} />
          </>
        )}
        {hasTracks && (
          <TerrainLayer>
            <RenderOnDemand />
            <TrackLines />
            <WaterLayer />
            <RegionHighlight />
            <FlyoverRig />
            <RaceMarkers />
            <CameraRig />
            <Labels />
            <TrackPicker />
            {atmosphere && (
              // its own boundary: the rest of the scene is drawn while it loads
              <Suspense fallback={null}>
                <AtmosphereLayer />
              </Suspense>
            )}
            {!atmosphere && postProcessed && (
              <Suspense fallback={null}>
                <GradingComposer skyTop={SKY_TOP_COLOR} skyHorizon={SKY_HORIZON_COLOR} />
              </Suspense>
            )}
            <ExportController drawOverlay={overlayDrawer.draw} />
          </TerrainLayer>
        )}
      </Canvas>
      {hasTracks && <TrackMenu />}
    </div>
  )
}

/** « Objectif » effects of a composer, with or without the atmosphere (ARCHITECTURE.md, « Objectif »). */
import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { disposePassWithoutEffects } from '@react-three/postprocessing'
import { BloomEffect, DepthOfFieldEffect, EffectPass, type Effect } from 'postprocessing'
import { Matrix4, PerspectiveCamera, Vector2, Vector3, type Object3D } from 'three'
import type { AtmosphereApi } from '@takram/three-atmosphere/r3f'
import { smoothedTrackPath } from '../flyover/smooth'
import { useAppStore } from '../state/store'
import { filmViewAt } from './filmView'
import { FlareEffect } from './flareEffect'
import { BLOOM_SMOOTHING, BLOOM_THRESHOLD, bloomParams, depthOfFieldParams, radialBlurLength } from './lens'
import { ShutterEffect } from './shutterEffect'
import { useTerrainContext } from './TerrainLayer'
import { useFilmClock } from './usePacing'

/** After the sun (-1) and the camera and marker (0), before the composer (1). */
const LENS_PRIORITY = 0.75
/** Frame height of the bokeh scale (pixels): the blur keeps its share of the frame at any size. */
const REFERENCE_HEIGHT_PX = 1080
/** Angular radius of the sun disc of the atmosphere (radians, Takram's default). */
const SUN_ANGULAR_RADIUS = 0.004675
/** Margin (fraction of the frame height) over which the flare fades as the sun leaves the frame. */
const FLARE_EDGE = 0.05
/** Focus distance when no marker is shown (metres). */
const DEFAULT_FOCUS_M = 1000
/** The radial blur centres on the direction of travel while it stays this far inside the frame (uv). */
const TRAVEL_MARGIN = 0.15
/**
 * A camera this far from the film's placement (fraction of the aim distance) was moved by hand: no radial blur. The
 * rig's camera itself drifts by metres from a placement recomputed later (ground lift, finer tiles).
 */
const HAND_MOVED = 0.05

const _inverse = new Matrix4()
const _sun = new Vector3()
const _forward = new Vector3()
const _point = new Vector3()
const _marker = new Vector3()
const _uv = new Vector2()
const _size = new Vector2()
const _travel = new Vector3()

export interface LensEffects {
  /** merged after the SMAA, before the grading */
  effects: Effect[]
  /** last pass of the composer, so it averages the finished image */
  shutter: EffectPass | null
}

export function useLensEffects(atmosphere?: RefObject<AtmosphereApi | null>): LensEffects {
  const camera = useThree((s) => s.camera)
  const { engine, frame } = useTerrainContext()
  const clock = useFilmClock()
  const track = useAppStore((s) => s.tracks[0])
  const smoothingM = useAppStore((s) => s.settings.trackStyle.smoothingM)
  const path = useMemo(() => (track ? smoothedTrackPath(track, smoothingM) : null), [track, smoothingM])
  const bloomOn = useAppStore((s) => s.settings.lens.bloom > 0)
  const depthOn = useAppStore((s) => s.settings.lens.depthOfField > 0)
  const flareOn = useAppStore((s) => atmosphere !== undefined && s.settings.lens.flare > 0)
  const shutterOn = useAppStore((s) => s.settings.lens.shutter > 0)

  const bloom = useMemo(
    () => (bloomOn ? new BloomEffect({ mipmapBlur: true, luminanceThreshold: BLOOM_THRESHOLD, luminanceSmoothing: BLOOM_SMOOTHING }) : null),
    [bloomOn],
  )
  const depth = useMemo(() => (depthOn ? new DepthOfFieldEffect(camera) : null), [depthOn, camera])
  const flare = useMemo(() => (flareOn ? new FlareEffect() : null), [flareOn])
  const shutterEffect = useMemo(() => (shutterOn ? new ShutterEffect() : null), [shutterOn])
  const shutter = useMemo(() => (shutterEffect ? new EffectPass(camera, shutterEffect) : null), [camera, shutterEffect])
  useEffect(() => () => bloom?.dispose(), [bloom])
  useEffect(() => () => depth?.dispose(), [depth])
  useEffect(() => () => flare?.dispose(), [flare])
  useEffect(() => () => shutterEffect?.dispose(), [shutterEffect])
  // the effect is owned above: dispose only the pass
  useEffect(() => () => void (shutter && disposePassWithoutEffects(shutter)), [shutter])
  const effects = useMemo(() => [depth, bloom, flare].filter((e): e is DepthOfFieldEffect | BloomEffect | FlareEffect => e !== null), [depth, bloom, flare])

  const markerRef = useRef<Object3D | null>(null)

  // priority 0 while nothing is on: a positive one would take the rendering over from R3F
  useFrame(
    ({ camera, scene, gl, controls, size }) => {
      const { settings, playback } = useAppStore.getState()
      const lens = settings.lens
      const pixelScale = gl.getDrawingBufferSize(_size).y / REFERENCE_HEIGHT_PX
      if (bloom) {
        const params = bloomParams(lens.bloom, lens.bloomRadius)
        bloom.intensity = params.intensity
        bloom.mipmapBlurPass.radius = params.radius
      }
      if (depth) {
        if (!markerRef.current?.parent) markerRef.current = scene.getObjectByName('flyover-marker') ?? null
        const marker = markerRef.current
        const target = (controls as unknown as { target?: Vector3 } | null)?.target
        const focus = marker?.visible
          ? camera.position.distanceTo(marker.getWorldPosition(_marker))
          : target
            ? camera.position.distanceTo(target)
            : DEFAULT_FOCUS_M
        const params = depthOfFieldParams(lens.depthOfField, focus)
        depth.cocMaterial.focusDistance = focus
        depth.cocMaterial.focusRange = params.focusRange
        depth.bokehScale = params.bokehScale * pixelScale
      }
      const api = atmosphere?.current
      if (flare && api && camera instanceof PerspectiveCamera) {
        _sun.copy(api.sunDirection).transformDirection(_inverse.copy(api.worldToECEFMatrix).invert())
        camera.updateMatrixWorld()
        const facing = _sun.dot(camera.getWorldDirection(_forward)) > 0
        _point.copy(camera.position).addScaledVector(_sun, 1e4).project(camera)
        _uv.set(_point.x * 0.5 + 0.5, _point.y * 0.5 + 0.5)
        const edge = Math.min(_uv.x * camera.aspect, (1 - _uv.x) * camera.aspect, _uv.y, 1 - _uv.y)
        const fade = facing ? Math.min(1, Math.max(0, edge / FLARE_EDGE)) : 0
        const radius = Math.tan(SUN_ANGULAR_RADIUS) / Math.tan((camera.fov * Math.PI) / 360) / 2
        flare.setSun(_uv, radius, camera.aspect, lens.flare * fade)
      }
      if (shutterEffect) {
        shutterEffect.playing = playback.playing
        shutterEffect.shutter = lens.shutter
        shutterEffect.fps = settings.video.fps
        shutterEffect.radialLength = 0
        if (path && path.count > 0 && frame && camera instanceof PerspectiveCamera) {
          // radial speed blur from the film's camera one video frame earlier: the same in the preview and the export
          const aspect = size.height > 0 ? size.width / size.height : 1
          const timeS = playback.timeS ?? clock.timeAtProgress(playback.progress)
          const intervalS = 1 / settings.video.fps
          const now = filmViewAt(path, clock, playback.progress, timeS, frame, engine, aspect)
          const earlierS = Math.max(0, timeS - intervalS)
          const before = filmViewAt(path, clock, clock.progressAtTime(earlierS), earlierS, frame, engine, aspect)
          const aimM = now.position.distanceTo(now.target)
          if (camera.position.distanceTo(now.position) <= HAND_MOVED * aimM) {
            const moved = now.position.distanceTo(before.position)
            shutterEffect.radialLength = radialBlurLength(lens.shutter, moved, aimM, intervalS)
            _travel.subVectors(now.position, before.position).normalize()
            camera.updateMatrixWorld()
            _point.copy(camera.position).addScaledVector(_travel, 1e4).project(camera)
            const ahead = _travel.dot(camera.getWorldDirection(_forward)) > 0
            const inside = Math.max(Math.abs(_point.x), Math.abs(_point.y)) * 0.5 <= 0.5 - TRAVEL_MARGIN
            shutterEffect.radialCentre.set(ahead && inside ? _point.x * 0.5 + 0.5 : 0.5, ahead && inside ? _point.y * 0.5 + 0.5 : 0.5)
          }
        }
      }
    },
    effects.length > 0 || shutter ? LENS_PRIORITY : 0,
  )

  return useMemo(() => ({ effects, shutter }), [effects, shutter])
}

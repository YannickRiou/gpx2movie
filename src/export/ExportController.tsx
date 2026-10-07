/**
 * ExportController — renders the film offline, frame by frame, when the export store receives a request.
 * Mounted inside the R3F canvas, inside TerrainLayer (it needs the terrain engine).
 *
 * For the duration of an export: playback paused, frameloop 'never' (frames are drawn by `advance` only),
 * renderer and camera at the video size with a pixel ratio of 1 (the canvas is shown letterboxed meanwhile),
 * pointer events off, render scale of the pixel-sized scene elements set for the video size. Each scheduled
 * progress is rendered until the view has its tiles (see capture.ts), composed with the optional overlay (its
 * web fonts loaded first) into an OffscreenCanvas and encoded; meanwhile the tiles of the upcoming frames are
 * prefetched. Everything is restored afterwards, on success, error or cancel.
 */
import { useEffect, useRef } from 'react'
import { useThree, type RootState } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import type { LocalFrame, TerrainEngine } from '../core/types'
import { computeCameraView, type CameraView } from '../flyover/camera'
import { buildTrackPath, type TrackPath } from '../flyover/path'
import { loadOverlayFonts } from '../overlay/assets'
import { useTerrainContext } from '../scene/TerrainLayer'
import { LINE_LIFT_M, type HeightSampler } from '../scene/TrackLines'
import { useAppStore } from '../state/store'
import { composeFrame, renderSettledFrame, wait, type DrawOverlay } from './capture'
import { ExportCanceledError, createVideoEncoder, type VideoEncodeSession } from './encoder'
import { buildFrameSchedule } from './schedule'
import {
  EMPTY_TIMINGS,
  exportRenderScale,
  flushDrapes,
  useExportStore,
  videoFileName,
  type ExportRequest,
  type ExportTimings,
} from './store'

export interface ExportControllerProps {
  /** 2D overlay drawn over every frame (titles, widgets) */
  drawOverlay?: DrawOverlay
}

/** Upcoming frames whose tiles are prefetched (frame offsets), every PREFETCH_EVERY rendered frames. */
const PREFETCH_AHEAD = [5, 10, 15, 20, 30, 40] as const
const PREFETCH_EVERY = 5

interface RunDeps {
  get: () => RootState
  engine: () => TerrainEngine | null
  frame: () => LocalFrame | null
  overlay: () => DrawOverlay | undefined
  signal: AbortSignal
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Camera placement of FlyoverRig at `progress` with the terrain loaded now (same inputs as the rig). */
function viewAt(path: TrackPath, progress: number, frame: LocalFrame, engine: TerrainEngine | null): CameraView {
  const { settings } = useAppStore.getState()
  const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
  return computeCameraView(path, progress, frame, sampler, {
    exaggeration: settings.exaggeration,
    liftM: LINE_LIFT_M,
    camera: settings.camera,
    durationS: settings.flyoverDurationS,
  })
}

const direction = new Vector3()
const toTarget = new Vector3()

async function runExport(request: ExportRequest, deps: RunDeps): Promise<void> {
  const exportStore = useExportStore.getState
  let schedule: number[]
  try {
    schedule = buildFrameSchedule(request)
  } catch (error) {
    if (exportStore().begin(request.id, 0, performance.now())) exportStore().fail(errorMessage(error))
    return
  }
  if (!exportStore().begin(request.id, schedule.length, performance.now())) return

  const { width, height, fps } = request
  const three = deps.get()
  const canvas = three.gl.domElement
  const saved = {
    frameloop: three.frameloop,
    size: { ...three.size },
    dpr: three.viewport.dpr,
    progress: useAppStore.getState().playback.progress,
    pointerEvents: canvas.style.pointerEvents,
    objectFit: canvas.style.objectFit,
  }
  const isCanceled = () => deps.signal.aborted || exportStore().cancelRequested
  const track = useAppStore.getState().tracks[0]
  const path = track ? buildTrackPath(track) : null
  const timings: ExportTimings = { ...EMPTY_TIMINGS }
  const startedAt = performance.now()

  // Video size, re-applied before every render: a window resize or a re-render of <Canvas> resets them.
  const applyVideoSize = () => {
    const state = deps.get()
    if (state.viewport.dpr !== 1) state.setDpr(1)
    if (state.size.width !== width || state.size.height !== height) {
      state.setSize(width, height, saved.size.top, saved.size.left)
    }
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    canvas.style.objectFit = 'contain'
  }

  let clock = 0
  const advance = () => {
    const t0 = performance.now()
    const app = useAppStore.getState()
    if (app.playback.playing) app.setPlaying(false)
    applyVideoSize()
    clock += 1 / fps
    deps.get().advance(clock)
    timings.renderMs += performance.now() - t0
  }

  const timedWait = async (ms: number) => {
    const t0 = performance.now()
    await wait(ms)
    timings.waitMs += performance.now() - t0
  }

  // Distance between the camera in use and the placement the rig would compute with the terrain loaded now.
  const cameraDrift = () => {
    const frame = deps.frame()
    if (!path || path.count === 0 || !frame) return 0
    const camera = deps.get().camera
    const view = viewAt(path, useAppStore.getState().playback.progress, frame, deps.engine())
    camera.getWorldDirection(direction)
    toTarget.subVectors(view.target, camera.position)
    const offAxis = toTarget.addScaledVector(direction, -toTarget.dot(direction)).length()
    return Math.max(camera.position.distanceTo(view.position), offAxis)
  }

  // Ask the engine for the tiles of upcoming frames, after the current view's (bounded by the engine).
  const prefetchCamera = new PerspectiveCamera()
  const prefetchAhead = (i: number) => {
    const engine = deps.engine()
    const frame = deps.frame()
    const camera = deps.get().camera as PerspectiveCamera
    if (!engine?.prefetch || !path || path.count === 0 || !frame || !camera.isPerspectiveCamera) return
    prefetchCamera.copy(camera, false)
    for (const ahead of PREFETCH_AHEAD) {
      const j = i + ahead
      if (j >= schedule.length) break
      const view = viewAt(path, schedule[j], frame, engine)
      prefetchCamera.position.copy(view.position)
      prefetchCamera.lookAt(view.target)
      engine.prefetch(prefetchCamera, height)
    }
  }

  let session: VideoEncodeSession | null = null
  try {
    useAppStore.getState().setPlaying(false)
    three.setFrameloop('never')
    canvas.style.pointerEvents = 'none'
    exportStore().setRenderScale(exportRenderScale(width, height))
    applyVideoSize()

    const compositor = new OffscreenCanvas(width, height)
    const ctx = compositor.getContext('2d', { alpha: false })
    if (!ctx) throw new Error("Impossible de créer l'image de composition.")
    // a canvas never downloads web fonts by itself: the overlay faces must be ready before the first frame
    if (deps.overlay()) await loadOverlayFonts()
    session = await createVideoEncoder(compositor, request)

    const frameDeps = {
      advance,
      pendingTiles: () => {
        const stats = deps.engine()?.stats
        return stats ? (stats.pendingVisibleTiles ?? stats.pendingTiles) : 0
      },
      flushDrapes,
      now: () => performance.now(),
      wait: timedWait,
      isCanceled,
      setProgress: (p: number) => useAppStore.getState().setProgress(p),
      cameraDrift,
    }

    let previous = Number.NaN
    for (let i = 0; i < schedule.length; i++) {
      if (isCanceled()) throw new ExportCanceledError()
      const progress = schedule[i]
      // held frames (holds, pauses of the pacing) repeat the composed image as is
      if (progress !== previous) {
        const complete = await renderSettledFrame(progress, frameDeps)
        // same task as the last render: the drawing buffer still holds the frame
        const t0 = performance.now()
        composeFrame(ctx, canvas, progress, width, height, deps.overlay())
        timings.encodeMs += performance.now() - t0
        timings.rendered++
        if (!complete) timings.timeouts++
        if ((timings.rendered - 1) % PREFETCH_EVERY === 0) prefetchAhead(i)
        previous = progress
      }
      const t0 = performance.now()
      await session.addFrame(i)
      timings.encodeMs += performance.now() - t0
      exportStore().reportFrame(i + 1, performance.now(), timings)
    }

    exportStore().finalizing()
    const blob = await session.finish()
    const { container, codec } = session.codec
    const s = (ms: number) => (ms / 1000).toFixed(1)
    console.info(
      `[export] ${schedule.length} images (${timings.rendered} rendues) en ${s(performance.now() - startedAt)} s : ` +
        `rendu ${s(timings.renderMs)} s, attente des tuiles ${s(timings.waitMs)} s, encodage ${s(timings.encodeMs)} s, ` +
        `${timings.timeouts} délai(s) dépassé(s)`,
    )
    exportStore().complete({
      url: URL.createObjectURL(blob),
      fileName: videoFileName(request.baseName, session.extension),
      mimeType: session.mimeType,
      sizeBytes: blob.size,
      codec: `${container}/${codec}`,
      incompleteFrames: timings.timeouts,
    })
  } catch (error) {
    await session?.cancel().catch(() => undefined)
    if (error instanceof ExportCanceledError || isCanceled()) exportStore().canceled()
    else exportStore().fail(errorMessage(error))
  } finally {
    // the layout size may have changed meanwhile: measure the canvas container again
    const box = canvas.parentElement?.getBoundingClientRect()
    const restoreWidth = box && box.width > 0 ? box.width : saved.size.width
    const restoreHeight = box && box.height > 0 ? box.height : saved.size.height
    const state = deps.get()
    exportStore().setRenderScale(1)
    state.setDpr(saved.dpr)
    state.setSize(restoreWidth, restoreHeight, saved.size.top, saved.size.left)
    canvas.style.width = `${restoreWidth}px`
    canvas.style.height = `${restoreHeight}px`
    canvas.style.objectFit = saved.objectFit
    canvas.style.pointerEvents = saved.pointerEvents
    state.setFrameloop(saved.frameloop)
    useAppStore.getState().setProgress(saved.progress)
  }
}

export function ExportController({ drawOverlay }: ExportControllerProps) {
  const { engine, frame } = useTerrainContext()
  const get = useThree((s) => s.get)
  const requestId = useExportStore((s) => s.request?.id)

  const engineRef = useRef(engine)
  const frameRef = useRef(frame)
  const overlayRef = useRef(drawOverlay)
  useEffect(() => {
    engineRef.current = engine
    frameRef.current = frame
    overlayRef.current = drawOverlay
  })

  useEffect(() => {
    const request = useExportStore.getState().request
    if (requestId === undefined || !request || request.id !== requestId) return undefined
    const abort = new AbortController()
    // deferred so a StrictMode mount / unmount / mount runs the export once
    const timer = setTimeout(() => {
      void runExport(request, {
        get,
        engine: () => engineRef.current,
        frame: () => frameRef.current,
        overlay: () => overlayRef.current,
        signal: abort.signal,
      })
    }, 0)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [requestId, get])

  return null
}

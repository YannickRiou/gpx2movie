/**
 * ExportController — renders the film offline, frame by frame, when the export store receives a request.
 * Mounted inside the R3F canvas, inside TerrainLayer (it needs the terrain engine).
 *
 * For the duration of an export: playback paused, frameloop 'never' (frames are drawn by `advance` only),
 * renderer and camera at the video size with a pixel ratio of 1 (the canvas is shown letterboxed meanwhile),
 * pointer events off. Each scheduled progress is rendered until its terrain is loaded (see capture.ts), composed
 * with the optional overlay into an OffscreenCanvas and encoded. Everything is restored afterwards, on success,
 * error or cancel.
 */
import { useEffect, useRef } from 'react'
import { useThree, type RootState } from '@react-three/fiber'
import { useTerrainContext } from '../scene/TerrainLayer'
import { useAppStore } from '../state/store'
import { composeFrame, renderSettledFrame, wait, type DrawOverlay } from './capture'
import { ExportCanceledError, createVideoEncoder, type VideoEncodeSession } from './encoder'
import { buildFrameSchedule } from './schedule'
import { useExportStore, videoFileName, type ExportRequest } from './store'
import type { TerrainEngine } from '../core/types'

export interface ExportControllerProps {
  /** 2D overlay drawn over every frame (titles, widgets) */
  drawOverlay?: DrawOverlay
}

interface RunDeps {
  get: () => RootState
  engine: () => TerrainEngine | null
  overlay: () => DrawOverlay | undefined
  lastChangeAt: () => number
  signal: AbortSignal
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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
    const app = useAppStore.getState()
    if (app.playback.playing) app.setPlaying(false)
    applyVideoSize()
    clock += 1 / fps
    deps.get().advance(clock)
  }

  let session: VideoEncodeSession | null = null
  try {
    useAppStore.getState().setPlaying(false)
    three.setFrameloop('never')
    canvas.style.pointerEvents = 'none'
    applyVideoSize()

    const compositor = new OffscreenCanvas(width, height)
    const ctx = compositor.getContext('2d', { alpha: false })
    if (!ctx) throw new Error("Impossible de créer l'image de composition.")
    session = await createVideoEncoder(compositor, request)

    const frameDeps = {
      advance,
      pendingTiles: () => deps.engine()?.stats.pendingTiles ?? 0,
      lastChangeAt: deps.lastChangeAt,
      now: () => performance.now(),
      wait,
      isCanceled,
      setProgress: (p: number) => useAppStore.getState().setProgress(p),
    }

    let previous = Number.NaN
    let incompleteFrames = 0
    for (let i = 0; i < schedule.length; i++) {
      if (isCanceled()) throw new ExportCanceledError()
      const progress = schedule[i]
      // held frames repeat the composed image as is
      if (progress !== previous) {
        const complete = await renderSettledFrame(progress, frameDeps)
        // same task as the last render: the drawing buffer still holds the frame
        composeFrame(ctx, canvas, progress, width, height, deps.overlay())
        if (!complete) incompleteFrames++
        previous = progress
      }
      await session.addFrame(i)
      exportStore().reportFrame(i + 1, performance.now())
    }

    exportStore().finalizing()
    const blob = await session.finish()
    const { container, codec } = session.codec
    exportStore().complete({
      url: URL.createObjectURL(blob),
      fileName: videoFileName(request.baseName, session.extension),
      mimeType: session.mimeType,
      sizeBytes: blob.size,
      codec: `${container}/${codec}`,
      incompleteFrames,
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
  const { engine } = useTerrainContext()
  const get = useThree((s) => s.get)
  const requestId = useExportStore((s) => s.request?.id)

  const engineRef = useRef(engine)
  const overlayRef = useRef(drawOverlay)
  const lastChangeRef = useRef(0)
  useEffect(() => {
    engineRef.current = engine
    overlayRef.current = drawOverlay
  })

  useEffect(() => {
    if (!engine) return undefined
    return engine.onChange(() => {
      lastChangeRef.current = performance.now()
    })
  }, [engine])

  useEffect(() => {
    const request = useExportStore.getState().request
    if (requestId === undefined || !request || request.id !== requestId) return undefined
    const abort = new AbortController()
    // deferred so a StrictMode mount / unmount / mount runs the export once
    const timer = setTimeout(() => {
      void runExport(request, {
        get,
        engine: () => engineRef.current,
        overlay: () => overlayRef.current,
        lastChangeAt: () => lastChangeRef.current,
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

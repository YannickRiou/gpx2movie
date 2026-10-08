/**
 * ExportController — renders the film offline, frame by frame, when the export store receives a request.
 * Mounted inside the R3F canvas, inside TerrainLayer (it needs the terrain engine).
 *
 * For the duration of an export: playback paused, frameloop 'never' (frames are drawn by `advance` only),
 * renderer and camera at the video size with a pixel ratio of 1 (the canvas is shown letterboxed meanwhile),
 * pointer events off, render scale of the pixel-sized scene elements set for the video size. Each scheduled
 * progress is rendered until the view has its tiles (see capture.ts), composed with the optional overlay (its
 * web fonts loaded first) into an OffscreenCanvas and encoded; meanwhile the tiles of the upcoming frames are
 * prefetched. The music of the film is mixed beforehand over the exact length of the film (held frames included)
 * and encoded along the frames (silent, with a note, when the browser cannot encode sound). A still image request renders its single progress the same way and keeps the composed canvas as
 * PNG / JPEG instead; an overview still (poster) shows the whole track from the south and hands the image to its
 * `compose` function. Everything is restored afterwards, on success, error or cancel.
 *
 * The overlay alone (`overlayOnly`) skips the scene: the same frames, each overlay drawn on a cleared canvas and encoded
 * with its transparency, so the file lines up frame for frame with the film.
 */
import { useEffect, useRef } from 'react'
import { useThree, type RootState } from '@react-three/fiber'
import { PerspectiveCamera, Vector3 } from 'three'
import type { LocalFrame, TerrainEngine } from '../core/types'
import { mixFilmAudio } from '../film/audio'
import type { FilmClock } from '../film/clock'
import { useMediaStore } from '../film/media'
import { computeFilmView, filmViewMovesWithTime, overviewView, type FilmView } from '../flyover/filmCamera'
import { buildTrackPath, type TrackPath } from '../flyover/path'
import { loadOverlayFonts } from '../overlay/assets'
import { overlayTime, overlayTimedState } from '../overlay/draw'
import { loadFrameMedia, releaseFrameMedia } from '../overlay/exportOverlay'
import { useTerrainContext } from '../scene/TerrainLayer'
import { LINE_LIFT_M, type HeightSampler } from '../scene/TrackLines'
import { useFilmClock } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { REPLACE_EPSILON, composeFrame, composeOverlayFrame, renderSettledFrame, wait, type DrawOverlay } from './capture'
import { ExportCanceledError, createVideoEncoder, type VideoEncodeSession } from './encoder'
import { buildFrameSchedule, buildFrameTimes } from './schedule'
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
/** JPEG quality of still images (PNG is lossless) */
const STILL_JPEG_QUALITY = 0.92
/** Overview still (poster): the whole track seen from the south, north up like a map. */
const FROM_SOUTH = { target: new Vector3(0, 0, 0), position: new Vector3(0, 0, 1) }
/** Layer no camera renders: hides the progress marker on an overview still. */
const HIDDEN_LAYER = 31

interface RunDeps {
  get: () => RootState
  engine: () => TerrainEngine | null
  frame: () => LocalFrame | null
  overlay: () => DrawOverlay | undefined
  /** film clock of the preview (the request's schedule was built from it) */
  clock: () => FilmClock
  signal: AbortSignal
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Camera placement of FlyoverRig at `progress` and film time `timeS` with the terrain loaded now (same inputs as the rig). */
function viewAt(
  path: TrackPath,
  clock: FilmClock,
  progress: number,
  timeS: number | null,
  frame: LocalFrame,
  engine: TerrainEngine | null,
  aspect: number,
): FilmView {
  const { settings } = useAppStore.getState()
  const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
  return computeFilmView(path, clock, timeS ?? clock.timeAtProgress(progress), progress, frame, sampler, {
    exaggeration: settings.exaggeration,
    liftM: LINE_LIFT_M,
    camera: settings.camera,
    durationS: settings.flyoverDurationS,
    aspect,
  })
}

const direction = new Vector3()
const toTarget = new Vector3()

/** End of a failed or canceled export: nothing written is kept (the destination file is removed). */
async function abandon(error: unknown, request: ExportRequest, session: VideoEncodeSession | null, canceled: boolean): Promise<void> {
  await session?.cancel().catch(() => undefined)
  // also when failing before the encoder existed
  await request.destination?.discard().catch(() => undefined)
  if (error instanceof ExportCanceledError || canceled) useExportStore.getState().canceled()
  else useExportStore.getState().fail(errorMessage(error))
}

/**
 * The overlay alone over a transparent background, at the frames of the film (`schedule`, `times`): nothing waits
 * for the terrain, no WebGL frame, no sound. Each frame is drawn anew (cheap in 2D), at the film time of the frame.
 */
async function runOverlayOnly(request: ExportRequest, deps: RunDeps, schedule: number[], times: number[]): Promise<void> {
  const exportStore = useExportStore.getState
  const { width, height } = request
  const clock = deps.clock()
  const drawOverlay = deps.overlay()
  const isCanceled = () => deps.signal.aborted || exportStore().cancelRequested
  let session: VideoEncodeSession | null = null
  try {
    useAppStore.getState().setPlaying(false)
    const compositor = new OffscreenCanvas(width, height)
    const ctx = compositor.getContext('2d')
    if (!ctx) throw new Error("Impossible de créer l'image de composition.")
    if (drawOverlay) await loadOverlayFonts()
    session = await createVideoEncoder(compositor, { ...request, transparent: true })
    for (let i = 0; i < schedule.length; i++) {
      if (isCanceled()) throw new ExportCanceledError()
      const progress = schedule[i]
      await loadFrameMedia(times[i], progress)
      composeOverlayFrame(ctx, { progress, time: overlayTime(clock, progress, times[i]) }, width, height, drawOverlay)
      await session.addFrame(i)
      exportStore().reportFrame(i + 1, performance.now())
    }
    exportStore().finalizing()
    const { blob, sizeBytes } = await session.finish()
    exportStore().complete({
      url: blob && URL.createObjectURL(blob),
      fileName: request.destination?.fileName ?? videoFileName(request.baseName, session.extension),
      mimeType: session.mimeType,
      sizeBytes,
      codec: `${session.codec.container}/${session.codec.codec}`,
      incompleteFrames: 0,
      note: 'fond transparent, sans le son',
    })
  } catch (error) {
    await abandon(error, request, session, isCanceled())
  } finally {
    releaseFrameMedia()
  }
}

async function runExport(request: ExportRequest, deps: RunDeps): Promise<void> {
  const exportStore = useExportStore.getState
  let schedule: number[]
  try {
    // the rig only places the camera when the progress changes: a still starts a hair away from the current one
    const still = request.still?.progress
    schedule =
      still === undefined ? buildFrameSchedule(request) : [still < 1 ? still + REPLACE_EPSILON : still - REPLACE_EPSILON]
  } catch (error) {
    await request.destination?.discard().catch(() => undefined)
    if (exportStore().begin(request.id, 0, performance.now())) exportStore().fail(errorMessage(error))
    return
  }
  if (!exportStore().begin(request.id, schedule.length, performance.now())) return
  // film time of every frame: the shots, the orbiting stops and the time-based styles move while the progress holds
  const times = request.still ? [] : buildFrameTimes(request)
  if (request.overlayOnly) return runOverlayOnly(request, deps, schedule, times)

  const { width, height, fps } = request
  const filmClock = deps.clock()
  const three = deps.get()
  const canvas = three.gl.domElement
  const saved = {
    frameloop: three.frameloop,
    size: { ...three.size },
    dpr: three.viewport.dpr,
    progress: useAppStore.getState().playback.progress,
    timeS: useAppStore.getState().playback.timeS,
    pointerEvents: canvas.style.pointerEvents,
    objectFit: canvas.style.objectFit,
  }
  const isCanceled = () => deps.signal.aborted || exportStore().cancelRequested
  const track = useAppStore.getState().tracks[0]
  const path = track ? buildTrackPath(track) : null
  const timings: ExportTimings = { ...EMPTY_TIMINGS }
  const startedAt = performance.now()

  // Overview still (poster): the progress, hence the rig, stays put; the camera is placed here before every render
  // and put back afterwards, the progress marker hidden meanwhile.
  const overview = request.still?.overview === true
  const controlsTarget = () => (deps.get().controls as unknown as { target?: Vector3 } | null)?.target
  const savedView = overview
    ? { position: three.camera.position.clone(), quaternion: three.camera.quaternion.clone(), target: controlsTarget()?.clone() }
    : null
  const marker = overview ? three.scene.getObjectByName('flyover-marker') : undefined
  const markerLayers = marker?.layers.mask
  const placeOverview = () => {
    const frame = deps.frame()
    const engine = deps.engine()
    if (!path || path.count === 0 || !frame) return
    const sampler: HeightSampler | null = engine ? (lon, lat) => engine.sampleHeight(lon, lat) : null
    const view = overviewView(path, frame, sampler, useAppStore.getState().settings.exaggeration, width / height, FROM_SOUTH)
    const { camera } = deps.get()
    camera.position.copy(view.position)
    camera.lookAt(view.target)
    controlsTarget()?.copy(view.target)
  }

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
    if (overview) placeOverview()
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
    // the overview is placed again before every render
    if (overview) return 0
    const frame = deps.frame()
    if (!path || path.count === 0 || !frame) return 0
    const camera = deps.get().camera
    const { progress, timeS } = useAppStore.getState().playback
    const view = viewAt(path, filmClock, progress, timeS, frame, deps.engine(), width / height)
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
      const view = viewAt(path, filmClock, schedule[j], times[j], frame, engine, width / height)
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
    marker?.layers.set(HIDDEN_LAYER)

    const compositor = new OffscreenCanvas(width, height)
    const ctx = compositor.getContext('2d', { alpha: false })
    if (!ctx) throw new Error("Impossible de créer l'image de composition.")
    // a canvas never downloads web fonts by itself: the overlay faces must be ready before the first frame
    if (deps.overlay()) await loadOverlayFonts()

    /** film time set with every progress (a still keeps the current one) */
    let frameTimeS = saved.timeS
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
      setProgress: (p: number) => {
        if (!overview) useAppStore.getState().setProgress(p, frameTimeS)
      },
      cameraDrift,
    }

    if (request.still) {
      const { progress, compose } = request.still
      const time = overlayTime(filmClock, progress, saved.timeS)
      // pictures and video frames decoded before the render: composing must follow it in the same task
      if (!compose) await loadFrameMedia(time.timeS, progress)
      const complete = await renderSettledFrame(schedule[0], frameDeps)
      // a composed still (poster) draws its own text instead of the film overlay
      composeFrame(ctx, canvas, { progress, time }, width, height, compose ? undefined : deps.overlay())
      exportStore().reportFrame(1, performance.now())
      exportStore().finalizing()
      const output = compose ? await compose(compositor) : compositor
      const blob = await output.convertToBlob({ type: request.still.type, quality: STILL_JPEG_QUALITY })
      // a browser without a JPEG encoder answers PNG
      const jpeg = blob.type === 'image/jpeg'
      exportStore().complete({
        url: URL.createObjectURL(blob),
        fileName: videoFileName(request.baseName, jpeg ? '.jpg' : '.png'),
        mimeType: blob.type,
        sizeBytes: blob.size,
        codec: jpeg ? 'jpeg' : 'png',
        incompleteFrames: complete ? 0 : 1,
      })
      return
    }

    const settings = useAppStore.getState().settings
    // the soundtrack from the first frame: film time 0 comes after the frames held at the start
    const audio = await mixFilmAudio(settings.film, (id) => useMediaStore.getState().table[id], {
      offsetS: Math.round(request.holdStartS * fps) / fps,
      lengthS: schedule.length / fps,
    })
    if (isCanceled()) throw new ExportCanceledError()
    session = await createVideoEncoder(compositor, { ...request, audio })
    /** opacities of the timed overlay (cards, timeline texts, photos and clips) at a frame, '' without overlay */
    const overlayKey = (progress: number, timeS: number) =>
      deps.overlay()
        ? overlayTimedState(settings.overlay, settings.film.texts, overlayTime(filmClock, progress, timeS), settings.film.media).join()
        : ''
    let previous = Number.NaN
    /** the view of the last rendered frame moved with time */
    let previousTimed = false
    let previousOverlay = ''
    for (let i = 0; i < schedule.length; i++) {
      if (isCanceled()) throw new ExportCanceledError()
      const progress = schedule[i]
      // held frames (holds, stops) repeat the composed image as is, unless the view or the overlay moves with time
      const timed = filmViewMovesWithTime(filmClock.stateAt(times[i]), settings.camera.style)
      const overlayNow = overlayKey(progress, times[i])
      if (progress !== previous || ((timed || previousTimed) && times[i] !== frameTimeS) || overlayNow !== previousOverlay) {
        frameTimeS = times[i]
        previousTimed = timed
        previousOverlay = overlayNow
        // pictures and video frames decoded before the render: composing must follow it in the same task
        await loadFrameMedia(frameTimeS, progress)
        const complete = await renderSettledFrame(progress, frameDeps)
        // same task as the last render: the drawing buffer still holds the frame
        const t0 = performance.now()
        composeFrame(ctx, canvas, { progress, time: overlayTime(filmClock, progress, frameTimeS) }, width, height, deps.overlay())
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
    const { blob, sizeBytes } = await session.finish()
    const { container, codec } = session.codec
    const s = (ms: number) => (ms / 1000).toFixed(1)
    console.info(
      `[export] ${schedule.length} images (${timings.rendered} rendues) en ${s(performance.now() - startedAt)} s : ` +
        `rendu ${s(timings.renderMs)} s, attente des tuiles ${s(timings.waitMs)} s, encodage ${s(timings.encodeMs)} s, ` +
        `${timings.timeouts} délai(s) dépassé(s)`,
    )
    exportStore().complete({
      // null: already written to the chosen file
      url: blob && URL.createObjectURL(blob),
      fileName: request.destination?.fileName ?? videoFileName(request.baseName, session.extension),
      mimeType: session.mimeType,
      sizeBytes,
      codec: `${container}/${codec}`,
      incompleteFrames: timings.timeouts,
      note: audio ? (session.audioCodec ? `avec le son (${session.audioCodec === 'aac' ? 'AAC' : 'Opus'})` : 'sans le son : ce navigateur ne sait pas l’encoder') : undefined,
    })
  } catch (error) {
    await abandon(error, request, session, isCanceled())
  } finally {
    releaseFrameMedia()
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
    useAppStore.getState().setProgress(saved.progress, saved.timeS)
    if (marker && markerLayers !== undefined) marker.layers.mask = markerLayers
    if (savedView) {
      state.camera.position.copy(savedView.position)
      state.camera.quaternion.copy(savedView.quaternion)
      if (savedView.target) controlsTarget()?.copy(savedView.target)
    }
  }
}

export function ExportController({ drawOverlay }: ExportControllerProps) {
  const { engine, frame } = useTerrainContext()
  const get = useThree((s) => s.get)
  const requestId = useExportStore((s) => s.request?.id)

  const clock = useFilmClock()

  const engineRef = useRef(engine)
  const frameRef = useRef(frame)
  const overlayRef = useRef(drawOverlay)
  const clockRef = useRef(clock)
  useEffect(() => {
    engineRef.current = engine
    frameRef.current = frame
    overlayRef.current = drawOverlay
    clockRef.current = clock
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
        clock: () => clockRef.current,
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

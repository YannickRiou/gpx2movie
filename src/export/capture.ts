/**
 * Frame capture helpers of the video export (no React): render a progress until the terrain is complete,
 * then compose the WebGL image and the optional 2D overlay into the encoder canvas.
 */
import { ExportCanceledError } from './encoder'

/** 2D film overlay (titles, widgets) drawn over each frame, at the video resolution. */
export type DrawOverlay = (ctx: OffscreenCanvasRenderingContext2D, progress: number, width: number, height: number) => void

export interface SettleOptions {
  /** renders per frame at least, so the LOD selection, the shadows and the post-process settle */
  minAdvances: number
  /** time without terrain change before the frame is final: lets the track re-drape (150 ms debounce) */
  quietMs: number
  /** give up waiting for the terrain after this long and capture what is there */
  timeoutMs: number
  /** wait between renders while tiles are loading */
  pollMs: number
}

export const DEFAULT_SETTLE: SettleOptions = { minAdvances: 3, quietMs: 250, timeoutMs: 10_000, pollMs: 16 }

/** Offset used to make the flyover rig place the camera again at (almost) the same progress. */
export const REPLACE_EPSILON = 1e-9

export interface SettleDeps {
  /** render one frame (R3F `advance`) */
  advance(): void
  pendingTiles(): number
  /** time of the last terrain change (tile ready or removed), same clock as `now` */
  lastChangeAt(): number
  now(): number
  wait(ms: number): Promise<void>
  isCanceled(): boolean
}

export interface RenderFrameDeps extends SettleDeps {
  setProgress(progress: number): void
}

/**
 * Render until no tile is pending, the terrain has been quiet for `quietMs` and at least `minAdvances` frames
 * were drawn. Resolves true when settled, false on timeout; throws ExportCanceledError when canceled.
 * The last frame is still in the WebGL drawing buffer when the promise settles: capture it right away,
 * without awaiting anything else first.
 */
export async function settle(deps: SettleDeps, options: SettleOptions = DEFAULT_SETTLE): Promise<boolean> {
  const start = deps.now()
  for (let n = 1; ; n++) {
    deps.advance()
    const now = deps.now()
    const loaded = deps.pendingTiles() === 0 && now - deps.lastChangeAt() >= options.quietMs
    if (loaded && n >= options.minAdvances) return true
    if (now - start >= options.timeoutMs) return false
    if (deps.isCanceled()) throw new ExportCanceledError()
    await deps.wait(loaded ? 0 : options.pollMs)
  }
}

/**
 * Show `progress` and wait for its terrain. The chase camera is placed once per progress change with the
 * heights loaded at that moment: when finer tiles arrived after the placement, it is placed once more (at a
 * progress REPLACE_EPSILON away, invisible) so the ground clearance uses the final terrain.
 */
export async function renderSettledFrame(
  progress: number,
  deps: RenderFrameDeps,
  options: SettleOptions = DEFAULT_SETTLE,
): Promise<boolean> {
  deps.setProgress(progress)
  const placedAt = deps.now()
  const complete = await settle(deps, options)
  if (deps.lastChangeAt() < placedAt) return complete
  deps.setProgress(progress < 1 ? progress + REPLACE_EPSILON : progress - REPLACE_EPSILON)
  return settle(deps, options)
}

/** Sky gradient behind a transparent canvas (mirrors the CSS background of FlyoverCanvas: glacier → paper). */
export const SKY_GRADIENT: readonly [string, string] = ['#A9CCD9', '#F5F2EA']

/** Encoder canvas content for one frame: sky gradient, WebGL image scaled to the video size, overlay. */
export function composeFrame(
  ctx: OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  progress: number,
  width: number,
  height: number,
  drawOverlay?: DrawOverlay,
): void {
  const sky = ctx.createLinearGradient(0, 0, 0, height)
  sky.addColorStop(0, SKY_GRADIENT[0])
  sky.addColorStop(1, SKY_GRADIENT[1])
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, 0, 0, width, height)
  if (!drawOverlay) return
  ctx.save()
  try {
    drawOverlay(ctx, progress, width, height)
  } finally {
    ctx.restore()
  }
}

/** Resolve after `ms`; 0 yields to the event loop through a message port (not throttled in background tabs). */
export function wait(ms: number): Promise<void> {
  if (ms > 0) return new Promise((resolve) => setTimeout(resolve, ms))
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

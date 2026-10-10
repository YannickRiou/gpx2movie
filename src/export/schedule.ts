/**
 * Video export formats and frame schedule.
 *
 * The flyover is a pure function of `playback.progress` and its film time, so a film is fully described by the
 * list of film times of its frames and the progress values they map to: a ramp 0 → 1 over the film duration
 * (linear, or following the variable pacing of the flyover), optionally preceded and followed by frames held on
 * the first / last image.
 */
import { deviceBudget } from '../core/deviceBudget'

/**
 * Film aspect ratios (`x:y` = width:height). The size is the aspect × a resolution class defined by the short
 * side, so a vertical 4K film is 2160 × 3840 and a square 1440p film 1440 × 1440.
 */
export const VIDEO_ASPECTS = [
  { id: '16:9', label: 'Paysage 16:9', x: 16, y: 9 },
  { id: '9:16', label: 'Vertical 9:16', x: 9, y: 16 },
  { id: '1:1', label: 'Carré 1:1', x: 1, y: 1 },
  { id: '4:5', label: 'Portrait 4:5', x: 4, y: 5 },
  { id: '21:9', label: 'Cinéma 21:9', x: 21, y: 9 },
] as const satisfies readonly { id: string; label: string; x: number; y: number }[]

export type VideoAspect = (typeof VIDEO_ASPECTS)[number]['id']

/** Resolution classes, named after the short side of the frame. */
export const VIDEO_RESOLUTIONS = [
  { id: '720p', label: '720p', shortSide: 720 },
  { id: '1080p', label: '1080p', shortSide: 1080 },
  { id: '1440p', label: '1440p', shortSide: 1440 },
  { id: '4k', label: '4K', shortSide: 2160 },
] as const satisfies readonly { id: string; label: string; shortSide: number }[]

export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number]['id']

export const VIDEO_FPS = [24, 30, 60] as const
export type VideoFps = (typeof VIDEO_FPS)[number]

/** Encoding quality, mapped to a bitrate by the encoder (`videoBitrate`). */
export const VIDEO_QUALITIES = ['standard', 'high', 'max'] as const
export type VideoQuality = (typeof VIDEO_QUALITIES)[number]

/** Film format of the project (stored in the settings). */
export interface VideoSettings {
  aspect: VideoAspect
  resolution: VideoResolution
  fps: VideoFps
  quality: VideoQuality
}

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = { aspect: '16:9', resolution: '1080p', fps: 30, quality: 'high' }

/**
 * Why a resolution class comes out smaller here (phones and tablets), null when it does not. To show next to the
 * resolution choice.
 */
export function exportResolutionNote(resolution: VideoResolution, maxShortSide = deviceBudget().maxExportShortSide): string | null {
  const shortSide = (VIDEO_RESOLUTIONS.find((r) => r.id === resolution) ?? VIDEO_RESOLUTIONS[1]).shortSide
  if (shortSide <= maxShortSide) return null
  const cap = VIDEO_RESOLUTIONS.find((r) => r.shortSide === maxShortSide)?.label ?? `${maxShortSide}p`
  return `Sur cet appareil, l'export est limité à ${cap} (mémoire de la carte graphique) : le film sort en ${cap}.`
}

/** Frames held on the first image (lets the viewer settle) and on the last one (the arrival). */
export const EXPORT_HOLD_START_S = 1
export const EXPORT_HOLD_END_S = 2

/**
 * Frame size in pixels: the short side of the resolution class, the long side from the aspect ratio rounded
 * to an even number (H.264 / HEVC need even sizes). Every combination is exact today: 1920 × 1080,
 * 2160 × 3840, 1080 × 1350, 2520 × 1080…
 */
export function videoSize(
  aspect: VideoAspect,
  resolution: VideoResolution,
  maxShortSide = deviceBudget().maxExportShortSide,
): { width: number; height: number } {
  const a = VIDEO_ASPECTS.find((v) => v.id === aspect) ?? VIDEO_ASPECTS[0]
  // a phone or tablet renders at most 1080p / 1440p (GPU memory): the larger classes come out at that size
  const short = Math.min((VIDEO_RESOLUTIONS.find((r) => r.id === resolution) ?? VIDEO_RESOLUTIONS[1]).shortSide, maxShortSide)
  const long = 2 * Math.round((short * Math.max(a.x, a.y)) / Math.min(a.x, a.y) / 2)
  return a.x >= a.y ? { width: long, height: short } : { width: short, height: long }
}

export function isValidVideoSettings(video: VideoSettings): boolean {
  return (
    VIDEO_ASPECTS.some((a) => a.id === video.aspect) &&
    VIDEO_RESOLUTIONS.some((r) => r.id === video.resolution) &&
    (VIDEO_FPS as readonly number[]).includes(video.fps) &&
    (VIDEO_QUALITIES as readonly string[]).includes(video.quality)
  )
}

/** Fixed sizes of the first version of the settings (`video.format`), as aspect × resolution. */
const LEGACY_FORMATS: Record<string, Pick<VideoSettings, 'aspect' | 'resolution'>> = {
  '1920x1080': { aspect: '16:9', resolution: '1080p' },
  '3840x2160': { aspect: '16:9', resolution: '4k' },
  '1280x720': { aspect: '16:9', resolution: '720p' },
  '1080x1920': { aspect: '9:16', resolution: '1080p' },
  '1080x1080': { aspect: '1:1', resolution: '1080p' },
  '1080x1350': { aspect: '4:5', resolution: '1080p' },
}

/**
 * Upgrade of a saved `video` setting (project or preset) before validation: `{ format, fps, quality }`
 * becomes `{ aspect, resolution, fps, quality }` (an unknown format falls back to 16:9 1080p).
 */
export function withVideoDefaults(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !('format' in raw)) return raw
  const { format, ...rest } = raw as Record<string, unknown>
  if ('aspect' in rest && 'resolution' in rest) return rest
  const legacy = (typeof format === 'string' && LEGACY_FORMATS[format]) || DEFAULT_VIDEO_SETTINGS
  return { ...rest, aspect: legacy.aspect, resolution: legacy.resolution }
}

export interface ScheduleOptions {
  /** duration of the flyover itself (progress 0 → 1), seconds */
  durationS: number
  /** progress at film time `tS` ∈ [0, durationS] (variable pacing); default linear `tS / durationS` */
  progressAt?: (tS: number) => number
  fps: number
  /** extra frames on progress 0 before the flyover starts, seconds */
  holdStartS?: number
  /** extra frames on progress 1 after the flyover ends, seconds */
  holdEndS?: number
}

/**
 * Film time of every frame of the film (seconds at ×1). The ramp has `round(durationS × fps)` frames (at least 2),
 * frame k is at `k / (ramp − 1) × durationS`, exactly 0 on its first frame and `durationS` on its last; holds add
 * `round(holdS × fps)` frames at 0 and `durationS`.
 */
export function buildFrameTimes({ durationS, fps, holdStartS = 0, holdEndS = 0 }: ScheduleOptions): number[] {
  if (!(fps > 0) || !Number.isFinite(fps)) throw new RangeError(`invalid frame rate: ${fps}`)
  if (!(durationS > 0) || !Number.isFinite(durationS)) throw new RangeError(`invalid duration: ${durationS}`)
  const ramp = Math.max(2, Math.round(durationS * fps))
  const before = Math.max(0, Math.round(holdStartS * fps))
  const after = Math.max(0, Math.round(holdEndS * fps))

  const frames = new Array<number>(before + ramp + after)
  let i = 0
  for (let k = 0; k < before; k++) frames[i++] = 0
  for (let k = 0; k < ramp; k++) frames[i++] = (k / (ramp - 1)) * durationS
  for (let k = 0; k < after; k++) frames[i++] = durationS
  return frames
}

/**
 * Progress value of every frame of the film (`buildFrameTimes`): `progressAt(time)`, exactly 0 at time 0 and 1 at
 * `durationS`.
 */
export function buildFrameSchedule(options: ScheduleOptions): number[] {
  const { durationS, progressAt } = options
  return buildFrameTimes(options).map((t) =>
    t <= 0 ? 0 : t >= durationS ? 1 : Math.min(1, Math.max(0, progressAt ? progressAt(t) : t / durationS)),
  )
}

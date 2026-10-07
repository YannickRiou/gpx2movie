/**
 * Video export formats and frame schedule.
 *
 * The flyover is a pure function of `playback.progress`, so a film is fully described by the list of progress
 * values of its frames: a linear ramp 0 → 1 over the flyover duration, optionally preceded and followed by
 * frames held on the first / last image.
 */

export type VideoAspect = '16:9' | '9:16' | '1:1' | '4:5'

export interface VideoFormat {
  id: string
  aspect: VideoAspect
  width: number
  height: number
  label: string
}

/** Output sizes, grouped by aspect ratio (the first one of each ratio is its default). */
export const VIDEO_FORMATS = [
  { id: '1920x1080', aspect: '16:9', width: 1920, height: 1080, label: 'Full HD — 1920 × 1080' },
  { id: '3840x2160', aspect: '16:9', width: 3840, height: 2160, label: '4K — 3840 × 2160' },
  { id: '1280x720', aspect: '16:9', width: 1280, height: 720, label: 'HD — 1280 × 720' },
  { id: '1080x1920', aspect: '9:16', width: 1080, height: 1920, label: '1080 × 1920' },
  { id: '1080x1080', aspect: '1:1', width: 1080, height: 1080, label: '1080 × 1080' },
  { id: '1080x1350', aspect: '4:5', width: 1080, height: 1350, label: '1080 × 1350' },
] as const satisfies readonly VideoFormat[]

export type VideoFormatId = (typeof VIDEO_FORMATS)[number]['id']

export const VIDEO_ASPECTS: readonly { aspect: VideoAspect; label: string }[] = [
  { aspect: '16:9', label: 'Paysage 16:9' },
  { aspect: '9:16', label: 'Vertical 9:16' },
  { aspect: '1:1', label: 'Carré 1:1' },
  { aspect: '4:5', label: 'Portrait 4:5' },
]

export const VIDEO_FPS = [24, 30, 60] as const
export type VideoFps = (typeof VIDEO_FPS)[number]

/** Encoding quality, mapped to a bitrate by the encoder (`videoBitrate`). */
export const VIDEO_QUALITIES = ['standard', 'high', 'max'] as const
export type VideoQuality = (typeof VIDEO_QUALITIES)[number]

/** Film format of the project (stored in the settings). */
export interface VideoSettings {
  format: VideoFormatId
  fps: VideoFps
  quality: VideoQuality
}

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = { format: '1920x1080', fps: 30, quality: 'high' }

/** Frames held on the first image (lets the viewer settle) and on the last one (the arrival). */
export const EXPORT_HOLD_START_S = 1
export const EXPORT_HOLD_END_S = 2

export function getVideoFormat(id: string): VideoFormat | undefined {
  return VIDEO_FORMATS.find((f) => f.id === id)
}

export function isValidVideoSettings(video: VideoSettings): boolean {
  return (
    getVideoFormat(video.format) !== undefined &&
    (VIDEO_FPS as readonly number[]).includes(video.fps) &&
    (VIDEO_QUALITIES as readonly string[]).includes(video.quality)
  )
}

export interface ScheduleOptions {
  /** duration of the flyover itself (progress 0 → 1), seconds */
  durationS: number
  fps: number
  /** extra frames on progress 0 before the flyover starts, seconds */
  holdStartS?: number
  /** extra frames on progress 1 after the flyover ends, seconds */
  holdEndS?: number
}

/**
 * Progress value of every frame of the film. The ramp has `round(durationS × fps)` frames (at least 2) and
 * reaches exactly 0 on its first frame and 1 on its last; holds add `round(holdS × fps)` frames.
 */
export function buildFrameSchedule({ durationS, fps, holdStartS = 0, holdEndS = 0 }: ScheduleOptions): number[] {
  if (!(fps > 0) || !Number.isFinite(fps)) throw new RangeError(`invalid frame rate: ${fps}`)
  if (!(durationS > 0) || !Number.isFinite(durationS)) throw new RangeError(`invalid duration: ${durationS}`)
  const ramp = Math.max(2, Math.round(durationS * fps))
  const before = Math.max(0, Math.round(holdStartS * fps))
  const after = Math.max(0, Math.round(holdEndS * fps))

  const frames = new Array<number>(before + ramp + after)
  let i = 0
  for (let k = 0; k < before; k++) frames[i++] = 0
  for (let k = 0; k < ramp; k++) frames[i++] = k / (ramp - 1)
  for (let k = 0; k < after; k++) frames[i++] = 1
  return frames
}

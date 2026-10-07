import { useEffect, useId, useRef } from 'react'
import {
  EXPORT_HOLD_END_S,
  EXPORT_HOLD_START_S,
  VIDEO_ASPECTS,
  VIDEO_FORMATS,
  VIDEO_FPS,
  buildFrameSchedule,
  getVideoFormat,
  type VideoQuality,
  type VideoSettings,
} from '../export/schedule'
import { isExportBusy, useExportStore } from '../export/store'
import { usePacing } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { formatNumber } from './format'

const QUALITIES: { value: VideoQuality; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'high', label: 'Haute' },
  { value: 'max', label: 'Maximale' },
]

const CODEC_LABELS: Record<string, string> = {
  'mp4/avc': 'MP4 (H.264)',
  'mp4/hevc': 'MP4 (HEVC)',
  'webm/vp9': 'WebM (VP9)',
  'webm/vp8': 'WebM (VP8)',
}

/** 75 -> "1 min 15 s", 42 -> "42 s" */
function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}

/** bytes -> "12,3 Mo" */
function formatMegabytes(bytes: number): string {
  return `${formatNumber(bytes / 1e6, 1)} Mo`
}

/** Start a download of an object URL. */
function download(url: string, fileName: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
}

/** "Exporter la vidéo" section: film format, frame rate, quality, start / cancel, progress and download. */
export function ExportPanel() {
  const video = useAppStore((s) => s.settings.video)
  // film length and progress at each film time, with the slow-downs and pauses of the preview
  const pacing = usePacing()
  const durationS = pacing.totalTime()
  const trackName = useAppStore((s) => s.tracks[0]?.name)
  const setSetting = useAppStore((s) => s.setSetting)
  const { phase, frame, frameCount, etaS, result, error } = useExportStore()
  const id = useId()
  const downloadedRef = useRef<string | null>(null)

  const busy = isExportBusy(phase)
  const format = getVideoFormat(video.format) ?? VIDEO_FORMATS[0]
  const sizes = VIDEO_FORMATS.filter((f) => f.aspect === format.aspect)
  const totalFrames = buildFrameSchedule({
    durationS,
    fps: video.fps,
    holdStartS: EXPORT_HOLD_START_S,
    holdEndS: EXPORT_HOLD_END_S,
  }).length

  // Download the film automatically once it is ready (the link stays available).
  useEffect(() => {
    if (!result || downloadedRef.current === result.url) return
    downloadedRef.current = result.url
    download(result.url, result.fileName)
  }, [result])

  const update = (patch: Partial<VideoSettings>) => setSetting('video', { ...video, ...patch })

  const start = () => {
    if (!trackName) return
    useExportStore.getState().start({
      width: format.width,
      height: format.height,
      fps: video.fps,
      quality: video.quality,
      durationS,
      progressAt: pacing.progressAtTime,
      holdStartS: EXPORT_HOLD_START_S,
      holdEndS: EXPORT_HOLD_END_S,
      baseName: trackName,
    })
  }

  const announcement =
    phase === 'starting' || phase === 'rendering'
      ? 'Export en cours…'
      : phase === 'finalizing'
        ? 'Finalisation du fichier…'
        : phase === 'done'
          ? 'Vidéo prête.'
          : phase === 'canceled'
            ? 'Export annulé.'
            : ''

  return (
    <section className="settings export" aria-labelledby={`${id}-title`} aria-busy={busy}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        Exporter la vidéo
      </h2>

      <div className="field">
        <label className="field__label" htmlFor={`${id}-aspect`}>
          Format
        </label>
        <select
          id={`${id}-aspect`}
          className="select"
          value={format.aspect}
          disabled={busy}
          onChange={(e) => {
            const first = VIDEO_FORMATS.find((f) => f.aspect === e.currentTarget.value)
            if (first) update({ format: first.id })
          }}
        >
          {VIDEO_ASPECTS.map((a) => (
            <option key={a.aspect} value={a.aspect}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={`${id}-size`}>
          Résolution
        </label>
        <select
          id={`${id}-size`}
          className="select"
          value={format.id}
          disabled={busy || sizes.length < 2}
          onChange={(e) => {
            const next = sizes.find((f) => f.id === e.currentTarget.value)
            if (next) update({ format: next.id })
          }}
        >
          {sizes.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="field fieldset" disabled={busy}>
        <legend className="field__label">Images par seconde</legend>
        <div className="segmented">
          {VIDEO_FPS.map((fps) => (
            <label key={fps} className="segmented__option">
              <input
                type="radio"
                name={`${id}-fps`}
                value={fps}
                checked={video.fps === fps}
                onChange={() => update({ fps })}
              />
              {fps}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="field fieldset" disabled={busy}>
        <legend className="field__label">Qualité</legend>
        <div className="segmented">
          {QUALITIES.map((q) => (
            <label key={q.value} className="segmented__option">
              <input
                type="radio"
                name={`${id}-quality`}
                value={q.value}
                checked={video.quality === q.value}
                onChange={() => update({ quality: q.value })}
              />
              {q.label}
            </label>
          ))}
        </div>
      </fieldset>

      <p className="field__hint">
        {formatClock(totalFrames / video.fps)} · {formatNumber(totalFrames)} images, rendues une à une après le
        chargement complet du relief.
      </p>

      {!busy && (
        <button type="button" className="btn btn--primary btn--block" onClick={start} disabled={!trackName}>
          Exporter la vidéo
        </button>
      )}

      {busy && (
        <div className="field">
          <progress
            className="export__progress"
            aria-label="Progression de l'export"
            max={Math.max(1, frameCount)}
            value={phase === 'finalizing' ? frameCount : frame}
          />
          <p className="field__hint">
            {phase === 'finalizing'
              ? 'Finalisation du fichier…'
              : phase === 'starting'
                ? 'Préparation…'
                : `Image ${formatNumber(frame)} / ${formatNumber(frameCount)}${
                    etaS === null ? '' : ` · reste environ ${formatClock(etaS)}`
                  }`}
          </p>
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => useExportStore.getState().cancel()}
            disabled={phase === 'finalizing'}
          >
            Annuler l'export
          </button>
        </div>
      )}

      {phase === 'done' && result && (
        <p className="field__hint">
          <a href={result.url} download={result.fileName}>
            Télécharger {result.fileName}
          </a>{' '}
          ({formatMegabytes(result.sizeBytes)}, {CODEC_LABELS[result.codec] ?? result.codec})
          {result.incompleteFrames > 0 &&
            ` — ${formatNumber(result.incompleteFrames)} image(s) rendue(s) avant la fin du chargement du relief.`}
        </p>
      )}

      {phase === 'error' && error && (
        <div className="alert" role="alert">
          <span className="alert__text">Échec de l'export : {error}</span>
          <button
            type="button"
            className="alert__close"
            aria-label="Fermer le message"
            onClick={() => useExportStore.getState().reset()}
          >
            ×
          </button>
        </div>
      )}

      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </section>
  )
}

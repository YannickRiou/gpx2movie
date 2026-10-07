import { useEffect, useId, useRef, useState } from 'react'
import { pickCodec, videoBitrate, type CodecCandidate } from '../export/encoder'
import {
  EXPORT_HOLD_END_S,
  EXPORT_HOLD_START_S,
  VIDEO_ASPECTS,
  VIDEO_FPS,
  VIDEO_RESOLUTIONS,
  buildFrameSchedule,
  videoSize,
  type VideoQuality,
  type VideoSettings,
} from '../export/schedule'
import { isExportBusy, stillBaseName, useExportStore, type StillType } from '../export/store'
import { usePacing } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { ModifiedMarker } from './ModifiedMarker'
import { formatNumber } from './format'
import { AspectIcon, Icon } from './icons'

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
  png: 'PNG',
  jpeg: 'JPEG',
}

const STILL_TYPES: { value: StillType; label: string }[] = [
  { value: 'image/png', label: 'PNG' },
  { value: 'image/jpeg', label: 'JPEG' },
]

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

/** Codec the browser would use for a size / rate / quality (`key`), null when it can encode none. */
interface CodecProbe {
  key: string
  codec: CodecCandidate | null
}

/**
 * "Exporter" drawer: aspect (tiles), resolution, codec and estimated size, start / cancel, progress and download;
 * also a still image of the current progress at the same size; frame rate, quality and image type under
 * « Plus d'options ».
 */
export function ExportPanel({ onClose }: { onClose?: () => void }) {
  const video = useAppStore((s) => s.settings.video)
  // film length and progress at each film time, with the slow-downs and pauses of the preview
  const pacing = usePacing()
  const durationS = pacing.totalTime()
  const trackName = useAppStore((s) => s.tracks[0]?.name)
  const setSetting = useAppStore((s) => s.setSetting)
  const { phase, frame, frameCount, etaS, result, error, timings } = useExportStore()
  const id = useId()
  const [stillType, setStillType] = useState<StillType>('image/png')
  const downloadedRef = useRef<string | null>(null)

  const busy = isExportBusy(phase)
  const { width, height } = videoSize(video.aspect, video.resolution)
  const totalFrames = buildFrameSchedule({
    durationS,
    fps: video.fps,
    holdStartS: EXPORT_HOLD_START_S,
    holdEndS: EXPORT_HOLD_END_S,
  }).length

  // Ask the browser which codec it can use at this size (H.264 may refuse large or tall frames).
  const probeKey = `${width}x${height}@${video.fps}/${video.quality}`
  const [probe, setProbe] = useState<CodecProbe | null>(null)
  useEffect(() => {
    let alive = true
    void pickCodec({ width, height, fps: video.fps, quality: video.quality }).then((codec) => {
      if (alive) setProbe({ key: probeKey, codec })
    })
    return () => {
      alive = false
    }
  }, [probeKey, width, height, video.fps, video.quality])
  const codec = probe?.key === probeKey ? probe.codec : undefined
  const estimatedBytes = codec ? (videoBitrate(width, height, video.fps, video.quality, codec.codec) * totalFrames) / video.fps / 8 : 0
  const secondsPerImage =
    timings.rendered > 0 ? (timings.renderMs + timings.waitMs + timings.encodeMs) / timings.rendered / 1000 : null

  // Download the film automatically once it is ready (the link stays available).
  useEffect(() => {
    if (!result || downloadedRef.current === result.url) return
    downloadedRef.current = result.url
    download(result.url, result.fileName)
  }, [result])

  const update = (patch: Partial<VideoSettings>) => setSetting('video', { ...video, ...patch })

  const request = {
    width,
    height,
    fps: video.fps,
    quality: video.quality,
    durationS,
    progressAt: pacing.progressAtTime,
    holdStartS: EXPORT_HOLD_START_S,
    holdEndS: EXPORT_HOLD_END_S,
  }

  const start = () => {
    if (!trackName || !codec) return
    useExportStore.getState().start({ ...request, baseName: trackName })
  }

  const startStill = () => {
    if (!trackName) return
    const progress = useAppStore.getState().playback.progress
    useExportStore.getState().start({
      ...request,
      baseName: stillBaseName(trackName, progress),
      still: { progress, type: stillType },
    })
  }

  const announcement =
    phase === 'starting' || phase === 'rendering'
      ? 'Export en cours…'
      : phase === 'finalizing'
        ? 'Finalisation du fichier…'
        : phase === 'done'
          ? result?.mimeType.startsWith('image/')
            ? 'Image prête.'
            : 'Vidéo prête.'
          : phase === 'canceled'
            ? 'Export annulé.'
            : ''

  return (
    <section className="settings export" aria-labelledby={`${id}-title`} aria-busy={busy}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        Exporter
      </h2>
      <ModifiedMarker keys={['video']} label="Exporter" disabled={busy} />
      {onClose && (
        <button type="button" className="icon-btn settings__close" onClick={onClose} aria-label="Fermer le panneau d'export" title="Fermer (Ctrl+E)">
          <Icon name="x" size={18} />
        </button>
      )}

      <fieldset className="field fieldset" disabled={busy}>
        <legend className="field__label">Format</legend>
        <div className="format-tiles">
          {VIDEO_ASPECTS.map((a) => (
            <label key={a.id} className="format-tile" title={a.label}>
              <input
                type="radio"
                name={`${id}-aspect`}
                value={a.id}
                checked={video.aspect === a.id}
                onChange={() => {
                  update({ aspect: a.id })
                  useAppStore.getState().setFreeFraming(false)
                }}
              />
              <AspectIcon x={a.x} y={a.y} size={28} />
              <span className="format-tile__label">{a.id}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor={`${id}-resolution`}>
          Résolution
        </label>
        <select
          id={`${id}-resolution`}
          className="select"
          value={video.resolution}
          disabled={busy}
          aria-describedby={`${id}-size`}
          onChange={(e) => {
            const resolution = VIDEO_RESOLUTIONS.find((r) => r.id === e.currentTarget.value)
            if (resolution) update({ resolution: resolution.id })
          }}
        >
          {VIDEO_RESOLUTIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <p id={`${id}-size`} className="field__hint">
          {formatNumber(width)} × {formatNumber(height)} pixels
        </p>
      </div>

      <p className="field__hint">
        {formatClock(totalFrames / video.fps)} · {formatNumber(totalFrames)} images, rendues une à une après le
        chargement complet du relief.
        {codec && ` ${CODEC_LABELS[`${codec.container}/${codec.codec}`]}, environ ${formatMegabytes(estimatedBytes)}.`}
      </p>
      {codec === null && (
        <p className="field__hint" role="alert">
          Ce navigateur ne sait pas encoder une vidéo de {formatNumber(width)} × {formatNumber(height)} pixels :
          choisissez une résolution plus petite.
        </p>
      )}

      {!busy && (
        <div className="export__actions">
          <button type="button" className="btn btn--primary" onClick={start} disabled={!trackName || !codec}>
            <Icon name="download" size={18} />
            Exporter la vidéo
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={startStill}
            disabled={!trackName}
            title="Image de la position actuelle de la lecture"
          >
            <Icon name="image" size={18} />
            Image fixe
          </button>
        </div>
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
                    secondsPerImage === null ? '' : ` · ≈ ${formatNumber(secondsPerImage, 1)} s / image`
                  }${etaS === null ? '' : ` · reste environ ${formatClock(etaS)}`}`}
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

      <details className="export__more">
        <summary className="export__more-summary">
          Plus d'options
          <Icon name="chevron-down" size={16} />
        </summary>
        <div className="export__more-body">
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

          <fieldset className="field fieldset" disabled={busy}>
            <legend className="field__label">Type de l'image fixe</legend>
            <div className="segmented">
              {STILL_TYPES.map((t) => (
                <label key={t.value} className="segmented__option">
                  <input
                    type="radio"
                    name={`${id}-still`}
                    value={t.value}
                    checked={stillType === t.value}
                    onChange={() => setStillType(t.value)}
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </details>

      <p className="visually-hidden" role="status">
        {announcement}
      </p>
    </section>
  )
}

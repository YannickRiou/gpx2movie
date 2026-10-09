/**
 * « Affiche » mode of the export drawer: format, style, title, subtitle, figures, weather and « Carte à plat » of the
 * poster, a live thumbnail of its layout (2D only: the last rendered view, or a placeholder with the track's
 * outline), and the button that renders it. The result is saved like the other exports (export drawer, `getPlatform().saveUrl`).
 */
import { errorMessage } from '../core/errors'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { isExportBusy, useExportStore } from '../export/store'
import type { ExportResult } from '../export/store'
import { buildTrackPath } from '../flyover/path'
import { useLandmarkStore } from '../osm/store'
import { loadOverlayFonts } from '../overlay/assets'
import { miniMapOutline } from '../overlay/data'
import { OVERLAY_STYLE_LABELS } from '../overlay/settings'
import { getPlatform } from '../platform'
import { useAppStore } from '../state/store'
import { ModifiedMarker } from '../ui/ModifiedMarker'
import { formatNumber } from '../ui/format'
import { Icon } from '../ui/icons'
import { TextField } from '../ui/PanelSection'
import { withShortcut } from '../ui/shortcuts'
import { effectiveProjectName } from '../ui/shell'
import { showToast } from '../ui/toast'
import { useWeatherStore } from '../weather/store'
import { availableFigures, posterStats } from './content'
import { drawPoster } from './draw'
import { currentPosterContent, posterRows, previewKey, startPoster, usePosterPreview } from './export'
import { posterLayout } from './layout'
import { POSTER_FIGURES, POSTER_FIGURE_LABELS, POSTER_FORMATS, POSTER_STYLES, posterSize } from './settings'
import type { PosterSettings } from './settings'
import './poster.css'

/** Largest size of the thumbnail in the drawer (CSS px). */
const PREVIEW_MAX_W = 260
const PREVIEW_MAX_H = 220

/** Live thumbnail of the poster: the same drawing as the export, scaled down, without rendering the 3D view. */
function PosterPreview({ poster }: { poster: PosterSettings }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tracks = useAppStore((s) => s.tracks)
  const track = tracks[0]
  // what the content reads besides the poster settings: redraw when they change
  const race = useAppStore((s) => s.settings.race.enabled)
  const projectName = useAppStore((s) => s.projectName)
  const terrain = useAppStore((s) => s.settings.terrainSourceId)
  const imagery = useAppStore((s) => s.settings.imagerySourceId)
  const weather = useWeatherStore((s) => s.series)
  const landmarks = useLandmarkStore((s) => s.landmarks)
  const view = usePosterPreview((s) => s.view)
  const [fontsReady, setFontsReady] = useState(false)
  const outline = useMemo(() => (track ? miniMapOutline(buildTrackPath(track)) : undefined), [track])

  useEffect(() => {
    let alive = true
    void loadOverlayFonts().then(() => alive && setFontsReady(true))
    return () => {
      alive = false
    }
  }, [])

  const { width, height } = posterSize(poster.format)
  const scale = Math.min(PREVIEW_MAX_W / width, PREVIEW_MAX_H / height)
  const cssW = Math.round(width * scale)
  const cssH = Math.round(height * scale)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const content = currentPosterContent()
    if (!canvas || !ctx || !content) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    const k = canvas.width / width
    ctx.setTransform(k, 0, 0, k, 0, 0)
    const layout = posterLayout(width, height, poster.style, posterRows(content))
    const shown = view && view.key === previewKey(tracks, poster.flat) ? { image: view.image, width: view.width, height: view.height } : null
    drawPoster(ctx, layout, content, poster.style, shown, outline)
  }, [poster, tracks, race, projectName, terrain, imagery, weather, landmarks, view, fontsReady, outline, width, height, cssW, cssH])

  return (
    <canvas
      ref={canvasRef}
      className="poster__preview"
      style={{ width: cssW, height: cssH }}
      role="img"
      aria-label="Aperçu de l'affiche"
    />
  )
}

/**
 * The poster settings and its export. `modes` is the « Vidéo / Affiche » switch of the drawer, shown under the title.
 */
export function PosterPanel({ modes, onClose, hidden }: { modes: ReactNode; onClose?: () => void; hidden: boolean }) {
  const id = useId()
  const poster = useAppStore((s) => s.settings.poster)
  const setSetting = useAppStore((s) => s.setSetting)
  const tracks = useAppStore((s) => s.tracks)
  const track = tracks[0]
  const race = useAppStore((s) => s.settings.race.enabled)
  const projectName = useAppStore((s) => s.projectName)
  // a set of outings is summed: no weather of a single day
  const outings = tracks.length > 1 && !race
  const hasWeather = useWeatherStore((s) => s.status === 'ready' && s.trackId === track?.id) && !outings
  const { phase, result } = useExportStore()
  const busy = isExportBusy(phase)
  /** the last poster made (shown while it is still the last export) */
  const [done, setDone] = useState<ExportResult | null>(null)

  const available = useMemo(() => (track ? availableFigures(posterStats(tracks, race)) : null), [track, tracks, race])
  const set = (patch: Partial<PosterSettings>) => setSetting('poster', { ...poster, ...patch })
  const { width, height } = posterSize(poster.format)
  const defaultTitle = effectiveProjectName(projectName, track?.name)

  const create = () => {
    setDone(null)
    void startPoster().then((started) => {
      if (!started) return
      const stop = useExportStore.subscribe((s) => {
        if (isExportBusy(s.phase)) return
        stop()
        if (s.phase === 'done') setDone(s.result)
      })
    })
  }

  const saveAgain = (r: ExportResult) => {
    if (!r.url) return
    void getPlatform()
      .saveUrl(r.url, { fileName: r.fileName })
      .catch((err: unknown) => showToast({ kind: 'error', text: `Impossible d'enregistrer « ${r.fileName} » : ${errorMessage(err)}` }))
  }

  return (
    <section className="settings export poster" aria-labelledby={`${id}-title`} aria-busy={busy} hidden={hidden}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        Exporter
      </h2>
      <ModifiedMarker keys={['poster']} label="Affiche" disabled={busy} />
      {onClose && (
        <button
          type="button"
          className="icon-btn settings__close"
          onClick={onClose}
          aria-label="Fermer le panneau d'export"
          data-tip={withShortcut('Fermer', 'export')}
          data-tip-align="end"
        >
          <Icon name="x" size={18} />
        </button>
      )}
      {modes}

      {track ? <PosterPreview poster={poster} /> : <p className="field__hint">Ajoutez une trace pour composer l'affiche.</p>}

      <div className="field">
        <label className="field__label" htmlFor={`${id}-format`}>
          Format
        </label>
        <select
          id={`${id}-format`}
          className="select"
          value={poster.format}
          disabled={busy}
          aria-describedby={`${id}-size`}
          onChange={(e) => {
            const format = POSTER_FORMATS.find((f) => f.id === e.currentTarget.value)
            if (format) set({ format: format.id })
          }}
        >
          {POSTER_FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <p id={`${id}-size`} className="field__hint">
          {formatNumber(width)} × {formatNumber(height)} px{poster.format === 'square' ? '' : ' · 300 dpi'}
        </p>
      </div>

      <fieldset className="field fieldset" disabled={busy}>
        <legend className="field__label">Style</legend>
        <div className="segmented">
          {POSTER_STYLES.map((style) => (
            <label key={style} className="segmented__option">
              <input type="radio" name={`${id}-style`} value={style} checked={poster.style === style} onChange={() => set({ style })} />
              {OVERLAY_STYLE_LABELS[style]}
            </label>
          ))}
        </div>
      </fieldset>

      <TextField label="Titre" value={poster.title} placeholder={defaultTitle} disabled={busy} onChange={(title) => set({ title })} />
      <TextField label="Sous-titre" value={poster.subtitle} placeholder="Avant la date de la sortie" disabled={busy} onChange={(subtitle) => set({ subtitle })} />

      <fieldset className="field fieldset" disabled={busy}>
        <legend className="field__label">Chiffres clés</legend>
        <div className="chips">
          {POSTER_FIGURES.map((figure) => {
            const present = available?.[figure] ?? false
            return (
              <label key={figure} className="chip" title={present ? undefined : 'Absent de cette trace'}>
                <input
                  type="checkbox"
                  checked={poster.figures[figure] && present}
                  disabled={!present}
                  onChange={(e) => set({ figures: { ...poster.figures, [figure]: e.currentTarget.checked } })}
                />
                {POSTER_FIGURE_LABELS[figure]}
              </label>
            )
          })}
        </div>
      </fieldset>

      <label className="checkbox" title={hasWeather ? undefined : outings ? 'Plusieurs sorties : pas de météo du jour' : 'Météo de la sortie non chargée'}>
        <input
          type="checkbox"
          checked={poster.weather && hasWeather}
          disabled={busy || !hasWeather}
          onChange={(e) => set({ weather: e.currentTarget.checked })}
        />
        Météo du jour
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={poster.flat} disabled={busy} onChange={(e) => set({ flat: e.currentTarget.checked })} />
        Carte à plat
      </label>
      <p className="field__hint">
        {poster.flat ? "Carte vue d'en haut, tirée de l'imagerie choisie" : 'Vue 3D'}
        {tracks.length > 1 ? ' de toutes les traces' : ' de toute la trace'}, nord en haut. Les crédits des sources figurent en petit au
        bas de l'affiche.
      </p>

      {!busy && (
        <button type="button" className="btn btn--primary" onClick={create} disabled={!track}>
          <Icon name="map" size={18} />
          Créer l'affiche
        </button>
      )}
      {busy && (
        <div className="field">
          <p className="field__hint">{phase === 'finalizing' ? "Composition de l'affiche…" : 'Rendu de la vue 3D…'}</p>
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => useExportStore.getState().cancel()}
            disabled={phase === 'finalizing'}
          >
            Annuler
          </button>
        </div>
      )}
      {!busy && done && done === result && (
        <p className="field__hint">
          {done.fileName} ({formatNumber(done.sizeBytes / 1e6, 1)} Mo){' '}
          <button type="button" className="poster__again" onClick={() => saveAgain(done)}>
            Enregistrer à nouveau…
          </button>
        </p>
      )}
    </section>
  )
}

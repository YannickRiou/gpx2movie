import { useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { useMediaStore } from '../film/media'
import { ITEM_DURATION_RANGE, MEDIA_LAYOUTS, SHOT_DURATION_RANGE, SHOT_STYLES, STOP_CAMERAS, STOP_DURATION_RANGE } from '../film/model'
import type { Film, MediaLayout, ShotStyle, StopCamera } from '../film/model'
import {
  formatFilmTime,
  formatSpeedFactor,
  removeFilmItem,
  updateMedia,
  updateShot,
  updateSpeed,
  updateStop,
  updateText,
} from '../film/timeline'
import { OVERLAY_ANCHORS, OVERLAY_ANCHOR_LABELS, WIDGET_SIZE_MAX, WIDGET_SIZE_MIN } from '../overlay/settings'
import type { OverlayAnchor } from '../overlay/settings'
import { editFilm, useFilmClock, useFilmSource } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { formatDistance, formatNumber } from './format'
import { Icon } from './icons'
import { nextGridIndex } from './shell'

const SHOT_STYLE_LABELS: Record<ShotStyle, string> = { aucune: 'Aucune', descente: 'Descente', saut: 'Saut' }
const SHOT_HINTS: Record<ShotStyle, string> = {
  aucune: 'Le film commence ou finit directement sur le survol.',
  descente: "La caméra glisse entre la vue d'ensemble de la trace et le survol.",
  saut: "La vue d'ensemble est tenue, puis la caméra rejoint vite le survol.",
}
const CAMERA_LABELS: Record<StopCamera, string> = { orbite: 'Orbite', fixe: 'Fixe' }
const LAYOUT_LABELS: Record<MediaLayout, string> = { 'plein-ecran': 'Plein écran', carte: 'Carte' }
const SIZE_RANGE = { min: WIDGET_SIZE_MIN, max: WIDGET_SIZE_MAX, step: 0.1 }
/** Quick choices of a speed portion, and its slider in powers of two (×0,25 to ×4). */
const SPEED_CHIPS = [0.25, 0.5, 1.5, 2, 3, 4]
const SPEED_SLIDER = { min: -2, max: 2, step: 0.05 }
const km = (m: number) => Math.round(m / 10) / 100

const seconds = (s: number) => `${formatNumber(s, Number.isInteger(s) ? 0 : 1)} s`

/** Position in the frame as a 3 × 3 grid of radio buttons (the arrows move and choose, like native radios). */
function AnchorPicker({ label, value, onChange }: { label: string; value: OverlayAnchor; onChange(anchor: OverlayAnchor): void }) {
  const id = useId()
  const cells = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <div className="field">
      <span id={`${id}-label`} className="field__label">
        {label}
      </span>
      <div className="anchor-picker">
        <div className="anchor-picker__grid" role="radiogroup" aria-labelledby={`${id}-label`}>
          {OVERLAY_ANCHORS.map((anchor, i) => (
            <button
              key={anchor}
              ref={(el) => {
                cells.current[i] = el
              }}
              type="button"
              role="radio"
              className="anchor-picker__cell"
              aria-checked={anchor === value}
              aria-label={OVERLAY_ANCHOR_LABELS[anchor]}
              tabIndex={anchor === value ? 0 : -1}
              onClick={() => onChange(anchor)}
              onKeyDown={(e) => {
                const next = nextGridIndex(i, e.key, 3, OVERLAY_ANCHORS.length)
                if (next === null) return
                e.preventDefault()
                onChange(OVERLAY_ANCHORS[next])
                cells.current[next]?.focus()
              }}
            />
          ))}
        </div>
        <span className="anchor-picker__value" aria-hidden="true">
          {OVERLAY_ANCHOR_LABELS[value]}
        </span>
      </div>
    </div>
  )
}

/**
 * Settings of the block selected on the timeline (`filmSelection`), in the right dock: opening / closing shot, stop,
 * speed portion, text, photo or video. Typing is merged into one undo step; editing a generated stop writes the stops out first.
 */
export function FilmInspector() {
  const id = useId()
  const pictures = useMediaStore((s) => s.table)
  const item = useAppStore((s) => s.filmSelection)
  const { track, film, pacing } = useFilmSource()
  const clock = useFilmClock()
  if (!item || !track) return null
  const lengthM = track.stats.distanceM
  const change = (fn: (f: Film) => Film, stops: boolean) => editFilm((f) => ({ film: fn(f) }), { stops, step: false })
  const close = () => useAppStore.getState().setFilmSelection(null)
  const range = (
    key: string,
    label: string,
    value: number,
    r: { min: number; max: number; step: number },
    format: (v: number) => string,
    set: (v: number) => void,
    disabled = false,
  ) => (
    <div className="field">
      <label className="field__label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <div className="range-row">
        <input
          id={`${id}-${key}`}
          className="range"
          type="range"
          min={r.min}
          max={r.max}
          step={r.step}
          value={value}
          disabled={disabled}
          onChange={(e) => set(Number(e.currentTarget.value))}
          aria-valuetext={format(value)}
        />
        <output className="range-row__value" htmlFor={`${id}-${key}`}>
          {format(value)}
        </output>
      </div>
    </div>
  )
  const text = (key: string, label: string, value: string, set: (v: string) => void) => (
    <div className="field">
      <label className="field__label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <input id={`${id}-${key}`} className="input" type="text" value={value} onChange={(e) => set(e.currentTarget.value)} />
    </div>
  )
  const number = (key: string, label: string, value: number, min: number, max: number, set: (v: number) => void) => (
    <div className="field">
      <label className="field__label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        className="input"
        type="number"
        min={min}
        max={max}
        step={0.1}
        value={value}
        onChange={(e) => {
          const v = e.currentTarget.valueAsNumber
          if (Number.isFinite(v)) set(v)
        }}
      />
    </div>
  )

  const anchorSelect = (label: string, value: OverlayAnchor, set: (anchor: OverlayAnchor) => void) => (
    <AnchorPicker label={label} value={value} onChange={set} />
  )
  const timing = (startS: number, durationS: number, set: (patch: { startS?: number; durationS?: number }) => void) => (
    <div className="film-inspector__row">
      {number('start', 'Début (s)', startS, 0, clock.totalTime(), (v) => set({ startS: v }))}
      {number('length', 'Durée (s)', durationS, ITEM_DURATION_RANGE.min, ITEM_DURATION_RANGE.max, (v) => set({ durationS: v }))}
    </div>
  )

  let title: string
  let body: ReactNode
  let removeLabel = 'Supprimer'
  let removable = true
  let isStop = false
  if (item === 'opening' || item === 'closing') {
    const shot = film[item]
    title = item === 'opening' ? 'Ouverture' : 'Clôture'
    removeLabel = 'Sans plan'
    removable = shot.style !== 'aucune'
    body = (
      <>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-style`}>
            Style
          </label>
          <select
            id={`${id}-style`}
            className="select"
            value={shot.style}
            aria-describedby={`${id}-style-hint`}
            onChange={(e) => change((f) => updateShot(f, item, { style: e.currentTarget.value as ShotStyle }), false)}
          >
            {SHOT_STYLES.map((style) => (
              <option key={style} value={style}>
                {SHOT_STYLE_LABELS[style]}
              </option>
            ))}
          </select>
          <p id={`${id}-style-hint`} className="field__hint">
            {SHOT_HINTS[shot.style]}
          </p>
        </div>
        {range(
          'duration',
          'Durée',
          shot.durationS,
          SHOT_DURATION_RANGE,
          seconds,
          (durationS) => change((f) => updateShot(f, item, { durationS }), false),
          shot.style === 'aucune',
        )}
      </>
    )
  } else {
    const stop = clock.stops.find((s) => s.id === item)
    const speed = clock.speeds.find((s) => s.id === item)
    const filmText = film.texts.find((t) => t.id === item)
    const media = film.media.find((m) => m.id === item)
    if (stop) {
      isStop = true
      title = 'Arrêt'
      const set = (patch: Parameters<typeof updateStop>[2]) => change((f) => updateStop(f, item, patch), true)
      body = (
        <>
          {text('label', 'Libellé', stop.label ?? '', (label) => set({ label }))}
          {range('duration', 'Durée', stop.durationS, STOP_DURATION_RANGE, seconds, (durationS) => set({ durationS }))}
          <fieldset className="field fieldset">
            <legend className="field__label">Caméra</legend>
            <div className="segmented">
              {STOP_CAMERAS.map((camera) => (
                <label key={camera} className="segmented__option">
                  <input type="radio" name={`${id}-camera`} value={camera} checked={stop.camera === camera} onChange={() => set({ camera })} />
                  {CAMERA_LABELS[camera]}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="field__hint">
            À {formatDistance(stop.atM)} sur {formatDistance(lengthM)}, de {formatFilmTime(stop.startS)} à {formatFilmTime(stop.endS)}
            {film.autoStops && ' · arrêt automatique : le retoucher fige les arrêts'}
          </p>
        </>
      )
    } else if (speed) {
      title = 'Vitesse'
      const set = (patch: Parameters<typeof updateSpeed>[2]) => change((f) => updateSpeed(f, item, patch, lengthM), false)
      const factor = formatSpeedFactor(speed.factor)
      const how = speed.factor > 1 ? `accéléré (${factor})` : speed.factor < 1 ? `ralenti (${factor})` : 'à vitesse normale'
      body = (
        <>
          <div className="field">
            <span id={`${id}-factor-label`} className="field__label">
              Vitesse
            </span>
            <div className="sun-chips" role="group" aria-labelledby={`${id}-factor-label`}>
              {SPEED_CHIPS.map((f) => (
                <button
                  key={f}
                  type="button"
                  className="sun-chip"
                  aria-pressed={speed.factor === f}
                  onClick={() => editFilm((g) => ({ film: updateSpeed(g, item, { factor: f }, lengthM) }))}
                >
                  {formatSpeedFactor(f)}
                </button>
              ))}
            </div>
          </div>
          {range('factor', 'Réglage fin', Math.log2(speed.factor), SPEED_SLIDER, (v) => formatSpeedFactor(2 ** v), (v) => set({ factor: 2 ** v }))}
          <div className="film-inspector__row">
            {number('from', 'De (km)', km(speed.fromM), 0, km(lengthM), (v) => set({ fromM: v * 1000 }))}
            {number('to', 'À (km)', km(speed.toM), 0, km(lengthM), (v) => set({ toM: v * 1000 }))}
          </div>
          <p className="field__hint">
            Survol {how} de {formatDistance(speed.fromM)} à {formatDistance(speed.toM)}, de {formatFilmTime(speed.startS)} à{' '}
            {formatFilmTime(speed.endS)} dans le film. La vitesse change en douceur aux bords.
            {pacing.keepDuration ? ' La durée du survol ne change pas : le reste du parcours s’adapte.' : ' La durée du film change d’autant.'}
          </p>
        </>
      )
    } else if (filmText) {
      title = 'Texte'
      const set = (patch: Parameters<typeof updateText>[2]) => change((f) => updateText(f, item, patch), false)
      body = (
        <>
          {text('text', 'Texte', filmText.text, (value) => set({ text: value }))}
          {text('subtitle', 'Sous-titre', filmText.subtitle ?? '', (subtitle) => set({ subtitle: subtitle || undefined }))}
          {anchorSelect('Position', filmText.anchor, (anchor) => set({ anchor }))}
          {range('size', 'Taille', filmText.size, SIZE_RANGE, (v) => `×${formatNumber(v, 1)}`, (size) => set({ size }))}
          {timing(filmText.startS, filmText.durationS, set)}
          <p className="field__hint">Le texte s'affichera dans l'habillage du film.</p>
        </>
      )
    } else if (media) {
      const video = media.kind === 'video'
      title = video ? 'Vidéo' : 'Photo'
      const set = (patch: Parameters<typeof updateMedia>[2]) => change((f) => updateMedia(f, item, patch), false)
      const picture = pictures[media.src]
      const card = media.layout === 'carte'
      const fileS = picture?.durationS ?? ITEM_DURATION_RANGE.max
      body = (
        <>
          {picture && <img className="film-inspector__thumb" src={picture.thumb} alt={picture.name ?? title} />}
          <fieldset className="field fieldset">
            <legend className="field__label">Affichage</legend>
            <div className="segmented">
              {MEDIA_LAYOUTS.map((layout) => (
                <label key={layout} className="segmented__option">
                  <input type="radio" name={`${id}-layout`} value={layout} checked={media.layout === layout} onChange={() => set({ layout })} />
                  {LAYOUT_LABELS[layout]}
                </label>
              ))}
            </div>
          </fieldset>
          {!video && (
            <label className="checkbox">
              <input type="checkbox" checked={media.kenBurns} disabled={card} onChange={(e) => set({ kenBurns: e.currentTarget.checked })} />
              Mouvement lent (Ken Burns)
            </label>
          )}
          {text('caption', 'Légende', media.caption ?? '', (caption) => set({ caption: caption || undefined }))}
          {anchorSelect(card ? 'Position' : 'Position de la légende', media.anchor, (anchor) => set({ anchor }))}
          {range('size', 'Taille', media.size, SIZE_RANGE, (v) => `×${formatNumber(v, 1)}`, (size) => set({ size }))}
          {timing(media.startS, media.durationS, set)}
          {video && number('in', 'Début dans la vidéo (s)', media.inS ?? 0, 0, fileS, (inS) => set({ inS: Math.min(inS, fileS) }))}
          <p className="field__hint">
            {card ? `La ${title.toLowerCase()} s’affiche encadrée, au style de l’habillage.` : `La ${title.toLowerCase()} couvre la vue 3D, en fondu.`}
            {video && picture?.durationS !== undefined && ` Vidéo de ${formatFilmTime(fileS)} ; au-delà de sa fin, la dernière image reste affichée.`}
            {video && ' Le son n’est pas encore pris en charge : la vidéo est muette.'}
          </p>
        </>
      )
    } else {
      return null
    }
  }

  const remove = () => editFilm((f) => ({ film: removeFilmItem(f, item), id: null }), { stops: isStop })

  return (
    <section
      className="settings film-inspector"
      aria-labelledby={`${id}-title`}
      onKeyDown={(e) => {
        // Escape in a field (the shell's shortcuts leave text entries alone)
        if (e.key === 'Escape') close()
      }}
    >
      <h2 id={`${id}-title`} className="section-title settings__title">
        {title}
      </h2>
      <button type="button" className="icon-btn settings__close" onClick={close} aria-label="Fermer l'inspecteur" data-tip="Fermer (Échap)" data-tip-align="end">
        <Icon name="x" size={18} />
      </button>
      {body}
      <button type="button" className="btn btn--secondary film-inspector__remove" onClick={remove} disabled={!removable}>
        {removeLabel}
      </button>
    </section>
  )
}

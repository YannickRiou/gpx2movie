import { useId } from 'react'
import type { ReactNode } from 'react'
import type { FilmClock } from '../film/clock'
import { useMediaStore } from '../film/media'
import { ITEM_DURATION_RANGE, MEDIA_LAYOUTS, SHOT_DURATION_RANGE, SHOT_STYLES, STOP_CAMERAS, STOP_DURATION_RANGE } from '../film/model'
import type { Film, MediaLayout, ShotStyle, StopCamera } from '../film/model'
import { formatFilmTime, updateMedia, updateShot, updateStop, updateText } from '../film/timeline'
import type { TimelineItem } from '../film/timeline'
import { OVERLAY_ANCHORS, OVERLAY_ANCHOR_LABELS, WIDGET_SIZE_MAX, WIDGET_SIZE_MIN } from '../overlay/settings'
import type { OverlayAnchor } from '../overlay/settings'
import { formatDistance, formatNumber } from './format'

const SHOT_STYLE_LABELS: Record<ShotStyle, string> = { aucune: 'Aucune', descente: 'Descente', saut: 'Saut' }
const SHOT_HINTS: Record<ShotStyle, string> = {
  aucune: 'Le film commence ou finit directement sur le survol.',
  descente: "La caméra glisse entre la vue d'ensemble de la trace et le survol.",
  saut: "La vue d'ensemble est tenue, puis la caméra rejoint vite le survol.",
}
const CAMERA_LABELS: Record<StopCamera, string> = { orbite: 'Orbite', fixe: 'Fixe' }
const LAYOUT_LABELS: Record<MediaLayout, string> = { 'plein-ecran': 'Plein écran', carte: 'Carte' }
const SIZE_RANGE = { min: WIDGET_SIZE_MIN, max: WIDGET_SIZE_MAX, step: 0.1 }

const seconds = (s: number) => `${formatNumber(s, Number.isInteger(s) ? 0 : 1)} s`

interface Props {
  item: TimelineItem
  /** committed film and its clock */
  film: Film
  clock: FilmClock
  lengthM: number
  /** edit the film (`stops`: generated stops written out first) */
  change(fn: (film: Film) => Film, stops: boolean): void
  remove(): void
  close(): void
}

/** Settings of the item selected on the timeline: opening / closing shot, stop, text or photo. */
export function FilmInspector({ item, film, clock, lengthM, change, remove, close }: Props) {
  const id = useId()
  const pictures = useMediaStore((s) => s.table)
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
    <div className="field">
      <label className="field__label" htmlFor={`${id}-anchor`}>
        {label}
      </label>
      <select id={`${id}-anchor`} className="select" value={value} onChange={(e) => set(e.currentTarget.value as OverlayAnchor)}>
        {OVERLAY_ANCHORS.map((anchor) => (
          <option key={anchor} value={anchor}>
            {OVERLAY_ANCHOR_LABELS[anchor]}
          </option>
        ))}
      </select>
    </div>
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
    const filmText = film.texts.find((t) => t.id === item)
    const media = film.media.find((m) => m.id === item)
    if (stop) {
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
      title = 'Photo'
      const set = (patch: Parameters<typeof updateMedia>[2]) => change((f) => updateMedia(f, item, patch), false)
      const picture = pictures[media.src]
      const card = media.layout === 'carte'
      body = (
        <>
          {picture && <img className="film-inspector__thumb" src={picture.thumb} alt={picture.name ?? 'Photo'} />}
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
          <label className="checkbox">
            <input type="checkbox" checked={media.kenBurns} disabled={card} onChange={(e) => set({ kenBurns: e.currentTarget.checked })} />
            Mouvement lent (Ken Burns)
          </label>
          {text('caption', 'Légende', media.caption ?? '', (caption) => set({ caption: caption || undefined }))}
          {anchorSelect(card ? 'Position' : 'Position de la légende', media.anchor, (anchor) => set({ anchor }))}
          {range('size', 'Taille', media.size, SIZE_RANGE, (v) => `×${formatNumber(v, 1)}`, (size) => set({ size }))}
          {timing(media.startS, media.durationS, set)}
          <p className="field__hint">
            {card ? 'La photo s’affiche encadrée, au style de l’habillage.' : 'La photo couvre la vue 3D, en fondu.'}
          </p>
        </>
      )
    } else {
      return null
    }
  }

  return (
    <section className="film-inspector" aria-labelledby={`${id}-title`}>
      <header className="film-inspector__header">
        <h2 id={`${id}-title`} className="film-inspector__title">
          {title}
        </h2>
        <button type="button" className="film-inspector__close" onClick={close} aria-label="Fermer l'inspecteur" data-tip="Fermer (Échap)" data-tip-side="left">
          ×
        </button>
      </header>
      {body}
      <button type="button" className="btn btn--secondary film-inspector__remove" onClick={remove} disabled={!removable}>
        {removeLabel}
      </button>
    </section>
  )
}

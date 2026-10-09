import { useId, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { DUCK_DB, fitFilmToMusic, musicLengthS, snapFilmToMusic } from '../film/audio'
import { useMediaStore } from '../film/media'
import {
  AUDIO_DURATION_RANGE,
  DIP_DEFAULT_S,
  DIP_DURATION_RANGE,
  FADE_RANGE,
  ITEM_DURATION_RANGE,
  MEDIA_LAYOUTS,
  SHOT_DURATION_RANGE,
  SHOT_STYLES,
  SHOT_TRANSITIONS,
  SHOT_TRANSITION_LABELS,
  SITUATION_BEARING_RANGE,
  SITUATION_DISTANCE_KM_RANGE,
  SITUATION_HEADINGS,
  SITUATION_HEADING_LABELS,
  SITUATION_HEADROOM_RANGE,
  SITUATION_HOLD_RANGE,
  SITUATION_TILT_DEFAULT_DEG,
  SITUATION_TILT_RANGE,
  START_HEIGHTS,
  START_HEIGHT_LABELS,
  STOP_CAMERAS,
  STOP_CAMERA_LABELS,
  STOP_DURATION_RANGE,
  SYNC_OFFSET_RANGE,
  shotDipColor,
  situationTiming,
} from '../film/model'
import type { Film, FilmShot, MediaLayout, MediaSync, ShotStyle, ShotTransition, StartHeight, StopCamera } from '../film/model'
import {
  addItemCamera,
  attachToStop,
  clipSyncOffsetS,
  formatFilmTime,
  formatSpeedFactor,
  removeFilmItem,
  setFilmPlace,
  updateCameraKey,
  updateMedia,
  updateMusic,
  updateShot,
  updateSpeed,
  updateStop,
  syncClip,
  syncClipPlacement,
  updateText,
} from '../film/timeline'
import { cameraKeyEaseM, keyedCamera } from '../flyover/cameraKeys'
import { CAMERA_RANGES } from '../flyover/cameraSettings'
import { buildTrackPath } from '../flyover/path'
import { SHOT_SUN_HOURS } from '../flyover/sun'
import { REGION_KIND_LABELS, candidateId, captureFraming, useRegionStore, type RegionStatus } from '../osm/region'
import { OVERLAY_ANCHORS, OVERLAY_ANCHOR_LABELS, WIDGET_SIZE_MAX, WIDGET_SIZE_MIN } from '../overlay/settings'
import type { OverlayAnchor } from '../overlay/settings'
import { editFilm, useFilmClock, useFilmSource } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { formatDegrees, formatDistance, formatNumber, formatPercent } from './format'
import { Icon } from './icons'
import { FilmTextStyleFields } from './OverlayPanel'
import { InfoTip, MoreSettings, RangeField } from './PanelSection'
import { nextGridIndex } from './shell'
import { showToast } from './toast'

const SHOT_STYLE_LABELS: Record<ShotStyle, string> = {
  aucune: 'Aucune',
  descente: 'Descente',
  saut: 'Saut',
  situation: 'Depuis la région',
  balayage: 'Balayage',
}
const SHOT_HINTS: Record<ShotStyle, string> = {
  aucune: 'Le film commence ou finit directement sur le survol.',
  descente: "La caméra glisse entre la vue d'ensemble de la trace et le survol.",
  saut: "La vue d'ensemble est tenue, puis la caméra rejoint vite le survol.",
  situation: 'La caméra glisse entre une vue de très haut sur la région et le survol.',
  balayage: "La vue d'ensemble tourne lentement autour de la trace, puis la caméra glisse vers le survol (à la fin : l'inverse).",
}
const TRANSITION_HINTS: Record<ShotTransition, string> = {
  enchaine: 'La caméra passe du plan au survol en un seul mouvement.',
  coupe: 'Le plan reste fixe ; l’image passe d’un coup entre le plan et le survol.',
  'fondu-noir': 'Le plan reste fixe ; l’image passe par le noir entre le plan et le survol.',
  'fondu-blanc': 'Le plan reste fixe ; l’image passe par le blanc entre le plan et le survol.',
}
/** « Mettre en avant la région »: what it does, then how the search for the region went (found: after its name). */
const REGION_HINTS: Record<RegionStatus, string> = {
  idle: 'Assombrit les alentours de la région administrative de la sortie (OpenStreetMap) et la cadre en entier.',
  loading: 'Recherche de la région…',
  ready: 'les alentours sont assombris, la vue cadre la région entière.',
  none: 'Aucune région administrative ne contient toute la trace : le plan reste sans mise en avant.',
  error: 'Région indisponible pour le moment (hors ligne ?) : le plan reste sans mise en avant.',
}
/** Hint under « Mettre en avant la région » (`highlight` on: how the search for the region went). */
export function RegionHint({ id, highlight }: { id: string; highlight: boolean }) {
  const regionStatus = useRegionStore((s) => s.status)
  const regionName = useRegionStore((s) => s.region?.name)
  return (
    <p id={id} className="field__hint">
      {highlight && regionStatus === 'ready' && regionName ? `${regionName} : ` : ''}
      {REGION_HINTS[highlight ? regionStatus : 'idle']}
    </p>
  )
}

/** Titled group of fields of a 'situation' shot (« Lieu », « Durées », « Cadrage », « Soleil »). */
function InspectorGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="film-inspector__group" aria-labelledby={id}>
      <h3 id={id} className="film-inspector__group-title">
        {title}
      </h3>
      {children}
    </section>
  )
}

/**
 * « Durées » of a 'situation' shot: « Maintien » on the region view, then the move (« Plongée » at the opening,
 * « Remontée » at the closing, held after it); the shot lasts their sum (`durationS`, read by the clock and the
 * timeline), at most SHOT_DURATION_RANGE.max: a longer move shortens the hold, never the other way.
 */
function SituationTimings({
  phase,
  durationS,
  holdS,
  onChange,
}: {
  phase: 'opening' | 'closing'
  durationS: number
  holdS: number | undefined
  onChange(patch: { durationS: number; holdS: number | undefined }): void
}) {
  const timing = situationTiming({ durationS, holdS })
  const max = SHOT_DURATION_RANGE.max
  const set = (hold: number, move: number) => {
    const moveS = Math.min(Math.max(move, SHOT_DURATION_RANGE.min), max)
    const kept = Math.min(hold, max - moveS)
    onChange({ durationS: kept + moveS, holdS: kept > 0 ? kept : undefined })
  }
  return (
    <InspectorGroup title="Durées">
      <RangeField
        label="Maintien"
        {...SITUATION_HOLD_RANGE}
        value={timing.holdS}
        format={seconds}
        onChange={(hold) => set(hold, timing.moveS)}
        wide={false}
        tip={
          phase === 'opening'
            ? 'Temps passé immobile sur la vue de la région, région en pleine lumière, avant la plongée.'
            : 'Temps passé immobile sur la vue de la région à la fin du film.'
        }
      />
      <RangeField
        label={phase === 'opening' ? 'Plongée' : 'Remontée'}
        {...SHOT_DURATION_RANGE}
        value={timing.moveS}
        format={seconds}
        onChange={(move) => set(timing.holdS, move)}
        wide={false}
        tip={
          phase === 'opening'
            ? 'Durée du mouvement de la vue de la région jusqu’au survol ; la mise en avant s’efface pendant ce temps.'
            : 'Durée du mouvement du survol jusqu’à la vue de la région ; la mise en avant apparaît pendant ce temps.'
        }
      />
      <p className="field__hint">Durée du plan : {seconds(durationS)}</p>
    </InspectorGroup>
  )
}

/**
 * « Cadrage » of the region view of a 'situation' shot: start (end) height, distance (« Auto » at the left of its
 * slider), tilt, heading free or north up with its bearing, « Capturer la vue actuelle »; the headroom in « Plus de
 * réglages ». Every field left at its default keeps the automatic framing.
 */
function SituationFramingFields({
  phase,
  shot,
  onChange,
}: {
  phase: 'opening' | 'closing'
  shot: FilmShot
  onChange(patch: Partial<FilmShot>): void
}) {
  const id = useId()
  const heading = shot.heading ?? 'libre'
  const capture = () => {
    const framing = captureFraming(shot.highlight === true)
    if (!framing) return void showToast({ kind: 'error', text: 'Vue 3D indisponible : rien à capturer.' })
    onChange({ ...framing, heading: 'boussole' })
    showToast({ kind: 'success', text: 'Cadrage repris de la vue 3D' })
  }
  return (
    <InspectorGroup title="Cadrage">
      <div className="field">
        <label className="field__label" htmlFor={`${id}-height`}>
          {phase === 'opening' ? 'Hauteur de départ' : 'Hauteur de fin'}
        </label>
        <select
          id={`${id}-height`}
          className="select"
          value={shot.startHeight ?? 'region'}
          disabled={shot.distanceKm !== undefined}
          onChange={(e) => onChange({ startHeight: e.currentTarget.value as StartHeight })}
        >
          {START_HEIGHTS.map((height) => (
            <option key={height} value={height}>
              {START_HEIGHT_LABELS[height]}
            </option>
          ))}
        </select>
      </div>
      <RangeField
        label="Distance"
        min={0}
        max={SITUATION_DISTANCE_KM_RANGE.max}
        step={SITUATION_DISTANCE_KM_RANGE.step}
        value={shot.distanceKm ?? 0}
        format={(km) => (km === 0 ? 'Auto' : `${formatNumber(km)} km`)}
        onChange={(km) => onChange({ distanceKm: km === 0 ? undefined : Math.max(km, SITUATION_DISTANCE_KM_RANGE.min) })}
        tip="Distance de la caméra au centre de la vue. Tout à gauche : automatique (la région entière, ou selon la hauteur de départ)."
      />
      <RangeField
        label="Inclinaison"
        {...SITUATION_TILT_RANGE}
        value={shot.tiltDeg ?? SITUATION_TILT_DEFAULT_DEG}
        format={formatDegrees}
        onChange={(tiltDeg) => onChange({ tiltDeg })}
        wide={false}
        tip="Écart de la caméra par rapport à la verticale : petit, la carte vue d’au-dessus ; grand, la vue rasante."
      />
      <div className="field">
        <div className="field__label-row">
          <span id={`${id}-heading`} className="field__label">
            Cap
          </span>
          <InfoTip text="Libre : la vue de la région regarde dans le sens du survol, sans tourner pendant le mouvement. Boussole : le nord en haut, tourné de l’orientation." />
        </div>
        <div className="segmented" role="radiogroup" aria-labelledby={`${id}-heading`}>
          {SITUATION_HEADINGS.map((h) => (
            <label key={h} className="segmented__option">
              <input type="radio" name={`${id}-heading`} value={h} checked={heading === h} onChange={() => onChange({ heading: h === 'libre' ? undefined : h })} />
              {SITUATION_HEADING_LABELS[h]}
            </label>
          ))}
        </div>
      </div>
      {heading === 'boussole' && (
        <RangeField
          label="Orientation"
          {...SITUATION_BEARING_RANGE}
          value={shot.bearingDeg ?? 0}
          format={formatDegrees}
          onChange={(bearingDeg) => onChange({ bearingDeg: bearingDeg === 0 ? undefined : bearingDeg })}
          wide={false}
          tip="Direction regardée par la caméra : 0° le nord en haut, 90° l’est en haut."
        />
      )}
      <MoreSettings paths={[]}>
        <RangeField
          label="Marge"
          {...SITUATION_HEADROOM_RANGE}
          value={shot.headroomPct ?? 0}
          format={(pct) => `${formatNumber(pct)} %`}
          onChange={(pct) => onChange({ headroomPct: pct === 0 ? undefined : pct })}
          wide={false}
          tip="Place laissée au-dessus du centre de la vue (titre, ciel) : le centre descend de cette part de la hauteur de l’image."
        />
      </MoreSettings>
      <button type="button" className="btn btn--secondary" onClick={capture} data-tip="Reprend l’inclinaison, la distance et l’orientation de la vue 3D actuelle (cap Boussole)">
        <Icon name="crosshair" size={16} />
        Capturer la vue actuelle
      </button>
    </InspectorGroup>
  )
}

/**
 * « Lieu »: the place highlighted, among the areas that contain the track (smallest first, osm/region.ts), or the
 * automatic administrative region. A place saved but not offered (still loading, or no longer containing the track)
 * stays selected; the highlight then falls back to the automatic one.
 */
function PlaceSelect({ value, onChange }: { value: string | null; onChange(regionId: string | null): void }) {
  const id = useId()
  const candidates = useRegionStore((s) => s.candidates)
  const autoId = useRegionStore((s) => s.autoId)
  const loading = useRegionStore((s) => s.status === 'loading')
  const auto = candidates.find((c) => candidateId(c) === autoId)
  const known = value === null || candidates.some((c) => candidateId(c) === value)
  return (
    <div className="field">
      <div className="field__label-row">
        <label className="field__label" htmlFor={id}>
          Lieu
        </label>
        <InfoTip text="La zone mise en avant et cadrée : région administrative, parc, espace protégé, île ou massif qui contient toute la trace (OpenStreetMap), du plus petit au plus grand." />
      </div>
      <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value || null)}>
        <option value="">{auto ? `Automatique (${auto.name})` : 'Automatique'}</option>
        {candidates.map((c) => (
          <option key={candidateId(c)} value={candidateId(c)}>
            {c.name} · {REGION_KIND_LABELS[c.kind]}
          </option>
        ))}
        {!known && <option value={value ?? ''}>{loading ? 'Recherche des lieux…' : 'Lieu enregistré (introuvable)'}</option>}
      </select>
    </div>
  )
}
const STOP_CAMERA_HINTS: Record<StopCamera, string> = {
  film: 'La caméra du survol continue, sans mouvement ajouté.',
  orbite: 'La caméra tourne lentement autour du point, puis revient.',
  large: 'La caméra recule et monte pour une vue large, puis revient.',
  fixe: 'Le cadrage reste immobile pendant l’arrêt.',
}
const LAYOUT_LABELS: Record<MediaLayout, string> = { 'plein-ecran': 'Plein écran', carte: 'Carte' }
const SIZE_RANGE = { min: WIDGET_SIZE_MIN, max: WIDGET_SIZE_MAX, step: 0.1 }
/** Quick choices of a speed portion, and its slider in powers of two (×0,25 to ×4). */
const SPEED_CHIPS = [0.25, 0.5, 1.5, 2, 3, 4]
const SPEED_SLIDER = { min: -2, max: 2, step: 0.05 }
const km = (m: number) => Math.round(m / 10) / 100

const seconds = (s: number) => `${formatNumber(s, Number.isInteger(s) ? 0 : 1)} s`
const VOLUME_RANGE = { min: 0, max: 1, step: 0.01 }
const percent = formatPercent
const FADE_SLIDER = { min: FADE_RANGE.min, max: 10, step: FADE_RANGE.step }


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
 * Settings of the block selected on the timeline (`filmSelection`), in the right dock: opening / closing shot, stop, camera key,
 * speed portion, text, photo or video. Typing is merged into one undo step; editing a generated stop writes the stops out first.
 */
export function FilmInspector() {
  const id = useId()
  const pictures = useMediaStore((s) => s.table)
  const item = useAppStore((s) => s.filmSelection)
  const { track, film, pacing } = useFilmSource()
  const clock = useFilmClock()
  const path = useMemo(() => (track ? buildTrackPath(track) : null), [track])
  const atmosphere = useAppStore((s) => s.settings.atmosphere)
  if (!item || !track || !path) return null
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
  ) => <RangeField key={key} label={label} {...r} value={value} format={format} onChange={set} disabled={disabled} wide={false} />
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

  /** « Attaché à » a stop of the film (generated stops are written out first), or to none */
  const attachSelect = (stopId: string | undefined) => (
    <div className="field">
      <label className="field__label" htmlFor={`${id}-stop`}>
        Attaché à
      </label>
      <select
        id={`${id}-stop`}
        className="select"
        value={stopId ?? ''}
        aria-describedby={`${id}-stop-hint`}
        onChange={(e) => {
          const stop = clock.stops.find((s) => s.id === e.currentTarget.value) ?? null
          editFilm((f) => ({ film: attachToStop(f, item, stop) }), { stops: stop !== null })
        }}
      >
        <option value="">Aucun arrêt</option>
        {clock.stops.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label || 'Arrêt'} · {formatDistance(s.atM)}
          </option>
        ))}
      </select>
      <p id={`${id}-stop-hint`} className="field__hint">
        {stopId ? 'Suit l’arrêt quand il se déplace ; redevient libre si l’arrêt est supprimé.' : 'Attaché, il suit l’arrêt quand on le déplace.'}
      </p>
    </div>
  )

  /** « Cadrer la caméra ici »: a camera key of its own while the item shows (`addItemCamera`), selected to adjust */
  const itemCamera = (startS: number, durationS: number) => (
    <button
      type="button"
      className="btn btn--secondary"
      data-tip="Pose un cadrage au début (à régler) et rend celui d'avant à la fin"
      onClick={() => {
        const { camera, flyoverDurationS } = useAppStore.getState().settings
        const easeM = cameraKeyEaseM(lengthM, flyoverDurationS)
        editFilm((f) =>
          addItemCamera(
            f,
            startS,
            startS + durationS,
            (t) => clock.progressAtTime(t) * lengthM,
            // keyedCamera reads the keys in order along the track; the film keeps them in any order
            (atM) => keyedCamera(camera, [...f.cameraKeys].sort((a, b) => a.atM - b.atM), atM, easeM),
          ),
        )
      }}
    >
      <Icon name="locate-fixed" size={16} />
      Cadrer la caméra pendant cet élément
    </button>
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
        {shot.style === 'situation' && (
          <>
            <InspectorGroup title="Lieu">
              <label className="checkbox checkbox--switch">
                <input
                  type="checkbox"
                  checked={shot.highlight === true}
                  aria-describedby={`${id}-highlight-hint`}
                  onChange={(e) => change((f) => updateShot(f, item, { highlight: e.currentTarget.checked }), false)}
                />
                Mettre en avant la région
              </label>
              <RegionHint id={`${id}-highlight-hint`} highlight={shot.highlight === true} />
              {shot.highlight === true && (
                <PlaceSelect value={shot.regionId ?? null} onChange={(regionId) => change((f) => setFilmPlace(f, regionId), false)} />
              )}
            </InspectorGroup>
            <SituationTimings
              phase={item}
              durationS={shot.durationS}
              holdS={shot.holdS}
              onChange={(patch) => change((f) => updateShot(f, item, patch), false)}
            />
            <SituationFramingFields phase={item} shot={shot} onChange={(patch) => change((f) => updateShot(f, item, patch), false)} />
            <InspectorGroup title="Soleil">
              <label className="checkbox checkbox--switch">
                <input
                  type="checkbox"
                  checked={shot.moveSun === true}
                  aria-describedby={`${id}-sun-hint`}
                  onChange={(e) => change((f) => updateShot(f, item, { moveSun: e.currentTarget.checked || undefined }), false)}
                />
                Faire bouger le soleil
              </label>
              <p id={`${id}-sun-hint`} className="field__hint">
                {item === 'opening'
                  ? `Accéléré : le soleil part de ${SHOT_SUN_HOURS} h avant le départ et ralentit jusqu’à l’heure du survol ; les ombres balaient le relief.`
                  : `Accéléré : le soleil repart de l’heure de l’arrivée et avance de ${SHOT_SUN_HOURS} h ; les ombres balaient le relief.`}
                {!atmosphere && ' Avec l’atmosphère seulement.'}
              </p>
            </InspectorGroup>
          </>
        )}
        {shot.style !== 'situation' &&
          range(
            'duration',
            'Durée',
            shot.durationS,
            SHOT_DURATION_RANGE,
            seconds,
            (durationS) => change((f) => updateShot(f, item, { durationS }), false),
            shot.style === 'aucune',
          )}
        <div className="field">
          <label className="field__label" htmlFor={`${id}-transition`}>
            Transition
          </label>
          <select
            id={`${id}-transition`}
            className="select"
            value={shot.transition ?? 'enchaine'}
            disabled={shot.style === 'aucune'}
            aria-describedby={`${id}-transition-hint`}
            onChange={(e) => change((f) => updateShot(f, item, { transition: e.currentTarget.value as ShotTransition }), false)}
          >
            {SHOT_TRANSITIONS.map((transition) => (
              <option key={transition} value={transition}>
                {SHOT_TRANSITION_LABELS[transition]}
              </option>
            ))}
          </select>
          <p id={`${id}-transition-hint`} className="field__hint">
            {TRANSITION_HINTS[shot.transition ?? 'enchaine']}
          </p>
        </div>
        {shotDipColor(shot) &&
          range('dip', 'Durée du fondu', shot.dipS ?? DIP_DEFAULT_S, DIP_DURATION_RANGE, seconds, (dipS) =>
            change((f) => updateShot(f, item, { dipS }), false),
          )}
      </>
    )
  } else {
    const stop = clock.stops.find((s) => s.id === item)
    const speed = clock.speeds.find((s) => s.id === item)
    const filmText = film.texts.find((t) => t.id === item)
    const media = film.media.find((m) => m.id === item)
    const music = film.audio.find((a) => a.id === item)
    const cameraKey = clock.cameraKeys.find((k) => k.id === item)
    if (stop) {
      isStop = true
      title = 'Arrêt'
      const set = (patch: Parameters<typeof updateStop>[2]) => change((f) => updateStop(f, item, patch), true)
      body = (
        <>
          {text('label', 'Libellé', stop.label ?? '', (label) => set({ label }))}
          {range('duration', 'Durée', stop.durationS, STOP_DURATION_RANGE, seconds, (durationS) => set({ durationS }))}
          <div className="field">
            <label className="field__label" htmlFor={`${id}-camera`}>
              Caméra pendant l’arrêt
            </label>
            <select
              id={`${id}-camera`}
              className="select"
              value={stop.camera}
              aria-describedby={`${id}-camera-hint`}
              onChange={(e) => set({ camera: e.currentTarget.value as StopCamera })}
            >
              {STOP_CAMERAS.map((camera) => (
                <option key={camera} value={camera}>
                  {STOP_CAMERA_LABELS[camera]}
                </option>
              ))}
            </select>
            <p id={`${id}-camera-hint`} className="field__hint">
              {STOP_CAMERA_HINTS[stop.camera]}
            </p>
          </div>
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
    } else if (cameraKey) {
      title = 'Cadrage'
      const set = (patch: Parameters<typeof updateCameraKey>[2]) => change((f) => updateCameraKey(f, item, patch), false)
      body = (
        <>
          {range('distance', 'Distance', cameraKey.distance, CAMERA_RANGES.distance, (v) => `×${formatNumber(v, 1)}`, (distance) => set({ distance }))}
          {range('pitch', 'Inclinaison', cameraKey.pitchDeg, CAMERA_RANGES.pitchDeg, formatDegrees, (pitchDeg) => set({ pitchDeg }))}
          {range('heading', 'Visée', cameraKey.headingOffsetDeg, CAMERA_RANGES.headingOffsetDeg, formatDegrees, (headingOffsetDeg) => set({ headingOffsetDeg }))}
          {number('at', 'À (km)', km(cameraKey.atM), 0, km(lengthM), (v) => set({ atM: Math.min(v * 1000, lengthM) }))}
          <p className="field__hint">
            À {formatDistance(cameraKey.atM)}, {formatFilmTime(cameraKey.timeS)} dans le film. La caméra passe en douceur d’un cadrage
            au suivant ; avant le premier et après le dernier, elle reprend les réglages de l’onglet Survol.
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
          <FilmTextStyleFields color={filmText.color} font={filmText.font} onChange={({ color, font }) => set({ color, font })} />
          {timing(filmText.startS, filmText.durationS, set)}
          {attachSelect(filmText.stopId)}
          {itemCamera(filmText.startS, filmText.durationS)}
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
      /** « Caler sur le parcours »: recording start, clock correction, following the flight */
      const clipSync = (recordedMs: number, approx: boolean, lengthS: number) => {
        const timed = track.stats.startTime !== undefined
        const current: MediaSync = { startMs: recordedMs, offsetS: 0, follow: false, ...media.sync }
        // synced and placed again in the same edit; outside the outing, only the sync is kept
        const apply = (patch: Partial<MediaSync>, step: boolean) => {
          const sync = { ...current, ...patch }
          editFilm((f) => ({ film: syncClip(f, item, sync, path, clock, lengthS) ?? updateMedia(f, item, { sync }) }), { step })
        }
        const placeable = syncClipPlacement({ ...media, sync: current }, path, clock, lengthS) !== undefined
        const syncNow = () => {
          const offsetS = media.sync?.offsetS ?? clipSyncOffsetS(path, recordedMs, lengthS)
          if (offsetS === undefined || !syncClipPlacement({ ...media, sync: { ...current, offsetS } }, path, clock, lengthS)) {
            showToast({ kind: 'error', text: 'Vidéo filmée en dehors de la sortie : corrigez l’heure de la caméra avec le décalage.' })
            return
          }
          apply({ offsetS }, true)
          showToast({ kind: 'success', text: 'Vidéo calée : elle passe quand le marqueur arrive là où elle a été filmée.' })
        }
        const hours = current.offsetS !== 0 && current.offsetS % 3600 === 0 ? Math.abs(current.offsetS / 3600) : 0
        const filmedAt = new Date(recordedMs + current.offsetS * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
        return (
          <fieldset className="field fieldset">
            <legend className="field__label">Calage sur le parcours</legend>
            <p className="field__hint">
              Filmée le {filmedAt}
              {approx && ' (heure approximative, d’après la date du fichier)'}.
              {!timed && ' La trace n’a pas d’heures : la vidéo ne peut pas être calée.'}
              {timed && media.sync && !placeable && ' Cette heure est en dehors de la sortie : ajustez le décalage.'}
              {hours > 0 && ` Décalage de ${hours} h : la caméra était sans doute à l’heure locale.`}
            </p>
            {timed && (
              <>
                <button type="button" className="btn btn--secondary" onClick={syncNow}>
                  {media.sync ? 'Recaler sur le parcours' : 'Caler sur le parcours'}
                </button>
                {number('offset', 'Décalage de l’horloge (s)', current.offsetS, SYNC_OFFSET_RANGE.min, SYNC_OFFSET_RANGE.max, (offsetS) =>
                  apply({ offsetS: Math.round(Math.min(SYNC_OFFSET_RANGE.max, Math.max(SYNC_OFFSET_RANGE.min, offsetS)) * 10) / 10 }, false),
                )}
                <label className="checkbox">
                  <input type="checkbox" checked={current.follow} onChange={(e) => apply({ follow: e.currentTarget.checked }, true)} />
                  Suivre la vitesse du survol
                </label>
                <p className="field__hint">
                  Décalage positif : la vidéo passe plus tard. En suivant la vitesse du survol, l’image montre toujours l’endroit où
                  est le marqueur (ralentis et portions de vitesse compris) ; pendant un arrêt, elle reste figée.
                </p>
              </>
            )}
          </fieldset>
        )
      }
      /** « Son de la vidéo »: heard or not, its volume; silent while following the flight */
      const clipSound = () => {
        const following = media.sync?.follow === true
        const heard = media.muted === false && !following
        return (
          <fieldset className="field fieldset">
            <legend className="field__label">Son</legend>
            <label className="checkbox">
              <input type="checkbox" checked={heard} disabled={following} onChange={(e) => set({ muted: !e.currentTarget.checked })} />
              Son de la vidéo
            </label>
            {range('clip-volume', 'Volume', media.volume ?? 1, VOLUME_RANGE, percent, (volume) => set({ volume }), !heard)}
            <p className="field__hint">
              {following
                ? 'Muette tant qu’elle suit la vitesse du survol : elle n’est pas lue à son rythme, le son serait déformé.'
                : 'Entendu en lecture à ×1 et dans le film exporté, muet aux autres vitesses.'}
            </p>
          </fieldset>
        )
      }
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
          {attachSelect(media.stopId)}
          {itemCamera(media.startS, media.durationS)}
          {video && number('in', 'Début dans la vidéo (s)', media.inS ?? 0, 0, fileS, (inS) => set({ inS: Math.min(inS, fileS) }))}
          {video && clipSound()}
          {video && picture?.recordedMs !== undefined && clipSync(picture.recordedMs, picture.recordedApprox === true, fileS)}
          <p className="field__hint">
            {card ? `La ${title.toLowerCase()} s’affiche encadrée, au style de l’habillage.` : `La ${title.toLowerCase()} couvre la vue 3D, en fondu.`}
            {video && picture?.durationS !== undefined && ` Vidéo de ${formatFilmTime(fileS)} ; au-delà de sa fin, la dernière image reste affichée.`}

          </p>
        </>
      )
    } else if (music) {
      title = 'Musique'
      const sound = pictures[music.src]
      const fileS = sound?.durationS
      const set = (patch: Parameters<typeof updateMusic>[2]) => change((f) => updateMusic(f, item, patch, fileS), false)
      const lengthS = musicLengthS(music, fileS)
      body = (
        <>
          {sound?.name && <p className="field__hint">{sound.name}</p>}
          {range('volume', 'Volume', music.volume, VOLUME_RANGE, percent, (volume) => set({ volume }))}
          {range('fade-in', 'Fondu d’entrée', Math.min(music.fadeInS, FADE_SLIDER.max), FADE_SLIDER, seconds, (fadeInS) => set({ fadeInS }))}
          {range('fade-out', 'Fondu de sortie', Math.min(music.fadeOutS, FADE_SLIDER.max), FADE_SLIDER, seconds, (fadeOutS) => set({ fadeOutS }))}
          <div className="film-inspector__row">
            {number('start', 'Début (s)', music.startS, 0, clock.totalTime(), (startS) => set({ startS }))}
            {number('length', 'Durée (s)', music.durationS, AUDIO_DURATION_RANGE.min, fileS ?? AUDIO_DURATION_RANGE.max, (durationS) => set({ durationS }))}
          </div>
          {number('in', 'Début dans le fichier (s)', music.inS, 0, fileS ?? AUDIO_DURATION_RANGE.max, (inS) => set({ inS }))}
          <label className="checkbox">
            <input type="checkbox" checked={film.duckMusic} onChange={(e) => {
                const duckMusic = e.currentTarget.checked
                editFilm((f) => ({ film: { ...f, duckMusic } }))
              }}
            />
            Baisser la musique sous les vidéos
          </label>
          <button type="button" className="btn btn--secondary film-inspector__remove" onClick={() => showToast(fitFilmToMusic())}>
            Caler la durée du film sur la musique
          </button>
          <button type="button" className="btn btn--secondary film-inspector__remove" onClick={() => void snapFilmToMusic().then(showToast)}>
            Caler sur le rythme
          </button>
          <p className="field__hint">
            Jouée de {formatFilmTime(music.startS)} à {formatFilmTime(music.startS + lengthS)} dans le film
            {fileS !== undefined && ` (fichier de ${formatFilmTime(fileS)})`}, pendant la lecture et dans le film exporté. Caler la durée
            change la durée du survol pour que le film finisse avec la musique. Baisser la musique : toutes les musiques
            baissent de {-DUCK_DB} dB pendant les vidéos avec du son. Caler sur le rythme : les arrêts, les titres et les débuts
            des portions de vitesse à moins de 0,4 s d’un temps de la musique s’y posent, sur un début de mesure s’il y en a un aussi près
            {sound?.beats && (sound.beats.times.length > 0 ? ` (≈ ${Math.round(sound.beats.bpm)} BPM)` : ' (tempo de ce fichier incertain)')}.
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

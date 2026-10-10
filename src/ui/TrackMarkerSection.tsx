import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { TRACK_COLOR_MODES, TRACK_METRICS, hasMetric } from '../flyover/trackColor'
import { getPlatform } from '../platform'
import { fileToAvatarDataUrl } from '../scene/markerBadge'
import { FIGURE_GRID, MARKER_FIGURE_PATHS } from '../scene/markerFigures'
import {
  MARKER_FIGURE_LABELS,
  MARKER_FIGURES,
  MARKER_KIND_LABELS,
  MARKER_KINDS,
  MARKER_SIZE_RANGE,
  TRACK_DASH_LABELS,
  TRACK_DASHES,
  TRACK_SMOOTHING_RANGE,
  TRACK_WIDTH_RANGE,
} from '../scene/markerSettings'
import type { MarkerFigure, MarkerSettings, TrackStyle } from '../scene/markerSettings'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { formatDistance, formatNumber } from './format'
import { InfoTip, PanelSection, RangeField, SettingRow } from './PanelSection'

/** 4 -> "4", 4.5 -> "4,5", 1.25 -> "1,25" */
function formatShort(value: number): string {
  return formatNumber(value, Number.isInteger(value) ? 0 : Number.isInteger(value * 10) ? 1 : 2)
}

/** 0 -> "Aucun", else the distance */
const formatSmoothing = (metres: number) => (metres === 0 ? 'Aucun' : formatDistance(metres))

/** Pictogram of a figure, drawn from the same paths as the marker badge. */
function FigureIcon({ figure }: { figure: MarkerFigure }) {
  return (
    <svg
      width={16}
      height={16}
      viewBox={`0 0 ${FIGURE_GRID} ${FIGURE_GRID}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {MARKER_FIGURE_PATHS[figure].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/** One choice among `options`, as chips (radio buttons). */
function ChipChoice<T extends string>({
  label,
  name,
  options,
  value,
  labels,
  icon,
  onChange,
}: {
  label: string
  name: string
  options: readonly T[]
  value: T
  labels: Record<T, string>
  icon?: (option: T) => ReactNode
  onChange(value: T): void
}) {
  return (
    <fieldset className="field fieldset">
      <legend className="field__label">{label}</legend>
      <div className="chips">
        {options.map((option) => (
          <label key={option} className="chip">
            <input type="radio" name={name} checked={value === option} onChange={() => onChange(option)} />
            {icon?.(option)}
            {labels[option]}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** « Choisir une image » for a picture marker, through the platform file picker. */
function MarkerImageField({ marker, update }: { marker: MarkerSettings; update(patch: Partial<MarkerSettings>): void }) {
  const [error, setError] = useState<string | null>(null)
  const choose = async () => {
    try {
      const [file] = await getPlatform().openFiles({ filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
      if (!file) return
      setError(null)
      const image = await fileToAvatarDataUrl(file)
      // the marker as it is now (another change or an undo may have happened during the decoding)
      useAppStore.getState().setSetting('marker', { ...useAppStore.getState().settings.marker, image })
    } catch {
      setError("Cette image n'a pas pu être lue.")
    }
  }
  return (
    <div className="field">
      <div className="field__label-row">
        <button type="button" className="btn btn--secondary" onClick={() => void choose()}>
          {marker.image ? "Changer l'image" : 'Choisir une image'}
        </button>
        {marker.image && (
          <button type="button" className="btn btn--secondary" onClick={() => update({ image: '' })}>
            Retirer
          </button>
        )}
      </div>
      {error ? (
        <p className="field__hint" role="alert">
          {error}
        </p>
      ) : (
        <p className="field__hint">Photo ou avatar, recadré en rond. Les autres traces gardent leur boule.</p>
      )}
    </div>
  )
}

/**
 * « Trace et marqueur » section of the Carte tab: the marker (ball, figurine, picture), the draw-on and the glow first;
 * colouring, smoothing, line width, dashes and marker size as rows (name and value, control on demand).
 */
export function TrackMarkerSection() {
  const style = useAppStore((s) => s.settings.trackStyle)
  const marker = useAppStore((s) => s.settings.marker)
  const setSetting = useAppStore((s) => s.setSetting)
  const id = useId()
  const updateStyle = (patch: Partial<TrackStyle>) => setSetting('trackStyle', { ...style, ...patch })
  const updateMarker = (patch: Partial<MarkerSettings>) => setSetting('marker', { ...marker, ...patch })
  const trackColorBy = useAppStore((s) => s.settings.trackColorBy)
  const firstTrack = useAppStore((s) => s.tracks[0])
  const colorModes = useMemo(
    () =>
      TRACK_COLOR_MODES.map((mode) =>
        mode === 'none'
          ? { mode, label: 'Unie', available: true }
          : { mode, label: TRACK_METRICS[mode].label, available: !!firstTrack && hasMetric(firstTrack, mode) },
      ),
    [firstTrack],
  )

  return (
    <PanelSection title="Trace et marqueur" keys={['trackColorBy', 'trackStyle', 'marker']}>
      <ChipChoice
        label="Marqueur"
        name={`${id}-kind`}
        options={MARKER_KINDS}
        value={marker.kind}
        labels={MARKER_KIND_LABELS}
        onChange={(kind) => updateMarker({ kind })}
      />
      {marker.kind === 'figurine' && (
        <ChipChoice
          label="Figurine"
          name={`${id}-figure`}
          options={MARKER_FIGURES}
          value={marker.figure}
          labels={MARKER_FIGURE_LABELS}
          icon={(figure) => <FigureIcon figure={figure} />}
          onChange={(figure) => updateMarker({ figure })}
        />
      )}
      {marker.kind === 'figurine' && (
        <label className="checkbox">
          <input type="checkbox" checked={marker.animated} onChange={(e) => updateMarker({ animated: e.currentTarget.checked })} />
          Animer la figurine (pas et balancement)
        </label>
      )}
      {marker.kind === 'image' && <MarkerImageField marker={marker} update={updateMarker} />}

      <div className="field__label-row">
        <label className="checkbox checkbox--switch">
          <input type="checkbox" checked={style.drawOn} onChange={(e) => updateStyle({ drawOn: e.currentTarget.checked })} />
          Trace qui se dessine
        </label>
        <InfoTip text="Seule la partie déjà parcourue est tracée ; le reste apparaît au passage du marqueur." />
      </div>
      <label className="checkbox checkbox--switch">
        <input type="checkbox" checked={style.glow} onChange={(e) => updateStyle({ glow: e.currentTarget.checked })} />
        Halo lumineux
      </label>
      <SettingRow label="Colorer selon" value={colorModes.find((m) => m.mode === trackColorBy)?.label} paths={['trackColorBy']}>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-color`}>
            Colorer selon
          </label>
          <select
            id={`${id}-color`}
            className="select"
            value={trackColorBy}
            onChange={(e) => setSetting('trackColorBy', e.currentTarget.value as Settings['trackColorBy'])}
          >
            {colorModes.map(({ mode, label, available }) => (
              <option key={mode} value={mode} disabled={!available}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </SettingRow>
      <SettingRow label="Lissage de la trace" value={formatSmoothing(style.smoothingM)} paths={['trackStyle.smoothingM']}>
        <RangeField
          label="Lissage de la trace"
          tip="Trace en zigzag ou caméra qui tremble ? Le lissage moyenne les positions GPS sur cette distance : la trace et la caméra suivent une ligne calme."
          {...TRACK_SMOOTHING_RANGE}
          value={style.smoothingM}
          format={formatSmoothing}
          onChange={(smoothingM) => updateStyle({ smoothingM })}
        />
      </SettingRow>
      <SettingRow label="Épaisseur de la trace" value={`${formatShort(style.width)} px`} paths={['trackStyle.width']}>
        <RangeField
          label="Épaisseur de la trace"
          {...TRACK_WIDTH_RANGE}
          value={style.width}
          format={(v) => `${formatShort(v)} px`}
          onChange={(width) => updateStyle({ width })}
        />
      </SettingRow>
      <SettingRow label="Trait" value={TRACK_DASH_LABELS[style.dash]} paths={['trackStyle.dash']}>
        <ChipChoice
          label="Trait"
          name={`${id}-dash`}
          options={TRACK_DASHES}
          value={style.dash}
          labels={TRACK_DASH_LABELS}
          onChange={(dash) => updateStyle({ dash })}
        />
      </SettingRow>
      <SettingRow label="Taille du marqueur" value={`×${formatShort(marker.size)}`} paths={['marker.size']}>
        <RangeField
          label="Taille du marqueur"
          {...MARKER_SIZE_RANGE}
          value={marker.size}
          format={(v) => `×${formatShort(v)}`}
          onChange={(size) => updateMarker({ size })}
        />
      </SettingRow>
    </PanelSection>
  )
}

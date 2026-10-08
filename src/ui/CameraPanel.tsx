import { useId } from 'react'
import {
  CAMERA_PRESETS,
  CAMERA_RANGES,
  CAMERA_STYLE_LABELS,
  CAMERA_STYLES,
  findCameraPreset,
  FLYOVER_DURATION_RANGE,
} from '../flyover/cameraSettings'
import type { CameraSettings, CameraStyle } from '../flyover/cameraSettings'
import { PACING_RANGES } from '../flyover/pacing'
import type { PacingSettings } from '../flyover/pacing'
import { usePacing } from '../scene/usePacing'
import { useAppStore } from '../state/store'
import { formatDistance, formatNumber } from './format'
import { Icon } from './icons'
import type { IconName } from './icons'
import { InfoTip, MoreSettings, PanelSection } from './PanelSection'

/** Value of the preset select when the camera matches no preset. */
const CUSTOM = ''

/** 90 -> "1 min 30 s", 45 -> "45 s" */
function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds - m * 60)
  if (m === 0) return `${s} s`
  return s === 0 ? `${m} min` : `${m} min ${String(s).padStart(2, '0')} s`
}

/** -30 -> "−30°" */
function formatDegrees(deg: number): string {
  return `${deg < 0 ? '−' : ''}${formatNumber(Math.abs(deg))}°`
}

type NumericKey = keyof typeof CAMERA_RANGES

interface Slider {
  key: NumericKey
  label: string
  format(value: number): string
}

const SLIDERS: Slider[] = [
  { key: 'distance', label: 'Distance (× automatique)', format: (v) => `×${formatNumber(v, 1)}` },
  { key: 'pitchDeg', label: 'Inclinaison au-dessus de l’horizon', format: formatDegrees },
  { key: 'headingOffsetDeg', label: 'Direction de visée (par rapport au trajet)', format: formatDegrees },
  { key: 'smoothing', label: 'Lissage du cap', format: (v) => `×${formatNumber(v, 2)}` },
]

interface PacingSlider {
  key: keyof typeof PACING_RANGES
  label: string
  format(value: number): string
  /** spoken value (aria-valuetext), when it differs from the displayed one */
  spoken?(value: number): string
}

const PACING_SLIDERS: PacingSlider[] = [
  { key: 'slowFactor', label: 'Vitesse au temps fort', format: (v) => `${formatNumber(v * 100)} %` },
  {
    key: 'windowM',
    label: 'Étendue du ralenti',
    format: (v) => `±${formatDistance(v)}`,
    spoken: (v) => `${formatDistance(v)} de chaque côté`,
  },
  { key: 'pauseS', label: 'Pause', format: (v) => (v === 0 ? 'Aucune' : `${formatNumber(v, 1)} s`) },
]

/** Style tiles: short label and icon. */
const STYLE_TILES: Record<CameraStyle, { label: string; icon: IconName }> = {
  chase: { label: 'Poursuite', icon: 'navigation' },
  sway: { label: 'Balancement', icon: 'spline' },
  orbit: { label: 'Orbite', icon: 'orbit' },
  top: { label: 'Dessus', icon: 'locate-fixed' },
  cinematic: { label: 'Cinéma', icon: 'clapperboard' },
}

/** One-line description of each style (hint under the style tiles). */
const STYLE_HINTS: Record<CameraStyle, string> = {
  chase: 'Derrière le marqueur, dans la direction du trajet.',
  sway: 'Se balance vers l’extérieur des virages, comme un hélicoptère.',
  orbit: 'Tourne lentement autour du marqueur (6° par seconde).',
  top: 'Haute et presque verticale (inclinaison d’au moins 70°).',
  cinematic: 'Plus loin et plus bas, avec un lent mouvement latéral.',
}

/**
 * « Survol » tab: sections Caméra (preset, style tiles; fine parameters under « Plus de réglages ») and Durée et rythme
 * (flyover duration, slow-downs on/off; their details under « Plus de réglages »).
 */
export function CameraPanel() {
  const camera = useAppStore((s) => s.settings.camera)
  const durationS = useAppStore((s) => s.settings.flyoverDurationS)
  const pacing = useAppStore((s) => s.settings.pacing)
  const film = usePacing()
  const stopCount = film.stops.length
  const setSetting = useAppStore((s) => s.setSetting)
  const id = useId()
  const preset = findCameraPreset(camera)
  const update = (patch: Partial<CameraSettings>) => setSetting('camera', { ...camera, ...patch })
  const updatePacing = (patch: Partial<PacingSettings>) => setSetting('pacing', { ...pacing, ...patch })

  return (
    <>
      <PanelSection title="Caméra" keys={['camera']}>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-preset`}>
            Préréglage
          </label>
          <select
            id={`${id}-preset`}
            className="select"
            value={preset?.name ?? CUSTOM}
            onChange={(e) => {
              const next = CAMERA_PRESETS.find((p) => p.name === e.currentTarget.value)
              if (next) setSetting('camera', { ...next.camera })
            }}
          >
            {!preset && (
              <option value={CUSTOM} disabled>
                Personnalisé
              </option>
            )}
            {CAMERA_PRESETS.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="field fieldset">
          <legend className="field__label">Style</legend>
          <div className="style-tiles">
            {CAMERA_STYLES.map((style) => (
              <label key={style} className="format-tile style-tile" title={CAMERA_STYLE_LABELS[style]}>
                <input
                  type="radio"
                  name={`${id}-style`}
                  value={style}
                  checked={camera.style === style}
                  aria-describedby={`${id}-style-hint`}
                  onChange={() => update({ style })}
                />
                <Icon name={STYLE_TILES[style].icon} size={20} />
                <span className="format-tile__label">{STYLE_TILES[style].label}</span>
              </label>
            ))}
          </div>
          <p id={`${id}-style-hint`} className="field__hint">
            {STYLE_HINTS[camera.style]}
          </p>
        </fieldset>

        {camera.style === 'top' && (
          <label className="checkbox" htmlFor={`${id}-north-up`}>
            <input
              id={`${id}-north-up`}
              type="checkbox"
              checked={camera.northUp}
              onChange={(e) => update({ northUp: e.currentTarget.checked })}
            />
            Nord en haut
          </label>
        )}

        <MoreSettings paths={['camera.distance', 'camera.pitchDeg', 'camera.headingOffsetDeg', 'camera.smoothing']}>
          {SLIDERS.map(({ key, label, format }) => {
            const range = CAMERA_RANGES[key]
            const inputId = `${id}-${key}`
            return (
              <div key={key} className="field">
                <label className="field__label" htmlFor={inputId}>
                  {label}
                </label>
                <div className="range-row">
                  <input
                    id={inputId}
                    className="range"
                    type="range"
                    min={range.min}
                    max={range.max}
                    step={range.step}
                    value={camera[key]}
                    onChange={(e) => update({ [key]: Number(e.currentTarget.value) })}
                    aria-valuetext={format(camera[key])}
                  />
                  <output className="range-row__value range-row__value--wide" htmlFor={inputId}>
                    {format(camera[key])}
                  </output>
                </div>
              </div>
            )
          })}
        </MoreSettings>
      </PanelSection>

      <PanelSection title="Durée et rythme" keys={['flyoverDurationS', 'pacing']}>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-duration`}>
            Durée du survol (à ×1)
          </label>
          <div className="range-row">
            <input
              id={`${id}-duration`}
              className="range"
              type="range"
              min={FLYOVER_DURATION_RANGE.min}
              max={FLYOVER_DURATION_RANGE.max}
              step={FLYOVER_DURATION_RANGE.step}
              value={durationS}
              onChange={(e) => setSetting('flyoverDurationS', Number(e.currentTarget.value))}
              aria-valuetext={formatSeconds(durationS)}
            />
            <output className="range-row__value range-row__value--wide" htmlFor={`${id}-duration`}>
              {formatSeconds(durationS)}
            </output>
          </div>
          <p className="field__hint">
            Durée du film : {formatSeconds(Math.round(film.totalTime()))} ·{' '}
            {stopCount === 0 ? 'aucun arrêt' : `${stopCount} arrêt${stopCount > 1 ? 's' : ''}`}
          </p>
        </div>

        <div className="field__label-row">
          <label className="checkbox">
            <input type="checkbox" checked={pacing.enabled} onChange={(e) => updatePacing({ enabled: e.currentTarget.checked })} />
            Ralentir aux temps forts
          </label>
          <InfoTip text="Temps forts : sommets des montées, cols franchis et sommets proches de la trace." />
        </div>

        {pacing.enabled && (
          <MoreSettings
            paths={['pacing.climbs', 'pacing.landmarks', 'pacing.slowFactor', 'pacing.windowM', 'pacing.pauseS', 'pacing.keepDuration']}
          >
            <fieldset className="field fieldset">
              <legend className="field__label">Temps forts</legend>
              <label className="checkbox">
                <input type="checkbox" checked={pacing.climbs} onChange={(e) => updatePacing({ climbs: e.currentTarget.checked })} />
                Sommets des montées
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={pacing.landmarks} onChange={(e) => updatePacing({ landmarks: e.currentTarget.checked })} />
                Repères (cols, sommets)
              </label>
            </fieldset>

            {PACING_SLIDERS.map(({ key, label, format, spoken = format }) => {
              const range = PACING_RANGES[key]
              const inputId = `${id}-pacing-${key}`
              return (
                <div key={key} className="field">
                  <label className="field__label" htmlFor={inputId}>
                    {label}
                  </label>
                  <div className="range-row">
                    <input
                      id={inputId}
                      className="range"
                      type="range"
                      min={range.min}
                      max={range.max}
                      step={range.step}
                      value={pacing[key]}
                      onChange={(e) => updatePacing({ [key]: Number(e.currentTarget.value) })}
                      aria-valuetext={spoken(pacing[key])}
                    />
                    <output className="range-row__value range-row__value--wide" htmlFor={inputId}>
                      {format(pacing[key])}
                    </output>
                  </div>
                </div>
              )
            })}

            <label className="checkbox">
              <input
                type="checkbox"
                checked={pacing.keepDuration}
                onChange={(e) => updatePacing({ keepDuration: e.currentTarget.checked })}
              />
              Garder la durée du survol
            </label>
          </MoreSettings>
        )}
      </PanelSection>
    </>
  )
}

import { useId, useMemo } from 'react'
import { TRACK_COLOR_MODES, TRACK_METRICS, hasMetric } from '../flyover/trackColor'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { IMAGERY_SOURCES, TERRAIN_SOURCES } from '../terrain/sources'
import { useWeatherStore } from '../weather/store'
import { formatNumber } from './format'

const ZOOM_OFFSETS: { value: Settings['imageryZoomOffset']; label: string }[] = [
  { value: 0, label: 'Normal' },
  { value: 1, label: 'Fin' },
  { value: 2, label: 'Très fin' },
]

const EXAGGERATION_MIN = 1
const EXAGGERATION_MAX = 3
const EXAGGERATION_STEP = 0.1

const SUN_HOUR_MIN = 0
const SUN_HOUR_MAX = 23.75
const SUN_HOUR_STEP = 0.25

const EXPOSURE_EV_MIN = -2
const EXPOSURE_EV_MAX = 2
const EXPOSURE_EV_STEP = 0.5

const WEATHER_STRENGTH_STEP = 0.05

/** 0.75 -> "75 %" */
const formatPercent = (v: number) => `${formatNumber(v * 100)} %`

/** 0.5 -> "+0,5 IL" */
function formatEv(ev: number): string {
  return `${ev > 0 ? '+' : ev < 0 ? '−' : ''}${formatNumber(Math.abs(ev), 1)} IL`
}

/** 10.5 -> "10 h 30" */
function formatHour(hour: number): string {
  const h = Math.floor(hour)
  const m = Math.round((hour - h) * 60)
  return `${h} h ${String(m).padStart(2, '0')}`
}

/** "Réglages" section: terrain / imagery sources, imagery detail, exaggeration, wireframe, atmosphere. */
export function SettingsPanel() {
  const settings = useAppStore((s) => s.settings)
  const setSetting = useAppStore((s) => s.setSetting)
  const id = useId()
  const terrainId = `${id}-terrain`
  const imageryId = `${id}-imagery`
  const exaggerationId = `${id}-exaggeration`
  const wireframeId = `${id}-wireframe`
  const atmosphereId = `${id}-atmosphere`
  const shadowsId = `${id}-shadows`
  const sunHourId = `${id}-sun-hour`
  const sunFromTrackId = `${id}-sun-from-track`
  const trackHasTime = useAppStore((s) => s.tracks[0]?.stats.startTime !== undefined)
  const sunFollowsTrack = settings.sunFromTrack && trackHasTime
  const exposureId = `${id}-exposure`
  const weatherSceneId = `${id}-weather-scene`
  const weatherStrengthId = `${id}-weather-strength`
  const firstTrackId = useAppStore((s) => s.tracks[0]?.id)
  const weatherReady = useWeatherStore((s) => s.status === 'ready' && s.trackId !== null && s.trackId === firstTrackId)
  const trackColorId = `${id}-track-color`
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
    <section className="settings" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        Réglages
      </h2>

      <div className="field">
        <label className="field__label" htmlFor={terrainId}>
          Relief
        </label>
        <select
          id={terrainId}
          className="select"
          value={settings.terrainSourceId}
          onChange={(e) => setSetting('terrainSourceId', e.currentTarget.value)}
        >
          {TERRAIN_SOURCES.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={imageryId}>
          Imagerie
        </label>
        <select
          id={imageryId}
          className="select"
          value={settings.imagerySourceId}
          onChange={(e) => setSetting('imagerySourceId', e.currentTarget.value)}
        >
          {IMAGERY_SOURCES.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="field fieldset">
        <legend className="field__label">Détail imagerie</legend>
        <div className="segmented">
          {ZOOM_OFFSETS.map((option) => (
            <label key={option.value} className="segmented__option">
              <input
                type="radio"
                name={`${id}-zoom-offset`}
                value={option.value}
                checked={settings.imageryZoomOffset === option.value}
                onChange={() => setSetting('imageryZoomOffset', option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor={exaggerationId}>
          Exagération du relief
        </label>
        <div className="range-row">
          <input
            id={exaggerationId}
            className="range"
            type="range"
            min={EXAGGERATION_MIN}
            max={EXAGGERATION_MAX}
            step={EXAGGERATION_STEP}
            value={settings.exaggeration}
            onChange={(e) => setSetting('exaggeration', Number(e.currentTarget.value))}
          />
          <output className="range-row__value" htmlFor={exaggerationId}>
            ×{formatNumber(settings.exaggeration, 1)}
          </output>
        </div>
      </div>

      <div className="field">
        <label className="field__label" htmlFor={trackColorId}>
          Couleur de la trace
        </label>
        <select
          id={trackColorId}
          className="select"
          value={settings.trackColorBy}
          onChange={(e) => setSetting('trackColorBy', e.currentTarget.value as Settings['trackColorBy'])}
        >
          {colorModes.map(({ mode, label, available }) => (
            <option key={mode} value={mode} disabled={!available}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <label className="checkbox" htmlFor={wireframeId}>
        <input
          id={wireframeId}
          type="checkbox"
          checked={settings.wireframe}
          onChange={(e) => setSetting('wireframe', e.currentTarget.checked)}
        />
        Filaire
      </label>

      <label className="checkbox" htmlFor={atmosphereId}>
        <input
          id={atmosphereId}
          type="checkbox"
          checked={settings.atmosphere}
          onChange={(e) => setSetting('atmosphere', e.currentTarget.checked)}
        />
        Atmosphère (ciel, lumière du soleil, brume)
      </label>

      {settings.atmosphere && (
        <label className="checkbox" htmlFor={shadowsId}>
          <input
            id={shadowsId}
            type="checkbox"
            checked={settings.shadows}
            onChange={(e) => setSetting('shadows', e.currentTarget.checked)}
          />
          Ombres du relief
        </label>
      )}

      {settings.atmosphere && (
        <div className="field">
          <label className="checkbox" htmlFor={sunFromTrackId}>
            <input
              id={sunFromTrackId}
              type="checkbox"
              checked={sunFollowsTrack}
              disabled={!trackHasTime}
              aria-describedby={trackHasTime ? undefined : `${sunFromTrackId}-hint`}
              onChange={(e) => setSetting('sunFromTrack', e.currentTarget.checked)}
            />
            Soleil à l'heure de la sortie
          </label>
          {!trackHasTime && (
            <p id={`${sunFromTrackId}-hint`} className="field__hint">
              Disponible avec une trace horodatée.
            </p>
          )}
        </div>
      )}

      {settings.atmosphere && (
        <div className="field">
          <label className="field__label" htmlFor={sunHourId}>
            Heure solaire
          </label>
          <div className="range-row">
            <input
              id={sunHourId}
              className="range"
              type="range"
              min={SUN_HOUR_MIN}
              max={SUN_HOUR_MAX}
              step={SUN_HOUR_STEP}
              value={settings.sunHour}
              disabled={sunFollowsTrack}
              onChange={(e) => setSetting('sunHour', Number(e.currentTarget.value))}
              aria-valuetext={formatHour(settings.sunHour)}
            />
            <output className="range-row__value range-row__value--wide" htmlFor={sunHourId}>
              {formatHour(settings.sunHour)}
            </output>
          </div>
        </div>
      )}

      {settings.atmosphere && (
        <div className="field">
          <label className="field__label" htmlFor={exposureId}>
            Exposition (en plus de l'automatique)
          </label>
          <div className="range-row">
            <input
              id={exposureId}
              className="range"
              type="range"
              min={EXPOSURE_EV_MIN}
              max={EXPOSURE_EV_MAX}
              step={EXPOSURE_EV_STEP}
              value={settings.exposureEv}
              onChange={(e) => setSetting('exposureEv', Number(e.currentTarget.value))}
              aria-valuetext={formatEv(settings.exposureEv)}
            />
            <output className="range-row__value range-row__value--wide" htmlFor={exposureId}>
              {formatEv(settings.exposureEv)}
            </output>
          </div>
        </div>
      )}

      {settings.atmosphere && weatherReady && (
        <div className="field">
          <label className="checkbox" htmlFor={weatherSceneId}>
            <input
              id={weatherSceneId}
              type="checkbox"
              checked={settings.weatherScene.enabled}
              onChange={(e) => setSetting('weatherScene', { ...settings.weatherScene, enabled: e.currentTarget.checked })}
            />
            Météo dans la scène
          </label>
          {settings.weatherScene.enabled && (
            <>
              <label className="field__label" htmlFor={weatherStrengthId}>
                Intensité de la météo
              </label>
              <div className="range-row">
                <input
                  id={weatherStrengthId}
                  className="range"
                  type="range"
                  min={0}
                  max={1}
                  step={WEATHER_STRENGTH_STEP}
                  value={settings.weatherScene.strength}
                  onChange={(e) =>
                    setSetting('weatherScene', { ...settings.weatherScene, strength: Number(e.currentTarget.value) })
                  }
                  aria-valuetext={formatPercent(settings.weatherScene.strength)}
                />
                <output className="range-row__value range-row__value--wide" htmlFor={weatherStrengthId}>
                  {formatPercent(settings.weatherScene.strength)}
                </output>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

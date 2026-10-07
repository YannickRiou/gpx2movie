import { useEffect, useId, useMemo } from 'react'
import { buildTrackPath } from '../flyover/path'
import { useAppStore } from '../state/store'
import { OPEN_METEO_ATTRIBUTION } from '../weather/openMeteo'
import { summarizeOuting, weatherWidgetData } from '../weather/series'
import { syncWeather, useWeatherStore } from '../weather/store'
import { formatNumber } from './format'

/** Recorded instant -> "14 h 32", in the browser time zone (as the timeline). */
function formatClock(ms: number): string {
  const date = new Date(ms)
  return `${date.getHours()} h ${String(date.getMinutes()).padStart(2, '0')}`
}

function formatTemperature(c: number): string {
  return `${formatNumber(c)} °C`
}

/** Progress steps the marker conditions follow: enough for hourly data, without a render per frame. */
const PROGRESS_STEPS = 1000

/**
 * "Météo de la sortie": historical weather of the first track (Open-Meteo archive), outing summary and the
 * conditions under the flyover marker. Also drives the weather store (`syncWeather`).
 */
export function WeatherPanel() {
  const id = useId()
  const track = useAppStore((s) => s.tracks[0])
  const enabled = useAppStore((s) => s.settings.weather.enabled)
  const setSetting = useAppStore((s) => s.setSetting)
  const progress = useAppStore((s) => Math.round(s.playback.progress * PROGRESS_STEPS) / PROGRESS_STEPS)
  const status = useWeatherStore((s) => s.status)
  const message = useWeatherStore((s) => s.message)
  const series = useWeatherStore((s) => s.series)
  const weatherTrackId = useWeatherStore((s) => s.trackId)

  useEffect(() => {
    syncWeather(track, enabled)
  }, [track, enabled])

  const path = useMemo(() => (track ? buildTrackPath(track) : null), [track])
  const ready = status === 'ready' && series !== null && path !== null && weatherTrackId === track?.id
  const summary = useMemo(() => (ready ? summarizeOuting(series, path) : undefined), [ready, series, path])
  const now = ready ? weatherWidgetData(series, path, progress) : undefined

  if (!track) return null

  return (
    <section className="settings weather" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        Météo de la sortie
      </h2>

      <label className="checkbox" htmlFor={`${id}-enabled`}>
        <input
          id={`${id}-enabled`}
          type="checkbox"
          checked={enabled}
          onChange={(e) => setSetting('weather', { enabled: e.currentTarget.checked })}
        />
        Rechercher la météo du jour (Open-Meteo)
      </label>

      <p className="field__hint" role="status" aria-live="polite">
        {!enabled && 'Désactivée : aucune requête n’est envoyée.'}
        {enabled && status === 'loading' && 'Chargement de la météo…'}
        {enabled && (status === 'unavailable' || status === 'error') && message}
      </p>

      {enabled && status === 'error' && (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => syncWeather(track, enabled, { retry: true })}>
          Réessayer
        </button>
      )}

      {summary && (
        <dl className="weather__list">
          <dt>Conditions</dt>
          <dd>{summary.dominant.label}</dd>
          <dt>Température</dt>
          <dd>
            {formatTemperature(summary.minTemperatureC)} à {formatTemperature(summary.maxTemperatureC)}
          </dd>
          <dt>Précipitations</dt>
          <dd>
            {summary.precipitationMm < 0.05 ? 'aucune' : `${formatNumber(summary.precipitationMm, 1)} mm`}
            {summary.snowfallCm >= 0.05 && ` dont ${formatNumber(summary.snowfallCm, 1)} cm de neige`}
          </dd>
          <dt>Vent max</dt>
          <dd>
            {formatNumber(summary.maxWindKmh)} km/h, rafales {formatNumber(summary.maxGustsKmh)} km/h
          </dd>
        </dl>
      )}

      {now && (
        <div className="weather__now">
          <h3 className="field__label">Au marqueur · {formatClock(now.timeMs)}</h3>
          <dl className="weather__list">
            <dt>Ciel</dt>
            <dd>
              {now.condition.label} · nuages {formatNumber(now.cloudCover)} %
            </dd>
            <dt>Température</dt>
            <dd>
              {formatTemperature(now.temperatureC)} (ressenti {formatTemperature(now.apparentTemperatureC)})
            </dd>
            <dt>Vent</dt>
            <dd>
              {formatNumber(now.windSpeedKmh)} km/h{now.windFrom && ` de ${now.windFrom}`}, rafales{' '}
              {formatNumber(now.windGustsKmh)} km/h
            </dd>
            <dt>Pluie</dt>
            <dd>{formatNumber(now.precipitationMm, 1)} mm/h</dd>
          </dl>
        </div>
      )}

      {ready && (
        <p className="field__hint">
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
            {OPEN_METEO_ATTRIBUTION}
          </a>
        </p>
      )}
    </section>
  )
}

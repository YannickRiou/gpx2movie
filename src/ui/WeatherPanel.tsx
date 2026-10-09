import { useEffect, useId, useMemo } from 'react'
import { buildTrackPath } from '../flyover/path'
import { playsInSequence } from '../flyover/sequence'
import { useAppStore } from '../state/store'
import { OPEN_METEO_ATTRIBUTION } from '../weather/openMeteo'
import { summarizeOuting, weatherWidgetData } from '../weather/series'
import { syncStageWeather, syncWeather, useWeatherStore } from '../weather/store'
import { ModifiedMarker } from './ModifiedMarker'
import { formatClock, formatNumber } from './format'
import { Icon } from './icons'

function formatTemperature(c: number): string {
  return `${formatNumber(c)} °C`
}

/** Progress steps the marker conditions follow: enough for hourly data, without a render per frame. */
const PROGRESS_STEPS = 1000

/**
 * "Météo de la sortie": weather of the first track (Open-Meteo archive, or forecast for a planned outing), outing
 * summary and the conditions under the flyover marker. Also drives the weather store (`syncWeather`, and « À la suite »
 * `syncStageWeather` for the later stages).
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
  const tracks = useAppStore((s) => s.tracks)
  const sequence = useAppStore((s) => playsInSequence(s.settings.race, s.tracks.length))

  useEffect(() => {
    syncWeather(track, enabled)
  }, [track, enabled])

  useEffect(() => {
    syncStageWeather(sequence ? tracks.slice(1) : [], enabled)
  }, [sequence, tracks, enabled])

  const path = useMemo(() => (track ? buildTrackPath(track) : null), [track])
  const ready = status === 'ready' && series !== null && path !== null && weatherTrackId === track?.id
  const summary = useMemo(() => (ready ? summarizeOuting(series, path) : undefined), [ready, series, path])
  const now = ready ? weatherWidgetData(series, path, progress) : undefined
  const forecast = ready && series?.forecast === true

  if (!track) return null

  return (
    <section className="settings weather" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="section-title settings__title">
        Météo de la sortie
      </h2>
      <ModifiedMarker keys={['weather']} label="Météo de la sortie" />

      <label className="checkbox checkbox--switch" htmlFor={`${id}-enabled`}>
        <input
          id={`${id}-enabled`}
          type="checkbox"
          checked={enabled}
          onChange={(e) => setSetting('weather', { enabled: e.currentTarget.checked })}
        />
        Météo du jour de la sortie (Open-Meteo)
      </label>

      <p className="field__hint" role="status" aria-live="polite">
        {!enabled && 'Désactivée : aucune requête envoyée.'}
        {enabled && status === 'loading' && 'Chargement de la météo…'}
        {enabled && (status === 'unavailable' || status === 'error') && message}
      </p>

      {enabled && status === 'error' && (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => syncWeather(track, enabled, { retry: true })}>
          Réessayer
        </button>
      )}

      {summary && (
        <p className="weather__line">
          <span className="weather__line-label">{forecast ? 'Prévision' : 'Sortie'}</span>
          <span>
            {summary.dominant.label} · {formatNumber(summary.minTemperatureC)} à {formatTemperature(summary.maxTemperatureC)} ·{' '}
            {summary.precipitationMm < 0.05 ? 'sans pluie' : `${formatNumber(summary.precipitationMm, 1)} mm`} · vent{' '}
            {formatNumber(summary.maxWindKmh)} km/h
          </span>
        </p>
      )}
      {now && (
        <p className="weather__line">
          <span className="weather__line-label">À {formatClock(now.timeMs)}</span>
          <span>
            {now.condition.label} · {formatTemperature(now.temperatureC)} · vent {formatNumber(now.windSpeedKmh)} km/h
            {now.windFrom && ` de ${now.windFrom}`}
          </span>
        </p>
      )}

      {summary && (
        <details className="weather__details">
          <summary className="weather__details-summary">
            Détails
            <Icon name="chevron-down" size={16} />
          </summary>
          <h3 className="field__label">Sur la sortie</h3>
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
          {now && (
            <>
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
            </>
          )}
        </details>
      )}

      {forecast && <p className="field__hint">Prévision, pas une mesure : à revoir la veille du départ.</p>}
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

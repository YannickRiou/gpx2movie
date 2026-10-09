import { useId, useMemo, useState } from 'react'
import { SUN_CHIP_LABELS, SUN_CHIPS, SUN_HOUR_RANGE, clockHourOfSolar, solarDay, sunChipHour, sunDayMs } from '../flyover/sun'
import type { SolarDay } from '../flyover/sun'
import { TRACK_COLOR_MODES, TRACK_METRICS, hasMetric } from '../flyover/trackColor'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'
import type { Settings } from '../state/store'
import { IMAGERY_SOURCES, TERRAIN_SOURCES } from '../terrain/sources'
import { CLOUD_ALTITUDE_RANGE, SEA_TOP_RANGE, seaTopFor, type CloudMode, type CloudQuality, type SeaRender } from '../weather/sceneClouds'
import { useWeatherStore } from '../weather/store'
import { GradingPanel } from './GradingPanel'
import { InfoTip, MoreSettings, PanelSection, RangeField } from './PanelSection'
import { formatNumber, formatPercent } from './format'

const ZOOM_OFFSETS: { value: Settings['imageryZoomOffset']; label: string }[] = [
  { value: 0, label: 'Normal' },
  { value: 1, label: 'Fin' },
  { value: 2, label: 'Très fin' },
]

const EXAGGERATION_MIN = 1
const EXAGGERATION_MAX = 3
const EXAGGERATION_STEP = 0.1

const EXPOSURE_EV_MIN = -2
const EXPOSURE_EV_MAX = 2
const EXPOSURE_EV_STEP = 0.5

const WEATHER_STRENGTH_STEP = 0.05

/** 0.75 -> "75 %" */

/** 0.5 -> "+0,5 IL" */
function formatEv(ev: number): string {
  return `${ev > 0 ? '+' : ev < 0 ? '−' : ''}${formatNumber(Math.abs(ev), 1)} IL`
}

/** 10.5 -> "10 h 30" */
function formatHour(hour: number): string {
  const minutes = Math.round(hour * 60)
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

/** Day used for the chips and the day bar before a track is loaded. */
const PLAIN_DAY: SolarDay = { sunrise: 6, sunset: 18, noon: 12, polar: null }

/** Position of a solar hour along the slider. */
const hourAt = (hour: number) => `${(Math.min(Math.max(hour, 0), SUN_HOUR_RANGE.max) / SUN_HOUR_RANGE.max) * 100}%`

/** Night / twilight / day colours under the solar hour slider. */
function dayGradient(day: SolarDay): string {
  const { sunrise, sunset, noon } = day
  if (day.polar === 'night') return 'linear-gradient(90deg, var(--color-ink), var(--color-ink-soft), var(--color-ink))'
  if (sunrise === null || sunset === null) {
    return 'linear-gradient(90deg, var(--color-glacier), var(--color-white), var(--color-glacier))'
  }
  const stops = [
    `var(--color-ink) ${hourAt(sunrise - 1)}`,
    `var(--color-accent-light) ${hourAt(sunrise)}`,
    `var(--color-glacier) ${hourAt(sunrise + 1)}`,
    `var(--color-white) ${hourAt(noon)}`,
    `var(--color-glacier) ${hourAt(sunset - 1)}`,
    `var(--color-accent-light) ${hourAt(sunset)}`,
    `var(--color-ink) ${hourAt(sunset + 1)}`,
  ]
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

/**
 * « Lumière »: the sun follows the recorded time of the track or a fixed solar hour, chosen on a day bar (night,
 * sunrise, day, sunset at the place and on the day of the first track) or with a chip (one undo step per chip).
 */
function SunTimeControl() {
  const id = useId()
  const sunHour = useAppStore((s) => s.settings.sunHour)
  const sunFromTrack = useAppStore((s) => s.settings.sunFromTrack)
  const sunDate = useAppStore((s) => s.settings.sunDate)
  const setSetting = useAppStore((s) => s.setSetting)
  const startTime = useAppStore((s) => s.tracks[0]?.stats.startTime)
  const utcOffsetMin = useAppStore((s) => s.tracks[0]?.utcOffsetMin)
  const origin = useAppStore((s) => s.frameOrigin)
  const [today] = useState(() => Date.now())
  const trackHasTime = startTime !== undefined
  const follows = sunFromTrack && trackHasTime
  const lat = origin?.lat
  const lon = origin?.lon
  // same place and day as the scene: frame origin, the day chosen, else the UTC day of the first track's start
  const day = useMemo(
    () => (lat === undefined || lon === undefined ? null : solarDay(lat, lon, sunDayMs(sunDate, startTime, today))),
    [lat, lon, sunDate, startTime, today],
  )
  const shown = day ?? PLAIN_DAY
  const setHour = (hour: number) => getSettingsHistory().transaction(() => setSetting('sunHour', hour))

  let dayHint = 'Lever et coucher calculés une fois la trace chargée.'
  let solarTip = 'Heure du soleil au lieu de la sortie : à midi, il est au plus haut.'
  if (day?.polar === 'day') dayHint = 'Jour polaire : le soleil ne se couche pas ce jour-là.'
  else if (day?.polar === 'night') dayHint = 'Nuit polaire : le soleil ne se lève pas ce jour-là.'
  else if (day && day.sunrise !== null && day.sunset !== null && lon !== undefined) {
    const solar = `lever ${formatHour(day.sunrise)} · coucher ${formatHour(day.sunset)}`
    // clock time of the place only when the track gives its UTC offset (no time zone database)
    if (utcOffsetMin === undefined) dayHint = `Lever ${formatHour(day.sunrise)} · coucher ${formatHour(day.sunset)} (heure solaire)`
    else {
      const clock = (hour: number) => formatHour(clockHourOfSolar(hour, lon, utcOffsetMin))
      dayHint = `Lever ${clock(day.sunrise)} · coucher ${clock(day.sunset)} (heure locale)`
      solarTip = `${solarTip} Ce jour-là, en heure solaire : ${solar}.`
    }
  }

  return (
    <>
      <fieldset className="field fieldset">
        <legend className="field__label">Heure du soleil</legend>
        <div className="segmented">
          <label className="segmented__option">
            <input
              type="radio"
              name={`${id}-sun-mode`}
              checked={follows}
              disabled={!trackHasTime}
              aria-describedby={`${id}-sun-mode-hint`}
              onChange={() => setSetting('sunFromTrack', true)}
            />
            Suivre la trace
          </label>
          <label className="segmented__option">
            <input
              type="radio"
              name={`${id}-sun-mode`}
              checked={!follows}
              onChange={() => setSetting('sunFromTrack', false)}
            />
            Heure fixe
          </label>
        </div>
        <p id={`${id}-sun-mode-hint`} className="field__hint">
          {!trackHasTime
            ? '« Suivre la trace » demande une trace horodatée.'
            : follows
              ? 'Le soleil suit l’heure enregistrée au marqueur.'
              : 'Le soleil reste à la même heure tout le film.'}
        </p>
      </fieldset>

      {!follows && (
        <div className="field">
          <div className="field__label-row">
            <label className="field__label" htmlFor={`${id}-sun-hour`}>
              Heure solaire
            </label>
            <InfoTip text={solarTip} />
          </div>
          <div className="range-row">
            <div className="sun-day">
              <input
                id={`${id}-sun-hour`}
                className="range"
                type="range"
                min={SUN_HOUR_RANGE.min}
                max={SUN_HOUR_RANGE.max}
                step={SUN_HOUR_RANGE.step}
                value={sunHour}
                onChange={(e) => setSetting('sunHour', Number(e.currentTarget.value))}
                aria-valuetext={formatHour(sunHour)}
                aria-describedby={`${id}-sun-day`}
              />
              <div className="sun-day__bar" style={{ background: dayGradient(shown) }} aria-hidden="true">
                {shown.sunrise !== null && <span className="sun-day__mark" style={{ left: hourAt(shown.sunrise) }} />}
                {shown.sunset !== null && <span className="sun-day__mark" style={{ left: hourAt(shown.sunset) }} />}
              </div>
            </div>
            <output className="range-row__value range-row__value--wide" htmlFor={`${id}-sun-hour`}>
              {formatHour(sunHour)}
            </output>
          </div>
          <p id={`${id}-sun-day`} className="field__hint">
            {dayHint}
          </p>
          <div className="field__label-row">
            <label className="field__label" htmlFor={`${id}-sun-date`}>
              Jour
            </label>
            <InfoTip text="Vide : le jour de la sortie (aujourd’hui pour une trace sans heure). Une autre saison change la hauteur du soleil et l’heure du lever." />
          </div>
          <div className="sun-date">
            <input
              id={`${id}-sun-date`}
              className="input"
              type="date"
              value={sunDate}
              onChange={(e) => setSetting('sunDate', e.currentTarget.value)}
            />
            {sunDate && (
              <button type="button" className="btn btn--secondary" onClick={() => setSetting('sunDate', '')}>
                Jour de la sortie
              </button>
            )}
          </div>
          <div className="sun-chips" role="group" aria-label="Moments de la journée">
            {SUN_CHIPS.map((chip) => {
              const hour = sunChipHour(chip, shown)
              return (
                <button
                  key={chip}
                  type="button"
                  className="sun-chip"
                  aria-pressed={hour !== null && hour === sunHour}
                  disabled={hour === null}
                  title={hour === null ? 'Pas ce jour-là' : formatHour(hour)}
                  onClick={() => hour !== null && setHour(hour)}
                >
                  {SUN_CHIP_LABELS[chip]}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

const CLOUD_MODE_OPTIONS: { value: CloudMode; label: string }[] = [
  { value: 'meteo', label: 'Météo' },
  { value: 'manuel', label: 'Manuel' },
  { value: 'mer', label: 'Mer de nuages' },
  { value: 'aucun', label: 'Aucun' },
]
const SEA_RENDER_OPTIONS: { value: SeaRender; label: string }[] = [
  { value: 'volume', label: 'Volumétrique' },
  { value: 'surface', label: 'Nappe' },
]
const CLOUD_QUALITY_OPTIONS: { value: CloudQuality; label: string }[] = [
  { value: 'low', label: 'Rapide' },
  { value: 'medium', label: 'Moyenne' },
  { value: 'high', label: 'Fine' },
]

/**
 * « Nuages » (atmosphere on): volumetric clouds from the weather of the outing, a manual cover, a sea of clouds (its
 * top proposed from the first track when chosen), or none.
 */
function CloudsControl({ weatherReady }: { weatherReady: boolean }) {
  const id = useId()
  const clouds = useAppStore((s) => s.settings.clouds)
  const stats = useAppStore((s) => s.tracks[0]?.stats)
  const setSetting = useAppStore((s) => s.setSetting)
  const set = (patch: Partial<Settings['clouds']>) => setSetting('clouds', { ...clouds, ...patch })
  return (
    <>
      <fieldset className="field fieldset">
        <legend className="field__label">Nuages</legend>
        <div className="segmented">
          {CLOUD_MODE_OPTIONS.map((option) => (
            <label key={option.value} className="segmented__option">
              <input
                type="radio"
                name={`${id}-clouds-mode`}
                checked={clouds.mode === option.value}
                onChange={() =>
                  set(
                    option.value === 'mer'
                      ? { mode: 'mer', seaTopM: seaTopFor(stats?.minEle, stats?.maxEle) }
                      : { mode: option.value },
                  )
                }
              />
              {option.label}
            </label>
          ))}
        </div>
        <p className="field__hint">
          {clouds.mode === 'aucun'
            ? 'Pas de nuages en volume.'
            : clouds.mode === 'manuel'
              ? 'Couverture choisie ci-dessous, la même tout le film.'
              : clouds.mode === 'mer'
                ? 'Une couche de nuages bas, dense et plate, dont émergent les sommets.'
                : weatherReady
                ? 'Nuages bas, moyens et hauts de la météo au marqueur.'
                : 'Ciel dégagé tant que la météo de la sortie n’est pas chargée.'}
        </p>
      </fieldset>

      {clouds.mode === 'manuel' && (
        <RangeField
          label="Couverture nuageuse"
          min={0}
          max={1}
          step={0.05}
          value={clouds.coverage}
          format={formatPercent}
          onChange={(coverage) => set({ coverage })}
        />
      )}

      {clouds.mode === 'mer' && (
        <RangeField
          label="Sommet de la mer de nuages"
          tip="Altitude du dessus des nuages : les sommets plus hauts en émergent. Proposée aux trois quarts entre le point le plus bas et le plus haut de la trace."
          {...SEA_TOP_RANGE}
          value={clouds.seaTopM}
          format={(v) => `${formatNumber(v)} m`}
          onChange={(seaTopM) => set({ seaTopM })}
        />
      )}

      {clouds.mode === 'mer' && (
        <fieldset className="field fieldset">
          <legend className="field__label">Rendu de la mer de nuages</legend>
          <div className="segmented">
            {SEA_RENDER_OPTIONS.map((option) => (
              <label key={option.value} className="segmented__option">
                <input
                  type="radio"
                  name={`${id}-sea-render`}
                  checked={clouds.seaRender === option.value}
                  onChange={() => set({ seaRender: option.value })}
                />
                {option.label}
              </label>
            ))}
          </div>
          <p className="field__hint">
            {clouds.seaRender === 'surface'
              ? 'Une nappe de nuages éclairée, sans grain, plus légère à calculer.'
              : 'Des nuages en volume, plus coûteux.'}
          </p>
        </fieldset>
      )}

      {clouds.mode !== 'aucun' && (
        <MoreSettings paths={['clouds.altitudeM', 'clouds.quality']} label="Réglages des nuages">
          {clouds.mode !== 'mer' && (
            <RangeField
              label="Base des nuages bas"
              tip="Hauteur au-dessus du point le plus bas de la trace. Les nuages moyens sont 2 km plus haut."
              {...CLOUD_ALTITUDE_RANGE}
              value={clouds.altitudeM}
              format={(v) => `${formatNumber(v)} m`}
              onChange={(altitudeM) => set({ altitudeM })}
            />
          )}
          <div className="field">
            <div className="field__label-row">
              <label className="field__label" htmlFor={`${id}-clouds-quality`}>
                Qualité des nuages à l’export
              </label>
              <InfoTip text="L’aperçu reste en qualité rapide. Une qualité fine allonge l’export." />
            </div>
            <select
              id={`${id}-clouds-quality`}
              className="select"
              value={clouds.quality}
              onChange={(e) => set({ quality: e.currentTarget.value as CloudQuality })}
            >
              {CLOUD_QUALITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </MoreSettings>
      )}
    </>
  )
}

/** « Plans d'eau »: lakes and rivers of OpenStreetMap drawn as reflective water, and their strength. */
function WaterControl() {
  const id = useId()
  const water = useAppStore((s) => s.settings.water)
  const setSetting = useAppStore((s) => s.setSetting)
  return (
    <>
      <div className="field__label-row">
        <label className="checkbox" htmlFor={`${id}-water`}>
          <input
            id={`${id}-water`}
            type="checkbox"
            checked={water.enabled}
            onChange={(e) => setSetting('water', { ...water, enabled: e.currentTarget.checked })}
          />
          Lacs et rivières reflétants
        </label>
        <InfoTip text="Plans d’eau d’OpenStreetMap autour de la trace : reflets du ciel et du soleil, vaguelettes." />
      </div>
      {water.enabled && (
        <RangeField
          label="Intensité de l’eau"
          min={0}
          max={1}
          step={0.05}
          value={water.strength}
          format={formatPercent}
          onChange={(strength) => setSetting('water', { ...water, strength })}
        />
      )}
    </>
  )
}

/**
 * « Carte » tab (before the landmarks): sections Fond de carte, Relief et trace, Lumière, Atmosphère et météo, Couleurs
 * (`GradingPanel`), each with its essentials and its rarely used settings under « Plus de réglages ».
 */
export function SettingsPanel() {
  const settings = useAppStore((s) => s.settings)
  const setSetting = useAppStore((s) => s.setSetting)
  const id = useId()
  const terrainId = `${id}-terrain`
  const imageryId = `${id}-imagery`
  const wireframeId = `${id}-wireframe`
  const atmosphereId = `${id}-atmosphere`
  const shadowsId = `${id}-shadows`
  const weatherSceneId = `${id}-weather-scene`
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
    <>
      {/* the imagery source is left out of the marker: the import picks it per region (IGN, swisstopo) */}
      <PanelSection title="Fond de carte" keys={['terrainSourceId', 'imageryZoomOffset', 'water']}>
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

        <WaterControl />

        <MoreSettings paths={['imageryZoomOffset', 'terrainSourceId']}>
          <fieldset className="field fieldset">
            <legend className="field__label">Détail de l’imagerie</legend>
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
            <label className="field__label" htmlFor={terrainId}>
              Source du relief
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
        </MoreSettings>
      </PanelSection>

      <PanelSection title="Relief et trace" keys={['exaggeration', 'trackColorBy', 'wireframe']}>
        <RangeField
          label="Exagération du relief"
          tip="Multiplie les hauteurs pour accentuer les montagnes (×1 = relief réel)."
          min={EXAGGERATION_MIN}
          max={EXAGGERATION_MAX}
          step={EXAGGERATION_STEP}
          value={settings.exaggeration}
          format={(v) => `×${formatNumber(v, 1)}`}
          onChange={(exaggeration) => setSetting('exaggeration', exaggeration)}
          wide={false}
        />

        <div className="field">
          <label className="field__label" htmlFor={trackColorId}>
            Colorer selon
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

        <MoreSettings paths={['wireframe']}>
          <div className="field__label-row">
            <label className="checkbox" htmlFor={wireframeId}>
              <input
                id={wireframeId}
                type="checkbox"
                checked={settings.wireframe}
                onChange={(e) => setSetting('wireframe', e.currentTarget.checked)}
              />
              Filaire
            </label>
            <InfoTip text="Dessine le relief en triangles, pour voir le détail chargé." />
          </div>
        </MoreSettings>
      </PanelSection>

      <PanelSection title="Lumière" keys={['sunFromTrack', 'sunHour', 'sunDate']}>
        {settings.atmosphere ? (
          <SunTimeControl />
        ) : (
          <p className="field__hint">Activez l’atmosphère (section suivante) pour régler l’heure du soleil.</p>
        )}
      </PanelSection>

      <PanelSection title="Atmosphère et météo" keys={['atmosphere', 'shadows', 'exposureEv', 'weatherScene', 'clouds']}>
        <label className="checkbox checkbox--switch" htmlFor={atmosphereId}>
          <input
            id={atmosphereId}
            type="checkbox"
            checked={settings.atmosphere}
            onChange={(e) => setSetting('atmosphere', e.currentTarget.checked)}
          />
          Atmosphère : ciel, soleil et brume
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

        {settings.atmosphere && weatherReady && (
          <label className="checkbox" htmlFor={weatherSceneId}>
            <input
              id={weatherSceneId}
              type="checkbox"
              checked={settings.weatherScene.enabled}
              onChange={(e) => setSetting('weatherScene', { ...settings.weatherScene, enabled: e.currentTarget.checked })}
            />
            Météo dans la scène
          </label>
        )}

        {settings.atmosphere && <CloudsControl weatherReady={weatherReady} />}

        {settings.atmosphere && (
          <MoreSettings paths={['exposureEv', 'weatherScene.strength']} label="Exposition et intensité">
            <RangeField
              label="Exposition"
              tip="Éclaircit ou assombrit l’image, en plus du réglage automatique selon le soleil."
              min={EXPOSURE_EV_MIN}
              max={EXPOSURE_EV_MAX}
              step={EXPOSURE_EV_STEP}
              value={settings.exposureEv}
              format={formatEv}
              onChange={(exposureEv) => setSetting('exposureEv', exposureEv)}
            />

            {weatherReady && settings.weatherScene.enabled && (
              <RangeField
                label="Intensité de la météo"
                min={0}
                max={1}
                step={WEATHER_STRENGTH_STEP}
                value={settings.weatherScene.strength}
                format={formatPercent}
                onChange={(strength) => setSetting('weatherScene', { ...settings.weatherScene, strength })}
              />
            )}
          </MoreSettings>
        )}
      </PanelSection>

      <GradingPanel />
    </>
  )
}

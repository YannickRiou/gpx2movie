import { useMemo } from 'react'
import { TRACK_METRICS, robustRange, trackMetricValues } from '../flyover/trackColor'
import { useAppStore } from '../state/store'
import { formatNumber } from './format'

/**
 * Legend of the track colouring over the 3D view: quantity, colormap, and the shared colour range
 * (2nd–98th percentile: values beyond saturate at the ends), and the grey of the points without a value.
 */
export function TrackLegend() {
  const tracks = useAppStore((s) => s.tracks)
  const colorBy = useAppStore((s) => s.settings.trackColorBy)
  const { range, missing } = useMemo(() => {
    if (colorBy === 'none') return { range: null, missing: false }
    const series = tracks.flatMap((track) => trackMetricValues(track, colorBy))
    return { range: robustRange(series), missing: series.some((values) => values.some(Number.isNaN)) }
  }, [tracks, colorBy])

  if (colorBy === 'none' || tracks.length === 0) return null
  const { label, unit, fractionDigits, colormap } = TRACK_METRICS[colorBy]
  const format = (value: number) => `${formatNumber(value, fractionDigits)} ${unit}`

  return (
    <div className="track-legend" role="group" aria-label={`Légende : ${label}`}>
      <span className="track-legend__title">{label}</span>
      {range ? (
        <>
          <span
            className="track-legend__bar"
            style={{ backgroundImage: `linear-gradient(to right, ${colormap.join(', ')})` }}
            title="Les valeurs extrêmes (2 % de chaque côté) prennent la couleur des bornes"
          />
          <span className="track-legend__range">
            <span>{format(range.min)}</span>
            <span>{format(range.max)}</span>
          </span>
        </>
      ) : null}
      {missing && (
        <span className="track-legend__missing">
          <span className="track-legend__swatch" />
          {range ? 'Sans donnée' : 'Aucune donnée sur ces traces'}
        </span>
      )}
    </div>
  )
}

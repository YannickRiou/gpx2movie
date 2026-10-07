/**
 * French number formatting for the UI. Deterministic (no Intl) so tests behave the same on
 * every ICU build. Thousands are separated by a narrow no-break space (U+202F), as in French typography.
 */
import type { TrackStats } from '../core/types'

const THIN_SPACE = ' '
const PLACEHOLDER = '–'

/** 1234567.8 -> "1 234 567,8" (decimal comma, narrow no-break space thousands separator). */
export function formatNumber(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return PLACEHOLDER
  const fixed = Math.abs(value).toFixed(fractionDigits)
  const [intPart, fracPart] = fixed.split('.')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)
  const sign = value < 0 && Number(fixed) !== 0 ? '-' : ''
  return fracPart ? `${sign}${grouped},${fracPart}` : `${sign}${grouped}`
}

/** Metres -> "850 m" below 1 km, otherwise "12,4 km" (999,6 m rounds up to "1,0 km", never "1 000 m"). */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return PLACEHOLDER
  if (Math.round(metres) < 1000) return `${formatNumber(metres)} m`
  return `${formatNumber(metres / 1000, 1)} km`
}

/** Metres of climb -> "980 m" (rounded, never negative). */
export function formatAscent(metres: number): string {
  if (!Number.isFinite(metres)) return PLACEHOLDER
  return `${formatNumber(Math.max(0, metres))} m`
}

/** Seconds -> "4 h 12" (minutes zero-padded) or "35 min" under one hour. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return PLACEHOLDER
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  return `${hours} h ${String(minutes).padStart(2, '0')}`
}

/** "12,4 km · D+ 980 m · 4 h 12" (duration omitted when unknown). */
export function formatTrackSummary(stats: TrackStats): string {
  const parts = [formatDistance(stats.distanceM), `D+ ${formatAscent(stats.ascentM)}`]
  if (stats.durationS !== undefined && stats.durationS > 0) parts.push(formatDuration(stats.durationS))
  return parts.join(' · ')
}

const MINUS = '−'

/** Time gap (ms, positive = behind) -> "+45 s", "+1 min 20", "−1 h 05", "0 s". */
export function formatTimeGap(ms: number): string {
  if (!Number.isFinite(ms)) return PLACEHOLDER
  const total = Math.round(Math.abs(ms) / 1000)
  if (total === 0) return '0 s'
  const sign = ms > 0 ? '+' : MINUS
  if (total < 60) return `${sign}${total} s`
  if (total < 3600) return `${sign}${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')}`
  const minutes = Math.round(total / 60)
  return `${sign}${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

/** Distance gap (m, negative = behind) -> "−350 m", "+1,2 km", "0 m". */
export function formatDistanceGap(metres: number): string {
  if (!Number.isFinite(metres)) return PLACEHOLDER
  if (Math.round(metres) === 0) return '0 m'
  return `${metres > 0 ? '+' : MINUS}${formatDistance(Math.abs(metres))}`
}

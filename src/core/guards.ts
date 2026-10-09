/**
 * Small checks shared by the validation of loaded projects and presets (`isValid*`, `SETTING_UPGRADES`). Pure.
 */

/** A plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** A number inside `range` (bounds included). */
export function inRange(value: unknown, range: { min: number; max: number }): boolean {
  return typeof value === 'number' && value >= range.min && value <= range.max
}

/** One of the strings of `list`. */
export function oneOf(list: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && list.includes(value)
}

/** Keys of `defaults` missing from `raw` taken from `defaults` (a setting saved before a field was added). */
export function withDefaults<T extends object>(defaults: T): (raw: unknown) => unknown {
  return (raw) => (isRecord(raw) ? { ...defaults, ...raw } : raw)
}

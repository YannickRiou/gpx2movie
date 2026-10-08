import { describe, expect, it } from 'vitest'
import { isValidSetting, sanitizeSettings } from '../project/document'
import { DEFAULT_SETTINGS } from '../state/store'
import { DEFAULT_POSTER, POSTER_FORMATS, isValidPoster, posterSize } from './settings'
import type { PosterSettings } from './settings'

describe('poster settings', () => {
  it('accepts the defaults and is part of the settings', () => {
    expect(isValidPoster(DEFAULT_POSTER)).toBe(true)
    expect(isValidSetting('poster', DEFAULT_POSTER)).toBe(true)
    expect(DEFAULT_SETTINGS.poster).toBe(DEFAULT_POSTER)
  })

  it('rejects unknown formats and styles, and a malformed value from a project', () => {
    expect(isValidPoster({ ...DEFAULT_POSTER, format: 'a0' as PosterSettings['format'] })).toBe(false)
    expect(isValidPoster({ ...DEFAULT_POSTER, style: 'neon' as PosterSettings['style'] })).toBe(false)
    const custom: PosterSettings = { ...DEFAULT_POSTER, format: 'square', style: 'app', title: 'Tour', figures: { ...DEFAULT_POSTER.figures, climbs: false } }
    expect(sanitizeSettings({ poster: custom }).settings.poster).toEqual(custom)
    const { settings, invalid } = sanitizeSettings({ poster: { ...custom, figures: { distance: true } } })
    expect(settings.poster).toBe(DEFAULT_POSTER)
    expect(invalid).toEqual(['poster'])
  })

  it('prints at 300 dpi, the long side at most 4960 px', () => {
    expect(posterSize('a4-portrait')).toEqual({ width: 2480, height: 3508 })
    expect(posterSize('a3-landscape')).toEqual({ width: 4960, height: 3508 })
    for (const f of POSTER_FORMATS) expect(Math.max(f.width, f.height)).toBeLessThanOrEqual(4960)
    expect(posterSize('square')).toEqual({ width: 2160, height: 2160 })
  })
})

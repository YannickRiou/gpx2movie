import { describe, expect, it } from 'vitest'
import { sanitizeSettings } from '../project/document'
import { DEFAULT_SETTINGS } from '../state/store'
import {
  DEFAULT_MARKER,
  DEFAULT_TRACK_STYLE,
  figureMotion,
  isValidMarker,
  isValidTrackStyle,
  MARKER_FIGURES,
  MARKER_IMAGE_MAX_CHARS,
  withMarkerDefaults,
} from './markerSettings'
import { MARKER_FIGURE_PATHS } from './markerFigures'

describe('track style and marker settings', () => {
  it('accepts the defaults, rejects unknown choices, out-of-range sizes and anything but a bounded image data URL', () => {
    expect(isValidTrackStyle(DEFAULT_TRACK_STYLE)).toBe(true)
    expect(isValidMarker(DEFAULT_MARKER)).toBe(true)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, dash: 'zigzag' as never })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, width: 40 })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, smoothingM: -10 })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, smoothingM: 500 })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, smoothingM: 100 })).toBe(true)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, glowIntensity: 0 })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, glowIntensity: 1.5 })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, glowWidth: 200 })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, glowColor: 'red' })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, glowColor: '#FFD23F', glowIntensity: 1, glowWidth: 64 })).toBe(true)
    expect(isValidMarker({ ...DEFAULT_MARKER, figure: 'cheval' as never })).toBe(false)
    expect(isValidMarker({ ...DEFAULT_MARKER, size: 0 })).toBe(false)
    expect(isValidMarker({ ...DEFAULT_MARKER, image: 'https://example.org/me.png' })).toBe(false)
    expect(isValidMarker({ ...DEFAULT_MARKER, image: 'data:image/png;base64,AAAA' })).toBe(true)
    expect(isValidMarker({ ...DEFAULT_MARKER, image: `data:image/png;base64,${'A'.repeat(MARKER_IMAGE_MAX_CHARS)}` })).toBe(false)
  })

  it('projects: older ones get the defaults, a partial marker is completed, an invalid one is reported', () => {
    expect(sanitizeSettings({}).settings.marker).toBe(DEFAULT_SETTINGS.marker)
    expect(withMarkerDefaults({ kind: 'figurine' })).toEqual({ ...DEFAULT_MARKER, kind: 'figurine' })
    const { settings, invalid } = sanitizeSettings({ marker: { kind: 'figurine', figure: 'skieur' }, trackStyle: { width: 'x' } })
    expect(settings.marker).toEqual({ ...DEFAULT_MARKER, kind: 'figurine', figure: 'skieur' })
    expect(invalid).toEqual(['trackStyle'])
    // a track style saved before the smoothing and the glow settings existed: off, default glow (track colour)
    const older = sanitizeSettings({ trackStyle: { width: 6, dash: 'tirets', glow: true, drawOn: true } })
    expect(older.invalid).toEqual([])
    expect(older.settings.trackStyle).toEqual({ ...DEFAULT_TRACK_STYLE, width: 6, dash: 'tirets', glow: true, drawOn: true, smoothingM: 0 })
    expect(older.settings.trackStyle.glowColor).toBe('')
  })

  it('has a pictogram for every figure', () => {
    for (const figure of MARKER_FIGURES) expect(MARKER_FIGURE_PATHS[figure].length).toBeGreaterThan(0)
  })
})

describe('figureMotion', () => {
  it('bounces twice a second and sways both ways, a function of the film time alone', () => {
    expect(figureMotion(0)).toEqual({ lift: 0, tilt: 0 })
    // a quarter step: top of the bounce, leaning forward
    const top = figureMotion(0.25)
    expect(top.lift).toBeCloseTo(0.08, 6)
    expect(top.tilt).toBeGreaterThan(0)
    expect(figureMotion(0.75).tilt).toBeLessThan(0)
    expect(figureMotion(0.5).lift).toBeCloseTo(0, 6)
  })
})

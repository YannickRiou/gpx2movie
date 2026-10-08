import { describe, expect, it } from 'vitest'
import { sanitizeSettings } from '../project/document'
import { DEFAULT_SETTINGS } from '../state/store'
import {
  DEFAULT_MARKER,
  DEFAULT_TRACK_STYLE,
  isValidMarker,
  isValidTrackStyle,
  MARKER_FIGURES,
  MARKER_IMAGE_MAX_CHARS,
  withMarkerDefaults,
} from './markerSettings'
import { MARKER_FIGURE_PATHS } from './markerFigures'

describe('track style and marker settings', () => {
  it('defaults keep the former look: 4 px solid line, white ball', () => {
    expect(DEFAULT_TRACK_STYLE).toEqual({ width: 4, dash: 'plein', glow: false, drawOn: false })
    expect(DEFAULT_MARKER.kind).toBe('boule')
    expect(isValidTrackStyle(DEFAULT_TRACK_STYLE)).toBe(true)
    expect(isValidMarker(DEFAULT_MARKER)).toBe(true)
  })

  it('rejects unknown choices, out-of-range sizes and anything but a bounded image data URL', () => {
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, dash: 'zigzag' as never })).toBe(false)
    expect(isValidTrackStyle({ ...DEFAULT_TRACK_STYLE, width: 40 })).toBe(false)
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
  })

  it('has a pictogram for every figure', () => {
    for (const figure of MARKER_FIGURES) expect(MARKER_FIGURE_PATHS[figure].length).toBeGreaterThan(0)
  })
})

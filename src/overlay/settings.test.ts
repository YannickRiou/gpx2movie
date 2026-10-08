import { describe, expect, it } from 'vitest'
import { isValidSetting, sanitizeSettings } from '../project/document'
import { DEFAULT_OVERLAY, isValidOverlay, withOverlayDefaults } from './settings'
import type { OverlaySettings } from './settings'

const withPatch = (patch: (o: OverlaySettings) => void): OverlaySettings => {
  const copy = structuredClone(DEFAULT_OVERLAY)
  patch(copy)
  return copy
}

describe('overlay settings', () => {
  it('accepts the defaults', () => {
    expect(isValidOverlay(DEFAULT_OVERLAY)).toBe(true)
    expect(isValidSetting('overlay', DEFAULT_OVERLAY)).toBe(true)
  })

  it('rejects unknown styles and anchors, out-of-range values and foreign logos', () => {
    expect(isValidOverlay(withPatch((o) => (o.style = 'neon' as OverlaySettings['style'])))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.counters.anchor = 'nowhere' as OverlaySettings['counters']['anchor'])))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.title.end = 0.9)))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.end.start = 0.1)))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.text.size = 5)))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.profile.width = 1)))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.logo.image = 'https://example.org/logo.png')))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.logo.image = 'data:image/png;base64,iVBORw0KGgo=')))).toBe(true)
  })

  it('is restored from a project, or replaced by the default when a widget is malformed', () => {
    const custom = withPatch((o) => {
      o.enabled = true
      o.style = 'broadcast'
      o.counters.fields.heartRate = true
    })
    expect(sanitizeSettings({ overlay: custom }).settings.overlay).toEqual(custom)
    const broken = { ...custom, counters: { ...custom.counters, fields: { distance: true } } }
    const { settings, invalid } = sanitizeSettings({ overlay: broken })
    expect(settings.overlay).toEqual(DEFAULT_OVERLAY)
    expect(invalid).toEqual(['overlay'])
  })

  it('loads an overlay saved before the mini-map with the mini-map off', () => {
    const custom = withPatch((o) => {
      o.enabled = true
      o.style = 'app'
    })
    const { minimap: _minimap, ...old } = custom
    const { settings, invalid } = sanitizeSettings({ overlay: old })
    expect(invalid).toEqual([])
    expect(settings.overlay).toEqual({ ...custom, minimap: DEFAULT_OVERLAY.minimap })
    expect(settings.overlay.minimap.enabled).toBe(false)
    // only the widgets added since are filled in
    expect(withOverlayDefaults(custom)).toBe(custom)
    expect(withOverlayDefaults('x')).toBe('x')
    const { counters: _counters, ...missingCounters } = old
    expect(sanitizeSettings({ overlay: missingCounters }).invalid).toEqual(['overlay'])
  })

  it('loads an overlay saved before the credits with the credits on', () => {
    const { credits: _credits, ...old } = withPatch((o) => (o.enabled = true))
    const { settings, invalid } = sanitizeSettings({ overlay: old })
    expect(invalid).toEqual([])
    expect(settings.overlay.credits).toEqual({ enabled: true, position: 'bottom-right' })
  })

  it('validates the credits', () => {
    expect(isValidOverlay(withPatch((o) => (o.credits.position = 'top-left')))).toBe(true)
    expect(isValidOverlay(withPatch((o) => (o.credits.position = 'center' as OverlaySettings['credits']['position'])))).toBe(false)
    expect(sanitizeSettings({ overlay: { ...DEFAULT_OVERLAY, credits: { enabled: 'yes', position: 'top-left' } } }).invalid).toEqual(['overlay'])
  })

  it('validates the mini-map', () => {
    expect(isValidOverlay(withPatch((o) => (o.minimap.anchor = 'nowhere' as OverlaySettings['minimap']['anchor'])))).toBe(false)
    expect(isValidOverlay(withPatch((o) => (o.minimap.size = 3)))).toBe(false)
    const broken = { ...DEFAULT_OVERLAY, minimap: { enabled: true, anchor: 'top-left', size: 1 } }
    expect(sanitizeSettings({ overlay: broken }).invalid).toEqual(['overlay'])
  })
})

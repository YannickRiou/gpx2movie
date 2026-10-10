// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { buildTrack } from './import/stats'

/** renders of the mocked heavy parts, by name */
const renders = vi.hoisted(() => new Map<string, number>())
const counted = (name: string) => () => {
  renders.set(name, (renders.get(name) ?? 0) + 1)
  return null
}
vi.mock('./ui/Stage', () => ({ Stage: counted('Stage') }))
vi.mock('./ui/Timeline', () => ({ Timeline: counted('Timeline') }))
vi.mock('./ui/TrackList', () => ({ TrackList: counted('TrackList') }))
vi.mock('./ui/SettingsPanel', () => ({ MapSettings: counted('MapSettings'), WeatherSettings: counted('WeatherSettings'), LightSettings: counted('LightSettings') }))
vi.mock('./ui/TrackMarkerSection', () => ({ TrackMarkerSection: counted('TrackMarkerSection') }))
vi.mock('./ui/ClimbList', () => ({ ClimbList: counted('ClimbList') }))
vi.mock('./ui/LandmarkPanel', () => ({ LandmarkPanel: counted('LandmarkPanel') }))
vi.mock('./ui/PoiPanel', () => ({ PoiPanel: counted('PoiPanel') }))
vi.mock('./ui/WeatherPanel', () => ({ WeatherPanel: counted('WeatherPanel') }))
vi.mock('./ui/GradingPanel', () => ({ GradingPanel: counted('GradingPanel') }))
vi.mock('./ui/CameraPanel', () => ({ CameraPanel: counted('CameraPanel') }))
vi.mock('./ui/LensPanel', () => ({ LensPanel: counted('LensPanel') }))
vi.mock('./ui/OverlayPanel', () => ({ OverlayPanel: counted('OverlayPanel') }))
vi.mock('./ui/ProjectPanel', () => ({ ProjectPanel: counted('ProjectPanel') }))
vi.mock('./ui/OfflinePanel', () => ({ OfflinePanel: counted('OfflinePanel') }))

const { default: App } = await import('./App')
const { useAppStore } = await import('./state/store')

describe('App shell', () => {
  it('switches tabs without rendering the panels, the stage or the timeline again', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView = () => {} // not in jsdom
    const segments = [{ points: [6.8, 6.81, 6.82].map((lon) => ({ lon, lat: 45.9 })) }]
    useAppStore.setState({ tracks: [buildTrack({ name: 'Sortie', source: 'gpx', segments })] })
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<App />))
    const before = new Map(renders)
    expect(before.get('CameraPanel')).toBeGreaterThan(0)

    for (const tab of ['carte', 'survol', 'projet']) {
      await act(async () => document.getElementById(`tab-${tab}`)!.click())
      expect(document.getElementById(`tab-panel-${tab}`)!.hidden).toBe(false)
    }
    expect(renders).toEqual(before)
    act(() => root.unmount())
  })
})

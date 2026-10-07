import { OverlayCanvas } from './overlay/OverlayCanvas'
import { FlyoverCanvas } from './scene/FlyoverCanvas'
import { useAppStore } from './state/store'
import { CameraPanel } from './ui/CameraPanel'
import { ClimbList } from './ui/ClimbList'
import { ExportPanel } from './ui/ExportPanel'
import { ImportPanel } from './ui/ImportPanel'
import { LandmarkPanel } from './ui/LandmarkPanel'
import { OverlayPanel } from './ui/OverlayPanel'
import { ProjectPanel } from './ui/ProjectPanel'
import { SettingsPanel } from './ui/SettingsPanel'
import { StatusBar } from './ui/StatusBar'
import { Timeline } from './ui/Timeline'
import { TrackLegend } from './ui/TrackLegend'
import { TrackList } from './ui/TrackList'
import { WeatherPanel } from './ui/WeatherPanel'
import './ui/app.css'

export default function App() {
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  const requestFit = useAppStore((s) => s.requestFit)
  const trackColored = useAppStore((s) => s.settings.trackColorBy !== 'none')

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Panneau de contrôle">
        {/* scrollable body; the status bar (attributions) stays pinned below it */}
        <div className="sidebar__body">
          <header className="header">
            <img className="header__logo" src="/favicon.svg" alt="" width={40} height={40} />
            <div>
              <h1 className="header__title">OpenFlyover</h1>
              <p className="header__tagline">Vos traces en relief</p>
            </div>
          </header>

          <ImportPanel />
          <TrackList />
          <WeatherPanel />
          <LandmarkPanel />
          <ClimbList />
          <SettingsPanel />
          <CameraPanel />
          <OverlayPanel />

          <button type="button" className="btn btn--primary btn--block" onClick={requestFit} disabled={!hasTracks}>
            Recadrer la vue
          </button>

          <ProjectPanel />
          <ExportPanel />
        </div>

        <StatusBar />
      </aside>

      <main className="view" aria-label="Vue 3D">
        <FlyoverCanvas />
        <OverlayCanvas />
        <Timeline />
        {trackColored && <TrackLegend />}
      </main>
    </div>
  )
}

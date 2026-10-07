import { FlyoverCanvas } from './scene/FlyoverCanvas'
import { useAppStore } from './state/store'
import { ImportPanel } from './ui/ImportPanel'
import { SettingsPanel } from './ui/SettingsPanel'
import { StatusBar } from './ui/StatusBar'
import { Timeline } from './ui/Timeline'
import { TrackList } from './ui/TrackList'
import './ui/app.css'

export default function App() {
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  const requestFit = useAppStore((s) => s.requestFit)

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
          <SettingsPanel />

          <button type="button" className="btn btn--primary btn--block" onClick={requestFit} disabled={!hasTracks}>
            Recadrer la vue
          </button>
        </div>

        <StatusBar />
      </aside>

      <main className="view" aria-label="Vue 3D">
        <FlyoverCanvas />
        <Timeline />
      </main>
    </div>
  )
}

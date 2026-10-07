import { useAppStore } from '../state/store'
import { DropZone } from './DropZone'
import { importTrackFiles, loadSample } from './projectActions'

/** Empty state of the « Trace » tab: drop zone + sample button, shown until a track is loaded. */
export function ImportPanel() {
  const loading = useAppStore((s) => s.loading)
  const hasTracks = useAppStore((s) => s.tracks.length > 0)
  if (hasTracks) return null

  return (
    <section aria-label="Import de traces" className="import">
      <DropZone onFiles={importTrackFiles} busy={loading} />
      <button type="button" className="btn btn--secondary btn--block" onClick={loadSample} disabled={loading}>
        Charger l'exemple
      </button>
    </section>
  )
}

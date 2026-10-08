import { useAppStore } from '../state/store'
import { Icon } from './icons'
import { chooseProjectToOpen, chooseTracksToImport, loadSample } from './projectActions'

/** Welcome card on the stage until a track is loaded: drop hint, file picker, the sample, open a project. */
export function EmptyState() {
  const loading = useAppStore((s) => s.loading)
  return (
    <section className="empty" aria-labelledby="empty-title" aria-busy={loading}>
      <span className="empty__icon" aria-hidden="true">
        <Icon name="upload" size={26} />
      </span>
      <h2 id="empty-title" className="empty__title">
        Glissez vos traces GPX ou FIT ici
      </h2>
      <p className="empty__hint">Ou n'importe où dans la fenêtre, un ou plusieurs à la fois.</p>
      <div className="empty__actions">
        <button type="button" className="btn btn--primary" onClick={() => void chooseTracksToImport()} disabled={loading}>
          {loading ? 'Import en cours…' : 'Choisir un fichier'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={loadSample} disabled={loading}>
          Essayer avec l'exemple (Tour du Mont-Blanc)
        </button>
      </div>
      <button type="button" className="empty__link" onClick={() => void chooseProjectToOpen()} disabled={loading}>
        Ouvrir un projet…
      </button>
    </section>
  )
}

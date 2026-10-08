import { useRef } from 'react'
import { useAppStore } from '../state/store'
import { Icon } from './icons'
import { loadSample, openFiles } from './projectActions'

const TRACK_ACCEPT = '.gpx,.fit'
const PROJECT_ACCEPT = '.json,application/json'

/** Welcome card on the stage until a track is loaded: drop hint, file picker, the sample, open a project. */
export function EmptyState() {
  const loading = useAppStore((s) => s.loading)
  const input = useRef<HTMLInputElement>(null)

  const pick = (accept: string) => {
    if (!input.current) return
    input.current.accept = accept
    input.current.click()
  }

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
        <button type="button" className="btn btn--primary" onClick={() => pick(TRACK_ACCEPT)} disabled={loading}>
          {loading ? 'Import en cours…' : 'Choisir un fichier'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={loadSample} disabled={loading}>
          Essayer avec l'exemple (Tour du Mont-Blanc)
        </button>
      </div>
      <button type="button" className="empty__link" onClick={() => pick(PROJECT_ACCEPT)} disabled={loading}>
        Ouvrir un projet…
      </button>
      <input
        ref={input}
        className="visually-hidden"
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void openFiles(Array.from(e.currentTarget.files ?? []))
          e.currentTarget.value = ''
        }}
      />
    </section>
  )
}

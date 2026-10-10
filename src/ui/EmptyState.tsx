import type { ProjectEntry } from '../platform'
import { useAppStore } from '../state/store'
import { libraryFile, useLibraryStore } from './library'
import { chooseProjectToOpen, chooseTracksToImport, loadSample, openProject } from './projectActions'
import { StravaImport } from './StravaImport'

/** Projects of « Mes projets » offered on the home screen, most recent first. */
const RECENT_COUNT = 3

/**
 * Home screen until a track is loaded, over the whole view: import (drop anywhere or the file picker), Strava, the
 * sample, open a project, and the latest projects of « Mes projets ».
 */
export function EmptyState() {
  const loading = useAppStore((s) => s.loading)
  // the list is read by the « Projet » tab, always mounted; the open entry (emptied of its tracks) is not offered
  const entries = useLibraryStore((s) => s.entries)
  const currentId = useLibraryStore((s) => s.currentId)
  const recent = entries.filter((e) => e.id !== currentId).slice(0, RECENT_COUNT)

  const open = async (entry: ProjectEntry) => {
    const file = await libraryFile(entry)
    if (file) await openProject(file, entry)
  }

  return (
    <section className="empty" aria-labelledby="empty-title" aria-busy={loading}>
      <div className="empty__inner">
        <img className="empty__logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={64} height={64} />
        <h2 id="empty-title" className="empty__title">
          Votre sortie, vue du ciel
        </h2>
        <p className="empty__hint">Glissez une ou plusieurs traces GPX ou FIT n’importe où dans la fenêtre.</p>
        <button type="button" className="btn btn--primary empty__primary" onClick={() => void chooseTracksToImport()} disabled={loading}>
          {loading ? 'Import en cours…' : 'Choisir un fichier'}
        </button>
        <div className="empty__actions">
          <StravaImport />
          <button type="button" className="btn btn--secondary" onClick={loadSample} disabled={loading}>
            Essayer avec l'exemple
          </button>
        </div>
        <button type="button" className="empty__link" onClick={() => void chooseProjectToOpen()} disabled={loading}>
          Ouvrir un projet…
        </button>

        {recent.length > 0 && (
          <section className="empty__recent" aria-labelledby="empty-recent">
            <h3 id="empty-recent" className="empty__recent-title">
              Récents
            </h3>
            <ul>
              {recent.map((entry) => (
                <li key={entry.id}>
                  <button type="button" className="empty__project" onClick={() => void open(entry)} disabled={loading}>
                    {entry.thumbnail ? <img className="library__thumb" src={entry.thumbnail} alt="" /> : <span className="library__thumb" aria-hidden="true" />}
                    <span className="empty__project-name">{entry.name}</span>
                    <span className="empty__project-summary">{entry.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  )
}

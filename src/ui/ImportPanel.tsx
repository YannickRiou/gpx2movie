import { useCallback } from 'react'
import { importFile, importText } from '../import'
import { useAppStore } from '../state/store'
import { DropZone } from './DropZone'
import { formatImportError, runImportJobs } from './importFlow'
import type { ImportJob } from './importFlow'

const SAMPLE_URL = '/samples/tour-du-mont-blanc-j1.gpx'
const SAMPLE_NAME = 'tour-du-mont-blanc-j1.gpx'

/**
 * Drop zone + sample button + error banner. Drives the store around `runImportJobs`:
 * loading flag during the batch, one `addTracks` for every parsed track, failures in the banner.
 */
export function ImportPanel() {
  const loading = useAppStore((s) => s.loading)
  const importError = useAppStore((s) => s.importError)

  const runImport = useCallback(async (jobs: ImportJob[]) => {
    const { setLoading, setImportError, addTracks } = useAppStore.getState()
    setLoading(true)
    setImportError(null)
    try {
      const { tracks, failures } = await runImportJobs(jobs, () => useAppStore.getState().tracks.length)
      // addTracks clears importError, so the banner is set afterwards
      if (tracks.length > 0) addTracks(tracks)
      setImportError(formatImportError(failures))
    } finally {
      setLoading(false)
    }
  }, [])

  const onFiles = useCallback(
    (files: File[]) => {
      void runImport(files.map((file) => ({ label: file.name, run: (i) => importFile(file, i) })))
    },
    [runImport],
  )

  const loadSample = () => {
    void runImport([
      {
        label: "l'exemple",
        async run(colorIndex) {
          const response = await fetch(SAMPLE_URL)
          if (!response.ok) throw new Error(`fichier indisponible (HTTP ${response.status})`)
          return importText(await response.text(), SAMPLE_NAME, colorIndex)
        },
      },
    ])
  }

  return (
    <section aria-label="Import de traces" className="import">
      <DropZone onFiles={onFiles} busy={loading} />
      <button type="button" className="btn btn--secondary btn--block" onClick={loadSample} disabled={loading}>
        Charger l'exemple
      </button>
      {importError && (
        <div className="alert" role="alert">
          <span className="alert__text">{importError}</span>
          <button
            type="button"
            className="alert__close"
            aria-label="Fermer le message d'erreur"
            onClick={() => useAppStore.getState().setImportError(null)}
          >
            ×
          </button>
        </div>
      )}
    </section>
  )
}

/**
 * File actions shared by the top bar, its keyboard shortcuts and the panels: save / open the project file,
 * import GPX / FIT tracks and the sample.
 */
import { useMediaStore } from '../film/media'
import { importFile, importText } from '../import'
import { applyProject } from '../project/apply'
import { parseProject, projectFileName, serializeProject } from '../project/document'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'
import { formatImportError, runImportJobs } from './importFlow'
import type { ImportJob } from './importFlow'
import { effectiveProjectName } from './shell'

export interface ProjectMessage {
  text: string
  error: boolean
}

/** Start a download of `text` as `fileName` (object URL released once the click has been handled). */
function downloadText(text: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Download the project as `<nom>.openflyover.json` and mark it saved. */
export function saveProject(): void {
  const state = useAppStore.getState()
  const name = effectiveProjectName(state.projectName, state.tracks[0]?.name)
  downloadText(serializeProject(state, name, useMediaStore.getState().table), projectFileName(name))
  state.markProjectSaved()
}

/** Replace everything by the project in `file`; the warnings or the error to show, null when none. */
export async function openProject(file: File): Promise<ProjectMessage | null> {
  try {
    const project = parseProject(await file.text())
    applyProject(project)
    getSettingsHistory().clear()
    const store = useAppStore.getState()
    store.setProjectName(project.name)
    store.markProjectSaved()
    return project.warnings.length > 0 ? { text: project.warnings.join('\n'), error: false } : null
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return { text: `Impossible d'ouvrir « ${file.name} » : ${reason}`, error: true }
  }
}

const SAMPLE_URL = '/samples/tour-du-mont-blanc-j1.gpx'
const SAMPLE_NAME = 'tour-du-mont-blanc-j1.gpx'

/**
 * Drives the store around `runImportJobs`: loading flag during the batch, one `addTracks` for every parsed track,
 * failures in `importError` (shown over the view).
 */
async function runImport(jobs: ImportJob[]): Promise<void> {
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
}

/** Import GPX / FIT files (the importer rejects other formats with an explicit message). */
export function importTrackFiles(files: readonly File[]): void {
  if (files.length === 0) return
  void runImport(files.map((file) => ({ label: file.name, run: (i) => importFile(file, i) })))
}

export function loadSample(): void {
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

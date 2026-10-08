/**
 * File actions shared by the top bar, its keyboard shortcuts, the window drop and the panels: save / open the project
 * file, import GPX / FIT tracks and the sample. Outcomes are shown as toasts.
 */
import { useMediaStore } from '../film/media'
import { importFile, importText } from '../import'
import { applyProject } from '../project/apply'
import { parseProject, projectFileName, serializeProject } from '../project/document'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'
import { importFiles } from './importFlow'
import type { ImportJob } from './importFlow'
import { effectiveProjectName, routeOpenedFiles } from './shell'
import { showToast } from './toast'

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
  const fileName = projectFileName(name)
  downloadText(serializeProject(state, name, useMediaStore.getState().table), fileName)
  state.markProjectSaved()
  showToast({ kind: 'success', text: `Projet enregistré : ${fileName}` })
}

/** Replace everything by the project in `file`; says so, with the warnings of the file, or why it failed. */
export async function openProject(file: File): Promise<void> {
  try {
    const project = parseProject(await file.text())
    applyProject(project)
    getSettingsHistory().clear()
    const store = useAppStore.getState()
    store.setProjectName(project.name)
    store.markProjectSaved()
    const opened = `Projet « ${effectiveProjectName(project.name, store.tracks[0]?.name)} » ouvert`
    if (project.warnings.length > 0) showToast({ kind: 'info', text: `${opened}.\n${project.warnings.join('\n')}` })
    else showToast({ kind: 'success', text: opened })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    showToast({ kind: 'error', text: `Impossible d'ouvrir « ${file.name} » : ${reason}` })
  }
}

/** Files picked with « Ouvrir » or dropped on the window: the first project is opened, the tracks are imported. */
export async function openFiles(files: readonly File[]): Promise<void> {
  const { project, tracks, extraProjects } = routeOpenedFiles(files)
  if (project) await openProject(project)
  if (tracks.length > 0) importTrackFiles(tracks)
  if (extraProjects.length > 0) {
    showToast({ kind: 'info', text: `Un seul projet à la fois : ${extraProjects.map((f) => `« ${f.name} »`).join(', ')} non ouvert(s).` })
  }
}

const SAMPLE_URL = '/samples/tour-du-mont-blanc-j1.gpx'
const SAMPLE_NAME = 'tour-du-mont-blanc-j1.gpx'

/** `importFiles` bound to the app store and the toasts. */
async function runImport(jobs: ImportJob[]): Promise<void> {
  const { setLoading, addTracks } = useAppStore.getState()
  await importFiles(jobs, {
    trackCount: () => useAppStore.getState().tracks.length,
    setLoading,
    addTracks,
    notify: (kind, text) => showToast({ kind, text }),
  })
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

/**
 * File actions shared by the top bar, its keyboard shortcuts, the window drop and the panels: save / open the project
 * file, import GPX / FIT tracks and the sample, save an export on the desktop (src/platform). Outcomes are shown as
 * toasts.
 */
import { useMediaStore } from '../film/media'
import { importFile, importText } from '../import'
import { getPlatform } from '../platform'
import { applyProject } from '../project/apply'
import { parseProject, projectFileName, serializeProject } from '../project/document'
import { getSettingsHistory } from '../project/history'
import { useAppStore } from '../state/store'
import { importFiles } from './importFlow'
import type { ImportJob } from './importFlow'
import { effectiveProjectName, routeOpenedFiles } from './shell'
import { showToast } from './toast'

/** Save the project as `<nom>.openflyover.json` (download, or save dialog on the desktop) and mark it saved. */
export async function saveProject(): Promise<void> {
  const state = useAppStore.getState()
  const name = effectiveProjectName(state.projectName, state.tracks[0]?.name)
  const text = serializeProject(state, name, useMediaStore.getState().table)
  try {
    const outcome = await getPlatform().saveFile(new Blob([text], { type: 'application/json' }), {
      fileName: projectFileName(name),
      filters: [{ name: 'Projet OpenFlyover', extensions: ['json'] }],
    })
    if (!outcome.saved) return
    state.markProjectSaved()
    showToast({ kind: 'success', text: `Projet enregistré : ${outcome.fileName}` })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    showToast({ kind: 'error', text: `Impossible d'enregistrer le projet : ${reason}` })
  }
}

/** Desktop: an export result (object URL) through the save dialog; says where it went, or why it failed. */
export async function saveExportedFile(url: string, fileName: string): Promise<void> {
  try {
    const outcome = await getPlatform().saveUrl(url, { fileName })
    if (outcome.saved) showToast({ kind: 'success', text: `Enregistré : ${outcome.fileName}` })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    showToast({ kind: 'error', text: `Impossible d'enregistrer « ${fileName} » : ${reason}` })
  }
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

/** « Choisir un fichier », « Ajouter » : GPX / FIT files to import (dialog on the desktop). */
export async function chooseTracksToImport(): Promise<void> {
  importTrackFiles(await getPlatform().openFiles({ filters: [{ name: 'Traces GPX ou FIT', extensions: ['gpx', 'fit'] }], multiple: true }))
}

/** « Ouvrir un projet… » : one project file (dialog on the desktop). */
export async function chooseProjectToOpen(): Promise<void> {
  const files = await getPlatform().openFiles({ filters: [{ name: 'Projet OpenFlyover', extensions: ['json'] }] })
  if (files.length > 0) await openFiles(files)
}

/** « Ouvrir » : file picker (dialog on the desktop) for tracks and a project. */
export async function chooseFilesToOpen(): Promise<void> {
  const files = await getPlatform().openFiles({
    filters: [{ name: 'Traces et projets', extensions: ['gpx', 'fit', 'json'] }],
    multiple: true,
  })
  if (files.length > 0) await openFiles(files)
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

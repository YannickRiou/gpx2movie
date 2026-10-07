/**
 * Import orchestration, kept free of React and of the store so it can be unit-tested (`importFiles` drives the
 * store and the messages through an `ImportSink`).
 * Jobs run one after the other so that every parsed track gets the next free colour index,
 * and a failing file never prevents the others from being imported.
 */
import type { Track } from '../core/types'

export interface ImportJob {
  /** Shown in the error banner when the job fails (file name, "l'exemple"…). */
  label: string
  /** Parse and return the tracks; `colorIndex` is the palette index of the first returned track. */
  run(colorIndex: number): Promise<Track[]>
}

export interface ImportOutcome {
  /** Every track parsed by the jobs that succeeded, in job order. */
  tracks: Track[]
  /** One entry per failed job: "<label> : <message>". */
  failures: string[]
}

/** Human-readable message for anything thrown by a parser. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return 'erreur inconnue'
}

/**
 * Run `jobs` sequentially. `trackCount` returns the number of tracks already in the app so
 * that colour indices continue after them (read lazily: the user may delete a track meanwhile).
 * Never rejects: failures are collected in the outcome.
 */
export async function runImportJobs(jobs: readonly ImportJob[], trackCount: () => number): Promise<ImportOutcome> {
  const tracks: Track[] = []
  const failures: string[] = []
  for (const job of jobs) {
    try {
      tracks.push(...(await job.run(trackCount() + tracks.length)))
    } catch (error) {
      failures.push(`${job.label} : ${errorMessage(error)}`)
    }
  }
  return { tracks, failures }
}

/** Banner text for the failures of a batch, or null when everything succeeded. */
export function formatImportError(failures: readonly string[]): string | null {
  if (failures.length === 0) return null
  if (failures.length === 1) return `Import impossible — ${failures[0]}`
  return `Imports impossibles :\n${failures.join('\n')}`
}

/** Message after a successful import: the track name for one track, the count otherwise. */
export function importedMessage(tracks: readonly Pick<Track, 'name'>[]): string {
  return tracks.length === 1 ? `Trace « ${tracks[0].name} » importée` : `${tracks.length} traces importées`
}

/** What `importFiles` acts on (the app store and the messages in the app, fakes in the tests). */
export interface ImportSink {
  /** number of tracks already loaded (read for every job) */
  trackCount(): number
  setLoading(loading: boolean): void
  addTracks(tracks: Track[]): void
  notify(kind: 'success' | 'error', text: string): void
}

/**
 * Import a batch (one job per file, or the sample): loading flag during the batch, one `addTracks` for every parsed
 * track, then a success message and one error message for the failures. Never rejects.
 */
export async function importFiles(jobs: readonly ImportJob[], sink: ImportSink): Promise<ImportOutcome> {
  sink.setLoading(true)
  try {
    const outcome = await runImportJobs(jobs, () => sink.trackCount())
    if (outcome.tracks.length > 0) {
      sink.addTracks(outcome.tracks)
      sink.notify('success', importedMessage(outcome.tracks))
    }
    const error = formatImportError(outcome.failures)
    if (error) sink.notify('error', error)
    return outcome
  } finally {
    sink.setLoading(false)
  }
}

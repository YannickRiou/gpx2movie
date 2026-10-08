/**
 * Batch rendering asked on the command line of the desktop app (src-tauri/src/cli.rs): « Un film par trace » of a
 * folder, with no click. At startup the app asks `cli_render`; when there is a request, it applies the preset named
 * (none: the settings kept by the app), renders each track of the input folder in each format asked (none: the format
 * of « Vidéo »), writes the films and a report (`rendu-en-lot.txt`) into the output folder, then quits through
 * `cli_exit`: 0 when every film was made, 1 when one failed, 2 when the request cannot run (unknown preset or format, no
 * track in the folder).
 */
import type { InvokeArgs } from '@tauri-apps/api/core'
import { errorMessage } from '../core/errors'
import { getPlatform } from '../platform'
import { joinPath, readableFolderAt, writableFolderAt } from '../platform/folder'
import { applySettings } from '../project/apply'
import { getPresetStore, presetSettings } from '../project/presets'
import { startPoster } from '../poster/export'
import { useAppStore } from '../state/store'
import { buildBatchJobs, formatKey, trackFiles, useBatchStore } from './batch'
import type { TrackRunState } from './batch'
import { exportCodec } from './nativeEncoder'
import { VIDEO_ASPECTS, VIDEO_RESOLUTIONS } from './schedule'

/** What `cli_render` answers (paths absolute, already in the fs scope). */
export interface CliRenderRequest {
  input: string
  output: string
  preset: string | null
  /** `formatKey`s ('16:9@1080p'); empty: the format of « Vidéo » */
  formats: string[]
}

export const REPORT_FILE = 'rendu-en-lot.txt'

type Invoke = (command: string, args?: InvokeArgs) => Promise<unknown>
const tauriInvoke: Invoke = async (command, args) => (await import('@tauri-apps/api/core')).invoke(command, args)

const KNOWN_FORMATS = new Set(VIDEO_ASPECTS.flatMap((a) => VIDEO_RESOLUTIONS.map((r) => formatKey(a.id, r.id))))

/** The formats to render: those asked, each known, else `fallback`; throws on an unknown one. */
export function cliFormats(asked: readonly string[], fallback: string): string[] {
  for (const f of asked) if (!KNOWN_FORMATS.has(f)) throw new Error(`Format inconnu : ${f} (exemples : ${[...KNOWN_FORMATS].slice(0, 3).join(', ')}).`)
  return asked.length > 0 ? [...new Set(asked)] : [fallback]
}

/** The report written next to the films, and the exit code: 0 when every film was made, 1 otherwise. */
export function cliReport(tracks: readonly TrackRunState[], output: string): { code: number; text: string } {
  const lines = tracks.map((t) => {
    const done = t.jobs.filter((j) => j.status === 'done').length
    const head = `${t.name} : ${t.status === 'done' ? 'fait' : t.status === 'canceled' ? 'annulé' : 'échec'} (${done}/${t.jobs.length} film${t.jobs.length > 1 ? 's' : ''})`
    return t.error ? `${head} — ${t.error}` : head
  })
  const ok = tracks.length > 0 && tracks.every((t) => t.status === 'done')
  const films = tracks.reduce((n, t) => n + t.jobs.filter((j) => j.status === 'done').length, 0)
  const summary = `${films} film${films > 1 ? 's' : ''} écrit${films > 1 ? 's' : ''} dans ${output} ; ${tracks.length} trace${tracks.length > 1 ? 's' : ''}.`
  return { code: ok ? 0 : 1, text: [summary, '', ...lines, ''].join('\n') }
}

/** Run the batch asked on the command line, if any; the app quits at the end. Desktop only. */
export async function runCliRenderIfAsked(invoke: Invoke = tauriInvoke): Promise<void> {
  if (!getPlatform().capabilities.isDesktop) return
  const request = (await invoke('cli_render')) as CliRenderRequest | null
  if (!request) return
  const exit = (code: number, message: string) => invoke('cli_exit', { code, message })
  try {
    if (request.preset !== null) {
      const preset = getPresetStore().list().find((p) => p.name === request.preset)
      if (!preset) return void (await exit(2, `Préréglage introuvable : « ${request.preset} ».`))
      applySettings(presetSettings(preset, useAppStore.getState().settings))
    }
    const { video } = useAppStore.getState().settings
    const formats = cliFormats(request.formats, formatKey(video.aspect, video.resolution))
    const jobs = buildBatchJobs({ formats, still: false, poster: false }, video)
    const files = trackFiles((await readableFolderAt(request.input)).files)
    if (files.length === 0) return void (await exit(2, `Aucune trace GPX ou FIT dans ${request.input}.`))
    console.info(`[rendu en lot] ${files.length} trace(s) × ${jobs.length} format(s) → ${request.output}`)
    const tracks = await useBatchStore.getState().runTracks(files, jobs, {
      folder: writableFolderAt(request.output),
      still: { progress: 0, type: 'image/png' },
      containerOf: async (j) => (await exportCodec({ width: j.width, height: j.height, fps: video.fps, quality: video.quality }))?.container ?? null,
      startPoster,
      save: () => undefined,
    })
    const report = cliReport(tracks, request.output)
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    await writeFile(joinPath(request.output, REPORT_FILE), new TextEncoder().encode(report.text))
    await exit(report.code, report.text)
  } catch (error) {
    await exit(2, `Rendu en lot impossible : ${errorMessage(error)}`)
  }
}

import { describe, expect, it, vi } from 'vitest'
import type { TrackRunState } from './batch'
import { cliFormats, cliReport, runCliRenderIfAsked } from './cliRender'

const job = (status: 'done' | 'error') => ({ key: 'k', label: 'l', status }) as unknown as TrackRunState['jobs'][number]

describe('command-line batch', () => {
  it('keeps the formats asked, known and once each, else the format of « Vidéo »', () => {
    expect(cliFormats([], '16:9@1080p')).toEqual(['16:9@1080p'])
    expect(cliFormats(['9:16@720p', '9:16@720p', '1:1@1080p'], '16:9@1080p')).toEqual(['9:16@720p', '1:1@1080p'])
    expect(cliFormats(['16:9@4K'], '16:9@1080p')).toEqual(['16:9@4k'])
    expect(() => cliFormats(['16:9@8K'], '16:9@1080p')).toThrow(/Format inconnu : 16:9@8k/)
  })

  it('reports each track and exits with 0 only when every film was made', () => {
    const done: TrackRunState = { name: 'Lundi', status: 'done', jobs: [job('done'), job('done')] }
    const failed: TrackRunState = { name: 'Mardi', status: 'error', error: 'encodeur absent', jobs: [job('error'), job('done')] }
    expect(cliReport([done], '/films')).toEqual({ code: 0, text: '2 films écrits dans /films ; 1 trace.\n\nLundi : fait (2/2 films)\n' })
    const mixed = cliReport([done, failed], '/films')
    expect(mixed.code).toBe(1)
    expect(mixed.text).toContain('Mardi : échec (1/2 films) — encodeur absent')
    expect(cliReport([], '/films').code).toBe(1)
  })

  it('asks nothing outside the desktop app', async () => {
    const invoke = vi.fn(async () => null)
    await runCliRenderIfAsked(invoke)
    expect(invoke).not.toHaveBeenCalled()
  })
})

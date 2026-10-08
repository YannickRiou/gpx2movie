import { describe, expect, it, vi } from 'vitest'
import type { Track } from '../core/types'
import { errorMessage } from '../core/errors'
import { formatImportError, importFiles, importedMessage, runImportJobs } from './importFlow'
import type { ImportSink } from './importFlow'

function track(id: string): Track {
  return {
    id,
    name: id,
    source: 'gpx',
    segments: [],
    stats: { distanceM: 0, ascentM: 0, descentM: 0, pointCount: 0 },
    bounds: { west: 0, south: 0, east: 0, north: 0 },
    color: '#000',
  }
}

describe('runImportJobs', () => {
  it('runs jobs sequentially and hands each one the next free colour index', async () => {
    const order: string[] = []
    const a = vi.fn(async (i: number) => {
      order.push(`a:${i}`)
      return [track('a1'), track('a2')]
    })
    const b = vi.fn(async (i: number) => {
      order.push(`b:${i}`)
      return [track('b1')]
    })
    const outcome = await runImportJobs(
      [
        { label: 'a.gpx', run: a },
        { label: 'b.fit', run: b },
      ],
      () => 3,
    )
    expect(order).toEqual(['a:3', 'b:5'])
    expect(outcome.tracks.map((t) => t.id)).toEqual(['a1', 'a2', 'b1'])
    expect(outcome.failures).toEqual([])
  })

  it('collects failures without losing the other files', async () => {
    const outcome = await runImportJobs(
      [
        { label: 'bad.tcx', run: () => Promise.reject(new Error('Format non supporté : .tcx')) },
        { label: 'ok.gpx', run: async () => [track('ok')] },
        { label: 'weird.gpx', run: () => Promise.reject('boom') },
      ],
      () => 0,
    )
    expect(outcome.tracks.map((t) => t.id)).toEqual(['ok'])
    expect(outcome.failures).toEqual(['bad.tcx : Format non supporté : .tcx', 'weird.gpx : boom'])
  })

  it('re-reads the track count for every job', async () => {
    const count = vi.fn<() => number>().mockReturnValueOnce(0).mockReturnValueOnce(10)
    const seen: number[] = []
    const run = async (i: number) => {
      seen.push(i)
      return [track(String(i))]
    }
    await runImportJobs(
      [
        { label: '1', run },
        { label: '2', run },
      ],
      count,
    )
    // second job: 10 existing tracks + 1 imported by the first job
    expect(seen).toEqual([0, 11])
  })
})

describe('formatImportError', () => {
  it('returns null when nothing failed', () => {
    expect(formatImportError([])).toBeNull()
  })

  it('uses the singular for one failure and one line per failure otherwise', () => {
    expect(formatImportError(['a.gpx : illisible'])).toBe('Import impossible — a.gpx : illisible')
    expect(formatImportError(['a : x', 'b : y'])).toBe('Imports impossibles :\na : x\nb : y')
  })
})

describe('errorMessage', () => {
  it('handles Error, string and unknown values', () => {
    expect(errorMessage(new Error('nope'))).toBe('nope')
    expect(errorMessage('texte')).toBe('texte')
    expect(errorMessage(new Error(''))).toBe('erreur inconnue')
    expect(errorMessage(undefined)).toBe('erreur inconnue')
  })
})

describe('importFiles', () => {
  /** sink that records every call in order */
  function sink(count = 0) {
    const calls: string[] = []
    const added: Track[] = []
    const value: ImportSink = {
      trackCount: () => count + added.length,
      setLoading: (on) => calls.push(`loading:${on}`),
      addTracks: (tracks) => {
        added.push(...tracks)
        calls.push(`add:${tracks.map((t) => t.id).join(',')}`)
      },
      notify: (kind, text) => calls.push(`${kind}:${text}`),
    }
    return { value, calls }
  }

  it('adds every parsed track at once, then says what was imported and what failed', async () => {
    const s = sink(2)
    const colors: number[] = []
    const parse = (id: string) => async (i: number) => {
      colors.push(i)
      return [track(id)]
    }
    await importFiles(
      [
        { label: 'a.gpx', run: parse('a') },
        { label: 'b.tcx', run: () => Promise.reject(new Error('Format non supporté : .tcx')) },
        { label: 'c.fit', run: parse('c') },
      ],
      s.value,
    )
    expect(colors).toEqual([2, 3])
    expect(s.calls).toEqual([
      'loading:true',
      'add:a,c',
      'success:2 traces importées',
      'error:Import impossible — b.tcx : Format non supporté : .tcx',
      'loading:false',
    ])
  })

  it('shows only the error when nothing could be read, and clears the loading flag', async () => {
    const s = sink()
    const outcome = await importFiles([{ label: 'x.gpx', run: () => Promise.reject(new Error('illisible')) }], s.value)
    expect(outcome.tracks).toEqual([])
    expect(s.calls).toEqual(['loading:true', 'error:Import impossible — x.gpx : illisible', 'loading:false'])
  })

  it('names the track when there is only one', () => {
    expect(importedMessage([{ name: 'Col du Galibier' }])).toBe('Trace « Col du Galibier » importée')
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { Track } from '../core/types'
import { errorMessage, formatImportError, runImportJobs } from './importFlow'

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

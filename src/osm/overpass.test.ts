import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LonLat, Track } from '../core/types'
import { buildTrack } from '../import/stats'
import {
  MAX_LANDMARK_DISTANCE_M,
  OverpassError,
  buildOverpassQuery,
  clearOverpassMemoryCache,
  corridorBoxes,
  fetchTrackFeatures,
  hashQuery,
  parseOverpass,
  runOverpassQuery,
  simplifyLine,
  trackQuery,
} from './overpass'
import type { OverpassDeps } from './overpass'

/** Track going north along `lon` from 45.8° N, `count` points `stepM` apart. */
function northTrack(count: number, stepM: number, lon = 6.78): Track {
  const points = Array.from({ length: count }, (_, i) => ({ lon, lat: 45.8 + (i * stepM) / 111_320, ele: 1000 }))
  return buildTrack({ name: 't', source: 'gpx', segments: [{ points }] })
}

const RESPONSE = {
  version: 0.6,
  elements: [
    { type: 'node', id: 1, lat: 45.8768, lon: 6.7614, tags: { ele: '1650', mountain_pass: 'yes', name: 'Col de Voza', natural: 'saddle' } },
    { type: 'node', id: 2, lat: 45.8942, lon: 6.7505, tags: { ele: '1969.1', name: 'Le Prarion', natural: 'peak' } },
    { type: 'node', id: 3, lat: 45.9, lon: 6.7, tags: { name: 'Etna', 'name:fr': 'Mont Etna', natural: 'volcano' } },
    { type: 'way', id: 4, center: { lat: 45.8561, lon: 6.7996 }, tags: { ele: '2372', name: "Refuge du Nid d'Aigle", tourism: 'alpine_hut' } },
    { type: 'relation', id: 5, center: { lat: 45.89, lon: 6.78 }, tags: { name: 'Lac des Chavants', natural: 'water', water: 'lake' } },
    { type: 'node', id: 6, lat: 45.9, lon: 6.8, tags: { name: 'Les Houches', place: 'village' } },
    { type: 'node', id: 7, lat: 45.9, lon: 6.8, tags: { natural: 'peak', ele: '2303' } },
    { type: 'node', id: 8, lat: 45.9, lon: 6.8, tags: { name: 'Bellevue', aerialway: 'station' } },
    { type: 'way', id: 9, tags: { name: 'Sans centre', natural: 'water' } },
  ],
}

describe('simplifyLine / corridorBoxes', () => {
  it('keeps the ends and drops near-collinear points', () => {
    const line: LonLat[] = [
      { lon: 6.78, lat: 45.8 },
      { lon: 6.7801, lat: 45.81 },
      { lon: 6.78, lat: 45.82 },
      { lon: 6.85, lat: 45.83 },
      { lon: 6.78, lat: 45.84 },
    ]
    const out = simplifyLine(line, 200)
    expect(out[0]).toEqual(line[0])
    expect(out[out.length - 1]).toEqual(line[4])
    expect(out).toContainEqual(line[3])
    expect(out).not.toContainEqual(line[1])
    expect(simplifyLine(line.slice(0, 2), 200)).toEqual(line.slice(0, 2))
  })

  it('covers a short track with one box, the margin around it', () => {
    const track = northTrack(5, 1000)
    const boxes = corridorBoxes(track)
    expect(boxes).toHaveLength(1)
    const margin = MAX_LANDMARK_DISTANCE_M / 111_320
    expect(boxes[0].south).toBeCloseTo(45.8 - margin, 4)
    expect(boxes[0].north).toBeCloseTo(track.bounds.north + margin, 4)
    expect(boxes[0].west).toBeLessThan(6.78 - margin)
    expect(boxes[0].east).toBeGreaterThan(6.78 + margin)
  })

  it('chunks a long track into boxes of bounded span that overlap', () => {
    const track = northTrack(21, 5000) // 100 km
    const boxes = corridorBoxes(track)
    expect(boxes.length).toBeGreaterThanOrEqual(3)
    const maxSideDeg = (40_000 + 2 * MAX_LANDMARK_DISTANCE_M) / 111_320
    for (const b of boxes) expect(b.north - b.south).toBeLessThanOrEqual(maxSideDeg + 1e-6)
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].south).toBeLessThan(boxes[i - 1].north)
    for (const p of track.segments[0].points) {
      expect(boxes.some((b) => p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east)).toBe(true)
    }
  })

  it('writes one statement per kind and per box', () => {
    const query = buildOverpassQuery([
      { west: 6.7, south: 45.8, east: 6.8, north: 45.9 },
      { west: 6.8, south: 45.9, east: 6.9, north: 46 },
    ])
    expect(query.startsWith('[out:json][timeout:60];')).toBe(true)
    expect(query.trim().endsWith('out center tags qt;')).toBe(true)
    expect(query.match(/\(45\.80000,6\.70000,45\.90000,6\.80000\)/g)).toHaveLength(8)
    expect(query.match(/\(45\.90000,6\.80000,46\.00000,6\.90000\)/g)).toHaveLength(8)
    expect(query).toContain('node["natural"~"^(peak|volcano|saddle)$"]["name"]')
    expect(query).toContain('nwr["natural"="water"]["name"]')
    expect(trackQuery(northTrack(3, 1000)).match(/\n  /g)).toHaveLength(8)
  })

  it('hashes queries stably', () => {
    expect(hashQuery('abc')).toBe(hashQuery('abc'))
    expect(hashQuery('abc')).not.toBe(hashQuery('abd'))
    expect(hashQuery(trackQuery(northTrack(3, 1000)))).toMatch(/^[0-9a-f]+$/)
  })
})

describe('parseOverpass', () => {
  it('classifies the named elements, prefers name:fr and uses the centre of ways and relations', () => {
    const features = parseOverpass(RESPONSE)
    expect(features.map((f) => f.id)).toEqual(['node/1', 'node/2', 'node/3', 'way/4', 'relation/5', 'node/6'])
    expect(features[0]).toEqual({ id: 'node/1', kind: 'pass', name: 'Col de Voza', lon: 6.7614, lat: 45.8768, ele: '1650' })
    expect(features[1]).toMatchObject({ kind: 'peak', ele: '1969.1' })
    expect(features[2]).toMatchObject({ kind: 'peak', name: 'Mont Etna', detail: 'volcano' })
    expect(features[3]).toMatchObject({ kind: 'hut', detail: 'alpine_hut', lon: 6.7996, lat: 45.8561 })
    expect(features[4]).toMatchObject({ kind: 'lake', detail: 'lake' })
    expect(features[5]).toMatchObject({ kind: 'place', detail: 'village' })
  })

  it('throws on a server-side error or an unexpected body', () => {
    expect(() => parseOverpass({ elements: [], remark: 'runtime error: Query timed out in "query" at line 10 after 80 seconds.' })).toThrow(
      OverpassError,
    )
    expect(() => parseOverpass({ version: 0.6 })).toThrow(/inattendue/)
    expect(() => parseOverpass('<html>')).toThrow(OverpassError)
  })
})

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

function memoryStorage(): NonNullable<OverpassDeps['storage']> & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

function makeDeps(responses: (Response | Error)[], storage: OverpassDeps['storage'] = null): OverpassDeps & { fetch: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift()
    if (!next) throw new Error('no more responses')
    if (next instanceof Error) throw next
    return next
  })
  return { fetch: fetchMock as unknown as OverpassDeps['fetch'] & ReturnType<typeof vi.fn>, sleep: vi.fn(async () => {}), storage, now: () => 1_000_000 }
}

const ENDPOINTS = ['https://a.example/api', 'https://b.example/api']

describe('runOverpassQuery', () => {
  it('posts the form-encoded query and parses the answer', async () => {
    const deps = makeDeps([json(RESPONSE)])
    const features = await runOverpassQuery('Q', undefined, deps, ENDPOINTS)
    expect(features).toHaveLength(6)
    expect(deps.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = deps.fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(ENDPOINTS[0])
    expect(init.method).toBe('POST')
    expect((init.body as URLSearchParams).get('data')).toBe('Q')
  })

  it('retries a busy server once after Retry-After, then moves to the next endpoint', async () => {
    const deps = makeDeps([
      new Response('busy', { status: 429, headers: { 'Retry-After': '2' } }),
      new Response('busy', { status: 504 }),
      json(RESPONSE),
    ])
    await runOverpassQuery('Q', undefined, deps, ENDPOINTS)
    expect(deps.fetch).toHaveBeenCalledTimes(3)
    expect((deps.fetch.mock.calls[2] as [string])[0]).toBe(ENDPOINTS[1])
    expect(deps.sleep).toHaveBeenCalledTimes(1)
    expect((deps.sleep as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(2000)
  })

  it('gives up with the last busy status when every endpoint is busy', async () => {
    const deps = makeDeps([
      new Response('', { status: 504 }),
      new Response('', { status: 504 }),
      new Response('', { status: 429 }),
      new Response('', { status: 429 }),
    ])
    await expect(runOverpassQuery('Q', undefined, deps, ENDPOINTS)).rejects.toMatchObject({ status: 429 })
    expect(deps.fetch).toHaveBeenCalledTimes(4)
    expect(deps.sleep).toHaveBeenCalledTimes(2)
    expect((deps.sleep as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(15_000)
  })

  it('does not retry other HTTP errors, skips an unreachable endpoint and honours abort', async () => {
    const bad = makeDeps([new Response('', { status: 400 })])
    await expect(runOverpassQuery('Q', undefined, bad, ENDPOINTS)).rejects.toMatchObject({ status: 400 })
    expect(bad.fetch).toHaveBeenCalledTimes(1)

    const unreachable = makeDeps([new TypeError('Failed to fetch'), json(RESPONSE)])
    expect(await runOverpassQuery('Q', undefined, unreachable, ENDPOINTS)).toHaveLength(6)
    expect(unreachable.fetch).toHaveBeenCalledTimes(2)

    const ctrl = new AbortController()
    ctrl.abort()
    const aborted = makeDeps([json(RESPONSE)])
    await expect(runOverpassQuery('Q', ctrl.signal, aborted, ENDPOINTS)).rejects.toMatchObject({ name: 'AbortError' })
    expect(aborted.fetch).not.toHaveBeenCalled()
  })
})

describe('fetchTrackFeatures', () => {
  beforeEach(() => clearOverpassMemoryCache())

  it('queries a track once (memory cache) and stores the result persistently', async () => {
    const storage = memoryStorage()
    const deps = makeDeps([json(RESPONSE)], storage)
    const track = northTrack(3, 1000)
    const a = await fetchTrackFeatures(track, undefined, deps)
    const b = await fetchTrackFeatures(track, undefined, deps)
    expect(a).toHaveLength(6)
    expect(b).toBe(a)
    expect(deps.fetch).toHaveBeenCalledTimes(1)
    expect(storage.map.size).toBe(1)
    expect([...storage.map.keys()][0]).toContain(hashQuery(trackQuery(track)))

    // a new session reads the persistent cache, without a request
    clearOverpassMemoryCache()
    const fresh = makeDeps([], storage)
    expect(await fetchTrackFeatures(track, undefined, fresh)).toEqual(a)
    expect(fresh.fetch).not.toHaveBeenCalled()

    // an expired entry is ignored
    clearOverpassMemoryCache()
    const later = { ...makeDeps([json(RESPONSE)], storage), now: () => 1_000_000 + 31 * 24 * 3600 * 1000 }
    await fetchTrackFeatures(track, undefined, later)
    expect(later.fetch).toHaveBeenCalledTimes(1)
  })

  it('does not cache a failed query and survives a broken storage', async () => {
    const broken: OverpassDeps['storage'] = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {},
      key: () => null,
      length: 0,
    }
    const deps = makeDeps([new Response('', { status: 400 }), json(RESPONSE)], broken)
    const track = northTrack(3, 1000)
    await expect(fetchTrackFeatures(track, undefined, deps)).rejects.toBeInstanceOf(OverpassError)
    expect(await fetchTrackFeatures(track, undefined, deps)).toHaveLength(6)
    expect(deps.fetch).toHaveBeenCalledTimes(2)
  })

  it('sends the queries one after the other', async () => {
    let release!: (r: Response) => void
    const first = new Promise<Response>((resolve) => (release = resolve))
    const fetchMock = vi.fn()
    fetchMock.mockReturnValueOnce(first).mockResolvedValueOnce(json(RESPONSE))
    const deps: OverpassDeps = { fetch: fetchMock as unknown as typeof fetch, sleep: async () => {}, storage: null, now: () => 0 }
    const pa = fetchTrackFeatures(northTrack(3, 1000), undefined, deps)
    const pb = fetchTrackFeatures(northTrack(3, 1000, 6.9), undefined, deps)
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release(json({ elements: [] }))
    expect(await pa).toEqual([])
    expect(await pb).toHaveLength(6)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import {
  createMediaBitmaps,
  dataUrlToBlob,
  isValidMediaAsset,
  mediaToLoad,
  nextMediaId,
  sanitizeMediaTable,
  useMediaStore,
  usedMedia,
} from './media'
import type { DecodedPicture, MediaAsset } from './media'
import { MEDIA_DEFAULTS } from './model'
import type { FilmMedia } from './model'

const DATA = 'data:image/jpeg;base64,/9j/AAEC'
const asset = (name: string, patch: Partial<MediaAsset> = {}): MediaAsset => ({ data: DATA, thumb: DATA, width: 2560, height: 1707, name, ...patch })
const photo = (id: string, src: string, startS: number, durationS = 5): FilmMedia => ({
  id,
  startS,
  durationS,
  kind: 'image',
  src,
  ...MEDIA_DEFAULTS,
})

describe('media table', () => {
  it('checks the pictures of a loaded project, leaving out the bad ones', () => {
    expect(isValidMediaAsset(asset('a.jpg'))).toBe(true)
    expect(isValidMediaAsset(asset('a.jpg', { name: undefined }))).toBe(true)
    for (const bad of [
      asset('a', { data: 'https://example.org/a.jpg' }),
      asset('a', { thumb: '' }),
      asset('a', { width: 0 }),
      asset('a', { height: 1.5 }),
      null,
      [],
    ]) {
      expect(isValidMediaAsset(bad)).toBe(false)
    }
    expect(sanitizeMediaTable({ 'photo-1': asset('a'), 'photo-2': { data: 1 } })).toEqual({ 'photo-1': asset('a') })
    expect(sanitizeMediaTable(undefined)).toEqual({})
    expect(sanitizeMediaTable([asset('a')])).toEqual({})
  })

  it('keeps the pictures the film uses; fresh ids', () => {
    const table = { 'photo-1': asset('a'), 'photo-2': asset('b'), 'photo-7': asset('c') }
    expect(usedMedia({ media: [photo('media-1', 'photo-2', 0), photo('media-2', 'photo-9', 5)] }, table)).toEqual({ 'photo-2': asset('b') })
    expect(nextMediaId(table)).toBe('photo-8')
    expect(nextMediaId({})).toBe('photo-1')
  })

  it('decodes a base64 data URL', async () => {
    const blob = dataUrlToBlob('data:image/png;base64,AAEC/w==')
    expect(blob.type).toBe('image/png')
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 1, 2, 255])
  })

  it('lists the pictures shown at a time, or starting soon', () => {
    const media = [photo('media-1', 'photo-1', 10), photo('media-2', 'photo-2', 16), photo('media-3', 'photo-1', 12)]
    expect(mediaToLoad(media, 9)).toEqual([])
    expect(mediaToLoad(media, 12)).toEqual(['photo-1'])
    expect(mediaToLoad(media, 14, 2)).toEqual(['photo-1', 'photo-2'])
    expect(mediaToLoad([{ ...media[0], kind: 'video' }], 12)).toEqual([])
  })

  describe('store', () => {
    beforeEach(() => useMediaStore.getState().replace({}))

    it('adds pictures under fresh ids, replaced when a project is opened', () => {
      expect(useMediaStore.getState().add([asset('a'), asset('b')])).toEqual(['photo-1', 'photo-2'])
      expect(useMediaStore.getState().add([asset('c')])).toEqual(['photo-3'])
      useMediaStore.getState().replace({ 'photo-1': asset('z') })
      expect(useMediaStore.getState().table).toEqual({ 'photo-1': asset('z') })
    })
  })
})

describe('decoded pictures', () => {
  function setup(limit = 2) {
    let table: Record<string, MediaAsset> = { a: asset('a'), b: asset('b'), c: asset('c') }
    const decoded: string[] = []
    const closed: string[] = []
    const decode = (a: MediaAsset): Promise<DecodedPicture> => {
      decoded.push(a.name!)
      if (a.name === 'bad') return Promise.reject(new Error('illisible'))
      return Promise.resolve({ image: {} as CanvasImageSource, width: a.width, height: a.height, close: () => closed.push(a.name!) })
    }
    const bitmaps = createMediaBitmaps((id) => table[id], decode, limit)
    return { bitmaps, decoded, closed, setTable: (t: typeof table) => (table = t) }
  }

  it('decodes on demand, once, and tells the listeners', async () => {
    const { bitmaps, decoded } = setup()
    let told = 0
    bitmaps.subscribe(() => told++)
    expect(bitmaps.get('a')).toBeUndefined()
    expect(bitmaps.get('a')).toBeUndefined()
    await bitmaps.load(['a'])
    expect(bitmaps.get('a')).toMatchObject({ width: 2560 })
    expect(decoded).toEqual(['a'])
    expect(told).toBe(1)
    expect(bitmaps.get('missing')).toBeUndefined()
  })

  it('keeps at most `limit` pictures, releasing the least recently used', async () => {
    const { bitmaps, closed } = setup(2)
    await bitmaps.load(['a', 'b'])
    bitmaps.get('a')
    await bitmaps.load(['c'])
    expect(closed).toEqual(['b'])
    expect(bitmaps.get('a')).toBeDefined()
  })

  it('releases the pictures the film no longer uses; decodes again a replaced picture', async () => {
    const { bitmaps, closed, decoded, setTable } = setup(3)
    await bitmaps.load(['a', 'b'])
    bitmaps.retain(['b'])
    expect(closed).toEqual(['a'])
    setTable({ b: asset('b2') })
    expect(bitmaps.get('b')).toBeUndefined()
    await bitmaps.load(['b'])
    expect(closed).toEqual(['a', 'b'])
    expect(decoded.at(-1)).toBe('b2')
  })

  it('leaves out a picture that cannot be decoded', async () => {
    const { bitmaps, setTable } = setup()
    setTable({ x: asset('bad') })
    await bitmaps.load(['x'])
    expect(bitmaps.get('x')).toBeUndefined()
  })
})

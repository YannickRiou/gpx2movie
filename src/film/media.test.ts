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
import { createClipReader, createExportVideos, createPreviewVideos, isMediaFile, isVideoFile } from './video'
import type { ClipFrame, OpenedClip, PreviewElement } from './video'

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
    // a video clip: its file and its length
    const clip = asset('a.mp4', { data: 'data:video/mp4;base64,AAAA', durationS: 12.5 })
    expect(isValidMediaAsset(clip)).toBe(true)
    expect(isValidMediaAsset({ ...clip, data: 'data:video/quicktime;base64,AAAA' })).toBe(true)
    expect(isValidMediaAsset({ ...clip, durationS: undefined })).toBe(false)
    expect(isValidMediaAsset({ ...clip, durationS: 0 })).toBe(false)
    expect(isValidMediaAsset({ ...clip, data: 'data:video/x-msvideo;base64,AAAA' })).toBe(false)
    expect(isValidMediaAsset({ ...clip, thumb: clip.data })).toBe(false)
    expect(isValidMediaAsset(asset('a', { durationS: 3 }))).toBe(false)
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
      const clip = asset('d.mp4', { data: 'data:video/mp4;base64,AAAA', durationS: 4 })
      expect(useMediaStore.getState().add([clip, asset('e'), clip])).toEqual(['video-1', 'photo-4', 'video-2'])
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

describe('video clips', () => {
  it('tells videos from pictures and other files', () => {
    expect(isVideoFile({ type: 'video/mp4' })).toBe(true)
    expect(isVideoFile({ type: '', name: 'GOPR0042.MOV' })).toBe(true)
    expect(isVideoFile({ type: 'image/jpeg', name: 'a.mov' })).toBe(false)
    expect(isMediaFile({ type: 'image/png' })).toBe(true)
    expect(isMediaFile({ type: 'application/gpx+xml', name: 'trace.gpx' })).toBe(false)
  })

  /** frames every 0.1 s from 0 to 1 s (`opened` records each start) */
  function frames(opened: number[] = []) {
    const at = (k: number): ClipFrame => ({ image: {} as CanvasImageSource, width: 4, height: 3, timestamp: k / 10 })
    let pulled = 0
    const open = (startS: number): AsyncIterator<ClipFrame> => {
      opened.push(startS)
      let k = Math.max(0, Math.floor(startS * 10 + 1e-9))
      return {
        next: async () => (k > 10 ? { done: true, value: undefined } : (pulled++, { done: false, value: at(k++) })),
        return: async () => ({ done: true, value: undefined }),
      }
    }
    return { open, pulled: () => pulled }
  }

  it('reads the frame shown at each time going forward, decoding each frame once', async () => {
    const opened: number[] = []
    const { open, pulled } = frames(opened)
    const reader = createClipReader(open)
    expect((await reader.frameAt(0))?.timestamp).toBe(0)
    expect((await reader.frameAt(0.05))?.timestamp).toBe(0)
    expect((await reader.frameAt(0.1))?.timestamp).toBe(0.1)
    expect((await reader.frameAt(0.37))?.timestamp).toBe(0.3)
    // past the last frame: the last one is held
    expect((await reader.frameAt(1.5))?.timestamp).toBe(1)
    expect((await reader.frameAt(9))?.timestamp).toBe(1)
    expect(opened).toEqual([0])
    expect(pulled()).toBe(11)
    // back in time or a far jump: opened again
    expect((await reader.frameAt(0.2))?.timestamp).toBe(0.2)
    expect(opened).toEqual([0, 0.2])
    const jumpy = createClipReader(open, 0.5)
    await jumpy.frameAt(0)
    expect((await jumpy.frameAt(0.9))?.timestamp).toBe(0.9)
    expect(opened).toEqual([0, 0.2, 0, 0.9])
  })

  it('gives the export the frame of every clip shown at a film time, always the same', async () => {
    const opened: string[] = []
    const disposed: string[] = []
    const open = (a: MediaAsset): OpenedClip => {
      opened.push(a.name!)
      return { frames: frames().open, dispose: () => disposed.push(a.name!) }
    }
    const table: Record<string, MediaAsset> = { 'video-1': asset('v1', { data: 'data:video/mp4;base64,AAAA', durationS: 1 }) }
    const clip: FilmMedia = { ...photo('media-1', 'video-1', 10, 5), kind: 'video', inS: 0.2 }
    const videos = createExportVideos((id) => table[id], open)
    await videos.load([clip, photo('media-2', 'photo-1', 10)], 10.15)
    expect(videos.get(clip, 0.35)?.width).toBe(4)
    expect(videos.get(clip, 0.36)).toBeUndefined()
    await videos.load([clip], 16)
    expect(videos.get(clip, 0.35)).toBeUndefined()
    expect(opened).toEqual(['v1'])
    videos.dispose()
    expect(disposed).toEqual(['v1'])
  })

  function fakeVideo() {
    const listeners: Record<string, (() => void)[]> = {}
    const el = {
      currentTime: 0,
      duration: 8,
      paused: true,
      seeking: false,
      readyState: 4,
      videoWidth: 1920,
      videoHeight: 1080,
      playbackRate: 1,
      play: async () => {
        el.paused = false
      },
      pause: () => {
        el.paused = true
      },
      addEventListener: (type: string, fn: () => void) => (listeners[type] ??= []).push(fn),
      fire: (type: string) => listeners[type]?.forEach((fn) => fn()),
    }
    return el
  }

  it('preview: plays along, seeks when paused, pauses the clips not drawn', () => {
    const el = fakeVideo()
    let released = 0
    const table: Record<string, MediaAsset> = { 'video-1': asset('v1', { data: 'data:video/mp4;base64,AAAA', durationS: 8 }) }
    const videos = createPreviewVideos(
      (id) => table[id],
      () => ({ el: el as PreviewElement, snapshot: () => ({ image: {} as CanvasImageSource, width: 2, height: 1 }), release: () => released++ }),
    )
    let told = 0
    videos.subscribe(() => told++)
    const clip: FilmMedia = { ...photo('media-1', 'video-1', 10, 5), kind: 'video' }
    // scrubbing: paused on the time
    expect(videos.frame(clip, 3, { playing: false, speed: 1 })?.width).toBe(1920)
    expect(el.currentTime).toBe(3)
    expect(el.paused).toBe(true)
    // seeking: the last frame seeked to is shown meanwhile
    el.seeking = true
    expect(videos.frame(clip, 3.5, { playing: false, speed: 1 })).toBeUndefined()
    el.fire('seeked')
    expect(told).toBe(1)
    expect(videos.frame(clip, 3.5, { playing: false, speed: 1 })?.width).toBe(2)
    el.seeking = false
    // playing: started at the time, at the playback speed, left alone within the drift
    videos.frame(clip, 4, { playing: true, speed: 2 })
    expect(el.paused).toBe(false)
    expect(el.playbackRate).toBe(2)
    el.currentTime = 4.2
    videos.frame(clip, 4.1, { playing: true, speed: 2 })
    expect(el.currentTime).toBe(4.2)
    videos.frame(clip, 5, { playing: true, speed: 2 })
    expect(el.currentTime).toBe(5)
    // past the end of the file: paused on its last frame
    videos.frame(clip, 9, { playing: true, speed: 1 })
    expect(el.paused).toBe(true)
    expect(el.currentTime).toBe(8)
    // not drawn by a frame: paused; left the film: released
    videos.settle()
    el.paused = false
    videos.settle()
    expect(el.paused).toBe(true)
    videos.retain([])
    expect(released).toBe(1)
  })
})

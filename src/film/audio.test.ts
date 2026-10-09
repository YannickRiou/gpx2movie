import { describe, expect, it } from 'vitest'
import {
  CLIP_EDGE_FADE_S,
  DUCK_GAIN,
  DUCK_RAMP_S,
  MUSIC_DRIFT_S,
  audioTypeOf,
  clipSounds,
  computePeaks,
  createMusicPreview,
  duckEnvelope,
  duckGainAt,
  durationForFilmEnd,
  filmMixPlan,
  envelopeAt,
  isAudioFile,
  musicEndS,
  musicEnvelope,
  musicGainAt,
  musicLengthS,
  musicMixPlan,
  peakCount,
  waveformPath,
} from './audio'
import type { MusicElement } from './audio'
import { MAX_PEAKS } from './media'
import type { MediaAsset } from './media'
import { AUDIO_DEFAULTS, MEDIA_DEFAULTS, VIDEO_SOUND_DEFAULTS } from './model'
import type { FilmAudio, FilmMedia } from './model'

const clip = (patch: Partial<FilmAudio> = {}): FilmAudio => ({ id: 'music-1', src: 'audio-1', startS: 10, durationS: 20, inS: 0, ...AUDIO_DEFAULTS, ...patch })
/** a video clip with sound, from film time 5 s for 10 s */
const video = (patch: Partial<FilmMedia> = {}): FilmMedia => ({
  id: 'media-1',
  startS: 5,
  durationS: 10,
  kind: 'video',
  src: 'video-1',
  ...MEDIA_DEFAULTS,
  kenBurns: false,
  ...VIDEO_SOUND_DEFAULTS,
  ...patch,
})

describe('sound files', () => {
  it('recognised by their type, else their extension', () => {
    expect(audioTypeOf({ type: 'audio/mpeg', name: 'a.mp3' })).toBe('mpeg')
    expect(audioTypeOf({ type: 'audio/x-m4a' })).toBe('mp4')
    expect(audioTypeOf({ type: 'audio/opus' })).toBe('ogg')
    expect(audioTypeOf({ type: 'audio/x-flac' })).toBe('flac')
    expect(audioTypeOf({ type: '', name: 'Piste 1.M4A' })).toBe('mp4')
    expect(audioTypeOf({ type: 'application/octet-stream', name: 'a.wav' })).toBe('wav')
    expect(audioTypeOf({ type: 'audio/x-ms-wma', name: 'a.wma' })).toBeNull()
    // a video is not music, even a WebM
    expect(isAudioFile({ type: 'video/webm', name: 'a.webm' })).toBe(false)
    expect(isAudioFile({ type: '', name: 'a.mp4' })).toBe(false)
    expect(isAudioFile({ type: 'image/jpeg', name: 'a.mp3' })).toBe(false)
  })

  it('waveform: the loudest level of each slice, all channels, at 1/100', () => {
    expect(peakCount(180)).toBe(1800)
    expect(peakCount(0.01)).toBe(1)
    expect(peakCount(3600)).toBe(MAX_PEAKS)
    const left = Float32Array.from([0.1, -0.5, 0.2, 0, 0, 0.3333])
    const right = Float32Array.from([0, 0, -0.9, 0, 0, 0])
    expect(computePeaks([left, right], 3)).toEqual([0.5, 0.9, 0.33])
    // more slices than samples: a sample per slice
    expect(computePeaks([Float32Array.from([2])], 2)).toEqual([1, 1])
    expect(computePeaks([], 2)).toEqual([0, 0])
  })

  it('waveform path: the slices played, mirrored around the middle, scaled to the loudest', () => {
    // 4 slices of 1 s, clip from 1 s for 2 s
    const d = waveformPath([0.2, 1, 0.5, 0.5], 4, 1, 2)
    expect(d.startsWith('M0.000 0.050L1.000 0.275L2.000 0.275L2.000 0.725')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(waveformPath([], 4, 0, 2)).toBe('')
  })
})

describe('volume of a clip', () => {
  it('fades in and out linearly, shortened in proportion when they overlap', () => {
    expect(musicEnvelope({ volume: 0.8, fadeInS: 1, fadeOutS: 2 }, 10)).toEqual([
      { t: 0, gain: 0 },
      { t: 1, gain: 0.8 },
      { t: 8, gain: 0.8 },
      { t: 10, gain: 0 },
    ])
    expect(musicEnvelope({ volume: 1, fadeInS: 3, fadeOutS: 1 }, 2).map((p) => p.t)).toEqual([0, 1.5, 1.5, 2])
    expect(musicEnvelope({ volume: 1, fadeInS: 0, fadeOutS: 0 }, 5).map((p) => p.gain)).toEqual([1, 1, 1, 1])
    const points = musicEnvelope({ volume: 1, fadeInS: 2, fadeOutS: 2 }, 10)
    expect(envelopeAt(points, 1)).toBe(0.5)
    expect(envelopeAt(points, 5)).toBe(1)
    expect(envelopeAt(points, 9.5)).toBe(0.25)
    expect(envelopeAt(points, 11)).toBe(0)
  })

  it('in film time, never past the end of the file', () => {
    const c = clip({ fadeInS: 0, fadeOutS: 2 })
    expect(musicGainAt(c, 9.9)).toBe(0)
    expect(musicGainAt(c, 10)).toBe(1)
    expect(musicGainAt(c, 29)).toBe(0.5)
    expect(musicGainAt(c, 30)).toBe(0)
    // a file of 15 s from 5 s: 10 s played, the fade out ends there
    expect(musicLengthS(clip({ inS: 5 }), 15)).toBe(10)
    expect(musicGainAt(clip({ inS: 5, fadeInS: 0, fadeOutS: 2 }), 19, 15)).toBe(0.5)
    expect(musicEndS([c, clip({ startS: 0, durationS: 50, inS: 5 })], () => 15)).toBe(25)
    expect(musicEndS([], () => 15)).toBe(0)
  })

  it('mix plan: output time = film time + the frames held before the film', () => {
    const plan = musicMixPlan(
      [clip({ fadeInS: 0, fadeOutS: 0, inS: 3 }), clip({ id: 'music-2', src: 'missing' }), clip({ id: 'music-3', startS: 100 })],
      (src) => (src === 'audio-1' ? 60 : undefined),
      1,
      40,
    )
    expect(plan).toEqual([
      {
        src: 'audio-1',
        atS: 11,
        fromS: 3,
        lengthS: 20,
        points: [
          { t: 11, gain: 1 },
          { t: 11, gain: 1 },
          { t: 31, gain: 1 },
          { t: 31, gain: 1 },
        ],
      },
    ])
  })
})

describe('sound of the video clips', () => {
  const fileS = (src: string) => ({ 'video-1': 12, 'audio-1': 60 })[src]

  it('heard from its start in the file while the file runs, at its volume; silent clips left out', () => {
    expect(
      clipSounds(
        [
          video({ inS: 4, volume: 0.5 }),
          video({ id: 'media-2', startS: 30, outS: 6 }),
          video({ id: 'media-3', muted: true }),
          video({ id: 'media-4', sync: { startMs: 0, offsetS: 0, follow: true } }),
          video({ id: 'media-5', src: 'missing' }),
          video({ id: 'media-6', inS: 12 }),
          { ...video({ id: 'media-7' }), kind: 'image' },
        ],
        fileS,
      ),
    ).toEqual([
      // 12 s of file from 4 s: 8 s, the clip lasts 10 s (its last frame held, silent)
      { src: 'video-1', startS: 5, fromS: 4, lengthS: 8, volume: 0.5 },
      // trimmed at 6 s in the file
      { src: 'video-1', startS: 30, fromS: 0, lengthS: 6, volume: 1 },
    ])
  })

  it('music lowered under the clips with short ramps, merged when close, already low at the very start', () => {
    const R = DUCK_RAMP_S
    expect(duckEnvelope([])).toEqual([])
    expect(duckEnvelope([{ startS: 5, lengthS: 10 }])).toEqual([
      { t: 5 - R, gain: 1 },
      { t: 5, gain: DUCK_GAIN },
      { t: 15, gain: DUCK_GAIN },
      { t: 15 + R, gain: 1 },
    ])
    // closer than two ramps: one span, no bounce; a clip at 0 starts lowered
    const points = duckEnvelope([
      { startS: 15 + R, lengthS: 5 },
      { startS: 0, lengthS: 15 },
    ])
    expect(points).toEqual([
      { t: 0, gain: DUCK_GAIN },
      { t: 20 + R, gain: DUCK_GAIN },
      { t: 20 + 2 * R, gain: 1 },
    ])
    expect(duckGainAt(points, -1)).toBe(DUCK_GAIN)
    expect(duckGainAt(points, 15.1)).toBe(DUCK_GAIN)
    expect(duckGainAt(points, 20 + 1.5 * R)).toBeCloseTo((1 + DUCK_GAIN) / 2)
    expect(duckGainAt(points, 60)).toBe(1)
    expect(duckGainAt([], 3)).toBe(1)
  })

  it('mix plan: the clips at film time + the held frames, with their trim and edge fades; ducking only when asked', () => {
    const film = { audio: [clip({ startS: 0, durationS: 40 })], media: [video({ inS: 2 }), video({ id: 'media-2', startS: 50 })], duckMusic: true }
    const plan = filmMixPlan(film, fileS, 1, 40)
    expect(plan.music).toHaveLength(1)
    // the clip starting at or after the end of the film is left out
    expect(plan.clips).toEqual([
      {
        src: 'video-1',
        atS: 6,
        fromS: 2,
        lengthS: 10,
        points: [
          { t: 6, gain: 0 },
          { t: 6 + CLIP_EDGE_FADE_S, gain: 1 },
          { t: 16 - CLIP_EDGE_FADE_S, gain: 1 },
          { t: 16, gain: 0 },
        ],
      },
    ])
    expect(plan.duck.map((p) => p.t)).toEqual([6 - DUCK_RAMP_S, 6, 16, 16 + DUCK_RAMP_S])
    expect(filmMixPlan({ ...film, duckMusic: false }, fileS, 1, 40).duck).toEqual([])
    // no music: nothing to lower
    expect(filmMixPlan({ ...film, audio: [] }, fileS, 1, 40).duck).toEqual([])
    // a film saved before: clips silent, the music as it was
    const before = filmMixPlan({ ...film, media: [video({ muted: true })] }, fileS, 1, 40)
    expect(before.clips).toEqual([])
    expect(before.duck).toEqual([])
  })
})

describe('film fitted to the music', () => {
  it('finds the flyover duration at which the film ends with the music', () => {
    // 11 s of shots, stops adding 8 s, a flight 1.25 times longer than the duration
    const totalFor = (d: number) => 11 + 8 + 1.25 * d
    const d = durationForFilmEnd(200, totalFor, 60, { min: 15, max: 600 })
    expect(totalFor(d)).toBeCloseTo(200, 1)
    // out of reach: the nearest end of the range
    expect(durationForFilmEnd(20, totalFor, 60, { min: 15, max: 600 })).toBe(15)
    expect(durationForFilmEnd(5000, totalFor, 60, { min: 15, max: 600 })).toBe(600)
    // a film not linear in the duration still converges
    const curved = (d: number) => 10 + d + 0.002 * d * d
    expect(curved(durationForFilmEnd(300, curved, 60, { min: 15, max: 600 }))).toBeCloseTo(300, 1)
  })
})

describe('music of the preview', () => {
  function fakeElement() {
    const el = {
      currentTime: 0,
      playbackRate: 1,
      volume: 1,
      muted: false,
      paused: true,
      seeking: false,
      readyState: 4,
      plays: 0,
      async play() {
        el.paused = false
        el.plays++
      },
      pause() {
        el.paused = true
      },
    }
    return el
  }
  function setup() {
    const table: Record<string, MediaAsset> = { 'audio-1': { data: 'data:audio/mpeg;base64,AA', durationS: 60, peaks: [1] } }
    const made: { el: ReturnType<typeof fakeElement>; released: boolean }[] = []
    const preview = createMusicPreview(
      (id) => table[id],
      () => {
        const entry = { el: fakeElement(), released: false }
        made.push(entry)
        return { el: entry.el satisfies MusicElement, release: () => (entry.released = true) }
      },
    )
    return { preview, made, table }
  }
  const at = (timeS: number | null, patch: Partial<{ playing: boolean; speed: number; muted: boolean }> = {}) => ({
    playing: true,
    timeS,
    speed: 1,
    muted: false,
    ...patch,
  })

  it('plays along from the time in the file, follows the speed, the volume and the mute', () => {
    const { preview, made } = setup()
    const c = clip({ inS: 4, fadeInS: 2 })
    // before the clip: loaded but silent
    preview.update([c], at(5))
    expect(made).toHaveLength(1)
    expect(made[0].el.paused).toBe(true)
    preview.update([c], at(11, { speed: 2 }))
    const el = made[0].el
    expect(el.paused).toBe(false)
    expect(el.currentTime).toBe(5)
    expect(el.playbackRate).toBe(2)
    expect(el.volume).toBe(0.5)
    preview.update([c], at(12.5, { muted: true }))
    expect(el.muted).toBe(true)
    expect(el.plays).toBe(1)
  })

  it('lowered under the clips with sound', () => {
    const { preview, made } = setup()
    const duck = duckEnvelope([{ startS: 15, lengthS: 5 }])
    preview.update([clip({ fadeInS: 0 })], at(12), duck)
    expect(made[0].el.volume).toBe(1)
    preview.update([clip({ fadeInS: 0 })], at(17), duck)
    expect(made[0].el.volume).toBeCloseTo(DUCK_GAIN)
  })

  it('seeks again only past the drift tolerance, and not while loading', () => {
    const { preview, made } = setup()
    const c = clip()
    preview.update([c], at(12))
    const el = made[0].el
    el.currentTime = 2 + MUSIC_DRIFT_S / 2
    preview.update([c], at(12))
    expect(el.currentTime).toBe(2 + MUSIC_DRIFT_S / 2)
    el.readyState = 1
    el.currentTime = 0
    preview.update([c], at(14))
    expect(el.currentTime).toBe(0)
    el.readyState = 4
    preview.update([c], at(14))
    expect(el.currentTime).toBe(4)
  })

  it('pauses when the playback stops, at the end of the clip or of the film; drops removed clips', () => {
    const { preview, made, table } = setup()
    const c = clip()
    preview.update([c], at(12))
    preview.update([c], at(12, { playing: false }))
    expect(made[0].el.paused).toBe(true)
    preview.update([c], at(12))
    preview.update([c], at(30))
    expect(made[0].el.paused).toBe(true)
    preview.update([c], at(null))
    expect(made[0].el.paused).toBe(true)
    preview.update([], at(12))
    expect(made[0].released).toBe(true)
    // another project: a new element for the new file
    preview.update([c], at(12))
    table['audio-1'] = { ...table['audio-1'] }
    preview.update([c], at(12))
    expect(made).toHaveLength(3)
    expect(made[1].released).toBe(true)
    preview.dispose()
    expect(made[2].released).toBe(true)
  })
})

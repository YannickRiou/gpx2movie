// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import sampleGpx from '../../public/samples/tour-du-mont-blanc-j1.gpx?raw'
import { parseGpx } from '../import/gpx'
import { buildTrack } from '../import/stats'
import type { WeatherSummary } from '../weather/series'
import type { Track } from '../core/types'
import { POSTER_LIST_MAX, availableFigures, posterContent, shortDateFr, totalStats } from './content'
import { DEFAULT_POSTER } from './settings'

const sample = parseGpx(sampleGpx, 'tour-du-mont-blanc-j1.gpx')[0]
/** no elevation, no time */
const flat = buildTrack({ name: 'plat', source: 'gpx', segments: [{ points: [{ lon: 6.8, lat: 45.9 }, { lon: 6.81, lat: 45.91 }] }] })

const WEATHER: WeatherSummary = {
  minTemperatureC: 8,
  maxTemperatureC: 17,
  precipitationMm: 0,
  snowfallCm: 0,
  maxWindKmh: 25,
  maxGustsKmh: 40,
  dominant: { label: 'Ciel dégagé', icon: 'clear' } as WeatherSummary['dominant'],
}

const input = { tracks: [sample], race: false, poster: DEFAULT_POSTER, projectName: 'Mon projet', climbs: [3], weather: WEATHER, credits: ['Relief : A', 'Imagerie : B'] }

describe('posterContent', () => {
  it('titles the poster with the project name unless a title is typed, and puts the date after the subtitle', () => {
    expect(posterContent(input).title).toBe('Mon projet')
    const typed = posterContent({ ...input, poster: { ...DEFAULT_POSTER, title: '  Tour du Mont-Blanc ', subtitle: 'Étape 1' } })
    expect(typed.title).toBe('Tour du Mont-Blanc')
    expect(typed.subtitle).toMatch(/^Étape 1 · \d+(er)? \p{L}+ \d{4}$/u)
    expect(posterContent({ ...input, tracks: [flat] }).subtitle).toBe('')
  })

  it('lists the chosen figures the track records, in their order', () => {
    const all = posterContent(input).figures
    expect(all.map((f) => f.id)).toEqual(['distance', 'ascent', 'time', 'maxAltitude', 'climbs'])
    expect(all[0].unit).toBe('km')
    expect(all[4]).toMatchObject({ value: '3', label: 'Montées' })
    expect(posterContent({ ...input, climbs: [1] }).figures[4].label).toBe('Montée')
    const some = posterContent({ ...input, poster: { ...DEFAULT_POSTER, figures: { ...DEFAULT_POSTER.figures, time: false, climbs: false } } })
    expect(some.figures.map((f) => f.id)).toEqual(['distance', 'ascent', 'maxAltitude'])
    expect(posterContent({ ...input, tracks: [flat] }).figures.map((f) => f.id)).toEqual(['distance'])
    expect(availableFigures(flat.stats)).toEqual({ distance: true, ascent: false, time: false, maxAltitude: false, climbs: false })
  })

  it('has a profile with elevations, the weather only when wanted, and always the credits', () => {
    const content = posterContent(input)
    expect(content.profile?.ele.length).toBeGreaterThan(100)
    expect(content.profile?.lengthM).toBeCloseTo(sample.stats.distanceM, -2)
    expect(content.weather).toContain('Ciel dégagé')
    expect(posterContent({ ...input, poster: { ...DEFAULT_POSTER, weather: false } }).weather).toBe('')
    expect(posterContent({ ...input, weather: undefined }).weather).toBe('')
    expect(posterContent({ ...input, tracks: [flat] }).profile).toBeUndefined()
    expect(content.credits).toEqual(['Relief : A', 'Imagerie : B'])
    expect(content.tracks).toEqual([])
  })
})

/** The sample again as another outing, a week later. */
function outing(name: string, color: string, days: number): Track {
  const shift = days * 86_400_000
  const startTime = (sample.stats.startTime ?? 0) + shift
  return { ...sample, id: name, name, color, stats: { ...sample.stats, startTime, endTime: (sample.stats.endTime ?? 0) + shift } }
}

describe('posterContent of several tracks', () => {
  const second = outing('Jour 2', '#2266aa', 7)
  const several = { ...input, tracks: [sample, second], climbs: [3, 2] }

  it('sums a set of outings: figures of all of them, their count and dates in the subtitle, no profile nor weather', () => {
    const content = posterContent(several)
    const total = totalStats([sample, second])
    expect(total.distanceM).toBeCloseTo(2 * sample.stats.distanceM, 6)
    expect(total.maxEle).toBe(sample.stats.maxEle)
    const one = posterContent(input).figures
    const both = content.figures
    expect(both.find((f) => f.id === 'climbs')?.value).toBe('5')
    expect(both.find((f) => f.id === 'distance')?.value).not.toBe(one.find((f) => f.id === 'distance')?.value)
    expect(both.find((f) => f.id === 'maxAltitude')).toEqual(one.find((f) => f.id === 'maxAltitude'))
    expect(content.subtitle).toMatch(/^2 sorties · .+ – .+ \d{4}$/u)
    expect(content.profile).toBeUndefined()
    expect(content.weather).toBe('')
  })

  it('leaves out a sum one outing does not record', () => {
    const total = totalStats([sample, flat])
    expect(total.distanceM).toBeCloseTo(sample.stats.distanceM + flat.stats.distanceM, 6)
    expect(total.maxEle).toBeUndefined()
    expect(total.durationS).toBeUndefined()
    expect(availableFigures(total)).toEqual({ distance: true, ascent: false, time: false, maxAltitude: false, climbs: false })
  })

  it('keeps the figures and weather of the lead in a ghost race', () => {
    const content = posterContent({ ...several, race: true })
    expect(content.figures).toEqual(posterContent(input).figures)
    expect(content.weather).toContain('Ciel dégagé')
    expect(content.subtitle).toMatch(/^2 traces · /u)
  })

  it(`lists up to ${POSTER_LIST_MAX} tracks with their colour, distance, D+ and date, then only sums them`, () => {
    const list = posterContent(several).tracks
    expect(list.map((l) => [l.name, l.color])).toEqual([[sample.name, sample.color], ['Jour 2', '#2266aa']])
    expect(list[0].distance).toMatch(/ km$/)
    expect(list[0].ascent).toMatch(/^D\+ [\d\s\u202f]+ m$/u)
    expect(list[1].date).toBe(shortDateFr(second.stats.startTime ?? 0))
    expect(shortDateFr(new Date(2026, 6, 3).getTime())).toBe('03/07/2026')
    const many = Array.from({ length: POSTER_LIST_MAX + 1 }, (_, i) => outing(`Jour ${i + 1}`, '#000000', i))
    const summed = posterContent({ ...input, tracks: many, climbs: many.map(() => 1) })
    expect(summed.tracks).toEqual([])
    expect(summed.subtitle.startsWith(`${POSTER_LIST_MAX + 1} sorties · `)).toBe(true)
    expect(posterContent({ ...input, tracks: many.slice(0, POSTER_LIST_MAX), climbs: [] }).tracks).toHaveLength(POSTER_LIST_MAX)
    expect(posterContent({ ...input, tracks: [sample, flat], climbs: [3, 0] }).tracks[1]).toMatchObject({ ascent: '', date: '' })
  })
})

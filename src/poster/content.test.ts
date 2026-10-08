import { describe, expect, it } from 'vitest'
import sampleGpx from '../../public/samples/tour-du-mont-blanc-j1.gpx?raw'
import { parseGpx } from '../import/gpx'
import { buildTrack } from '../import/stats'
import type { WeatherSummary } from '../weather/series'
import { availableFigures, posterContent } from './content'
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

const input = { track: sample, poster: DEFAULT_POSTER, projectName: 'Mon projet', climbs: 3, weather: WEATHER, credits: ['Relief : A', 'Imagerie : B'] }

describe('posterContent', () => {
  it('titles the poster with the project name unless a title is typed, and puts the date after the subtitle', () => {
    expect(posterContent(input).title).toBe('Mon projet')
    const typed = posterContent({ ...input, poster: { ...DEFAULT_POSTER, title: '  Tour du Mont-Blanc ', subtitle: 'Étape 1' } })
    expect(typed.title).toBe('Tour du Mont-Blanc')
    expect(typed.subtitle).toMatch(/^Étape 1 · \d+(er)? \p{L}+ \d{4}$/u)
    expect(posterContent({ ...input, track: flat }).subtitle).toBe('')
  })

  it('lists the chosen figures the track records, in their order', () => {
    const all = posterContent(input).figures
    expect(all.map((f) => f.id)).toEqual(['distance', 'ascent', 'time', 'maxAltitude', 'climbs'])
    expect(all[0].unit).toBe('km')
    expect(all[4]).toMatchObject({ value: '3', label: 'Montées' })
    expect(posterContent({ ...input, climbs: 1 }).figures[4].label).toBe('Montée')
    const some = posterContent({ ...input, poster: { ...DEFAULT_POSTER, figures: { ...DEFAULT_POSTER.figures, time: false, climbs: false } } })
    expect(some.figures.map((f) => f.id)).toEqual(['distance', 'ascent', 'maxAltitude'])
    expect(posterContent({ ...input, track: flat }).figures.map((f) => f.id)).toEqual(['distance'])
    expect(availableFigures(flat)).toEqual({ distance: true, ascent: false, time: false, maxAltitude: false, climbs: false })
  })

  it('has a profile with elevations, the weather only when wanted, and always the credits', () => {
    const content = posterContent(input)
    expect(content.profile?.ele.length).toBeGreaterThan(100)
    expect(content.profile?.lengthM).toBeCloseTo(sample.stats.distanceM, -2)
    expect(content.weather).toContain('Ciel dégagé')
    expect(posterContent({ ...input, poster: { ...DEFAULT_POSTER, weather: false } }).weather).toBe('')
    expect(posterContent({ ...input, weather: undefined }).weather).toBe('')
    expect(posterContent({ ...input, track: flat }).profile).toBeUndefined()
    expect(content.credits).toEqual(['Relief : A', 'Imagerie : B'])
  })
})

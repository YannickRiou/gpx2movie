import { describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import { buildTrack } from '../import/stats'
import { DEFAULT_PLAYBACK, DEFAULT_SETTINGS } from '../state/store'
import type { Settings } from '../state/store'
import {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  migrateProject,
  parseProject,
  projectFileName,
  sanitizeSettings,
  serializeProject,
  toProjectDocument,
} from './document'

function makeTrack(id: string, color: string): Track {
  const track = buildTrack({
    name: `Trace ${id}`,
    source: 'gpx',
    activityType: 'hiking',
    segments: [
      {
        points: [
          { lon: 6.8691234567, lat: 45.9234567891, ele: 1035.123, time: 1_720_000_000_000, hr: 120 },
          { lon: 6.8701, lat: 45.9241, ele: 1042.5, time: 1_720_000_010_000 },
          { lon: 6.8712, lat: 45.9255, time: 1_720_000_020_000, hr: 131 },
        ],
      },
      { points: [{ lon: 6.88, lat: 45.93, ele: 1100 }] },
    ],
  })
  track.id = id
  track.color = color
  return track
}

const SETTINGS: Settings = { ...DEFAULT_SETTINGS, exaggeration: 1.7, imagerySourceId: 'ign-ortho', wireframe: true }
const STATE = { tracks: [makeTrack('a', '#FF5A36'), makeTrack('b', '#5BC0EB')], settings: SETTINGS, playback: { ...DEFAULT_PLAYBACK, speed: 2 } }

/** Valid serialised document as a mutable object. */
function doc(): Record<string, unknown> {
  return JSON.parse(serializeProject(STATE, 'Mont Blanc')) as Record<string, unknown>
}

describe('serializeProject / parseProject', () => {
  it('round-trips name, settings, speed and tracks (same ids, colours, stats)', () => {
    const text = serializeProject(STATE, '  Mont Blanc  ')
    const loaded = parseProject(text)
    expect(loaded.name).toBe('Mont Blanc')
    expect(loaded.settings).toEqual(SETTINGS)
    expect(loaded.speed).toBe(2)
    expect(loaded.warnings).toEqual([])
    expect(loaded.tracks).toHaveLength(2)
    loaded.tracks.forEach((track, i) => {
      const original = STATE.tracks[i]
      expect(track.id).toBe(original.id)
      expect(track.color).toBe(original.color)
      expect(track.name).toBe(original.name)
      expect(track.activityType).toBe('hiking')
      expect(track.segments.map((s) => s.points.length)).toEqual([3, 1])
      expect(track.stats.pointCount).toBe(original.stats.pointCount)
      expect(track.stats.distanceM).toBeCloseTo(original.stats.distanceM, 2)
      expect(track.stats.ascentM).toBeCloseTo(original.stats.ascentM, 1)
      expect(track.stats.startTime).toBe(original.stats.startTime)
      expect(track.bounds.west).toBeCloseTo(original.bounds.west, 6)
    })
    // missing values stay missing
    const [p0, p1, p2] = loaded.tracks[0].segments[0].points
    expect(p0).toEqual({ lon: 6.8691235, lat: 45.9234568, ele: 1035.12, time: 1_720_000_000_000, hr: 120 })
    expect(p1.hr).toBeUndefined()
    expect(p2.ele).toBeUndefined()
  })

  it('writes a compact column layout, one line per track, without absent columns', () => {
    const text = serializeProject(STATE, 'x')
    const parsed = JSON.parse(text) as ReturnType<typeof toProjectDocument>
    expect(parsed.format).toBe(PROJECT_FORMAT)
    expect(parsed.version).toBe(PROJECT_VERSION)
    expect(parsed.tracks[0].segments[0]).toEqual({
      lon: [6.8691235, 6.8701, 6.8712],
      lat: [45.9234568, 45.9241, 45.9255],
      ele: [1035.12, 1042.5, null],
      time: [1_720_000_000_000, 1_720_000_010_000, 1_720_000_020_000],
      hr: [120, null, 131],
    })
    expect(Object.keys(parsed.tracks[0].segments[1])).toEqual(['lon', 'lat', 'ele'])
    expect(text.split('\n').filter((l) => l.startsWith('    {"id"'))).toHaveLength(2)
    expect(serializeProject({ ...STATE, tracks: [] }, 'x')).toContain('"tracks": []')
    expect(toProjectDocument(STATE, '   ').name).toBe('Sans titre')
  })

  it('falls back to the default per invalid or missing setting and ignores unknown keys', () => {
    const d = doc()
    d.settings = { exaggeration: 'beaucoup', wireframe: true, imageryZoomOffset: 5, terrainSourceId: 'inconnu', sunHour: 14, extra: 1 }
    d.playback = { speed: -1 }
    d.unknownTopLevel = { anything: true }
    const loaded = parseProject(JSON.stringify(d))
    expect(loaded.settings).toEqual({ ...DEFAULT_SETTINGS, wireframe: true, sunHour: 14 })
    expect(loaded.settings).not.toHaveProperty('extra')
    expect(loaded.speed).toBe(1)
    expect(loaded.warnings).toEqual([
      'Réglages invalides remplacés par leur valeur par défaut : terrainSourceId, imageryZoomOffset, exaggeration.',
      'Vitesse de lecture invalide : vitesse ×1 utilisée.',
    ])
  })

  it('handles any key of DEFAULT_SETTINGS, including keys added later', () => {
    const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>
    defaults.futureColour = 'speed'
    defaults.futureNested = { size: 2, visible: true }
    try {
      const state = { ...STATE, settings: { ...SETTINGS, futureColour: 'slope', futureNested: { size: 3, visible: false } } as Settings }
      expect(parseProject(serializeProject(state, 'x')).settings).toMatchObject({ futureColour: 'slope', futureNested: { size: 3, visible: false } })
      const { settings, invalid } = sanitizeSettings({ futureColour: 4, futureNested: { size: 'big', visible: true } })
      expect(settings).toMatchObject({ futureColour: 'speed', futureNested: { size: 2, visible: true } })
      expect(invalid).toEqual(['futureColour', 'futureNested'])
    } finally {
      delete defaults.futureColour
      delete defaults.futureNested
    }
  })

  it('keeps the base value for missing keys in sanitizeSettings', () => {
    const base = { ...DEFAULT_SETTINGS, exaggeration: 2.5 }
    expect(sanitizeSettings({ wireframe: true }, base).settings).toEqual({ ...base, wireframe: true })
    expect(sanitizeSettings(null, base)).toEqual({ settings: base, invalid: [] })
  })

  it('validates the ghost race and loads projects saved before it', () => {
    const d = doc()
    const settings = d.settings as Record<string, unknown>
    delete settings.race
    expect(parseProject(JSON.stringify(d)).settings.race).toEqual({ enabled: false, sync: 'elapsed' })
    settings.race = { enabled: true, sync: 'clock' }
    expect(parseProject(JSON.stringify(d)).settings.race).toEqual({ enabled: true, sync: 'clock' })
    const { settings: sanitized, invalid } = sanitizeSettings({ race: { enabled: true, sync: 'warp' } })
    expect(sanitized.race).toEqual(DEFAULT_SETTINGS.race)
    expect(invalid).toEqual(['race'])
  })

  it('loads the fixed video formats of older projects as aspect × resolution', () => {
    const { settings, invalid } = sanitizeSettings({ video: { format: '1080x1920', fps: 60, quality: 'max' } })
    expect(invalid).toEqual([])
    expect(settings.video).toEqual({ aspect: '9:16', resolution: '1080p', fps: 60, quality: 'max' })
    expect(sanitizeSettings({ video: { aspect: '1:1', resolution: '8k', fps: 30, quality: 'high' } }).invalid).toEqual(['video'])
  })

  it('rejects an unknown track colour mode and an out-of-range exposure', () => {
    const { settings, invalid } = sanitizeSettings({ trackColorBy: 'rainbow', exposureEv: 12 })
    expect(settings.trackColorBy).toBe(DEFAULT_SETTINGS.trackColorBy)
    expect(settings.exposureEv).toBe(DEFAULT_SETTINGS.exposureEv)
    expect(invalid).toEqual(expect.arrayContaining(['trackColorBy', 'exposureEv']))
  })

  it('replaces an invalid colour by the palette and a missing name by a label', () => {
    const d = doc()
    const tracks = d.tracks as Record<string, unknown>[]
    tracks[0].color = 'red; background: url(x)'
    delete tracks[1].name
    const loaded = parseProject(JSON.stringify(d))
    expect(loaded.tracks[0].color).toBe('#FF5A36')
    expect(loaded.tracks[1].name).toBe('Trace n°2')
  })

  it('round-trips GPX waypoints (rounded) and omits them when a track has none', () => {
    const track = makeTrack('w', '#FF5A36')
    track.waypoints = [
      { lon: 6.78201234567, lat: 45.86312345678, ele: 1653.456, name: 'Col de Voza' },
      { lon: 6.77, lat: 45.85, name: 'Point 2' },
    ]
    const text = serializeProject({ ...STATE, tracks: [track, makeTrack('b', '#5BC0EB')] }, 'x')
    const parsed = JSON.parse(text) as ReturnType<typeof toProjectDocument>
    expect(parsed.tracks[1]).not.toHaveProperty('waypoints')
    const loaded = parseProject(text)
    expect(loaded.tracks[0].waypoints).toEqual([
      { lon: 6.7820123, lat: 45.8631235, ele: 1653.46, name: 'Col de Voza' },
      { lon: 6.77, lat: 45.85, name: 'Point 2' },
    ])
    expect(loaded.tracks[1].waypoints).toBeUndefined()
  })
})

describe('parseProject errors', () => {
  const cases: [string, (d: Record<string, unknown>) => unknown, RegExp][] = [
    ['not JSON', () => '{', /pas du JSON valide/],
    ['another JSON', () => ({ type: 'FeatureCollection' }), /pas un projet OpenFlyover/],
    ['an array', () => [], /pas un projet OpenFlyover/],
    ['a future version', (d) => ({ ...d, version: 7 }), /format v7, plus récent .*\(v1\)/],
    ['a bad version', (d) => ({ ...d, version: '1' }), /version/],
    ['no tracks', (d) => ({ ...d, tracks: undefined }), /liste des traces/],
    ['a track without id', (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], id: '' }] }), /Trace n°1 : identifiant/],
    ['an unknown source', (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], source: 'kml' }] }), /origine/],
    [
      'out-of-range coordinates',
      (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], segments: [{ lon: [6, 200], lat: [45, 45] }] }] }),
      /Trace n°1, segment 1 : coordonnées invalides au point 2/,
    ],
    [
      'columns of different lengths',
      (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], segments: [{ lon: [6, 7], lat: [45, 45], ele: [1] }] }] }),
      /colonne « ele » invalide \(2 valeurs attendues\)/,
    ],
    [
      'a non-numeric value',
      (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], segments: [{ lon: [6], lat: [45], time: ['hier'] }] }] }),
      /valeur « time » invalide au point 1/,
    ],
    ['a track without points', (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], segments: [{ lon: [], lat: [] }] }] }), /aucun point/],
    [
      'a waypoint with bad coordinates',
      (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], waypoints: [{ lon: 6, lat: 95, name: 'x' }] }] }),
      /Trace n°1, point 1 : coordonnées invalides/,
    ],
    ['waypoints that are not a list', (d) => ({ ...d, tracks: [{ ...(d.tracks as object[])[0], waypoints: {} }] }), /« waypoints »/],
    ['duplicate ids', (d) => ({ ...d, tracks: [(d.tracks as object[])[0], (d.tracks as object[])[0]] }), /deux traces .*« a »/],
  ]
  it.each(cases)('rejects %s with a French message', (_, mutate, message) => {
    const value = mutate(doc())
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    expect(() => parseProject(text)).toThrow(message)
  })
})

describe('migrateProject', () => {
  const migrations = {
    1: (d: Record<string, unknown>) => ({ ...d, renamed: d.old, old: undefined }),
    2: (d: Record<string, unknown>) => ({ ...d, extra: 'v3' }),
  }

  it('chains the migrations from the document version up to the target', () => {
    expect(migrateProject({ version: 1, old: 'x' }, migrations, 3)).toEqual({ version: 3, renamed: 'x', old: undefined, extra: 'v3' })
    expect(migrateProject({ version: 2 }, migrations, 3)).toEqual({ version: 3, extra: 'v3' })
    expect(migrateProject({ version: 3, a: 1 }, migrations, 3)).toEqual({ version: 3, a: 1 })
  })

  it('fails on a missing step or a newer version', () => {
    expect(() => migrateProject({ version: 1 }, { 2: migrations[2] }, 3)).toThrow(/du format v1 vers v2/)
    expect(() => migrateProject({ version: 4 }, migrations, 3)).toThrow(/v4, plus récent/)
    expect(() => migrateProject({ version: 0 }, migrations, 3)).toThrow(/version/)
  })

  it('leaves current documents untouched with the built-in table', () => {
    const d = doc()
    expect(migrateProject(d)).toEqual(d)
  })
})

describe('projectFileName', () => {
  it('builds a safe <name>.openflyover.json', () => {
    expect(projectFileName('Tour du Mont-Blanc J1')).toBe('Tour du Mont-Blanc J1.openflyover.json')
    expect(projectFileName('a/b:c*?')).toBe('a-b-c-.openflyover.json')
    expect(projectFileName('  ..  ')).toBe('projet.openflyover.json')
  })
})

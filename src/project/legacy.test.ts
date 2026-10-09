import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../state/store'
import type { Settings } from '../state/store'
import { parseProject } from './document'

// Files as the app wrote them at the time (format history in git), frozen: never regenerate them from today's code.

/** v1, last format before the timeline: pacing on, no film. */
const V1 = `{
  "format": "openflyover-project",
  "version": 1,
  "name": "Tour du Mont Blanc",
  "settings": {
    "terrainSourceId": "mapterhorn",
    "imagerySourceId": "swisstopo",
    "imageryZoomOffset": 2,
    "exaggeration": 1.5,
    "wireframe": false,
    "atmosphere": true,
    "shadows": false,
    "sunHour": 8.5,
    "sunFromTrack": false,
    "exposureEv": 0.5,
    "trackColorBy": "elevation",
    "camera": { "style": "orbit", "distance": 1.2, "pitchDeg": 30, "headingOffsetDeg": 0, "smoothing": 1, "northUp": false },
    "flyoverDurationS": 90,
    "pacing": { "enabled": true, "climbs": true, "landmarks": false, "slowFactor": 0.5, "windowM": 800, "pauseS": 3, "keepDuration": false },
    "labels": { "climbs": true, "waypoints": false },
    "weather": { "enabled": false },
    "weatherScene": { "enabled": true, "strength": 0.5 },
    "overlay": {
      "enabled": true,
      "style": "broadcast",
      "title": { "enabled": true, "anchor": "center", "size": 1, "title": "TMB", "subtitle": "Étape 1", "showDate": true, "end": 0.1 },
      "end": { "enabled": true, "anchor": "center", "size": 1, "title": "", "start": 0.9, "showWeather": true },
      "counters": { "enabled": true, "anchor": "top-left", "size": 1, "fields": { "distance": true, "altitude": true, "ascent": true, "time": true, "speed": false, "heartRate": true } },
      "profile": { "enabled": true, "anchor": "top-right", "width": 0.3, "height": 0.12 },
      "logo": { "enabled": false, "anchor": "bottom-right", "size": 1, "image": "" },
      "text": { "enabled": false, "anchor": "bottom-left", "size": 1, "text": "" },
      "weather": { "enabled": true, "anchor": "top-left", "size": 1 },
      "minimap": { "enabled": true, "anchor": "bottom-right", "size": 1.5, "northArrow": false }
    },
    "video": { "aspect": "9:16", "resolution": "1080p", "fps": 60, "quality": "max" },
    "landmarks": { "enabled": true, "kinds": { "peak": true, "pass": true, "hut": false, "lake": true, "waterfall": false, "place": false, "viewpoint": false, "glacier": false }, "maxDistanceM": 800 },
    "race": { "enabled": false, "sync": "elapsed" }
  },
  "playback": { "speed": 2 },
  "tracks": [
    {"id":"track-1","name":"Chamonix – Les Houches","source":"gpx","color":"#3f6b4a","segments":[{"lon":[6.8694,6.8701,6.8712],"lat":[45.9237,45.9229,45.9218],"ele":[1035,1041.5,null],"time":[1720760400000,1720760460000,1720760520000]}],"waypoints":[{"lon":6.8701,"lat":45.9229,"name":"Pont","ele":1041.5}]}
  ]
}
`

/** v2, first format with the timeline: film with a stop and a text. */
const V2 = `{
  "format": "openflyover-project",
  "version": 2,
  "name": "Lac Blanc",
  "settings": {
    "terrainSourceId": "aws-terrarium",
    "imagerySourceId": "ign-ortho",
    "imageryZoomOffset": 1,
    "exaggeration": 1,
    "wireframe": false,
    "atmosphere": true,
    "shadows": true,
    "sunHour": 10,
    "sunFromTrack": true,
    "exposureEv": 0,
    "trackColorBy": "none",
    "camera": { "style": "chase", "distance": 1.5, "pitchDeg": 40, "headingOffsetDeg": 10, "smoothing": 2, "northUp": false },
    "flyoverDurationS": 60,
    "pacing": { "enabled": false, "climbs": true, "landmarks": true, "slowFactor": 0.35, "windowM": 1000, "pauseS": 2, "keepDuration": true },
    "film": {
      "opening": { "style": "saut", "durationS": 4 },
      "closing": { "style": "aucune", "durationS": 5 },
      "autoStops": false,
      "autoMode": "temps-forts",
      "stops": [{ "id": "stop-1", "atM": 120, "durationS": 6, "camera": "orbite", "label": "Lac" }],
      "texts": [{ "id": "text-1", "startS": 3, "durationS": 4, "text": "Départ", "anchor": "bottom-left", "size": 1 }],
      "media": []
    },
    "labels": { "climbs": false, "waypoints": true },
    "weather": { "enabled": true },
    "weatherScene": { "enabled": true, "strength": 1 },
    "overlay": {
      "enabled": false,
      "style": "editorial",
      "title": { "enabled": true, "anchor": "center", "size": 1, "title": "", "subtitle": "", "showDate": true, "end": 0.1 },
      "end": { "enabled": true, "anchor": "center", "size": 1, "title": "", "start": 0.9, "showWeather": true },
      "counters": { "enabled": true, "anchor": "top-left", "size": 1, "fields": { "distance": true, "altitude": true, "ascent": true, "time": true, "speed": false, "heartRate": false } },
      "profile": { "enabled": true, "anchor": "top-right", "width": 0.3, "height": 0.12 },
      "logo": { "enabled": false, "anchor": "bottom-right", "size": 1, "image": "" },
      "text": { "enabled": false, "anchor": "bottom-left", "size": 1, "text": "" },
      "weather": { "enabled": false, "anchor": "top-left", "size": 1 },
      "minimap": { "enabled": false, "anchor": "bottom-right", "size": 1, "northArrow": true }
    },
    "video": { "aspect": "16:9", "resolution": "1080p", "fps": 30, "quality": "high" },
    "landmarks": { "enabled": true, "kinds": { "peak": true, "pass": true, "hut": true, "lake": true, "waterfall": false, "place": false, "viewpoint": false, "glacier": false }, "maxDistanceM": 1500 },
    "race": { "enabled": false, "sync": "elapsed" }
  },
  "playback": { "speed": 1 },
  "tracks": [
    {"id":"a","name":"Montée","source":"fit","activityType":"hiking","color":"#a9ccd9","segments":[{"lon":[6.8879,6.8885,6.8891],"lat":[45.9794,45.9801,45.9812],"ele":[2000,2080,2350],"hr":[120,null,150]}]}
  ]
}
`

/** Settings the file does not hold: today's defaults. */
function expectDefaultsBut(settings: Settings, saved: readonly (keyof Settings)[]) {
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (!saved.includes(key)) expect(settings[key], key).toEqual(DEFAULT_SETTINGS[key])
  }
}

/** settings checked one by one below (the film of v1 comes from the migration) */
const CHECKED = [
  'terrainSourceId', 'imagerySourceId', 'imageryZoomOffset', 'exaggeration', 'wireframe', 'atmosphere', 'shadows', 'sunHour',
  'sunFromTrack', 'exposureEv', 'trackColorBy', 'camera', 'flyoverDurationS', 'pacing', 'film', 'labels', 'weather',
  'weatherScene', 'overlay', 'video', 'landmarks', 'race',
] as const

describe('frozen old projects', () => {
  it('v1: every saved setting kept, the automatic stops follow the pacing, the fields added since filled in', () => {
    const p = parseProject(V1)
    expect(p.warnings).toEqual([])
    expect(p.name).toBe('Tour du Mont Blanc')
    expect(p.speed).toBe(2)
    expect(p.media).toEqual({})
    const s = p.settings
    expect(s).toMatchObject({
      terrainSourceId: 'mapterhorn',
      imagerySourceId: 'swisstopo',
      imageryZoomOffset: 2,
      exaggeration: 1.5,
      wireframe: false,
      atmosphere: true,
      shadows: false,
      sunHour: 8.5,
      sunFromTrack: false,
      exposureEv: 0.5,
      trackColorBy: 'elevation',
      flyoverDurationS: 90,
      weather: { enabled: false },
      weatherScene: { enabled: true, strength: 0.5 },
      video: { aspect: '9:16', resolution: '1080p', fps: 60, quality: 'max' },
      race: { enabled: false, sync: 'elapsed' },
    })
    expect(s.camera).toEqual({
      style: 'orbit', distance: 1.2, pitchDeg: 30, headingOffsetDeg: 0, smoothing: 1, northUp: false,
      turnSmoothingM: 0, aimSmoothingS: 0, cameraSmoothingS: 3, endingS: 0,
    })
    expect(s.pacing).toEqual({ enabled: true, climbs: true, landmarks: false, slowFactor: 0.5, windowM: 800, pauseS: 3, keepDuration: false, transitionS: 1.5 })
    expect(s.film).toEqual({
      opening: { style: 'descente', durationS: 6 },
      closing: { style: 'descente', durationS: 5 },
      autoStops: true,
      autoMode: 'rythme',
      stops: [], speeds: [], cameraKeys: [], texts: [], media: [], audio: [],
      duckMusic: false, pois: [], landmarkTitles: false,
    })
    expect(s.labels).toEqual({ climbs: true, waypoints: false, kmStep: 0, endpoints: false, photos: false, size: 1, rangeKm: 70 })
    expect(s.overlay).toMatchObject({
      enabled: true,
      style: 'broadcast',
      title: { title: 'TMB', subtitle: 'Étape 1' },
      counters: { fields: { heartRate: true } },
      weather: { enabled: true, anchor: 'top-left', size: 1 },
      minimap: { enabled: true, anchor: 'bottom-right', size: 1.5, northArrow: false },
      credits: { enabled: true, position: 'bottom-right' },
      leaderboard: { enabled: false, anchor: 'middle-right', size: 1 },
    })
    expect(s.landmarks).toEqual({
      enabled: true,
      kinds: { peak: true, pass: true, hut: false, lake: true, waterfall: false, place: false, viewpoint: false, glacier: false, waterPoint: false },
      maxDistanceM: 800,
      hiddenIds: [],
    })
    expectDefaultsBut(s, [...CHECKED, 'sunDate'])
    expect(s.sunDate).toBe('')

    const [track] = p.tracks
    expect(track).toMatchObject({ id: 'track-1', name: 'Chamonix – Les Houches', source: 'gpx', color: '#3f6b4a' })
    expect(track.segments[0].points).toEqual([
      { lon: 6.8694, lat: 45.9237, ele: 1035, time: 1720760400000 },
      { lon: 6.8701, lat: 45.9229, ele: 1041.5, time: 1720760460000 },
      { lon: 6.8712, lat: 45.9218, time: 1720760520000 },
    ])
    expect(track.waypoints).toEqual([{ lon: 6.8701, lat: 45.9229, name: 'Pont', ele: 1041.5 }])
    expect(track.stats).toMatchObject({ ascentM: 6.5, durationS: 120, minEle: 1035, maxEle: 1041.5, pointCount: 3 })
    expect(track.utcOffsetMin).toBeUndefined()
  })

  it('v2: the film kept as edited (stops on the highlights), the lanes added since empty', () => {
    const p = parseProject(V2)
    expect(p.warnings).toEqual([])
    expect(p.name).toBe('Lac Blanc')
    expect(p.speed).toBe(1)
    const s = p.settings
    expect(s.terrainSourceId).toBe('aws-terrarium')
    expect(s.imagerySourceId).toBe('ign-ortho')
    expect(s.camera).toMatchObject({ style: 'chase', distance: 1.5, pitchDeg: 40, headingOffsetDeg: 10, smoothing: 2, cameraSmoothingS: 3 })
    expect(s.film).toEqual({
      opening: { style: 'saut', durationS: 4 },
      closing: { style: 'aucune', durationS: 5 },
      autoStops: false,
      autoMode: 'temps-forts',
      stops: [{ id: 'stop-1', atM: 120, durationS: 6, camera: 'orbite', label: 'Lac' }],
      speeds: [],
      cameraKeys: [],
      texts: [{ id: 'text-1', startS: 3, durationS: 4, text: 'Départ', anchor: 'bottom-left', size: 1 }],
      media: [],
      audio: [],
      duckMusic: false,
      pois: [],
      landmarkTitles: false,
    })
    expect(s.labels).toEqual({ climbs: false, waypoints: true, kmStep: 0, endpoints: false, photos: false, size: 1, rangeKm: 70 })
    expect(s.overlay.enabled).toBe(false)
    expect(s.landmarks.maxDistanceM).toBe(1500)
    expectDefaultsBut(s, [...CHECKED, 'sunDate'])

    const [track] = p.tracks
    expect(track).toMatchObject({ id: 'a', name: 'Montée', source: 'fit', activityType: 'hiking', color: '#a9ccd9' })
    expect(track.segments[0].points).toEqual([
      { lon: 6.8879, lat: 45.9794, ele: 2000, hr: 120 },
      { lon: 6.8885, lat: 45.9801, ele: 2080 },
      { lon: 6.8891, lat: 45.9812, ele: 2350, hr: 150 },
    ])
    expect(track.stats).toMatchObject({ ascentM: 350, minEle: 2000, maxEle: 2350, pointCount: 3 })
  })
})

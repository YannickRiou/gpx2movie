import { afterEach, describe, expect, it } from 'vitest'
import type { Track } from '../core/types'
import type { Climb } from '../flyover/climbs'
import { buildTrack } from '../import/stats'
import { cardOpacityAt, progressTime } from '../overlay/draw'
import { DEFAULT_OVERLAY } from '../overlay/settings'
import {
  LABEL_FADE_END_M,
  LABEL_FADE_START_M,
  WAYPOINT_PRIORITY,
  climbLabelText,
  climbLabels,
  distanceFade,
  labelOpacity,
  lineOfSightClearance,
  occlusionFade,
  POI_PRIORITY,
  poiLabels,
  resolveOverlaps,
  spriteScaleForPixels,
  waypointLabels,
  type LandmarkLabel,
} from './labelModel'
import { externalLabels, setLabelSource, useLabelSources } from './labelSources'

function climb(category: Climb['category'], topEleM: number): Climb {
  return {
    startDistM: 0,
    endDistM: 7000,
    lengthM: 7000,
    startEleM: 1010,
    endEleM: 1650,
    gainM: 640,
    avgGradient: 0.091,
    maxGradient: 0.2,
    score: 64_000,
    category,
    topEleM,
    top: { lon: 6.782, lat: 45.863 },
  }
}

function track(id: string, waypoints?: Track['waypoints']): Track {
  const t = buildTrack({ name: id, source: 'gpx', segments: [{ points: [{ lon: 6.8, lat: 45.9 }] }] })
  t.id = id
  if (waypoints) t.waypoints = waypoints
  return t
}

describe('label texts and sources', () => {
  it('formats climb labels in French', () => {
    expect(climbLabelText(climb('3', 1653.4), 1)).toBe('Montée 2 · cat. 3 · 1\u202f653 m')
    expect(climbLabelText(climb('HC', 2642), 0)).toBe('Montée 1 · HC · 2\u202f642 m')
    expect(climbLabelText(climb(null, 980), 2)).toBe('Montée 3 · 980 m')
  })

  it('anchors climb labels at the top, harder climbs first', () => {
    const labels = climbLabels(track('a'), [climb('4', 1200), climb('1', 1650)])
    expect(labels[1]).toEqual({
      id: 'climb:a:1',
      lon: 6.782,
      lat: 45.863,
      ele: 1650,
      text: 'Montée 2 · cat. 1 · 1\u202f650 m',
      kind: 'climb',
      priority: labels[1].priority,
    })
    expect(labels[1].priority).toBeGreaterThan(labels[0].priority)
    expect(labels[0].priority).toBeGreaterThan(WAYPOINT_PRIORITY)
  })

  it('lists the waypoints of every track', () => {
    const labels = waypointLabels([
      track('a', [{ lon: 6.78, lat: 45.86, ele: 1653, name: 'Col de Voza' }]),
      track('b'),
      track('c', [{ lon: 6.7, lat: 45.8, name: 'Tresse' }]),
    ])
    expect(labels.map((l) => [l.id, l.text, l.ele])).toEqual([
      ['wpt:a:0', 'Col de Voza', 1653],
      ['wpt:c:0', 'Tresse', undefined],
    ])
    expect(labels[1]).not.toHaveProperty('ele')
  })

  it('shows the points of interest placed by hand above every other label, not the blank ones', () => {
    const labels = poiLabels([
      { id: 'poi-1', lon: 6.8, lat: 45.9, name: ' Pique-nique ' },
      { id: 'poi-2', lon: 6.9, lat: 45.9, name: '  ' },
    ])
    expect(labels).toEqual([{ id: 'poi:poi-1', lon: 6.8, lat: 45.9, text: 'Pique-nique', kind: 'poi', priority: POI_PRIORITY }])
    expect(POI_PRIORITY).toBeGreaterThan(climbLabels(track('a'), [climb('HC', 2000)])[0].priority)
  })
})

describe('labelSources', () => {
  afterEach(() => useLabelSources.setState({ sources: {} }))

  it('replaces or removes the labels of a source', () => {
    const peak: LandmarkLabel = { id: 'osm:1', lon: 6.86, lat: 45.83, ele: 4806, text: 'Mont Blanc', kind: 'peak', priority: 200 }
    setLabelSource('osm', [peak])
    setLabelSource('other', [{ ...peak, id: 'other:1' }])
    expect(externalLabels(useLabelSources.getState().sources).map((l) => l.id)).toEqual(['osm:1', 'other:1'])
    setLabelSource('osm', [])
    expect(useLabelSources.getState().sources).not.toHaveProperty('osm')
  })
})

describe('screen-space rules', () => {
  it('fades with distance and behind the relief', () => {
    expect(distanceFade(LABEL_FADE_START_M)).toBe(1)
    expect(distanceFade(LABEL_FADE_END_M)).toBe(0)
    expect(distanceFade((LABEL_FADE_START_M + LABEL_FADE_END_M) / 2)).toBeCloseTo(0.5, 6)
    expect(occlusionFade(Infinity)).toBe(1)
    expect(occlusionFade(0)).toBeCloseTo(0.5, 6)
    expect(occlusionFade(-100)).toBe(0)
  })

  it('sizes sprites in CSS pixels', () => {
    // fov 50°: projection[5] = 1 / tan(25°); a 24 px label in a 1000 px viewport
    const p11 = 1 / Math.tan((25 * Math.PI) / 180)
    expect(spriteScaleForPixels(24, 1000, p11) * p11 * 500).toBeCloseTo(24, 9)
  })

  it('measures the line-of-sight clearance above a ridge, ignoring the end near the label', () => {
    // flat ground at y = 0 with a 100 m ridge at x in [400, 600]
    const ground = (x: number) => (x >= 400 && x <= 600 ? 100 : 0)
    const clearance = (x: number, y: number) => y - ground(x)
    expect(lineOfSightClearance({ x: 0, y: 50, z: 0 }, { x: 1000, y: 50, z: 0 }, clearance)).toBeLessThan(-40)
    expect(lineOfSightClearance({ x: 0, y: 300, z: 0 }, { x: 1000, y: 300, z: 0 }, clearance)).toBeGreaterThan(190)
    // the slope right under the label (last 150 m) never hides it
    expect(lineOfSightClearance({ x: 0, y: 50, z: 0 }, { x: 500, y: 50, z: 0 }, clearance, 48)).toBeGreaterThan(0)
    expect(lineOfSightClearance({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, () => undefined)).toBe(Infinity)
  })

  it('keeps the highest priority among overlapping labels', () => {
    const rect = (left: number, top: number) => ({ left, top, right: left + 100, bottom: top + 30 })
    expect(
      resolveOverlaps([
        { rect: rect(0, 0), priority: 50 },
        { rect: rect(50, 10), priority: 120 },
        { rect: rect(300, 0), priority: 10 },
        { rect: rect(160, 0), priority: 50 },
      ]),
    ).toEqual([false, true, true, true])
  })
})

describe('labels under the overlay cards', () => {
  it('multiplies the view opacity by what the card leaves', () => {
    expect(labelOpacity(0.8, 0)).toBeCloseTo(0.8, 12)
    expect(labelOpacity(1, 0.25)).toBeCloseTo(0.75, 12)
    expect(labelOpacity(0.8, 1)).toBe(0)
    expect(labelOpacity(0.5, -1)).toBe(0.5)
    expect(labelOpacity(0.5, 2)).toBe(0)
  })

  it('fades out with the opening and closing cards, and back in between', () => {
    const overlay = { ...DEFAULT_OVERLAY, enabled: true }
    const at = (progress: number, settings = overlay) => labelOpacity(1, cardOpacityAt(progressTime(progress), settings))
    expect(at(0.02)).toBe(0) // opening card fully shown
    expect(at(0.09)).toBeGreaterThan(0) // opening card fading out
    expect(at(0.09)).toBeLessThan(1)
    expect(at(0.5)).toBe(1)
    expect(at(0.91)).toBeLessThan(1) // closing card fading in
    expect(at(0.99)).toBe(0)
    // no overlay, or no cards: labels untouched
    expect(at(0.02, DEFAULT_OVERLAY)).toBe(1)
    expect(at(0.99, { ...overlay, title: { ...overlay.title, enabled: false }, end: { ...overlay.end, enabled: false } })).toBe(1)
  })
})

/**
 * GPX 1.0 / 1.1 parser built on DOMParser. Namespace-agnostic: elements are matched on
 * `localName`, so Garmin (gpxtpx), Cluetrust and other extension vocabularies all work.
 */
import type { Track, TrackPoint, TrackSegment, Waypoint } from '../core/types'
import { buildTrack, isUtcOffsetMin, stripExtension } from './stats'

type ExtensionField = 'hr' | 'cad' | 'power' | 'temp'

/** Extension element local names (lower-cased) -> TrackPoint field. */
const EXTENSION_FIELDS: Readonly<Record<string, ExtensionField>> = {
  hr: 'hr',
  heartrate: 'hr',
  cad: 'cad',
  cadence: 'cad',
  power: 'power',
  powerinwatts: 'power',
  atemp: 'temp',
  temp: 'temp',
}

function invalid(reason: string): Error {
  return new Error(`Fichier GPX invalide : ${reason}`)
}

function parseXml(text: string): Document {
  const source = text.replace(/^﻿/, '')
  if (source.trim() === '') throw invalid('fichier vide')
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(source, 'application/xml')
  } catch (error) {
    throw invalid(`XML mal formé (${error instanceof Error ? error.message : String(error)})`)
  }
  const parserError = doc.getElementsByTagName('parsererror')[0]
  if (parserError) {
    const detail = (parserError.textContent ?? '').trim().split('\n')[0]
    throw invalid(`XML mal formé${detail ? ` (${detail})` : ''}`)
  }
  return doc
}

function childrenNamed(parent: Element | undefined, localName: string): Element[] {
  if (!parent) return []
  const out: Element[] = []
  for (const child of parent.children) if (child.localName === localName) out.push(child)
  return out
}

function firstChildNamed(parent: Element | undefined, localName: string): Element | undefined {
  if (!parent) return undefined
  for (const child of parent.children) if (child.localName === localName) return child
  return undefined
}

function textOf(element: Element | undefined): string {
  return (element?.textContent ?? '').trim()
}

/** Finite number from an element's text; undefined for empty, blank or non-numeric content (`Number("")` is 0). */
function numberOf(element: Element): number | undefined {
  const text = textOf(element)
  if (text === '') return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined
}

function parseCoordinate(raw: string | null, limit: number): number | undefined {
  if (raw === null || raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : undefined
}

function readExtensions(extensions: Element, point: TrackPoint): void {
  for (const node of extensions.getElementsByTagName('*')) {
    const field = EXTENSION_FIELDS[node.localName.toLowerCase()]
    if (!field || point[field] !== undefined) continue
    const value = numberOf(node)
    if (value !== undefined) point[field] = value
  }
}

/** Parse a <trkpt> / <rtept>; returns undefined when lat/lon are missing or invalid. */
export function parseGpxPoint(element: Element): TrackPoint | undefined {
  const lat = parseCoordinate(element.getAttribute('lat'), 90)
  const lon = parseCoordinate(element.getAttribute('lon'), 180)
  if (lat === undefined || lon === undefined) return undefined
  const point: TrackPoint = { lon, lat }
  for (const child of element.children) {
    switch (child.localName) {
      case 'ele': {
        const ele = numberOf(child)
        if (ele !== undefined) point.ele = ele
        break
      }
      case 'time': {
        const time = Date.parse(textOf(child))
        if (Number.isFinite(time)) point.time = time
        break
      }
      case 'extensions':
        readExtensions(child, point)
        break
    }
  }
  return point
}

/**
 * UTC offset (minutes) of a GPX time written with one ("2025-07-12T09:00:00+02:00"); undefined for UTC ("Z"), no
 * offset, or "+00:00" (often a UTC time written by a tool that ignores the local clock).
 */
export function gpxUtcOffset(text: string): number | undefined {
  const match = /([+-])(\d{2}):?(\d{2})$/.exec(text.trim())
  if (!match) return undefined
  const offset = (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]))
  return offset !== 0 && isUtcOffsetMin(offset) ? offset : undefined
}

function parsePoints(elements: Element[]): TrackPoint[] {
  const points: TrackPoint[] = []
  for (const element of elements) {
    const point = parseGpxPoint(element)
    if (point) points.push(point)
  }
  return points
}

interface TrackCandidate {
  name: string
  segments: TrackSegment[]
  activityType?: string
}

/**
 * Parse a GPX document into tracks.
 * - one Track per <trk>, <trkseg> preserved as segments (empty segments dropped);
 * - when the file has no usable <trk>, each <rte> becomes a single-segment track;
 * - name: <trk><name>, else <metadata><name>, else the file name without extension;
 * - the file's <wpt> become the `waypoints` of the first track (none when the file has no valid <wpt>).
 * Throws `Error('Fichier GPX invalide : …')` on malformed XML or when no point is found.
 */
export function parseGpx(text: string, fileName: string): Track[] {
  const doc = parseXml(text)
  const root = doc.documentElement
  if (!root || root.localName !== 'gpx') throw invalid("l'élément racine n'est pas <gpx>")

  const metadataName = textOf(firstChildNamed(firstChildNamed(root, 'metadata'), 'name'))
  const fallbackName = metadataName || stripExtension(fileName) || 'Trace'

  const candidates: TrackCandidate[] = []

  for (const trk of childrenNamed(root, 'trk')) {
    const segments: TrackSegment[] = []
    for (const trkseg of childrenNamed(trk, 'trkseg')) {
      const points = parsePoints(childrenNamed(trkseg, 'trkpt'))
      if (points.length > 0) segments.push({ points })
    }
    if (segments.length === 0) continue
    const activityType = textOf(firstChildNamed(trk, 'type'))
    candidates.push({
      name: textOf(firstChildNamed(trk, 'name')),
      segments,
      activityType: activityType || undefined,
    })
  }

  if (candidates.length === 0) {
    for (const rte of childrenNamed(root, 'rte')) {
      const points = parsePoints(childrenNamed(rte, 'rtept'))
      if (points.length === 0) continue
      candidates.push({ name: textOf(firstChildNamed(rte, 'name')), segments: [{ points }] })
    }
  }

  if (candidates.length === 0) throw invalid('aucun point trouvé')

  const waypoints = parseWaypoints(childrenNamed(root, 'wpt'))
  // the first time of the file (metadata or point) tells the local clock when it carries an offset
  const firstTime = root.getElementsByTagNameNS('*', 'time')[0]
  const utcOffsetMin = firstTime ? gpxUtcOffset(textOf(firstTime)) : undefined
  return candidates.map((candidate, index) => {
    let name = candidate.name
    if (name === '') name = candidates.length > 1 ? `${fallbackName} (${index + 1})` : fallbackName
    const track = buildTrack({ name, source: 'gpx', segments: candidate.segments, activityType: candidate.activityType })
    if (index === 0 && waypoints.length > 0) track.waypoints = waypoints
    if (utcOffsetMin !== undefined) track.utcOffsetMin = utcOffsetMin
    return track
  })
}

/** <wpt> elements with valid coordinates; unnamed ones are called « Point n » (n = rank in the file). */
export function parseWaypoints(elements: Element[]): Waypoint[] {
  const waypoints: Waypoint[] = []
  elements.forEach((element, index) => {
    const point = parseGpxPoint(element)
    if (!point) return
    const name = textOf(firstChildNamed(element, 'name')) || `Point ${index + 1}`
    const waypoint: Waypoint = { lon: point.lon, lat: point.lat, name }
    if (point.ele !== undefined) waypoint.ele = point.ele
    waypoints.push(waypoint)
  })
  return waypoints
}

#!/usr/bin/env node
/**
 * Generates public/samples/tour-du-mont-blanc-j1.gpx: a synthetic but realistic stage 1 of the
 * Tour du Mont-Blanc (Les Houches -> Col de Voza -> Bionnassay -> Les Contamines-Montjoie).
 *
 * Hand-placed waypoints are joined by a Catmull-Rom spline in a local metric frame, a smooth
 * deterministic lateral wobble + jitter mimics a real trail and GPS noise, walking speed follows
 * Tobler's hiking function, and one point is emitted every 60 s with an hr extension.
 *
 * Usage: node scripts/gen-sample-gpx.mjs   (deterministic: re-running yields the same file)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/samples/tour-du-mont-blanc-j1.gpx')

const START_TIME = Date.parse('2025-07-12T07:00:00Z')
const STEP_S = 60
const TARGET_POINTS = 350

/** [lon, lat, ele, label] — plausible trail positions along the classic TMB stage 1. */
const WAYPOINTS = [
  [6.7986, 45.8911, 1010, 'Les Houches'],
  [6.7935, 45.8885, 1085, ''],
  [6.7905, 45.8858, 1165, 'Sous le Prarion'],
  [6.787, 45.8822, 1270, ''],
  [6.7845, 45.8782, 1385, 'Chalets du Délevret'],
  [6.7832, 45.874, 1490, ''],
  [6.7822, 45.8695, 1575, ''],
  [6.7818, 45.8662, 1630, ''],
  [6.782, 45.8631, 1653, 'Col de Voza'],
  [6.778, 45.8612, 1595, ''],
  [6.7735, 45.8588, 1505, ''],
  [6.769, 45.8565, 1420, 'Le Crozat'],
  [6.7643, 45.8542, 1335, 'Bionnassay'],
  [6.7585, 45.8512, 1282, ''],
  [6.753, 45.8482, 1245, 'La Villette'],
  [6.7478, 45.8443, 1205, 'Le Champel'],
  [6.7425, 45.8402, 1192, ''],
  [6.7385, 45.8362, 1175, 'Tresse'],
  [6.7348, 45.832, 1158, ''],
  [6.7318, 45.828, 1152, 'Le Pontet'],
  [6.7292, 45.8248, 1160, ''],
  [6.7273, 45.8225, 1167, 'Les Contamines-Montjoie'],
]

// --- local metric frame -----------------------------------------------------------------
const LAT0 = WAYPOINTS[0][1]
const M_PER_DEG_LAT = 111320
const M_PER_DEG_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180)
const toXY = (lon, lat) => [(lon - WAYPOINTS[0][0]) * M_PER_DEG_LON, (lat - LAT0) * M_PER_DEG_LAT]
const toLonLat = (x, y) => [WAYPOINTS[0][0] + x / M_PER_DEG_LON, LAT0 + y / M_PER_DEG_LAT]

// --- Catmull-Rom spline through the waypoints (x, y, ele) --------------------------------
function crom(a, b, c, d, t) {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
}

const ctrl = WAYPOINTS.map(([lon, lat, ele]) => [...toXY(lon, lat), ele])
const SAMPLES_PER_SEGMENT = 200
const spline = []
for (let i = 0; i < ctrl.length - 1; i++) {
  const p0 = ctrl[Math.max(0, i - 1)]
  const p1 = ctrl[i]
  const p2 = ctrl[i + 1]
  const p3 = ctrl[Math.min(ctrl.length - 1, i + 2)]
  const last = i === ctrl.length - 2
  for (let k = 0; k < SAMPLES_PER_SEGMENT + (last ? 1 : 0); k++) {
    const t = k / SAMPLES_PER_SEGMENT
    spline.push([crom(p0[0], p1[0], p2[0], p3[0], t), crom(p0[1], p1[1], p2[1], p3[1], t), crom(p0[2], p1[2], p2[2], p3[2], t)])
  }
}

// --- lateral wobble (trail sinuosity + GPS jitter), deterministic -------------------------
// Long wavelengths = switchbacks (scaled up on steep ground), short ones = GPS jitter.
const SINUOSITY = [
  [62, 310, 0.4],
  [34, 175, 2.1],
  [12, 95, 4.0],
]
const JITTER = [
  [2.5, 31, 1.3],
  [1.5, 13, 5.2],
]
const sumSines = (terms, s) => terms.reduce((acc, [a, l, phi]) => acc + a * Math.sin((2 * Math.PI * s) / l + phi), 0)
const eleNoise = (s) => 1.2 * Math.sin((2 * Math.PI * s) / 23 + 0.7) + 0.8 * Math.sin((2 * Math.PI * s) / 41 + 2.9)

// cumulative distance along the raw spline, then apply the wobble along the normal
const path = []
let s = 0
for (let i = 0; i < spline.length; i++) {
  const [x, y, ele] = spline[i]
  if (i > 0) s += Math.hypot(x - spline[i - 1][0], y - spline[i - 1][1])
  const prev = spline[Math.max(0, i - 1)]
  const next = spline[Math.min(spline.length - 1, i + 1)]
  const dx = next[0] - prev[0]
  const dy = next[1] - prev[1]
  const len = Math.hypot(dx, dy) || 1
  const rawGrade = Math.abs((next[2] - prev[2]) / len)
  const switchbacks = Math.min(1.6, 0.45 + 9 * rawGrade)
  const off = sumSines(SINUOSITY, s) * switchbacks + sumSines(JITTER, s)
  path.push({ x: x + (-dy / len) * off, y: y + (dx / len) * off, ele: ele + eleNoise(s) })
}
// re-measure distance on the wobbled path
let total = 0
path[0].s = 0
for (let i = 1; i < path.length; i++) {
  total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
  path[i].s = total
}

function sampleAt(dist) {
  let lo = 0
  let hi = path.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (path[mid].s <= dist) lo = mid
    else hi = mid
  }
  const a = path[lo]
  const b = path[hi]
  const t = b.s === a.s ? 0 : (dist - a.s) / (b.s - a.s)
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ele: a.ele + (b.ele - a.ele) * t }
}

/** Grade over a 60 m window centred on `dist` (dimensionless). */
function gradeAt(dist) {
  const d0 = Math.max(0, dist - 30)
  const d1 = Math.min(total, dist + 30)
  return (sampleAt(d1).ele - sampleAt(d0).ele) / Math.max(1, d1 - d0)
}

/** Tobler's hiking function, m/s. */
const tobler = (grade) => (6 * Math.exp(-3.5 * Math.abs(grade + 0.05))) / 3.6

// --- walk the route: first pass to calibrate the pace to ~TARGET_POINTS, second pass emits --
function walk(speedScale) {
  const out = []
  let dist = 0
  let hr = 96
  let i = 0
  while (dist < total) {
    const grade = gradeAt(dist)
    const p = sampleAt(dist)
    const effort = Math.min(1, Math.max(0, (grade + 0.03) / 0.22))
    const targetHr = 96 + 50 * effort + 3 * Math.sin(i / 7)
    hr += (targetHr - hr) * 0.25
    out.push({ ...p, time: START_TIME + i * STEP_S * 1000, hr: Math.round(Math.min(150, Math.max(90, hr))) })
    dist += tobler(grade) * speedScale * STEP_S
    i++
  }
  const end = sampleAt(total)
  out.push({ ...end, time: START_TIME + i * STEP_S * 1000, hr: Math.round(Math.max(90, hr - 4)) })
  return out
}

const firstPass = walk(1)
const points = walk(firstPass.length / TARGET_POINTS)

// --- stats for the console (measured on the emitted points, like the parser does) --------------
function haversineM(a, b) {
  const rad = Math.PI / 180
  const s1 = Math.sin(((b.lat - a.lat) * rad) / 2)
  const s2 = Math.sin(((b.lon - a.lon) * rad) / 2)
  const h = s1 * s1 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * s2 * s2
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h))
}
for (const p of points) [p.lon, p.lat] = toLonLat(p.x, p.y)
let emittedDistance = 0
let ascent = 0
let descent = 0
let ref = points[0].ele
for (let i = 0; i < points.length; i++) {
  if (i > 0) emittedDistance += haversineM(points[i - 1], points[i])
  const d = points[i].ele - ref
  if (Math.abs(d) > 3) {
    if (d > 0) ascent += d
    else descent -= d
    ref = points[i].ele
  }
}

// --- GPX output --------------------------------------------------------------------------------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const lines = []
lines.push('<?xml version="1.0" encoding="UTF-8"?>')
lines.push(
  '<gpx version="1.1" creator="OpenFlyover sample generator (scripts/gen-sample-gpx.mjs)"',
  '     xmlns="http://www.topografix.com/GPX/1/1"',
  '     xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"',
  '     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
  '     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
)
lines.push('  <metadata>')
lines.push('    <name>Tour du Mont-Blanc — Étape 1 : Les Houches → Les Contamines</name>')
lines.push('    <desc>Trace synthétique réaliste générée pour la démonstration (aucune donnée réelle).</desc>')
lines.push(`    <time>${new Date(START_TIME).toISOString().replace('.000Z', 'Z')}</time>`)
lines.push('  </metadata>')
for (const [lon, lat, ele, label] of WAYPOINTS) {
  if (!label) continue
  lines.push(`  <wpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><ele>${ele}</ele><name>${esc(label)}</name></wpt>`)
}
lines.push('  <trk>')
lines.push('    <name>Tour du Mont-Blanc — Étape 1 : Les Houches → Les Contamines</name>')
lines.push('    <type>hiking</type>')
lines.push('    <trkseg>')
for (const p of points) {
  lines.push(`      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">`)
  lines.push(`        <ele>${p.ele.toFixed(1)}</ele>`)
  lines.push(`        <time>${new Date(p.time).toISOString().replace('.000Z', 'Z')}</time>`)
  lines.push(`        <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`)
  lines.push('      </trkpt>')
}
lines.push('    </trkseg>')
lines.push('  </trk>')
lines.push('</gpx>')
lines.push('')

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, lines.join('\n'), 'utf8')

const hours = ((points.length - 1) * STEP_S) / 3600
console.log(
  `${OUT}\n  ${points.length} points, ${(emittedDistance / 1000).toFixed(2)} km (path ${(total / 1000).toFixed(2)} km), D+ ${ascent.toFixed(0)} m, D- ${descent.toFixed(0)} m, ${hours.toFixed(2)} h`,
)

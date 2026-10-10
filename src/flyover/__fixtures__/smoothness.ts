/**
 * Test helpers of the camera smoothness measures (cameraSmoothness.test.ts): a long raid-like synthetic outing, terrain
 * samplers, and the per-frame motion of the film camera (speed, acceleration, jerk, turn rate of the look direction).
 */
import type { Vector3 } from 'three'
import type { Track, TrackPoint } from '../../core/types'
import { filmClockFor } from '../../film/clock'
import { DEFAULT_FILM, type Film } from '../../film/model'
import { createLocalFrame } from '../../geo/ellipsoid'
import { centroid } from '../../geo/lonLat'
import { buildTrack } from '../../import/stats'
import type { HeightSampler } from '../../scene/TrackLines'
import { headingAt, headingWindowM } from '../camera'
import type { CameraSettings } from '../cameraSettings'
import { computeFilmView } from '../filmCamera'
import { DEFAULT_PACING } from '../pacing'
import { trackPathOf } from '../path'

const M_PER_DEG = 111_320
const DEG = Math.PI / 180

/** Deterministic pseudo-random numbers in [0, 1). */
function random(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const ORIGIN = { lon: 9.0, lat: 42.15 }
const cosLat = Math.cos(ORIGIN.lat * DEG)
const toLonLat = (x: number, y: number) => ({ lon: ORIGIN.lon + x / (M_PER_DEG * cosLat), lat: ORIGIN.lat + y / M_PER_DEG })
const toXY = (lon: number, lat: number) => ({ x: (lon - ORIGIN.lon) * M_PER_DEG * cosLat, y: (lat - ORIGIN.lat) * M_PER_DEG })

/** Mountains (±500 m over ~8 km), hills (±200 m over ~1.5 km) and bumps (±15 m over ~150 m); metres. */
export function hillyHeight(lon: number, lat: number): number {
  const { x, y } = toXY(lon, lat)
  return (
    700 +
    500 * Math.sin(x / 7_000) * Math.cos(y / 9_000) +
    200 * Math.sin(x / 1_300 + y / 1_700) +
    15 * Math.sin(x / 150) * Math.cos(y / 170)
  )
}

export const hillySampler: HeightSampler = (lon, lat) => hillyHeight(lon, lat)

/**
 * A ≈ `lengthKm` multi-day raid like the ones recorded by trackers, without elevation: winding trails, coastal
 * zigzags, mountain hairpins and short out-and-back legs, one point every 80–100 s (≈ 60 m apart, up to ~2 km after a
 * signal loss), and `nights` rests of 1–5 h where the position jitters by a few metres and hops ~150 m away and back.
 */
export function curvyOuting(lengthKm = 540, nights = 8, seed = 7): Track {
  const rnd = random(seed)
  // the route, 1 m steps
  const xs: number[] = [0]
  const ys: number[] = [0]
  let x = 0
  let y = 0
  let heading = 0
  const total = lengthKm * 1000
  const step = (k: number) => {
    heading += k
    x += Math.cos(heading)
    y += Math.sin(heading)
    xs.push(x)
    ys.push(y)
  }
  while (xs.length < total) {
    const kind = rnd() < 0.1 ? 3 : Math.floor(rnd() * 3)
    const lengthM = 3_000 + rnd() * 12_000
    // keep within ~60 km of the start
    const back = () => (Math.hypot(x, y) > 60_000 ? Math.sign(Math.sin(Math.atan2(-y, -x) - heading)) / 2_000 : 0)
    if (kind === 0) {
      const wave = 300 + rnd() * 1_500
      const amp = 1 / (60 + rnd() * 300)
      for (let s = 0; s < lengthM; s++) step(back() + amp * Math.sin((2 * Math.PI * s) / wave))
    } else if (kind === 1) {
      // coastal zigzag: alternating bends of 60–120° at radius 60–120 m
      for (let s = 0, side = 1; s < lengthM; side = -side) {
        const radius = 60 + rnd() * 60
        const arc = (60 + rnd() * 60) * DEG * radius
        for (let a = 0; a < arc; a++, s++) step(back() + side / radius)
      }
    } else if (kind === 2) {
      // hairpins: legs of 100–300 m, 180° turns at radius 15–30 m
      for (let s = 0, side = 1; s < lengthM; side = -side) {
        const leg = 100 + rnd() * 200
        for (let a = 0; a < leg; a++, s++) step(back())
        const radius = 15 + rnd() * 15
        for (let a = 0; a < Math.PI * radius; a++, s++) step(side / radius)
      }
    } else {
      // out-and-back to a checkpoint 0.5–3 km away, back 15 m aside
      const leg = 500 + rnd() * 2_500
      for (let a = 0; a < leg; a++) step(back())
      for (let a = 0; a < Math.PI * 7.5; a++) step(1 / 7.5)
      for (let a = 0; a < leg; a++) step(0)
    }
  }
  // the recording
  const points: TrackPoint[] = []
  let t = Date.parse('2026-10-01T02:00:00Z')
  const restAt = Array.from({ length: nights }, (_, k) => Math.floor(((k + 0.5) / nights) * total))
  let rest = 0
  const record = (i: number, noiseM: number) => {
    const at = toLonLat(xs[i] + (rnd() - 0.5) * 2 * noiseM, ys[i] + (rnd() - 0.5) * 2 * noiseM)
    points.push({ lon: at.lon, lat: at.lat, time: t })
  }
  for (let i = 0; i < total; ) {
    record(i, 4)
    if (rest < restAt.length && i >= restAt[rest]) {
      const restS = 3_600 + rnd() * 4 * 3_600
      for (let s = 0; s < restS; s += 90) {
        t += 90_000
        const hop = rnd() < 0.03
        if (hop) {
          const angle = rnd() * 2 * Math.PI
          const at = toLonLat(xs[i] + 150 * Math.cos(angle), ys[i] + 150 * Math.sin(angle))
          points.push({ lon: at.lon, lat: at.lat, time: t })
        } else record(i, rnd() < 0.5 ? 0 : 6)
      }
      rest++
    }
    // 80–100 s at 0.4–1 m/s on foot; now and then a signal loss of 10–50 min
    const dtS = rnd() < 0.01 ? 600 + rnd() * 2_400 : 80 + rnd() * 20
    i += Math.max(1, Math.round(dtS * (0.4 + 0.6 * rnd())))
    t += dtS * 1000
  }
  return buildTrack({ name: 'raid', source: 'gpx', segments: [{ points }] })
}

/** Track of a GPX text (trkpt with lat, lon, ele and time), without a DOM. */
export function gpxTrack(text: string): Track {
  const points: TrackPoint[] = []
  for (const m of text.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)">([\s\S]*?)<\/trkpt>/g)) {
    const ele = /<ele>([^<]+)<\/ele>/.exec(m[3])
    const time = /<time>([^<]+)<\/time>/.exec(m[3])
    points.push({ lat: Number(m[1]), lon: Number(m[2]), ele: ele ? Number(ele[1]) : undefined, time: time ? Date.parse(time[1]) : undefined })
  }
  return buildTrack({ name: 'sample', source: 'gpx', segments: [{ points }] })
}

export interface Placement {
  position: Vector3
  target: Vector3
}

export interface MotionStats {
  /** camera speed, acceleration, jerk (m/s, m/s², m/s³ of film time) */
  speed: number[]
  accel: number[]
  jerk: number[]
  /** vertical jerk of the camera (m/s³) */
  climbJerk: number[]
  /** turn rate and angular acceleration of the look direction (deg/s, deg/s²) */
  turn: number[]
  turnAccel: number[]
}

/** Motion of the camera over placements one frame (`dtS` of film time) apart. */
export function motionOf(frames: readonly Placement[], dtS: number): MotionStats {
  const out: MotionStats = { speed: [], accel: [], jerk: [], climbJerk: [], turn: [], turnAccel: [] }
  const vel: Vector3[] = []
  const omega: Vector3[] = []
  for (let i = 0; i + 1 < frames.length; i++) {
    vel.push(frames[i + 1].position.clone().sub(frames[i].position).divideScalar(dtS))
    const a = frames[i].target.clone().sub(frames[i].position).normalize()
    const b = frames[i + 1].target.clone().sub(frames[i + 1].position).normalize()
    const axis = a.clone().cross(b)
    const angle = Math.atan2(axis.length(), a.dot(b))
    omega.push(axis.normalize().multiplyScalar(angle / dtS))
  }
  for (let i = 0; i < vel.length; i++) {
    out.speed.push(vel[i].length())
    out.turn.push(omega[i].length() / DEG)
    if (i + 1 >= vel.length) continue
    out.accel.push(vel[i + 1].clone().sub(vel[i]).length() / dtS)
    out.turnAccel.push(omega[i + 1].clone().sub(omega[i]).length() / dtS / DEG)
    if (i + 2 >= vel.length) continue
    const jerk = vel[i + 2].clone().sub(vel[i + 1]).sub(vel[i + 1].clone().sub(vel[i])).divideScalar(dtS * dtS)
    out.jerk.push(jerk.length())
    out.climbJerk.push(Math.abs(jerk.y))
  }
  return out
}

/** `q` quantile (0..1) of `values`. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]
}

export interface FlownFilm extends MotionStats {
  /** angle between the look direction and the track's direction at the marker, out of the stops (degrees) */
  lag: number[]
}

/**
 * The flight of the film of `track` (default film opening on « Depuis la région », no landmark) flown at `fps` with
 * `camera`, `durationS` of flyover: the camera's motion frame by frame (film time).
 */
export function flyFilm(track: Track, durationS: number, sample: HeightSampler, camera: CameraSettings, fps: number): FlownFilm {
  const film: Film = { ...DEFAULT_FILM, opening: { style: 'situation', durationS: 10 } }
  const clock = filmClockFor({ track, film, durationS, pacing: DEFAULT_PACING, landmarks: [] })
  const path = trackPathOf(track)
  const { lon, lat } = centroid(track.bounds)
  const frame = createLocalFrame(lon, lat)
  const w = headingWindowM(path, camera)
  const frames: Placement[] = []
  const lag: number[] = []
  const options = { exaggeration: 1, liftM: 3, camera, durationS, aspect: 16 / 9 }
  for (let t = clock.openingS; t <= clock.openingS + clock.flightS; t += 1 / fps) {
    const progress = clock.progressAtTime(t)
    const view = computeFilmView(path, clock, t, progress, frame, sample, options)
    frames.push({ position: view.position, target: view.target })
    if (clock.stateAt(t).phase !== 'flight') continue
    const travel = headingAt(path, progress * path.lengthM, w, frame)
    const look = view.target.clone().sub(view.position).setY(0).normalize()
    lag.push(Math.acos(Math.max(-1, Math.min(1, look.dot(travel)))) / DEG)
  }
  return { ...motionOf(frames, 1 / fps), lag }
}

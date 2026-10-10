import { describe, expect, it } from 'vitest'
import sampleGpx from '../../public/samples/tour-du-mont-blanc-j1.gpx?raw'
import { CAMERA_STYLES, DEFAULT_CAMERA } from './cameraSettings'
import { curvyOuting, flyFilm, gpxTrack, hillySampler, quantile } from './__fixtures__/smoothness'

/**
 * Smoothness of the film camera over whole flights (default settings, hilly terrain, 30 frames per second of film): a
 * 540 km raid recorded every ~90 s flown in 4 min 30 s (2 km of track per second, sparse corners, out-and-backs, GPS
 * stars at the rests), and the Tour du Mont-Blanc sample in 60 s. Turn rate (deg/s) and angular acceleration (deg/s²)
 * of the look direction, vertical jerk of the camera (m/s³).
 */
const FPS = 30
const raid = curvyOuting()
const sample = gpxTrack(sampleGpx)
const max = (values: number[]) => values.reduce((a, b) => Math.max(a, b), 0)

describe('camera smoothness', () => {
  it('a 540 km raid in 4 min 30 s, chase: no swing around, no jolt', () => {
    const film = flyFilm(raid, 270, hillySampler, DEFAULT_CAMERA, FPS)
    expect(quantile(film.turn, 0.95)).toBeLessThan(60)
    expect(max(film.turn)).toBeLessThan(120)
    expect(quantile(film.turnAccel, 0.99)).toBeLessThan(150)
    expect(max(film.turnAccel)).toBeLessThan(600)
  })

  it('every style keeps the raid calm', { timeout: 20_000 }, () => {
    for (const style of CAMERA_STYLES) {
      const film = flyFilm(raid, 270, hillySampler, { ...DEFAULT_CAMERA, style }, FPS)
      expect(max(film.turn), style).toBeLessThan(150)
      expect(quantile(film.turnAccel, 0.99), style).toBeLessThan(250)
    }
  })

  it('the short sample stays close behind the marker', () => {
    const film = flyFilm(sample, 60, hillySampler, DEFAULT_CAMERA, FPS)
    expect(max(film.turn)).toBeLessThan(40)
    expect(quantile(film.turnAccel, 0.99)).toBeLessThan(150)
    // not sluggish: the view keeps to the direction of travel
    expect(quantile(film.lag, 0.5)).toBeLessThan(10)
    expect(quantile(film.lag, 0.95)).toBeLessThan(25)
  })
})

import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { autoExposureEv, DAYLIGHT_EXPOSURE, nightFillIntensity, NIGHT_FILL_INTENSITY, sceneExposure, sunElevation } from './exposure'

const deg = (d: number) => (d * Math.PI) / 180

describe('sunElevation', () => {
  it('is the angle between the sun direction and the local horizon', () => {
    const up = new Vector3(0, 0, 1)
    expect(sunElevation(new Vector3(0, 0, 1), up)).toBeCloseTo(Math.PI / 2, 9)
    expect(sunElevation(new Vector3(1, 0, 0), up)).toBeCloseTo(0, 9)
    expect(sunElevation(new Vector3(Math.cos(deg(30)), 0, -Math.sin(deg(30))), up)).toBeCloseTo(deg(-30), 9)
  })
})

describe('autoExposureEv', () => {
  it('adds nothing in daylight and opens up through dusk to night', () => {
    expect(autoExposureEv(deg(45))).toBe(0)
    expect(autoExposureEv(deg(10))).toBe(0)
    expect(autoExposureEv(deg(2))).toBeCloseTo(1.5, 9)
    expect(autoExposureEv(deg(-6))).toBeCloseTo(3, 9)
    expect(autoExposureEv(deg(-12))).toBeCloseTo(4.5, 9)
    expect(autoExposureEv(deg(-18))).toBe(6)
    expect(autoExposureEv(deg(-60))).toBe(6)
  })

  it('never decreases while the sun goes down', () => {
    let previous = -Infinity
    for (let d = 30; d >= -30; d -= 0.5) {
      const ev = autoExposureEv(deg(d))
      expect(ev).toBeGreaterThanOrEqual(previous)
      previous = ev
    }
  })
})

describe('sceneExposure', () => {
  it('scales the daylight exposure by the automatic and user stops', () => {
    expect(sceneExposure(deg(40), 0)).toBe(DAYLIGHT_EXPOSURE)
    expect(sceneExposure(deg(40), 1)).toBe(DAYLIGHT_EXPOSURE * 2)
    expect(sceneExposure(deg(40), -2)).toBe(DAYLIGHT_EXPOSURE / 4)
    expect(sceneExposure(deg(-18), 0)).toBe(DAYLIGHT_EXPOSURE * 64)
  })
})

describe('nightFillIntensity', () => {
  it('is off while the sun is up and full from civil dusk', () => {
    expect(nightFillIntensity(deg(5))).toBe(0)
    expect(nightFillIntensity(deg(0))).toBe(0)
    expect(nightFillIntensity(deg(-3))).toBeCloseTo(NIGHT_FILL_INTENSITY / 2, 12)
    expect(nightFillIntensity(deg(-30))).toBe(NIGHT_FILL_INTENSITY)
  })
})

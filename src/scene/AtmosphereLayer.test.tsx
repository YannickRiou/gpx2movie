import { describe, expect, it, vi } from 'vitest'

vi.mock('@react-three/fiber', () => ({ useFrame: vi.fn(), useThree: vi.fn() }))
vi.mock('@react-three/postprocessing', () => ({}))
vi.mock('@takram/three-atmosphere/r3f', () => ({}))
vi.mock('../terrain/engine', () => ({ createTerrainEngine: vi.fn() }))

const { solarHourToDate } = await import('./AtmosphereLayer')

describe('solarHourToDate', () => {
  const day = Date.UTC(2026, 6, 14, 17, 42) // any time of the day

  it('is the UTC hour on the Greenwich meridian', () => {
    expect(solarHourToDate(day, 0, 10.5).toISOString()).toBe('2026-07-14T10:30:00.000Z')
  })

  it('shifts by 4 minutes per degree of longitude', () => {
    // Chamonix ~6.87° E: solar noon ~27.5 min before 12:00 UTC
    expect(solarHourToDate(day, 6.87, 12).getTime()).toBe(Date.UTC(2026, 6, 14, 12) - 6.87 * 4 * 60_000)
    expect(solarHourToDate(day, -90, 12).toISOString()).toBe('2026-07-14T18:00:00.000Z')
  })
})

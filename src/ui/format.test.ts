import { describe, expect, it } from 'vitest'
import {
  formatPercent,
  formatSecondsShort,
  formatAscent,
  formatClock,
  formatDistance,
  formatDistanceGap,
  formatDuration,
  formatNumber,
  formatTimeGap,
  formatTrackSummary,
} from './format'

const NNBSP = ' '

describe('formatNumber', () => {
  it('uses a decimal comma and groups thousands', () => {
    expect(formatNumber(12.4, 1)).toBe('12,4')
    expect(formatNumber(1234567)).toBe(`1${NNBSP}234${NNBSP}567`)
    expect(formatNumber(999)).toBe('999')
    expect(formatNumber(-1500.5, 1)).toBe(`-1${NNBSP}500,5`)
    expect(formatNumber(-0.04, 1)).toBe('0,0')
    expect(formatNumber(Number.NaN)).toBe('–')
  })
})

describe('formatDistance', () => {
  it('shows metres under 1 km and km with one decimal above', () => {
    expect(formatDistance(850)).toBe('850 m')
    expect(formatDistance(12400)).toBe('12,4 km')
    expect(formatDistance(12449)).toBe('12,4 km')
    expect(formatDistance(1000)).toBe('1,0 km')
    expect(formatDistance(999.6)).toBe('1,0 km')
    expect(formatDistance(999.4)).toBe('999 m')
    expect(formatDistance(123456)).toBe('123,5 km')
    expect(formatDistance(-1)).toBe('–')
  })
})

describe('formatAscent', () => {
  it('rounds to whole metres', () => {
    expect(formatAscent(980)).toBe('980 m')
    expect(formatAscent(979.6)).toBe('980 m')
    expect(formatAscent(1250)).toBe(`1${NNBSP}250 m`)
    expect(formatAscent(-3)).toBe('0 m')
  })
})

describe('formatDuration', () => {
  it('formats hours with zero-padded minutes, or minutes only', () => {
    expect(formatDuration(4 * 3600 + 12 * 60)).toBe('4 h 12')
    expect(formatDuration(35 * 60)).toBe('35 min')
    expect(formatDuration(3600 + 5 * 60 + 40)).toBe('1 h 06')
    expect(formatDuration(0)).toBe('0 min')
    expect(formatDuration(59 * 60 + 50)).toBe('1 h 00')
    expect(formatDuration(-5)).toBe('–')
  })
})

describe('formatTrackSummary', () => {
  it('joins distance, ascent and duration with middle dots', () => {
    expect(
      formatTrackSummary({ distanceM: 12400, ascentM: 980, descentM: 900, durationS: 15120, pointCount: 10 }),
    ).toBe('12,4 km · D+ 980 m · 4 h 12')
  })

  it('omits the duration when unknown', () => {
    expect(formatTrackSummary({ distanceM: 500, ascentM: 10, descentM: 0, pointCount: 2 })).toBe('500 m · D+ 10 m')
  })
})

describe('formatTimeGap', () => {
  it('signs the gap (+ behind, − ahead) in seconds, minutes and seconds, or hours and minutes', () => {
    expect(formatTimeGap(80_000)).toBe('+1 min 20')
    expect(formatTimeGap(-45_000)).toBe('−45 s')
    expect(formatTimeGap(125_400)).toBe('+2 min 05')
    expect(formatTimeGap(-3_900_000)).toBe('−1 h 05')
    expect(formatTimeGap(3_599_600)).toBe('+1 h 00')
    expect(formatTimeGap(400)).toBe('0 s')
    expect(formatTimeGap(Number.NaN)).toBe('–')
  })
})

describe('formatDistanceGap', () => {
  it('signs the gap (− behind, + ahead) in metres or kilometres', () => {
    expect(formatDistanceGap(-350)).toBe('−350 m')
    expect(formatDistanceGap(1234)).toBe('+1,2 km')
    expect(formatDistanceGap(0.3)).toBe('0 m')
    expect(formatDistanceGap(Number.POSITIVE_INFINITY)).toBe('–')
  })
})

describe('formatPercent / formatSecondsShort', () => {
  it('formats a share and seconds with only the decimals they need', () => {
    expect(formatPercent(0.35)).toBe('35 %')
    expect(formatSecondsShort(1.5)).toBe('1,5 s')
    expect(formatSecondsShort(1.25)).toBe('1,25 s')
    expect(formatSecondsShort(2)).toBe('2 s')
  })
})

describe('formatClock', () => {
  it('reads the browser clock, minutes zero-padded', () => {
    expect(formatClock(new Date(2026, 9, 10, 8, 5).getTime())).toBe('8 h 05')
    expect(formatClock(new Date(2026, 9, 10, 14, 32).getTime())).toBe('14 h 32')
  })
})

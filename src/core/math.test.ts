import { describe, expect, it } from 'vitest'
import { clamp, firstIndexAtOrAbove, lastIndexAtOrBelow } from './math'

describe('clamp', () => {
  it('bounds a value', () => {
    expect(clamp(-1, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
    expect(clamp(2, 0, 1)).toBe(1)
  })
})

describe('binary searches', () => {
  const sorted = [0, 10, 10, 20]

  it('lastIndexAtOrBelow: last element ≤ value, -1 when none', () => {
    expect(lastIndexAtOrBelow(sorted, -1)).toBe(-1)
    expect(lastIndexAtOrBelow(sorted, 0)).toBe(0)
    expect(lastIndexAtOrBelow(sorted, 10)).toBe(2)
    expect(lastIndexAtOrBelow(sorted, 15)).toBe(2)
    expect(lastIndexAtOrBelow(sorted, 99)).toBe(3)
    expect(lastIndexAtOrBelow(sorted, Number.NaN)).toBe(-1)
    expect(lastIndexAtOrBelow([], 1)).toBe(-1)
  })

  it('firstIndexAtOrAbove: first element ≥ value, length when none', () => {
    expect(firstIndexAtOrAbove(sorted, -1)).toBe(0)
    expect(firstIndexAtOrAbove(sorted, 10)).toBe(1)
    expect(firstIndexAtOrAbove(sorted, 15)).toBe(3)
    expect(firstIndexAtOrAbove(sorted, 99)).toBe(4)
    expect(firstIndexAtOrAbove(sorted, Number.NaN)).toBe(4)
  })
})

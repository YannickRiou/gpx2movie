import { describe, expect, it } from 'vitest'
import { BADGE_INK, BADGE_WHITE, drawBadge, luminance, readableInk, squareCrop } from './markerBadge'
import { MARKER_FIGURE_PATHS } from './markerFigures'

/** 2D context recording the calls drawBadge makes. */
function recordingContext() {
  const calls: string[] = []
  const ctx = new Proxy(
    {},
    {
      get: (_, name: string) => (...args: unknown[]) => calls.push(`${name}(${args.map(String).join(',')})`),
      set: (_, name: string, value: unknown) => (calls.push(`${name}=${String(value)}`), true),
    },
  ) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

const fakePath = (d: string) => d as unknown as Path2D

describe('marker badge', () => {
  it('picks ink on light colours and white on dark ones', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 6)
    expect(luminance('#000000')).toBe(0)
    expect(readableInk('#FFC53D')).toBe(BADGE_INK)
    expect(readableInk(BADGE_INK)).toBe(BADGE_WHITE)
  })

  it('crops the centred square of a picture', () => {
    expect(squareCrop(400, 300)).toEqual({ x: 50, y: 0, side: 300 })
    expect(squareCrop(100, 160)).toEqual({ x: 0, y: 30, side: 100 })
  })

  it('draws a ball with its halo as two discs', () => {
    const { ctx, calls } = recordingContext()
    drawBadge(ctx, 64, { kind: 'disc', fill: '#5BC0EB', ring: BADGE_INK, ringWidth: 0.25 })
    expect(calls.filter((c) => c.startsWith('arc('))).toHaveLength(2)
    expect(calls.filter((c) => c.startsWith('fillStyle='))).toEqual([`fillStyle=${BADGE_INK}`, 'fillStyle=#5BC0EB'])
  })

  it('strokes every path of the figure, mirrored when asked', () => {
    const plain = recordingContext()
    drawBadge(plain.ctx, 128, { kind: 'figure', figure: 'cycliste', fill: BADGE_INK, ring: BADGE_WHITE, mirrored: false }, fakePath)
    expect(plain.calls.filter((c) => c.startsWith('stroke('))).toHaveLength(MARKER_FIGURE_PATHS.cycliste.length)
    expect(plain.calls).toContain(`strokeStyle=${BADGE_WHITE}`)
    expect(plain.calls).not.toContain('scale(-1,1)')

    const mirrored = recordingContext()
    drawBadge(mirrored.ctx, 128, { kind: 'figure', figure: 'cycliste', fill: BADGE_INK, ring: BADGE_WHITE, mirrored: true }, fakePath)
    expect(mirrored.calls).toContain('scale(-1,1)')
  })
})

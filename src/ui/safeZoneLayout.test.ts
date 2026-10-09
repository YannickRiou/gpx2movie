import { describe, expect, it } from 'vitest'
import { VIDEO_ASPECTS } from '../export/schedule'
import { phoneInterfaceOver, safeZones } from './safeZoneLayout'
import type { FrameBox } from './safeZoneLayout'

const insideFrame = (b: FrameBox) =>
  b.left >= 0 && b.top >= 0 && b.width > 0 && b.height > 0 && b.left + b.width <= 1 + 1e-12 && b.top + b.height <= 1 + 1e-12

describe('safeZones', () => {
  it('16:9: action-safe and title-safe margins, centred, nothing shaded', () => {
    const { guides, covered } = safeZones('16:9')
    expect(covered).toEqual([])
    expect(guides.map((g) => g.label)).toEqual(['Action 93 %', 'Titres 90 %'])
    const [action, title] = guides.map((g) => g.box)
    expect(action.left).toBeCloseTo(0.035, 12)
    expect(action.width).toBeCloseTo(0.93, 12)
    expect(title.top).toBeCloseTo(0.05, 12)
    expect(title.left + title.width / 2).toBeCloseTo(0.5, 12)
  })

  it('9:16: the top bar, the buttons on the right and the caption at the bottom', () => {
    const { guides, covered } = safeZones('9:16')
    expect(guides).toEqual([])
    const byLabel = Object.fromEntries(covered.map((c) => [c.label, c.box]))
    expect(byLabel['Interface du haut']).toMatchObject({ left: 0, top: 0, width: 1 })
    expect(byLabel['Légende et musique'].top + byLabel['Légende et musique'].height).toBeCloseTo(1, 12)
    const buttons = byLabel['Boutons']
    expect(buttons.left + buttons.width).toBeCloseTo(1, 12)
    // the buttons sit between the top bar and the caption
    expect(buttons.top).toBeGreaterThan(byLabel['Interface du haut'].height)
    expect(buttons.top + buttons.height).toBeCloseTo(byLabel['Légende et musique'].top, 12)
  })

  it('4:5, shown full width in the middle of the phone: below the top bar, less of the caption', () => {
    const covered = safeZones('4:5').covered
    const labels = covered.map((c) => c.label)
    expect(labels).not.toContain('Interface du haut')
    expect(labels).toEqual(['Boutons', 'Légende et musique'])
    const caption = covered[1].box
    const tallCaption = safeZones('9:16').covered.find((c) => c.label === 'Légende et musique')!.box
    expect(caption.height).toBeLessThan(tallCaption.height)
    expect(caption.top + caption.height).toBeCloseTo(1, 12)
  })

  it('every box lies inside the frame, for every format', () => {
    for (const { id } of VIDEO_ASPECTS) {
      const { guides, covered } = safeZones(id)
      for (const { box } of [...guides, ...covered]) expect(insideFrame(box), id).toBe(true)
    }
  })

  it('a frame taller than the phone is fitted to its height', () => {
    const covered = phoneInterfaceOver(0.5)
    const caption = covered.find((c) => c.label === 'Légende et musique')!.box
    expect(caption.top + caption.height).toBeCloseTo(1, 12)
    // the side bands of the screen are outside the frame: less of the buttons is left
    const buttons = covered.find((c) => c.label === 'Boutons')!.box
    expect(buttons.width).toBeLessThan(safeZones('9:16').covered.find((c) => c.label === 'Boutons')!.box.width)
    for (const { box } of covered) expect(insideFrame(box)).toBe(true)
  })
})

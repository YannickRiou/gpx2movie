/**
 * Pictograms of the « figurine » markers: SVG path data on a 24 × 24 grid, stroked with round caps and joins at
 * width 2 like the interface icons, every figure moving to the right (the marker mirrors it when the track heads
 * left on screen). Shared by the marker badge (canvas `Path2D`) and the chips of the interface (inline SVG).
 *
 * The bike of « cycliste » and the car of « voiture » follow Lucide's `bike` and `car` (ISC License, notice in
 * `src/ui/icons.tsx`); the other figures are drawn in the same style.
 */
import type { MarkerFigure } from './markerSettings'

/** Side of the drawing grid of the pictograms. */
export const FIGURE_GRID = 24

/** Circle as path data (two arcs), so that every part of a figure is one path string. */
export function circlePath(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`
}

export const MARKER_FIGURE_PATHS: Record<MarkerFigure, readonly string[]> = {
  randonneur: [
    circlePath(13, 4, 2),
    'M12.5 7 11 13',
    // backpack, behind the shoulders
    'M12 7.5 9.2 8.3 8.6 12.2 11.2 12.6',
    'M12.2 8.6 15 11.5',
    // walking pole
    'M15.3 9.8 16.8 22',
    'M11 13 13.4 17.2 13.6 22',
    'M11 13 9.6 17.5 7.5 21.6',
  ],
  coureur: [
    circlePath(15, 4, 2),
    'M14 7 11.5 12.5',
    'M13.6 8.2 16 11 18 9.5',
    'M13.6 8.2 10.6 9.6 9.2 12.4',
    'M11.5 12.5 15 15 14 20',
    'M11.5 12.5 9.8 16.6 6 17.6',
  ],
  cycliste: [circlePath(18.5, 17.5, 3.5), circlePath(5.5, 17.5, 3.5), circlePath(15, 5, 1), 'M12 17.5V14l-3-3 4-3 2 3h2'],
  vtt: [
    circlePath(18.5, 16.5, 3.5),
    circlePath(5.5, 16.5, 3.5),
    circlePath(15, 4, 1),
    'M12 16.5V13l-3-3 4-3 2 3h2',
    // rough ground under the wheels
    'M2 22.5 7 21.2 11 22.3 16 21 22 22',
  ],
  skieur: [
    circlePath(12.5, 4.3, 2),
    'M11.5 7 9.5 12',
    'M11.2 8 14.6 10.4',
    // pole, then the two legs on the ski
    'M14.6 10.4 17.2 19.8',
    'M9.5 12 13 14 11.5 18.5',
    'M9.5 12 11 15 8.5 17.6',
    'M3 16 21.5 21.5',
  ],
  parapente: [
    // the wing, then the lines down to the pilot
    'M3 8C6 3.5 18 3.5 21 8C18 6.3 6 6.3 3 8Z',
    'M4 8 11.2 16',
    'M20 8 12.8 16',
    circlePath(12, 17.3, 1.4),
    'M10.2 20.2h3.6l1.2 1.6',
  ],
  voiture: [
    'M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2',
    circlePath(7, 17, 2),
    'M9 17h6',
    circlePath(17, 17, 2),
  ],
}

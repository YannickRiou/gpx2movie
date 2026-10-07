import { describe, expect, it } from 'vitest'
import fontsCss from './fonts.css?raw'
import indexHtml from '../../index.html?raw'
import { OVERLAY_FONTS } from '../overlay/themes'

// keys only: the font files are listed, never loaded
const PUBLIC_FONTS = Object.keys(import.meta.glob('../../public/fonts/*.woff2')).map((path) => path.replace('../../public', ''))

interface Face {
  family: string
  minWeight: number
  maxWeight: number
  url: string
}

const FACES: Face[] = [...fontsCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => {
  const family = /font-family:\s*'([^']+)'/.exec(body)?.[1] ?? ''
  const [minWeight, maxWeight = minWeight] = (/font-weight:\s*([\d ]+);/.exec(body)?.[1] ?? '').trim().split(/\s+/).map(Number)
  const url = /url\('([^']+)'\)/.exec(body)?.[1] ?? ''
  return { family, minWeight, maxWeight, url }
})

/** `600 13px "IBM Plex Sans", system-ui` → weight and first family. */
function parseFont(font: string): { weight: number; family: string } {
  const match = /^(\d+) [\d.]+px "([^"]+)"/.exec(font)
  if (!match) throw new Error(`unexpected font: ${font}`)
  return { weight: Number(match[1]), family: match[2] }
}

describe('embedded fonts', () => {
  it('declares faces served from public/fonts, each file present and used', () => {
    expect(FACES.length).toBeGreaterThan(0)
    const urls = FACES.map((face) => face.url)
    for (const url of urls) expect(PUBLIC_FONTS).toContain(url)
    expect([...PUBLIC_FONTS].sort()).toEqual([...new Set(urls)].sort())
  })

  it('covers every face drawn by the UI, the overlay and the 3D labels', () => {
    const used = [
      ...OVERLAY_FONTS,
      '300 32px "Fraunces"',
      '600 32px "Fraunces"', // headings (theme.css)
      '700 32px "Fraunces"',
      '400 14px "IBM Plex Sans"', // body (index.css)
      '600 13px "IBM Plex Sans"', // buttons, 3D labels
      '700 14px "IBM Plex Sans"',
    ]
    for (const font of used) {
      const { weight, family } = parseFont(font)
      const faces = FACES.filter((face) => face.family === family && face.minWeight <= weight && weight <= face.maxWeight)
      // one latin and one latin-ext subset per face
      expect(faces.map((face) => face.url.replace(/.*-(latin(-ext)?)\.woff2$/, '$1')).sort(), font).toEqual(['latin', 'latin-ext'])
    }
  })

  it('loads nothing from a third-party font service', () => {
    expect(indexHtml).not.toMatch(/fonts\.(googleapis|gstatic)\.com/)
    expect(fontsCss).not.toMatch(/https?:/)
  })
})

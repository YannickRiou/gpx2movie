/// <reference types="vitest/config" />
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Takram's precomputed atmosphere textures (EXR, ~9.5 MB) and star catalogue live in the package: serve them at /atmosphere/
 * in dev and copy them into the build, so nothing is downloaded from a third party nor committed here.
 */
const ATMOSPHERE_ASSETS = new URL('./node_modules/@takram/three-atmosphere/assets/', import.meta.url)

function atmosphereAssets(): Plugin {
  const names = () => readdirSync(ATMOSPHERE_ASSETS).filter((name) => name.endsWith('.exr') || name === 'stars.bin')
  const read = (name: string) => readFileSync(fileURLToPath(new URL(name, ATMOSPHERE_ASSETS)))
  return {
    name: 'openflyover-atmosphere-assets',
    configureServer(server) {
      server.middlewares.use('/atmosphere', (req, res, next) => {
        const name = (req.url ?? '').split('?')[0].replace(/^\//, '')
        if (!names().includes(name)) return next()
        res.setHeader('Content-Type', name.endsWith('.exr') ? 'image/x-exr' : 'application/octet-stream')
        res.end(read(name))
      })
    },
    generateBundle() {
      for (const name of names()) this.emitFile({ type: 'asset', fileName: `atmosphere/${name}`, source: read(name) })
    },
  }
}

/**
 * Dev proxy for tile sources that do not send CORS headers.
 * A source whose `urlTemplate` starts with `/tiles/<id>/` is rewritten to the upstream below.
 * Keep this list in sync with src/terrain/sources.ts.
 */
const TILE_PROXIES: Record<string, string> = {
  // Empty on purpose: every catalogue source (Mapterhorn, AWS Terrain Tiles, IGN Géoplateforme,
  // swisstopo, Esri World Imagery, EOX) sent Access-Control-Allow-Origin for http://127.0.0.1:5173
  // on 2026-10-05 (see docs/sources.md). If a provider drops CORS, add it here, e.g.
  //   'ign-ortho': 'https://data.geopf.fr',
  // and set that source's urlTemplate to '/tiles/ign-ortho/wmts?...' (the query string is preserved).
}

const proxy = Object.fromEntries(
  Object.entries(TILE_PROXIES).map(([id, target]) => [
    `/tiles/${id}`,
    {
      target,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(new RegExp(`^/tiles/${id}`), ''),
    },
  ]),
)

export default defineConfig({
  plugins: [react(), atmosphereAssets()],
  server: { port: 5173, proxy },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})

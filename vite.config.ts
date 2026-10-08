/// <reference types="vitest/config" />
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Takram's precomputed atmosphere textures (EXR, ~9.5 MB), star catalogue and cloud textures (weather, shapes,
 * turbulence, ~2.8 MB) live in the packages: serve them at /atmosphere/ and /clouds/ in dev and copy them into the
 * build, so nothing is downloaded from a third party nor committed here.
 */
const PACKAGE_ASSETS = [
  {
    prefix: 'atmosphere',
    dir: new URL('./node_modules/@takram/three-atmosphere/assets/', import.meta.url),
    keep: (name: string) => name.endsWith('.exr') || name === 'stars.bin',
  },
  {
    prefix: 'clouds',
    dir: new URL('./node_modules/@takram/three-clouds/assets/', import.meta.url),
    keep: (name: string) => name.endsWith('.png') || name.endsWith('.bin'),
  },
]

const ASSET_TYPES: Record<string, string> = { exr: 'image/x-exr', png: 'image/png' }

function atmosphereAssets(): Plugin {
  const names = (dir: URL, keep: (name: string) => boolean) => readdirSync(dir).filter(keep)
  const read = (dir: URL, name: string) => readFileSync(fileURLToPath(new URL(name, dir)))
  return {
    name: 'openflyover-atmosphere-assets',
    configureServer(server) {
      for (const { prefix, dir, keep } of PACKAGE_ASSETS) {
        server.middlewares.use(`/${prefix}`, (req, res, next) => {
          const name = (req.url ?? '').split('?')[0].replace(/^\//, '')
          if (!names(dir, keep).includes(name)) return next()
          res.setHeader('Content-Type', ASSET_TYPES[name.split('.').pop() ?? ''] ?? 'application/octet-stream')
          res.end(read(dir, name))
        })
      }
    },
    generateBundle() {
      for (const { prefix, dir, keep } of PACKAGE_ASSETS) {
        for (const name of names(dir, keep)) {
          this.emitFile({ type: 'asset', fileName: `${prefix}/${name}`, source: read(dir, name) })
        }
      }
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
  // swisstopo, Esri World Imagery, EOX, OpenTopoMap) sent Access-Control-Allow-Origin for
  // http://127.0.0.1:5173 on 2026-10-05 / 2026-10-07 (see docs/sources.md). If a provider drops CORS, add it here, e.g.
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
  // src-tauri/target (Rust build of the desktop app) is not watched
  server: { port: 5173, proxy, watch: { ignored: ['**/src-tauri/**'] } },
  build: {
    // the chunks above 500 kB are loaded on demand, one library each (three.js + fiber, Takram, mediabunny)
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      // React changes less often than the app: its own file stays cached across releases. The heavy features
      // (3D scene, export drawer, FIT decoder, mediabunny) are split by their dynamic import()s, see ARCHITECTURE.md.
      output: { codeSplitting: { groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ }] } },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // fonts.test.ts reads this stylesheet with ?raw (other CSS stays stubbed out in tests)
    css: { include: [/src\/ui\/fonts\.css/] },
  },
})

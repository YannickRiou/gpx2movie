/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  plugins: [react()],
  server: { port: 5173, proxy },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})

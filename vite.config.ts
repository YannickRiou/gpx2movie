/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Dev proxy for tile sources that do not send CORS headers.
 * A source whose `urlTemplate` starts with `/tiles/<id>/` is rewritten to the upstream below.
 * Keep this list in sync with src/terrain/sources.ts.
 */
const TILE_PROXIES: Record<string, string> = {
  // example: 'ign-ortho': 'https://data.geopf.fr',
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

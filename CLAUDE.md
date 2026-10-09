# OpenFlyover

3D flyover film viewer / generator from GPX and FIT files, 100% local.

- Two targets; always keep both working: hosted static website (no application server) and
  desktop application (Tauri, phase 6). No Node dependency at runtime; disk access and storage behind a
  common interface (browser / Tauri).

- Read `ARCHITECTURE.md` before touching the code: coordinate conventions, contracts (`src/core/types.ts`), modules.
- Under WSL: Node 24 via nvm, prefix with `source ~/.nvm/nvm.sh && nvm use 24`. Tests: `npx vitest run --maxWorkers=1`.
- Project state and handover: `docs/handover.md`.
- On Windows, Node is not in the global PATH. Prefix the commands:
  - PowerShell: `$env:Path = "C:\Users\MadCreator\AppData\Roaming\fnm\node-versions\v24.21.0\installation;" + $env:Path; npm test`
  - Bash: `export PATH="/c/Users/MadCreator/AppData/Roaming/fnm/node-versions/v24.21.0/installation:$PATH"; npm test`
- Scripts: `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`.
- No API key, no paid service: only open sources without a key (open tiles, Open-Meteo weather archives, OpenStreetMap via Overpass), with caching and respect for their terms of use.
- UI in French. Visual identity in `src/ui/theme.css`.
- Documentation (README, ARCHITECTURE, docs/) is written in English; UI labels quoted from the app stay in French.
- Strict TypeScript with `verbatimModuleSyntax` (use `import type`) and `erasableSyntaxOnly` (no `enum`, no constructor parameter properties).

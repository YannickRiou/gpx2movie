# OpenFlyover

Visionneuse / générateur de films de survol 3D à partir de GPX et FIT, 100 % local.

- Lire `ARCHITECTURE.md` avant de toucher au code : conventions de coordonnées, contrats (`src/core/types.ts`), modules.
- Sous WSL : Node 24 via nvm, préfixer par `source ~/.nvm/nvm.sh && nvm use 24`. Tests : `npx vitest run --maxWorkers=1`.
- État du projet et reprise : `docs/reprise.md`.
- Sous Windows, Node n'est pas dans le PATH global. Préfixer les commandes :
  - PowerShell : `$env:Path = "C:\Users\MadCreator\AppData\Roaming\fnm\node-versions\v24.21.0\installation;" + $env:Path; npm test`
  - Bash : `export PATH="/c/Users/MadCreator/AppData/Roaming/fnm/node-versions/v24.21.0/installation:$PATH"; npm test`
- Scripts : `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`.
- Pas de clé d'API, pas de service payant : uniquement des sources ouvertes sans clé (tuiles ouvertes, archives météo Open-Meteo, OpenStreetMap via Overpass), avec cache et respect de leurs conditions d'usage.
- UI en français. Charte graphique dans `src/ui/theme.css`.
- TypeScript strict avec `verbatimModuleSyntax` (utiliser `import type`) et `erasableSyntaxOnly` (pas d'`enum`, pas de propriétés de paramètre de constructeur).

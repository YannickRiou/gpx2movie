# OpenFlyover

Visionneuse / générateur de films de survol 3D à partir de GPX et FIT, 100 % local (inspiré de mapdirector.com).

- Lire `ARCHITECTURE.md` avant de toucher au code : conventions de coordonnées, contrats (`src/core/types.ts`), modules.
- Node n'est pas dans le PATH global de cette machine. Préfixer les commandes :
  - PowerShell : `$env:Path = "C:\Users\MadCreator\AppData\Roaming\fnm\node-versions\v24.21.0\installation;" + $env:Path; npm test`
  - Bash : `export PATH="/c/Users/MadCreator/AppData/Roaming/fnm/node-versions/v24.21.0/installation:$PATH"; npm test`
- Scripts : `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`.
- Pas de clé d'API, pas de service payant : uniquement des sources de tuiles ouvertes.
- UI en français. Charte graphique dans `src/ui/theme.css`.
- TypeScript strict avec `verbatimModuleSyntax` (utiliser `import type`) et `erasableSyntaxOnly` (pas d'`enum`, pas de propriétés de paramètre de constructeur).

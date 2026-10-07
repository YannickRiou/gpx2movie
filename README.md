# OpenFlyover

Visionneuse 3D de traces GPX / FIT sur relief réel, 100 % locale et sans clé d'API : la trace est
plaquée sur un terrain streamé (élévation Mapterhorn ou AWS Terrain Tiles) habillé d'orthophotos
(IGN, swisstopo, Esri, Sentinel-2), avec une caméra orbitale et un survol automatique le long de la
trace (timeline, profil altimétrique). C'est la fondation d'un générateur de
films de survol (« flyover »), construit uniquement sur des sources de données ouvertes.

Phases 1 et 2 (ce dépôt) : la visionneuse et le survol. Les phases suivantes ajoutent l'atmosphère,
l'export vidéo et l'application de bureau (voir la feuille de route).

## Stack

- Vite 8, React 19, TypeScript 6 strict (`verbatimModuleSyntax`, `erasableSyntaxOnly`), oxlint.
- three 0.186, @react-three/fiber 9, @react-three/drei 10 pour le rendu ; zustand 5 pour l'état ;
  @garmin/fitsdk pour les fichiers FIT.
- vitest 5 (environnement jsdom) : 330 tests unitaires à côté des modules (`*.test.ts`).
- CSS vanilla avec la charte dans `src/ui/theme.css` (pas de Tailwind).

L'architecture détaillée (conventions de coordonnées, contrats `src/core/types.ts`, moteur de terrain,
scène, état) est décrite dans [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Lancer le projet

Prérequis : Node 24 (installé via fnm sur la machine de développement) et `npm install`.

Node n'est pas dans le PATH global de la machine de référence : préfixer chaque commande.

```powershell
# PowerShell
$env:Path = "C:\Users\MadCreator\AppData\Roaming\fnm\node-versions\v24.21.0\installation;" + $env:Path
npm run dev
```

```bash
# Bash (Git Bash)
export PATH="/c/Users/MadCreator/AppData/Roaming/fnm/node-versions/v24.21.0/installation:$PATH"
npm run dev
```

| Commande | Rôle |
|---|---|
| `npm run dev` | serveur de développement sur <http://127.0.0.1:5173> |
| `npm run build` | `tsc -b` puis bundle de production dans `dist/` |
| `npm run preview` | sert le bundle de production |
| `npm test` | `vitest run` (toute la suite) |
| `npm run typecheck` | `tsc --noEmit -p tsconfig.app.json` |
| `npm run lint` | oxlint |

Dans l'application : glisser un fichier `.gpx` ou `.fit` dans la zone de dépôt, ou cliquer sur
« Charger l'exemple » (`public/samples/tour-du-mont-blanc-j1.gpx`, trace synthétique de la première
étape du Tour du Mont-Blanc, régénérable avec `node scripts/gen-sample-gpx.mjs`).

## Fonctionnalités de la phase 1

- **Import GPX et FIT** : plusieurs fichiers à la fois, un `Track` par `<trk>` (repli sur `<rte>`),
  extensions cardio / cadence / puissance / température, statistiques (distance, D+ / D− lissés,
  durée, altitudes min / max), couleur attribuée automatiquement, erreurs affichées en français.
- **Relief 3D streamé** : quadtree Web Mercator avec raffinement par remplacement (jamais de trou),
  erreur écran cible 3 px, jupes entre niveaux de détail, déchargement des tuiles non visitées, champ
  de hauteur multi-niveaux pour le plaquage, exagération verticale 1–2,5, mode filaire.
- **Élévation** : Mapterhorn (Terrarium WebP 512 px, jusqu'à z17 dans les Alpes) ou AWS Terrain Tiles
  (Terrarium PNG, z ≤ 15). Une tuile sans donnée (HTTP 4xx) est une feuille : le parent reste affiché.
- **Imagerie composée** : pour chaque tuile de terrain, `2^k × 2^k` sous-tuiles d'imagerie (détail
  normal / fin / très fin) assemblées en une texture sRGB mipmappée. IGN BD ORTHO et swisstopo sont
  choisis automatiquement quand la trace est dans leur emprise ; Esri World Imagery et Sentinel-2
  cloudless (EOX) couvrent le reste du monde.
- **Trace plaquée** : lignes épaisses (Line2, 4 px) densifiées tous les 10 m et replaquées sur le relief
  au fil du chargement des tuiles, passe fantôme pour les portions masquées, sphères de départ et
  d'arrivée.
- **Caméra orbitale** avec amortissement, recadrage automatique à l'import et bouton « Recadrer la vue »
  (animation de 800 ms).
- **Repère local tangent** centré sur la trace (+X est, +Y haut, +Z sud), conversions WGS84 → ECEF →
  local en doubles JS pour garder une précision millimétrique dans les buffers float32.
- **Barre d'état** : tuiles chargées / en attente / en erreur et attributions obligatoires des sources.

## Feuille de route

| Phase | Contenu |
|---|---|
| 1 — Visionneuse (fait) | import GPX / FIT, relief streamé, imagerie composée, trace plaquée, caméra orbitale |
| 2 — Survol (fait) | caméra de survol automatique le long de la trace, timeline, lecture / pause, vitesse, marqueur de progression, profil altimétrique |
| 3 — Atmosphère | ciel et diffusion atmosphérique (modèle Takram), brume de distance, soleil et heure du jour, ombres |
| 4 — Export vidéo | rendu hors écran à résolution fixe et encodage MP4 / WebM via WebCodecs, presets 16:9 / 9:16 |
| 5 — Application de bureau | emballage Tauri (binaire natif, accès disque), stockage local SQLite des trips et presets, packs de tuiles hors ligne |

## Sources de données et licences

Toutes les sources sont ouvertes et accessibles sans clé d'API ; chacune impose l'affichage de son
attribution (faite dans la barre d'état). Les gabarits d'URL, zooms, formats, emprises et conditions ont
été vérifiés empiriquement et sont documentés dans [`docs/sources.md`](docs/sources.md) ;
`src/terrain/sources.ts` est la seule vérité pour le code.

| Source | Usage | Licence / conditions |
|---|---|---|
| Mapterhorn | élévation | données ouvertes (151 sources, CC BY 4.0, OGL, domaine public…), code BSD-3 |
| AWS Terrain Tiles (Mapzen / Tilezen) | élévation | sources publiques (USGS, NOAA, Copernicus, ArcticDEM…) |
| IGN BD ORTHO (Géoplateforme) | imagerie France | licence ouverte Etalab 2.0 |
| swisstopo SWISSIMAGE | imagerie Suisse | OGD swisstopo, usage loyal |
| Esri World Imagery | imagerie mondiale | Esri Master Agreement : attribution obligatoire, à relire avant distribution commerciale ou mise en cache hors ligne |
| EOX Sentinel-2 cloudless | imagerie mondiale 10 m | **CC BY-NC-SA 4.0** (non commercial) |

Points de vigilance avant une distribution payante ou la phase « packs hors ligne » : les conditions
Esri et la clause non commerciale d'EOX (voir « Points d'attention » dans `docs/sources.md`).

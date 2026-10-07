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
  de hauteur multi-niveaux pour le plaquage, exagération verticale 1–3, mode filaire.
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
| 3 — Atmosphère (en cours) | fait : ciel et diffusion atmosphérique (modèle Takram), brume de distance, soleil et heure solaire, ciel de nuit étoilé, exposition automatique et correction, ombres portées du relief, fonds de carte topographiques (Plan IGN, carte nationale suisse, OpenTopoMap) ; reste : eau réfléchissante (masque d'eau, reflets du ciel et du soleil, vagues), hauteurs calées sur le niveau de la mer (géoïde) — l'aquarelle (Stadia) exige une clé, exclue |
| 4 — Personnalisation (en cours) | fait : document de projet (enregistrer / ouvrir un fichier autonome), annuler / rétablir, préréglages ; à venir : tout le film est réglable : caméra, rythme, titres, données affichées, style de trace, points d'intérêt, rendu, format (détail ci-dessous) |
| 5 — Export vidéo (en cours) | fait : rendu hors écran image par image à résolution fixe (16:9 jusqu'en 4K, 9:16, 1:1, 4:5 ; 24 / 30 / 60 i/s ; trois qualités), attente du chargement du relief pour chaque image, habillage incrusté, encodage MP4 H.264 (repli HEVC, WebM VP9 / VP8) via WebCodecs, progression, temps restant, annulation, téléchargement ; reste : images fixes haute résolution, écriture directe sur disque pour les films longs |
| 6 — Application de bureau | emballage Tauri (binaire natif, accès disque), stockage local SQLite des projets et préréglages, packs de tuiles hors ligne |
| 7 — Au-delà du survol | fonctionnalités propres à OpenFlyover : lumière et météo réelles de la sortie, trace colorée par les données, course fantôme, vidéo embarquée synchronisée, repères automatiques, remonter le temps, rendu en lot, affiche, calage musical, reconnaissance (détail ci-dessous) |

### Phase 4 — Personnalisation

Principe : chaque réglage vit dans un **document de projet unique** (JSON versionné) — enregistrable, rechargeable,
partageable, avec préréglages et annuler / rétablir. L'aperçu et l'export lisent ce même document : ce qu'on voit est
ce qui sera rendu.

| Domaine | Réglages |
|---|---|
| Rythme | **fait** : durée totale réglable (15 s–10 min) ; ralentis et pauses aux temps forts (sommets des montées, cols franchis, sommets proches), durée du film conservée ou allongée ; à faire : vitesse par portion choisie à la main, plan de situation (ouverture sur le pays ou la région qui plonge vers la trace), ouverture et fermeture « balayage » ou « saut », transitions entre sections réglables |
| Caméra | **fait** : styles poursuite, balancement (hélicoptère), orbite, vue du dessus, plan cinématique ; préréglages nommés ; distance, tangage, cap, lissage ; à faire : caméra propre à chaque étape (photo, lieu, note), images-clés sur la timeline |
| Titres et textes | titre d'ouverture, sous-titres, générique de fin, étiquettes posées sur le relief (sommets, cols, villages) ; police, couleur, position, apparition et durée |
| Données à l'écran | **fait** : habillage dessiné sur canvas (même rendu en aperçu et à l'export), trois styles (éditorial, diffusion sombre, application claire), carte d'ouverture, carte de clôture (distance, D+, altitude max, durée, vitesse max, météo), compteurs au choix, profil de dimensions réglables, mini-carte (partie parcourue, flèche du nord), météo au marqueur, logo, texte libre, 9 positions et une taille par widget ; étiquettes 3D effacées derrière les cartes ; à faire : couleurs et polices par widget. Prévu à l'origine : compteurs (distance, altitude, D+, vitesse, fréquence cardiaque, temps), profil altimétrique (dimensions réglables), mini-carte, logo, texte libre, carte de clôture (altitude max, vitesse max…) ; styles d'habillage prédéfinis (éditorial, diffusion sombre, application claire) ; position, taille et style de chaque widget |
| Trace | couleur, épaisseur, style (pleine, pointillée, lumineuse sans perte de teinte), trace qui se dessine au fil du survol, enchaînement de plusieurs traces, trace affichée mais exclue du survol ; marqueurs départ / progression / arrivée en figurines 3D animées selon la vitesse et la pente (randonneur, coureur, alpiniste, skieur de randonnée, cycliste route et VTT, bikepacking, moto, parapente, avion léger) ou en autocollant / avatar personnel |
| Points d'intérêt | ajout manuel ou depuis les waypoints GPX, photos géolocalisées, icônes, types d'épingles ; un seul réglage de timing (apparition / disparition) pour waypoints, photos, bornes kilométriques, départ et arrivée |
| Rendu | sources de relief et d'imagerie, exagération, atmosphère (date, heure, brume), étalonnage (exposition, contraste, saturation, vignettage) |
| Format | ratio 16:9 / 9:16 / 1:1 / 4:5, résolution, cadence, zones de sécurité affichées |
| Thèmes | habillage du film (polices, couleurs des titres et widgets) indépendant de l'interface, thèmes fournis et personnalisés ; styles de carte, d'éléments et d'habillage enregistrables séparément |
| Éditeur | une page, cinq modes (Trajet, Carte, Habillage, Survol, Prises de vue) sans recharger la scène ; onglets Contenu / Style / Visibilité par élément ; pastille « modifié » et bouton rétablir sur tout réglage qui s'écarte du style ; prises de vue enregistrées (caméra, cadrage, lumière) pour des images fixes |

### Phase 7 — Au-delà du survol

Ce qui distingue OpenFlyover : tout reste local, et les données de la sortie (horodatage, capteurs, lieu) pilotent le film.

| Fonctionnalité | Contenu | État |
|---|---|---|
| Lumière réelle de la sortie | le soleil suit l'horodatage de chaque point : on revit le lever ou le coucher de soleil au bon endroit, ombres portées comprises | fait |
| Météo historique | température, ressenti, vent et rafales, nuages (3 couches), pluie et neige heure par heure sur la trace, du jour de la sortie (archive Open-Meteo depuis 1940, sans clé, cache local) : bilan de la sortie et conditions au marqueur dans le panneau ; rendu dans la scène et widget du film à venir | panneau fait ; scène et widget à faire |
| Trace colorée par une donnée | vitesse, pente, fréquence cardiaque, puissance, en échelle séquentielle perceptuellement uniforme (viridis, magma…) avec légende | fait (vitesse, pente, altitude, FC, cadence, puissance, température) |
| Course fantôme | plusieurs traces rejouées ensemble sur leur temps réel : comparer des amis, ou ses sorties successives sur un même parcours | à faire |
| Vidéo embarquée synchronisée | incrustation d'une vidéo GoPro / Insta360 calée sur l'horodatage ; export de l'habillage seul sur fond transparent pour le montage | après la phase 5 |
| Repères automatiques | sommets, cols, refuges et lacs tirés d'OpenStreetMap avec leur altitude ; montées détectées et catégorisées, qui déclenchent ralentis et titres | montées (cat. 4 à HC), waypoints GPX et repères OpenStreetMap (sommets, cols, refuges, lacs… à 0,1–3 km, une requête Overpass par trace en cache) étiquetés en 3D : fait ; ralentis et titres à faire |
| Remonter le temps | orthophotos historiques (IGN 1950–1965) ou d'une autre saison, en comparatif avant / après | photos IGN 1950–1965, 1965–1980 (partiel) et 2000–2005 faites ; comparatif à faire |
| Rendu en lot | un dossier de GPX et un préréglage → une vidéo par sortie, en ligne de commande, sans interface | après la phase 5 |
| Affiche imprimable | la trace sur le relief en très haute résolution, habillage compris, pour un tirage | après la phase 5 |
| Calage musical | le rythme du survol (ralentis, transitions) aligné sur les temps forts d'une musique locale | à faire |
| Reconnaissance | tracer un itinéraire futur sur le relief (routage OSM local) pour le survoler avant d'y aller | à faire |

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
| OpenStreetMap (API Overpass publique) | repères (sommets, cols, refuges, lacs…) | ODbL : attribution obligatoire ; instance publique à usage modéré (une requête par trace, cache) |
| Polices Fraunces, IBM Plex Sans, IBM Plex Sans Condensed (`public/fonts/`) | interface, habillage du film, étiquettes 3D | SIL Open Font License 1.1 (`public/fonts/OFL-*.txt`) |
| Open-Meteo (archive ERA5) | météo historique | CC BY 4.0 ; API gratuite réservée à un usage **non commercial** (licence Open-Meteo sinon) |

Points de vigilance avant une distribution payante ou la phase « packs hors ligne » : les conditions
Esri et la clause non commerciale d'EOX (voir « Points d'attention » dans `docs/sources.md`).

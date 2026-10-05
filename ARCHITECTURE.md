# OpenFlyover — architecture (phase 1 : visionneuse)

Objectif phase 1 : importer un GPX / FIT, afficher le relief 3D (élévation Mapterhorn ou AWS Terrarium)
habillé d'orthophotos, la trace plaquée sur le relief, et une caméra orbitale. 100 % local, aucune clé d'API.

Référence : mapdirector.com (Three.js + React Three Fiber, terrain streamé, imagerie composée).
Phases suivantes (hors scope ici) : survol caméra & timeline, atmosphère Takram, export vidéo WebCodecs, packs hors ligne, Tauri.

## Stack

- Vite 8 + React 19 + TypeScript (strict), oxlint.
- three + @react-three/fiber + @react-three/drei, zustand, @garmin/fitsdk.
- Tests : vitest (environment jsdom). Fichiers `*.test.ts` à côté des modules.
- Pas de Tailwind : CSS vanilla avec variables (charte dans `src/ui/theme.css`).

## Conventions de coordonnées (voir `src/core/types.ts`)

- WGS84 lon/lat en degrés, hauteurs en mètres au-dessus de l'ellipsoïde.
- Scène Three.js dans un **repère local tangent** centré sur le centroïde du trip : +X est, +Y haut, +Z sud.
  Les conversions ECEF → local sont faites en doubles JS, jamais dans le shader.
- Tuiles Web Mercator, schéma XYZ (y = 0 au nord).

## Modules et propriétaires (développés en parallèle — fichiers disjoints)

| Dossier | Rôle | Exports attendus |
|---|---|---|
| `src/core/types.ts` | contrats partagés | (figé) |
| `src/geo/ellipsoid.ts` | WGS84 ↔ ECEF, repère local | `WGS84`, `lonLatToEcef(lon,lat,h,target?)`, `ecefToLonLat(v)`, `createLocalFrame(lon,lat): LocalFrame`, `haversineM(a: LonLat, b: LonLat)`, `centroid(bounds)` |
| `src/geo/mercator.ts` | maths de tuiles | `lonLatToTileFrac(lon,lat,z)`, `tileBounds(key): LonLatBounds`, `tileCenter(key)`, `tilesForBounds(bounds,z): TileKey[]`, `tileGroundSizeM(key)`, `childrenOf(key)`, `parentOf(key)`, `tileKeyString(key)`, `tileContains(key, lon, lat)`, `lonLatToTileUV(key, lon, lat): {u,v}` (u,v ∈ [0,1], v=0 au nord) |
| `src/import/gpx.ts` | parse GPX | `parseGpx(text: string, fileName: string): Track[]` |
| `src/import/fit.ts` | parse FIT | `parseFit(buffer: ArrayBuffer, fileName: string): Promise<Track[]>` |
| `src/import/stats.ts` | stats & bounds | `computeStats(segments): TrackStats`, `computeBounds(segments): LonLatBounds`, `densify(points, maxStepM): TrackPoint[]` |
| `src/import/index.ts` | point d'entrée | `importFile(file: File): Promise<Track[]>`, `importText(text, fileName)`, `TRACK_COLORS` |
| `src/terrain/sources.ts` | catalogue de sources | `TERRAIN_SOURCES: TerrainSource[]`, `IMAGERY_SOURCES: ImagerySource[]`, `buildTileUrl(source, key): string`, `getTerrainSource(id)`, `getImagerySource(id)` |
| `src/terrain/fetch.ts` | fetch + cache bitmaps | `createTileFetcher(opts?: {concurrency?, maxEntries?}): TileFetcher` |
| `src/terrain/dem.ts` | décodage élévation | `decodeDem(bitmap, encoding): HeightGrid`, `sampleGrid(grid, u, v): number` (bilinéaire, NaN-safe) |
| `src/terrain/heightField.ts` | champ de hauteur multi-niveaux | `class HeightField { set(key, grid); delete(key); has(key); sampleHeight(lon, lat): number \| undefined }` (tuile la plus profonde contenant le point) |
| `src/terrain/imagery.ts` | texture composée | `loadImageryTexture: LoadImageryTexture` |
| `src/terrain/mesh.ts` | géométrie d'une tuile | `buildTileGeometry(key, grid, frame, opts: BuildTileGeometryOptions): TileGeometryResult` |
| `src/terrain/quadtree.ts` + `engine.ts` | LOD, chargement, groupe Three | `createTerrainEngine(options: TerrainEngineOptions): TerrainEngine` |
| `src/scene/*.tsx` | composants R3F | `FlyoverCanvas`, `TerrainLayer`, `TrackLines`, `CameraRig` |
| `src/state/store.ts` | état zustand | `useAppStore` |
| `src/ui/*` + `src/App.tsx` | interface | `App` |

### Règles pour le travail en parallèle

- Chaque agent n'écrit **que** dans ses fichiers. Pas de `npm install` (tout est déjà installé) ; si un paquet manque, le signaler dans le rapport.
- Importer les types depuis `src/core/types.ts` avec `import type`.
- Pas de dépendance React dans `geo/`, `import/`, `terrain/`.
- Node n'est pas dans le PATH global. Préfixer chaque commande :
  - PowerShell : `$env:Path = "C:\Users\MadCreator\AppData\Roaming\fnm\node-versions\v24.21.0\installation;" + $env:Path; npm test`
  - Bash : `export PATH="/c/Users/MadCreator/AppData/Roaming/fnm/node-versions/v24.21.0/installation:$PATH"; npm test`
- Scripts : `npm run dev` (port 5173), `npm run build`, `npm test` (vitest run), `npm run typecheck` (tsc --noEmit).

## Moteur de terrain — conception

1. **Sources** (`sources.ts`) : élévation Mapterhorn `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp` (Terrarium, webp),
   AWS Terrain Tiles `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (Terrarium, z ≤ 15).
   Imagerie : IGN BD ORTHO (Géoplateforme WMTS, PM), EOX Sentinel-2 cloudless, ArcGIS World Imagery, swisstopo SWISSIMAGE.
   Les URL exactes, zooms max, encodage et support CORS sont vérifiés par un agent dédié ; `sources.ts` est la seule vérité.
   Une source sans CORS passe par le proxy Vite (`/tiles/<id>/...`, cf. `vite.config.ts`).
2. **Fetch** (`fetch.ts`) : `fetch()` + `createImageBitmap`, file de priorité, concurrence ~12, dédoublonnage des requêtes en vol,
   LRU ~600 bitmaps, support `AbortSignal`, 1 retry sur erreur réseau.
3. **DEM** (`dem.ts`) : Terrarium `h = (R*256 + G + B/256) - 32768` ; Mapbox `h = -10000 + (R*65536 + G*256 + B) * 0.1`.
   Décodage via `OffscreenCanvas` (fallback `HTMLCanvasElement`). Échantillonnage bilinéaire.
4. **Imagerie** (`imagery.ts`) : pour la tuile terrain (z,x,y) et `zoomOffset = k`, récupérer les `2^k × 2^k` sous-tuiles
   à z+k et les dessiner dans un canvas `tileSize·2^k` → `CanvasTexture` (sRGB, mipmaps, anisotropie max).
   Si z+k > maxZoom de la source : prendre la tuile disponible la plus profonde et la recadrer (crop).
   Si une sous-tuile échoue : laisser la zone grise, ne pas rejeter.
5. **Maillage** (`mesh.ts`) : grille `(segments+1)²` ; pour chaque sommet, position Mercator fractionnaire → lon/lat →
   hauteur bilinéaire (grille DEM, hauteur × exaggeration) → ECEF → local via `frame.toLocal`. UV (0,0) = coin NW... attention :
   en Three.js `uv.y = 1` est le haut de l'image ; la ligne 0 de la tuile image est le nord → `uv.y = 1 - v`.
   Normales calculées depuis la grille (avant d'ajouter les jupes). Jupes : copie du contour abaissé de `skirtDepthM`.
6. **Quadtree / LOD** (`quadtree.ts`, `engine.ts`) :
   - Racines : toutes les tuiles du zoom racine couvrant `area` (zoom racine choisi pour ≤ 16 tuiles, ≥ terrain.minZoom).
   - Erreur géométrique d'une tuile ≈ `tileGroundSizeM / segments`.
     Erreur écran `sse = geometricError * viewportH / (2 * distance * tan(fov/2))`, distance = caméra → sphère englobante.
   - Raffinement par **remplacement** : le parent reste affiché tant que ses 4 enfants ne sont pas prêts (pas de trous).
     Enfant hors frustum = considéré prêt pour le remplacement (mais chargé en basse priorité).
   - Priorité de chargement : sse décroissante. Une tuile est "prête" quand DEM + texture sont chargés (texture en échec → matériau gris).
   - Déchargement : nœuds non visités depuis > 2 s et pas ancêtres d'un nœud visible → dispose geometry/texture ; le `HeightField`
     garde les grilles des ~300 dernières tuiles (LRU).
   - Sphère englobante : depuis la géométrie si chargée, sinon depuis les bornes de la tuile avec hauteurs [-500, 9000] m.
   - Matériau : `MeshStandardMaterial({ map, roughness: 1, metalness: 0 })`, `side: FrontSide`. Option `wireframe`.
   - `onChange` déclenché (coalescé par frame) quand une tuile devient prête ou est retirée → la trace se replaque.
7. **Scène** (`scene/`) :
   - `FlyoverCanvas` : `<Canvas gl={{ antialias: true, logarithmicDepthBuffer: true }} camera={{ fov: 50, near: 1, far: 5e6 }}>`,
     `HemisphereLight` + `DirectionalLight` (soleil fixe SE pour l'instant), fond `#113B54`... non : fond ciel neutre `#BBD1FF` → `#FFFFFF` dégradé CSS derrière le canvas transparent (alpha true).
   - `TerrainLayer` : crée le moteur (useMemo sur frame/sources), ajoute `engine.group` à la scène, `useFrame` → `engine.update(camera, size.height)`,
     pousse `stats` dans le store à ~4 Hz, `setOptions` quand les réglages changent.
   - `TrackLines` : pour chaque trace, `Line2` (three/addons/lines) largeur 4 px, couleur `track.color`, points densifiés (pas ≤ 10 m),
     hauteur = `(engine.sampleHeight(lon,lat) ?? pt.ele ?? 0) * exaggeration + 3`. Re-plaquage sur `engine.onChange` (debounce 150 ms).
     Deuxième passe `depthTest: false`, opacité 0.25 pour laisser deviner les portions cachées par le relief.
     Sphères de départ (vert `#024442`) et d'arrivée (jaune `#DBE64C`).
   - `CameraRig` : `OrbitControls` (drei) avec amortissement, `maxPolarAngle = 85°`, `minDistance = 30`, `maxDistance = 400 km` ;
     `fitToBounds(bounds)` : cible = centre, caméra au sud-est, pitch 40°, distance = 1.4 × diagonale de la boîte (min 2 km).
8. **État** (`store.ts`) : `tracks: Track[]`, `addTracks`, `removeTrack`, `clearTracks`, `settings { terrainSourceId, imagerySourceId,
   imageryZoomOffset, exaggeration, wireframe }`, `setSetting`, `terrainStats`, `frame/area` dérivés des traces (centroïde + marge 25 km, min 40 km),
   `fitRequest` (compteur incrémenté pour demander un recadrage).
9. **UI** (`ui/`) : panneau gauche 340 px (fond blanc, texte `#113B54`) : logo « OpenFlyover » (Funnel Display), zone de dépôt
   « Glisse un fichier GPX ou FIT », bouton « Charger l'exemple » (`/samples/tour-du-mont-blanc-j1.gpx`), liste des traces
   (pastille couleur, nom, distance, D+, durée, bouton supprimer), réglages (source relief, source imagerie, détail imagerie 0/1/2,
   exagération 1–2.5, filaire), bouton « Recadrer » (chartreuse `#DBE64C`), barre d'état (tuiles chargées / en attente) et
   attributions obligatoires. Libellés en français. Charte : `src/ui/theme.css`.

## Charte graphique (variables CSS)

`--color-navy:#113B54; --color-chartreuse:#DBE64C; --color-white:#FFFFFF; --color-periwinkle:#BBD1FF; --color-water-green:#E2F4DF; --color-pine:#024442;`
Titres : Funnel Display ; corps : Mulish (Google Fonts dans `index.html`). Texte noir/navy sur fond clair, blanc sur fond foncé. Contraste ≥ 4.5:1.

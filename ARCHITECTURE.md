# OpenFlyover — architecture (phase 1 : visionneuse)

Objectif phase 1 : importer un GPX / FIT, afficher le relief 3D (élévation Mapterhorn ou AWS Terrarium)
habillé d'orthophotos, la trace plaquée sur le relief, et une caméra orbitale. 100 % local, aucune clé d'API.

Phase 2 (survol caméra, timeline, profil) : section « Survol » en fin de document. Phases suivantes : atmosphère Takram,
personnalisation complète via un document de projet unique, export vidéo WebCodecs, Tauri et packs hors ligne (voir README).

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

## Modules

| Dossier | Rôle | Exports attendus |
|---|---|---|
| `src/core/types.ts` | contrats partagés | (figé) |
| `src/geo/ellipsoid.ts` | WGS84 ↔ ECEF, repère local | `WGS84`, `lonLatToEcef(lon,lat,h,target?)`, `ecefToLonLat(v)`, `createLocalFrame(lon,lat): LocalFrame`, `haversineM(a: LonLat, b: LonLat)`, `centroid(bounds)`, `expandBounds(bounds, marginM, minSizeM?)` |
| `src/geo/mercator.ts` | maths de tuiles | `lonLatToTileFrac(lon,lat,z)`, `tileBounds(key): LonLatBounds`, `tileCenter(key)`, `tilesForBounds(bounds,z): TileKey[]`, `tileCountForBounds(bounds,z)`, `zoomForTileBudget(bounds, maxTiles, minZoom, maxZoom)`, `tileGroundSizeM(key)`, `childrenOf(key)`, `parentOf(key)`, `tileKeyString(key)`, `parseTileKey(s)` (lève sur clé invalide), `tileContains(key, lon, lat)`, `lonLatToTileUV(key, lon, lat): {u,v}` (u,v ∈ [0,1], v=0 au nord), `tileUVToLonLat(key,u,v)`, `boundsIntersect(a,b)` |
| `src/import/gpx.ts` | parse GPX | `parseGpx(text: string, fileName: string): Track[]` |
| `src/import/fit.ts` | parse FIT | `parseFit(buffer: ArrayBuffer, fileName: string): Promise<Track[]>` |
| `src/import/stats.ts` | stats & bounds, assemblage | `computeStats(segments): TrackStats`, `computeBounds(segments): LonLatBounds`, `densify(points, maxStepM): TrackPoint[]`, `buildTrack(init): Track`, `stripExtension(fileName)` (partagés par les deux parseurs) |
| `src/import/index.ts` | point d'entrée | `importFile(file: File, colorIndex?): Promise<Track[]>`, `importText(text, fileName, colorIndex?)`, `TRACK_COLORS`, `assignColors` |
| `src/terrain/sources.ts` | catalogue de sources | `TERRAIN_SOURCES: TerrainSource[]`, `IMAGERY_SOURCES: ImagerySource[]`, `buildTileUrl(source, key): string`, `getTerrainSource(id)`, `getImagerySource(id)`, `sourceCovers(source, bounds \| point)` |
| `src/terrain/fetch.ts` | fetch + cache bitmaps | `createTileFetcher(opts?: {concurrency?, maxEntries?, retryDelayMs?}): TileFetcher`, `TileFetchError` (`status`, `url`), `isAbortError(e)` |
| `src/terrain/dem.ts` | décodage élévation | `decodeDem(bitmap, encoding): HeightGrid`, `sampleGrid(grid, u, v): number` (bilinéaire, NaN-safe) |
| `src/terrain/heightField.ts` | champ de hauteur multi-niveaux | `class HeightField { set(key, grid); delete(key); has(key); sampleHeight(lon, lat): number \| undefined }` (tuile la plus profonde contenant le point) |
| `src/terrain/imagery.ts` | texture composée | `loadImageryTexture: LoadImageryTexture` |
| `src/terrain/mesh.ts` | géométrie d'une tuile | `buildTileGeometry(key, grid, frame, opts: BuildTileGeometryOptions): TileGeometryResult` |
| `src/terrain/quadtree.ts` + `engine.ts` | LOD, chargement, groupe Three | `createTerrainEngine(options: TerrainEngineOptions, deps?: Partial<EngineDeps>, tuning?: Partial<EngineTuning>): TerrainEngine` (deps injectables pour les tests) |
| `src/scene/*.tsx` | composants R3F | `FlyoverCanvas`, `TerrainLayer` (+ `useTerrainContext`), `TrackLines`, `CameraRig`, `FlyoverRig`, `useDebouncedCallback` |
| `src/flyover/path.ts` | chemin de survol | `buildTrackPath(track): TrackPath` (segments concaténés, distances cumulées, `time` en ms ou NaN), `samplePath(path, distanceM): PathSample` (`ele` et `time` interpolés seulement si les deux voisins les ont), `recordedTimeAt(path, distanceM)` (comble les points sans heure), `elevationProfile(path, samples)` |
| `src/flyover/sun.ts` | date du soleil | `solarHourToDate(dayMs, lon, solarHour)`, `sunDateAt(path \| null, progress, { sunFromTrack, solarHour, lon, dayMs }): Date` |
| `src/flyover/trackColor.ts` | trace colorée par une grandeur | `TRACK_COLOR_MODES`, `TrackColorBy`, `TRACK_METRICS` (libellé, unité, palette), `metricValues`, `trackMetricValues`, `hasMetric`, `robustRange`, `resampleValues`, `colorizeValues`, `VIRIDIS`, `MAGMA`, `MISSING_COLOR` |
| `src/scene/exposure.ts` | exposition sous l'atmosphère | `DAYLIGHT_EXPOSURE`, `sunElevation`, `autoExposureEv`, `sceneExposure(elevation, ev)`, `nightFillIntensity` |
| `src/project/*` | document de projet, historique, préréglages | `serializeProject(state, name)`, `parseProject(text): LoadedProject`, `sanitizeSettings(raw, base)`, `SETTING_CHECKS`, `migrateProject`, `MIGRATIONS`, `applyProject`, `applySettings`, `createHistory`, `getSettingsHistory`, `installHistoryShortcuts`, `createPresetStore`, `getPresetStore`, `presetSettings` |
| `src/state/store.ts` | état zustand | `useAppStore`, `Settings`, `Playback`, `AppState`, `resetAppStore` |
| `src/ui/*` + `src/App.tsx` | interface | `App` ; `importFlow.ts` (orchestration d'import sans React, testée) |

### Règles de développement

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
   Le catalogue contient aussi des fonds non photographiques et datés, jamais choisis automatiquement (`AUTO_IMAGERY_IDS` =
   `ign-ortho`, `swisstopo`) : cartes topographiques `ign-plan` (Plan IGN, France, z19), `swisstopo-carte` (carte nationale
   suisse, z19 ; blanche hors Suisse au-delà de z15) et `opentopomap` (mondial, z17, CC BY-SA, serveur bénévole : pas de
   téléchargement massif, donc exclu des futurs packs hors ligne) ; orthophotos IGN datées pour « remonter le temps » :
   `ign-ortho-1950-1965` (France complète, niveaux de gris), `ign-ortho-1965-1980` (partiel, style `BDORTHOHISTORIQUE`, z3–18)
   et `ign-ortho-2000-2005` (z6–18), sur la boîte `FRANCE_BOX` (sur-approximation). Sources écartées (clé requise : Stadia,
   Thunderforest, SCAN 25) : `docs/sources.md`.
   Les URL exactes, zooms max, encodage et support CORS sont vérifiés empiriquement (`docs/sources.md`) ; `sources.ts` est la seule vérité.
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
   - DEM en échec transitoire (réseau, 5xx, tuile corrompue) : 3 tentatives espacées de ~5 s, compté dans `failedTiles`.
     DEM en **4xx ou hors couverture = feuille « sans donnée »** (Mapterhorn s'arrête à z12 hors zones haute résolution) :
     jamais réessayé, pas compté en erreur, le parent reste affiché à sa résolution.
   - Déchargement : nœuds non visités depuis > 2 s et pas ancêtres d'un nœud visible → dispose geometry/texture ; le `HeightField`
     garde ~400 grilles équivalent 256 px (LRU, soit ~100 Mo ; une grille 512 px compte pour quatre).
   - Sphère englobante : depuis la géométrie si chargée, sinon depuis les bornes de la tuile avec hauteurs [-500, 9000] m.
   - Matériau : `MeshStandardMaterial({ map, roughness: 1, metalness: 0 })`, `side: FrontSide`. Option `wireframe`.
   - `onChange` déclenché (coalescé par frame) quand une tuile devient prête ou est retirée → la trace se replaque.
7. **Scène** (`scene/`) :
   - `FlyoverCanvas` : `<Canvas gl={{ antialias: true, logarithmicDepthBuffer: true, alpha: true }} camera={{ fov: 50, near: 1, far: 5e6 }} flat>`
     (pas de tone mapping : les orthophotos sont déjà des images affichables), `HemisphereLight` 1.2 + `DirectionalLight` 2.0 (soleil fixe SE ;
     avec l'ombrage 1/π de three un sol plat rend ~0.88 de l'albédo), fond ciel glacier `#A9CCD9` → papier `#F5F2EA` en dégradé CSS derrière le canvas transparent.
   - `TerrainLayer` : crée le moteur dans un `useEffect` et le dispose dans le cleanup (StrictMode-safe ; jamais dans un useMemo), le recrée
     uniquement si le repère change ou si les traces sortent de l'`area` courante (area = `expandBounds(bounds, 25 km, min 40 km)`, collante),
     ajoute `engine.group` à la scène via `<primitive dispose={null}>`, `useFrame` → `engine.update(camera, size.height)`,
     pousse une copie de `stats` dans le store à ~4 Hz (seulement si changé), `setOptions` avec les seules clés modifiées quand les réglages changent.
     Expose `{ engine, frame }` par contexte à `TrackLines` et `CameraRig` (qui doivent être rendus dedans).
   - `TrackLines` : pour chaque trace, `Line2` (three/addons/lines) largeur 4 px, couleur `track.color`, points densifiés (pas ≤ 10 m),
     hauteur = `(engine.sampleHeight(lon,lat) ?? pt.ele ?? 0) * exaggeration + 3`. Re-plaquage sur `engine.onChange` (debounce 150 ms).
     Deuxième passe `depthTest: false`, opacité 0.25 pour laisser deviner les portions cachées par le relief.
     Sphères de départ (mousse `#3F6B4A`) et d'arrivée (encre `#1C2A33`).
   - `CameraRig` : `OrbitControls` (drei) avec amortissement, `maxPolarAngle = 85°`, `minDistance = 30`, `maxDistance = 400 km` ;
     `fitToBounds(bounds)` : cible = centre, caméra au sud-est, pitch 40°, distance = 1.4 × diagonale de la boîte (min 2 km).
8. **État** (`store.ts`) : `tracks: Track[]`, `addTracks`, `removeTrack`, `clearTracks`, `settings { terrainSourceId, imagerySourceId,
   imageryZoomOffset, exaggeration, wireframe }`, `setSetting`, `terrainStats`, `bounds` (union des traces) et `frameOrigin` (centroïde du
   premier lot arrondi à 0,01°, fixe tant qu'il reste une trace) ; l'`area` du moteur est dérivée dans la scène (`TerrainLayer`).
   `fitRequest` (compteur incrémenté pour demander un recadrage), `importError`, `loading`. À l'import, l'imagerie bascule automatiquement sur
   IGN puis swisstopo si la trace est entièrement dans leur emprise, sauf si l'utilisateur a déjà choisi une source à la main.
9. **UI** (`ui/`) : panneau gauche 340 px (fond papier, texte encre) : logo « OpenFlyover » (Fraunces), zone de dépôt
   « Glisse un fichier GPX ou FIT », bouton « Charger l'exemple » (`/samples/tour-du-mont-blanc-j1.gpx`), liste des traces
   (pastille couleur, nom, distance, D+, durée, bouton supprimer), réglages (source relief, source imagerie, détail imagerie 0/1/2,
   exagération 1–3, filaire), bouton « Recadrer » (rouge balise), barre d'état (tuiles chargées / en attente) et
   attributions obligatoires. Libellés en français. Charte : `src/ui/theme.css`.

## Charte graphique « Carte alpine » (variables CSS, `src/ui/theme.css`)

Papier de carte topographique, encre, rouge de balisage des sentiers, glacier.

| Rôle | Variable | Valeur |
|---|---|---|
| Fond du panneau | `--color-paper` | `#F5F2EA` |
| Cartes, groupes | `--color-card` | `#EAE4D6` |
| Texte, surfaces sombres | `--color-ink` | `#1C2A33` |
| Texte secondaire | `--color-ink-soft` | `#55626B` |
| Bordures | `--color-line` | `#D6CDBB` |
| Action principale (rouge balise) | `--color-accent` / `--color-accent-strong` (survol) | `#C23B22` / `#A3301A` |
| Accent sur fond encre | `--color-accent-light` | `#FF8A5C` |
| Ciel, éléments secondaires | `--color-glacier` | `#A9CCD9` |
| Départ | `--color-moss` | `#3F6B4A` |

Titres : Fraunces ; corps et boutons : IBM Plex Sans (Google Fonts dans `index.html`). Contraste texte ≥ 4.5:1.
Les couleurs de trace (`TRACK_COLORS`) sont choisies pour la lisibilité sur orthophoto, pas dans la charte.

## Survol (phase 2)

- **Lecture** (`store.playback { playing, progress, speed }`) : `progress` ∈ [0, 1] le long de la **première** trace, à vitesse
  au sol constante ; durée 60 s à ×1 quelle que soit la longueur. Atteindre 1 met en pause, relancer depuis la fin rembobine ;
  `requestFit` met en pause, retirer une trace remet à 0.
- **`FlyoverRig`** (dans `TerrainLayer`) : avance `progress` dans `useFrame`, place le marqueur (sphère blanche non éclairée,
  `depthTest: false`, taille écran constante) et pilote la caméra pendant la lecture ou quand `progress` change en pause
  (scrub) ; sinon l'orbite reste libre autour du marqueur.
- **Caméra de poursuite** (`computeChaseView`) : fonction pure de `progress` (pas d'état de lissage), pour que l'export vidéo
  puisse rendre n'importe quelle image isolément. Cap = corde [d − w, d + w] (w = 2 % de la trace, 150 m–1,5 km), distance
  4 % de la trace (600 m–4 km), tangage 30°. La caméra est relevée pour rester à 80 m au-dessus du sol et pour que la ligne de
  visée vers le marqueur passe au-dessus du relief (13 échantillons, marge décroissante jusqu'au marqueur).
- **`Timeline`** (`src/ui/Timeline.tsx`) : bandeau en bas de la vue — lecture / pause, profil altimétrique au-dessus du curseur
  (1000 pas), distance parcourue et altitude courante, vitesse ×0,5 à ×4.
- **Profil altimétrique** : altitudes **enregistrées** de la trace rééchantillonnées à 400 pas de distance constants
  (`elevationProfile`), aire SVG, partie parcourue en rouge clair, trait à la position courante ; cliquer-glisser sur le profil
  déplace la lecture (le curseur reste le contrôle accessible). Amplitude verticale d'au moins 100 m pour ne pas grossir le
  bruit GPS ; profil masqué si la trace n'a aucune altitude.

## Atmosphère (phase 3, en cours)

- **`AtmosphereLayer`** (`src/scene/AtmosphereLayer.tsx`, dans `TerrainLayer`) : modèle de diffusion précalculé de Takram
  (`@takram/three-atmosphere`). `worldToECEFMatrix` = `frame.localToEcef`. Éclairage **par sources** (`SunLight` +
  `SkyLight` placées à l'origine, 1000 m) : le terrain garde son `MeshStandardMaterial`. Post-process (`EffectComposer`) :
  perspective aérienne (brume selon la distance réelle), tone mapping **Khronos Neutral** (garde les teintes des
  orthophotos), SMAA. Exposition 5.
- **Textures précalculées** : fichiers EXR du paquet (~9,5 Mo), servis à `/atmosphere/` en dev et copiés dans le build par un
  plugin de `vite.config.ts` — rien n'est téléchargé chez un tiers ni versionné ici. Ne pas les générer au démarrage : la
  génération tourne dans des `requestIdleCallback` qui ne se déclenchent jamais tant que la scène occupe le fil principal,
  et les lumières restent noires.
- **Profondeur logarithmique** : `postprocessing` la signale par `LOG_DEPTH`, le shader Takram attend
  `USE_LOGARITHMIC_DEPTH_BUFFER` ; le define est ajouté à l'effet, sinon toute la scène est vue comme infiniment loin.
- **Trace** : matériaux non éclairés, leur couleur est divisée par `renderer.toneMappingExposure` (`applyExposure`).
- **Soleil à l'heure de la sortie** (`settings.sunFromTrack`, actif par défaut) : quand la première trace est horodatée, la date
  d'éclairage est l'heure **enregistrée** du point sous le marqueur (`sunDateAt`), mise à jour à chaque image par
  `atmosphereRef.current.updateByDate(date)` dans `useFrame` (pas la prop `date` : les deux ne se combinent pas). Les points sans
  heure sont comblés par interpolation en distance (`recordedTimeAt`) ; une pause ou un saut entre segments est franchi
  instantanément. Sans horodatage ou option décochée : heure solaire fixe. La timeline affiche l'heure enregistrée au marqueur
  (fuseau du navigateur).
- **Exposition** (`src/scene/exposure.ts`) : `DAYLIGHT_EXPOSURE` (5) × 2^(automatique + `settings.exposureEv`). L'automatique
  s'ouvre quand le soleil descend : 0 IL au-dessus de 10°, +3 IL au crépuscule civil (−6°), +6 IL la nuit (−18°). Une faible
  lumière de ciel nocturne (`nightFillIntensity`) garde le relief lisible : l'atmosphère ne modélise que la lumière du soleil.
- **Réglages** : `settings.atmosphere` (désactivable : retour à l'éclairage fixe sans tone mapping) et `settings.sunHour`
  (heure **solaire** locale, 0 h–24 h, indépendante des fuseaux ; la nuit : étoiles et lune), le jour étant celui du début de la première trace
  (aujourd'hui à défaut).
- **Ombres portées du relief** (`src/scene/terrainShadow.ts`, `settings.shadows`, case « Ombres du relief » visible avec
  l'atmosphère) : le `SunLight` Takram reçoit une `TerrainShadow` (une carte d'ombre 4096², PCF via `shadows="percentage"`).
  Ses bornes orthographiques sont recalculées dans `updateMatrices(light, viewCamera)`, que three appelle juste avant de
  dessiner la carte : zone = frustum de vue coupé à max(30 km, 5 × hauteur de la caméra au-dessus du relief le plus bas),
  intersecté avec la boîte des tuiles visibles (`fitShadowFrustum`, pure et testée) ; plan proche repoussé vers le soleil
  jusqu'au sommet de cette boîte ; bornes arrondies par pas de 2^(1/8) et calées sur des texels entiers (pas de scintillement) ;
  biais selon le texel (normalBias 1,5 texel, profondeur 2 m). Texel ≈ 8–9 m en poursuite, 15–25 m en vue d'ensemble.
- **Projecteurs hors champ** (`engine.ts`) : toutes les tuiles projettent et reçoivent ; `frustumCulled` actif. Après la
  sélection LOD, les tuiles prêtes visitées mais hors frustum et non couvertes par une tuile dessinée restent `visible` : une
  crête derrière la caméra atteint la carte d'ombre, three les écarte de la passe principale. `stats.visibleTiles` ne compte que
  les tuiles dessinées.
- **Pourquoi des ombres** : sans occultation, un soleil rasant (~1° au coucher) éclaire le versant ensoleillé de chaque bosse des
  vallées censées être à l'ombre des crêtes — c'était l'origine des stries orange (N·L > 0 sur des facettes minces).
- Limites : rien hors de l'emprise chargée (trace + 25 km) ne projette ; ombres coupées net au-delà de la distance d'ombre (la
  brume le masque) ; une seule carte (pas de cascades) ; carte redessinée à chaque image.

## Couleur de la trace

- **Réglage** `settings.trackColorBy` : `'none'` (couleur propre de chaque trace, défaut), `speed`, `slope`, `elevation`,
  `heartRate`, `cadence`, `power`, `temperature`. Les grandeurs absentes de la première trace sont désactivées.
- **Valeurs** (`src/flyover/trackColor.ts`, pur), sur les points enregistrés : vitesse en km/h sur une fenêtre centrée d'au moins
  ±25 m **et** ±15 s (plafonnée à ±300 s) contre le bruit GPS ; pente en % sur ±50 m (inconnue sous 20 m) ; altitude ; capteurs
  moyennés sur ±5 s.
- **Plage** commune à toutes les traces : 2ᵉ–98ᵉ centile. **Palettes** séquentielles perceptuellement uniformes : viridis par
  défaut, magma (à partir de 0,2) pour FC, puissance et température. **Valeurs manquantes** : gris `#55626b`, jamais interpolées.
- **TrackLines** : couleurs par sommet (`LineGeometry.setColors`, `vertexColors` sur les matériaux plein et fantôme) ; les points
  insérés par `densify` sont interpolés (`resampleValues`). Changer de mode ne réécrit que le tampon de couleurs. Avec les
  couleurs par sommet, la couleur du matériau est le blanc divisé par l'exposition (`applyExposure`).
- **Légende** `TrackLegend` (au-dessus de la timeline, seulement si `trackColorBy !== 'none'`) : dégradé, bornes avec unités,
  pastille « Sans donnée » s'il manque des valeurs.

## Projet (phase 4)

- Un projet est un seul fichier JSON `<nom>.openflyover.json` (`format: "openflyover-project"`, `version`, `name`, `settings`,
  `playback.speed`, `tracks`). Les traces sont **embarquées** (fichier autonome) en colonnes par segment (`lon`, `lat`, puis
  `ele` / `time` / `hr` / `cad` / `power` / `temp` seulement si présents, `null` pour un point sans valeur), arrondies à 1e-7° et
  0,01 (ms entières pour le temps) ; stats et emprise recalculées au chargement par `buildTrack`, ids et couleurs conservés.
- Réglages traités **génériquement sur les clés de `DEFAULT_SETTINGS`** : chaque valeur est vérifiée contre le type de sa valeur
  par défaut (objets imbriqués compris), sinon retour au défaut pour cette clé ; clés inconnues ignorées. **Un nouveau réglage
  ne demande aucun code ici** ; ajouter une entrée à `SETTING_CHECKS` seulement si une valeur du bon type peut être invalide
  (énumération, id de catalogue, plage). Tout changement de format incrémente `PROJECT_VERSION` et ajoute `MIGRATIONS[n]`.
- **Historique** des réglages hors du store : abonné à `useAppStore`, chaque pas ne garde que les clés modifiées ; changements des
  mêmes clés à moins de 400 ms fusionnés (un glissé = un pas), un préréglage = un pas ; l'imagerie régionale choisie à l'import
  n'est pas enregistrée ; ouvrir un projet vide l'historique. Raccourcis Ctrl/Cmd+Z, Ctrl/Cmd+Maj+Z, Ctrl+Y (ignorés dans les
  champs texte).
- **Préréglages** dans `localStorage` (`openflyover.presets.v1`, repli en mémoire) ; une clé absente d'un préréglage garde sa
  valeur courante.

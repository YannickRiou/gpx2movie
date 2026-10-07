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
| `src/flyover/camera.ts` | caméra de survol | `computeCameraView(path, progress, frame, sampler, exaggeration, camera, durationS)`, `smoothedTurn` |
| `src/flyover/cameraSettings.ts` | styles et préréglages caméra | `CAMERA_STYLES`, `DEFAULT_CAMERA`, `CAMERA_RANGES`, `CAMERA_PRESETS`, `isValidCamera`, `advanceProgress(progress, dt, speed, durationS)` |
| `src/flyover/climbs.ts` | montées détectées | `detectClimbs`, `climbsOf(track)` (cache par trace), seuils exportés, `CATEGORY_THRESHOLDS` |
| `src/scene/labelModel.ts` + `labelSources.ts` | étiquettes 3D | `LandmarkLabel`, `LandmarkKind`, `LABEL_KIND_ACCENTS`, `labelOpacity`, `climbLabels`, `waypointLabels`, `resolveOverlaps`… ; `setLabelSource(id, labels)` (ids préfixés et uniques), `useLabelSources` |
| `src/flyover/pacing.ts` | rythme du survol | `buildPacing({ track, durationS, settings, landmarks })` → `totalTime`, `progressAtTime`, `timeAtProgress`, `positionAt`, `advance` ; `DEFAULT_PACING`, `PACING_RANGES`, `isValidPacing` |
| `src/flyover/sun.ts` | date du soleil | `solarHourToDate(dayMs, lon, solarHour)`, `sunDateAt(path \| null, progress, { sunFromTrack, solarHour, lon, dayMs }): Date` |
| `src/flyover/trackColor.ts` | trace colorée par une grandeur | `TRACK_COLOR_MODES`, `TrackColorBy`, `TRACK_METRICS` (libellé, unité, palette), `metricValues`, `trackMetricValues`, `hasMetric`, `robustRange`, `resampleValues`, `colorizeValues`, `VIRIDIS`, `MAGMA`, `MISSING_COLOR` |
| `src/scene/exposure.ts` | exposition sous l'atmosphère | `DAYLIGHT_EXPOSURE`, `sunElevation`, `autoExposureEv`, `sceneExposure(elevation, ev)`, `nightFillIntensity` |
| `src/weather/*` | météo historique de la sortie | `fetchOutingWeather(path, opts)`, `sampleLocations`, `outingDays`, `createWeatherCache`, `WeatherError`, `OPEN_METEO_ATTRIBUTION` ; `weatherAt(series, timeMs, lon, lat)`, `weatherWidgetData(series, path, progress)`, `summarizeOuting`, `describeWeatherCode`, `windFromLabel` ; `useWeatherStore`, `syncWeather` |
| `src/osm/*` | repères OpenStreetMap | `OVERPASS_ENDPOINTS`, `OSM_ATTRIBUTION`, `corridorBoxes`, `buildOverpassQuery`, `trackQuery`, `parseOverpass`, `runOverpassQuery`, `fetchTrackFeatures` ; `parseEle`, `projectOnPath`, `landmarkPriority`, `landmarkText`, `buildLandmarks`, `landmarkLabels`, `DEFAULT_LANDMARK_SETTINGS`, `LANDMARK_DISTANCE_RANGE` ; `useLandmarkStore`, `syncLandmarks`, `resetLandmarkStore` |
| `src/overlay/*` | habillage du film | `drawOverlay(ctx, frame, settings, size, assets)`, `prepareOverlayTrack(track, weather?)`, `overlayFrameAt(data, progress)`, `cardOpacityAt`, `miniMapOutline`, `DEFAULT_OVERLAY`, `isValidOverlay`, `withOverlayDefaults`, `loadLogo`, `loadOverlayFonts`, `createOverlayDrawer` (pont vers l'export), `OverlayCanvas` |
| `src/export/*` | export vidéo | `buildFrameSchedule`, `VIDEO_FORMATS`, `createVideoEncoder(canvas, options)`, `ExportCanceledError`, `settle`, `renderSettledFrame`, `composeFrame`, `useExportStore`, `videoFileName`, `ExportController` |
| `src/flyover/race.ts` | course fantôme | `RACE_SYNC_MODES`, `DEFAULT_RACE`, `isValidRace`, `prepareRaceTrack`, `raceTrackOf`, `positionAtTime`, `positionAtDistance`, `arrivalTime`, `buildRace`, `raceAt(race, progress)`, `rankRacers` ; `useRace`, `RaceMarkers` |
| `src/weather/sceneWeather.ts` + `src/scene/weatherEffect.ts` | météo dans la scène | `sceneConditionsAt`, `sceneWeatherAt`, `sceneWeatherFrom`, `CLEAR_SCENE_WEATHER`, `hazeExtinction` ; `WeatherEffect` |
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

Titres : Fraunces ; corps et boutons : IBM Plex Sans ; style d'habillage « diffusion » : IBM Plex Sans Condensed. Polices
**embarquées** (aucun accès réseau) : WOFF2 dans `public/fonts/` (Fraunces variable opsz + wght, IBM Plex Sans variable wght,
IBM Plex Sans Condensed 500/600/700), sous-ensembles `latin` et `latin-ext` déclarés par `unicode-range` dans
`src/ui/fonts.css` (importé par `src/main.tsx`) ; le navigateur ne télécharge un sous-ensemble que si un caractère l'exige.
Sources, versions et licences : `public/fonts/README.md`. `src/ui/fonts.test.ts` vérifie que chaque fichier référencé existe et
que chaque police dessinée (UI, habillage, étiquettes 3D) a sa face. Contraste texte ≥ 4.5:1.
Les couleurs de trace (`TRACK_COLORS`) sont choisies pour la lisibilité sur orthophoto, pas dans la charte.

## Survol (phase 2)

- **Lecture** (`store.playback { playing, progress, speed }`) : `progress` ∈ [0, 1] le long de la **première** trace, à vitesse
  au sol constante ; durée `settings.flyoverDurationS` à ×1 (60 s par défaut) quelle que soit la longueur. Atteindre 1 met en pause, relancer depuis la fin rembobine ;
  `requestFit` met en pause, retirer une trace remet à 0.
- **`FlyoverRig`** (dans `TerrainLayer`) : avance `progress` dans `useFrame`, place le marqueur (sphère blanche non éclairée,
  `depthTest: false`, taille écran constante) et pilote la caméra pendant la lecture ou quand `progress` change en pause
  (scrub) ; sinon l'orbite reste libre autour du marqueur.
- **Caméra** (`src/flyover/camera.ts`, `computeCameraView`) : fonction pure de (progression, réglages, échantillonneur de
  relief), sans état d'une image à l'autre, pour que l'export vidéo rende n'importe quelle image isolément. Cap = corde
  [d − w, d + w] (w = 2 % de la trace, 150 m–1,5 km, × lissage), distance automatique 4 % de la trace (600 m–4 km, × distance).
  Styles (`settings.camera.style`) : `chase` (derrière le marqueur), `sway` (balancement vers l'extérieur des virages :
  50° · tanh(0,8 · T / 50°), T = somme des angles de virage pondérée par une tente sur ±2w, continue et calme), `orbit` (6°/s
  autour du marqueur depuis le cap de départ), `top` (≥ 70°, distance × 2,5, nord ou cap en haut), `cinematic` (distance × 1,6,
  tangage / 2, balayage latéral ±35° de période 40 s). Tous gardent 80 m au-dessus du sol et une ligne de visée dégagée
  (13 échantillons) ; les tests vérifient la continuité en progression.
- **Réglages caméra** : `settings.camera { style, distance, pitchDeg, headingOffsetDeg, smoothing, northUp }` et préréglages
  nommés (`CAMERA_PRESETS` : Poursuite, Hélicoptère, Drone haut, Vue du dessus, Orbite, Cinéma) dans
  `src/flyover/cameraSettings.ts` ; `settings.flyoverDurationS` (15–600 s, 60 par défaut) = durée à ×1, la vitesse de la
  timeline s'y ajoute. Section « Caméra » (`src/ui/CameraPanel.tsx`). En pause, un changement de réglage caméra replace la caméra.
- **Rythme** (`src/flyover/pacing.ts`, pur ; `settings.pacing`, section « Caméra ») : la progression reste la fraction de
  distance, seul le lien temps du film → progression change. Temps forts : sommets des montées (`climbsOf`) et, parmi les repères
  OSM passés en argument, cols franchis (≤ 150 m) et sommets à ≤ 300 m. Vitesse relative
  r(x) = 1 − (1 − slowFactor)·max c(|x − h| / windowM), c = cosinus surélevé (creux le plus profond en cas de chevauchement).
  Temps de déplacement tabulé (vitesse constante par pas : inverse exact par dichotomie). Pauses : temps forts à moins de
  windowM regroupés, une pause par groupe, chacune ajoute exactement `pauseS` avec entrée et sortie en cosinus surélevé
  (≤ 1,5 s). `keepDuration` (défaut) relève la vitesse de base pour garder `flyoverDurationS` (pauses ≤ 50 % de la durée), sinon
  le film s'allonge. Désactivé ou sans temps fort : identique à `advanceProgress`. `FlyoverRig` garde le temps du film dans une
  référence (en pause la progression ne bouge pas) et se recale après un déplacement du curseur ; `usePacing`
  (`src/scene/usePacing.ts`) partage le calcul avec le panneau. L'export appelle `pacing.progressAtTime(t)` sur
  `pacing.totalTime()`.
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

## Météo historique (phase 7)

- **Source** : archive Open-Meteo (`archive-api.open-meteo.com/v1/archive`, sans clé, CC BY 4.0, gratuit en usage non
  commercial ; vérifications dans `docs/sources.md`). Attribution « Données météo : Open-Meteo.com (CC BY 4.0) » dans le panneau
  et la barre d'état dès que des données sont affichées.
- **Requête** (`src/weather/openMeteo.ts`) : 2 à 12 lieux le long de la première trace (un tous les ~10 km, départ et arrivée,
  arrondis à 0,01°, dédoublonnés par maille 0,05°), à l'**altitude enregistrée** (le paramètre `elevation` ramène la température
  à l'altitude de la trace : ~10 °C d'écart en montagne), sur les jours UTC de la sortie (±1 h) en une seule requête
  (`timezone=GMT`, `timeformat=unixtime`). Refusé sans requête : trace non horodatée, date future ou antérieure à 1940, sortie de
  plus de 31 jours. `visibility` est toujours nulle dans l'archive et n'est pas demandée.
- **Cache** : par lieu arrondi et jour UTC, en mémoire puis `localStorage` (`openflyover.weather.v1`, ≤ 300 jours-lieux, LRU,
  tout accès sous try/catch) ; les jours de moins de 7 jours ne sont pas persistés car l'archive les révise.
- **Série** (`src/weather/series.ts`, pur) : 13 variables horaires par lieu (NaN si manquante). `weatherAt` interpole
  linéairement en temps et par inverse de la distance au carré entre lieux (code WMO du lieu le plus proche, direction du vent
  en vecteur) ; les cumuls horaires valent pour l'heure qui se termine. `weatherWidgetData(series, path, progress)` donne les
  conditions sous le marqueur (heure enregistrée via `recordedTimeAt`), `summarizeOuting` le bilan pondéré par le temps réel.
  Codes WMO → libellé français + id d'icône.
- **État** (`src/weather/store.ts`) : `status` idle / loading / ready / unavailable / error, `message`, `series`, `trackId` ;
  `syncWeather` est appelé par le panneau à chaque changement de première trace ou de `settings.weather.enabled` (vrai par
  défaut), annule la requête précédente et explique l'absence de données.
- **À venir** : widget météo du film (`weatherWidgetData` est prêt) et pilotage de la scène — brume dérivée des nuages bas et des
  précipitations, atténuation du soleil et du ciel selon la nébulosité, nuages volumétriques (`@takram/three-clouds`, non
  installé), particules de pluie et de neige.

## Montées et étiquettes

- **Montées** (`src/flyover/climbs.ts`) sur les altitudes **enregistrées** de la première trace : rééchantillonnage tous les 20 m,
  moyenne glissante de 100 m, points hauts et bas confirmés par une hystérésis de 10 m, fusion de deux montées séparées par un
  creux ≤ 40 m (et ≤ 25 % du gain, sur ≤ 1,5 km) quand la seconde finit plus haut, extrémités plates rognées (< 2 % sur 200 m),
  seuils minimaux 500 m, 50 m de D+, 3 % de moyenne ; pente maximale sur 100 m. Catégorie selon le score longueur (m) × pente
  moyenne (%) : cat. 4 ≥ 8 000, 3 ≥ 16 000, 2 ≥ 32 000, 1 ≥ 64 000, HC ≥ 80 000 (non classée en dessous).
- **Waypoints** : `Track.waypoints?` (ajout optionnel au contrat) contient les `<wpt>` du GPX, rattachés à la première trace du
  fichier ; le document de projet les enregistre.
- **`Labels`** (dans `TerrainLayer`) : sprites WebGL à texture canvas (taille constante à l'écran, panneau encre, texte blanc,
  trait d'accent par type) pour le sommet de chaque montée, les waypoints et toute source externe enregistrée par
  `setLabelSource(id, LandmarkLabel[])` (ex. `'osm'`). Hauteur = terrain (ou altitude enregistrée) × exagération, replaquée sur
  `engine.onChange` (même debounce que la trace). Fondu quand la ligne de visée passe sous le relief (24 échantillons, ±20 m) et
  entre 35 et 70 km ; en cas de chevauchement, la priorité la plus haute l'emporte. Opacité fonction de la vue seule (pas de
  lissage temporel) : chaque image d'export est rendue isolément. Habillage actif : opacité multipliée par
  1 − `cardOpacityAt(progression, settings.overlay)` (`labelOpacity`), les étiquettes s'effacent derrière les cartes d'ouverture
  et de clôture. Réglage `settings.labels { climbs, waypoints }`, section
  « Montées » (`ClimbList`, un clic place le survol au pied de la montée).

## Repères OpenStreetMap (phase 7)

- **Source** : OpenStreetMap par l'API Overpass publique (`overpass-api.de`, repli VK Maps), sans clé, données ODbL (attribution
  « © contributeurs OpenStreetMap (ODbL) » dans le panneau et la barre d'état). Vérifications et conditions d'usage :
  `docs/sources.md`. La requête doit rester « simple » (POST `application/x-www-form-urlencoded`) : la pré-vérification CORS
  répond 406.
- **Une requête par trace** (`src/osm/overpass.ts`) : boîte englobante de la trace élargie de 3 km (plusieurs boîtes consécutives
  au-delà de 40 km d'emprise), 8 instructions taguées et nommées (sommets / selles, cols, refuges, lacs, cascades, villages et
  hameaux, points de vue, glaciers), `out center` pour ramener chemins et relations à un point. La forme `around:` sur une
  polyligne dépasse le délai du serveur public ; la distance à la trace est calculée localement, donc changer les types ou la
  distance ne refait jamais de requête. File d'attente (une requête à la fois), cache mémoire + `localStorage` 30 jours par
  empreinte de requête, un réessai sur 429 / 504 (`Retry-After`, sinon 15 s) puis l'autre instance ; une réponse 200 portant un
  `remark` d'erreur (délai dépassé) est une erreur.
- **Post-traitement pur** (`src/osm/landmarks.ts`) : projection sur le chemin → distance et abscisse, filtre par type et distance
  (`settings.landmarks`, défaut sommets + cols + refuges + lacs à 1,5 km), altitude depuis `ele` (formats libres), priorité dans
  [0, 50) sous les waypoints et les montées (col franchi > sommet haut et proche > col voisin > refuge > lac > cascade / vue /
  glacier > lieu), dédoublonnage par nom à moins d'1 km, plafond de 40 repères, libellé « Nom · 1 653 m » pour sommets et cols.
- **État** (`src/osm/store.ts`) : `useLandmarkStore` piloté par `syncLandmarks` depuis `LandmarkPanel` ; les repères de toutes les
  traces sont publiés aux étiquettes 3D par `setLabelSource('osm', …)` (liste vide à la désactivation). La liste du panneau suit
  la première trace (clic = `setProgress`).

## Habillage du film (phase 4)

- **Principe** : l'habillage n'est pas du DOM. Une fonction pure et synchrone, `drawOverlay(ctx, frame, settings, size, assets)`
  (`src/overlay/draw.ts`), le dessine sur un contexte 2D, à l'écran ou hors écran. L'aperçu (`OverlayCanvas`, canvas 2D au-dessus
  du canvas 3D et sous la timeline, sans événements souris) et l'export vidéo (`exportOverlay.ts` → `ExportController`) appellent
  la même fonction : le film montre exactement l'aperçu.
- **Unités** : 1 u = 1 % du plus petit côté de l'image ; marges de sécurité de 5 % de chaque côté ; flous d'ombre corrigés de la
  transformation du contexte (devicePixelRatio). Les widgets qui partagent l'une des 9 ancres s'empilent.
- **Données** (`data.ts`) : `prepareOverlayTrack(track, weather?)` une fois par trace : chemin, D+ cumulé (même lissage et même
  hystérésis de 3 m que `computeStats`, donc la dernière valeur vaut `stats.ascentM`), vitesse et fréquence cardiaque lissées,
  profil, statistiques de clôture, résumé météo, contour de la mini-carte (`miniMapOutline` : projection équirectangulaire
  locale, x est / y sud, plus grand côté = 1, proportions conservées, au plus 1 500 points). `overlayFrameAt(data, progress)` est
  une fonction pure de la progression (dont `mapPoint`, la position du marqueur sur la mini-carte).
- **Réglages** : `settings.overlay` (`src/overlay/settings.ts`, désactivé par défaut) : style (`editorial`, `broadcast`, `app`) et
  widgets — carte d'ouverture, carte de clôture, compteurs, profil, mini-carte (flèche du nord en option), logo, texte libre,
  météo — chacun avec `enabled`, `anchor`, `size`. Les widgets ajoutés après le premier format (`minimap`) sont complétés par
  leur défaut avant validation (`withOverlayDefaults`, via `SETTING_UPGRADES` dans `src/project/document.ts`) : anciens projets
  et préréglages se chargent toujours. Les temps sont des fractions du survol (fondus de 1 % et 2,5 %) ; les widgets en direct s'effacent pendant les cartes.
  Logo en data URL PNG d'au plus 512 px (projets autonomes). Validation : `isValidOverlay` (`SETTING_CHECKS`).
- **Polices** : un canvas ne déclenche pas seul le téléchargement des polices web ; `loadOverlayFonts()` les demande avant la
  première image, l'export doit l'attendre aussi. Polices embarquées (`src/ui/fonts.css`, `public/fonts/`) :
  Fraunces 300–700, IBM Plex Sans et Sans Condensed disponibles hors ligne.
- **Météo** : widget et ligne de la carte de clôture (`weatherWidgetData`, `summarizeOuting`), avec le crédit Open-Meteo dessiné
  en bas de l'image dès qu'ils sont visibles.

## Export vidéo (phase 5)

- Le survol étant une fonction pure de `playback.progress`, un film est une liste de progressions (`buildFrameSchedule` : rampe
  0 → 1 sur `durée × fps` images, plus 1 s tenue au début et 2 s à la fin). `ExportController` (dans `TerrainLayer`) exécute la
  demande déposée dans le store d'export (`src/export/store.ts`, distinct du store de l'application) : lecture en pause,
  `frameloop 'never'`, rendu et caméra à la taille de la vidéo avec un ratio de pixels de 1 (réappliqués avant chaque rendu ;
  canvas affiché en letterbox pendant l'export), pointeur désactivé.
- Le calendrier suit le rythme du survol : la rampe dure `pacing.totalTime()` et l'image k montre
  `pacing.progressAtTime(k / (n − 1) × durée)` (ralentis et pauses aux temps forts comme dans l'aperçu ; les images de pause
  réutilisent l'image déjà composée).
- Pour chaque progression, `advance` jusqu'à ce qu'aucune tuile ne soit en attente, que le terrain n'ait pas changé depuis
  250 ms (replaquage de la trace) et qu'au moins 3 images aient été rendues (limite 10 s par image, comptée « incomplète ») ;
  si des tuiles sont arrivées après le placement de la caméra, la progression est décalée de 1e-9 pour la replacer sur le relief
  final (une seule fois, jamais après un dépassement de délai).
- L'image WebGL est composée dans la même tâche que le rendu sur un `OffscreenCanvas` (dégradé de ciel, image, puis habillage
  `drawOverlay(ctx, progress, w, h)` après chargement de ses polices), puis encodée par mediabunny (WebCodecs) : MP4 H.264,
  sinon MP4 HEVC, WebM VP9, WebM VP8, le premier accepté par `VideoEncoder.isConfigSupported` ; débit = pixels × fps × 0,06 /
  0,10 / 0,16 bit selon la qualité, corrigé par codec, borné à 1–80 Mbit/s ; image-clé toutes les 2 s ; fichier en mémoire.
- Tout est restauré en fin d'export, en cas d'erreur ou d'annulation (taille, ratio de pixels, frameloop, pointeur,
  progression). Réglage `settings.video { format, fps, quality }` dans le document de projet. Formats : 16:9 (720p, 1080p, 4K),
  9:16, 1:1, 4:5 ; 24 / 30 / 60 i/s.
- Limites : vitesse (au moins 3 rendus par image plus l'attente des tuiles), fichier gardé en mémoire (~2× sa taille), tailles
  d'étiquettes en pixels CSS (plus petites en 4K), onglet à garder ouvert.

## Météo dans la scène (phase 7)

- `src/weather/sceneWeather.ts` (pur ; `settings.weatherScene { enabled, strength }`, case « Météo dans la scène » visible avec
  l'atmosphère et une météo chargée) : à chaque image, la météo sous le marqueur à la date du soleil (`sceneConditionsAt` :
  nébulosités interpolées, cumuls horaires et brouillard WMO 45/48 recentrés au milieu de leur heure puis interpolés) donne
  `sunScale`, `skyScale`, `hazeScale`, `hazeHeightM`, `shadowStrength`, `exposureCompensationEv`, `desaturation`, `skyVeil`
  (formules en tête de `sceneWeatherFrom`, bornées, identité par ciel clair, sans données ou réglage coupé ; `strength` mélange
  vers l'identité). Fonction pure de la progression : l'export reste déterministe.
- Application (`AtmosphereLayer`) : intensités du `SunLight` et du `SkyLight`, `shadow.intensity`, compensation ajoutée à
  l'exposition ; sous le voile, les coefficients SH de la lumière du ciel tendent vers leur luminance.
- `WeatherEffect` (`src/scene/weatherEffect.ts`, après la perspective aérienne, même `EffectPass`) : l'effet Takram n'a pas de
  réglage de densité, d'où une brume en hauteur exponentielle (β0 = 3,912·(hazeScale − 1)/60 km au sol sous le marqueur,
  intégrale analytique le long du rayon), ciel voilé, lointain ramené au gris sous le voile, désaturation ; profondeur
  logarithmique lue comme dans l'effet Takram ; uniformes préfixés `weather*`.
- Limites : météo d'un seul point appliquée à toute la scène ; pas de nuages visibles (voile seulement) — nuages volumétriques
  possibles avec `@takram/three-clouds` (coût élevé, reprojection temporelle à neutraliser à l'export).

## Course fantôme (phase 7)

- La progression reste la fraction de distance de la première trace (suivie par la caméra) ; chaque autre trace reçoit un
  marqueur placé par `raceAt(race, progression)`, fonction pure. Réglage `settings.race { enabled, sync }`, bloc « Course
  fantôme » de la liste des traces (à partir de deux traces).
- Synchronisation : `elapsed` (même temps écoulé depuis chaque départ), `clock` (même heure enregistrée ; attente au départ,
  arrêt à l'arrivée), `distance` (même fraction de chaque trace). Les deux premiers exigent des horodatages sur toutes les
  traces, sinon repli sur `distance`.
- Tables temps ↔ distance par trace (points sans heure comblés, horloge rendue monotone), requêtes par dichotomie. Écarts du
  classement comparés à fraction égale (exacts sur un même parcours) ; affichage « +1 min 20 », « −350 m ».
- `RaceMarkers` (après `FlyoverRig` dans `TerrainLayer`) : sphère à la couleur de la trace avec halo encre, même taille écran que
  le marqueur principal. Limite : les arrêts de la trace de tête sont franchis instantanément (la lecture avance en distance).

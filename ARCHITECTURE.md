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
| `src/scene/*.tsx` | composants R3F | `FlyoverCanvas`, `TerrainLayer` (+ `useTerrainContext`), `TrackLines`, `TrackPicker` (+ `TrackMenu`, DOM), `CameraRig`, `FlyoverRig`, `useDebouncedCallback` |
| `src/flyover/path.ts` | chemin de survol | `buildTrackPath(track): TrackPath` (segments concaténés, distances cumulées, `time` en ms ou NaN), `samplePath(path, distanceM): PathSample` (`ele` et `time` interpolés seulement si les deux voisins les ont), `recordedTimeAt(path, distanceM)` (comble les points sans heure), `elevationProfile(path, samples)`, `nearestOnPath(path, lonLat, timeMs?)`, `distanceAtTime(path, timeMs, toleranceMs?)`, `pickProjectedPath(screen, distM, px, py, maxPx)` (point de la trace projetée le plus proche du pointeur) |
| `src/flyover/camera.ts` | caméra de survol | `computeCameraView(path, progress, frame, sampler, exaggeration, camera, durationS)`, `smoothedTurn` |
| `src/flyover/cameraSettings.ts` | styles et préréglages caméra | `CAMERA_STYLES`, `DEFAULT_CAMERA`, `CAMERA_RANGES`, `CAMERA_PRESETS`, `isValidCamera`, `advanceProgress(progress, dt, speed, durationS)` |
| `src/flyover/climbs.ts` | montées détectées | `detectClimbs`, `climbsOf(track)` (cache par trace), seuils exportés, `CATEGORY_THRESHOLDS` |
| `src/scene/labelModel.ts` + `labelSources.ts` | étiquettes 3D | `LandmarkLabel`, `LandmarkKind`, `LABEL_KIND_ACCENTS`, `labelOpacity`, `climbLabels`, `waypointLabels`, `resolveOverlaps`… ; `setLabelSource(id, labels)` (ids préfixés et uniques), `useLabelSources` |
| `src/flyover/pacing.ts` | rythme du survol | `buildPacing({ track, durationS, settings, landmarks })` → `totalTime`, `progressAtTime`, `timeAtProgress`, `positionAt`, `advance` ; `flightPacing(lengthM, highlightsM, durationS, settings, stops)` (pauses données par le film) ; `pausePositions`, `isHighlightLandmark`, `DEFAULT_PACING`, `PACING_RANGES`, `isValidPacing` |
| `src/film/*` | film et timeline (pur) | `Film`, `DEFAULT_FILM`, `isValidFilm`, `withFilmDefaults`, `nextFilmId`, `shotDurationS` ; `autoStops`, `stopCandidates`, `materializeStops`, `assembleFilm`, `filmStops` ; `buildFilmClock`, `filmClockInputFor`, `filmClockFor` → `FilmClock` (`stateAt`, `totalTime`, `progressAtTime`, `timeAtProgress`, `advance`) ; `timeline.ts` : échelle, règle, aimantation, `dragFilm`, `stopPositionAt`, ajouts / retraits (`removeFilmItem` passe un plan à « aucune »), `hasFilmItem`, `addPhotos`, `updateMedia`, `photoFilmTime` ; `exif.ts` : `parseExif`, `photoTimeMs` ; `media.ts` (seul module non pur du dossier) : `MediaAsset`, `MediaTable`, `sanitizeMediaTable`, `usedMedia`, `useMediaStore`, `readPhoto`, `createMediaBitmaps`, `getMediaBitmaps`, `mediaToLoad` |
| `src/flyover/filmCamera.ts` | caméra du film | `computeFilmView(path, clock, timeS, progress, frame, sampler, options)`, `overviewView`, `blendViews`, `shotBlend`, `stopOrbitRad`, `filmViewMovesWithTime` |
| `src/flyover/sun.ts` | date du soleil, lever / coucher | `solarHourToDate(dayMs, lon, solarHour)`, `solarHourOf(dayMs, lon, date)`, `sunDateAt(path \| null, progress, { sunFromTrack, solarHour, lon, dayMs }): Date`, `sunTimes(lat, lon, date)` → `{ sunrise, sunset, solarNoon, polar }`, `solarDay`, `SUN_CHIPS`, `sunChipHour(chip, day)` |
| `src/flyover/trackColor.ts` | trace colorée par une grandeur | `TRACK_COLOR_MODES`, `TrackColorBy`, `TRACK_METRICS` (libellé, unité, palette), `metricValues`, `trackMetricValues`, `hasMetric`, `robustRange`, `resampleValues`, `colorizeValues`, `VIRIDIS`, `MAGMA`, `MISSING_COLOR` |
| `src/scene/exposure.ts` | exposition sous l'atmosphère | `DAYLIGHT_EXPOSURE`, `sunElevation`, `autoExposureEv`, `sceneExposure(elevation, ev)`, `nightFillIntensity` |
| `src/weather/*` | météo historique de la sortie | `fetchOutingWeather(path, opts)`, `sampleLocations`, `outingDays`, `createWeatherCache`, `WeatherError`, `OPEN_METEO_ATTRIBUTION` ; `weatherAt(series, timeMs, lon, lat)`, `weatherWidgetData(series, path, progress)`, `summarizeOuting`, `describeWeatherCode`, `windFromLabel` ; `useWeatherStore`, `syncWeather` |
| `src/osm/*` | repères OpenStreetMap | `OVERPASS_ENDPOINTS`, `OSM_ATTRIBUTION`, `corridorBoxes`, `buildOverpassQuery`, `trackQuery`, `parseOverpass`, `runOverpassQuery`, `fetchTrackFeatures` ; `parseEle`, `projectOnPath`, `landmarkPriority`, `landmarkText`, `buildLandmarks`, `landmarkLabels`, `DEFAULT_LANDMARK_SETTINGS`, `LANDMARK_DISTANCE_RANGE` ; `useLandmarkStore`, `syncLandmarks`, `resetLandmarkStore` |
| `src/overlay/*` | habillage du film | `drawOverlay(ctx, frame, settings, size, assets)`, `prepareOverlayTrack(track, weather?)`, `overlayFrameAt(data, progress)`, `cardOpacityAt`, `miniMapOutline`, `DEFAULT_OVERLAY`, `isValidOverlay`, `withOverlayDefaults`, `loadLogo`, `loadOverlayFonts`, `createOverlayDrawer` (pont vers l'export), `OverlayCanvas` |
| `src/export/*` | export vidéo | `buildFrameSchedule`, `VIDEO_FORMATS`, `createVideoEncoder(canvas, options)`, `ExportCanceledError`, `settle`, `renderSettledFrame`, `composeFrame`, `useExportStore`, `videoFileName`, `ExportController` |
| `src/flyover/race.ts` | course fantôme | `RACE_SYNC_MODES`, `DEFAULT_RACE`, `isValidRace`, `prepareRaceTrack`, `raceTrackOf`, `positionAtTime`, `positionAtDistance`, `arrivalTime`, `buildRace`, `raceAt(race, progress)`, `rankRacers` ; `useRace`, `RaceMarkers` |
| `src/weather/sceneWeather.ts` + `src/scene/weatherEffect.ts` | météo dans la scène | `sceneConditionsAt`, `sceneWeatherAt`, `sceneWeatherFrom`, `CLEAR_SCENE_WEATHER`, `hazeExtinction` ; `WeatherEffect` |
| `src/project/*` | document de projet, historique, préréglages | `serializeProject(state, name)`, `parseProject(text): LoadedProject`, `sanitizeSettings(raw, base)`, `SETTING_CHECKS`, `migrateProject`, `MIGRATIONS`, `applyProject`, `applySettings`, `createHistory`, `getSettingsHistory`, `installHistoryShortcuts`, `installSliderGestures`, `createPresetStore`, `getPresetStore`, `presetSettings` |
| `src/state/store.ts` | état zustand | `useAppStore`, `Settings`, `Playback`, `AppState`, `resetAppStore` |
| `src/ui/*` + `src/App.tsx` | interface | `App` (coque) ; `shell.ts` (pur, testé : `frameRect`, `shellShortcut`, `routeOpenedFiles`, `nextTabIndex`, `nextGridIndex`, `shellReducer`, `parseShellPrefs`, `effectiveProjectName`, `isProjectDirty`) ; `TopBar`, `Stage`, `icons.tsx` (`Icon`, `AspectIcon`) ; `projectActions.ts` (`saveProject`, `openProject`, `importTrackFiles`, `loadSample`) ; `importFlow.ts` (orchestration d'import sans React, testée) |

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
   `fitRequest` (compteur incrémenté pour demander un recadrage), `loading` (les échecs d'import passent par les messages, voir « Interface »). À l'import, l'imagerie bascule automatiquement sur
   IGN puis swisstopo si la trace est entièrement dans leur emprise, sauf si l'utilisateur a déjà choisi une source à la main.
9. **UI** (`ui/`) : voir « Interface » (coque, onglets, barre du haut, tiroir d'export, bande d'état). Libellés en
   français. Charte : `src/ui/theme.css`.

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

## Interface

Coque sombre (encre) autour de panneaux clairs (papier), dans les jetons « Carte alpine ». Mise en page : `src/ui/shell.css`
(composants des panneaux : `app.css`). Jetons ajoutés à `theme.css` : surfaces sémantiques (`--surface-chrome`,
`--surface-panel`, `--surface-card`, `--text-1`, `--text-2`, `--line`, simples alias des couleurs actuelles : une variante
sombre ne serait qu'un remappage), gabarits (`--topbar-h` 48, `--rail-w` 56, `--panel-w` 320, `--dock-w` 300,
`--statusbar-h` 24, `--control-h` 32, `--space-6`), `--shadow-pop`, `--focus-ring-on-dark` (orange clair, 6,3:1 sur l'encre).

- **Barre du haut** (`TopBar.tsx`) : logo, nom du projet modifiable sur place (`projectName` du store, vide = nom de la
  première trace, `effectiveProjectName`) et état « Modifié / Enregistré » (`savedProject` : réglages, traces et nom au
  dernier enregistrement ou à la dernière ouverture, comparés par référence, `isProjectDirty` ; pas d'enregistrement
  automatique), annuler / rétablir, « Ouvrir » (un seul sélecteur : `.json` → projet, le reste → import de traces,
  `routeOpenedFiles` ; ouvrir un projet vide l'historique), « Enregistrer » ; au centre le **format de sortie** (Libre,
  16:9, 9:16, 1:1, 4:5, 21:9) ; à droite « ? » (raccourcis) et « Exporter », seul bouton principal de la coque, qui ouvre
  le tiroir d'export et devient « 42 % · Annuler » pendant un export.
- **Format de sortie** : un format écrit `settings.video.aspect` (enregistré, annulable) ; « Libre » est un drapeau
  d'aperçu (`freeFraming` du store, ni enregistré ni annulable). Hors « Libre », `Stage.tsx` cadre la vue 3D au format
  (`frameRect`, bandes encre) : `.view__stage`, qui porte le canvas 3D, l'habillage et la légende, prend le rectangle
  cadré ; l'habillage suit donc l'aire exportée sans changement de `src/overlay`. L'export rend dans ce canvas visible.
  Sans trace, pas de cadrage : la carte d'accueil (`EmptyState.tsx`) occupe le centre de la vue (« Choisir un fichier »,
  « Essayer avec l'exemple (Tour du Mont-Blanc) », « Ouvrir un projet… », un seul sélecteur dont `accept` change).
- **Rail et panneau** : rail vertical d'icônes (`tablist`, focus itinérant, flèches / Origine / Fin, infobulles) et un
  panneau de 320 px, un onglet à la fois : **Trace** (liste des traces avec « + Ajouter », message d'attente sans trace,
  Montées et Météo repliables), **Carte** (réglages de la scène, repères OSM), **Survol** (caméra, rythme),
  **Habillage**, **Projet** (préréglages). Tous les onglets restent montés (`hidden`) : météo, repères et export ont des
  effets de bord. Sections à plat séparées d'un filet, en-tête de section collant (titre + « modifié / Par défaut »). Un clic
  sur l'onglet ouvert, le bouton du bas du rail ou `[` replient le panneau. Onglet et repli mémorisés par le navigateur
  (`localStorage` `openflyover.shell.v1`, `parseShellPrefs`), pas par le projet.
- **Dock droit** (300 px) : tiroir d'export non modal (`ExportPanel` : formats en tuiles, résolution, estimation, « Exporter
  la vidéo », « Image fixe », « Plus d'options » : images par seconde, qualité, type d'image) ; sinon l'**inspecteur** du bloc
  sélectionné sur la timeline (`FilmInspector`, deux `<aside class="dock">` dont un seul visible : le tiroir passe devant,
  l'inspecteur revient à sa fermeture si le bloc est encore sélectionné). Sous 1360 px de large, un seul côté ouvert à la
  fois : ce qui remplit le dock (tiroir ou inspecteur) replie le panneau, qui revient quand le dock se vide ; déplier le
  panneau vide le dock et désélectionne le bloc (`shellReducer` : `inspecting`, événement `inspect`, que `App` envoie quand
  `filmSelection` change, après le relâcher d'un appui : la timeline ne change pas d'échelle sous un glisser).
- **Pendant un export** : onglets, repli du panneau, format, « Ouvrir », « Recadrer », annuler / rétablir (boutons) et
  fermeture du tiroir sont désactivés (redimensionner la scène redimensionnerait le canvas).
- **Vue** : bouton flottant « Recadrer la vue » (F) ; clic sur la trace et menu du clic droit (`TrackPicker`, voir « Film et
  timeline »).
- **Messages** (`toast.ts`, `Toaster.tsx`) : petit store zustand (`showToast`, `dismissToast`, `pushToast` pur : le même
  message remplace l'ancien, 4 au plus, l'erreur la plus ancienne part en dernier), affichés en bas au centre de la vue,
  au-dessus de la timeline, dans une seule région `aria-live` toujours montée. Succès et info disparaissent après
  `toastDuration` (5 s, jusqu'à 12 s pour un long texte), minuterie suspendue au survol ou au focus ; erreurs en
  `role="alert"`, jusqu'à fermeture ; bouton d'action facultatif. Sources : import (`importFiles` de `importFlow.ts`, lié
  au store par `projectActions.ts` : « Trace « … » importée », échecs), projet ouvert / enregistré / avertissements du
  fichier, préréglages (enregistré, « Préréglage appliqué : … »), export (« Vidéo prête · Télécharger à nouveau », « Image
  prête », échec, « Export annulé »), « Réglages remis par
  défaut · Annuler » (`resetSettings` renvoie une annulation gardée : elle n'agit que si les réglages sont encore ceux du
  retour, donc jamais sur une étape postérieure ni antérieure ; le message disparaît au changement suivant des réglages).
  Aussi les photos ajoutées sur la timeline (« Placer sur le parcours » en action).
- **Dépôt partout** : `dragover` / `drop` sur `window` (dans `App`) : fichiers `.gpx` / `.fit` importés, `.json` ouvert
  comme projet (`openFiles`, routage `routeOpenedFiles`), voile plein écran « Déposez vos traces GPX ou FIT »
  (`pointer-events: none`) pendant le glissement (`isFileDrag`). Un dépôt déjà traité (`defaultPrevented` : la timeline
  prend les photos) est laissé tel quel, et le voile s'efface au-dessus de la timeline ; rien n'est accepté pendant un export.
- **Bande d'état** (24 px, sous la timeline) : tuiles, import en cours, attributions sur une ligne (`overlayCredits`,
  mêmes chaînes que dans le film) et ⓘ qui ouvre « Sources et licences » (`<dialog>`).
- **Raccourcis** (`src/ui/shortcuts.ts`) : registre `SHORTCUTS` (id, touches, libellé, groupe Lecture / Montage / Projet /
  Vue) affiché par la boîte « Raccourcis clavier » (`HelpDialog.tsx`, `<dialog>` natif, « ? » ou le bouton de la barre)
  et repris dans les infobulles (`withShortcut`). `matchShortcut(touche, keyFocus(cible))`, pur : Ctrl/Cmd+S enregistrer,
  Ctrl/Cmd+O ouvrir, Ctrl/Cmd+E tiroir d'export, F recadrer, S arrêt au marqueur, T texte à la tête de lecture, `[` replier
  et `?` aide (AltGr / Maj acceptés), Échap, ← / →
  (Maj : 5 s, `seekTime`), Début / Fin ; rien dans un champ texte ou une liste (`isTextEntry`), ni flèches ni Début / Fin
  sur un contrôle qui s'en sert (curseur, radio, onglet, règle de la timeline). Pas de raccourci à chiffre (AZERTY). `App`
  écoute en phase de capture (aucun raccourci tant qu'une boîte modale est ouverte) ; Échap ferme dans l'ordre la boîte
  (native), le tiroir d'export, puis la sélection de la timeline (dans un champ de l'inspecteur aussi) ; un menu ouvert
  (« Options » de la timeline, clic droit sur la trace : `data-local-escape`) se ferme d'abord lui-même. Le déplacement de
  la tête de lecture et S / T vivent dans `SeekShortcuts` (composant sans rendu, horloge du film, phase de bulle : un bloc
  sélectionné garde ses flèches).
  `installHistoryShortcuts` (Ctrl/Cmd+Z, Ctrl/Cmd+Maj+Z, Ctrl+Y) et Espace (timeline) restent à leur place.
- **Infobulles** : `data-tip` en CSS (`shell.css`), après 450 ms, au survol et au focus clavier, sur chaque bouton à icône
  seule ; `data-tip-side` (`top`, `left`, `right`) et `data-tip-align` (`start`, `end`) près des bords de la fenêtre ou
  d'une colonne qui défile. Les blocs de la timeline gardent leur `title` (libellé complet, un pseudo-élément serait coupé
  par le bloc).
- **Largeurs** : à 1280 px panneau et dock passent à 280 px et « Ouvrir / Enregistrer » à l'icône seule ; sous 1024 px le
  panneau devient un tiroir au-dessus de la vue ; sous 700 px les onglets passent dans une barre en bas, panneau et tiroir
  d'export en feuilles au-dessus, sans sélecteur de format dans la barre (les tuiles du tiroir restent).
- **Sections des onglets Carte et Survol** (`PanelSection.tsx`) : `PanelSection` = section repliable à plat (classes `fold`,
  en-tête collant : titre, « modifié / Par défaut » de ses clés, chevron), ouverte au départ. Carte : « Fond de carte »
  (imagerie), « Relief et trace » (exagération, couleur de la trace), « Lumière », « Atmosphère et météo » (atmosphère,
  ombres, météo dans la scène), puis « Repères (OpenStreetMap) » (`LandmarkPanel`, absente sans trace). Survol : « Caméra » (préréglage, style en tuiles à icônes, nord en haut),
  « Durée et rythme » (durée, durée du film, ralentis oui / non). Les réglages rares sont dans `MoreSettings` (« Plus de
  réglages », `<details>` fermé) : détail imagerie, source du relief, filaire, exposition, intensité de la météo, distance /
  inclinaison / visée / lissage, temps forts et paramètres du rythme. Son résumé porte « modifié » quand un réglage caché
  s'écarte du défaut (`modifiedPaths(settings, paths)` de `project/apply.ts`, chemins `'clé'` ou `'clé.champ'`). Clés des
  réglages et comportement inchangés. `InfoTip` (ⓘ, infobulle `data-tip` d'une phrase, focusable, `aria-label`) seulement
  sur le jargon : exagération, filaire, exposition, temps forts. Styles : bloc délimité en fin de `app.css`.
- **Lumière** : bascule « Suivre la trace » (= `sunFromTrack`, désactivée avec une explication sans horodatage) / « Heure
  fixe ». En heure fixe : curseur de l'heure solaire au-dessus d'une barre nuit / aube / jour / crépuscule avec les repères
  du lever et du coucher (`solarDay` au point d'origine du repère local et au jour UTC du début de la première trace, comme la
  scène ; journée type 6 h – 18 h sans trace) ; le texte sous la barre donne lever et coucher à l'heure locale quand la
  première trace connaît son décalage UTC (`Track.utcOffsetMin`, `clockHourOfSolar`), avec l'heure solaire entre
  parenthèses, sinon en « heure solaire » seulement (pas de base de fuseaux horaires), et six raccourcis « Lever » (premier quart d'heure après le lever), « Matin »
  (mi-chemin vers midi), « Midi », « Heure dorée » (1 h avant le coucher), « Coucher » (dernier quart d'heure avant),
  « Nuit » (minuit solaire), grisés quand le moment n'existe pas (jour ou nuit polaire). Chaque raccourci est une étape
  d'annulation (`transaction`) ; un glissé du curseur en est une (voir « Historique »).
- **Icônes** : tracés Lucide (ISC, mention dans l'en-tête de `src/ui/icons.tsx`), SVG en ligne, seulement celles utilisées ;
  cadres des formats dessinés d'après le ratio (`AspectIcon`).

## Survol (phase 2)

- **Lecture** (`store.playback { playing, progress, timeS, speed }`) : `progress` ∈ [0, 1] le long de la **première** trace, à vitesse
  au sol constante ; durée `settings.flyoverDurationS` à ×1 (60 s par défaut) quelle que soit la longueur. `timeS` = temps du
  film (s à ×1, rythme compris) quand la lecture ou l'export le fixent, `null` après un déplacement de l'extérieur (curseur,
  montées, repères : il se déduit alors de la progression par le rythme). Atteindre 1 sans temps du film met en pause, relancer
  depuis la fin rembobine ; `requestFit` met en pause, retirer une trace remet à 0.
- **`FlyoverRig`** (dans `TerrainLayer`) : avance `progress` dans `useFrame`, place le marqueur (sphère blanche non éclairée,
  `depthTest: false`, taille écran constante) et pilote la caméra pendant la lecture ou quand `progress` change en pause
  (scrub) ; sinon l'orbite reste libre autour du marqueur.
- **Caméra** (`src/flyover/camera.ts`, `computeCameraView`) : fonction pure de (progression, temps du film, réglages,
  échantillonneur de relief), sans état d'une image à l'autre, pour que l'export vidéo rende n'importe quelle image isolément.
  Orbite et cinéma (`movesWithTime`) suivent le temps du film (`timeS`, à défaut progression × durée) et continuent donc de
  tourner pendant les pauses du rythme ; les autres styles ne dépendent que de la progression. Cap = corde
  [d − w, d + w] (w = 2 % de la trace, 150 m–1,5 km, × lissage), distance automatique 4 % de la trace (600 m–4 km, × distance).
  Styles (`settings.camera.style`) : `chase` (derrière le marqueur), `sway` (balancement vers l'extérieur des virages :
  50° · tanh(0,8 · T / 50°), T = somme des angles de virage pondérée par une tente sur ±2w, continue et calme), `orbit` (6°/s
  autour du marqueur depuis le cap de départ), `top` (≥ 70°, distance × 2,5, nord ou cap en haut), `cinematic` (distance × 1,6,
  tangage / 2, balayage latéral ±35° de période 40 s). Tous gardent 80 m au-dessus du sol et une ligne de visée dégagée
  (13 échantillons) ; les tests vérifient la continuité en progression.
- **Réglages caméra** : `settings.camera { style, distance, pitchDeg, headingOffsetDeg, smoothing, northUp }` et préréglages
  nommés (`CAMERA_PRESETS` : Poursuite, Hélicoptère, Drone haut, Vue du dessus, Orbite, Cinéma) dans
  `src/flyover/cameraSettings.ts` ; `settings.flyoverDurationS` (15–600 s, 60 par défaut) = durée à ×1, la vitesse de la
  timeline s'y ajoute. Onglet « Survol » (`src/ui/CameraPanel.tsx`, sections « Caméra » et « Durée et rythme »). En pause, un changement de réglage caméra replace la caméra.
- **Rythme** (`src/flyover/pacing.ts`, pur ; `settings.pacing`, section « Caméra ») : la progression reste la fraction de
  distance, seul le lien temps du film → progression change. Temps forts : sommets des montées (`climbsOf`) et, parmi les repères
  OSM passés en argument, cols franchis (≤ 150 m) et sommets à ≤ 300 m. Vitesse relative
  r(x) = 1 − (1 − slowFactor)·max c(|x − h| / windowM), c = cosinus surélevé (creux le plus profond en cas de chevauchement).
  Temps de déplacement tabulé (vitesse constante par pas : inverse exact par dichotomie). Pauses : temps forts à moins de
  windowM regroupés, une pause par groupe, chacune ajoute exactement `pauseS` avec entrée et sortie en cosinus surélevé
  (≤ 1,5 s). `keepDuration` (défaut) relève la vitesse de base pour garder `flyoverDurationS` (pauses ≤ 50 % de la durée), sinon
  le film s'allonge. Désactivé ou sans temps fort : identique à `advanceProgress`. `FlyoverRig` avance le temps du film
  (`playback.timeS`, en pause du rythme la progression ne bouge pas) et repart de `pacing.positionAt` après un déplacement du
  curseur ou un changement de rythme ; la lecture ne s'arrête qu'à `pacing.totalTime()`, pause finale comprise (progression 1
  tenue avec un temps du film, puis 1 sans temps). `timeAtProgress(1)` = fin du film. Les pauses sont désormais les arrêts
  du film (`flightPacing`, voir « Film et timeline ») ; `pacingFromHighlights` les dérive comme avant. `usePacing`
  (`src/scene/usePacing.ts`) partage le calcul avec le panneau. L'export appelle `pacing.progressAtTime(t)` sur
  `pacing.totalTime()`.
- **`Timeline`** (`src/ui/Timeline.tsx`) : timeline du film sous la vue, en temps du film (voir « Film et timeline ») —
  lecture / pause, distance parcourue, altitude et heure enregistrée au marqueur, vitesse ×0,5 à ×4.
- **Profil altimétrique** (bloc du survol de la piste « Plans ») : altitudes **enregistrées** de la trace rééchantillonnées à
  400 pas de distance constants (`elevationProfile`), placées en temps du film (`timeAtProgress` : plat pendant les arrêts),
  aire SVG, partie jouée en rouge clair. Amplitude verticale d'au moins 100 m pour ne pas grossir le bruit GPS ; profil masqué
  si la trace n'a aucune altitude.

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
- **Lever et coucher** (`sunTimes`, pur et testé) : équations solaires de la NOAA évaluées vers le midi local du jour UTC
  (déclinaison, équation du temps ; zénith 90,833° : réfraction et demi-disque), environ une minute d'écart hors des pôles ;
  jour ou nuit polaire signalés (`polar`, lever et coucher `null`). Converti en heure solaire par `solarHourOf` (inverse de
  `solarHourToDate`) pour l'interface « Lumière ».
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
- **Légende** `TrackLegend` (en bas à gauche de la vue 3D, seulement si `trackColorBy !== 'none'`) : dégradé, bornes avec unités,
  pastille « Sans donnée » s'il manque des valeurs.

## Film et timeline (phase 4, incréments 1 à 4 sur 4 : modèle, moteur, timeline, textes, photos)

- **Principe** : comme un logiciel de montage, « la base, c'est le GPX » : le survol continu de la première trace porte le
  film ; des éléments posés sur des pistes séparées s'y ajoutent. Incréments : 1 modèle pur et moteur (fait) ; 2 timeline sous
  la vue (pistes, glisser pour déplacer / étirer, inspecteur ; fait) ; 3 piste des textes dessinée dans l'habillage (fait) ;
  4 piste des médias (photos faites ; vidéos réservées dans le modèle, ni ajoutées ni dessinées).
- **Modèle** (`src/film/model.ts`, `settings.film` : enregistré dans le document de projet, annulable, validé par
  `isValidFilm` dans `SETTING_CHECKS`, aucune migration : un ancien projet reçoit `DEFAULT_FILM`) :
  `opening` / `closing` `{ style: 'aucune' | 'descente' | 'saut', durationS }` (1–30 s ; défaut descente 6 s / 5 s) ;
  `autoStops` (arrêts générés) et `autoMode` : `'temps-forts'` (défaut des nouveaux projets) ou `'rythme'` (projets
  antérieurs) ;
  `stops[]` `{ id, atM, durationS (0,5–60 s), camera: 'orbite' | 'fixe', label?, source?: { kind, ref? } }` ;
  `texts[]` `{ id, startS, durationS, text, subtitle?, anchor, size }` (placement du widget texte de l'habillage) et
  `media[]` `{ id, startS, durationS, kind: 'image' | 'video', src, layout: 'plein-ecran' | 'carte', anchor, size, kenBurns,
  caption? }` (`src` = id de l'image dans la table des médias du document, voir « Photos » ; `MEDIA_DEFAULTS` : plein
  écran, Ken Burns, légende en bas à gauche, taille 1, aussi pour un média enregistré sans ces champs par
  `withFilmDefaults`), ancrés en temps du film ; ids uniques dans le film (`stop-3`, `text-1`, `media-2`, `nextFilmId`).
- **Assemblage automatique** (`src/film/assemble.ts`) : tant que `autoStops` est vrai, les arrêts sont générés à chaque calcul
  (`autoStops`) aux temps forts (`stopCandidates` : sommets des montées, cols franchis, sommets proches, selon les cases
  `climbs` / `landmarks` du rythme ; un par groupe de `windowM`, comme les pauses qu'ils remplacent), id `auto-<mètres>`,
  libellé (« Montée 1 · cat. 3 · 1 653 m », nom OSM) et source ; ils suivent les repères OSM chargés après coup.
  `'temps-forts'` : un arrêt par temps fort **même rythme désactivé**, `AUTO_STOP_S` (4 s), caméra `orbite` (ce sont tous
  des sommets ou des cols). `'rythme'` : les pauses du rythme d'avant la timeline (rien si le rythme est désactivé,
  `pauseS`, caméra `fixe`). `materializeStops` écrit les arrêts générés dans le film (`autoStops: false`) à la première
  retouche d'un arrêt ; `assembleFilm` = film par défaut ainsi écrit.
- **Anciens projets** : un film enregistré sans `autoMode` est complété par `withFilmDefaults` (`SETTING_UPGRADES`, aussi pour
  les préréglages) avec `'rythme'` ; un projet v1 sans film reçoit `{ autoMode: 'rythme' }` par la migration v1 → v2
  (`MIGRATIONS[1]`), complété de même : leurs arrêts restent ceux de leur rythme.
- **Préréglages** : seuls les plans d'ouverture et de clôture du film sont enregistrés ; `stops`, `texts`, `media` (et
  `autoStops`) appartiennent à la trace et restent ceux du projet courant à l'application (`presetSettings`, y compris pour
  un préréglage enregistré avec tout le film).
- **Horloge du film** (`src/film/clock.ts`, `buildFilmClock` / `filmClockFor`, hook `useFilmClock` dans
  `src/scene/usePacing.ts`, alias `usePacing` pour les panneaux ; au même endroit `getFilmSource` hors React et
  `editFilm(edit, { stops, step })` : retouche du film des stores en un pas d'annulation, arrêts générés écrits d'abord
  pour un arrêt, sélection du bloc rendu par la retouche) : temps du film (s à ×1 depuis la première image) →
  `stateAt(t)` = `{ phase: 'opening' | 'flight' | 'stop' | 'closing', progress, flightTimeS, stop, localS, lengthS }`.
  [0, O) ouverture (progression 0), [O, O + F) vol, [O + F, total] clôture (progression 1). Le vol est `flightPacing` :
  ralentis du rythme aux temps forts, arrêts du film insérés avec entrée et sortie en cosinus surélevé (≤ 1,5 s), chacun sa
  durée ; `keepDuration` garde F = `flyoverDurationS` (arrêts ≤ 50 %, raccourcis en proportion). La fenêtre d'un arrêt
  (entrée, tenue, sortie) est la phase `stop`. `timeAtProgress(0)` = début du vol (après l'ouverture), `timeAtProgress(1)` =
  fin du film ; lancer la lecture depuis le début ou la fin sans temps du film part de la première image (`setPlaying` fixe
  `timeS = 0`), ouverture comprise. Sans ouverture ni clôture et sans retouche, l'horloge rejoue exactement l'ancien rythme
  (tests d'équivalence).
- **Caméra** (`src/flyover/filmCamera.ts`, pur) : vue d'ensemble = centre de la boîte de la trace dans le repère local au sol,
  distance 1,6 × diagonale (relief compris, × hauteur / largeur pour un cadre plus haut que large : le 9:16 garde toute la
  trace), 40° au-dessus de l'horizon, du côté d'où regarde la caméra de vol au raccord (pas de virage pendant la transition).
  Transition : cible interpolée, direction normalisée (nlerp), distance géométrique, smootherstep, 80 m au-dessus du sol ;
  `descente` sur toute la durée du plan, `saut` tient la vue d'ensemble puis bouge en 0,6 s. Arrêt `orbite` : rotation autour
  du marqueur de 6°/s × durée (≤ 120°) aller et retour, nulle et immobile aux bords de la fenêtre ; `fixe` : la caméra de vol
  tient. Les styles orbite et cinéma suivent le temps du vol (`flightTimeS`), ils démarrent donc là où l'ouverture les rend.
  Le marqueur reste sur la trace (`view.marker`), la cible ne l'est que pendant le vol.
- **Aperçu et export** : `FlyoverRig` et `ExportController` appellent le même `computeFilmView` avec la même horloge (le
  rapport largeur / hauteur vient de la taille du rendu, celle de la vidéo pendant l'export). La caméra est replacée en pause
  et une image d'export est recalculée quand la progression change **ou** quand le temps change alors que la vue en dépend
  (`filmViewMovesWithTime` : plans d'ouverture et de clôture, arrêts en orbite, styles orbite et cinéma, à l'image courante
  ou précédente). Le panneau d'export lit la durée et `progressAtTime` de la même horloge (`usePacing`).
- **Temps du film conservé** : quand l'horloge change (retouche du film, durée, rythme), `FlyoverRig` garde `playback.timeS`
  et en déduit la progression : une retouche en pause ne fait pas sauter la tête de lecture.
- **Timeline** (`src/ui/Timeline.tsx`, logique pure dans `src/film/timeline.ts`, inspecteur `src/ui/FilmInspector.tsx`) :
  bandeau sous la vue 3D (`.view__stage` au-dessus, la vue rétrécit d'autant ; ~150 px, pistes repliables). Barre, un seul
  style de contrôle (boutons à icône Lucide, infobulle `data-tip` avec le raccourci du registre, libellé court masqué à
  1280 px) : lecture, ■ (pause et retour à la première image), temps `m:ss,d / m:ss`, distance / altitude / heure au
  marqueur, « Arrêt » (S : à la position du marqueur, au mètre, source `manual`, 4 s, orbite), « Arrêt à un temps fort… »
  (temps forts sans arrêt), « Texte » (T : à la tête de lecture, 4 s, en bas au centre), « Photo » (voir « Photos »), vitesse,
  zoom (− / curseur logarithmique / + / « Ajuster » = tout le film), menu « Options » (case « Arrêts automatiques » :
  cochée, `autoStops` + `'temps-forts'`, arrêts propres effacés ; décochée, arrêts générés écrits ; pastille « modifié » /
  « Par défaut » du film, `ModifiedMarker keys={['film']}` ; un point sur le bouton quand le film s'écarte du défaut ; se
  ferme par Échap, un clic dehors ou Tab), replier.
  Règle (`rulerTicks`, pas de 1 s à 1 h selon le zoom, ≥ 56 px) : cliquer-glisser pour se placer **ouverture et clôture
  comprises** (`setProgress(clock.progressAtTime(t), t)`, fin du film = progression 1 sans temps) ; c'est aussi un curseur
  clavier (flèches ±1 s, Maj ±5 s, Page ±10 s, Début / Fin). Pistes « Plans » (ouverture, survol avec profil, clôture ;
  « aucune » = amorce pointillée sélectionnable ; les arrêts y sont aussi marqués sur la barre du survol, fenêtre teintée
  et bord haut à l'accent, blanc pour l'arrêt sélectionné), « Arrêts » (fenêtre de chaque arrêt, entrée et sortie
  comprises ; pointillés tant qu'ils sont générés), « Textes », « Médias » (photos, avec leur vignette).
- **Gestes** (`dragFilm`, pur) : glisser un arrêt le déplace le long de la trace — son début de tenue suit le pointeur,
  position trouvée par dichotomie sur l'horloge (`stopPositionAt`, 32 pas) ; son bord droit l'allonge (en proportion du
  plafond `keepDuration`) ; un texte ou une photo se déplace ou s'étire par ses deux bords ; le bord intérieur de l'ouverture / de la
  clôture change sa durée. Aimantation à 8 px (`snapTargets` : début et fin du film, bords des plans, des arrêts, des
  textes et des photos, temps forts, tête de lecture ; un arrêt déplacé s'aimante aux temps forts en mètres) ; Alt la désactive. Valeurs
  bornées aux plages du modèle, arrondies au centième de seconde (arrêt déplacé : au mètre). Un appui sans déplacement de
  3 px ne fait que sélectionner. Le geste est montré sur la timeline seule (brouillon local) et validé au relâcher en **un
  pas d'annulation** (`history.transaction`) ; l'échelle reste celle du film validé pendant le geste. Clavier sur un bloc :
  flèches ±1 s (Maj ±0,1 s, pas fusionnés comme un curseur), Suppr / Retour arrière supprime (un plan passe à « aucune »),
  Échap désélectionne ; Espace lance / arrête la lecture hors des champs et boutons. Ctrl+molette zoome autour du pointeur
  (`zoomAt`, ×1 à ×50), boutons − / + et curseur autour de la tête de lecture, « Ajuster » revient à ×1 ; défilement
  horizontal natif.
- **Sélection** : `filmSelection` du store (ajouté en fin d'état, ni enregistré ni annulable), posée par un appui ou le
  focus sur un bloc et par les ajouts (`editFilm` sélectionne le nouveau bloc), effacée par Échap, la fermeture de
  l'inspecteur, une suppression, ou quand le bloc n'existe plus (annulation, autre trace, arrêts générés déplacés :
  `hasFilmItem`, effet de `Timeline`).
- **Inspecteur** (`FilmInspector`, sans props, dans le dock droit, en-tête collant et ✕ comme le tiroir d'export) : plan
  (style, durée), arrêt (libellé, durée, caméra orbite / fixe, position et fenêtre), texte (texte, sous-titre, position,
  taille, début, durée), photo (vignette, affichage plein écran / carte, Ken Burns, légende, position, taille, début, durée).
  Position : grille 3 × 3 (`radiogroup` de 9 `role="radio"`, focus itinérant, flèches qui déplacent et choisissent,
  `nextGridIndex`, libellé de la position à côté). Les modifications passent par `editFilm(…, { step: false })` (frappes
  fusionnées en un pas) ; retoucher un arrêt généré écrit d'abord tous les arrêts.
- **Sur la trace** (`src/scene/TrackPicker.tsx`, monté dans `FlyoverCanvas`) : un clic sur la première trace place la tête
  de lecture au point visé (`setProgress(p, clock.timeAtProgress(p))`) ; un clic droit ouvre « Ajouter un arrêt ici » /
  « Ajouter un texte ici » (`TrackMenu`, DOM au-dessus du canvas, `role="menu"`, flèches, Échap, clic dehors ; chaque ajout
  par `editFilm` : un pas d'annulation, bloc sélectionné) ; curseur main au survol de la trace. Clic = appui et relâcher du
  même bouton à moins de 4 px (un glisser d'OrbitControls n'est pas un clic ; le menu s'ouvre au relâcher, pas sur
  `contextmenu`, qui part à l'appui sous Linux et macOS). Sélection en espace écran (`pickProjectedPath`, pur) : 1 500
  points répartis le long de la trace, plaqués comme la ligne (relief chargé, sinon altitude enregistrée, × exagération +
  3 m ; recalculés au plus une fois par seconde), projetés par la caméra, segment le plus proche à 12 px au plus,
  distance interpolée. Rien pendant un export. Limite : une portion cachée par le relief se sélectionne aussi (la ligne
  la montre en transparence).
- **Textes dans le film** (incrément 3) : dessinés par l'habillage (voir « Habillage du film », temps du film et textes de
  la timeline), dans l'aperçu comme à l'export.
- **Photos** (incrément 4) : « Photo » (sélecteur, plusieurs fichiers) ou fichiers déposés sur la timeline ; les photos
  sont lues une à une (`readPhoto`), ajoutées à la table des médias (`useMediaStore.add`, ids `photo-<n>`) puis au film à
  la tête de lecture, 5 s chacune à la suite (`addPhotos`), en un pas d'annulation ; les fichiers qui ne sont pas des
  images (vidéos) sont ignorés avec un message. `readPhoto` lit l'EXIF des 128 premiers Ko (`parseExif`, analyseur pur :
  position GPS, heure d'origine et son décalage, sinon heure GPS en UTC, sinon heure locale lue dans le fuseau du
  navigateur, `photoTimeMs`), décode l'image redressée (`createImageBitmap`, `imageOrientation: 'from-image'`), la
  réduit à 2 560 px au plus en JPEG 0,85 et en fait une vignette de 160 px (JPEG 0,7). Placement proposé
  (`photoFilmTime`, pur) : point de la trace le plus proche de la position (à 2 km au plus ; sur un aller-retour, le
  passage enregistré le plus près de l'heure, `nearestOnPath`), sinon point enregistré à l'heure de la photo (trace
  horodatée, 15 min de tolérance aux extrémités, `distanceAtTime`) ; temps du film = `clock.timeAtProgress(distance /
  longueur)`. Le message (toast) propose « Placer sur le parcours » (un pas d'annulation de plus).
- **Table des médias** (`src/film/media.ts`) : les octets ne sont pas dans les réglages (historique et préréglages
  légers) mais dans une table du document `{ id: { data, thumb, width, height, name? } }` (data URL JPEG). Une image
  reste dans la table quand sa photo quitte le film (l'annulation la retrouve) ; l'enregistrement n'écrit que les images
  utilisées (`usedMedia`). Accès aux fichiers derrière `readPhoto(blob)` (un `File` du sélecteur ou du dépôt sur le web,
  un `Blob` lu sur disque pour Tauri). Images décodées à la demande (`getMediaBitmaps` : `ImageBitmap` par id, au plus 6
  gardées, les moins récentes libérées, libérées aussi quand le film ne les utilise plus, redécodées si la table change
  à l'ouverture d'un projet, une image illisible n'est pas réessayée).
- Limites : vidéos non prises en charge (le type `video` est réservé) ; l'EXIF n'est lu que dans les JPEG (pas HEIC, que la
  plupart des navigateurs ne décodent pas, ni PNG / WebP) ; une photo plein écran est recadrée pour couvrir l'image (une
  photo en hauteur perd le haut et le bas) ; une photo n'est pas liée à un arrêt (elle ne le suit pas quand il bouge).
  Autres limites : l'aperçu 3D ne
  suit un geste qu'au relâcher ; pas de défilement automatique quand on glisse au bord ; en mode `'temps-forts'`, le curseur
  « pause » du rythme ne règle pas la durée des arrêts générés (4 s, à retoucher par arrêt).

## Projet (phase 4)

- Un projet est un seul fichier JSON `<nom>.openflyover.json` (`format: "openflyover-project"`, `version`, `name`, `settings`,
  `playback.speed`, `tracks`, et `media` quand le film a des photos : table des images par id, une ligne par image après
  les traces, voir « Film et timeline », « Table des médias » ; champ facultatif, pas de changement de version). À
  l'ouverture, les images invalides sont écartées et les photos du film sans image retirées avec un avertissement ;
  `applyProject` remplace la table avant les réglages. Les traces sont **embarquées** (fichier autonome) en colonnes par segment (`lon`, `lat`, puis
  `ele` / `time` / `hr` / `cad` / `power` / `temp` seulement si présents, `null` pour un point sans valeur), arrondies à 1e-7° et
  0,01 (ms entières pour le temps) ; stats et emprise recalculées au chargement par `buildTrack`, ids et couleurs conservés.
- Réglages traités **génériquement sur les clés de `DEFAULT_SETTINGS`** : chaque valeur est vérifiée contre le type de sa valeur
  par défaut (objets imbriqués compris), sinon retour au défaut pour cette clé ; clés inconnues ignorées. **Un nouveau réglage
  ne demande aucun code ici** ; ajouter une entrée à `SETTING_CHECKS` seulement si une valeur du bon type peut être invalide
  (énumération, id de catalogue, plage). Tout changement de format incrémente `PROJECT_VERSION` et ajoute `MIGRATIONS[n]`
  (version 2 : film des projets v1, voir « Film et timeline »).
- **Historique** des réglages hors du store : abonné à `useAppStore`, chaque pas ne garde que les clés modifiées ; changements des
  mêmes clés à moins de 400 ms fusionnés (clavier), un glissé de curseur au pointeur = un pas de l'appui au relâcher quelle
  que soit sa lenteur (`beginGesture`, branché sur tout `input[type=range]` par `installSliderGestures`), un préréglage = un pas, un geste de la timeline = un pas ; l'imagerie régionale choisie à l'import
  n'est pas enregistrée ; ouvrir un projet vide l'historique. Raccourcis Ctrl/Cmd+Z, Ctrl/Cmd+Maj+Z, Ctrl+Y (ignorés dans les
  champs texte), installés une fois par `App`. Enregistrer, ouvrir et le nom du projet sont dans la barre du haut ; le
  panneau « Projet » ne garde que les préréglages.
- **Pastille « modifié » + bouton « Par défaut »** (`ui/ModifiedMarker.tsx`) en haut à droite de chaque panneau de réglages : liste
  des clés de `Settings` du panneau, comparées en profondeur aux valeurs de `DEFAULT_SETTINGS` (`modifiedSettings` /
  `sameValue`, `project/apply.ts`) ; « Par défaut » remet ces clés par défaut en un seul pas d'historique (`resetSettings`,
  `project/history.ts`). La source d'imagerie n'est pas suivie (choisie par région à l'import). Un nouveau réglage d'un
  panneau : ajouter sa clé à la liste `keys` du marqueur.
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
- **Décalage UTC** : `Track.utcOffsetMin?` (ajout optionnel au contrat, minutes d'avance de l'horloge locale sur UTC) vient
  du `localTimestamp` du message `activity` d'un FIT (au quart d'heure, `readUtcOffset`) ou du premier `<time>` d'un GPX
  écrit avec un décalage (`gpxUtcOffset` ; « Z » et « +00:00 » ne disent rien) ; le document de projet l'enregistre.
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
  du canvas 3D, sans événements souris) et l'export vidéo (`exportOverlay.ts` → `ExportController`) appellent
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
  et préréglages se chargent toujours (`minimap` désactivée, `credits` activés). Les widgets en direct s'effacent pendant les
  cartes.
  Logo en data URL PNG d'au plus 512 px (projets autonomes). Validation : `isValidOverlay` (`SETTING_CHECKS`).
- **Temps du film** : `drawOverlay(ctx, frame, settings, size, assets, extras)` ; `extras.time` (`OverlayTime` : temps du film
  de l'image, durées de l'ouverture, du vol et du film, par `overlayTime(clock, progress, timeS)` = `timeS ??
  clock.timeAtProgress(progress)`, comme `FlyoverRig`) ; sans horloge, `progressTime(progress)` (vol d'une seconde, temps =
  progression : les tests et l'ancien comportement). Les cartes sont calées sur le temps du film : la carte d'ouverture
  apparaît à la première image (plan d'ouverture compris) et s'efface à `ouverture + title.end × vol` ; la carte de clôture
  apparaît à `ouverture + end.start × vol` et reste jusqu'à la dernière image (plan de clôture compris) ; fondus de 1 % et
  2,5 % du vol. Les étiquettes 3D (`Labels`) lisent la même opacité (`cardOpacityAt(time, …)`).
- **Textes de la timeline** (`extras.texts` = `settings.film.texts`) : visibles dans `[startS, startS + durationS)` du temps
  du film, fondus de 0,4 s (au plus un quart de la durée, `filmTextOpacity`), même style que le « Texte libre » (corps, panneau
  du style, taille × `size`, marges de sécurité), texte sur deux lignes au plus (la seconde coupée par « … »), sous-titre en
  dessous au style des libellés. Ils s'ajoutent après les widgets de leur ancre (empilés) ; un texte seul sur sa rangée
  (haut, milieu, bas) peut prendre toute la largeur sûre, à côté d'un texte d'une autre ancre de la rangée un tiers
  (`filmTextMaxWidths`) : pas de chevauchement entre textes. Ils ne s'effacent pas sous les cartes.
- **Photos de la timeline** (`extras.media` = `settings.film.media`, images décodées par `assets.photo(src)` ; dessinées
  même habillage désactivé, l'aperçu monte `OverlayCanvas` dès que le film a des photos) : visibles dans leur fenêtre avec
  les fondus des textes, seulement une fois l'image décodée. Plein écran : sous tout le reste, recadrée pour couvrir l'image
  (`kenBurnsCrop`, pur) avec, si `kenBurns`, un zoom lent de 1 à 1,1 (ou l'inverse) et un glissement diagonal de 4 % au
  plus, à vitesse constante sur la fenêtre, sens tiré de l'id (le même à chaque image) ; les widgets en direct
  s'effacent dessous comme sous les cartes ; la légende est dessinée comme un texte de la timeline à l'ancre de la
  photo. Carte : widget à son ancre (après les widgets, avant les textes), image de 26 u × taille de haut (40 u de large
  au plus, dans la zone sûre), passe-partout du style (`theme.photo` : tirage blanc ombré en Éditorial, verre sombre et
  barre d'accent en Diffusion, carte papier arrondie en Application), légende d'une ligne dessous (« … » si trop
  longue). Les crédits restent au-dessus de tout.
- **Crédits des sources** (`settings.overlay.credits { enabled, position }`, activés par défaut, quatre coins) : petite ligne
  le long du bord, hors des marges de sécurité, sur un fond discret propre à chaque style (`theme.credits` : encre translucide
  et texte blanc pour Éditorial et Diffusion, papier et encre pour Application, lisible sur neige comme sur forêt), repliée
  sur la largeur sûre si elle est longue. Contenu : `overlayCredits` (`data.ts`), les mêmes chaînes que la barre d'état
  (relief et imagerie en cours, Open-Meteo quand la météo est chargée, OpenStreetMap quand des repères le sont), lu des
  stores par `overlayExtras` (`exportOverlay.ts`) pour l'aperçu comme pour l'export. Dessinés même habillage désactivé
  (l'aperçu monte `OverlayCanvas` dès que l'un des deux est actif). Crédits désactivés, le crédit Open-Meteo reste dessiné
  seul quand la météo est affichée (comme avant) ; activés, il rejoint la ligne. Les désactiver revient à citer les sources
  ailleurs (texte du panneau Habillage).
- **Polices** : un canvas ne déclenche pas seul le téléchargement des polices web ; `loadOverlayFonts()` les demande avant la
  première image, l'export doit l'attendre aussi. Polices embarquées (`src/ui/fonts.css`, `public/fonts/`) :
  Fraunces 300–700, IBM Plex Sans et Sans Condensed disponibles hors ligne.
- **Météo** : widget et ligne de la carte de clôture (`weatherWidgetData`, `summarizeOuting`), avec le crédit Open-Meteo dessiné
  dès qu'ils sont visibles (dans la ligne des crédits, ou seul en bas à droite si elle est désactivée).

## Export vidéo (phase 5)

- Le survol étant une fonction pure de `playback.progress` et du temps du film, un film est une liste de temps du film
  (`buildFrameTimes` : rampe 0 → durée sur `durée × fps` images, plus 1 s tenue au début et 2 s à la fin) et des progressions
  correspondantes (`buildFrameSchedule`) ; chaque image fixe les deux (`setProgress(progression, temps)`). `ExportController` (dans `TerrainLayer`) exécute la
  demande déposée dans le store d'export (`src/export/store.ts`, distinct du store de l'application) : lecture en pause,
  `frameloop 'never'`, rendu et caméra à la taille de la vidéo avec un ratio de pixels de 1 (réappliqués avant chaque rendu ;
  canvas affiché en letterbox pendant l'export), pointeur désactivé.
- Le calendrier suit l'horloge du film (voir « Film et timeline ») : la rampe dure `clock.totalTime()` (ouverture et clôture
  comprises) et l'image k montre `clock.progressAtTime(k / (n − 1) × durée)` à ce temps du film (ralentis et arrêts comme dans
  l'aperçu ; les images tenues réutilisent l'image déjà composée, sauf quand la vue bouge avec le temps : plans d'ouverture
  et de clôture, arrêts en orbite, styles orbite et cinéma, ou quand l'habillage minuté change (`overlayTimedState` :
  opacités des cartes, des textes et des photos de la timeline, plus le temps du film pendant qu'une photo plein écran
  bouge ; un texte qui apparaît pendant un arrêt fixe est donc rendu) ; les images des photos visibles sont décodées
  avant le rendu de l'image (`loadFramePhotos`, la composition devant suivre le rendu dans la même tâche) ; les images tenues du début et de la fin restent figées sur les
  temps 0 et durée).
- Pour chaque progression (`renderSettledFrame`, `src/export/capture.ts`), `advance` jusqu'à ce que la vue n'attende plus
  aucune tuile réellement dessinée (`stats.pendingVisibleTiles`, limite 5 s par image, comptée « incomplète »), puis les
  replaquages en attente de la trace et des étiquettes sont exécutés tout de suite (`flushDrapes`, au lieu de leur délai) et
  l'image est rendue une fois de plus. La caméra n'est replacée (progression décalée de 1e-9) que si le relief final la déplace
  de plus d'1 m, jamais après un dépassement de délai. Toutes les 5 images rendues, les tuiles des images +5 à +40 sont
  demandées à l'avance (`engine.prefetch`).
- L'image WebGL est composée dans la même tâche que le rendu sur un `OffscreenCanvas` (dégradé de ciel, image, puis habillage
  `DrawOverlay(ctx, { progress, time }, w, h)` après chargement de ses polices, `time` = `overlayTime(horloge, progression,
  temps de l'image)` ; image fixe : temps de lecture courant), puis encodée par mediabunny (WebCodecs) : MP4 H.264,
  sinon MP4 HEVC, WebM VP9, WebM VP8, le premier accepté par `VideoEncoder.isConfigSupported` ; débit = pixels × fps × 0,06 /
  0,10 / 0,16 bit selon la qualité, corrigé par codec, borné à 1–80 Mbit/s ; image-clé toutes les 2 s ; fichier en mémoire.
- Tout est restauré en fin d'export, en cas d'erreur ou d'annulation (taille, ratio de pixels, frameloop, pointeur,
  progression). Réglage `settings.video { aspect, resolution, fps, quality }` dans le document de projet (anciens `video.format`
  convertis par `withVideoDefaults`) : formats 16:9, 9:16, 1:1, 4:5, 21:9 × petit côté 720p, 1080p, 1440p, 4K
  (`videoSize`) ; 24 / 30 / 60 i/s.
- Échelle de rendu `exportRenderScale` = petit côté / 1080 (1 hors export) : largeur de la trace et taille des étiquettes, en
  pixels, sont multipliées pour qu'un film 4K ressemble au 1080p. Les marqueurs n'en ont pas besoin (taille proportionnelle à la
  distance caméra, donc fraction d'écran constante).
- Image fixe (bouton « Image fixe » du tiroir d'export, PNG ou JPEG) : même demande avec `still { progress, type }`, la progression
  de lecture courante, à la taille format × résolution de la vidéo. Même chemin que le film (taille, ratio de pixels 1,
  échelle de rendu, `renderSettledFrame`, `composeFrame` avec l'habillage s'il est affiché), une seule image rendue à la
  progression décalée de 1e-9 pour que la caméra soit placée par le style courant (et non la vue orbitée à la main), puis
  `OffscreenCanvas.convertToBlob` (JPEG qualité 0,92 ; extension d'après le type obtenu). Nom : `<trace> <progression> %`.
  Restauration identique au film.
- La console affiche en fin d'export le temps de rendu, d'attente des tuiles et d'encodage, et le nombre de délais dépassés.
  « Encodage » inclut la copie de l'image WebGL, qui attend la fin du rendu GPU.
- Limites : fichier gardé en mémoire (~2× sa taille), onglet à garder ouvert, vitesse liée au GPU (mesure à faire sur une
  machine avec GPU, voir `docs/reprise.md`).

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

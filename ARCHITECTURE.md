# OpenFlyover — architecture

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

- WGS84 lon/lat en degrés. Hauteurs de la scène en mètres **au-dessus du niveau de la mer** (tuiles d'élévation,
  GPX / FIT), placées par le repère local comme des hauteurs ellipsoïdales : toute la scène est N (ondulation du géoïde)
  trop bas, ce qui ne compte que pour ce qui la lit en vrai ECEF. L'atmosphère et les nuages prennent donc
  `mslLocalToEcef(frame)` (repère remonté de N à son origine) et les altitudes des nuages + N ; le reste (relief, trace,
  libellés, caméra) reste en MSL, cohérent entre lui. N varie de ~0,4 m / 10 km autour du Mont-Blanc : décalage constant.
- Scène Three.js dans un **repère local tangent** centré sur le centroïde du trip : +X est, +Y haut, +Z sud.
  Les conversions ECEF → local sont faites en doubles JS, jamais dans le shader.
- Tuiles Web Mercator, schéma XYZ (y = 0 au nord).

## Modules

| Dossier | Rôle | Exports attendus |
|---|---|---|
| `src/core/types.ts` | contrats partagés | (figé) |
| `src/core/math.ts` | petits outils numériques | `clamp(value, min, max)`, `lastIndexAtOrBelow(sorted, value)`, `firstIndexAtOrAbove(sorted, value)` (recherches dichotomiques sur tableaux croissants) |
| `src/core/errors.ts` | message d'erreur montré à l'utilisateur | `errorMessage(error)` : message d'une `Error`, chaîne rejetée (commande Tauri), sinon « erreur inconnue » |
| `src/geo/ellipsoid.ts` | WGS84 ↔ ECEF, repère local | `WGS84`, `lonLatToEcef(lon,lat,h,target?)`, `ecefToLonLat(v)`, `createLocalFrame(lon,lat): LocalFrame` ; `lonLat.ts` (sans three.js, importé par le reste de l'app) : `haversineM(a: LonLat, b: LonLat)`, `centroid(bounds)`, `expandBounds(bounds, marginM, minSizeM?)` (réexportés par `ellipsoid.ts`) |
| `src/geo/geoid.ts` | géoïde EGM96 | `geoidUndulation(lon,lat)` (m, grille 1° bilinéaire, `egm96Grid.ts` généré par `scripts/gen-geoid.mjs` depuis la grille 15' de la NGA redistribuée par PROJ-data, domaine public ; 170 Ko ; 0,45 m RMS face à la grille 15', jusqu'à ~14 m sur les îles volcaniques), `mslToEllipsoidHeight`, `ellipsoidToMslHeight`, `mslLocalToEcef(frame, target?)` |
| `src/geo/mercator.ts` | maths de tuiles | `lonLatToTileFrac(lon,lat,z)`, `tileBounds(key): LonLatBounds`, `tileCenter(key)`, `tilesForBounds(bounds,z): TileKey[]`, `tileCountForBounds(bounds,z)`, `zoomForTileBudget(bounds, maxTiles, minZoom, maxZoom)`, `tileGroundSizeM(key)`, `childrenOf(key)`, `parentOf(key)`, `tileKeyString(key)`, `parseTileKey(s)` (lève sur clé invalide), `tileContains(key, lon, lat)`, `lonLatToTileUV(key, lon, lat): {u,v}` (u,v ∈ [0,1], v=0 au nord), `tileUVToLonLat(key,u,v)`, `boundsIntersect(a,b)` |
| `src/import/gpx.ts` | parse GPX | `parseGpx(text: string, fileName: string): Track[]` |
| `src/import/fit.ts` | parse FIT | `parseFit(buffer: ArrayBuffer, fileName: string): Promise<Track[]>` |
| `src/import/stats.ts` | stats & bounds, assemblage | `computeStats(segments): TrackStats`, `computeBounds(segments): LonLatBounds`, `densify(points, maxStepM): TrackPoint[]`, `buildTrack(init): Track`, `stripExtension(fileName)` (partagés par les deux parseurs) |
| `src/import/chain.ts` | enchaînement de traces (voir « Enchaînement de traces ») | `chainTracks(tracks): Track`, `chainOrder`, `chainName`, `replaceByChain`, `followEachOther`, `CHAIN_OFFER_MAX_GAP_MS` |
| `src/import/index.ts` | point d'entrée | `importFile(file: File, colorIndex?): Promise<Track[]>`, `importText(text, fileName, colorIndex?)`, `TRACK_COLORS`, `assignColors` |
| `src/terrain/sources.ts` | catalogue de sources | `TERRAIN_SOURCES: TerrainSource[]`, `IMAGERY_SOURCES: ImagerySource[]`, `buildTileUrl(source, key): string`, `getTerrainSource(id)`, `getImagerySource(id)`, `sourceCovers(source, bounds \| point)` |
| `src/terrain/fetch.ts` | fetch + cache bitmaps | `createTileFetcher(opts?: {concurrency?, maxEntries?, retryDelayMs?, storedTiles?}): TileFetcher`, `TileFetchError` (`status`, `url`), `isAbortError(e)`, `downloadTile(url, signal?, retryDelayMs?)` (même politique de réessais), `setStoredTileReader(reader)` + `StoredTileReader` (`covers`, `get` : packs hors ligne lus avant le réseau) |
| `src/terrain/dem.ts` | décodage élévation | `decodeDem(bitmap, encoding): HeightGrid`, `sampleGrid(grid, u, v): number` (bilinéaire, NaN-safe) |
| `src/terrain/heightField.ts` | champ de hauteur multi-niveaux | `class HeightField { set(key, grid); delete(key); has(key); sampleHeight(lon, lat): number \| undefined }` (tuile la plus profonde contenant le point) |
| `src/terrain/imagery.ts` | texture composée | `loadImageryTexture: LoadImageryTexture` |
| `src/terrain/mesh.ts` | géométrie d'une tuile | `buildTileGeometry(key, grid, frame, opts: BuildTileGeometryOptions): TileGeometryResult` |
| `src/terrain/quadtree.ts` + `engine.ts` | LOD, chargement, groupe Three | `createTerrainEngine(options: TerrainEngineOptions, deps?: Partial<EngineDeps>, tuning?: Partial<EngineTuning>): TerrainEngine` (deps injectables pour les tests) |
| `src/scene/*.tsx` | composants R3F | `FlyoverCanvas`, `TerrainLayer` (+ `useTerrainContext`), `TrackLines`, `TrackPicker` (+ `TrackMenu`, DOM), `CameraRig`, `FlyoverRig`, `useDebouncedCallback` |
| `src/scene/marker*.ts` + `trackLineStyle.ts` | trace et marqueur (voir « Trace et marqueur ») | purs : `TrackStyle`, `DEFAULT_TRACK_STYLE`, `MarkerSettings`, `DEFAULT_MARKER`, `isValidTrackStyle`, `isValidMarker`, `withTrackStyleDefaults`, `withMarkerDefaults` (`markerSettings.ts`) ; `MARKER_FIGURE_PATHS`, `circlePath` (`markerFigures.ts`) ; `drawBadge`, `readableInk`, `squareCrop`, `fileToAvatarDataUrl`, `loadMarkerImage` (`markerBadge.ts`, canvas 2D) ; `markerBadge`, `badgeTexture`, `headsLeft`, `placeMarker`, `useMarkerImage`, `MARKER_SCREEN_FACTOR` (`markerSprite.ts`) ; `createGlowMaterial`, `applyDash`, `quantizedPixelSize`, `cumulativeDistances`, `cutAt`, `cutLine` (`trackLineStyle.ts`) ; `TrackMarkerSection` (`src/ui`) |
| `src/flyover/path.ts` | chemin de survol | `buildTrackPath(track): TrackPath` (segments concaténés, distances cumulées, `time` en ms ou NaN), `trackPathOf(track)` (même chemin, en cache par trace), `samplePath(path, distanceM): PathSample` (`ele` et `time` interpolés seulement si les deux voisins les ont), `recordedTimeAt(path, distanceM)` (comble les points sans heure), `elevationProfile(path, samples)`, `nearestOnPath(path, lonLat, timeMs?)`, `distanceAtTime(path, timeMs, toleranceMs?)`, `pickProjectedPath(screen, distM, px, py, maxPx)` (point de la trace projetée le plus proche du pointeur) |
| `src/flyover/camera.ts` | caméra de survol | `computeCameraView(path, progress, frame, sampler, { exaggeration, liftM, camera?, durationS?, timeS?, orbitRad? })`, `autoDistanceM`, `smoothedTurn`, `movesWithTime` |
| `src/flyover/cameraSettings.ts` | styles et préréglages caméra | `CAMERA_STYLES`, `DEFAULT_CAMERA`, `CAMERA_RANGES`, `CAMERA_PRESETS`, `isValidCamera`, `advanceProgress(progress, dt, speed, durationS)` |
| `src/flyover/climbs.ts` | montées détectées | `detectClimbs`, `climbsOf(track)` (cache par trace), seuils exportés, `CATEGORY_THRESHOLDS` |
| `src/scene/labelModel.ts` + `labelSources.ts` | étiquettes 3D | `LandmarkLabel`, `LandmarkKind`, `LABEL_KIND_ACCENTS`, `labelOpacity`, `climbLabels`, `waypointLabels`, `resolveOverlaps`… ; `setLabelSource(id, labels)` (ids préfixés et uniques), `useLabelSources` |
| `src/flyover/pacing.ts` | rythme du survol | `buildPacing({ track, durationS, settings, landmarks })` → `totalTime`, `progressAtTime`, `timeAtProgress`, `positionAt`, `advance` ; `flightPacing(lengthM, highlightsM, durationS, settings, stops)` (pauses données par le film) ; `pausePositions`, `isHighlightLandmark`, `DEFAULT_PACING`, `PACING_RANGES`, `isValidPacing` |
| `src/film/*` | film et timeline (pur) | `Film`, `DEFAULT_FILM`, `isValidFilm`, `withFilmDefaults`, `nextFilmId`, `shotDurationS` ; `autoStops`, `stopCandidates`, `materializeStops`, `assembleFilm`, `filmStops`, `pickLandmarkTitles`, `withLandmarkTitles`, `withoutLandmarkTitles`, `sameLandmarkTitles`, `freezeLandmarkTitles` ; `buildFilmClock`, `filmClockInputFor`, `filmClockFor` → `FilmClock` (`stateAt`, `totalTime`, `progressAtTime`, `timeAtProgress`, `advance`) ; `timeline.ts` : échelle, règle, aimantation, `dragFilm`, `stopPositionAt`, ajouts / retraits (`removeFilmItem` passe un plan à « aucune »), `hasFilmItem`, `addMedia`, `updateMedia`, `photoFilmTime`, `clipSyncOffsetS`, `syncClipPlacement`, `syncClip`, `recordedAtFilmTime`, `clipRateAt` ; `model.ts` : `clipTimeS`, `clipHasSound`, `FilmPoi`, `isValidPoi`, `VIDEO_SOUND_DEFAULTS`, `MediaSync`, `SYNC_OFFSET_RANGE` ; `audio.ts` : musique et son des vidéos (`clipSounds`, `duckEnvelope`, `duckGainAt`, `filmMixPlan`, `mixFilmAudio`) ; `beats.ts` : rythme de la musique (`detectBeats`, `filmBeats`, `beatNear`, `snapFilmToBeats`, `beatTicksPath`) ; `pois.ts` : points d'intérêt (`addPoi`, `renamePoi`, `removePoi`, `defaultPoiName`, `poiStopAtM`) ; `exif.ts` : `parseExif`, `photoTimeMs`, `mp4CreationTimeMs`, `quickTimeDateMs` ; `media.ts` et `video.ts` (seuls modules non purs du dossier) : `MediaAsset`, `MediaTable`, `MAX_VIDEO_BYTES`, `sanitizeMediaTable`, `usedMedia`, `isVideoAsset`, `useMediaStore`, `readPhoto`, `createMediaBitmaps`, `getMediaBitmaps`, `mediaToLoad` ; `readMedia`, `readVideo`, `isMediaFile`, `createClipReader`, `createExportVideos`, `decodeClipSound`, `joinSoundChunks`, `createPreviewVideos`, `getPreviewVideos` |
| `src/flyover/filmCamera.ts` | caméra du film | `computeFilmView(path, clock, timeS, progress, frame, sampler, options)`, `overviewView`, `regionView`, `blendViews`, `shotBlend`, `stopOrbitRad`, `filmViewMovesWithTime` |
| `src/flyover/sun.ts` | date du soleil, lever / coucher | `solarHourToDate(dayMs, lon, solarHour)`, `solarHourOf(dayMs, lon, date)`, `sunDateAt(path \| null, progress, { sunFromTrack, solarHour, lon, dayMs }): Date`, `sunTimes(lat, lon, date)` → `{ sunrise, sunset, solarNoon, polar }`, `solarDay`, `SUN_CHIPS`, `sunChipHour(chip, day)` |
| `src/flyover/trackColor.ts` | trace colorée par une grandeur | `TRACK_COLOR_MODES`, `TrackColorBy`, `TRACK_METRICS` (libellé, unité, palette), `metricValues`, `trackMetricValues`, `hasMetric`, `robustRange`, `resampleValues`, `colorizeValues`, `VIRIDIS`, `MAGMA`, `MISSING_COLOR` |
| `src/scene/exposure.ts` | exposition sous l'atmosphère | `DAYLIGHT_EXPOSURE`, `sunElevation`, `autoExposureEv`, `sceneExposure(elevation, ev)`, `nightFillIntensity` |
| `src/weather/*` | météo historique de la sortie | `fetchOutingWeather(path, opts)`, `sampleLocations`, `outingDays`, `createWeatherCache`, `WeatherError`, `OPEN_METEO_ATTRIBUTION` ; `weatherAt(series, timeMs, lon, lat)`, `weatherAtTimes(series, timesMs, lon, lat)`, `weatherWidgetData(series, path, progress)`, `summarizeOuting`, `describeWeatherCode`, `windFromLabel` ; `useWeatherStore`, `syncWeather` |
| `src/osm/*` | repères OpenStreetMap | `OVERPASS_ENDPOINTS`, `OSM_ATTRIBUTION`, `corridorBoxes`, `buildOverpassQuery`, `trackQuery`, `parseOverpass`, `runOverpassQuery`, `fetchTrackFeatures` ; `parseEle`, `projectOnPath`, `landmarkPriority`, `landmarkText`, `buildLandmarks`, `landmarkLabels`, `DEFAULT_LANDMARK_SETTINGS`, `LANDMARK_DISTANCE_RANGE` ; `useLandmarkStore`, `syncLandmarks`, `resetLandmarkStore` |
| `src/overlay/*` | habillage du film | `drawOverlay(ctx, frame, settings, size, assets)`, `prepareOverlayTrack(track, weather?)`, `overlayFrameAt(data, progress)`, `cardOpacityAt`, `miniMapOutline`, `DEFAULT_OVERLAY`, `isValidOverlay`, `withOverlayDefaults`, `withOverrides`, `resolveOverlayTheme`, `leaderboardRows`, `loadLogo`, `loadOverlayFonts`, `createOverlayDrawer` (pont vers l'export), `OverlayCanvas` |
| `src/export/*` | export vidéo | `buildFrameSchedule`, `VIDEO_ASPECTS`, `VIDEO_RESOLUTIONS`, `videoSize`, `createVideoEncoder(canvas, options)`, `ExportCanceledError`, `nativeEncoder.ts` (ffmpeg du bureau) : `exportCodec`, `createExportEncoder`, `createNativeVideoEncoder`, `wavFile`, `settle`, `renderSettledFrame`, `composeFrame`, `composeOverlayFrame`, `fillSky` (ciel de l'export, repris par l'affiche), `useExportStore`, `videoFileName`, `overlayBaseName`, `ALPHA_CANDIDATES`, `chooseVideoDestination`, `warnsInMemory`, `filmRate`, `ExportController` ; `batch.ts` (rendu en lot) : purs, testés : `buildBatchJobs`, `formatKey`, `batchBaseName`, `estimateBatch`, `runBatch`, `batchProgressLabel`, `batchSummary` ; `exportJob`, `useBatchStore` |
| `src/poster/*` | affiche (voir « Affiche ») | purs, testés : `PosterSettings`, `DEFAULT_POSTER`, `POSTER_FORMATS`, `posterSize`, `isValidPoster`, `withPosterDefaults` ; `posterContent`, `posterFigure`, `availableFigures`, `posterStats`, `totalStats`, `trackLine`, `POSTER_LIST_MAX` ; `posterLayout` (boîtes), `fitText`, `fitLines`, `fitTrackList`, `wrapText`, `truncate` ; `drawPoster`, `coverCrop`, `POSTER_THEMES`, `POSTER_FONTS` ; `framingPath`, `planFlatMap` (`view.ts`) ; non purs : `renderFlatMap` (`view.ts`), `currentPosterContent`, `startPoster`, `usePosterPreview`, `previewKey` (`export.ts`), `PosterPanel` |
| `src/flyover/race.ts` | course fantôme | `RACE_SYNC_MODES`, `DEFAULT_RACE`, `isValidRace`, `prepareRaceTrack`, `raceTrackOf`, `positionAtTime`, `positionAtDistance`, `arrivalTime`, `buildRace`, `raceAt(race, progress)`, `rankRacers` ; `useRace`, `RaceMarkers` |
| `src/weather/sceneWeather.ts` + `src/scene/weatherEffect.ts` | météo dans la scène | `sceneConditionsAt`, `sceneWeatherAt`, `sceneWeatherFrom`, `CLEAR_SCENE_WEATHER`, `hazeExtinction` ; `WeatherEffect` |
| `src/osm/paths.ts` + `src/route/graph.ts` + `src/route/planner.ts` + `src/terrain/heightAt.ts` + `src/osm/geocode.ts` + `src/ui/RoutePanel.tsx` | reconnaissance (itinéraire futur) | `pathsQuery` (voies `highway` d'une boîte calée sur une grille de 0,02°, sans autoroutes ni voies privées), `parsePaths`, `fetchPaths` (client Overpass, file et cache communs) ; `buildGraph` (nœuds = points partagés des voies, coût = longueur × facteur du type : sentiers 1, routes principales 3), `nearestNode`, `shortestPath` (A*), `routeThrough` (`RouteError`, point à plus de `MAX_SNAP_M` = 500 m d'un chemin) ; `computeRouteTrack` (chemins à 2 km autour des points, itinéraire densifié à 20 m, altitudes `fetchHeights` au zoom 13, trace `gpx` sans heures, points posés en waypoints « Départ » / « Étape n » / « Arrivée »), `useRouteStore` (brouillon hors réglages : ni préréglages ni annulation ; épingles `setLabelSource('route', …)`), `planAreaAround`, `isRouteTrack` ; `findPlace` / `parseCoordinates` (Nominatim, à la validation seulement, 1 requête/s) ; `planArea` / `setPlanArea` du store : relief sans trace (la scène se monte dès que `bounds` existe ; survol, trace, eau et export seulement avec une trace) ; entrée « Point de passage ici » de `TrackMenu` |
| `src/osm/water.ts` + `src/scene/waterMesh.ts` + `src/scene/WaterLayer.tsx` | eau réfléchissante | `WaterSettings`, `DEFAULT_WATER`, `WATER_MARGIN_M`, `waterQuery`, `stitchRings`, `ringAreaM2`, `pointInRing`, `parseWater`, `fetchTrackWater` ; `clipRing`, `buildWaterMesh`, `DEFAULT_WATER_MESH` ; `WaterLayer`, `WATER_LIFT_M` ; `useWaterStore` (`osm/store.ts`) |
| `src/weather/sceneClouds.ts` + `src/scene/CloudsLayer.tsx` | nuages volumétriques | `CloudSettings`, `DEFAULT_CLOUDS`, `isValidClouds`, `cloudCoversAt`, `sceneCloudsFrom`, `filmWind`, `cloudDrift`, `cubeSphereUv`, `weatherOffsetFor` ; `CloudsLayer`, `createCloudNoiseTexture` (`cloudNoise.ts`) |
| `src/scene/grading.ts` + `gradingEffect.ts` + `GradingComposer.tsx` | étalonnage | `GradingSettings`, `DEFAULT_GRADING`, `GRADING_PRESETS`, `GRADING_RANGES`, `isValidGrading`, `isIdentityGrading`, `matchingPreset`, `gradingOfPreset`, `withGradingValue`, `gradingUniforms` ; `GradingEffect` ; `useGradingEffect`, `GradingComposer` |
| `src/project/*` | document de projet, historique, préréglages | `serializeProject(state, name)`, `parseProject(text): LoadedProject`, `sanitizeSettings(raw, base)`, `SETTING_CHECKS`, `migrateProject`, `MIGRATIONS`, `applyProject`, `applySettings`, `createHistory`, `getSettingsHistory`, `installHistoryShortcuts`, `installSliderGestures`, `createPresetStore`, `getPresetStore`, `presetSettings` |
| `src/platform/*` | site / bureau (voir « Application de bureau ») | `getPlatform()` → `Platform` (`capabilities`, `storage`, `openFiles`, `saveFile`, `saveUrl`, `createWritableFile`, `droppedFiles`, `tileCache`, `projectLibrary`), `selectPlatform(scope)`, `videoEncoderMissingHint` ; purs, testés : `isTauriRuntime`, `detectCapabilities`, `acceptAttribute`, `fileNameOf`, `extensionOf`, `mimeTypeOf`, `saveFilters`, `pickerTypes`, `keyValueStore`, `tileFileName`, `imageTypeOf` ; `tileCache.ts` : `TileCache` (`get`, `has`, `put`, `deletePack`, `packs`, `size`), `createWebTileCache`, `createDesktopTileCache` ; `projectLibrary.ts` : `ProjectLibrary` (`list`, `save`, `load`, `rename`, `remove`), `createProjectLibrary`, `createWebLibraryFiles`, `createDesktopLibraryFiles`, `projectFileNames`, `cleanProjectName`, `sortProjectEntries`, `parseProjectEntry` ; `folder.ts` : `WritableFolder`, `canPickFolder`, `pickFolder`, `joinPath` |
| `src/offline/*` | packs de tuiles hors ligne (voir « Packs hors ligne ») | purs, testés : `planOfflineTiles`, `splitDistanceM`, `CORRIDOR_WIDTHS_M`, `MAX_PACK_TILES` (`plan.ts`) ; `offlinePolicy`, `OFFLINE_POLICIES` (`policy.ts`) ; `startPackDownload`, `createDailyQuota` (`download.ts`) ; `createPackRegistry`, `createStoredTileReader`, `packIdFor`, `sourcePrefix` (`packs.ts`) ; non purs : `useOfflineStore`, `installOfflineTiles`, `preparePack`, `pausePack`, `resumePack`, `cancelPack`, `deletePack` (`store.ts`), `OfflinePanel` (`src/ui`) |
| `src/state/store.ts` | état zustand | `useAppStore`, `Settings`, `Playback`, `AppState`, `resetAppStore` |
| `src/ui/*` + `src/App.tsx` | interface | `App` (coque) ; `shell.ts` (pur, testé : `frameRect`, `routeOpenedFiles`, `nextTabIndex`, `nextGridIndex`, `shellReducer`, `parseShellPrefs`, `effectiveProjectName`, `isProjectDirty`) ; `TopBar`, `Stage`, `icons.tsx` (`Icon`, `AspectIcon`) ; `projectActions.ts` (`saveProject`, `openProject`, `chooseFilesToOpen`, `saveExportedFile`, `importTrackFiles`, `loadSample`, `chainLoadedTracks`) ; `importFlow.ts` (orchestration d'import sans React, testée) |

### Règles de développement

- Importer les types depuis `src/core/types.ts` avec `import type`.
- Pas de dépendance React dans `geo/`, `import/`, `terrain/`.
- Choisir un fichier, enregistrer un fichier, lire un dépôt, garder une préférence : passer par `getPlatform()`
  (`src/platform`), jamais par un `<input type="file">`, un lien de téléchargement neuf ou `localStorage`, ni par Tauri
  directement.
- Node n'est pas dans le PATH global. Préfixer chaque commande :
  - PowerShell : `$env:Path = "C:\Users\MadCreator\AppData\Roaming\fnm\node-versions\v24.21.0\installation;" + $env:Path; npm test`
  - Bash : `export PATH="/c/Users/MadCreator/AppData/Roaming/fnm/node-versions/v24.21.0/installation:$PATH"; npm test`
- Scripts : `npm run dev` (port 5173), `npm run build`, `npm test` (vitest run), `npm run typecheck` (tsc --noEmit).

## Chargement (découpage du bundle)

Le premier écran (coque, panneaux, carte d'accueil) ne charge que l'app et React : ~510 kB, ~170 kB gzip, au lieu d'un
seul fichier de 3,1 MB (930 kB gzip). Le reste arrive par `import()` dynamiques, chacun dans son fichier :

- juste après le premier affichage : la scène 3D (`FlyoverCanvas`, three.js + fiber, `React.lazy` dans `Stage`), le tiroir
  d'export (vidéo, lot, affiche : `ExportPanel`) et le panneau « Hors ligne » (`React.lazy` dans `App`). Ils restent montés ;
- avec la première trace : l'atmosphère (Takram, nuages, post-traitement, grille du géoïde : `AtmosphereLayer`, `React.lazy`
  dans `FlyoverCanvas`, sa propre `Suspense` pour que le relief s'affiche pendant ce temps) ;
- à la demande : le décodeur FIT (`@garmin/fitsdk`, au premier .fit, `import/index.ts`), mediabunny (lecture d'une vidéo,
  export, test des codecs du tiroir : `film/video.ts`, `export/encoder.ts`).

Pour garder three.js hors du premier écran, l'app importe les distances et boîtes lon/lat de `geo/lonLat.ts`, pas de
`geo/ellipsoid.ts`. React a son propre fichier (`codeSplitting.groups` dans `vite.config.ts`), gardé en cache d'une version à
l'autre. Les fichiers paresseux de plus de 500 kB (three + fiber, Takram, mediabunny) sont attendus : seuil d'alerte à 800 kB.

## Rendu à la demande

La scène est dessinée seulement quand quelque chose change (`frameloop="demand"`, `src/scene/renderOnDemand.ts`) : à
l'arrêt, plus aucune image. Une image est demandée à chaque image tant que le film joue, que des tuiles se chargent
(`engine.stats.pendingTiles`) ou qu'un recadrage s'anime (`CameraRig`) ; puis `WAKE_FRAMES` = 30 images après tout
changement des stores lus par la scène (application hors `terrainStats` et `loading`, météo, étiquettes, export), après
un drapé (trace, eau, étiquettes), le chargement de la police des étiquettes ou de l'image du marqueur, et pour chaque
texture des chargeurs de three (ciel, nuages) : le temps que le suréchantillonnage temporel des nuages converge
(~16 images). OrbitControls (drei) demande lui-même ses images, amortissement compris. Le pas de temps d'une image est
borné à `MAX_FRAME_DELTA_S` = 0,25 s (`frameDelta`), et `wakeScene` remet l'horloge à zéro quand la scène dormait
(`clock.getDelta()`) : la lecture et le recadrage ne sautent pas après une pause.
L'export garde `frameloop 'never'` et dessine lui-même ses images. Mesuré en rendu logiciel : plus aucune demande d'image
une fois la marge écoulée (~30 s là-bas, une image par seconde ; ~0,5 s sur une vraie carte graphique). Les délais du
moteur comptés en images (nouvel essai d'une tuile en échec, déchargement) attendent la prochaine image.

Aperçu des nuages : préréglage « bas » allégé (`PREVIEW_MARCH` : 120 pas d'au moins 150 m, 15 pour les ombres, au lieu de
200, 100 m et 25), à moitié de la résolution et suréchantillonné dans le temps ; l'export revient à la qualité choisie.

## Moteur de terrain — conception

1. **Sources** (`sources.ts`) : élévation Mapterhorn `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp` (Terrarium, webp),
   AWS Terrain Tiles `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` (Terrarium, z ≤ 15).
   Imagerie : IGN BD ORTHO (Géoplateforme WMTS, PM), EOX Sentinel-2 cloudless, ArcGIS World Imagery, swisstopo SWISSIMAGE.
   Le catalogue contient aussi des fonds non photographiques et datés, jamais choisis automatiquement (`AUTO_IMAGERY_IDS` =
   `ign-ortho`, `swisstopo`) : cartes topographiques `ign-plan` (Plan IGN, France, z19), `swisstopo-carte` (carte nationale
   suisse, z19 ; blanche hors Suisse au-delà de z15) et `opentopomap` (mondial, z17, CC BY-SA, serveur bénévole : pas de
   téléchargement massif, donc exclu des futurs packs hors ligne) ; orthophotos IGN datées :
   `ign-ortho-1950-1965` (France complète, niveaux de gris), `ign-ortho-1965-1980` (partiel, style `BDORTHOHISTORIQUE`, z3–18)
   et `ign-ortho-2000-2005` (z6–18), sur la boîte `FRANCE_BOX` (sur-approximation). Sources écartées (clé requise : Stadia,
   Thunderforest, SCAN 25) : `docs/sources.md`.
   Les URL exactes, zooms max, encodage et support CORS sont vérifiés empiriquement (`docs/sources.md`) ; `sources.ts` est la seule vérité.
   Une source sans CORS passe par le proxy Vite (`/tiles/<id>/...`, cf. `vite.config.ts`).
2. **Fetch** (`fetch.ts`) : `fetch()` + `createImageBitmap`, file de priorité, concurrence ~12, dédoublonnage des requêtes en vol,
   LRU ~600 bitmaps, support `AbortSignal`, 3 réessais (250 ms, 1 s, 4 s, hors cache HTTP) sur erreur réseau, 5xx, 429
   et 400 (la Géoplateforme IGN a renvoyé en rafales « Layer … unknown » en 400 pour des tuiles valides, avec un
   `max-age` de 21 jours) : une sous-tuile d'imagerie en échec reste grise tant que sa tuile de relief vit. Avant le
   réseau, la copie d'un pack hors ligne quand un pack contient la source de l'URL (voir « Packs hors ligne »).
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
     `computeFitView(bounds, frame, groundHeightM)` (`scene/CameraRig.tsx`) : cible = centre, caméra au sud-est, pitch 40°, distance = 1.4 × diagonale de la boîte (min 2 km).
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
  (`getPlatform().storage` `openflyover.shell.v1`, `parseShellPrefs`), pas par le projet.
- **Dock droit** (300 px) : tiroir d'export non modal (`ExportPanel` : formats en tuiles, résolution, estimation, « Exporter
  la vidéo », « Image fixe », « Plus de réglages » : images par seconde, qualité, type d'image ; résumé durée · images · codec ·
  taille sur une ligne ; modes « Vidéo », « Plusieurs formats » : pastilles de résolution par format, image fixe, affiche,
  estimation du lot, « Tout exporter », avancement « 2 / 4 · 16:9 1080p · 42 % », liste des fichiers, et « Affiche ») ;
  sinon l'**inspecteur** du bloc
  sélectionné sur la timeline (`FilmInspector`, deux `<aside class="dock">` dont un seul visible : le tiroir passe devant,
  l'inspecteur revient à sa fermeture si le bloc est encore sélectionné). Sous 1360 px de large, un seul côté ouvert à la
  fois : ce qui remplit le dock (tiroir ou inspecteur) replie le panneau, qui revient quand le dock se vide ; déplier le
  panneau vide le dock et désélectionne le bloc (`shellReducer` : `inspecting`, événement `inspect`, que `App` envoie quand
  `filmSelection` change, après le relâcher d'un appui : la timeline ne change pas d'échelle sous un glisser).
- **Pendant un export** : onglets, repli du panneau, format, « Ouvrir », « Recadrer », annuler / rétablir (boutons) et
  fermeture du tiroir sont désactivés (redimensionner la scène redimensionnerait le canvas).
- **Vue** : bouton flottant « Recadrer la vue » (F) ; clic sur la trace et menu du clic droit (`TrackPicker`, voir « Film et
  timeline »).
- **Zones de sécurité** (`src/ui/SafeZones.tsx`, géométrie pure et testée dans `src/ui/safeZones.ts`) : bouton flottant sous
  « Recadrer » (hors « Libre ») ou G ; état d'aperçu (petit store `useSafeZonesStore`, ni enregistré ni annulable, éteint au
  démarrage). Calque DOM dans `.view__stage` cadré, au-dessus de l'habillage, `pointer-events: none` : l'export (canvas)
  ne le voit jamais. 16:9, 1:1, 21:9 : marges d'action 93 % et de titres 90 % (EBU R 95), en pointillés. 9:16 et 4:5 :
  parties cachées par l'interface des fils verticaux (union Instagram Reels / TikTok / YouTube Shorts relevée sur un écran
  1080 × 1920, arrondie au plus prudent : barre du haut 220 px, boutons à droite 160 × 720 px, légende en bas 440 px), en
  hachuré ; un 4:5 est placé pleine largeur au milieu de cet écran et seules les parties qui le recouvrent restent
  (`phoneInterfaceOver`).
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
- **Bande d'état** (24 px, sous la timeline) : « Chargement de la carte · N tuiles » / « Carte chargée · N tuiles »
  (rien avant la première tuile, atténué, erreurs en orange), import en cours, attributions sur une ligne (`overlayCredits`,
  mêmes chaînes que dans le film) et ⓘ qui ouvre « Sources et licences » (`<dialog>`).
- **Raccourcis** (`src/ui/shortcuts.ts`) : registre `SHORTCUTS` (id, touches, libellé, groupe Lecture / Montage / Projet /
  Vue) affiché par la boîte « Raccourcis clavier » (`HelpDialog.tsx`, `<dialog>` natif, « ? » ou le bouton de la barre)
  et repris dans les infobulles (`withShortcut`). `matchShortcut(touche, keyFocus(cible))`, pur : Ctrl/Cmd+S enregistrer,
  Ctrl/Cmd+O ouvrir, Ctrl/Cmd+E tiroir d'export, F recadrer, G zones de sécurité, S arrêt au marqueur, T texte à la tête de lecture, `[` replier
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
  ombres, météo dans la scène), « Couleurs » (étalonnage), puis « Repères (OpenStreetMap) » (`LandmarkPanel`, absente sans trace) et « Points d'intérêt » (`PoiPanel`, de même). Survol : « Caméra » (préréglage, style en tuiles à icônes, nord en haut),
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
  première trace connaît son décalage UTC (`Track.utcOffsetMin`, `clockHourOfSolar`), l'heure solaire dans le ⓘ,
  sinon en « heure solaire » seulement (pas de base de fuseaux horaires), et six raccourcis « Lever » (premier quart d'heure après le lever), « Matin »
  (mi-chemin vers midi), « Midi », « Heure dorée » (1 h avant le coucher), « Coucher » (dernier quart d'heure avant),
  « Nuit » (minuit solaire), grisés quand le moment n'existe pas (jour ou nuit polaire). Chaque raccourci est une étape
  d'annulation (`transaction`) ; un glissé du curseur en est une (voir « Historique »).
- **Clarté des panneaux** (bloc « Clarté » en fin de `app.css`) : interrupteur (`checkbox checkbox--switch`, case native
  dessinée) pour allumer une fonction entière (habillage et chacun de ses éléments, atmosphère, météo, repères, course
  fantôme, ralentis, crédits) ; pastilles à cocher (`chips` / `chip`, case native cachée, coche et fond encre une fois
  choisie, pointillés si indisponible) pour les choix multiples (types de repères, compteurs) ; texte des options en 500,
  libellés en 600. Sans trace, Carte, Survol et Habillage commencent par une ligne « Ajoutez une trace… » (`tab-hint`,
  `NO_TRACK_HINT_TABS` dans `App`). Trace : météo en deux lignes (sortie ; instant du marqueur), tableaux repliés sous
  « Détails » ; Synchronisation et classement de la course fantôme seulement une fois activée. Habillage (`OverlayPanel`)
  en `PanelSection` : « Habillage » (interrupteur, style, « Couleurs et polices » repliée ; seul « modifié / Par défaut »,
  pour tout `overlay`), « Titres », « Compteurs » (et « Classement (course fantôme) » dès deux traces), « Profil et mini-carte », « Météo, logo et texte » (absentes quand l'habillage est éteint), « Crédits des
  sources » (toujours). `PanelSection` accepte des sections sans `keys` (pas de marqueur). Projet : sans préréglage, une
  ligne au lieu d'une liste vide. Lumière : lever / coucher sur une ligne (heure locale si la trace donne son décalage,
  sinon heure solaire), l'heure solaire correspondante dans le ⓘ d'« Heure solaire ». ⓘ aussi sur les réglages fins de la
  caméra et la durée du survol. Clés des réglages et comportement inchangés.
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
  « Cadrer la caméra pendant cet élément » (inspecteur d'un texte ou d'un média) : `addItemCamera` pose un cadrage là où
  est le marqueur au début de l'élément (sélectionné, à régler) et, si le marqueur avance pendant l'élément, un second à
  sa fin qui garde le cadrage qui y était : les cadrages voisins gardent leurs valeurs (entre la fin de l'élément et le
  cadrage suivant, la transition est recalculée sur le nouvel intervalle).
  « Garder ce cadrage ici » (section « Caméra ») pose un cadrage du film au marqueur (`addCameraKey`, avec le cadrage vu
  là : `keyedCamera` ; un cadrage déjà à ce mètre le reprend), un pas d'annulation, sélectionné pour l'inspecteur (voir
  « Film et timeline », « Caméra »).
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

## Atmosphère (phase 3)

- **`AtmosphereLayer`** (`src/scene/AtmosphereLayer.tsx`, dans `TerrainLayer`) : modèle de diffusion précalculé de Takram
  (`@takram/three-atmosphere`). `worldToECEFMatrix` = `mslLocalToEcef(frame)` (repère local remonté de l'ondulation du
  géoïde : +51 m à Chamonix, voir « Conventions de coordonnées »). Éclairage **par sources** (`SunLight` +
  `SkyLight` placées à l'origine, 1000 m) : le terrain garde son `MeshStandardMaterial`. Post-process (`EffectComposer`) :
  perspective aérienne (brume selon la distance réelle), tone mapping **Khronos Neutral** (garde les teintes des
  orthophotos), SMAA, étalonnage (voir « Étalonnage »). Exposition 5.
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

## Étalonnage (« Couleurs »)

- **Réglage** `settings.grading` (`src/scene/grading.ts`, pur et testé) : `contrast`, `saturation`, `warmth` (−1..1),
  `vignette` (0..1), et `preset` (`naturel`, `lumineux`, `doux`, `contraste`, `chaud-du-soir`, `froid-altitude`,
  `noir-et-blanc`, ou `personnalise`). Le préréglage suit toujours les valeurs (`withGradingValue` → `matchingPreset` : un
  curseur ramené sur les valeurs d'un préréglage le resélectionne). Validé à l'ouverture d'un projet (`isValidGrading`).
- **Effet** (`src/scene/gradingEffect.ts`) : un seul `Effect` de `postprocessing`, par pixel, sans texture ni profondeur :
  balance des blancs (gains R / B, luminance conservée) → saturation (mélange avec la luminance Rec. 709) → courbe en S
  autour du gris moyen en sRGB (0 et 1 fixes, rien n'écrête ; pente 2^contraste) → vignettage (jusqu'à −60 % dans les
  coins, distance en unités du cadre : même rendu à toute résolution). Un curseur ne change que des uniformes (pas de
  recompilation). L'habillage (canvas 2D au-dessus, composé après la scène à l'export) n'est pas étalonné :
  textes et logos gardent les couleurs de leur style.
- **Place dans la chaîne** : avec l'atmosphère, dernier effet du composer d'`AtmosphereLayer`, **après** le tone mapping et
  le SMAA (le SMAA lit l'entrée de sa passe : un effet placé avant lui dans la même passe serait ignoré sur les bords).
  Sans l'atmosphère, il n'y a pas de composer : `GradingComposer` (`src/scene/GradingComposer.tsx`, chargé à la demande
  par `FlyoverCanvas`) en monte un minimal (rendu, SMAA, étalonnage). Le canvas étant alors transparent sur le dégradé CSS du
  ciel, l'effet pose d'abord l'image (prémultipliée) sur le **même dégradé** (`SKY_TOP_COLOR` → `SKY_HORIZON_COLOR`,
  interpolé en sRGB comme le CSS) : le ciel est étalonné aussi et la sortie est opaque ; l'export, qui peint ce dégradé sous
  le canvas (`fillSky`), obtient la même image. Choix plutôt qu'un étalonnage dans le compositeur 2D de l'export : un seul
  code pour l'aperçu et l'export.
- **Coût** : « Naturel » (valeurs nulles, `isIdentityGrading`) ne monte **rien** (ni effet, ni passe ; sans atmosphère ni
  composer, ni chargement de `postprocessing`). Sinon quelques dizaines d'opérations par pixel, fusionnées dans la passe
  existante. Sans atmosphère, passer de « Naturel » à un préréglage remplace le MSAA natif du canvas par le SMAA.
- **Interface** : section « Couleurs » de l'onglet Carte (`src/ui/GradingPanel.tsx`) : pastilles des préréglages (une
  étape d'annulation chacune), les quatre curseurs sous « Plus de réglages ».

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

## Trace et marqueur

- **Réglages** `settings.trackStyle { width, dash: 'plein' | 'tirets' | 'points', glow, drawOn }` et `settings.marker { kind:
  'boule' | 'figurine' | 'image', figure, image, size }` (`src/scene/markerSettings.ts`, pur). Défauts = l'aspect d'avant
  (4 px, plein, boule blanche). Vérifiés par `SETTING_CHECKS`, complétés par `SETTING_UPGRADES` (clés ajoutées plus tard).
  `image` : PNG carré de 128 px en data URL (`fileToAvatarDataUrl`, sélecteur de la plateforme), 300 000 caractères au plus.
  Section « Trace et marqueur » de l'onglet Survol (`src/ui/TrackMarkerSection.tsx`).
- **Largeur** : pixels d'une image de 1080 px, fois `renderScale` à l'export (comme avant). **Halo** : troisième `Line2` sur la
  même géométrie, 3,5 fois plus large, matériau `LineMaterial` dont le fragment est remplacé (`onBeforeCompile`, clé de
  programme propre) : couleur de la trace × fondu radial (`vUv`), mélange **MAX** — pas de perles aux jointures des
  morceaux qui se recouvrent, la trace garde sa teinte ; le halo éclaire surtout les fonds sombres. Suit l'exposition et les
  couleurs par sommet comme les deux autres passes.
- **Tirets / points** : tirets de `LineMaterial` mesurés en unités du monde (`computeLineDistances`, refait à chaque
  drapage). Échelle = taille d'un pixel à la distance caméra → cible des contrôles, **arrondie à une puissance de deux**
  (`quantizedPixelSize`) : les tirets restent fixes au sol pendant le vol et ne changent de longueur que quand le zoom
  double. Motifs en largeurs de trait : tirets 3 / 2, points 1 / 1,5.
- **Trace qui se dessine** : chaque segment garde la distance de chaque point depuis le départ de sa trace (comme
  `buildTrackPath`, sans compter les sauts entre segments). `cutLine` limite `geometry.instanceCount` aux morceaux parcourus
  et déplace la fin du dernier morceau exactement sur le marqueur (restaurée au découpage suivant ; un drapage la réécrit).
  Distance : progression × longueur pour la première trace, `racer.distanceM` pour les autres pendant une course fantôme,
  trace entière sinon. Appliqué par un abonnement au store (la progression posée par `FlyoverRig` est prise dans la même
  image, bien que `TrackLines` passe avant lui) et à chaque image (après un drapage) ; sans effet quand rien ne change.
  Fonction de la progression seule : aperçu = export. La partie à venir est masquée (pas de fantôme).
- **Marqueurs** (`markerSprite.ts`) : un `Sprite` par marqueur (tête : `FlyoverRig`, nom `flyover-marker` ; course :
  `RaceMarkers`), texture de badge dessinée sur canvas (`markerBadge.ts`) et mise en cache par clé (48 au plus). Boule :
  disque blanc (tête) ou couleur de la trace dans un halo encre ×1,35 (course) — même aspect qu'avant. Figurine : pictogramme
  24 × 24 au trait (style Lucide ; vélo et voiture repris de Lucide) sur disque encre bordé de blanc (tête) ou couleur de la
  trace bordée d'encre (course), trait encre ou blanc selon la luminance. Image : photo en rond, bord blanc ; les coureurs
  gardent leur boule. Diamètre des badges : 2,2 fois la boule. Taille écran constante : rayon = max(1, distance × 0,007)
  × `size`. Couleurs divisées par l'exposition, comme les lignes.
- **Sens** : la figurine est retournée quand la trace va de droite à gauche à l'écran, d'après les points de la trace à
  ±60 m du marqueur projetés avec la caméra de l'image (`headsLeft`, sans état : même image à l'aperçu et à l'export).

## Film et timeline (phase 4, incréments 1 à 4 sur 4 : modèle, moteur, timeline, textes, photos et vidéos ; musique et son des vidéos, phase 7)

- **Principe** : comme un logiciel de montage, « la base, c'est le GPX » : le survol continu de la première trace porte le
  film ; des éléments posés sur des pistes séparées s'y ajoutent. Incréments : 1 modèle pur et moteur (fait) ; 2 timeline sous
  la vue (pistes, glisser pour déplacer / étirer, inspecteur ; fait) ; 3 piste des textes dessinée dans l'habillage (fait) ;
  4 piste des médias (photos et vidéos faites, avec leur son : voir « Son des vidéos »).
- **Modèle** (`src/film/model.ts`, `settings.film` : enregistré dans le document de projet, annulable, validé par
  `isValidFilm` dans `SETTING_CHECKS`, aucune migration : un ancien projet reçoit `DEFAULT_FILM`) :
  `opening` / `closing` `{ style: 'aucune' | 'descente' | 'saut' | 'situation' | 'balayage', durationS }` (1–30 s ; défaut descente 6 s / 5 s) ;
  `autoStops` (arrêts générés) et `autoMode` : `'temps-forts'` (défaut des nouveaux projets) ou `'rythme'` (projets
  antérieurs) ;
  `stops[]` `{ id, atM, durationS (0,5–60 s), camera: 'film' | 'orbite' | 'large' | 'fixe', label?, source?: { kind, ref? } }`
  (`STOP_CAMERA_LABELS` : « Comme le film », « Tour lent », « Vue large », « Fixe ») ;
  `cameraKeys[]` `{ id, atM, distance, pitchDeg, headingOffsetDeg }` (cadrages de la caméra de vol le long de la première
  trace, mêmes plages que `CAMERA_RANGES`, `isValidCameraKey` ; vide par défaut, un film enregistré avant reçoit `[]`) ;
  `speeds[]` `{ id, fromM, toM, factor (×0,25–×4) }` (portions de la première trace, en mètres, jamais chevauchantes,
  elles peuvent se toucher ; `isValidSpeed`, vide par défaut, un film enregistré avant reçoit `[]` par `withFilmDefaults`) ;
  `texts[]` `{ id, startS, durationS, text, subtitle?, anchor, size }` (placement du widget texte de l'habillage) et
  `media[]` `{ id, startS, durationS, kind: 'image' | 'video', src, layout: 'plein-ecran' | 'carte', anchor, size, kenBurns,
  caption?, inS?, outS?, muted?, sync? }` (`src` = id de l'image ou de la vidéo dans la table des médias du document, voir
  « Photos » et « Vidéos » ; vidéo : `inS` / `outS` = début et fin du morceau dans le fichier, défaut son début et sa fin,
  `clipTimeS` ; `muted` et `volume` (0–1, défaut 1) : son de la vidéo, voir « Son des vidéos » ; `sync` `{ startMs, offsetS, follow }` : vidéo
  calée sur la trace, voir « Vidéo calée sur le parcours » ; `MEDIA_DEFAULTS` : plein
  écran, Ken Burns, légende en bas à gauche, taille 1, aussi pour un média enregistré sans ces champs par
  `withFilmDefaults`), et `audio[]` `{ id, src, startS, durationS (0,5 s–1 h), inS, volume (0–1), fadeInS, fadeOutS (0–30 s) }`
  (musiques, voir « Musique » ; `src` = id du fichier son dans la table des médias ; `AUDIO_DEFAULTS` : volume 1, fondus
  0,5 s / 2 s ; `isValidAudio` ; un film enregistré avant reçoit `[]`), ancrés en temps du film, et `duckMusic` (« Baisser la
  musique sous les vidéos », faux par défaut et pour un film enregistré avant) ; `pois[]` `{ id, lon, lat, name }` (points
  d'intérêt placés à la main, voir « Points d'intérêt » ; un film enregistré avant reçoit `[]`) ; `landmarkTitles` (« Ralentir
  et titrer aux repères », vrai par défaut, faux pour un film enregistré avant : son vol ne change pas) ; ids uniques dans le film
  (`stop-3`, `text-1`, `media-2`, `music-1`, `poi-2`, `nextFilmId`).
- **Assemblage automatique** (`src/film/assemble.ts`) : tant que `autoStops` est vrai, les arrêts sont générés à chaque calcul
  (`autoStops`) aux temps forts (`stopCandidates` : sommets des montées, cols franchis, sommets proches, selon les cases
  `climbs` / `landmarks` du rythme ; un par groupe de `windowM`, comme les pauses qu'ils remplacent), id `auto-<mètres>`,
  libellé (« Montée 1 · cat. 3 · 1 653 m », nom OSM) et source ; ils suivent les repères OSM chargés après coup.
  `'temps-forts'` : un arrêt par temps fort **même rythme désactivé**, `AUTO_STOP_S` (4 s), caméra `orbite` (ce sont tous
  des sommets ou des cols). `'rythme'` : les pauses du rythme d'avant la timeline (rien si le rythme est désactivé,
  `pauseS`, caméra `film`, comme ces pauses avant). `materializeStops` écrit les arrêts générés dans le film (`autoStops: false`) à la première
  retouche d'un arrêt ; `assembleFilm` = film par défaut ainsi écrit.
- **Ralentis et titres aux repères** (`landmarkTitles`, même module) : `pickLandmarkTitles` choisit, parmi les repères de la
  première trace, les cols et sommets à 150 m au plus (`TITLE_NEAR_M`) et les refuges à 100 m au plus, par priorité
  décroissante (égalité : position, puis id : déterministe), jamais deux à moins de 10 s de film (`TITLE_GAP_S`), un par
  3 km de trace (au moins un, au plus 6). Chacun reçoit une carte de texte (`texts`, id `auto-text-<id OSM>`, nom, altitude
  en sous-titre si connue, en haut au centre, 4 s dès 1 s avant le passage du marqueur) et une portion ×0,5 sur 400 m
  centrée sur lui (`speeds`, id `auto-speed-<id OSM>`), sauf si elle couvrirait un arrêt du film ou un temps fort ralenti
  par le rythme actif, ou chevaucherait une autre portion : le titre seul alors (au début de la tenue d'un arrêt).
  Contrairement aux arrêts, ces éléments sont **écrits dans le film** (le temps des textes dépend de l'horloge) :
  `withLandmarkTitles` retire les éléments `auto-speed-` / `auto-text-` et les refait, sans toucher ceux de l'utilisateur ;
  les titres sont placés avec l'horloge du film ralenti (`PassingTimes`). **Quand** : `setLandmarkTitles`
  (`scene/usePacing.ts`) à la case du panneau des repères (cochée : refaits, décochée : retirés) et, case cochée, à chaque
  publication des repères de la première trace (chargement Overpass, types ou distance changés ; effet de `LandmarkPanel`),
  un pas d'annulation, aucun quand rien ne change (repères republiés à l'identique, projet rouvert tel qu'enregistré).
  Pas à une retouche du film ni de la durée : comme tous les textes, les titres restent à leur temps jusqu'à la
  publication suivante, qui les replace ; un titre annulé le reste jusque-là. Retoucher ou supprimer un de ces éléments (`editFilm`, gestes et flèches de la
  timeline) décoche la case (`freezeLandmarkTitles`), comme une retouche d'arrêt fige les arrêts générés.
- **Anciens projets** : un film enregistré sans `autoMode` est complété par `withFilmDefaults` (`SETTING_UPGRADES`, aussi pour
  les préréglages) avec `'rythme'` ; un projet v1 sans film reçoit `{ autoMode: 'rythme' }` par la migration v1 → v2
  (`MIGRATIONS[1]`), complété de même : leurs arrêts restent ceux de leur rythme.
- **Préréglages** : seuls les plans d'ouverture et de clôture du film sont enregistrés ; `stops`, `speeds`, `texts`, `media`,
  `audio` (et `autoStops`) appartiennent à la trace et restent ceux du projet courant à l'application (`presetSettings`, y compris pour
  un préréglage enregistré avec tout le film).
- **Horloge du film** (`src/film/clock.ts`, `buildFilmClock` / `filmClockFor`, hook `useFilmClock` dans
  `src/scene/usePacing.ts`, alias `usePacing` pour les panneaux ; au même endroit `getFilmSource` hors React et
  `editFilm(edit, { stops, step })` : retouche du film des stores en un pas d'annulation, arrêts générés écrits d'abord
  pour un arrêt, sélection du bloc rendu par la retouche) : temps du film (s à ×1 depuis la première image) →
  `stateAt(t)` = `{ phase: 'opening' | 'flight' | 'stop' | 'closing', progress, flightTimeS, stop, localS, lengthS }`.
  [0, O) ouverture (progression 0), [O, O + F) vol, [O + F, total] clôture (progression 1). Le vol est `flightPacing` :
  ralentis du rythme aux temps forts, portions de vitesse du film, arrêts du film insérés avec entrée et sortie en cosinus
  surélevé (≤ 1,5 s), chacun sa durée ; `keepDuration` garde F = `flyoverDurationS` (arrêts ≤ 50 %, raccourcis en
  proportion ; une portion accélérée ralentit d'autant le reste). **Portions de vitesse** (`flightPacing(…, speeds)`) : la
  vitesse locale (ralentis compris) est multipliée par m(x) = factor^w(x) sur [fromM, toM], w montant de 0 à 1 en cosinus
  surélevé sur `SPEED_EASE_S` (1,5 s) à la vitesse de base, à l'intérieur de la portion (au plus sa moitié), et
  redescendant de même à sa fin : jamais de saut de vitesse ; 32 pas de grille par transition, inverse toujours exact.
  Appliquées que le rythme soit actif ou non, combinées aux arrêts (un arrêt dans une portion reste un arrêt). L'horloge
  les place en temps du film (`clock.speeds` : `startS` / `endS` = passage du marqueur aux bords). La fenêtre d'un arrêt
  (entrée, tenue, sortie) est la phase `stop`. `timeAtProgress(0)` = début du vol (après l'ouverture), `timeAtProgress(1)` =
  fin du film ; lancer la lecture depuis le début ou la fin sans temps du film part de la première image (`setPlaying` fixe
  `timeS = 0`), ouverture comprise. Sans ouverture ni clôture et sans retouche, l'horloge rejoue exactement l'ancien rythme
  (tests d'équivalence).
- **Caméra** (`src/flyover/filmCamera.ts`, pur) : vue d'ensemble = centre de la boîte de la trace dans le repère local au sol,
  distance 1,6 × diagonale (relief compris, × hauteur / largeur pour un cadre plus haut que large : le 9:16 garde toute la
  trace), 40° au-dessus de l'horizon, du côté d'où regarde la caméra de vol au raccord (pas de virage pendant la transition).
  Transition : cible interpolée, direction normalisée (nlerp), distance géométrique, smootherstep, 80 m au-dessus du sol ;
  `descente` sur toute la durée du plan, `saut` tient la vue d'ensemble puis bouge en 0,6 s. `balayage` : la vue
  d'ensemble tourne de `SWEEP_DEG` = 75° autour de sa cible (`turnedView`, `sweepRad`) pendant les premiers 60 % du plan
  d'ouverture et finit du côté du vol, puis glisse comme `descente` (clôture : l'inverse). `situation` (« Depuis la
  région », plan de situation) : comme `descente`, mais depuis (ou, en clôture, jusqu'à) la vue de la région
  (`regionView`) : même cible et même côté que la vue d'ensemble, 65° au-dessus de l'horizon, distance
  `regionDistanceM` = 5 × diagonale (× hauteur / largeur en portrait), bornée pour que le coin le plus lointain du cadre
  (`groundReach`, sol plat, champ vertical de 50°) reste dans la zone du relief (boîte de la trace + 25 km de marge,
  40 km au moins, comme `TerrainLayer`) ou pas plus loin que ce que montre déjà la vue d'ensemble, jamais plus près que
  celle-ci. Un seul mouvement (distance géométrique, smootherstep), qui passe la distance de la vue d'ensemble en route
  sans s'y arrêter : pas d'à-coup, jamais de recul. Le plan lointain de la caméra (5 000 km) ne limite rien ; vue de haut,
  le moteur choisit des tuiles grossières (chargement à temps : `docs/tests-gpu.md`). Caméra d'un arrêt : `film`, la
  caméra de vol continue (le marqueur tient, la caméra aussi, sauf les styles orbite et cinéma qui gardent leur mouvement) ;
  `orbite`, rotation autour du marqueur de 6°/s × durée (≤ 120°) aller et retour ; `large`, distance × 2,5 et tangage + 20°
  au milieu de la fenêtre, aller et retour (`widenedCamera`) ; les deux suivent la bosse (1 − cos 2πx) / 2 de la fenêtre
  (`stopBump`), nulle et immobile à ses bords ; `fixe`, le cadrage tient, y compris le mouvement des styles orbite et
  cinéma : leur temps glisse vers le milieu de la fenêtre pendant l'entrée, y reste pendant la tenue, en revient pendant
  la sortie (`heldMotionTimeS`, smootherstep, jamais en arrière, sans saut). Les styles orbite et cinéma suivent le temps du
  vol (`flightTimeS`), ils démarrent donc là où l'ouverture les rend.
  **Cadrages** (`keyedCamera`, pur) : distance, tangage et visée de la caméra de vol à la distance d du marqueur, à partir des
  réglages du film et des `cameraKeys` (triées par position dans l'horloge, `clock.cameraKeys` avec leur temps du film) :
  entre deux cadrages, de l'un à l'autre en smootherstep sur la distance (dérivées première et seconde nulles à chaque
  cadrage : pas d'à-coup) ; avant le premier, depuis les réglages du film sur `cameraKeyEaseM` (3 s de vol à la vitesse
  de base, `CAMERA_KEY_EASE_S`), après le dernier, retour de même ; ailleurs les réglages du film. Linéaire en distance et
  en tangage, visée par le plus court chemin. Le style et le lissage restent ceux du film. Fonction de la progression
  seule : immobile pendant un arrêt, `filmViewMovesWithTime` inchangé.
  Le marqueur reste sur la trace (`view.marker`), la cible ne l'est que pendant le vol.
- **Aperçu et export** : `FlyoverRig` et `ExportController` appellent le même `computeFilmView` avec la même horloge (le
  rapport largeur / hauteur vient de la taille du rendu, celle de la vidéo pendant l'export). La caméra est replacée en pause
  et une image d'export est recalculée quand la progression change **ou** quand le temps change alors que la vue en dépend
  (`filmViewMovesWithTime` : plans d'ouverture et de clôture, arrêts en orbite ou en vue large, styles orbite et cinéma, à l'image courante
  ou précédente). Le panneau d'export lit la durée et `progressAtTime` de la même horloge (`usePacing`).
- **Temps du film conservé** : quand l'horloge change (retouche du film, durée, rythme), `FlyoverRig` garde `playback.timeS`
  et en déduit la progression : une retouche en pause ne fait pas sauter la tête de lecture.
- **Timeline** (`src/ui/Timeline.tsx`, logique pure dans `src/film/timeline.ts`, inspecteur `src/ui/FilmInspector.tsx`) :
  bandeau sous la vue 3D (`.view__stage` au-dessus, la vue rétrécit d'autant ; ~150 px, pistes repliables). Barre, un seul
  style de contrôle (boutons à icône Lucide, infobulle `data-tip` avec le raccourci du registre, libellé court masqué à
  1280 px) : lecture, ■ (pause et retour à la première image), temps `m:ss,d / m:ss`, distance / altitude / heure au
  marqueur, « Arrêt » (S : à la position du marqueur, au mètre, source `manual`, 4 s, orbite), « Arrêt à un temps fort… »
  (temps forts sans arrêt), « Texte » (T : à la tête de lecture, 4 s, en bas au centre), « Média » (voir « Photos » et
  « Vidéos »), haut-parleur (coupe ou remet le son de l'aperçu, musique et vidéos, `useMusicPreview`, montré quand le film a une
  musique ou une vidéo avec du son ; ni enregistré ni annulable, l'export garde le son), vitesse,
  zoom (− / curseur logarithmique / + / « Ajuster » = tout le film), menu « Options » (« Ajouter une musique… », voir
  « Musique » ; case « Arrêts automatiques » :
  cochée, `autoStops` + `'temps-forts'`, arrêts propres effacés ; décochée, arrêts générés écrits ; pastille « modifié » /
  « Par défaut » du film, `ModifiedMarker keys={['film']}` ; un point sur le bouton quand le film s'écarte du défaut ; se
  ferme par Échap, un clic dehors ou Tab), replier.
  Règle (`rulerTicks`, pas de 1 s à 1 h selon le zoom, ≥ 56 px) : cliquer-glisser pour se placer **ouverture et clôture
  comprises** (`setProgress(clock.progressAtTime(t), t)`, fin du film = progression 1 sans temps) ; c'est aussi un curseur
  clavier (flèches ±1 s, Maj ±5 s, Page ±10 s, Début / Fin). Pistes « Plans » (ouverture, survol avec profil, clôture ;
  « aucune » = amorce pointillée sélectionnable ; les arrêts y sont aussi marqués sur la barre du survol, fenêtre teintée
  et bord haut à l'accent, blanc pour l'arrêt sélectionné ; les cadrages y sont de petits losanges au passage du marqueur,
  sélectionnables, focalisables et glissables), « Arrêts » (fenêtre de chaque arrêt, entrée et sortie
  comprises ; pointillés tant qu'ils sont générés), « Textes », « Médias » (photos et vidéos, avec leur vignette ; une
  vidéo porte en plus une petite icône de caméra). Piste « Vitesse » sous « Plans » : un bloc par portion, de son entrée à
  sa sortie en temps du film, libellé « ×2 » (cadre plein si accélérée, pointillé si ralentie) ; « Vitesse » de la barre
  (`addSpeed` : ×2 sur 1 km à partir du marqueur, raccourcie ou avancée pour rester sur la trace et hors des autres
  portions ; message si le marqueur est déjà dans une portion ou s'il n'y a pas 50 m libres). Piste « Musique » sous
  « Médias » : un bloc par musique, nom du fichier, icône de note et forme d'onde (`waveformPath`, la partie du fichier
  jouée, en bande symétrique, à l'échelle du passage le plus fort) ; vide, elle dit où déposer un fichier.
- **Gestes** (`dragFilm`, pur) : glisser un arrêt le déplace le long de la trace — son début de tenue suit le pointeur,
  position trouvée par dichotomie sur l'horloge (`stopPositionAt`, 32 pas) ; son bord droit l'allonge (en proportion du
  plafond `keepDuration`) ; un texte ou une photo se déplace ou s'étire par ses deux bords ; le bord intérieur de l'ouverture / de la
  clôture change sa durée ; le bord gauche d'une vidéo déplace aussi son début dans le fichier (`inS`, jamais avant le
  début du fichier : les images restent en place) ; une musique se déplace, son bord droit ne dépasse jamais la fin du
  fichier (`DragContext.audioFileS`), son bord gauche déplace son début dans le fichier comme une vidéo ; une portion de vitesse se déplace (longueur en mètres gardée) ou
  s'étire par ses deux bords, le bord tenu suit le pointeur en temps du film, position trouvée en mètres par dichotomie
  sur l'horloge de la portion modifiée (`DragContext.clockOfSpeeds`, comme un arrêt), jamais sur ses voisines, 50 m au
  moins (`MIN_SPEED_SPAN_M`), au mètre ; un cadrage se déplace : sa place est celle du marqueur au temps visé
  (`clock.progressAtTime`, au mètre). Aimantation à 8 px (`snapTargets` : début et fin du film, bords des plans, des arrêts, des
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
  (style, durée), arrêt (libellé, durée, « Caméra pendant l'arrêt » en liste avec une phrase d'aide, position et fenêtre),
  cadrage (distance, inclinaison, visée, « À (km) », `updateCameraKey` : plages de la caméra, visée ramenée dans ±180°), vitesse (pastilles ×0,25 ×0,5 ×1,5
  ×2 ×3 ×4, « Réglage fin » en puissances de 2, de / à en km bornés par `updateSpeed`, effet sur la durée), texte (texte, sous-titre, position,
  taille, début, durée), photo (vignette, affichage plein écran / carte, Ken Burns, légende, position, taille, début, durée),
  vidéo (les mêmes sans Ken Burns, plus « Début dans la vidéo », longueur du fichier, bloc « Son » : case « Son de la
  vidéo » et volume en %, grisés en suivant la vitesse du survol, et « Calage sur le parcours » quand l'heure du tournage
  est connue), musique (nom du fichier, volume en %, fondus d'entrée et de sortie 0–10 s, début, durée, « Début dans le
  fichier », bornés par `updateMusic` à la longueur du fichier, case « Baisser la musique sous les vidéos » du film,
  « Caler la durée du film sur la musique »).
  Position : grille 3 × 3 (`radiogroup` de 9 `role="radio"`, focus itinérant, flèches qui déplacent et choisissent,
  `nextGridIndex`, libellé de la position à côté). Les modifications passent par `editFilm(…, { step: false })` (frappes
  fusionnées en un pas) ; retoucher un arrêt généré écrit d'abord tous les arrêts.
- **Sur la trace** (`src/scene/TrackPicker.tsx`, monté dans `FlyoverCanvas`) : un clic sur la première trace place la tête
  de lecture au point visé (`setProgress(p, clock.timeAtProgress(p))`) ; un clic droit ouvre « Ajouter un arrêt ici » /
  « Ajouter un texte ici » / « Accélérer / ralentir ici » (portion ×2 à partir du point ; dans une portion, la
  sélectionne) (`TrackMenu`, DOM au-dessus du canvas, `role="menu"`, flèches, Échap, clic dehors ; chaque ajout
  par `editFilm` : un pas d'annulation, bloc sélectionné) ; curseur main au survol de la trace. Clic = appui et relâcher du
  même bouton à moins de 4 px (un glisser d'OrbitControls n'est pas un clic ; le menu s'ouvre au relâcher, pas sur
  `contextmenu`, qui part à l'appui sous Linux et macOS). Sélection en espace écran (`pickProjectedPath`, pur) : 1 500
  points répartis le long de la trace, plaqués comme la ligne (relief chargé, sinon altitude enregistrée, × exagération +
  3 m ; recalculés au plus une fois par seconde), projetés par la caméra, segment le plus proche à 12 px au plus,
  distance interpolée. Rien pendant un export. Limite : une portion cachée par le relief se sélectionne aussi (la ligne
  la montre en transparence). Le clic droit sur le relief, sur la trace ou ailleurs, ajoute « Point d'intérêt ici » (seul
  choix hors de la trace) : rayon de la caméra sur les tuiles dessinées (`Raycaster` sur les maillages visibles du groupe
  du moteur, seulement au clic droit), point de la trace visé si aucune tuile n'est encore là.
- **Textes dans le film** (incrément 3) : dessinés par l'habillage (voir « Habillage du film », temps du film et textes de
  la timeline), dans l'aperçu comme à l'export.
- **Photos** (incrément 4) : « Média » (sélecteur, plusieurs fichiers, photos et vidéos) ou fichiers déposés sur la
  timeline ; les fichiers sont lus un à un (`readMedia` : `readPhoto` ou `readVideo`), ajoutés à la table des médias
  (`useMediaStore.add`, ids `photo-<n>` / `video-<n>`) puis au film à la tête de lecture, à la suite (`addMedia` : 5 s par
  photo), en un pas d'annulation ; les autres fichiers sont ignorés avec un message. `readPhoto` lit l'EXIF des 128 premiers Ko (`parseExif`, analyseur pur :
  position GPS, heure d'origine et son décalage, sinon heure GPS en UTC, sinon heure locale lue dans le fuseau du
  navigateur, `photoTimeMs`), décode l'image redressée (`createImageBitmap`, `imageOrientation: 'from-image'`), la
  réduit à 2 560 px au plus en JPEG 0,85 et en fait une vignette de 160 px (JPEG 0,7). Placement proposé
  (`photoFilmTime`, pur) : point de la trace le plus proche de la position (à 2 km au plus ; sur un aller-retour, le
  passage enregistré le plus près de l'heure, `nearestOnPath`), sinon point enregistré à l'heure de la photo (trace
  horodatée, 15 min de tolérance aux extrémités, `distanceAtTime`) ; temps du film = `clock.timeAtProgress(distance /
  longueur)`. Le message (toast) propose « Placer sur le parcours » (un pas d'annulation de plus).
- **Vidéos** (`src/film/video.ts`) : MP4, WebM ou QuickTime (`isMediaFile` : type `video/*`, ou extension `.mp4`,
  `.m4v`, `.mov`, `.webm` sans type), de `MAX_VIDEO_BYTES` (50 Mo) au plus, message clair au-delà : le fichier est gardé
  tel quel (pas de réduction possible à bon compte dans la page) pour que le projet reste un seul fichier, web comme
  bureau. `readVideo` ouvre le fichier avec mediabunny, refuse une vidéo sans image ou que le navigateur ne décode pas
  (`canDecode`, WebCodecs : le même décodeur que l'export), lit sa taille d'affichage et sa longueur, fait la vignette
  de sa première image (160 px, JPEG 0,7). Ajoutée à sa longueur, 30 s au plus (`NEW_VIDEO_MAX_S`), sans Ken Burns ; au
  delà de la fin du fichier (bloc étiré), la dernière image reste affichée, sans son. Aperçu (`getPreviewVideos`, dans
  `OverlayCanvas`) : un `HTMLVideoElement` par média, muet sauf en lecture à ×1 (voir « Son des vidéos ») (URL d'objet du
  fichier ; un MOV est passé comme MP4), lu en même temps que la lecture (vitesse de lecture reprise, recalé au-delà
  de 0,3 s d'écart), en pause et recalé sur le temps du film quand on se déplace (la dernière image recalée, copiée sur
  un canvas de 1 920 px au plus, reste affichée pendant le recalage suivant) ; les vidéos non dessinées par une image
  sont mises en pause, celles qui quittent le film libérées ; rien pendant un export. Export : voir « Export vidéo ».
- **Vidéo calée sur le parcours** (phase 7, « vidéo embarquée synchronisée ») : heure de début du tournage lue à l'ajout
  (`readVideo`, rangée dans la table des médias : `recordedMs`, `recordedApprox`) : date avec fuseau des appareils Apple
  (`com.apple.quicktime.creationdate` des métadonnées de mediabunny, `quickTimeDateMs`), sinon heure de création de l'en-tête
  du film (`moov` › `mvhd`, secondes depuis 1904 en UTC, `mp4CreationTimeMs` : analyseur pur qui ne lit que les en-têtes de
  boîtes, `moov` au début ou à la fin ; lue comme secondes depuis 1970 quand un encodeur s'est trompé d'origine ; horloge
  non réglée, avant 2000, ignorée), sinon, marquée approximative, date de dernière modification du fichier moins sa
  longueur (une caméra écrit le fichier jusqu'à l'arrêt) ; WebM : date du fichier seulement. Décalage de l'horloge
  `offsetS` (± 1 jour, positif : la vidéo a été filmée plus tard que ne le dit le fichier). `clipSyncOffsetS` : 0 quand la
  vidéo chevauche la sortie enregistrée, sinon le nombre d'heures entières le plus proche de 0 (jusqu'à 14) qui la fait
  chevaucher (caméra réglée à l'heure locale qui l'écrit comme de l'UTC, cas des GoPro), sinon rien. Placement
  (`syncClipPlacement`, pur) : début = passage du marqueur au point enregistré au début de la vidéo
  (`distanceAtTime` → `clock.timeAtProgress`) ; une vidéo commencée avant la sortie débute au début du vol, `inS` saute la
  partie d'avant ; durée : en suivant le survol, jusqu'au passage au point enregistré à sa fin (ou fin de la sortie), sinon
  sa longueur dans le fichier depuis là, au plus sa durée actuelle ; rien hors de la sortie ou sans heures. Proposé par le
  toast de l'ajout (« Caler sur le parcours », ou « Placer sur le parcours » quand il y a aussi des photos : un seul pas
  d'annulation, horloge du moment) et par l'inspecteur (bloc « Calage sur le parcours » : heure de tournage, mention
  approximative, bouton « Caler » / « Recaler », « Décalage de l'horloge (s) » et case « Suivre la vitesse du survol » qui
  recalent aussitôt, `syncClip` ; hors de la sortie, seul `sync` est gardé et un message le dit). Le placement n'est pas
  refait seul quand le film change (durée, arrêts) : « Recaler ». **Suivre la vitesse du survol** (`sync.follow`) : temps
  dans le fichier = instant enregistré sous le marqueur − (début du tournage + décalage) (`clipTimeS(média, t,
  recordedMs)`, borné à `inS` / `outS`), fonction pure de la progression : ralentis, portions de vitesse et ouverture /
  clôture suivis ; pendant un arrêt la progression ne bouge pas, **l'image reste figée** (choix : l'image montre toujours
  l'endroit du marqueur) ; une pause enregistrée sur la trace (temps qui passe sans distance) est sautée. `recordedMs`
  vient de `recordedAtProgress(path, progress)` (`overlay/data.ts`, à la distance d'`overlayFrameAt`), le même nombre pour le
  dessin (`drawOverlay`, depuis l'image) et pour le décodage de l'export (`loadFrameMedia(temps, progression)`, chemin de la
  première trace gardé par trace) : export déterministe. Aperçu : `clipRateAt` (secondes du fichier par seconde de film,
  différence sur 0,25 s de film) × vitesse de lecture → `playbackRate` (arrondi au centième, au plus ×16) ; recalage
  au-delà de `FOLLOW_DRIFT_S` (0,2 s) ; sous ×0,0625 (arrêt), l'élément est mis en pause sur l'image. Sans heures sur la
  trace, une vidéo qui suit est jouée comme une autre.
- **Musique** (`src/film/audio.ts`) : « Options » › « Ajouter une musique… » (sélecteur de la couche plateforme, plusieurs
  fichiers) ou fichiers son déposés sur la timeline (`isAudioFile` : type `audio/*` connu, sinon extension `.mp3`, `.m4a`,
  `.aac`, `.ogg`, `.oga`, `.opus`, `.wav`, `.flac` ; un dépôt mêlant sons, photos et vidéos les répartit). `readAudio` refuse
  au-delà de `MAX_AUDIO_BYTES` (30 Mo, message qui conseille un MP3 ou un M4A), décode le fichier une fois
  (`OfflineAudioContext.decodeAudioData` à 22 050 Hz : vérifie que le navigateur le lit, donne sa longueur) et en tire la
  forme d'onde (`computePeaks` : niveau maximal de 10 tranches par seconde, 4 000 au plus, au centième) ; le fichier est
  gardé tel quel (`data:audio/mpeg|mp4|aac|ogg|wav|flac|webm`). Ajoutée en entier (`addMusic`) à la fin des musiques déjà
  là (au début du film sans musique), en un pas d'annulation, bloc sélectionné ; le toast propose « Caler la durée du
  film ». Volume (`musicEnvelope`, pur) : 0 → volume pendant le fondu d'entrée, volume, → 0 pendant le fondu de sortie,
  linéaires, raccourcis en proportion quand ils se chevauchent, sur la durée jouée (`musicLengthS` : jamais après la fin
  du fichier) ; mêmes points pour l'aperçu (`musicGainAt`) et l'export (automatisation du gain). Plusieurs musiques
  peuvent se chevaucher : elles sont mixées. Aperçu (`startMusicPreview`, lancé par `Timeline`, `createMusicPreview` testé
  sur de faux éléments) : un `HTMLAudioElement` par musique (URL d'objet du fichier, créé dès qu'elle est dans le film pour
  qu'il charge), joué pendant la lecture au temps du fichier, à la vitesse de lecture, au volume du moment, recalé
  au-delà de `MUSIC_DRIFT_S` (0,25 s) d'écart quand il a assez de données ; en pause hors lecture, hors de son bloc et
  pendant un export (la lecture y est arrêtée) ; libéré quand la musique quitte le film. « Caler la durée du film sur la
  musique » (`fitFilmToMusic`) : durée du survol (dans 15 s – 10 min, au centième) pour que le film finisse à la fin de la
  dernière musique, trouvée par la méthode de la sécante sur l'horloge du film (`durationForFilmEnd` : arrêts, portions
  de vitesse et plans compris) ; un pas d'annulation, toast avec la nouvelle durée ou les bornes atteintes.
  **Rythme** (`src/film/beats.ts`, pur et testé sur des pistes de clics à 90 / 120 / 150 BPM avec bruit, silence et
  bruit seul) : `detectBeats` sur le son déjà décodé par `readAudio` (22 050 Hz, canaux mêlés), une fois par fichier,
  gardé dans son entrée de la table des médias (`beats` : `bpm`, `confidence`, `times` en s du fichier au millième,
  `downbeat` ; validé par `isValidBeats`) ; un fichier lu avant est analysé à la demande (décodé à nouveau, entrée
  complétée, enregistrée avec le projet). Attaques : hausses (seules) de l'intensité log de la bande basse (passe-bas
  d'ordre 1 à 200 Hz) et du reste, par trames d'environ 10 ms ; tempo de 60 à 180 BPM par autocorrélation de cette
  enveloppe, pondérée vers 120 BPM (une octave d'écart type : départage un tempo de sa moitié ou de son double),
  interpolée entre deux trames ; confiance = autocorrélation normalisée au tempo, en dessous de
  `MIN_TEMPO_CONFIDENCE` (0,15) aucun temps (bruit seul ≈ 0,05, clics ≥ 0,45) ; temps par programmation dynamique
  (D. Ellis, 2007 : chaîne d'attaques la plus forte, écart à la période pénalisé par 100 × log², une chaîne ne
  commence que quand rien ne vaut d'être relié avant : pas de temps inventés dans une intro muette), libre de dériver
  un peu avec la musique ; début de mesure tous les 4 temps, à partir du temps dont la série a les attaques les plus
  fortes (heuristique : peut tomber sur le 2ᵉ ou le 3ᵉ temps). Les marques des temps (plus longues en début de mesure)
  sont dessinées en haut du bloc (`beatTicksPath`). « Caler sur le rythme » (inspecteur de la musique,
  `snapFilmToMusic`) : temps de toutes les musiques ramenés au temps du film (`filmBeats` : seulement là où chaque bloc
  joue son fichier) ; chaque titre (début, temps du film) puis chaque arrêt (début de sa tenue, placé en mètres :
  position trouvée sur l'horloge par `stopPositionAt`, au dixième de mètre) va sur le début de mesure le plus proche à
  moins de `BEAT_SNAP_S` (0,4 s), sinon sur le temps le plus proche (`beatNear`) ; déjà à moins de `ON_BEAT_S` (20 ms) :
  laissé. Jamais de chevauchement créé : un titre qui chevaucherait un autre titre reste, un arrêt qui passerait ou
  tomberait sur un autre arrêt reste, un arrêt dont la tenue ne peut pas tomber sur le temps (dans un autre arrêt, au
  bout de la trace) reste. Puis chaque portion de vitesse (`snapSpeeds`, avec `clockOfSpeeds`) : son début (temps du
  film où elle commence, horloge recalculée avec la portion déplacée) va sur le temps, sa longueur gardée, au mètre
  près, entre ses voisines ; elle reste si son début tombe à plus de `BEAT_SNAP_S` / 4 du temps visé. Un pas
  d'annulation (`editFilm`) ; les arrêts générés sont écrits (comme toute retouche
  d'arrêt), un titre de repère déplacé fige les titres de repères. Recaler ne déplace rien. Toast « N éléments calés
  sur le rythme (≈ 112 BPM) » ; tempo incertain : message, rien n'est fait.
- **Son des vidéos** (`clipHasSound`, `clipSounds`, `duckEnvelope` dans `src/film/audio.ts`, purs et testés) : une vidéo
  ajoutée a son son (`VIDEO_SOUND_DEFAULTS` : `muted: false`, `volume: 1`) ; une vidéo enregistrée sans `muted` (projets
  d'avant) reçoit `muted: true` de `withFilmDefaults` : son film ne change pas. Entendue quand elle n'est pas coupée, à un
  volume > 0 et **ne suit pas la vitesse du survol** (son temps dans le fichier change alors de rythme : un son
  rééchantillonné serait laid, elle reste muette dans l'aperçu comme à l'export). Elle joue son fichier de `inS` tant
  qu'elle le montre : au-delà de `outS` ou de la fin du fichier (dernière image tenue), silence. Fondus de 20 ms à ses
  bords (`CLIP_EDGE_FADE_S`, via `musicEnvelope`) contre les clics. « Baisser la musique sous les vidéos »
  (`film.duckMusic`) : toutes les musiques baissent de 10 dB (`DUCK_DB`, gain ≈ 0,316) pendant chaque vidéo avec du son,
  descente sur les 0,3 s d'avant (`DUCK_RAMP_S`, ses premiers mots ne sont pas couverts), remontée sur les 0,3 s d'après ;
  vidéos à moins de deux rampes l'une de l'autre fusionnées (pas de rebond) ; une vidéo au tout début trouve la musique
  déjà basse. Aperçu : l'élément vidéo est démuté à son volume seulement en lecture à ×1 (muet pendant un déplacement, à
  toute autre vitesse, en suivant le survol, ou quand le haut-parleur de la timeline coupe le son de l'aperçu, qui coupe
  aussi les vidéos et s'affiche dès qu'une vidéo a du son) ; la musique de l'aperçu suit la même baisse (`duckGainAt`),
  à toutes les vitesses, comme dans le film exporté. Export : voir « Export vidéo », « Son ». Une vidéo sans piste son
  reste muette, mais la musique baisse quand même sous elle (règle tirée du modèle seul, identique dans l'aperçu et
  l'export) : couper son son pour l'éviter.
- **Table des médias** (`src/film/media.ts`) : les octets ne sont pas dans les réglages (historique et préréglages
  légers) mais dans une table du document `{ id: { data, thumb, width, height, name?, durationS? } }` (data URL JPEG ;
  vidéo : data URL du fichier `video/mp4 | webm | quicktime` et sa longueur `durationS`, avec l'heure de début du tournage `recordedMs` / `recordedApprox` quand elle est connue ; son : data URL `audio/…`,
  `durationS` et forme d'onde `peaks`, sans vignette ni taille, ids `audio-<n>`). Une image
  reste dans la table quand sa photo quitte le film (l'annulation la retrouve) ; l'enregistrement n'écrit que les images
  utilisées, par les médias et les musiques (`usedMedia`). Accès aux fichiers derrière `readMedia(blob)` (un `File` du sélecteur ou du dépôt sur le web,
  un `Blob` lu sur disque pour Tauri, plus tard un chemin de fichier au lieu des octets pour les grosses vidéos). Images décodées à la demande (`getMediaBitmaps` : `ImageBitmap` par id, au plus 6
  gardées, les moins récentes libérées, libérées aussi quand le film ne les utilise plus, redécodées si la table change
  à l'ouverture d'un projet, une image illisible n'est pas réessayée).
- Limites : vidéos entendues seulement à ×1 dans l'aperçu (pas de fondu aux bords dans l'aperçu), 50 Mo au plus, sans position GPS
  lue (placées à la tête de lecture, ou calées sur l'heure de la trace) ; l'heure d'une vidéo ajoutée avant ce calage n'est
  pas relue ; flux GPS des GoPro (GPMF) non lu ; refusées là où WebCodecs manque (application de bureau sous Linux) ; l'EXIF n'est lu que dans les JPEG (pas HEIC, que la
  plupart des navigateurs ne décodent pas, ni PNG / WebP) ; une photo plein écran est recadrée pour couvrir l'image (une
  photo en hauteur perd le haut et le bas) ; une photo n'est pas liée à un arrêt (elle ne le suit pas quand il bouge).
  Autres limites : l'aperçu 3D ne
  suit un geste qu'au relâcher ; pas de défilement automatique quand on glisse au bord ; en mode `'temps-forts'`, le curseur
  « pause » du rythme ne règle pas la durée des arrêts générés (4 s, à retoucher par arrêt).

## Projet (phase 4)

- Un projet est un seul fichier JSON `<nom>.openflyover.json` (`format: "openflyover-project"`, `version`, `name`, `settings`,
  `playback.speed`, `tracks`, et `media` quand le film a des photos : table des images par id, une ligne par image après
  les traces, voir « Film et timeline », « Table des médias » ; champ facultatif, pas de changement de version). À
  l'ouverture, les images invalides sont écartées et les photos du film sans image retirées avec un avertissement (les
  musiques sans fichier aussi) ;
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
  n'est pas enregistrée ; rien n'est enregistré pendant « Un film par trace » (`suspend`) ; ouvrir un projet vide l'historique. Raccourcis Ctrl/Cmd+Z, Ctrl/Cmd+Maj+Z, Ctrl+Y (ignorés dans les
  champs texte), installés une fois par `App`. Enregistrer, ouvrir et le nom du projet sont dans la barre du haut ; le
  panneau « Projet » garde « Mes projets » et les préréglages.
- **Pastille « modifié » + bouton « Par défaut »** (`ui/ModifiedMarker.tsx`) en haut à droite de chaque panneau de réglages : liste
  des clés de `Settings` du panneau, comparées en profondeur aux valeurs de `DEFAULT_SETTINGS` (`modifiedSettings` /
  `sameValue`, `project/apply.ts`) ; « Par défaut » remet ces clés par défaut en un seul pas d'historique (`resetSettings`,
  `project/history.ts`). La source d'imagerie n'est pas suivie (choisie par région à l'import). Un nouveau réglage d'un
  panneau : ajouter sa clé à la liste `keys` du marqueur.
- **Mes projets** (`platform/projectLibrary.ts`, `ui/library.ts`, onglet « Projet ») : `getPlatform().projectLibrary`
  (null sur le site sans Cache Storage). Deux fichiers texte par projet, nommés par un id vérifié (`[a-z0-9-]`, jamais un
  chemin venu d'ailleurs) : le document `<id>.openflyover.json` (celui d'« Enregistrer », médias compris) puis l'entrée
  `<id>.entry.json` (`ProjectEntry { id, name, updatedAt, summary, sizeBytes }`, la seule lue pour la liste ; une entrée
  illisible est écartée). Bureau : `<app data>/projects/` (plugin-fs, `readFile` / `writeFile` en UTF-8, mêmes droits que
  les packs). Site : cache `openflyover-projects-v1` (clés `/openflyover-projects/<fichier>`, `persist()` demandé une
  fois). Pas de vignette : aucune capture de la vue 3D courante n'existe hors affiche. `useLibraryStore { entries,
  currentId }` : « Garder dans Mes projets » crée l'entrée du projet ouvert ; ensuite **enregistrement automatique**
  (`installLibraryAutosave`, installé par `App`) 3 s après le dernier changement des réglages, des traces ou du nom
  (`createAutosave` : relancé à chaque changement, réessayé plus tard pendant un export ou un rendu en lot, jamais deux
  écritures à la fois, un seul toast par série d'échecs) ; chaque écriture marque le projet enregistré (« Enregistré »
  dans la barre). Ouvrir une entrée passe par `openProject(file, entry)` (mêmes validations et avertissements, le nom de
  l'entrée l'emporte) ; `openProject` écrit d'abord un changement en attente (`flushAutosave`), et un projet ouvert depuis
  un fichier n'a pas d'entrée. Renommer change l'entrée (et le nom du projet ouvert, son document suit au prochain
  enregistrement) ; supprimer demande une confirmation dans la ligne, le projet ouvert reste ouvert sans entrée.
- **Préréglages** dans `getPlatform().storage` (`openflyover.presets.v1`, repli en mémoire) ; une clé absente d'un préréglage garde sa
  valeur courante. `save` répond false quand le stockage refuse (plein ou bloqué) : le préréglage reste utilisable pour la
  session et le panneau affiche « Préréglage non enregistré : stockage du navigateur plein » ; le cache météo, lui, reste
  silencieux (il ne perd que sa persistance).

## Météo historique (phase 7)

- **Source** : archive Open-Meteo (`archive-api.open-meteo.com/v1/archive`, sans clé, CC BY 4.0, gratuit en usage non
  commercial ; vérifications dans `docs/sources.md`). Attribution « Données météo : Open-Meteo.com (CC BY 4.0) » dans le panneau
  et la barre d'état dès que des données sont affichées.
- **Requête** (`src/weather/openMeteo.ts`) : 2 à 12 lieux le long de la première trace (un tous les ~10 km, départ et arrivée,
  arrondis à 0,01°, dédoublonnés par maille 0,05°), à l'**altitude enregistrée** (le paramètre `elevation` ramène la température
  à l'altitude de la trace : ~10 °C d'écart en montagne), sur les jours UTC de la sortie (±1 h) en une seule requête
  (`timezone=GMT`, `timeformat=unixtime`). Refusé sans requête : trace non horodatée, date future ou antérieure à 1940, sortie de
  plus de 31 jours. `visibility` est toujours nulle dans l'archive et n'est pas demandée.
- **Cache** : par lieu arrondi et jour UTC, en mémoire puis `getPlatform().storage` (`openflyover.weather.v1`, ≤ 300 jours-lieux, LRU,
  tout accès sous try/catch) ; les jours de moins de 7 jours ne sont pas persistés car l'archive les révise.
- **Série** (`src/weather/series.ts`, pur) : 13 variables horaires par lieu (NaN si manquante). `weatherAt` interpole
  linéairement en temps et par inverse de la distance au carré entre lieux (code WMO du lieu le plus proche, direction du vent
  en vecteur) ; les cumuls horaires valent pour l'heure qui se termine. `weatherWidgetData(series, path, progress)` donne les
  conditions sous le marqueur (heure enregistrée via `recordedTimeAt`), `summarizeOuting` le bilan pondéré par le temps réel.
  Codes WMO → libellé français + id d'icône.
- **État** (`src/weather/store.ts`) : `status` idle / loading / ready / unavailable / error, `message`, `series`, `trackId` ;
  `syncWeather` est appelé par le panneau à chaque changement de première trace ou de `settings.weather.enabled` (vrai par
  défaut), annule la requête précédente et explique l'absence de données.
- **À venir** : particules de pluie et de neige (scène pilotée : « Météo dans la scène » et « Nuages volumétriques »).

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
  trait d'accent par type) pour le sommet de chaque montée, les waypoints, les points d'intérêt (`poiLabels`, épingle orange
  clair à la place du trait, priorité 200 : au-dessus de tout) et toute source externe enregistrée par
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
  distance ne refait jamais de requête. File d'attente (une requête à la fois), cache mémoire + `getPlatform().storage` 30 jours par
  empreinte de requête, un réessai sur 429 / 504 (`Retry-After`, sinon 15 s) puis l'autre instance ; une réponse 200 portant un
  `remark` d'erreur (délai dépassé) est une erreur.
- **Post-traitement pur** (`src/osm/landmarks.ts`) : projection sur le chemin → distance et abscisse, filtre par type et distance
  (`settings.landmarks`, défaut sommets + cols + refuges + lacs à 1,5 km), altitude depuis `ele` (formats libres), priorité dans
  [0, 50) sous les waypoints et les montées (col franchi > sommet haut et proche > col voisin > refuge > lac > cascade / vue /
  glacier > lieu), dédoublonnage par nom à moins d'1 km, plafond de 40 repères, libellé « Nom · 1 653 m » pour sommets et cols.
- **État** (`src/osm/store.ts`) : `useLandmarkStore` piloté par `syncLandmarks` depuis `LandmarkPanel` ; les repères de toutes les
  traces sont publiés aux étiquettes 3D par `setLabelSource('osm', …)` (liste vide à la désactivation). La liste du panneau suit
  la première trace (clic = `setProgress`). Le même effet refait les ralentis et titres du film à chaque publication
  (voir « Ralentis et titres aux repères »).

## Points d'intérêt

- **Usage** : nommer un lieu qu'OpenStreetMap ne connaît pas ou qui compte pour soi (« Pique-nique », « Le chalet de
  Paul »), affiché comme les repères dans la vue 3D et dans le film.
- **Modèle** : `settings.film.pois` (`FilmPoi { id, lon, lat, name }`, ids `poi-<n>`), comme les arrêts : enregistré dans le
  projet, annulable, validé par `isValidFilm` (coordonnées dans les bornes, ids uniques dans tout le film), gardé par les
  préréglages comme le reste du film (il appartient à la trace). Dans le film plutôt qu'à part : les arrêts, qui sont aussi
  des lieux de la sortie, y sont, et un ancien projet reçoit `[]` de `withFilmDefaults` sans migration. Les repères OSM, eux,
  ne sont pas enregistrés (relus d'Overpass), seuls leurs réglages le sont.
- **Ajout** : clic droit sur le relief › « Point d'intérêt ici » › nom tapé dans le menu (vide : « Point d'intérêt 3 »,
  `defaultPoiName`), ou « Ajouter au marqueur » de la section « Points d'intérêt » de l'onglet Carte (`PoiPanel`, champ du
  nom aussitôt sélectionné). Chaque ajout, retrait et renommage (frappes fusionnées) passe par `editFilm` : un pas
  d'annulation, sans sélection sur la timeline.
- **Liste** : nom modifiable sur place (un nom vide n'a pas d'étiquette), « Arrêt » = arrêt de 4 s au point enregistré de
  la première trace le plus proche (`poiStopAtM`, `nearestOnPath`), au nom du point, sélectionné dans l'inspecteur ; ✕
  supprime.
- **Rendu** : étiquettes de `Labels` (épingle, priorité au-dessus des montées), donc fondu sous le relief et au loin,
  dédoublonnage, effacement sous les cartes d'ouverture et de clôture et export identiques aux autres étiquettes.

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
  météo, classement — chacun avec `enabled`, `anchor`, `size`. Les widgets ajoutés après le premier format (`minimap`,
  `credits`, `leaderboard`) sont complétés par
  leur défaut avant validation (`withOverlayDefaults`, via `SETTING_UPGRADES` dans `src/project/document.ts`) : anciens projets
  et préréglages se chargent toujours (`minimap` et `leaderboard` désactivés, `credits` activés). Les widgets en direct s'effacent pendant les
  cartes.
  Logo en data URL PNG d'au plus 512 px (projets autonomes). Validation : `isValidOverlay` (`SETTING_CHECKS`).
- **Couleurs et polices** (`settings.overlay.overrides`, facultatif, absent par défaut : anciens projets et aspect par
  défaut inchangés) : accent, texte, fond des encarts (couleur, opacité) en `#rrggbb`, police des titres et des chiffres
  parmi une courte liste (`OVERLAY_FONT_IDS` : Fraunces, IBM Plex Sans et Sans Condensed embarquées, Georgia, police
  du système, chasse fixe du système ; rien n'est téléchargé). Clé hors de `DEFAULT_OVERLAY` : la forme n'est pas
  vérifiée par le document, `isValidOverrides` contrôle tout (objet, champs connus, valeurs). `withOverrides` applique
  un changement et retire la clé quand plus rien n'est changé (« Revenir au style »). Le thème dessiné vient d'une seule
  fonction pure, `resolveOverlayTheme(style, overrides)` (`themes.ts`), appelée par `drawOverlay` : aperçu et export
  identiques. L'accent recolore aussi ce que le style dessinait dans son accent (profil, mini-carte), le texte donne le
  texte secondaire (même couleur à 80 %), le fond recolore aussi le passe-partout des photos ; un style sans encart
  (Éditorial) garde son voile. Par élément (`STYLED_WIDGETS` : titre, clôture, compteurs, profil, météo, mini-carte,
  classement, texte) : `overrides` facultatif sur l'élément, mêmes champs, par-dessus ceux de l'habillage
  (`widgetOverrides`, `withWidgetOverrides`) ; `drawOverlay` dessine cet élément avec son propre thème ; validés par
  `isValidOverlay` (un élément invalide rejette l'habillage, comme le reste). « Couleurs et polices » au bas de chaque
  élément de l'onglet Habillage, « Comme le reste de l'habillage » retire ses changements.
- **Classement de la course fantôme** (`settings.overlay.leaderboard`, éteint par défaut, ancrable, proposé dès deux
  traces, dessiné seulement course fantôme activée) : `leaderboardRows(raceAt(course, progression), traces)` (`data.ts`,
  pur) range les coureurs par `rankRacers` et donne rang (ex æquo au même point et au même écart : 1, 1, 3), nom, couleur
  et écart au premier (différence des écarts de `raceAt` à la trace suivie : en temps si la course en a, sinon en
  distance ; « Tête », puis « Arrivée », pour le premier). Calculé à chaque image depuis la progression par
  `overlayExtras(temps, progression)` (`extras.leaderboard`), pour l'aperçu comme pour l'export. Widget en direct
  (s'efface sous les cartes), rangée « Classement » puis une ligne par trace ; la colonne des écarts garde sa largeur.
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
- **Photos et vidéos de la timeline** (`extras.media` = `settings.film.media`, images décodées par `assets.photo(src)`,
  image d'une vidéo par `assets.video(média, temps dans le fichier)` (`clipTimeS`) ; dessinées même habillage
  désactivé, l'aperçu monte `OverlayCanvas` dès que le film a des médias) : visibles dans leur fenêtre avec les fondus
  des textes, seulement une fois l'image décodée. Une vidéo se place comme une photo (plein écran ou carte), sans
  Ken Burns. Plein écran : sous tout le reste, recadrée pour couvrir l'image
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
  opacités des cartes, des textes, des photos et des vidéos de la timeline, plus le temps du film pendant qu'une photo
  plein écran bouge ou qu'une vidéo est visible ; un texte qui apparaît pendant un arrêt fixe est donc rendu, une vidéo
  pendant un arrêt aussi) ; les images des photos et des vidéos visibles sont décodées avant le rendu de l'image
  (`loadFrameMedia`, la composition devant suivre le rendu dans la même tâche ; `releaseFrameMedia` en fin d'export).
  Vidéos : image exacte et reproductible, jamais de lecture en temps réel ; `createExportVideos` ouvre chaque vidéo
  visible avec mediabunny (`CanvasSink`, rotation appliquée, 3 canvas tournants) et `createClipReader` donne la dernière
  image qui commence au plus tard au temps voulu dans le fichier, en lisant en avant (chaque image décodée une fois) ;
  retour en arrière ou saut de plus de 2 s : réouverture à l'image-clé ; une vidéo illisible arrête l'export avec un
  message ; les images tenues du début et de la fin restent figées sur les
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
  0,10 / 0,16 bit selon la qualité, corrigé par codec, borné à 1–80 Mbit/s ; image-clé toutes les 2 s.
- **Écriture directe sur le disque** quand `capabilities.canStreamToDisk` (bureau, ou navigateur avec `showSaveFilePicker` :
  Chrome, Edge) : le clic « Exporter la vidéo » demande d'abord où enregistrer (`chooseVideoDestination`, appelé avant tout
  `await` car le sélecteur du navigateur exige le geste de l'utilisateur ; fenêtre fermée = pas d'export ; échec du
  sélecteur = repli en mémoire) et la demande d'export porte le `WritableFile` obtenu (`request.destination`). L'encodeur
  écrit alors par `StreamTarget` de mediabunny, par morceaux de 4 Mio écrits à leur position (`STREAM_CHUNK_BYTES`) ; MP4
  sans « fast start » (`fastStart: false` : `moov` après les images, taille de `mdat` corrigée à la fin), lu par tous les
  lecteurs et logiciels de montage, alors que le MP4 fragmenté l'est moins ; WebM tel quel. Le codec suit l'extension du
  nom choisi (`candidatesFor` : « .webm » tapé → VP9 / VP8). Annulation, erreur ou échec d'écriture : mediabunny ferme son
  flux même à l'annulation, donc le flux intermédiaire de l'encodeur appelle `discard` (et non `close`) quand la session
  est annulée ; `cancel` appelle encore `discard` après coup (cas d'un flux en erreur) et `ExportController` aussi quand
  l'export échoue avant l'encodeur ; une demande annulée avant d'être prise ou refusée (export déjà en cours) supprime son
  fichier dans le store. Résultat : `url: null`, le toast dit « Vidéo enregistrée dans <nom> » et le tiroir
  « Enregistrée dans <nom> », sans nouveau téléchargement. Le tiroir affiche « Enregistrement direct sur le disque » ;
  sinon, au-dessus d'une estimation de 1,5 Go (`MEMORY_WARN_BYTES`, `warnsInMemory`), il prévient que le film gardé en
  mémoire peut saturer l'onglet.
- Sinon fichier en mémoire (MP4 avec son index au début), téléchargé à la fin.
- **Son** (musique et son des vidéos) : avant la première image, `mixFilmAudio(film, …)` (`src/film/audio.ts`) mixe le
  son du film dans un `OfflineAudioContext` (48 kHz, stéréo) sur la longueur exacte de la vidéo (`nombre d'images / fps`,
  images tenues comprises), chaque musique placée au temps du film + les images tenues du début (`round(1 s × fps) / fps` :
  elle commence avec le film, pas pendant l'image fixe d'attente), lue de `inS` sur sa durée jouée, gain automatisé par
  les points de `musicEnvelope` (`musicMixPlan`, pur), puis un bus commun dont le gain suit la baisse sous les vidéos
  (`filmMixPlan`, pur : `music`, `clips`, `duck`). Le son de chaque vidéo entendue (voir « Son des vidéos ») est décodé
  une fois par mediabunny (`decodeClipSound` dans `film/video.ts` : `AudioBufferSink` sur WebCodecs, morceaux posés à leur
  position d'échantillon par `joinSoundChunks`, pur et testé, un seul `AudioBuffer` de `inS` sur sa durée jouée) et placé
  au même temps du film + images tenues, directement sur la sortie (jamais baissé), fondus de 20 ms aux bords. Rendu
  identique d'un export à l'autre, jamais en temps réel ; un fichier illisible arrête l'export avec un message (pour une
  vidéo : « coupez-le dans l'inspecteur »), une vidéo sans piste son reste muette ; rien à entendre : pas de piste son. L'encodeur (`createVideoEncoder(…, { audio })`) choisit AAC en MP4,
  sinon Opus (`AUDIO_CANDIDATES`, `canEncodeAudio`, 192 kbit/s ; Opus seul en WebM), ajoute la piste son
  (`AudioSampleSource`) et lui passe les échantillons au fil des images, 1 s d'avance (`AUDIO_LEAD_S`, morceaux d'au plus
  1 s, plans séparés `f32-planar`) pour que les deux pistes s'entrelacent, le reste à la fin ; même chemin en mémoire et
  sur le disque. Aucun codec son : film muet, `audioCodec` null et note « sans le son : ce navigateur ne sait pas
  l'encoder » à côté du résultat (`ExportResult.note`, « avec le son (AAC) » sinon). Écart entre image et son :
  au plus une image et demie à la fin du film (la rampe a `round(durée × fps)` images). Mémoire : environ 23 Mo par minute
  de film pour le mixage, plus le son décodé des vidéos entendues (environ 23 Mo par minute de vidéo en stéréo 48 kHz).
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
- Image fixe d'ensemble (affiche) : `still.overview` et `still.compose` (voir « Affiche »).
- **Habillage seul** (case « Habillage seul (fond transparent) » du tiroir, état du tiroir, non enregistré) : pour poser
  l'habillage sur ses propres images dans un logiciel de montage. Demande `overlayOnly` : mêmes `buildFrameSchedule` /
  `buildFrameTimes` que le film, donc mêmes images, aux mêmes instants, image pour image ; `runOverlayOnly`
  (`ExportController`) ne touche pas à la scène (ni taille, ni `frameloop`, ni tuiles attendues, ni image WebGL) et ne
  mixe pas le son. Chaque image est redessinée (`composeOverlayFrame` : canvas effacé, transparent, puis `DrawOverlay`
  avec `loadFrameMedia` avant), puis encodée en WebM / VP9 avec transparence (`createVideoEncoder(…, { transparent })`,
  seul candidat `ALPHA_CANDIDATES`) : mediabunny (`alpha: 'keep'`) sépare couleur et alpha dans un worker et encode
  l'alpha par un second encodeur VP9, rangé à côté de chaque image (`BlockAdditional`, en-tête `AlphaMode`). Le
  navigateur n'a donc besoin que d'un encodeur VP9 ordinaire, vérifié par `isConfigSupported` (`pickCodec`) ; sans VP9,
  le tiroir le dit et désactive le bouton (pas de repli en suite d'images PNG : des milliers d'images en mémoire, et
  peu utile). Même destination que le film (disque ou mémoire, bureau compris), même annulation (`abandon` : fichier
  supprimé). Nom : `<trace> habillage.webm`. Pas d'estimation de taille (images presque vides, bien sous le débit
  visé) ; temps non comptés dans `secondsPerMegapixel`.
- **Rendu en lot** (`src/export/batch.ts`, mode « Plusieurs formats » du tiroir) : `buildBatchJobs(sélection, format de
  l'image fixe)` donne les films cochés (format × résolution, dans l'ordre de `VIDEO_ASPECTS` puis `VIDEO_RESOLUTIONS`,
  clés `16:9@1080p`), puis l'image fixe (position de lecture, PNG, au format du mode « Vidéo ») et l'affiche (ses
  réglages, `startPoster`). Images par seconde et qualité : celles de `settings.video`. Noms : `batchBaseName` →
  « <projet> – 16x9-1080p », « <projet> – image 16x9-1080p », « <projet> – affiche » (`effectiveProjectName`).
  `runBatch` exécute les tâches une à une (un échec n'arrête pas les suivantes ; une tâche annulée, ou une annulation
  demandée entre deux, annule toutes celles qui restent), chacune par `exportJob` : la même demande et le même
  `ExportController` qu'un export seul (vue restaurée après chacune, cache de tuiles partagé), attente de la fin par
  `settledExport` (abonnement au store), puis `takeResult` (le store rend le résultat sans révoquer son URL : le lot
  garde chaque fichier). « Annuler » de la barre du haut annule la tâche en cours, donc tout le lot ; « Tout annuler »
  aussi (`useBatchStore.cancel`). Le tiroir « Vidéo » ne télécharge ni n'annonce rien pendant un lot : le lot le fait.
- Destination du lot : avec l'écriture directe et un sélecteur de dossier (`canPickFolder` : bureau, ou
  `showDirectoryPicker` de Chrome / Edge), un dossier est demandé au clic « Tout exporter » (avant tout `await`) ;
  chaque film y est écrit au fil de l'encodage (`WritableFolder.createFile` → `WritableFile`, extension d'après
  `pickCodec`), images et affiche copiées à la fin (un fichier du même nom est remplacé). Dossier refusé = pas d'export ;
  échec du sélecteur ou sans sélecteur = chaque fichier gardé en mémoire et enregistré dès qu'il est prêt (téléchargement,
  `saveUrl` sur le bureau), son URL gardée pour « Enregistrer à nouveau » jusqu'au lot suivant.
- **Un film par trace** (source « Un film par trace » du mode « Plusieurs formats », seulement avec un sélecteur de
  dossier et l'écriture directe) : « Choisir le dossier des traces… » lit un dossier (`pickReadableFolder` :
  `showDirectoryPicker` en lecture, ou le dialogue de dossier du bureau, qui ajoute le dossier et ses fichiers à la portée
  fs, permissions `read-dir` / `read-file` déjà accordées) ; `trackFiles` garde les GPX / FIT, triés par nom (« Sortie 2 »
  avant « Sortie 10 »). « Tout exporter » demande le dossier de sortie, puis `useBatchStore.runTracks` → `runTrackFilms` :
  pour chaque fichier, `show` l'importe seul (`importFile`) et l'affiche à la place des traces (`clearTracks` +
  `addTracks`, comme l'ouverture d'un projet) avec le film automatique (`trackFilm` : plans, options et musique du film
  de l'utilisateur ; arrêts générés ; vitesses, cadrages, textes, médias et points d'intérêt retirés), lance repères et
  météo de la trace et les attend (`TRACK_DATA_WAIT_MS`, 30 s au plus), refait les titres des repères ; puis les tâches
  cochées passent par `runBatch` / `exportJob`, demande tirée de l'horloge de cette trace (`shownFilm`), noms
  « <fichier sans extension> – 16x9-1080p.mp4 » (`trackFilmName`). Fichier illisible ou film en échec : trace marquée,
  on passe à la suivante ; trace non horodatée : film sans météo ni heure, comme chargée à la main. Progression
  « 3 / 12 · Sortie 3.gpx · 42 % » (`trackProgressLabel`), « Tout annuler » comme le lot. À la fin, quoi qu'il arrive,
  `restore` remet les mêmes objets (traces, réglages, origine du repère, lecture) : « Enregistré » reste, et l'historique
  d'annulation, suspendu pendant tout le passage (`History.suspend`), ne garde aucun pas du lot.
- Estimation du lot (`estimateBatch`) : fichiers, images à rendre (chaque film compté), taille des films dont le codec est
  connu, et durée de rendu = images × mégapixels × `secondsPerMegapixel`, la vitesse du dernier film exporté dans la
  session (`filmRate`, mesurée par le store à la fin d'un film ; rien avant le premier).
- La console affiche en fin d'export le temps de rendu, d'attente des tuiles et d'encodage, et le nombre de délais dépassés.
  « Encodage » inclut la copie de l'image WebGL, qui attend la fin du rendu GPU.
- Limites : sans écriture directe (Firefox, Safari), fichier gardé en mémoire (~2× sa taille) ; onglet à garder ouvert, vitesse liée au GPU (mesure à faire sur une
  machine avec GPU, voir `docs/reprise.md`).
- **En ligne de commande** (bureau, `src-tauri/src/cli.rs` + `src/export/cliRender.ts`) : `openflyover --rendu <dossier>
  [--sortie <dossier>] [--prereglage <nom>] [--formats 16:9@1080p,…]`. Rust lit les arguments au démarrage (`parse_cli`,
  testé ; option inconnue, valeur manquante, options sans `--rendu` : message et code 2), rend les chemins absolus
  (`prepare` : dossier des traces existant, sortie créée), ajoute ces deux dossiers, et eux seuls, à la portée fs, et
  garde la demande. L'application la demande une fois au démarrage (`cli_render`, qui la consomme : un rechargement ne
  relance rien), applique le préréglage nommé (`presetSettings`), vérifie les formats (`cliFormats` ; défaut : celui de
  « Vidéo »), lit les traces du dossier (`readableFolderAt`), lance le même `runTracks` que le tiroir avec
  `writableFolderAt(sortie)`, écrit `rendu-en-lot.txt` (`cliReport` : une ligne par trace) et quitte par `cli_exit`
  (0 : tous les films faits ; 1 : un échec ; 2 : demande impossible). La fenêtre s'ouvre (WebGL en a besoin).

## Affiche (phase 7)

- **Principe** : une affiche PNG de la sortie, en un clic depuis le tiroir d'export (mode « Affiche », à côté de « Vidéo »).
  La vue 3D est rendue par le chemin de l'image fixe (`ExportController`) à la taille de la boîte de vue de la mise en page,
  puis dessinée avec le texte sur un `OffscreenCanvas` de la taille de l'affiche par `drawPoster`.
- **Réglages** : `settings.poster` (`src/poster/settings.ts`) : `format` (A4 2 480 × 3 508, A3 3 508 × 4 960, portrait ou
  paysage, à 300 dpi ; carré 2 160 × 2 160), `style` (`editorial`, `broadcast`, `app`, libellés de l'habillage), `title`
  (vide = nom du projet, `effectiveProjectName`), `subtitle` (suivi de la date de la trace), `figures` (distance, D+, durée,
  altitude max., nombre de montées), `weather`, `flat` (« Carte à plat », absent d'un ancien projet : `false` par
  `withPosterDefaults`, `SETTING_UPGRADES`). Validation `isValidPoster` (`SETTING_CHECKS`). Un préréglage n'en garde que
  le style (`presetSettings`, comme le film réduit à ses plans) : le titre appartient au projet.
- **Contenu** (`content.ts`, pur) : titre, ligne « sous-titre · date » (`formatDateFr`), chiffres que la trace enregistre
  (un chiffre absent n'est pas dessiné, la puce est grisée), profil de 400 points (`elevationProfile`), ligne météo
  (`weatherSummaryLine`, seulement si la météo de la première trace est chargée), crédits (`overlayCredits`, les mêmes
  chaînes que la barre d'état), lus des stores par `currentPosterContent` (`export.ts`). Plusieurs traces : une série de
  sorties est additionnée (`totalStats` : distances, D+, durées et montées ajoutées, altitude max. la plus haute ; une
  somme qu'une sortie n'enregistre pas est omise), « 3 sorties » et les dates de la première à la dernière dans le
  sous-titre, sans météo d'un seul jour ; une course fantôme (`race.enabled`) garde les chiffres et la météo de la
  première trace (le même parcours), « 3 traces ». Dans les deux cas, pas de profil : jusqu'à `POSTER_LIST_MAX` (6)
  traces, une liste (pastille de couleur, nom, distance, D+, date courte « 12/07/2026 », `trackLine`) en prend la
  place ; au-delà, seulement le nombre et les sommes.
- **Mise en page** (`layout.ts`, pur) : 1 u = 1 % du petit côté. Les boîtes ne dépendent que de la taille, du style et des
  rangées présentes, jamais d'un texte mesuré : la taille de la vue à rendre est connue avant toute mesure, et un texte ne
  peut pas déborder sur sa voisine. Portrait et carré : texte sous la vue (une rangée de chiffres) ; paysage (rapport
  > 1,15) : colonne de 40 u à droite (deux chiffres par rangée, crédits en pied de colonne). Carré : rangées à 70 %. Styles :
  Éditorial (page papier, vue en retrait de 6 u), Diffusion (vue à fond perdu, bandeau ou colonne encre avec barre rouge
  balise), Application (vue sur toute l'affiche, carte papier arrondie et ombrée par-dessus). Le texte est ajusté au dessin
  (`fitText` : taille réduite jusqu'à un plancher, puis « … » ; `fitLines` : crédits sur deux lignes au plus, taille fixe de
  1,15 u avant réduction). Liste des traces : rangées de 3 u, une colonne (deux sur le carré, remplies colonne après
  colonne) ; une seule taille pour toutes les rangées (`fitTrackList` : chiffres en colonnes alignées à droite aussi
  larges que leur plus long texte, réduite jusqu'à laisser 40 % de la rangée au nom, coupé par « … »). Tests : toutes les boîtes dans la page et ses marges, dans le panneau, sans chevauchement entre
  elles ni avec la vue (sauf la carte flottante), vue ≥ 38 % de l'affiche, pour chaque format × style × jeux de rangées.
- **Dessin** (`draw.ts`) : thèmes `POSTER_THEMES` dans la charte « Carte alpine » (papier, encre, rouge balise, glacier),
  polices des styles d'habillage du même nom (Fraunces, IBM Plex Sans, Plex Sans Condensed), toutes dans `OVERLAY_FONTS`
  (embarquées et chargées par `loadOverlayFonts`, testé). Vue recadrée pour couvrir sa boîte (`coverCrop`).
- **Rendu de la vue** : `startPoster` charge les polices, calcule la mise en page et dépose une demande d'image fixe
  `still { overview: true, framing, compose }` de la taille de la boîte de vue (PNG) ; `framing` (`framingPath` : toutes
  les traces en un chemin) fait cadrer la vue d'ensemble sur toutes les traces, chacune dessinée dans sa couleur par la
  scène. Dans `ExportController`, `overview` ne change
  pas la progression (le `FlyoverRig` ne bouge donc pas la caméra) : la caméra est placée avant chaque rendu sur
  `overviewView` (cadrage des plans d'ensemble, au rapport de la boîte) vu du sud, nord en haut, la cible des contrôles
  suit ; le marqueur de progression (`flyover-marker`) passe sur un calque qu'aucune caméra ne rend ; caméra, cible et
  calque sont remis à la fin. `compose` remplace l'habillage du film : il reçoit l'image composée (ciel + vue) et rend
  l'affiche, encodée en PNG comme une image fixe ; échelle de rendu des étiquettes et de la trace = petit côté de la vue
  / 1 080, comme un film. Le résultat suit le chemin des autres exports (tiroir « Vidéo » toujours monté : téléchargement,
  `saveUrl` sur le bureau, toast) ; nom « <projet> – affiche.png ».
- **Carte à plat** (`view.ts`) : `still.drawView` remplace le rendu 3D (`runDrawnStill` dans `ExportController` : ni
  scène ni caméra touchées, annulation par `AbortSignal`). Carte dessinée en 2D, plus simple et plus sûre qu'une
  caméra orthographique (moteur de tuiles, perspective aérienne et brume pensés pour une caméra en perspective) :
  tuiles de l'imagerie en cours (`settings.imagerySourceId`, Web Mercator, nord en haut) cadrées sur la boîte de toutes
  les traces avec 8 % de marge (`planFlatMap` : jamais plus zoomé que les tuiles les plus fines, zoom arrondi pour des
  tuiles entre × 0,7 et × 1,4, un niveau de moins tant qu'il en faut plus de 300, hors couverture omises), chargées par
  un `createTileFetcher` à 6 requêtes (cache HTTP et packs hors ligne d'abord), gris où une tuile manque (échec si
  aucune), puis chaque trace dans sa couleur sur un liseré de la couleur de la page du style, largeur de la trace 3D
  (`trackStyle.width` pour 1 080 px).
- **Aperçu** : vignette 2D (≤ 260 × 220 px CSS) dessinée par le même `drawPoster` sous une transformation, sans rendu 3D :
  la dernière vue rendue pour ces traces et ce mode (3D ou à plat, `previewKey`, gardée réduite à 480 px,
  `usePosterPreview`), sinon un ciel avec le plan de la première trace (`miniMapOutline`).
- **Limites** : marqueurs de la course fantôme dessinés à la progression courante ; une vue A3
  en style Application fait 17 Mpx en WebGL (limite de taille du GPU non vérifiée). Carte à plat : sans relief ombré,
  ni étiquettes, ni départ / arrivée ; tuiles à d'autres zooms que celles de la vue 3D, donc en partie téléchargées.

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
- Limites : météo d'un seul point appliquée à toute la scène.

## Nuages volumétriques (phase 3)

- `@takram/three-clouds` 0.7.6 (MIT, même famille et mêmes versions de `three-atmosphere` / `three-geospatial`).
  `CloudsLayer` (dans l'`EffectComposer` d'`AtmosphereLayer`, avant `AerialPerspective` qui les compose) n'est monté
  qu'avec l'atmosphère, en mode `manuel`, ou en mode `meteo` une fois la météo de la première trace chargée.
- Réglage `settings.clouds { mode: 'meteo' | 'manuel' | 'aucun', coverage, altitudeM, quality }` (défaut `meteo`, 0,4,
  1 200 m, `medium` ; `SETTING_CHECKS` : `isValidClouds`), bloc « Nuages » de la section « Atmosphère et météo ».
- Pur (`sceneClouds.ts`, testé) : `cloudCoversAt` donne la couverture des trois couches (Open-Meteo bas / moyen / haut à
  la date du soleil sous le marqueur, via `sceneConditionsAt` ; couche absente = total ; manuel : bas = `coverage`,
  moyen 60 %, haut 40 %). `sceneCloudsFrom` : la bibliothèque n'a qu'une `coverage` ; la couche qui en demande le plus la
  fixe (table mesurée sur les quantiles des canaux r / g / b de `local_weather.png` : fraction nuageuse → coverage), les
  autres sont éclaircies par leur exposant `w^e` (e = ln t / ln tᵢ, t = 1 − 2,5·coverage), au-delà de 0,4 (ciel presque
  couvert) par leur densité. Bases : bas `altitudeM` au-dessus du point le plus bas de la trace, moyen 2 km plus haut,
  cirrus à max(7 km, sol + 5,5 km), × exagération (épaisseurs inchangées). Couche « a » (brouillard) et brume des nuages
  coupées : la brume reste celle de `WeatherEffect`. Sous des nuages visibles, le voile du ciel de `WeatherEffect` est
  ramené à 30 %.
- Vent : celui de l'archive au départ de la sortie (constant pour le film, brise d'ouest 4 m/s à défaut) × 2 en altitude
  × `CLOUD_TIMELAPSE` (20). Dérive = vent × temps du film (`playback.timeS`, sinon `clock.timeAtProgress`) : décalages de
  la texture météo (Jacobien de l'UV cube-sphère du shader, `weatherOffsetFor`) et des textures de forme (déplacement
  ECEF × répétition) posés directement à chaque image, vitesses de la bibliothèque à zéro : rien ne s'accumule.
- Qualité : aperçu en préréglage `low`, demi-résolution, suréchantillonnage temporel. Export (`isExportBusy`) : préréglage
  `settings.clouds.quality`, pleine résolution, ni suréchantillonnage ni TAA de la carte d'ombre ; `update` de l'effet
  enveloppé : 2 / 4 / 6 rendus par image avec le compteur de trame fixé à k (tranche de bruit) et `temporalAlpha`
  = 1/(k+1) — le premier jette l'historique, les suivants font la moyenne (caméra immobile, vitesse nulle). Une image
  exportée ne dépend donc jamais des précédentes, quel que soit le nombre de rendus de `settle`.
- Ressources locales : textures servies à `/clouds/` par le plugin de `vite.config.ts` (~2,8 Mo). Le bruit bleu
  spatio-temporel (STBN) des exemples Takram n'est pas dans le paquet (téléchargé depuis GitHub, licence NVIDIA) : il est
  remplacé par un bruit à gradient entrelacé généré au démarrage (`cloudNoise.ts`, 128 × 128 × 64), passé aussi à
  `AerialPerspective` (sinon il le télécharge dès que les nuages fournissent leur carte d'ombre).
- Limites : le terrain est éclairé par des sources (`SunLight`), les ombres des nuages ne l'atteignent donc pas (le
  soleil reste atténué par la météo) ; couches à altitude fixe pour tout le film ; dans l'aperçu, traînées du
  suréchantillonnage temporel quand la caméra bouge vite ; coût élevé sur un GPU faible (mode « Aucun »).

## Eau réfléchissante (phase 3)

- **Données** : OpenStreetMap par Overpass (même client, file d'attente et cache 30 jours que les repères :
  `cachedOverpassQuery`, `runOverpassQuery(…, parse)`), une requête par trace et seulement si `settings.water.enabled` :
  `way` / multipolygones `natural=water`, `waterway=riverbank`, `water=*` dans les boîtes du couloir de la trace élargi à 8 km,
  `out geom qt` (~600 ko, 3–4 s pour l'exemple ; `docs/sources.md`). La requête n'est pas annulée au démontage (partagée et mise en
  cache ; StrictMode lance l'effet deux fois), sa réponse est seulement ignorée si elle est périmée. Une requête en échec n'est
  retentée qu'au prochain changement de trace ou de réglage.
- **Réduction pure** (`water.ts`, testée) : anneaux des relations recousus bout à bout depuis leurs chemins (sens indifférent,
  anneau non fermé abandonné), anneaux intérieurs rattachés à l'extérieur qui contient leur premier point, chemin membre d'une
  relation renvoyée ignoré, Douglas–Peucker 4 m, polygones < 2 000 m² écartés, 300 plus grands gardés, coordonnées à 1e-6° ;
  `lake` (surface plane) ou `river` (`waterway=riverbank`, `water=river|stream|canal…`). Seul ce résultat compact est mis en cache.
- **Maillage pur** (`waterMesh.ts`, testé) : polygone découpé par une grille de cellules carrées (60 m, au plus 40 par côté,
  Sutherland–Hodgman de chaque anneau contre chaque cellule), chaque morceau triangulé avec ses trous (`ShapeUtils`, earcut). La
  grille met des sommets dans l'eau : une rivière suit sa vallée et l'opacité s'efface vers la rive (`fade` = distance au bord
  la plus proche / 40 m, bornée à 1).
- **Plaquage** (`WaterLayer`, dans `TerrainLayer`) : comme la trace, `engine.sampleHeight` × exagération + 2 m, re-plaqué
  (anti-rebond, vidé par l'export via `registerDrapeFlush`) à chaque `engine.onChange`. Un lac est plan au 25ᵉ centile des
  hauteurs de ses sommets (les berges du MNT ne le soulèvent pas) ; un polygone dont aucune hauteur n'est connue attend ses tuiles.
  Une seule géométrie fusionnée (un appel de dessin), `raycast` neutralisé (sélecteur de trace, caméra), `depthWrite` coupé.
- **Rendu** : `MeshStandardMaterial` (rugosité 0,08 : reflet du soleil du `SunLight`, ombres du relief) étendu dans
  `onBeforeCompile` : normales de quatre vagues sinusoïdales (23, 9, 4,1 et 1,7 m) animées par le **temps du film**
  (`playback.timeS`, sinon `clock.timeAtProgress`), effacées quand leur longueur d'onde couvre moins de ~8 pixels (pas de
  scintillement au loin) ; reflet du ciel = Fresnel de Schlick (F0 0,02) × 1,5 × irradiance de la sonde de ciel Takram (`lightProbe`)
  dans la direction réfléchie relevée au-dessus de l'horizon / π (couleur glacier fixe sans l'atmosphère) ; opacité = fondu de rive
  × mix(0,82, 1, Fresnel) × `strength`. Fonction du temps du film seulement : l'export reste déterministe.
- **Réglage** : `settings.water { enabled, strength }` (vrai, 1 ; `SETTING_CHECKS` : 0 ≤ strength ≤ 1), case « Lacs et rivières
  reflétants » et curseur « Intensité de l'eau » de la section « Fond de carte ».
- **Limites** : le reflet est celui du ciel moyen (sonde SH), ni des montagnes ni des nuages ; lacs au niveau du MNT (pas de niveau
  OSM) ; une rivière très pentue garde des marches de 60 m ; seul le couloir de 8 km est interrogé ; les crédits « © contributeurs
  OpenStreetMap » suivent encore les seuls repères (`useWaterStore.polygons` est prêt pour la barre d'état et l'export).

## Course fantôme (phase 7)

- La progression reste la fraction de distance de la première trace (suivie par la caméra) ; chaque autre trace reçoit un
  marqueur placé par `raceAt(race, progression)`, fonction pure. Réglage `settings.race { enabled, sync }`, bloc « Course
  fantôme » de la liste des traces (à partir de deux traces).
- Synchronisation : `elapsed` (même temps écoulé depuis chaque départ), `clock` (même heure enregistrée ; attente au départ,
  arrêt à l'arrivée), `distance` (même fraction de chaque trace). Les deux premiers exigent des horodatages sur toutes les
  traces, sinon repli sur `distance`.
- Tables temps ↔ distance par trace (points sans heure comblés, horloge rendue monotone), requêtes par dichotomie. Écarts du
  classement comparés à fraction égale (exacts sur un même parcours) ; affichage « +1 min 20 », « −350 m ».
- `RaceMarkers` (après `FlyoverRig` dans `TerrainLayer`) : même genre de marqueur que la tête (`settings.marker`, voir « Trace
  et marqueur ») à la couleur de la trace avec bord encre, même taille écran que le marqueur principal. Limite : les arrêts de la trace de tête sont franchis instantanément (la lecture avance en distance).

## Enchaînement de traces

- « Enchaîner en un seul parcours » (liste des traces, dès deux traces) : `chainTracks` (pur, `src/import/chain.ts`)
  réunit les traces en une seule, ordonnée par heure de départ si toutes sont horodatées, sinon dans l'ordre de la liste
  (la liste ne se réordonne pas). Chaque trace garde ses segments : le saut entre la fin du jour 1 et le départ du jour 2
  n'est ni dessiné (`TrackLines`, une ligne par segment) ni compté (`computeStats`, `buildTrackPath`), le marqueur le
  franchit d'un coup. Deux enregistrements qui se chevauchent sont refusés (une sortie en groupe : course fantôme).
- Nouvel id, stats et bornes recalculées (`buildTrack`), couleur, source, activité et décalage horaire de la première,
  waypoints de toutes ; nom = mots communs (« Tour du Mont-Blanc » pour « … J1 », « … J2 ») sinon « première → dernière ».
  La durée compte les nuits entre les jours.
- Store : `replaceTracks(liste)` (même origine du repère, lecture au début). Les traces ne sont pas dans l'historique
  (comme la suppression) : le message « Traces enchaînées » porte « Annuler », qui remet les traces séparées ; il
  disparaît au prochain changement des traces (`chainLoadedTracks`, `projectActions.ts`).
- Import : quand un même import donne des traces horodatées qui se suivent (sans chevauchement, moins de 24 h d'écart,
  `followEachOther`), un message « Enchaîner ces N traces ? » propose l'action sur ces traces seulement.
- Limite : arrêts, plans clés et repères calés en mètres sur l'ancienne première trace ne sont pas recalés.

## Application de bureau (phase 6, premier incrément)

Deux cibles, un seul code : le site statique et l'application Tauri 2 (`src-tauri/`) qui charge le même `dist/`. Ce qui
diffère passe par `src/platform/`.

- **Contrat** (`platform.ts`) : `Platform` = `capabilities { isDesktop, videoEncoder, canStreamToDisk }`, `storage` (clé / valeur
  synchrone : `get`, `set` → false quand le stockage refuse (plein, bloqué ; la valeur reste alors en mémoire pour la
  session et `get` la rend), `remove`, `keys(préfixe)` qui liste les clés stockées ou gardées en mémoire), `openFiles({ filters, multiple })` → `File[]` (vide si la fenêtre est fermée),
  `saveFile(blob, { fileName, filters? })` et `saveUrl(objectUrl, …)` → `{ saved: true, fileName } | { saved: false }`,
  `createWritableFile({ fileName, filters? })` → `WritableFile { fileName, path?, write(data, position), close, discard }` ou null
  (fenêtre fermée ; `discard` arrête et supprime le fichier partiel, sans effet après `close`, appelable plusieurs fois),
  `droppedFiles(dataTransfer)`. Les filtres sont ceux des fenêtres natives (`{ name, extensions }` sans point) ; le site en
  tire l'attribut `accept`.
- **Choix** (`index.ts`) : `getPlatform()` (singleton) appelle `selectPlatform(globalThis)` : bureau si Tauri a posé
  `isTauri` / `__TAURI_INTERNALS__` sur la fenêtre, site sinon. `videoEncoder` : `'webcodecs'` si `VideoEncoder` existe, sinon `'native'` sur le bureau (ffmpeg, voir
  « Export vidéo sans WebCodecs (Linux) »), sinon null.
- **Site** (`web.ts`) : le comportement d'avant. `<input type="file">` créé à la volée (synchrone jusqu'au clic, pour garder
  le geste de l'utilisateur ; `cancel` le retire), téléchargement par lien et URL d'objet, `localStorage`.
  `createWritableFile` : `showSaveFilePicker` (types tirés des filtres, `pickerTypes`) puis `createWritable()` (Chrome
  écrit dans un fichier temporaire `.crswap` déplacé à la fermeture) ; `discard` = `abort()` puis `handle.remove()`
  (Chrome 110+), car le sélecteur a déjà créé le fichier ; `AbortError` (fenêtre fermée) → null.
- **Dossier** (`folder.ts`, rendu en lot) : `pickFolder` → `WritableFolder { name, createFile(fileName) }` ou null. Site :
  `showDirectoryPicker({ mode: 'readwrite' })`, puis `getFileHandle(nom, { create: true })` et le même flux que
  `createWritableFile` (`writableOf`) ; `discard` = `removeEntry`. Bureau : fenêtre `open({ directory: true, recursive:
  false })` (le plugin dialog ouvre le dossier au scope fs, fichiers directs seulement), puis `openWritablePath(chemin)`
  de `desktop.ts`, partagé avec `createWritableFile`.
- **Bureau** (`desktop.ts`) : `@tauri-apps/plugin-dialog` (`open`, `save`) et `@tauri-apps/plugin-fs` (`readFile`,
  `writeFile`), importés dynamiquement au premier appel : le site les embarque dans des morceaux séparés jamais chargés.
  Un fichier lu devient un `File` (nom, type déduit de l'extension), donc `openFiles`, `openProject`, `readPhoto` et les
  imports n'ont rien de spécial. `createWritableFile` : fenêtre `save` puis `open(path, { write, create, truncate })` de
  plugin-fs ; chaque écriture `seek` seulement si sa position n'est pas celle du curseur (corrections d'en-tête), puis
  `write` en boucle jusqu'au dernier octet (un appel IPC par morceau de 4 Mio, octets en JSON) ; `discard` ferme et
  `remove`. Le stockage reste `localStorage`, que la vue web garde dans le dossier de l'application.
- **Branché** : « Ouvrir » et Ctrl+O (`chooseFilesToOpen`), « Enregistrer » (`saveProject`, marqué enregistré seulement si
  le fichier est écrit), dépôt sur la fenêtre (`droppedFiles`), résultat d'un export sur le bureau (`saveExportedFile`, un
  appel dans `download` d'`ExportPanel` ; sur le bureau le lien « Télécharger … » devient un bouton « Enregistrer … » et
  l'action du toast « Enregistrer… » ; un film écrit au fil de l'eau n'en a pas besoin), film écrit au fil de l'eau
  (`createWritableFile`, voir « Export vidéo »), message « pas d'encodeur » d'`ExportPanel` (`videoEncoderMissingHint`). Tous les
  choix de fichier passent par `openFiles` : accueil (« Choisir un fichier » → `chooseTracksToImport`, « Ouvrir un
  projet… » → `chooseProjectToOpen`), « Ajouter » de la liste des traces, logo de l'habillage (png, jpg, webp, svg),
  « Média » de la timeline (jpg, png, webp, mp4, m4v, mov, webm : les types que le bureau reconnaît, `mimeTypeOf` ; GIF,
  AVIF… restent possibles par dépôt sur le site). Stockage par `getPlatform().storage`, mêmes clés qu'avant (les données
  déjà enregistrées restent) : préférences de l'interface (`App.tsx`, `openflyover.shell.v1`), préréglages
  (`presets.ts`, `openflyover.presets.v1`), cache météo (`openMeteo.ts`, `openflyover.weather.v1`) ; les deux derniers
  par un adaptateur `getItem` / `setItem` vers le `KeyValueStore`, et cache Overpass (`overpass.ts`,
  `openflyover.osm.v1.<empreinte>`) : quand `set` répond false, il supprime ses propres entrées (`keys(CACHE_PREFIX)`,
  jamais les autres clés) et réessaie une fois ; sinon le cache mémoire évite les requêtes répétées dans la session.
- **Tauri** (`src-tauri/`) : `lib.rs` enregistre les extensions dialog et fs, les six commandes de l'encodeur natif
  (`video.rs`) et les deux de la ligne de commande (`cli.rs`), toutes déclarées dans `build.rs` (`AppManifest::commands`) :
  une commande absente de cette liste ou de `capabilities/default.json` est refusée. Fenêtre `main`
  1440 × 900 (au moins 1024 × 700). `dragDropEnabled: false` : sinon Tauri intercepte les dépôts et le HTML ne reçoit plus
  `drop`. Droits (`capabilities/default.json`) : `dialog:allow-open`, `dialog:allow-save`, `fs:allow-read-file`,
  `fs:allow-write-file`, `fs:allow-open`, `fs:allow-seek`, `fs:allow-write`, `fs:allow-remove` (film écrit au fil de
  l'eau), `fs:allow-mkdir`, `fs:allow-read-dir`, `fs:allow-exists` (packs hors ligne, « Mes projets »), `allow-video-available`, `allow-video-sound`, `allow-video-open`,
  `allow-video-frame`, `allow-video-finish`, `allow-video-cancel` (encodeur natif), `allow-cli-render`, `allow-cli-exit`
  (ligne de commande) ; deux portées
  fixes, `$APPDATA/tiles` et `$APPDATA/projects` avec ce qu'ils contiennent (`fs:scope`), en plus des chemins que l'extension dialog ajoute pour chaque
  fichier choisi et des deux dossiers d'un rendu en ligne de commande : rien d'autre n'est lisible. CSP : `connect-src` /
  `img-src` listent les hôtes de tuiles (`src/terrain/sources.ts`), Open-Meteo, les deux serveurs Overpass et Nominatim, plus `ipc:` et `blob:` ; `style-src 'unsafe-inline'` avec `dangerousDisableAssetCspModification:
  ["style-src"]` (Tauri ajouterait sinon un nonce qui annule `unsafe-inline`). **Toute nouvelle source doit aussi entrer
  dans la CSP de `tauri.conf.json`.**
- **Vérifié** : `cargo check --target x86_64-pc-windows-msvc` passe (configuration, droits, icônes, `generate_context!`),
  avec un faux compilateur de ressources (`RC_x86_64_pc_windows_msvc`) car rien n'est lié. Sous Linux, la vérification
  demande `libwebkit2gtk-4.1-dev` et GLib ≥ 2.70 (Ubuntu 22.04 ou plus) ; la machine de développement (Ubuntu 20.04) ne les
  a pas.
- **Installeurs** (`.github/workflows/desktop.yml`, mode d'emploi dans `docs/installeurs.md`) : `tauri-apps/tauri-action`
  sur Windows (NSIS + MSI), macOS (`universal-apple-darwin`) et Ubuntu 22.04 (AppImage + deb), à la main ou sur étiquette
  `v*` (version brouillon). Signature facultative par les secrets du dépôt : Windows, PFX importé dans le magasin puis
  empreinte écrite dans `src-tauri/tauri.windows.conf.json` (généré, jamais versionné ; horodatage et SHA-256 dans
  `tauri.conf.json`) ; macOS, variables `APPLE_*` de Tauri exportées seulement si présentes (vides, elles feraient
  échouer la construction), signature ad hoc (`signingIdentity: "-"`) sinon. Pas d'extension de mise à jour.
  `.github/workflows/ci.yml` : types, lint, tests unitaires et build à chaque push.

### Export vidéo sans WebCodecs (Linux)

WebKitGTK n'a pas `VideoEncoder` ; Edge (WebView2) l'a, WebKit sous macOS aussi depuis Safari 16.4. Sur le bureau sans
WebCodecs, `capabilities.videoEncoder` vaut `'native'` : le film est encodé par le `ffmpeg` du système (`apt install
ffmpeg`), lancé par des commandes Rust (`src-tauri/src/video.rs`) ; rien à embarquer, aucune exécution ouverte au
JavaScript.

- **Commandes** (async : elles ne bloquent pas la fenêtre), une session par export, dans un `Mutex<Videos>` :
  `video_available` (`ffmpeg -version` lancé et réussi), `video_sound` (corps binaire : le son en WAV, écrit dans le
  dossier temporaire → id), `video_open(path, width, height, fps, quality, sound)` → id, `video_frame` (corps binaire :
  l'image RGBA, id dans l'en-tête `x-video-session`), `video_finish(id)` → taille du fichier, `video_cancel(id)`.
  Arguments fixés en Rust (`ffmpeg_args`, testé par `cargo test`) : `-f rawvideo -pix_fmt rgba -s WxH -r fps -i -`
  [`-i son.wav`] `-c:v libx264 -preset medium -crf <qualité> -pix_fmt yuv420p`, couleurs converties et marquées BT.709
  (`-vf scale=out_color_matrix=bt709`, `-colorspace` / `-color_primaries` / `-color_trc bt709`) [`-c:a aac -b:a 192k`]
  `-movflags +faststart -f mp4 -y chemin`. Qualité → `crf` : standard 23, haute 20, maximale 17 (qualité constante, pas
  de débit visé : l'estimation de taille du tiroir reste celle du H.264 de WebCodecs). Nom tapé en `.webm` (`is_webm`,
  `nativeCodecFor` côté JavaScript) : `-c:v libvpx-vp9 -crf <qualité> -b:v 0 -deadline good -cpu-used 4 -row-mt 1`,
  son `-c:a libopus`, `-f webm` ; `crf` standard 34, haute 31, maximale 26 (essayé avec le ffmpeg d'une Ubuntu : VP9 +
  Opus lus par `ffprobe`, WAV 44,1 kHz rééchantillonné seul).
- **Chemin** : celui du fichier choisi dans la fenêtre « Enregistrer » au début de l'export (`WritableFile.path`, posé
  par `openWritablePath` ; dossier du rendu en lot compris). `video_open` refuse un chemin relatif ou hors de la portée
  fs (où l'extension dialog ajoute chaque fichier choisi). La poignée ouverte par la fenêtre n'écrit rien ; elle est
  fermée après `video_finish` (fichier gardé) ou supprimée par `discard` (annulation, échec). Sans chemin (repli en
  mémoire), l'export échoue avec un message.
- **Images** : le compositeur d'export dessine chaque image dans un canvas 2D ; `getImageData` → RGBA brut en corps
  binaire d'`invoke` (pas de JSON ; 8,3 Mo en 1080p, négligeable devant le rendu). Contre-pression : `video_frame`
  écrit sur l'entrée standard de ffmpeg et ne répond que quand le tube a pris l'image ; taille vérifiée.
- **Son** : le mixage du film (`mixFilmAudio`, voir « Export vidéo ») est converti en WAV 16 bits entrelacé (`wavFile`)
  et passé avant l'ouverture (`video_sound`), seconde entrée de ffmpeg, encodée en AAC 192 kbit/s (Opus en WebM) ; fichier temporaire
  supprimé en fin de session (réussite, échec, annulation) ou si `video_open` échoue.
- **Erreurs** : ffmpeg tourne avec `-loglevel error` ; s'il s'arrête (écriture refusée sur son entrée) ou finit en
  échec, la commande renvoie « ffmpeg a échoué : » et ses trois dernières lignes d'erreur, et supprime le fichier
  partiel. `video_cancel` tue ffmpeg et supprime le fichier ; sans effet sur une session déjà finie.
- **Côté JavaScript** (`src/export/nativeEncoder.ts`) : `createNativeVideoEncoder` a le contrat de `VideoEncodeSession`
  (`addFrame`, `finish`, `cancel`) ; `createExportEncoder` le choisit quand `videoEncoder` vaut `'native'`, sinon
  WebCodecs (`ExportController`) ; `exportCodec` remplace `pickCodec` dans le tiroir et le lot : MP4 / H.264 si
  `video_available` répond oui (demandé à chaque fois : ffmpeg installé pendant que l'application tourne est vu), null
  sinon, et le tiroir dit « installez ffmpeg » (`videoEncoderMissingHint`). L'invocation de Tauri est importée au
  premier appel : le site n'en charge rien.
- **Pas encore** : l'habillage seul (WebM transparent) reste réservé à WebCodecs (le tiroir le dit) ; pas de repli
  intégré sans ffmpeg (crate `openh264` + mise en MP4 en Rust, envisagé : H.264 « baseline », quelques Mo de plus).
  Écartés : `ffmpeg` en sidecar (`bundle.externalBin`, 70 à 100 Mo par plateforme, licence GPL avec x264) ; `rav1e` (AV1
  en pur Rust, trop lent en 4K, lecture moins universelle).
- **Vérifié** : `cargo check --target x86_64-pc-windows-msvc` ; tests JavaScript avec une fausse invocation
  (`nativeEncoder.test.ts`). À vérifier sur un bureau Linux (`cargo test`, export réel) : `docs/tests-gpu.md`, section 7.

## Packs hors ligne (phase 6)

« Préparer hors ligne » (onglet Trace, section « Hors ligne », `src/ui/OfflinePanel.tsx`) télécharge une fois les tuiles
d'un survol des traces chargées ; la vue et l'export les lisent ensuite sans réseau.

- **Plan** (`plan.ts`, pur) : les tuiles que le moteur charge pendant le survol, avec sa propre règle. Une tuile de
  taille G est découpée quand une maille (G / 64) dépasse 3 px : caméra à moins de r = G / 64 · H / (6 · tan 25°)
  ≈ 6 G pour H = 1080 px (×2 en 4K) ; un découpage charge les quatre enfants. La caméra de suivi reste près de la
  trace, à h = distance automatique × réglage « distance » × sin(inclinaison) au-dessus : une tuile est découpée si
  √(d² + h²) < r, d = distance de la trace à la tuile (points densifiés à 25 m, grille de 1 km). Parcours depuis les
  racines du moteur (même zone : boîte des traces + 25 km, 40 km au moins, ≤ 16 racines) : les deux niveaux sous les
  racines sur toute la zone (le paysage lointain), plus profond seulement les enfants des tuiles qui touchent le
  couloir (2, 5 ou 10 km de large, centré sur la trace). Hors du couloir le moteur garde le niveau plus grossier du
  pack (le remplacement attend les quatre enfants, d'où les enfants entiers). Imagerie : `planImagerySubtiles` de
  chaque tuile de relief, même décalage de zoom que la vue (recadrage au-delà du zoom max de la source). Estimation
  = nombre de tuiles × taille moyenne mesurée par source (`policy.ts`). Ordre de grandeur, trace droite de 20 km dans
  les Alpes, Mapterhorn + IGN, décalage 1, h = 400 m : 2 km → 10 500 tuiles, ~450 Mo ; 5 km → 22 000, ~930 Mo ;
  10 km → 28 000, ~1,2 Go (Mapterhorn : ~150 Ko par tuile de 512 px). Au-delà de 150 000 tuiles, refusé. Hors du
  plan : plans d'ensemble et orbites hautes (niveaux grossiers, déjà là), export 4K (un niveau de plus dans un couloir
  large).
- **Politique** (`policy.ts`) : une décision par source, motifs et liens dans le README ; une source absente de la
  table est refusée. OpenTopoMap, Esri World Imagery et swisstopo (photos et carte) sont permis en usage personnel
  (`personalUse`, mise en garde dans le panneau) avec une limite basse. Une imagerie refusée n'empêche pas le pack : il
  ne contient alors que le relief et l'imagerie reste en ligne. Limite par jour et par appareil : Mapterhorn 20 000,
  IGN 50 000 (toutes couches), EOX 20 000, Esri et swisstopo 10 000, OpenTopoMap 2 000 ; AWS sans limite.
- **Téléchargement** (`download.ts`) : 4 requêtes à la fois, réessais de `downloadTile` (ceux du fetcher), tuiles déjà
  dans le pack sautées, 4xx = « pas de donnée ici » (Mapterhorn au-delà de z12 hors zones fines), arrêt après 20 échecs
  réseau de suite ou si le stockage refuse une tuile, pause (les requêtes en cours finissent), reprise, annulation
  (pack neuf supprimé). Compteur du jour par fournisseur dans `storage` (`openflyover.offline.quota.v1`).
- **Packs** (`packs.ts`, `store.ts`) : identifiant = empreinte des URL du plan, donc mêmes traces + mêmes réglages =
  même pack, et le relancer termine un pack incomplet. Liste dans `storage` (`openflyover.offline.v1` : nom, sources,
  couloir, tuiles, octets, complet, débuts d'URL des sources). `installOfflineTiles()` (`main.tsx`) enregistre le
  lecteur du fetcher : `covers(url)` compare l'URL aux débuts d'URL des packs (synchrone, sans attente quand aucun
  pack ne contient la source : même chemin qu'avant), puis `tileCache.get`. Une copie illisible ou absente → réseau.
- **Stockage** (`src/platform/tileCache.ts`) : site = Cache Storage, un cache par pack `openflyover-tiles-v1:<pack>`,
  l'URL comme clé (supprimer un pack = supprimer son cache ; une tuile commune à deux packs est gardée deux fois),
  `navigator.storage.persist()` demandé à la première tuile, `size()` = `navigator.storage.estimate()` ; absent sans
  HTTPS (`tileCache` null, la section le dit). Bureau = un fichier par tuile, `<app data>/tiles/<pack>/<tileFileName(url)>`
  (deux empreintes de 53 bits), plugin-fs avec `baseDir: AppData` ; index des noms lu une fois (`readDir`) : une
  tuile absente ne coûte aucun appel au disque ; type d'image reconnu aux premiers octets.
- **Coût du cache d'abord** : bureau, rien pour une tuile absente (index en mémoire) ; site, un `match` par pack qui
  contient la source (non mesuré ici, faute de navigateur ; négligeable devant une requête réseau de 50 à 300 ms).
- **Limites** : hors ligne, une tuile hors du pack échoue après les réessais (le parent reste affiché) ; l'export attend
  ces échecs comme en ligne. Le pack suit la trace et les réglages du moment : changer de source ou de décalage de
  zoom demande un autre pack.

# Sources de tuiles — vérification empirique

Date de vérification : **2026-10-05** (relecture indépendante le même jour : sondes supplémentaires aux frontières, § « Sondes frontalières ») ;
cartes topographiques et orthophotos datées ajoutées le **2026-10-07** (§ « Cartes et photos anciennes »). Outils : `curl.exe` avec l'en-tête `Origin: http://127.0.0.1:5173`
(statut, `content-type`, `access-control-allow-origin`), lecture des en-têtes d'image (IHDR / SOF / VP8L)
et décodage PNG minimal en Node (zlib) pour le contrôle Terrarium, documents GetCapabilities des fournisseurs.
`src/terrain/sources.ts` est la seule vérité pour le code ; ce document en est la justification.

Tuiles de référence (XYZ, y = 0 au nord) : Chamonix (6.87, 45.92) → z12 = 2126/1458, z15 = 17009/11668,
z17 = 68037/46672, z19 = 272149/186689 ; Paris (2.35, 48.86) → z12 = 2074/1409, z19 = 265566/180362 ;
Zermatt (7.75, 46.02) → z12 = 2136/1456, z20 = 546861/372959 ; New York (−74.0, 40.7) → z12 = 1206/1540.

## Tableau récapitulatif

| id | Gabarit d'URL | Zooms | Tuile | Encodage / format | CORS | Couverture | Licence | Attribution à afficher |
|---|---|---|---|---|---|---|---|---|
| `mapterhorn` | `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp` | 0–17 (variable : 12 à 17 selon la région) | **512 px** | Terrarium, WebP sans perte (VP8L) | `*` | mondiale | données ouvertes (CC BY 4.0, OGL, domaine public… 151 sources, `download.mapterhorn.com/attribution.json`) ; code BSD-3 | `© Mapterhorn` (tiles.json) + lien `mapterhorn.com/attribution` |
| `aws-terrarium` | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | 0–15 | 256 px | Terrarium, PNG RGB 8 bits | `*` | mondiale | sources publiques (USGS 3DEP/SRTM/GMTED2010, NOAA ETOPO1, EU-DEM Copernicus, ArcticDEM, CC BY NZ/AT/NO/AU/UK OGL…) — voir `tilezen/joerd/docs/attribution.md` | « Terrain Tiles (Mapzen / AWS Open Data) — SRTM, GMTED2010, ETOPO1 courtesy of USGS/NOAA, EU-DEM © Copernicus, ArcticDEM… » |
| `ign-ortho` | `https://data.geopf.fr/wmts?…LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg` | 0–19 (`PM_0_19`) | 256 px | JPEG | `*` | France métropolitaine + Corse (boîte −5.6/41.2 → 10.0/51.3, **sur-approximation** : la bande frontalière incluse dans la boîte renvoie une tuile blanche 200 ou un 404) ; z ≤ 12 disponible partout (mosaïque mondiale basse résolution) | Licence ouverte Etalab 2.0 (BD ORTHO), CGU `cartes.gouv.fr/cgu`, `Fees: none` | `© IGN — Géoplateforme (BD ORTHO)` |
| `swisstopo` | `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg` | 0–20 (`3857_20`) | 256 px | JPEG | `*` | boîte 5.140242/45.398181 → 11.47757/48.230651 (WGS84BoundingBox du GetCapabilities) ; vraies tuiles jusqu'à z20 sur toute la boîte, mais **nettement moins résolues hors Suisse/Liechtenstein** | OGD swisstopo, gratuit, « fair use » (~20 000 utilisateurs/jour) | `© swisstopo` |
| `arcgis-world-imagery` | `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | 0–19 (le service annonce 24 LOD, z0–23 ; au-delà de 19 un placeholder 200 est renvoyé là où il n'y a pas d'image) | 256 px | JPEG | `*` | mondiale | Esri Master Agreement ; voir § Esri | `Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community` (champ `copyrightText` du service) |
| `eox-s2cloudless` | `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg` | 0–16 dans le catalogue (serveur : 200 jusqu'à z18 à Chamonix, 404 à z19 ; natif ≈ z14 / 10 m) | 256 px | JPEG | origine reflétée (`access-control-allow-origin: http://127.0.0.1:5173`) | mondiale | **CC BY-NC-SA 4.0** (usage commercial : licence EOX séparée) | `EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)` |
| `ign-plan` | `https://data.geopf.fr/wmts?…LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&…&FORMAT=image/png` | 0–19 (`PM_0_19`) | 256 px | PNG RGB | `*` | France (même boîte que `ign-ortho`) ; 404 hors de France dès z13 | Licence ouverte Etalab 2.0 | `© IGN — Géoplateforme (Plan IGN)` |
| `swisstopo-carte` | `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg` | 0–19 (`3857_19`) | 256 px | JPEG | `*` | boîte swisstopo ; hors Suisse + bande frontalière, **tuile blanche** (668 o) à partir de z16 | OGD swisstopo, « fair use » | `© swisstopo` |
| `opentopomap` | `https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png` (`{s}` = a, b, c) | 0–17 (z18 : image « max zoom layer = 17 » sans CORS) | 256 px | PNG palette | `*` | mondiale | données ODbL (OSM) + SRTM, rendu **CC BY-SA** ; serveur bénévole, pas de téléchargement massif | `Kartendaten: © OpenStreetMap-Mitwirkende, SRTM \| Kartendarstellung: © OpenTopoMap (CC-BY-SA)` (traduit dans l'UI) |
| `ign-ortho-2000-2005` | `…LAYER=ORTHOIMAGERY.ORTHOPHOTOS2000-2005&STYLE=normal&…&FORMAT=image/jpeg` | **6**–18 (`PM_6_18`) | 256 px | JPEG | `*` | France (boîte IGN) ; tuile blanche 1 651 o / 404 hors de France | Licence ouverte Etalab 2.0 | `© IGN — Géoplateforme (BD ORTHO 2000–2005)` |
| `ign-ortho-1965-1980` | `…LAYER=ORTHOIMAGERY.ORTHOPHOTOS.1965-1980&STYLE=BDORTHOHISTORIQUE&…&FORMAT=image/png` | **3**–18 (`PM_3_18`) | 256 px | PNG palette, niveaux de gris, noir → transparent | `*` | **partielle** (Alpes, sud, ouest oui ; Bassin parisien, nord-est en grande partie non → 404) | Licence ouverte Etalab 2.0 | `© IGN — Géoplateforme (BD ORTHO historique 1965–1980)` |
| `ign-ortho-1950-1965` | `…LAYER=ORTHOIMAGERY.ORTHOPHOTOS.1950-1965&STYLE=normal&…&FORMAT=image/png` | 0–18 (`PM_0_18`) | 256 px | PNG niveaux de gris | `*` | France métropolitaine **complète** (seul millésime historique complet) ; déborde sur Genève et Courmayeur ; 404 à Zermatt | Licence ouverte Etalab 2.0 | `© IGN — Géoplateforme (BD ORTHO historique 1950–1965)` |

Toutes les sources répondent avec un en-tête CORS pour l'origine `http://127.0.0.1:5173` : **aucun proxy Vite n'est nécessaire**,
`TILE_PROXIES` reste vide dans `vite.config.ts`.

## Détail par source

### Mapterhorn (relief)

- `https://tiles.mapterhorn.com/tiles.json` : `{"scheme":"xyz","tiles":["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"],"encoding":"terrarium","tileSize":512,"attribution":"<a href='https://mapterhorn.com/attribution'>© Mapterhorn</a>"}`.
  Le README GitHub le présente comme remplaçant direct des AWS Elevation Tiles (même encodage Terrarium).
- En-tête du fichier : `RIFF…WEBPVP8L`, 512 × 512, sans perte (indispensable pour un DEM ; pas d'artefacts de compression).
- Zoom maximal **dépendant de la région** (meilleure source ouverte locale) :
  Chamonix 200 jusqu'à z17, 404 à z18 ; New York z16 OK, z17 404 ; Sahara (10 E, 25 N) et Everest : z12 OK, z13 404 (Copernicus 30 m).
  Le catalogue déclare `maxZoom: 17` ; un 404 à z ≥ 13 signifie « pas de donnée plus fine ici ».
- Licences : 151 sources listées dans `attribution.json` (ex. BEV Autriche CC BY 4.0, Lettonie CC BY 4.0, Taïwan OGDL 1.0…). Code BSD-3.
- Résultats : z12 200 `image/webp` 158 396 o, ACAO `*`, `cache-control: public, max-age=604800` ; z13–17 200 ; z18 404 `text/plain`.

### AWS Terrain Tiles / Tilezen (relief)

- Bucket public `elevation-tiles-prod` (us-east-1), préfixe `terrarium/`. PNG RGB 8 bits 256 × 256 (`colorType 2`), z0–15 ; z16 → 404 XML S3.
- Contrôle de l'encodage Terrarium `h = R·256 + G + B/256 − 32768` avec un décodeur PNG minimal (inflate + unfilter) :
  tuile z12 2126/1458 pixel central RGB (135,137,134) → **1929,5 m** (min 1022 m, max 3555 m sur la tuile : vallée de Chamonix → Aiguilles) ;
  tuile z15 17009/11668 pixel central → **1046,3 m** (centre de Chamonix ≈ 1035 m). Cohérent.
- CORS : `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET`.
- Attribution : la page registry.opendata.aws demande la citation « Terrain Tiles was accessed on DATE from https://registry.opendata.aws/terrain-tiles » ;
  les crédits par source (USGS, NOAA, Copernicus, LINZ CC BY 3.0 NZ, Kartverket CC BY 4.0, Environment Agency OGL v3, BEV CC BY 3.0 AT, Geoscience Australia CC BY 4.0, INEGI, NRCan) sont dans `tilezen/joerd/docs/attribution.md`.

### IGN BD ORTHO — Géoplateforme (imagerie)

- GetCapabilities (`https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0`, 2,9 Mo) : couche `ORTHOIMAGERY.ORTHOPHOTOS`,
  titre « Photographies aériennes », `Format image/jpeg`, `TileMatrixSetLink PM_0_19` avec `TileMatrixLimits` de 0 à **19** (z19 : lignes 58856–465431, colonnes 0–524287).
  Le TileMatrixSet `PM` lui-même va jusqu'à 21 (`TileWidth 256`) mais la couche s'arrête à 19.
- Résultats Chamonix : z12–z19 200 `image/jpeg` ; z20 et z21 → 404 `text/xml`. Paris z12 et z19 200.
- Couverture : New York z12 200 (mosaïque mondiale), z13/14/15/16 → 404 ; Zermatt z12 200, z13–19 → 404. D'où la boîte `coverage` France métropolitaine ;
  les DROM-COM (bbox de la couche −180/−80 → 180/80) ne sont pas inclus dans la boîte unique du catalogue.
- **Bande frontalière (relecture)** : à l'intérieur de la boîte mais hors de France, le serveur ne répond pas toujours 404 : Courmayeur, Champex,
  Genève et Bâle reçoivent à z13–z17 un **HTTP 200 `image/jpeg` de 1 651 o, entièrement blanc** (md5 `cb33c7de`, identique partout),
  puis 404 à partir de z17–z19 ; Zermatt, Milan et Lugano reçoivent 404 dès z13. Bâle a encore une vraie tuile à z13 (9 873 o) mais blanche de z14 à z17.
  `imagery.ts` ne peut pas distinguer ce blanc d'une vraie tuile : une trace transfrontalière rendue avec IGN aura des zones blanches
  (et non grises) hors de France. Les tuiles frontalières françaises (Annecy, Menton, Mulhouse, Ouessant, Dunkerque, Bastia, Bonifacio) sont bien réelles.
- CORS : `access-control-allow-origin: *` (+ `allow-credentials: true`). `Fees: none`, `AccessConstraints` → CGU `https://cartes.gouv.fr/cgu`.
  La BD ORTHO est diffusée sous licence ouverte Etalab 2.0 (données IGN ouvertes depuis 2021) ; mention « © IGN ».

### swisstopo SWISSIMAGE (imagerie)

- GetCapabilities EPSG:3857 (`https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml`) : couche `ch.swisstopo.swissimage`,
  `Format image/jpeg`, `TileMatrixSet 3857_20`, dimension `Time = current`,
  `ResourceURL …/default/{Time}/3857/{TileMatrix}/{TileCol}/{TileRow}.jpeg` (donc `{z}/{x}/{y}`),
  `WGS84BoundingBox 5.140242 45.398181 → 11.47757 48.230651`.
- Résultats Zermatt : z12/14/16/18/19/**20** 200 `image/jpeg` ; z21 → 400 JSON `Unsupported zoom level 21`.
  Chamonix z12 et z16 → 200 (dans la boîte, imagerie présente) ; Paris z12 → 400 JSON `Tile out of bounds`.
- Doc (`docs.geo.admin.ch`, WMTS) : tuiles 256 px, 3857 de z0 à 28 mais seules quelques couches dépassent 20.
- **Hors Suisse (relecture)** : toute la boîte renvoie de vraies tuiles distinctes (md5 différents) de z15 à z20 — Annecy, Chamonix, Courmayeur,
  Genève, Besançon, Mulhouse, Milan, Côme, Innsbruck, Bregenz, Vaduz. Mais hors Suisse/Liechtenstein il s'agit d'une mosaïque
  suréchantillonnée visiblement plus floue (Annecy z16 : swisstopo 20 568 o flou vs IGN 21 496 o net ; tailles z20 ≈ 3,4–5 Ko hors Suisse
  contre 11,9 Ko à Zermatt). swisstopo est donc une bonne source de **repli** pour une trace transfrontalière (Tour du Mont-Blanc complet,
  Courmayeur et Champex compris), pas une source de détail en France.
- Conditions (`geo.admin.ch/en/general-terms-of-use-fsdi`) : « The acquisition and use of data or services is free of charge, subject to the provisions on fair use » ;
  mention de source obligatoire (« © Data: swisstopo » dans le visualiseur) ; usage massif (bots) proscrit, ~20 000 utilisateurs/jour considéré comme fair use.
- CORS : `access-control-allow-origin: *`.

### Esri World Imagery (imagerie)

- `MapServer?f=pjson` : `tileInfo` 256 × 256 JPEG, 24 LOD (z0–23), `copyrightText: "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community"`.
- Ordre des segments : `tile/{z}/{y}/{x}` (ligne avant colonne).
- Résultats Chamonix : z12–z19 200 avec des tailles normales (11–19 Ko) ; **z20 et z21 → 200 mais 2 521 o, md5 identiques** (placeholder « pas de donnée »).
  Zermatt z20 → vraie tuile (10 851 o) ; Paris z20 → le même placeholder. New York z16 200.
  Comme le serveur ne renvoie pas 404 au-delà de la donnée, le catalogue fixe `maxZoom: 19` (disponible partout) ;
  la stratégie « recadrer la tuile la plus profonde » d'`imagery.ts` ne peut pas détecter ce placeholder.
- CORS : `Access-Control-Allow-Origin: *`.
- Conditions : service hérité « services.arcgisonline.com » accessible sans clé. Il est régi par l'Esri Master Agreement
  (`esri.com/en-us/legal/terms/full-master-agreement`, résumé `downloads2.esri.com/arcgisonline/docs/tou_summary.pdf`) :
  attribution obligatoire (le `copyrightText` du service, et « Powered by Esri » pour les applications), usage gratuit pour le développement,
  les tests et l'usage non commercial/interne ; un usage commercial ou dans un produit distribué requiert en principe un compte ArcGIS
  (le free tier des ArcGIS Location Services couvre 2 M de tuiles de fond de carte par mois) et interdit la mise en cache hors ligne
  des tuiles hors des mécanismes prévus. À ré-évaluer avant la phase « packs hors ligne » et avant toute diffusion commerciale.

### EOX Sentinel-2 cloudless (imagerie)

- `WMTSCapabilities.xml` : couches `s2cloudless-2017_3857` … `s2cloudless-2025_3857` (+ versions 4326). **2025 est la plus récente.**
  `ResourceURL template="…/s2cloudless-2025_3857/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg"` → avec `TileMatrixSet = g`
  (EPSG:900913, TileWidth 256, matrices 0–21), chemin `{z}/{y}/{x}`.
- Abstract de la couche : « EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025) released under
  Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License. For commercial usage please see https://cloudless.eox.at ».
  `AccessConstraints` : « Proper attribution is required for any usage… ». Page licence : attribution unifiée identique depuis juin 2026 ;
  usage commercial sous licence « EOX Commercial Attribution-RestrictedUse 1.2 ».
- Résultats Chamonix : z12–z18 200 `image/jpeg` (12 Ko à z14, 3 Ko à z18 : suréchantillonnage) ; z19 et z20 → 404. Paris et New York z12 200.
  Les tuiles 2024 et 2025 diffèrent (md5), la couche 2025 est bien distincte.
- Le catalogue fixe `maxZoom: 16` : au-delà de la résolution native (~10 m ≈ z14) les tuiles n'apportent aucun détail.
- CORS : `access-control-allow-origin: http://127.0.0.1:5173` (origine reflétée, `allow-credentials: true`).

## Journal des requêtes (2026-10-05, Origin http://127.0.0.1:5173)

| Source | Tuile | Statut | content-type | Taille | ACAO |
|---|---|---|---|---|---|
| mapterhorn | 12/2126/1458 | 200 | image/webp | 158 396 (512×512 VP8L) | `*` |
| mapterhorn | 13…17 Chamonix | 200 | image/webp | 156 556 … 79 328 | `*` |
| mapterhorn | 18/136074/93344 | 404 | text/plain | 14 | — |
| mapterhorn | NYC z16 / z17 | 200 / 404 | | | |
| mapterhorn | Sahara z12 / z13, Everest z12 / z13 | 200 / 404 | | | |
| aws-terrarium | 12/2126/1458 | 200 | image/png | 137 461 (256×256) | `*` |
| aws-terrarium | 14, 15 Chamonix | 200 | image/png | 105 948, 84 538 | `*` |
| aws-terrarium | 16/34018/23336 | 404 | application/xml | 319 | — |
| ign-ortho | 12/2126/1458 | 200 | image/jpeg | 18 072 (256×256) | `*` |
| ign-ortho | 14…19 Chamonix | 200 | image/jpeg | 18 093 … 11 007 | `*` |
| ign-ortho | 20, 21 Chamonix | 404 | text/xml | 137 | — |
| ign-ortho | Paris z12 / z19 | 200 / 200 | image/jpeg | 27 869 / 12 256 | `*` |
| ign-ortho | NYC z12 / z13–16 | 200 / 404 | | | |
| ign-ortho | Zermatt z12 / z16 | 200 / 404 | | | |
| swisstopo | 12/2136/1456 (Zermatt) | 200 | image/jpeg | 25 216 (256×256) | `*` |
| swisstopo | 12/2136/1457 | 200 | image/jpeg | 23 184 | `*` |
| swisstopo | Zermatt z14/16/18/19/20 | 200 | image/jpeg | 31 321 … 11 857 | `*` |
| swisstopo | Zermatt z21 | 400 | application/json | 93 | — |
| swisstopo | Chamonix z12 / z16 | 200 / 200 | image/jpeg | 24 364 / 24 958 | `*` |
| swisstopo | Paris z12 | 400 | application/json | 83 | — |
| arcgis-world-imagery | 12/1458/2126 | 200 | image/jpeg | 17 642 (256×256) | `*` |
| arcgis-world-imagery | 14…19 Chamonix | 200 | image/jpeg | 16 566 … 11 507 | `*` |
| arcgis-world-imagery | 20, 21 Chamonix | 200 | image/jpeg | 2 521 (placeholder identique) | `*` |
| arcgis-world-imagery | Zermatt z20 / Paris z20 | 200 / 200 | image/jpeg | 10 851 / 2 521 (placeholder) | |
| arcgis-world-imagery | Paris z19 / NYC z16 | 200 / 200 | image/jpeg | 16 632 / 8 215 | |
| eox-s2cloudless (2025) | 12/1458/2126 | 200 | image/jpeg | 21 075 (256×256) | origine reflétée |
| eox-s2cloudless | 14…18 Chamonix | 200 | image/jpeg | 12 313 … 3 034 | origine reflétée |
| eox-s2cloudless | 19, 20 Chamonix | 404 | | 1 225 | — |
| eox-s2cloudless | Paris z12 / NYC z12 | 200 / 200 | image/jpeg | 23 832 / 26 799 | |

### Sondes frontalières (relecture, 2026-10-05, z15 sauf mention)

| Lieu (lon, lat) | ign-ortho | swisstopo |
|---|---|---|
| Chamonix (6.87, 45.92) | 200, 18 569 o (réelle) | 200, 24 244 o |
| Courmayeur IT (6.97, 45.79) | 200, **1 651 o blanc** (z13–z15) ; 404 à z17, z19 | 200, 26 564 o |
| Champex CH (7.10, 46.03) | 200, 1 651 o blanc | 200, 29 869 o |
| Zermatt CH (7.75, 46.02) | 404 (z13–z19) | 200, 32 979 o ; z20 11 857 o |
| Genève CH (6.14, 46.20) | 200, 1 651 o blanc (z13–z15) ; 404 à z17 | 200, 30 374 o |
| Bâle CH (7.59, 47.56) | z13 200 9 873 o (réelle) ; z14–z17 1 651 o blanc ; z19 404 | 200, 31 186 o |
| Annecy FR (6.13, 45.90) | 200, 23 770 o (réelle) | 200, 28 413 o (flou) ; z20 3 388 o |
| Besançon FR (6.02, 47.24) | 200, 21 281 o | 200, 29 507 o |
| Mulhouse FR (7.34, 47.75) | 200, 23 806 o | 200, 34 601 o |
| Milan IT (9.19, 45.46) | 404 | 200, 29 199 o ; z20 3 843 o |
| Lugano CH (8.95, 46.00) | 404 | 200, 25 747 o |
| Innsbruck AT (11.39, 47.27) | — (hors boîte) | 200, 35 788 o ; z20 5 056 o |
| Bregenz AT / Vaduz LI / Côme IT | — | 200 (24–31 Ko) |
| Menton, Bastia, Bonifacio, Ouessant, Dunkerque (FR) | 200, 12–23 Ko (réelles) | — |

## Cartes et photos anciennes (2026-10-07)

Même protocole (`curl` avec `Origin: http://127.0.0.1:5173`, lecture des en-têtes PNG/JPEG, Pillow pour les pixels transparents ou blancs),
GetCapabilities Géoplateforme (`https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0`) et swisstopo (EPSG:3857).
Deuxième région de contrôle : Paris (IGN), Zermatt et Berne (swisstopo), New York (OpenTopoMap, Plan IGN). Échantillonnage de couverture :
grille de 56 points (7 longitudes −1,5 → 7,0 × 8 latitudes 43,3 → 50,3) à z14.

### IGN — orthophotos datées

- Couches publiques sans clé dans le GetCapabilities : `ORTHOIMAGERY.ORTHOPHOTOS.1950-1965`, `.1965-1980`, `.1980-1995`,
  `ORTHOIMAGERY.ORTHOPHOTOS2000-2005`, `2006-2010`, `2011-2015`, `2016-2020`, `2021-2023`, ainsi que des millésimes annuels (`ORTHOPHOTOS2000` … `2024`),
  les couvertures IRC, Pléiades / SPOT annuels et des emprises locales `EDUGEO` (villes, années 1950–1990). Métadonnées `IGNF_BD-ORTHO-HISTO` :
  « Licence Ouverte / Open License », et « Seul un millésime (1950-1965) en niveaux de gris est aujourd'hui complet sur le territoire. D'autres sont en cours de constitution. »
- **1950–1965** : `Format image/png`, `PM_0_18`, styles `BDORTHOHISTORIQUE` (défaut, « noir rendu transparent ») et `normal` ; le catalogue utilise `normal`
  (PNG niveaux de gris opaque, `colorType 0`). Chamonix z10–z18 200 (40–58 Ko), z19 404 ; Paris z12/z16/z18 200. Grille z14 : 48/56 en 200
  (les 404 et tuiles de 141 o sont en mer ou en Allemagne / Suisse). Vraies photos à Genève et Courmayeur (z15), 404 à Zermatt. Aucune transparence ni pixel noir
  sur les tuiles alpines testées. z0 et z3 servis (mosaïque basse résolution).
- **1965–1980** : seul le style `BDORTHOHISTORIQUE` existe (`STYLE=normal` → **400** « Style normal unknown »). PNG palette en niveaux de gris, `PM_3_18`
  (z2 → 404). Chamonix z12–z18 200, z19 404 ; Paris z12/z16/z18 200. Grille z14 : **39/56** (trous dans le Bassin parisien, la Champagne, la Lorraine).
  Sur l'emprise de la trace d'exemple (49 tuiles z14) : couverture complète sauf le massif du Mont-Blanc (1 tuile 404, 2 partielles) ; le noir rendu
  transparent laisse voir le gris neutre d'`imagery.ts`. D'où l'étiquette « (France, partiel) ».
- **1980–1995** : même format que 1965–1980 mais 404 à Chamonix et à Paris, 6/56 sur la grille (Bretagne / Normandie seulement) : **non retenue**.
- **2000–2005** (et 2006–2010, même structure) : `Format image/jpeg`, style `normal`, `PM_6_18` : z5 → 404, z6 200, Chamonix z12–z18 200 (13–20 Ko), z19 404 ;
  Paris z12/z16/z18 200. Grille z14 : 48/56, mêmes trous que BD ORTHO (mer) et **même tuile blanche de 1 651 o** hors de France (Courmayeur, Genève).
  Seule 2000–2005 est ajoutée (point intermédiaire entre les années 1950 et aujourd'hui) ; 2006–2010, 2011–2015, 2016–2020, 2021–2023 et les millésimes
  annuels fonctionnent de la même manière et peuvent être ajoutés à l'identique.
- CORS `*`, `Fees: none`, CGU `cartes.gouv.fr/cgu` comme `ign-ortho`.

### Plan IGN v2

- Couche `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`, « Plan IGN », style `normal`, `Format image/png`, `PM_0_19` (limites z19 : lignes 858–523429).
  Métadonnées `IGNF_PLAN-IGN` : « Licence Ouverte / Open License ».
- Chamonix z0/z5/z12/z15/z17/z18/z19 200 (PNG RGB 22–100 Ko), z20 404 ; Paris z12/z19 200. Zermatt z12 200 puis 404 de z13 à z17 ;
  Courmayeur z13/z15 200 (marge frontalière), z17 404 ; New York 404 dès z10. Grille z14 : 48/56. → boîte `coverage` France.
- La carte **SCAN 25 / TOPO 1:25 000** n'est pas publique : `GEOGRAPHICALGRIDSYSTEMS.MAPS` → 400 « Layer unknown » sur `/wmts`,
  401 sur `/private/wmts` (clé requise) — **exclue**.

### swisstopo — carte nationale

- Couche `ch.swisstopo.pixelkarte-farbe` « Landeskarten (farbig) », `image/jpeg`, `3857_19`, `Time = current`, même `WGS84BoundingBox` que SWISSIMAGE.
- Zermatt z6/z12/z15/z17/z18/z19 200 (13–40 Ko), z20 → 400 JSON ; Berne z12/z19 200 ; Paris z12 → 400 « Tile out of bounds ».
- Chamonix : z12 et z15 = vraie carte (la carte suisse déborde sur la vallée de Chamonix), **z17 et z19 = JPEG blanc de 668 o** (z16 aussi).
  Bonne source pour la Suisse, pas pour la France au-delà de z15.
- Conditions identiques à SWISSIMAGE (OGD, gratuit, fair use, mention « © swisstopo »).

### OpenTopoMap

- `https://{a|b|c}.tile.opentopomap.org/{z}/{x}/{y}.png` (chemin donné sur `opentopomap.org/about`). Les trois sous-domaines renvoient la même tuile (md5 identique).
- Chamonix z0/z3/z12/z15/z17 200 (PNG palette 21–51 Ko) ; **z18 → 200 avec une image « max zoom layer = 17 » (4 343 o) sans en-tête CORS** :
  le catalogue s'arrête à 17. New York z12/z17 200. CORS `*`, `cache-control: max-age=604800`.
- Conditions (`opentopomap.org/about`, rubriques « Verwendung » et FAQ) : carte sous **CC-BY-SA**, « kostenlos und frei verwendet » avec attribution
  « Kartendaten: © OpenStreetMap-Mitwirkende, SRTM | Kartendarstellung: © OpenTopoMap (CC-BY-SA) » ; intégration dans un site ou une application
  « jederzeit gerne möglich, sofern unser Server z.B. durch Massendownloads nicht zu stark beansprucht wird », sans garantie de disponibilité ;
  le rendu tourne depuis le 05/01/2026 sur un vServer plus petit. → **retenue pour l'usage interactif**, mais à **exclure des futurs packs hors ligne**
  et des rendus vidéo massifs (pré-téléchargement de toute une trace à z17).

### Sources examinées et non retenues

| Source | Constat (2026-10-07) | Motif |
|---|---|---|
| Stadia Maps (Stamen Watercolor, Stamen Terrain) | `tiles.stadiamaps.com/tiles/stamen_watercolor/…` : 200 avec `Origin: http://127.0.0.1:5173` (tolérance « localhost » de Stadia), **401** sans en-tête Origin | compte / clé API requis hors développement local : **exclu** (règle « pas de clé ni d'inscription ») |
| Thunderforest (Landscape, Outdoors) | 200 mais tuile barrée « API Key Required » | clé requise : **exclu** |
| IGN SCAN 25 / TOPO 1:25 000 (`GEOGRAPHICALGRIDSYSTEMS.MAPS`) | 400 « Layer unknown » (public), 401 (`/private/wmts`) | clé requise : **exclu** |
| IGN photos 1980–1995 | 404 à Chamonix et Paris, 6/56 sur la grille z14 | couverture trop lacunaire pour l'instant |
| EOX Sentinel-2 cloudless 2017 (`s2cloudless-2017_3857`) | 200, CORS reflété, **CC BY 4.0** (seule année non NC) ; mais Europe seulement à fort zoom : PNG transparent de 116 o à Denver, Nairobi, Katmandou, quasi vide à New York | couverture difficile à borner, peu de différence visible avec 2025 à 10 m : non ajoutée (candidate si une alternative non commerciale à `eox-s2cloudless` devient nécessaire) |
| swisstopo SWISSIMAGE HIST 1946 (`ch.swisstopo.swissimage-product_1946`) | JPEG `3857_17`, Zermatt / Berne z8–z17 200, z18 400 ; Chamonix : JPEG blanc 668 o | fonctionne sans clé ; non ajoutée pour limiter le diff (équivalent suisse de « photos 1950–1965 », à ajouter si besoin) |

### Journal des requêtes (2026-10-07, Origin http://127.0.0.1:5173)

| Source | Tuile | Statut | content-type | Taille | ACAO |
|---|---|---|---|---|---|
| ign-ortho-1950-1965 | Chamonix z10 / 12 / 15 / 17 / 18 | 200 | image/png (256×256, gris) | 55 671 / 57 450 / 58 233 / 52 459 / 40 709 | `*` |
| ign-ortho-1950-1965 | Chamonix z19 | 404 | text/xml | 137 | `*` |
| ign-ortho-1950-1965 | Paris z12 / 16 / 18 | 200 | image/png | 54 670 / 60 574 / 52 624 | `*` |
| ign-ortho-1950-1965 | Genève z15 / Courmayeur z15 / Zermatt z14 | 200 / 200 / 404 | image/png | 61 311 / 58 252 / — | `*` |
| ign-ortho-1965-1980 | Chamonix z12 (STYLE=normal) | 400 | text/xml | 156 | `*` |
| ign-ortho-1965-1980 | Chamonix z12 / 15 / 17 / 18 (BDORTHOHISTORIQUE) | 200 | image/png (palette) | 61 217 / 61 163 / 64 196 / 63 485 | `*` |
| ign-ortho-1965-1980 | Paris z12 / 16 / 18 | 200 | image/png | 55 359 / 60 732 / 60 527 | `*` |
| ign-ortho-1965-1980 | Chamonix z2 / z19 | 404 / 404 | text/xml | 137 | `*` |
| ign-ortho-2000-2005 | Chamonix z5 / z6 / z12 / z15 / z17 / z18 / z19 | 404 / 200 / 200 / 200 / 200 / 200 / 404 | image/jpeg | — / 5 494 / 16 571 / 20 091 / 18 895 / 13 459 / — | `*` |
| ign-ortho-2000-2005 | Paris z12 / 16 / 18 | 200 | image/jpeg | 22 374 / 22 925 / 13 477 | `*` |
| ign-plan | Chamonix z0 / 12 / 15 / 18 / 19 / 20 | 200 ×5 / 404 | image/png (RGB) | 37 484 / 100 548 / 60 738 / 22 500 / 27 705 / — | `*` |
| ign-plan | Paris z12 / z19 ; Zermatt z12 / z13 ; NYC z10 | 200 / 200 ; 200 / 404 ; 404 | | 48 210 / 26 923 ; 48 371 | `*` |
| swisstopo-carte | Zermatt z12 / 15 / 17 / 19 / 20 | 200 ×4 / 400 | image/jpeg | 26 508 / 39 613 / 32 720 / 12 969 / 93 (JSON) | `*` |
| swisstopo-carte | Berne z19 ; Chamonix z15 / z17 / z19 ; Paris z12 | 200 ; 200 / 200 blanc / 200 blanc ; 400 | image/jpeg | 5 275 ; 35 915 / 668 / 668 ; 83 | `*` |
| opentopomap | Chamonix z12 (a, b, c) / z15 / z17 | 200 | image/png (palette) | 51 067 / 34 605 / 21 265 | `*` |
| opentopomap | Chamonix z18 | 200 | image/png (RGBA) | 4 343 « max zoom layer = 17 » | **absent** |
| opentopomap | NYC z12 / z17 | 200 | image/png | 49 182 / 5 617 | `*` |

Contrôle visuel (Chromium headless, trace d'exemple Les Houches → Les Contamines) : `ign-ortho-1950-1965`, `ign-ortho-1965-1980`, `ign-ortho-2000-2005`,
`ign-plan`, `swisstopo-carte` et `opentopomap` s'affichent drapés sur le relief, attribution correcte dans la barre d'état.

## Points d'attention pour l'intégration

1. **Mapterhorn 404 = feuille** : le zoom max réel varie de 12 à 17 selon la région. Le moteur doit traiter un 404 sur une tuile DEM
   comme « pas de raffinement possible » (garder le parent affiché) et non comme une erreur à réessayer ou une tuile « en échec » bloquante.
2. **Esri placeholder** : au-delà de z19, Esri renvoie 200 avec une image « pas de donnée » ; ne pas dépasser `maxZoom` du catalogue.
3. **EOX est NC** (CC BY-NC-SA 4.0) : à retirer ou à remplacer par une licence commerciale EOX si le produit devient payant.
4. **Esri** : conditions à relire avant distribution commerciale ou mise en cache hors ligne (phase « packs hors ligne »).
5. **swisstopo** : la boîte de couverture inclut une large bande hors Suisse où les tuiles existent jusqu'à z20 mais sont nettement plus floues ;
   à Chamonix l'imagerie existe mais est moins fine que la BD ORTHO.
6. **IGN hors métropole** : les DROM-COM ne sont pas couverts par la boîte unique `coverage` ; une couverture multi-boîtes demanderait une évolution de `TileSourceBase` (types figés).
7. **La boîte IGN sur-approxime la France** : `sourceCovers(ign, …)` renvoie `true` pour Courmayeur, Champex, Genève, Bâle ou Zermatt alors que
   le serveur y renvoie une tuile blanche (200) ou un 404. Conséquence pour `store.ts` (`pickRegionalImagery`, qui préfère IGN dès que la trace
   est dans sa boîte) : une trace transfrontalière (Tour du Mont-Blanc complet, Genevois, Jura suisse, Bâle) sera rendue avec des zones blanches.
   Recommandation : quand la trace est dans la boîte IGN **et** dans la boîte swisstopo, préférer swisstopo (vraies tuiles partout, moins fines)
   ou Esri (uniforme) plutôt qu'IGN, sauf si la trace est entièrement à l'ouest de ~5.9° E ou au nord de ~47.6° N (donc sûrement en France) ;
   ou laisser l'utilisateur basculer manuellement. `store.ts` possède sa propre copie de `boundsInside` ; `sourceCovers` peut la remplacer.
8. `sourceCovers(source, bounds | point)` (export de `sources.ts`) permet à l'UI de proposer par défaut la source d'imagerie la plus fine
   couvrant entièrement la trace ; `true` signifie « vaut la peine d'essayer », `false` « inutile ».
9. **Sources datées / cartes jamais choisies automatiquement** : `AUTO_IMAGERY_IDS` de `store.ts` ne liste que `ign-ortho` et `swisstopo` ;
   les nouvelles entrées partagent pourtant leurs boîtes de couverture, il ne faut donc pas remplacer cette liste par « toute source avec `coverage` ».
10. **`minZoom` > 0** (`ign-ortho-2000-2005` : 6, `ign-ortho-1965-1980` : 3) : les tuiles de relief plus grossières restent grises (comportement documenté d'`imagery.ts`), invisible en pratique dans un survol.
11. **OpenTopoMap** : serveur bénévole ; ne pas l'utiliser pour des téléchargements massifs (packs hors ligne, rendu vidéo pré-chargé) sans accord.
12. **CC BY-SA (OpenTopoMap)** : une vidéo exportée avec ce fond doit porter l'attribution et peut être considérée comme une adaptation (partage dans les mêmes conditions) : à signaler à l'export.

## Météo historique — Open-Meteo (2026-10-07)

Archive ERA5 / modèles régionaux réanalysés, sans clé : `https://archive-api.open-meteo.com/v1/archive`. Licence des
données **CC BY 4.0**, API gratuite pour un usage **non commercial** (≤ 10 000 requêtes/jour, 5 000/h, 600/min annoncés ;
aucun en-tête de quota renvoyé). Attribution affichée : « Données météo : Open-Meteo.com (CC BY 4.0) ». Code : `src/weather/openMeteo.ts`.

| Point vérifié | Résultat |
|---|---|
| CORS (Origin `http://127.0.0.1:5173`) | `access-control-allow-origin: *`, GET/POST/OPTIONS, `max-age` 600 |
| Variables horaires | `temperature_2m`, `apparent_temperature`, `precipitation`, `rain`, `snowfall` (cm), `cloud_cover` (+ `_low`/`_mid`/`_high`), `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, `weather_code`, `is_day` : toutes renseignées |
| `visibility` | acceptée mais **toujours `null`** dans l'archive (unité « undefined ») ; disponible seulement sur l'API prévision (`api.open-meteo.com/v1/forecast`, `past_days` ≤ 92, sans clé, CORS `*`), non utilisée |
| Fuseau | `timezone=GMT` → heures UTC ; `timeformat=unixtime` donne des secondes Unix (début de chaque heure) |
| Étendue | `start_date` de **1940-01-01** à **aujourd'hui** inclus (erreur 400 `{"error":true,"reason":"Parameter 'start_date' is out of allowed range from 1940-01-01 to <aujourd'hui>"}` au-delà) ; les derniers jours sont complets (prévisions rejouées, révisées quelques jours plus tard : on ne les met en cache persistant qu'au-delà de 7 jours). 1940 : `precipitation`, `wind_gusts_10m`, `weather_code` nuls les 7 premières heures |
| Plusieurs lieux | `latitude=a,b&longitude=c,d` → tableau JSON (objet nu pour un seul lieu) ; `elevation=e1,e2` accepté par lieu |
| Grille | ~0,07° en latitude (45,73 / 45,80 / 45,87 / 45,94 / 46,01) et ~0,1–0,14° en longitude dans les Alpes (≈ 9 km) : deux points à moins de ~5 km tombent souvent dans la même maille |
| Altitude | le paramètre `elevation` ramène la température à l'altitude demandée : à 45,85° N 6,78° E, 12,5 °C sans paramètre (maille à 2 316 m) contre 22,8 °C à 1 000 m et 10,6 °C à 2 500 m → on passe l'altitude enregistrée de la trace |
| Dates inversées | 400 `{"reason":"Bad Request"}` |
| Taille | ~2,5 ko gzip par lieu et par jour pour les 14 variables |

Journal (curl, 2026-10-07) : `start_date=end_date=2025-07-12`, 2 lieux (45,89/6,80 et 45,83/6,73) → 200, mailles 45,940/6,704 (1 021 m) et
45,870/6,693 (1 109 m) ; `2026-10-07` (jour même) → 24 heures complètes ; `2026-10-10` → 400 hors plage ; `1939-12-31` → 400 hors plage.

**Prévision** (sortie prévue, 2026-10-08) : `https://api.open-meteo.com/v1/forecast`, sans clé, mêmes conditions (CC BY 4.0, non
commercial). Mêmes paramètres que l'archive (`start_date` / `end_date`, plusieurs lieux, `elevation`, `timezone=GMT`,
`timeformat=unixtime`) et mêmes 13 variables horaires, même forme de réponse (24 heures par jour depuis 0 h UTC). Étendue :
de 92 jours en arrière à aujourd'hui + 15 jours (le 8 octobre : `2026-10-23` → 200, `2026-10-24` → 400 « out of allowed
range from 2026-07-07 to 2026-10-23 »). Gardée 3 h au plus, en mémoire seulement (la prévision change plusieurs fois par jour).

## Repères OpenStreetMap — Overpass API (2026-10-07)

Sommets, cols, refuges, lacs, cascades, lieux habités, points de vue, glaciers et points d'eau (eau potable, sources nommées ;
non mesurés à part, ajoutés après le journal ci-dessous) autour de la trace, lus dans OpenStreetMap par
l'instance publique Overpass `https://overpass-api.de/api/interpreter` (sans clé), avec repli sur `https://maps.mail.ru/osm/tools/overpass/api/interpreter`
(VK Maps, listée sur le wiki OSM sans limite annoncée). Données **ODbL** : attribution affichée « © contributeurs OpenStreetMap (ODbL) »
(panneau et barre d'état, lien vers openstreetmap.org/copyright). Code : `src/osm/overpass.ts`.

**Conditions d'usage de l'instance publique** (dev.overpass-api.de, « Commons ») : rester sous ~10 000 requêtes et ~1 Go par jour et par
adresse ; le wiki recommande cent fois moins pour une application grand public (≤ 100 requêtes, ≤ 10 Mo par jour et par utilisateur).
Limitation par IP : `/api/status` annonce « Rate limit: 2 » (deux créneaux simultanés), refus **429** quand ils sont pris, **504** quand le
serveur est surchargé (corps HTML « Dispatcher_Client::request_read_and_idx::timeout / rate_limited »). Motifs jugés abusifs : requêtes
identiques répétées, balayage de boîtes pour aspirer la planète, application de production qui s'en sert de dorsale. D'où, ici : **une seule
requête par trace** (tous les types, couloir de 3 km), envoyée seule (file d'attente), mise en cache 30 jours dans `localStorage` par
empreinte de la requête, un seul réessai après `Retry-After` (sinon 15 s) sur 429 / 504 puis l'autre instance ; changer les types ou la
distance ne refait pas de requête (filtrage local).

| Point vérifié | Résultat |
|---|---|
| CORS (Origin `http://127.0.0.1:5173`) | `Access-Control-Allow-Origin: *`, `Access-Control-Max-Age: 600` sur les réponses POST ; la **pré-vérification OPTIONS répond 406** → requête « simple » obligatoire (corps `application/x-www-form-urlencoded`, champ `data`), ce que fait `URLSearchParams` |
| User-Agent | 406 « Not Acceptable » pour un `curl` qui imite un navigateur et pour `/api/status` sans agent explicite ; les requêtes d'un vrai Chromium (headless) passent (200) |
| Forme `around:` sur une polyligne | 4 sommets, 1,5 km, 5 types → 200 en 2,9 s (14 ko) ; **50 sommets, 3,1 km, 8 types → HTTP 200 mais `remark` « Query timed out … after 80 seconds » et zéro élément** (la limite `[timeout:60]` est dépassée côté serveur ; une réponse 200 peut donc être une erreur) |
| Forme boîte englobante (retenue) | une boîte de 12 × 15 km autour de la trace d'exemple, 8 types, `out center tags qt` → 200 en 2,5 à 5,7 s, 44 ko, 175 éléments (30 sommets, 14 cols, 14 refuges, 8 lacs, 19 glaciers, 2 cascades, 3 points de vue, 84 lieux) |
| Union de 10 boîtes le long de la trace | 200 en 14 s, 33 ko, 134 éléments : plus lent que la boîte unique (80 instructions) ; utilisée seulement au-delà de 40 km d'emprise (`MAX_BOX_SPAN_M`) |
| Après ces essais rapprochés | deux requêtes suivantes → **429** (créneaux pris) ; `/api/status` les détaille |
| `maps.mail.ru` | même réponse (14 ko) en 10 à 14 s depuis `curl`, en-têtes CORS complets (`*`, `GET, POST, OPTIONS, PUT`) ; 504 une fois depuis le navigateur |
| `overpass.kumi.systems`, `overpass.private.coffee`, `overpass.osm.jp` | injoignables depuis ce réseau (délai 60 s / connexion refusée) : non retenues |
| Balises utiles | `ele` en texte libre (« 1650 », « 1969.1 » ; ailleurs « 1 653 m », « 1,653 », pieds) → `parseEle` ; `name:fr` rare en France (repli `name`) ; des sommets sans nom (ex. 2 303 m) → filtre `["name"]` dans la requête ; lacs en chemins / relations → `out center` ; le Col de Voza porte `natural=saddle` + `mountain_pass=yes`, `ele=1650` (1 653 m dans le GPX d'exemple) ; 81 hameaux à moins de 3 km de 20 km de trace → lieux désactivés par défaut |

**Plans d'eau (2026-10-08)** : une deuxième requête par trace, seulement si « Lacs et rivières reflétants » est cochée :
`way` / `relation` (multipolygones) `natural=water`, `waterway=riverbank`, `water=*` dans le couloir de la trace élargi à
**8 km**, `out geom qt` (géométrie complète). Même file d'attente, même cache 30 jours (le résultat réduit : polygones simplifiés à
4 m, au plus 300, coordonnées à 1e-6°), même politique de réessai. Mesure (curl, boîte 45,81–45,98 N × 6,66–6,90 E autour de la
trace d'exemple) : **200 en 3,7 s, 593 ko, 232 éléments** (220 chemins, 12 relations : l'Arve, le lac de Passy, des retenues,
ruisseaux et bassins) → 80 polygones gardés. La même requête envoyée par `curl` sans `User-Agent` reçoit 406.

Journal (curl, 2026-10-07) : `[out:json][timeout:60]; ( node["natural"~"^(peak|volcano|saddle)$"]["name"](45.79485,6.68680,45.91881,6.83916); … 8 instructions … ); out center tags qt;`
→ 200, 5,7 s, 44 447 octets ; même requête depuis Chromium headless (origine `http://127.0.0.1:5184`) → 200 en 3,6 s.

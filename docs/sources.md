# Sources de tuiles — vérification empirique

Date de vérification : **2026-10-05** (relecture indépendante le même jour : sondes supplémentaires aux frontières, § « Sondes frontalières »). Outils : `curl.exe` avec l'en-tête `Origin: http://127.0.0.1:5173`
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

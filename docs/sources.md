# Data sources: attributions, licenses and verification

The first section lists what the app displays and allows for each source; the rest of the document records how the
sources were checked.

## Attributions, licenses and offline use

| Source | Used for | Address | Displayed attribution |
|---|---|---|---|
| Mapterhorn | terrain (default) | `tiles.mapterhorn.com` | "© Mapterhorn (données ouvertes, liste des sources : mapterhorn.com/attribution)" |
| AWS Terrain Tiles | terrain | `s3.amazonaws.com/elevation-tiles-prod` | "Terrain Tiles (Mapzen / AWS Open Data) — SRTM, GMTED2010, ETOPO1 courtesy of USGS/NOAA, EU-DEM © Copernicus, ArcticDEM et autres sources ouvertes" |
| IGN Géoplateforme | orthophotos and Plan IGN in France, photos from 1950 to 2005 | `data.geopf.fr/wmts` | "© IGN — Géoplateforme (BD ORTHO, licence ouverte Etalab 2.0)", and variants per layer |
| swisstopo | orthophotos and national map in Switzerland | `wmts.geo.admin.ch` | "© swisstopo (SWISSIMAGE, OGD)", "© swisstopo (carte nationale, OGD)" |
| Esri World Imagery | world orthophotos (default imagery) | `services.arcgisonline.com` | "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community" |
| EOX Sentinel-2 cloudless 2025 | world satellite images, 10 m | `tiles.maps.eox.at` | "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025) — CC BY-NC-SA 4.0" |
| OpenTopoMap | world topographic map | `tile.opentopomap.org` | "Données : © contributeurs OpenStreetMap, SRTM \| Rendu : © OpenTopoMap (CC BY-SA)" |
| Open-Meteo | historical weather, forecast for an upcoming outing | `archive-api.open-meteo.com`, `api.open-meteo.com` | "Données météo : Open-Meteo.com (CC BY 4.0)" |
| OpenStreetMap (Overpass API) | landmarks, water bodies (reflective lakes and rivers), scouting paths | `overpass-api.de`, fallback `maps.mail.ru` | "© contributeurs OpenStreetMap (ODbL)" |
| OpenStreetMap (Nominatim) | place typed in "Préparer une sortie" (one search on submit, never while typing) | `nominatim.openstreetmap.org` | "© contributeurs OpenStreetMap (ODbL)" |

The status bar, at the bottom of the screen, shows the attributions of the current terrain and imagery. Those of Open-Meteo and OpenStreetMap
are added when the weather or the landmarks are loaded. The same lines are burned into exported videos and images
([README, "Licenses"](../README.md#licenses)).

The optional Strava import is not one of these sources: it reads your own activities through your own Strava
application ([user guide](user-guide.html#import)). No Strava key or account is in the code.

| Source | License | Note |
|---|---|---|
| Mapterhorn, AWS Terrain Tiles | open data (CC BY 4.0, OGL, public domain…) | credit the sources |
| IGN | Licence Ouverte Etalab 2.0 | commercial use allowed |
| swisstopo | open data (OGD) | credit the source, reasonable use |
| Esri | Esri terms | **to be reviewed** before any commercial use; offline for personal use only |
| EOX Sentinel-2 cloudless | CC BY-NC-SA 4.0 | **no commercial use** |
| OpenTopoMap | CC BY-SA | volunteer-run server: moderate use; a video made with this base map must stay under the same license |
| Open-Meteo | CC BY 4.0 | free **non-commercial** API, 10,000 requests per day max |
| OpenStreetMap | ODbL | public Overpass server: moderate use |

OpenFlyover is a personal, non-commercial project: all sources can go into an offline pack, with a lower daily limit for those that discourage bulk downloads:

| Source | Offline | Why |
|---|---|---|
| Mapterhorn | yes, 20,000 tiles per day | open data; Mapterhorn itself offers area downloads ([data access](https://mapterhorn.com/data-access)) |
| AWS Terrain Tiles | yes | AWS Open Data public archive, made to be downloaded ([registry](https://registry.opendata.aws/terrain-tiles/)) |
| IGN Géoplateforme | yes, 50,000 tiles per day (all layers) | Licence Ouverte Etalab 2.0; public service to be used sparingly |
| EOX Sentinel-2 cloudless | yes, 20,000 tiles per day | CC BY-NC-SA 4.0: copying allowed for non-commercial use ([terms](https://cloudless.eox.at/products/viewing)) |
| swisstopo | yes, personal use, 10,000 tiles / day | its terms ask to avoid automated bulk downloads ([terms](https://www.geo.admin.ch/en/general-terms-of-use-fsdi)): keep the corridor short |
| Esri World Imagery | yes, personal use, 10,000 tiles / day | Esri normally reserves offline use for its own applications ("for Export" service): keep the corridor short |
| OpenTopoMap | yes, personal use, 2,000 tiles / day | volunteer-run server that asks to avoid bulk downloads ([about](https://opentopomap.org/about)) |

A source whose terms have not been checked stays online. The daily limits
count per device.

To spare these services, the application:

- keeps the last ~600 tiles in memory and requests only those in the view;
- sends **one** weather request per track and keeps it in the browser;
- sends **one** landmark request per track, kept for 30 days, and retries only once if the server is overloaded;
- downloads an offline pack only once, 4 tiles at a time, and never requests a tile that is already stored;
- sends **one** water body request per track (lakes and rivers in an 8 km corridor), in the same queue and the same
  cache, only if reflective water is checked.

The track itself is never sent. These services receive only an approximate position: the tile area, a few
points rounded to 1 km with their dates for the weather, the rectangle around the track for the landmarks.

Verification date: **2026-10-05** (independent review the same day: extra probes at the borders, § "Border probes");
dated topographic maps and orthophotos added on **2026-10-07** (§ "Old maps and photos"). Tools: `curl.exe` with the header `Origin: http://127.0.0.1:5173`
(status, `content-type`, `access-control-allow-origin`), reading of image headers (IHDR / SOF / VP8L)
and minimal PNG decoding in Node (zlib) for the Terrarium check, providers' GetCapabilities documents.
`src/terrain/sources.ts` is the only source of truth for the code; this document justifies it.

Reference tiles (XYZ, y = 0 at the north): Chamonix (6.87, 45.92) → z12 = 2126/1458, z15 = 17009/11668,
z17 = 68037/46672, z19 = 272149/186689; Paris (2.35, 48.86) → z12 = 2074/1409, z19 = 265566/180362;
Zermatt (7.75, 46.02) → z12 = 2136/1456, z20 = 546861/372959; New York (−74.0, 40.7) → z12 = 1206/1540.

## Summary table

| id | URL template | Zooms | Tile | Encoding / format | CORS | Coverage | License | Attribution to display |
|---|---|---|---|---|---|---|---|---|
| `mapterhorn` | `https://tiles.mapterhorn.com/{z}/{x}/{y}.webp` | 0–17 (variable: 12 to 17 depending on the region) | **512 px** | Terrarium, lossless WebP (VP8L) | `*` | worldwide | open data (CC BY 4.0, OGL, public domain… 151 sources, `download.mapterhorn.com/attribution.json`); code BSD-3 | `© Mapterhorn` (tiles.json) + link `mapterhorn.com/attribution` |
| `aws-terrarium` | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | 0–15 | 256 px | Terrarium, 8-bit RGB PNG | `*` | worldwide | public sources (USGS 3DEP/SRTM/GMTED2010, NOAA ETOPO1, EU-DEM Copernicus, ArcticDEM, CC BY NZ/AT/NO/AU/UK OGL…) — see `tilezen/joerd/docs/attribution.md` | "Terrain Tiles (Mapzen / AWS Open Data) — SRTM, GMTED2010, ETOPO1 courtesy of USGS/NOAA, EU-DEM © Copernicus, ArcticDEM…" |
| `ign-ortho` | `https://data.geopf.fr/wmts?…LAYER=ORTHOIMAGERY.ORTHOPHOTOS&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg` | 0–19 (`PM_0_19`) | 256 px | JPEG | `*` | Metropolitan France + Corsica (box −5.6/41.2 → 10.0/51.3, **over-approximation**: the border strip inside the box returns a white 200 tile or a 404); z ≤ 12 available everywhere (low-resolution worldwide mosaic) | Etalab Open Licence 2.0 (BD ORTHO), terms of use `cartes.gouv.fr/cgu`, `Fees: none` | `© IGN — Géoplateforme (BD ORTHO)` |
| `swisstopo` | `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg` | 0–20 (`3857_20`) | 256 px | JPEG | `*` | box 5.140242/45.398181 → 11.47757/48.230651 (WGS84BoundingBox from the GetCapabilities); real tiles up to z20 over the whole box, but **much lower resolution outside Switzerland/Liechtenstein** | swisstopo OGD, free of charge, "fair use" (~20,000 users/day) | `© swisstopo` |
| `arcgis-world-imagery` | `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` | 0–19 (the service declares 24 LODs, z0–23; above 19, a 200 placeholder is returned where there is no imagery) | 256 px | JPEG | `*` | worldwide | Esri Master Agreement; see § Esri | `Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community` (service `copyrightText` field) |
| `eox-s2cloudless` | `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg` | 0–16 in the catalog (server: 200 up to z18 at Chamonix, 404 at z19; native ≈ z14 / 10 m) | 256 px | JPEG | reflected origin (`access-control-allow-origin: http://127.0.0.1:5173`) | worldwide | **CC BY-NC-SA 4.0** (commercial use: separate EOX license) | `EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)` |
| `ign-plan` | `https://data.geopf.fr/wmts?…LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&…&FORMAT=image/png` | 0–19 (`PM_0_19`) | 256 px | RGB PNG | `*` | France (same box as `ign-ortho`); 404 outside France from z13 | Etalab Open Licence 2.0 | `© IGN — Géoplateforme (Plan IGN)` |
| `swisstopo-carte` | `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg` | 0–19 (`3857_19`) | 256 px | JPEG | `*` | swisstopo box; outside Switzerland + border strip, **white tile** (668 B) from z16 | swisstopo OGD, "fair use" | `© swisstopo` |
| `opentopomap` | `https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png` (`{s}` = a, b, c) | 0–17 (z18: "max zoom layer = 17" image without CORS) | 256 px | palette PNG | `*` | worldwide | ODbL data (OSM) + SRTM, rendering **CC BY-SA**; volunteer-run server, no bulk downloading | `Kartendaten: © OpenStreetMap-Mitwirkende, SRTM \| Kartendarstellung: © OpenTopoMap (CC-BY-SA)` (translated in the UI) |
| `ign-ortho-2000-2005` | `…LAYER=ORTHOIMAGERY.ORTHOPHOTOS2000-2005&STYLE=normal&…&FORMAT=image/jpeg` | **6**–18 (`PM_6_18`) | 256 px | JPEG | `*` | France (IGN box); white tile of 1,651 B / 404 outside France | Etalab Open Licence 2.0 | `© IGN — Géoplateforme (BD ORTHO 2000–2005)` |
| `ign-ortho-1965-1980` | `…LAYER=ORTHOIMAGERY.ORTHOPHOTOS.1965-1980&STYLE=BDORTHOHISTORIQUE&…&FORMAT=image/png` | **3**–18 (`PM_3_18`) | 256 px | palette PNG, grayscale, black → transparent | `*` | **partial** (Alps, south, west: yes; Paris Basin, north-east: mostly no → 404) | Etalab Open Licence 2.0 | `© IGN — Géoplateforme (BD ORTHO historique 1965–1980)` |
| `ign-ortho-1950-1965` | `…LAYER=ORTHOIMAGERY.ORTHOPHOTOS.1950-1965&STYLE=normal&…&FORMAT=image/png` | 0–18 (`PM_0_18`) | 256 px | grayscale PNG | `*` | **complete** metropolitan France (the only complete historical edition); spills over onto Geneva and Courmayeur; 404 at Zermatt | Etalab Open Licence 2.0 | `© IGN — Géoplateforme (BD ORTHO historique 1950–1965)` |

All sources respond with a CORS header for the origin `http://127.0.0.1:5173`: **no Vite proxy is needed**;
`TILE_PROXIES` stays empty in `vite.config.ts`.

## Details per source

### Mapterhorn (terrain)

- `https://tiles.mapterhorn.com/tiles.json`: `{"scheme":"xyz","tiles":["https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"],"encoding":"terrarium","tileSize":512,"attribution":"<a href='https://mapterhorn.com/attribution'>© Mapterhorn</a>"}`.
  The GitHub README presents it as a drop-in replacement for the AWS Elevation Tiles (same Terrarium encoding).
- File header: `RIFF…WEBPVP8L`, 512 × 512, lossless (essential for a DEM: no compression artifacts).
- Maximum zoom **depends on the region** (best local open source):
  Chamonix 200 up to z17, 404 at z18; New York z16 OK, z17 404; Sahara (10 E, 25 N) and Everest: z12 OK, z13 404 (Copernicus 30 m).
  The catalog declares `maxZoom: 17`; a 404 at z ≥ 13 means "no finer data here".
- Licenses: 151 sources listed in `attribution.json` (e.g. BEV Austria CC BY 4.0, Latvia CC BY 4.0, Taiwan OGDL 1.0…). Code BSD-3.
- Results: z12 200 `image/webp` 158,396 B, ACAO `*`, `cache-control: public, max-age=604800`; z13–17 200; z18 404 `text/plain`.

### AWS Terrain Tiles / Tilezen (terrain)

- Public bucket `elevation-tiles-prod` (us-east-1), prefix `terrarium/`. 8-bit RGB PNG 256 × 256 (`colorType 2`), z0–15; z16 → S3 XML 404.
- Check of the Terrarium encoding `h = R·256 + G + B/256 − 32768` with a minimal PNG decoder (inflate + unfilter):
  tile z12 2126/1458, center pixel RGB (135,137,134) → **1929.5 m** (min 1022 m, max 3555 m on the tile: Chamonix valley → Aiguilles);
  tile z15 17009/11668, center pixel → **1046.3 m** (Chamonix center ≈ 1035 m). Consistent.
- CORS: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET`.
- Attribution: the registry.opendata.aws page asks for the citation "Terrain Tiles was accessed on DATE from https://registry.opendata.aws/terrain-tiles";
  the per-source credits (USGS, NOAA, Copernicus, LINZ CC BY 3.0 NZ, Kartverket CC BY 4.0, Environment Agency OGL v3, BEV CC BY 3.0 AT, Geoscience Australia CC BY 4.0, INEGI, NRCan) are in `tilezen/joerd/docs/attribution.md`.

### IGN BD ORTHO — Géoplateforme (imagery)

- GetCapabilities (`https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0`, 2.9 MB): layer `ORTHOIMAGERY.ORTHOPHOTOS`,
  title "Photographies aériennes" (aerial photographs), `Format image/jpeg`, `TileMatrixSetLink PM_0_19` with `TileMatrixLimits` from 0 to **19** (z19: rows 58856–465431, columns 0–524287).
  The `PM` TileMatrixSet itself goes up to 21 (`TileWidth 256`), but the layer stops at 19.
- Chamonix results: z12–z19 200 `image/jpeg`; z20 and z21 → 404 `text/xml`. Paris z12 and z19 200.
- Coverage: New York z12 200 (worldwide mosaic), z13/14/15/16 → 404; Zermatt z12 200, z13–19 → 404. Hence the metropolitan France `coverage` box;
  the overseas territories (DROM-COM; layer bbox −180/−80 → 180/80) are not included in the catalog's single box.
- **Border strip (review)**: inside the box but outside France, the server does not always answer 404: Courmayeur, Champex,
  Geneva and Basel receive at z13–z17 an **HTTP 200 `image/jpeg` of 1,651 B, entirely white** (md5 `cb33c7de`, identical everywhere),
  then 404 from z17–z19; Zermatt, Milan and Lugano receive 404 from z13. Basel still has a real tile at z13 (9,873 B) but white from z14 to z17.
  `imagery.ts` cannot tell this white tile from a real tile: a cross-border track rendered with IGN will have white
  (not gray) areas outside France. The French border tiles (Annecy, Menton, Mulhouse, Ouessant, Dunkerque, Bastia, Bonifacio) are real.
- CORS: `access-control-allow-origin: *` (+ `allow-credentials: true`). `Fees: none`, `AccessConstraints` → terms of use `https://cartes.gouv.fr/cgu`.
  BD ORTHO is distributed under the Etalab Open Licence 2.0 (IGN data open since 2021); credit "© IGN".

### swisstopo SWISSIMAGE (imagery)

- GetCapabilities EPSG:3857 (`https://wmts.geo.admin.ch/EPSG/3857/1.0.0/WMTSCapabilities.xml`): layer `ch.swisstopo.swissimage`,
  `Format image/jpeg`, `TileMatrixSet 3857_20`, dimension `Time = current`,
  `ResourceURL …/default/{Time}/3857/{TileMatrix}/{TileCol}/{TileRow}.jpeg` (so `{z}/{x}/{y}`),
  `WGS84BoundingBox 5.140242 45.398181 → 11.47757 48.230651`.
- Zermatt results: z12/14/16/18/19/**20** 200 `image/jpeg`; z21 → 400 JSON `Unsupported zoom level 21`.
  Chamonix z12 and z16 → 200 (inside the box, imagery present); Paris z12 → 400 JSON `Tile out of bounds`.
- Docs (`docs.geo.admin.ch`, WMTS): 256 px tiles, 3857 from z0 to 28, but only a few layers go beyond 20.
- **Outside Switzerland (review)**: the whole box returns real, distinct tiles (different md5) from z15 to z20 — Annecy, Chamonix, Courmayeur,
  Geneva, Besançon, Mulhouse, Milan, Como, Innsbruck, Bregenz, Vaduz. But outside Switzerland/Liechtenstein it is an
  upsampled mosaic, visibly blurrier (Annecy z16: swisstopo 20,568 B blurry vs IGN 21,496 B sharp; z20 sizes ≈ 3.4–5 kB outside Switzerland
  vs 11.9 kB at Zermatt). swisstopo is therefore a good **fallback** source for a cross-border track (full Tour du Mont-Blanc,
  Courmayeur and Champex included), not a detail source in France.
- Terms (`geo.admin.ch/en/general-terms-of-use-fsdi`): "The acquisition and use of data or services is free of charge, subject to the provisions on fair use";
  source credit mandatory ("© Data: swisstopo" in the viewer); mass use (bots) prohibited; ~20,000 users/day is considered fair use.
- CORS: `access-control-allow-origin: *`.

### Esri World Imagery (imagery)

- `MapServer?f=pjson`: `tileInfo` 256 × 256 JPEG, 24 LODs (z0–23), `copyrightText: "Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community"`.
- Segment order: `tile/{z}/{y}/{x}` (row before column).
- Chamonix results: z12–z19 200 with normal sizes (11–19 kB); **z20 and z21 → 200 but 2,521 B, identical md5** ("no data" placeholder).
  Zermatt z20 → real tile (10,851 B); Paris z20 → the same placeholder. New York z16 200.
  Since the server does not return 404 beyond the data, the catalog sets `maxZoom: 19` (available everywhere);
  the "crop the deepest tile" strategy in `imagery.ts` cannot detect this placeholder.
- CORS: `Access-Control-Allow-Origin: *`.
- Terms: legacy service "services.arcgisonline.com", accessible without a key. It is governed by the Esri Master Agreement
  (`esri.com/en-us/legal/terms/full-master-agreement`, summary `downloads2.esri.com/arcgisonline/docs/tou_summary.pdf`):
  attribution is mandatory (the service `copyrightText`, and "Powered by Esri" for applications); use is free for development,
  testing and non-commercial/internal use; commercial use, or use in a distributed product, in principle requires an ArcGIS account
  (the ArcGIS Location Services free tier covers 2 M basemap tiles per month) and forbids offline caching
  of tiles outside the provided mechanisms. To be reassessed before the "offline packs" phase and before any commercial distribution.

### EOX Sentinel-2 cloudless (imagery)

- `WMTSCapabilities.xml`: layers `s2cloudless-2017_3857` … `s2cloudless-2025_3857` (+ 4326 versions). **2025 is the most recent.**
  `ResourceURL template="…/s2cloudless-2025_3857/default/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.jpg"` → with `TileMatrixSet = g`
  (EPSG:900913, TileWidth 256, matrices 0–21), path `{z}/{y}/{x}`.
- Layer abstract: "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025) released under
  Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License. For commercial usage please see https://cloudless.eox.at".
  `AccessConstraints`: "Proper attribution is required for any usage…". License page: same unified attribution since June 2026;
  commercial use under the "EOX Commercial Attribution-RestrictedUse 1.2" license.
- Chamonix results: z12–z18 200 `image/jpeg` (12 kB at z14, 3 kB at z18: upsampling); z19 and z20 → 404. Paris and New York z12 200.
  The 2024 and 2025 tiles differ (md5): the 2025 layer is indeed distinct.
- The catalog sets `maxZoom: 16`: beyond the native resolution (~10 m ≈ z14), tiles add no detail.
- CORS: `access-control-allow-origin: http://127.0.0.1:5173` (reflected origin, `allow-credentials: true`).

## Request log (2026-10-05, Origin http://127.0.0.1:5173)

| Source | Tile | Status | content-type | Size | ACAO |
|---|---|---|---|---|---|
| mapterhorn | 12/2126/1458 | 200 | image/webp | 158,396 (512×512 VP8L) | `*` |
| mapterhorn | 13…17 Chamonix | 200 | image/webp | 156,556 … 79,328 | `*` |
| mapterhorn | 18/136074/93344 | 404 | text/plain | 14 | — |
| mapterhorn | NYC z16 / z17 | 200 / 404 | | | |
| mapterhorn | Sahara z12 / z13, Everest z12 / z13 | 200 / 404 | | | |
| aws-terrarium | 12/2126/1458 | 200 | image/png | 137,461 (256×256) | `*` |
| aws-terrarium | 14, 15 Chamonix | 200 | image/png | 105,948, 84,538 | `*` |
| aws-terrarium | 16/34018/23336 | 404 | application/xml | 319 | — |
| ign-ortho | 12/2126/1458 | 200 | image/jpeg | 18,072 (256×256) | `*` |
| ign-ortho | 14…19 Chamonix | 200 | image/jpeg | 18,093 … 11,007 | `*` |
| ign-ortho | 20, 21 Chamonix | 404 | text/xml | 137 | — |
| ign-ortho | Paris z12 / z19 | 200 / 200 | image/jpeg | 27,869 / 12,256 | `*` |
| ign-ortho | NYC z12 / z13–16 | 200 / 404 | | | |
| ign-ortho | Zermatt z12 / z16 | 200 / 404 | | | |
| swisstopo | 12/2136/1456 (Zermatt) | 200 | image/jpeg | 25,216 (256×256) | `*` |
| swisstopo | 12/2136/1457 | 200 | image/jpeg | 23,184 | `*` |
| swisstopo | Zermatt z14/16/18/19/20 | 200 | image/jpeg | 31,321 … 11,857 | `*` |
| swisstopo | Zermatt z21 | 400 | application/json | 93 | — |
| swisstopo | Chamonix z12 / z16 | 200 / 200 | image/jpeg | 24,364 / 24,958 | `*` |
| swisstopo | Paris z12 | 400 | application/json | 83 | — |
| arcgis-world-imagery | 12/1458/2126 | 200 | image/jpeg | 17,642 (256×256) | `*` |
| arcgis-world-imagery | 14…19 Chamonix | 200 | image/jpeg | 16,566 … 11,507 | `*` |
| arcgis-world-imagery | 20, 21 Chamonix | 200 | image/jpeg | 2,521 (identical placeholder) | `*` |
| arcgis-world-imagery | Zermatt z20 / Paris z20 | 200 / 200 | image/jpeg | 10,851 / 2,521 (placeholder) | |
| arcgis-world-imagery | Paris z19 / NYC z16 | 200 / 200 | image/jpeg | 16,632 / 8,215 | |
| eox-s2cloudless (2025) | 12/1458/2126 | 200 | image/jpeg | 21,075 (256×256) | reflected origin |
| eox-s2cloudless | 14…18 Chamonix | 200 | image/jpeg | 12,313 … 3,034 | reflected origin |
| eox-s2cloudless | 19, 20 Chamonix | 404 | | 1,225 | — |
| eox-s2cloudless | Paris z12 / NYC z12 | 200 / 200 | image/jpeg | 23,832 / 26,799 | |

### Border probes (review, 2026-10-05, z15 unless stated)

| Place (lon, lat) | ign-ortho | swisstopo |
|---|---|---|
| Chamonix (6.87, 45.92) | 200, 18,569 B (real) | 200, 24,244 B |
| Courmayeur IT (6.97, 45.79) | 200, **1,651 B white** (z13–z15); 404 at z17, z19 | 200, 26,564 B |
| Champex CH (7.10, 46.03) | 200, 1,651 B white | 200, 29,869 B |
| Zermatt CH (7.75, 46.02) | 404 (z13–z19) | 200, 32,979 B; z20 11,857 B |
| Geneva CH (6.14, 46.20) | 200, 1,651 B white (z13–z15); 404 at z17 | 200, 30,374 B |
| Basel CH (7.59, 47.56) | z13 200 9,873 B (real); z14–z17 1,651 B white; z19 404 | 200, 31,186 B |
| Annecy FR (6.13, 45.90) | 200, 23,770 B (real) | 200, 28,413 B (blurry); z20 3,388 B |
| Besançon FR (6.02, 47.24) | 200, 21,281 B | 200, 29,507 B |
| Mulhouse FR (7.34, 47.75) | 200, 23,806 B | 200, 34,601 B |
| Milan IT (9.19, 45.46) | 404 | 200, 29,199 B; z20 3,843 B |
| Lugano CH (8.95, 46.00) | 404 | 200, 25,747 B |
| Innsbruck AT (11.39, 47.27) | — (outside the box) | 200, 35,788 B; z20 5,056 B |
| Bregenz AT / Vaduz LI / Como IT | — | 200 (24–31 kB) |
| Menton, Bastia, Bonifacio, Ouessant, Dunkerque (FR) | 200, 12–23 kB (real) | — |

## Old maps and photos (2026-10-07)

Same protocol (`curl` with `Origin: http://127.0.0.1:5173`, reading of PNG/JPEG headers, Pillow for transparent or white pixels),
Géoplateforme GetCapabilities (`https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities&VERSION=1.0.0`) and swisstopo GetCapabilities (EPSG:3857).
Second control region: Paris (IGN), Zermatt and Bern (swisstopo), New York (OpenTopoMap, Plan IGN). Coverage sampling:
grid of 56 points (7 longitudes −1.5 → 7.0 × 8 latitudes 43.3 → 50.3) at z14.

### IGN — dated orthophotos

- Public layers without a key in the GetCapabilities: `ORTHOIMAGERY.ORTHOPHOTOS.1950-1965`, `.1965-1980`, `.1980-1995`,
  `ORTHOIMAGERY.ORTHOPHOTOS2000-2005`, `2006-2010`, `2011-2015`, `2016-2020`, `2021-2023`, as well as yearly editions (`ORTHOPHOTOS2000` … `2024`),
  the IRC (infrared) coverages, yearly Pléiades / SPOT, and local `EDUGEO` extents (cities, years 1950–1990). `IGNF_BD-ORTHO-HISTO` metadata:
  "Licence Ouverte / Open License", and "Seul un millésime (1950-1965) en niveaux de gris est aujourd'hui complet sur le territoire. D'autres sont en cours de constitution." (Only one edition, 1950–1965 in grayscale, is complete over the territory today. Others are being built.)
- **1950–1965**: `Format image/png`, `PM_0_18`, styles `BDORTHOHISTORIQUE` (default, "black rendered transparent") and `normal`; the catalog uses `normal`
  (opaque grayscale PNG, `colorType 0`). Chamonix z10–z18 200 (40–58 kB), z19 404; Paris z12/z16/z18 200. z14 grid: 48/56 at 200
  (the 404s and 141 B tiles are at sea or in Germany / Switzerland). Real photos at Geneva and Courmayeur (z15), 404 at Zermatt. No transparency and no black pixel
  on the Alpine tiles tested. z0 and z3 served (low-resolution mosaic).
- **1965–1980**: only the `BDORTHOHISTORIQUE` style exists (`STYLE=normal` → **400** "Style normal unknown"). Grayscale palette PNG, `PM_3_18`
  (z2 → 404). Chamonix z12–z18 200, z19 404; Paris z12/z16/z18 200. z14 grid: **39/56** (gaps in the Paris Basin, Champagne, Lorraine).
  Over the extent of the sample track (49 z14 tiles): full coverage except the Mont Blanc massif (1 tile 404, 2 partial); the black rendered
  transparent shows the neutral gray of `imagery.ts`. Hence the label "(France, partiel)" (France, partial).
- **1980–1995**: same format as 1965–1980, but 404 at Chamonix and Paris, 6/56 on the grid (Brittany / Normandy only): **not kept**.
- **2000–2005** (and 2006–2010, same structure): `Format image/jpeg`, style `normal`, `PM_6_18`: z5 → 404, z6 200, Chamonix z12–z18 200 (13–20 kB), z19 404;
  Paris z12/z16/z18 200. z14 grid: 48/56, same gaps as BD ORTHO (sea) and **same white 1,651 B tile** outside France (Courmayeur, Geneva).
  Only 2000–2005 is added (midpoint between the 1950s and today); 2006–2010, 2011–2015, 2016–2020, 2021–2023 and the yearly
  editions work the same way and can be added identically.
- CORS `*`, `Fees: none`, terms of use `cartes.gouv.fr/cgu`, as for `ign-ortho`.

### Plan IGN v2

- Layer `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`, "Plan IGN", style `normal`, `Format image/png`, `PM_0_19` (z19 limits: rows 858–523429).
  `IGNF_PLAN-IGN` metadata: "Licence Ouverte / Open License".
- Chamonix z0/z5/z12/z15/z17/z18/z19 200 (RGB PNG 22–100 kB), z20 404; Paris z12/z19 200. Zermatt z12 200, then 404 from z13 to z17;
  Courmayeur z13/z15 200 (border margin), z17 404; New York 404 from z10. z14 grid: 48/56. → France `coverage` box.
- The **SCAN 25 / TOPO 1:25,000** map is not public: `GEOGRAPHICALGRIDSYSTEMS.MAPS` → 400 "Layer unknown" on `/wmts`,
  401 on `/private/wmts` (key required) — **excluded**.

### swisstopo — national map

- Layer `ch.swisstopo.pixelkarte-farbe` "Landeskarten (farbig)" (national maps, color), `image/jpeg`, `3857_19`, `Time = current`, same `WGS84BoundingBox` as SWISSIMAGE.
- Zermatt z6/z12/z15/z17/z18/z19 200 (13–40 kB), z20 → 400 JSON; Bern z12/z19 200; Paris z12 → 400 "Tile out of bounds".
- Chamonix: z12 and z15 = real map (the Swiss map spills over onto the Chamonix valley), **z17 and z19 = white JPEG of 668 B** (z16 too).
  Good source for Switzerland, not for France beyond z15.
- Same terms as SWISSIMAGE (OGD, free of charge, fair use, credit "© swisstopo").

### OpenTopoMap

- `https://{a|b|c}.tile.opentopomap.org/{z}/{x}/{y}.png` (path given on `opentopomap.org/about`). The three subdomains return the same tile (identical md5).
- Chamonix z0/z3/z12/z15/z17 200 (palette PNG 21–51 kB); **z18 → 200 with a "max zoom layer = 17" image (4,343 B) without a CORS header**:
  the catalog stops at 17. New York z12/z17 200. CORS `*`, `cache-control: max-age=604800`.
- Terms (`opentopomap.org/about`, "Verwendung" (usage) section and FAQ): map under **CC-BY-SA**, "kostenlos und frei verwendet" (used free of charge and freely) with the attribution
  "Kartendaten: © OpenStreetMap-Mitwirkende, SRTM | Kartendarstellung: © OpenTopoMap (CC-BY-SA)"; embedding in a website or an application
  "jederzeit gerne möglich, sofern unser Server z.B. durch Massendownloads nicht zu stark beansprucht wird" (welcome at any time, as long as our server is not overloaded, e.g. by mass downloads), with no availability guarantee;
  since 2026-01-05 the rendering runs on a smaller vServer. → **kept for interactive use**, but to be **excluded from future offline packs**
  and from bulk video renders (pre-downloading a whole track at z17).

### Sources examined and not kept

| Source | Finding (2026-10-07) | Reason |
|---|---|---|
| Stadia Maps (Stamen Watercolor, Stamen Terrain) | `tiles.stadiamaps.com/tiles/stamen_watercolor/…`: 200 with `Origin: http://127.0.0.1:5173` (Stadia's "localhost" tolerance), **401** without an Origin header | account / API key required outside local development: **excluded** ("no key, no sign-up" rule) |
| Thunderforest (Landscape, Outdoors) | 200 but tile crossed out "API Key Required" | key required: **excluded** |
| IGN SCAN 25 / TOPO 1:25,000 (`GEOGRAPHICALGRIDSYSTEMS.MAPS`) | 400 "Layer unknown" (public), 401 (`/private/wmts`) | key required: **excluded** |
| IGN photos 1980–1995 | 404 at Chamonix and Paris, 6/56 on the z14 grid | coverage too patchy for now |
| EOX Sentinel-2 cloudless 2017 (`s2cloudless-2017_3857`) | 200, reflected CORS, **CC BY 4.0** (the only non-NC year); but Europe only at high zoom: transparent 116 B PNG at Denver, Nairobi, Kathmandu, almost empty at New York | coverage hard to bound, little visible difference from 2025 at 10 m: not added (candidate if a non-commercial alternative to `eox-s2cloudless` becomes necessary) |
| swisstopo SWISSIMAGE HIST 1946 (`ch.swisstopo.swissimage-product_1946`) | JPEG `3857_17`, Zermatt / Bern z8–z17 200, z18 400; Chamonix: white JPEG of 668 B | works without a key; not added to keep the diff small (Swiss equivalent of "photos 1950–1965", to add if needed) |

### Request log (2026-10-07, Origin http://127.0.0.1:5173)

| Source | Tile | Status | content-type | Size | ACAO |
|---|---|---|---|---|---|
| ign-ortho-1950-1965 | Chamonix z10 / 12 / 15 / 17 / 18 | 200 | image/png (256×256, gray) | 55,671 / 57,450 / 58,233 / 52,459 / 40,709 | `*` |
| ign-ortho-1950-1965 | Chamonix z19 | 404 | text/xml | 137 | `*` |
| ign-ortho-1950-1965 | Paris z12 / 16 / 18 | 200 | image/png | 54,670 / 60,574 / 52,624 | `*` |
| ign-ortho-1950-1965 | Geneva z15 / Courmayeur z15 / Zermatt z14 | 200 / 200 / 404 | image/png | 61,311 / 58,252 / — | `*` |
| ign-ortho-1965-1980 | Chamonix z12 (STYLE=normal) | 400 | text/xml | 156 | `*` |
| ign-ortho-1965-1980 | Chamonix z12 / 15 / 17 / 18 (BDORTHOHISTORIQUE) | 200 | image/png (palette) | 61,217 / 61,163 / 64,196 / 63,485 | `*` |
| ign-ortho-1965-1980 | Paris z12 / 16 / 18 | 200 | image/png | 55,359 / 60,732 / 60,527 | `*` |
| ign-ortho-1965-1980 | Chamonix z2 / z19 | 404 / 404 | text/xml | 137 | `*` |
| ign-ortho-2000-2005 | Chamonix z5 / z6 / z12 / z15 / z17 / z18 / z19 | 404 / 200 / 200 / 200 / 200 / 200 / 404 | image/jpeg | — / 5,494 / 16,571 / 20,091 / 18,895 / 13,459 / — | `*` |
| ign-ortho-2000-2005 | Paris z12 / 16 / 18 | 200 | image/jpeg | 22,374 / 22,925 / 13,477 | `*` |
| ign-plan | Chamonix z0 / 12 / 15 / 18 / 19 / 20 | 200 ×5 / 404 | image/png (RGB) | 37,484 / 100,548 / 60,738 / 22,500 / 27,705 / — | `*` |
| ign-plan | Paris z12 / z19; Zermatt z12 / z13; NYC z10 | 200 / 200; 200 / 404; 404 | | 48,210 / 26,923; 48,371 | `*` |
| swisstopo-carte | Zermatt z12 / 15 / 17 / 19 / 20 | 200 ×4 / 400 | image/jpeg | 26,508 / 39,613 / 32,720 / 12,969 / 93 (JSON) | `*` |
| swisstopo-carte | Bern z19; Chamonix z15 / z17 / z19; Paris z12 | 200; 200 / 200 white / 200 white; 400 | image/jpeg | 5,275; 35,915 / 668 / 668; 83 | `*` |
| opentopomap | Chamonix z12 (a, b, c) / z15 / z17 | 200 | image/png (palette) | 51,067 / 34,605 / 21,265 | `*` |
| opentopomap | Chamonix z18 | 200 | image/png (RGBA) | 4,343 "max zoom layer = 17" | **missing** |
| opentopomap | NYC z12 / z17 | 200 | image/png | 49,182 / 5,617 | `*` |

Visual check (headless Chromium, sample track Les Houches → Les Contamines): `ign-ortho-1950-1965`, `ign-ortho-1965-1980`, `ign-ortho-2000-2005`,
`ign-plan`, `swisstopo-carte` and `opentopomap` display draped over the terrain, with the correct attribution in the status bar.

## Integration notes

1. **Mapterhorn 404 = leaf**: the real max zoom varies from 12 to 17 depending on the region. The engine must treat a 404 on a DEM tile
   as "no refinement possible" (keep the parent displayed), not as an error to retry or a blocking "failed" tile.
2. **Esri placeholder**: beyond z19, Esri returns 200 with a "no data" image; do not exceed the catalog `maxZoom`.
3. **EOX is NC** (CC BY-NC-SA 4.0): to be removed, or replaced by a commercial EOX license, if the product becomes paid.
4. **Esri**: terms to be reread before commercial distribution or offline caching ("offline packs" phase).
5. **swisstopo**: the coverage box includes a wide strip outside Switzerland where tiles exist up to z20 but are much blurrier;
   at Chamonix the imagery exists but is less detailed than BD ORTHO.
6. **IGN outside metropolitan France**: the overseas territories (DROM-COM) are not covered by the single `coverage` box; multi-box coverage would require a change to `TileSourceBase` (frozen types).
7. **The IGN box over-approximates France**: `sourceCovers(ign, …)` returns `true` for Courmayeur, Champex, Geneva, Basel or Zermatt, whereas
   the server returns a white tile (200) or a 404 there. Consequence for `store.ts` (`pickRegionalImagery`, which prefers IGN as soon as the track
   is inside its box): a cross-border track (full Tour du Mont-Blanc, Genevois, Swiss Jura, Basel) will be rendered with white areas.
   Recommendation: when the track is inside the IGN box **and** inside the swisstopo box, prefer swisstopo (real tiles everywhere, less detailed)
   or Esri (uniform) over IGN, unless the track is entirely west of ~5.9° E or north of ~47.6° N (so surely in France);
   or let the user switch manually.
8. `sourceCovers(source, bounds | point)` (exported from `sources.ts`) lets the UI propose by default the most detailed imagery source
   that fully covers the track; `true` means "worth trying", `false` "pointless".
9. **Dated sources / maps are never chosen automatically**: `AUTO_IMAGERY_IDS` in `store.ts` lists only `ign-ortho` and `swisstopo`;
   the new entries share their coverage boxes, so this list must not be replaced by "any source with `coverage`".
10. **`minZoom` > 0** (`ign-ortho-2000-2005`: 6, `ign-ortho-1965-1980`: 3): coarser terrain tiles stay gray (documented behavior of `imagery.ts`), invisible in practice during a flyover.
11. **OpenTopoMap**: volunteer-run server; no bulk downloading. Offline packs allow it for personal use only, with a warning and a cap of 2,000 tiles per day (`src/offline/policy.ts`).
12. **CC BY-SA (OpenTopoMap)**: a video exported with this basemap must carry the attribution and may be considered an adaptation (share-alike): to be flagged at export.

## Historical weather — Open-Meteo (2026-10-07)

ERA5 archive / reanalyzed regional models, without a key: `https://archive-api.open-meteo.com/v1/archive`. Data
license **CC BY 4.0**, API free for **non-commercial** use (stated limits: ≤ 10,000 requests/day, 5,000/h, 600/min;
no quota header returned). Displayed attribution: "Données météo : Open-Meteo.com (CC BY 4.0)" (weather data). Code: `src/weather/openMeteo.ts`.

| Item checked | Result |
|---|---|
| CORS (Origin `http://127.0.0.1:5173`) | `access-control-allow-origin: *`, GET/POST/OPTIONS, `max-age` 600 |
| Hourly variables | `temperature_2m`, `apparent_temperature`, `precipitation`, `rain`, `snowfall` (cm), `cloud_cover` (+ `_low`/`_mid`/`_high`), `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, `weather_code`, `is_day`: all filled in |
| `visibility` | accepted but **always `null`** in the archive (unit "undefined"); available only on the forecast API (`api.open-meteo.com/v1/forecast`, `past_days` ≤ 92, no key, CORS `*`), not used |
| Time zone | `timezone=GMT` → UTC hours; `timeformat=unixtime` gives Unix seconds (start of each hour) |
| Range | `start_date` from **1940-01-01** to **today** inclusive (error 400 `{"error":true,"reason":"Parameter 'start_date' is out of allowed range from 1940-01-01 to <today>"}` beyond); the last days are complete (replayed forecasts, revised a few days later: they are only cached persistently after 7 days). 1940: `precipitation`, `wind_gusts_10m`, `weather_code` null for the first 7 hours |
| Several places | `latitude=a,b&longitude=c,d` → JSON array (bare object for a single place); `elevation=e1,e2` accepted per place |
| Grid | ~0.07° in latitude (45.73 / 45.80 / 45.87 / 45.94 / 46.01) and ~0.1–0.14° in longitude in the Alps (≈ 9 km): two points less than ~5 km apart often fall in the same cell |
| Altitude | the `elevation` parameter adjusts the temperature to the requested altitude: at 45.85° N 6.78° E, 12.5 °C without the parameter (cell at 2,316 m) vs 22.8 °C at 1,000 m and 10.6 °C at 2,500 m → we pass the recorded altitude of the track |
| Reversed dates | 400 `{"reason":"Bad Request"}` |
| Size | ~2.5 kB gzip per place and per day for the 14 variables |

Log (curl, 2026-10-07): `start_date=end_date=2025-07-12`, 2 places (45.89/6.80 and 45.83/6.73) → 200, cells 45.940/6.704 (1,021 m) and
45.870/6.693 (1,109 m); `2026-10-07` (same day) → 24 complete hours; `2026-10-10` → 400 out of range; `1939-12-31` → 400 out of range.

**Forecast** (planned outing, 2026-10-08): `https://api.open-meteo.com/v1/forecast`, without a key, same terms (CC BY 4.0,
non-commercial). Same parameters as the archive (`start_date` / `end_date`, several places, `elevation`, `timezone=GMT`,
`timeformat=unixtime`), same 13 hourly variables and same response shape (24 hours per day from 0:00 UTC). Range: from
92 days back to today + 15 days (on 8 October: `2026-10-23` → 200, `2026-10-24` → 400 "out of allowed range from
2026-07-07 to 2026-10-23"). Kept 3 h at most, in memory only (the forecast changes several times a day).

## Typed place — Nominatim (2026-10-08)

"Préparer une sortie" (plan an outing) searches for a typed place on the public instance `https://nominatim.openstreetmap.org/search`
(`format=jsonv2`, `limit=1`, `accept-language=fr`), without a key. Usage rules noted (the official page
operations.osmfoundation.org/policies/nominatim could not be reached from the development machine; taken from the help forum
and the OSM mailing lists, not checked against the current text): at most **1 request per second** for the whole application,
identification by a Referer or a dedicated User-Agent (the browser sends the Referer), **no search-as-you-type**
(autocomplete forbidden). The code (`src/osm/geocode.ts`) only searches on submit, spaces requests by one
second and keeps the responses in memory for the session; typed coordinates ("45.92, 6.87") make no
request. ODbL data, same attribution as Overpass. To check: identification from the desktop application
(WebView), whose Referer is not that of a website.

The paths for the scouting go through Overpass (next section): one request per box snapped to a
0.02° grid around the placed points (2 km margin, 0.3° at most), `way["highway"]` without motorways, roads under construction or
private roads, `out geom qt`, response reduced to the type and to points rounded to 1e-5°, kept 30 days like the others.

## OpenStreetMap landmarks — Overpass API (2026-10-07)

Peaks, passes, huts, lakes, waterfalls, populated places, viewpoints, glaciers and water points (drinking water, named springs;
not measured separately, added after the log below) around the track, read from OpenStreetMap through
the public Overpass instance `https://overpass-api.de/api/interpreter` (no key), with fallback to `https://maps.mail.ru/osm/tools/overpass/api/interpreter`
(VK Maps, listed on the OSM wiki with no stated limit). **ODbL** data: displayed attribution "© contributeurs OpenStreetMap (ODbL)" (© OpenStreetMap contributors)
(panel and status bar, link to openstreetmap.org/copyright). Code: `src/osm/overpass.ts`.

**Terms of use of the public instance** (dev.overpass-api.de, "Commons"): stay under ~10,000 requests and ~1 GB per day and per
address; the wiki recommends a hundred times less for a consumer application (≤ 100 requests, ≤ 10 MB per day and per user).
Rate limiting per IP: `/api/status` announces "Rate limit: 2" (two concurrent slots), **429** refusal when they are taken, **504** when the
server is overloaded (HTML body "Dispatcher_Client::request_read_and_idx::timeout / rate_limited"). Patterns considered abusive: repeated
identical requests, sweeping boxes to scrape the planet, a production application using it as its backbone. Hence, here: **a single
request per track** (all types, 3 km corridor), sent alone (queue), cached 30 days in `localStorage` by
request fingerprint, a single retry after `Retry-After` (otherwise 15 s) on 429 / 504, then the other instance; changing the types or the
distance does not send a new request (local filtering).

| Item checked | Result |
|---|---|
| CORS (Origin `http://127.0.0.1:5173`) | `Access-Control-Allow-Origin: *`, `Access-Control-Max-Age: 600` on POST responses; the **OPTIONS preflight answers 406** → "simple" request mandatory (body `application/x-www-form-urlencoded`, field `data`), which is what `URLSearchParams` does |
| User-Agent | 406 "Not Acceptable" for a `curl` imitating a browser and for `/api/status` without an explicit agent; requests from a real (headless) Chromium go through (200) |
| `around:` form on a polyline | 4 vertices, 1.5 km, 5 types → 200 in 2.9 s (14 kB); **50 vertices, 3.1 km, 8 types → HTTP 200 but `remark` "Query timed out … after 80 seconds" and zero elements** (the `[timeout:60]` limit is exceeded on the server side; so a 200 response can be an error) |
| Bounding box form (kept) | a 12 × 15 km box around the sample track, 8 types, `out center tags qt` → 200 in 2.5 to 5.7 s, 44 kB, 175 elements (30 peaks, 14 passes, 14 huts, 8 lakes, 19 glaciers, 2 waterfalls, 3 viewpoints, 84 places) |
| Union of 10 boxes along the track | 200 in 14 s, 33 kB, 134 elements: slower than the single box (80 statements); used only beyond a 40 km extent (`MAX_BOX_SPAN_M`) |
| After these back-to-back tests | the next two requests → **429** (slots taken); `/api/status` details them |
| `maps.mail.ru` | same response (14 kB) in 10 to 14 s from `curl`, full CORS headers (`*`, `GET, POST, OPTIONS, PUT`); 504 once from the browser |
| `overpass.kumi.systems`, `overpass.private.coffee`, `overpass.osm.jp` | unreachable from this network (60 s timeout / connection refused): not kept |
| Useful tags | `ele` as free text ("1650", "1969.1"; elsewhere "1 653 m", "1,653", feet) → `parseEle`; `name:fr` rare in France (fallback `name`); unnamed peaks (e.g. 2,303 m) → `["name"]` filter in the request; lakes as ways / relations → `out center`; the Col de Voza has `natural=saddle` + `mountain_pass=yes`, `ele=1650` (1,653 m in the sample GPX); 81 hamlets within 3 km of 20 km of track → places disabled by default |

**Water bodies (2026-10-08)**: a second request per track, only if "Lacs et rivières reflétants" (reflective lakes and rivers) is checked:
`way` / `relation` (multipolygons) `natural=water`, `waterway=riverbank`, `water=*` in the track corridor widened to
**8 km**, `out geom qt` (full geometry). Same queue, same 30-day cache (for the reduced result: polygons simplified to
4 m, at most 300, coordinates to 1e-6°), same retry policy. Measurement (curl, box 45.81–45.98 N × 6.66–6.90 E around the
sample track): **200 in 3.7 s, 593 kB, 232 elements** (220 ways, 12 relations: the Arve, the Lac de Passy, reservoirs,
streams and ponds) → 80 polygons kept. The same request sent by `curl` without a `User-Agent` receives 406.

Log (curl, 2026-10-07): `[out:json][timeout:60]; ( node["natural"~"^(peak|volcano|saddle)$"]["name"](45.79485,6.68680,45.91881,6.83916); … 8 statements … ); out center tags qt;`
→ 200, 5.7 s, 44,447 bytes; same request from headless Chromium (origin `http://127.0.0.1:5184`) → 200 in 3.6 s.

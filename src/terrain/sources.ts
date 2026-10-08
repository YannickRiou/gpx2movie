/**
 * Catalogue of open tile sources (no API key). Attribution strings MUST be shown in the UI.
 *
 * Every value below was verified empirically (HTTP status, CORS for http://127.0.0.1:5173, tile pixel
 * size read from the image header, max zoom probed around Chamonix and in a second region, capabilities
 * documents): 2026-10-05, maps and dated orthophotos 2026-10-07. Details and test log: docs/sources.md.
 * All sources send `Access-Control-Allow-Origin`, so no Vite proxy entry is needed today
 * (see TILE_PROXIES in vite.config.ts if that changes).
 */
import type { ImagerySource, LonLat, LonLatBounds, TerrainSource, TileKey, TileSourceBase } from '../core/types'

export const TERRAIN_SOURCES: TerrainSource[] = [
  {
    kind: 'terrain',
    id: 'mapterhorn',
    name: 'Mapterhorn (mondial, haute résolution)',
    // tiles.json: scheme xyz, encoding "terrarium", tileSize 512, lossless WebP (VP8L).
    urlTemplate: 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp',
    minZoom: 0,
    // Depth depends on the best open DEM available locally: z17 in the Alps (Chamonix z18 -> 404),
    // z16 around New York, z12 only where Copernicus 30 m is the best source (Sahara, Himalaya).
    // A 404 at z > 12 therefore means "no finer data here", not a transient error.
    maxZoom: 17,
    tileSize: 512,
    encoding: 'terrarium',
    attribution: '© Mapterhorn (données ouvertes, liste des sources : mapterhorn.com/attribution)',
  },
  {
    kind: 'terrain',
    id: 'aws-terrarium',
    name: 'AWS Terrain Tiles (Terrarium)',
    // Tilezen Joerd archive hosted by the AWS Open Data programme: PNG RGB 256 px, z0-15 everywhere.
    urlTemplate: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    minZoom: 0,
    maxZoom: 15,
    tileSize: 256,
    encoding: 'terrarium',
    attribution:
      'Terrain Tiles (Mapzen / AWS Open Data) — SRTM, GMTED2010, ETOPO1 courtesy of USGS/NOAA, EU-DEM © Copernicus, ArcticDEM et autres sources ouvertes',
  },
]

/** Metropolitan France + Corsica, shared by every IGN Géoplateforme layer (an over-approximation). */
const FRANCE_BOX: LonLatBounds = { west: -5.6, south: 41.2, east: 10.0, north: 51.3 }

export const IMAGERY_SOURCES: ImagerySource[] = [
  {
    kind: 'imagery',
    id: 'ign-ortho',
    name: 'IGN BD ORTHO (France)',
    // Géoplateforme WMTS, TileMatrixSet PM (= Web Mercator, 256 px). The layer is bound to PM_0_19.
    urlTemplate:
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    attribution: '© IGN — Géoplateforme (BD ORTHO, licence ouverte Etalab 2.0)',
    // Bounding box of metropolitan France + Corsica: it OVER-approximates the real coverage
    // (Italy, Switzerland, Belgium... inside the box have no data). Tiles at z <= 12 exist
    // worldwide (low-res global mosaic); from z13 the server answers either 404 or HTTP 200 with
    // a plain WHITE 1.6 KB JPEG (border strip, e.g. Courmayeur, Genève, Basel) outside France.
    // The DROM-COM are not inside this single box.
    coverage: FRANCE_BOX,
  },
  {
    kind: 'imagery',
    id: 'swisstopo',
    name: 'swisstopo SWISSIMAGE (Suisse)',
    // RESTful WMTS, TileMatrixSet 3857_20 -> z0-20, JPEG 256 px. HTTP 400 "Tile out of bounds" outside the box.
    urlTemplate: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
    minZoom: 0,
    maxZoom: 20,
    tileSize: 256,
    attribution: '© swisstopo (SWISSIMAGE, OGD)',
    // WGS84BoundingBox of the layer in the EPSG:3857 capabilities. Real tiles are served over the
    // whole box up to z20, but outside Switzerland/Liechtenstein they are a coarser upsampled
    // mosaic (Annecy, Chamonix, Milan, Innsbruck...): fine for a fallback, not for detail.
    coverage: { west: 5.140242, south: 45.398181, east: 11.47757, north: 48.230651 },
  },
  {
    kind: 'imagery',
    id: 'arcgis-world-imagery',
    name: 'Esri World Imagery (mondial)',
    // Path order is {z}/{y}/{x} (row before column). 24 LODs are advertised (z0-23) but real
    // imagery stops at z19 almost everywhere; beyond that the server returns HTTP 200 with a 2.5 KB
    // "no data" placeholder instead of 404, so the catalogue caps at 19.
    urlTemplate: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    attribution: 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
  },
  {
    kind: 'imagery',
    id: 'eox-s2cloudless',
    name: 'Sentinel-2 cloudless 2025 (EOX, mondial, 10 m)',
    // WMTS REST path: {TileMatrix}/{TileRow}/{TileCol} = {z}/{y}/{x}; TileMatrixSet "g" (EPSG:900913).
    // Native resolution is ~10 m (z14); the server upsamples up to z18 at Chamonix and answers 404 above.
    // Capped at 16: finer requests cost bandwidth without adding detail.
    urlTemplate: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg',
    minZoom: 0,
    maxZoom: 16,
    tileSize: 256,
    attribution:
      'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025) — CC BY-NC-SA 4.0',
  },
  // --- Topographic maps (verified 2026-10-07) ---
  {
    kind: 'imagery',
    id: 'ign-plan',
    name: 'IGN — carte Plan IGN (France)',
    // Same Géoplateforme WMTS as ign-ortho; PNG RGB 256 px, PM_0_19. z20 -> 404.
    urlTemplate:
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png',
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    attribution: '© IGN — Géoplateforme (Plan IGN, licence ouverte Etalab 2.0)',
    // Detailed map over France only: 404 from z13 at Zermatt, 404 everywhere around New York.
    coverage: FRANCE_BOX,
  },
  {
    kind: 'imagery',
    id: 'swisstopo-carte',
    name: 'swisstopo — carte nationale (Suisse)',
    // Layer ch.swisstopo.pixelkarte-farbe, TileMatrixSet 3857_19 -> z0-19 (z20 -> 400), JPEG 256 px.
    urlTemplate: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
    minZoom: 0,
    maxZoom: 19,
    tileSize: 256,
    attribution: '© swisstopo (carte nationale, OGD)',
    // Same box as SWISSIMAGE. Outside Switzerland plus a border strip the 1:25 000 levels (z >= 16)
    // are a plain WHITE 668 B JPEG (HTTP 200): at Chamonix the map stops at z15.
    coverage: { west: 5.140242, south: 45.398181, east: 11.47757, north: 48.230651 },
  },
  {
    kind: 'imagery',
    id: 'opentopomap',
    name: 'OpenTopoMap — carte topo (mondial)',
    // PNG 256 px, z0-17. z18 answers 200 with a "max zoom layer = 17" image and no CORS header.
    // Volunteer server: usage in apps is welcome as long as it is not overloaded (no bulk download).
    urlTemplate: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    minZoom: 0,
    maxZoom: 17,
    tileSize: 256,
    attribution: 'Données : © contributeurs OpenStreetMap, SRTM | Rendu : © OpenTopoMap (CC BY-SA)',
  },
  // --- Dated / historical orthophotos, IGN Géoplateforme (verified 2026-10-07) ---
  // Never picked automatically (see AUTO_IMAGERY_IDS in src/state/store.ts). Same France box as
  // ign-ortho, which over-approximates the real coverage (404 or blank tiles outside France).
  {
    kind: 'imagery',
    id: 'ign-ortho-2000-2005',
    name: 'IGN — photos 2000–2005 (France)',
    // JPEG 256 px, PM_6_18: 404 below z6 and at z19.
    urlTemplate:
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS2000-2005&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
    minZoom: 6,
    maxZoom: 18,
    tileSize: 256,
    attribution: '© IGN — Géoplateforme (BD ORTHO 2000–2005, licence ouverte Etalab 2.0)',
    coverage: FRANCE_BOX,
  },
  {
    kind: 'imagery',
    id: 'ign-ortho-1965-1980',
    name: 'IGN — photos 1965–1980 (France, partiel)',
    // Greyscale palette PNG, PM_3_18. Only style BDORTHOHISTORIQUE exists ("normal" -> HTTP 400);
    // it makes the no-data black transparent, so gaps show the neutral fallback grey.
    // Incomplete coverage (still being built by IGN): Alps, south and west yes, much of the
    // Paris basin and north-east no (404).
    urlTemplate:
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS.1965-1980&STYLE=BDORTHOHISTORIQUE&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png',
    minZoom: 3,
    maxZoom: 18,
    tileSize: 256,
    attribution: '© IGN — Géoplateforme (BD ORTHO historique 1965–1980, licence ouverte Etalab 2.0)',
    coverage: FRANCE_BOX,
  },
  {
    kind: 'imagery',
    id: 'ign-ortho-1950-1965',
    name: 'IGN — photos 1950–1965 (France)',
    // Greyscale PNG 256 px, PM_0_18 (z19 -> 404). The only historical vintage complete over France
    // (IGN metadata); real tiles even across the border at Geneva and Courmayeur, 404 at Zermatt.
    urlTemplate:
      'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS.1950-1965&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png',
    minZoom: 0,
    maxZoom: 18,
    tileSize: 256,
    attribution: '© IGN — Géoplateforme (BD ORTHO historique 1950–1965, licence ouverte Etalab 2.0)',
    coverage: FRANCE_BOX,
  },
]

export function getTerrainSource(id: string): TerrainSource {
  return TERRAIN_SOURCES.find((s) => s.id === id) ?? TERRAIN_SOURCES[0]
}

export function getImagerySource(id: string): ImagerySource {
  return IMAGERY_SOURCES.find((s) => s.id === id) ?? IMAGERY_SOURCES[0]
}

/**
 * Expand {z} {x} {y} {-y} {s} in the template. {-y} is the TMS row (y = 0 at the south edge).
 * {s} is chosen deterministically from the key so the same tile always maps to the same URL
 * (the fetcher de-duplicates and caches by URL).
 */
export function buildTileUrl(source: TileSourceBase, key: TileKey): string {
  // 2 ** z rather than 1 << z: the shift wraps to 32 bits (negative at z = 31).
  const flippedY = 2 ** key.z - 1 - key.y
  let url = source.urlTemplate
    .replaceAll('{z}', String(key.z))
    .replaceAll('{x}', String(key.x))
    .replaceAll('{-y}', String(flippedY))
    .replaceAll('{y}', String(key.y))
  if (source.subdomains && source.subdomains.length > 0) {
    const s = source.subdomains[(key.x + key.y) % source.subdomains.length]
    url = url.replaceAll('{s}', s)
  }
  return url
}

/**
 * True when the source's declared coverage box contains the whole `area` (a lon/lat box or a
 * single point). A source without `coverage` is worldwide. Edge-inclusive; no antimeridian handling.
 * `coverage` is a single bounding box, so it can over-approximate (IGN's box includes a strip of
 * Italy/Switzerland with no data): a `true` here means "worth trying", a `false` means "do not bother".
 */
export function sourceCovers(source: TileSourceBase, area: LonLatBounds | LonLat): boolean {
  const c = source.coverage
  if (!c) return true
  const box: LonLatBounds =
    'west' in area ? area : { west: area.lon, east: area.lon, south: area.lat, north: area.lat }
  return box.west >= c.west && box.east <= c.east && box.south >= c.south && box.north <= c.north
}

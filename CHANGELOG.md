# Changelog

Notable changes to OpenFlyover. The desktop installers of each version are on the
[Releases](https://github.com/YannickRiou/gpx2movie/releases) page (`docs/installers.md`).

## Unreleased

- **Phones and tablets**: bottom sheets, tab bar, touch gestures, installable web app (offline shell, Android share
  target, « Partager / Enregistrer »), device budget for mobile GPUs.
- **Situation shot**: « Soleil » › « Plein jour » (default) lights the region view in daylight whatever the time of
  the outing, then joins the flight's sun; « Heure du survol » and « Accéléré » (the former « Faire bouger le soleil »).
- **Timeline**: a narrow block (a 4 s stop on a phone) pressed in its middle is moved, no longer stretched by its edge.
- **OpenStreetMap**: the memory cache of Overpass results keeps the 32 most recently used, no longer every track of the session.
- **Simpler panels**: camera presets as the one choice, the style under « Plus de réglages ».
- **Simpler panels**: camera presets as the one choice (six shown, the rest under « Plus de préréglages »), the style
  under « Plus de réglages »; Strava import in the « + Ajouter » menu of the track list.

## 0.1.0 (October 2026)

First release: the website and the Windows, macOS and Linux desktop applications, from the same code, 100 % local.

- **Import**: GPX and FIT (in-house decoder; heart rate, cadence, power, temperature), several tracks at once, Strava
  activities through the user's own Strava application; planned outings without times (date, start, pace).
- **Terrain and imagery**: Mapterhorn / AWS Terrain Tiles; IGN and swisstopo orthophotos chosen automatically, Esri
  (optional) and Sentinel-2 elsewhere, topographic maps, historical IGN photos; exaggeration; lakes and rivers from
  OpenStreetMap rendered as reflecting water; offline packs along the track.
- **Flyover**: five camera styles and twelve presets, opening and closing shots including the situation shot
  (place among the areas around the track, hold then push-in, framing, moving sun), camera smoothing in space and in
  film time, pacing with slow-motion and pauses at highlights, stops with their own camera.
- **Light and weather**: physically based sky and haze with the real sun, terrain shadows, starry night; historical
  or forecast weather (Open-Meteo); volumetric clouds and a sea of clouds, volumetric or as a lit surface (« Nappe »).
- **Look**: colour grading presets; lens effects off by default: speed blur, bloom, lens flare, depth of field.
- **Landmarks and roadbook**: summits, passes, huts, lakes from OpenStreetMap; categorised climbs; 3D labels; points
  of interest; roadbook of the outing.
- **Several tracks**: ghost race with leaderboard; stages flown one after the other, each with its own colour, name,
  figures, sun and weather; chaining into a single route.
- **Timeline and overlay**: texts, photos and videos (with their sound) on a timeline, music tracks with fades;
  overlay with titles, counters, profile, mini-map, weather, logo, credits, in three styles.
- **Export**: MP4 or WebM up to 4K and 60 fps in five aspect ratios, still image, overlay alone with transparency,
  several formats in one go, poster (A4, A3, square, 300 dpi); on the desktop, one film per track of a folder and a
  command line, hardware H.264 encoder on Linux (NVENC, VAAPI) with a software fallback.
- **Projects**: project files, undo / redo, presets, « Mes projets » with thumbnails; projects of earlier formats
  still open.
- **Quality**: French interface with tips, error messages in French, error screen, WebGL loss handled; about 1,600
  unit tests, end-to-end tests in a real browser, coverage badge; third-party notices shipped with the installers.

Known limits are listed in `docs/handover.md` ("Limits and open points") and the checks that need a GPU in
`docs/tests-gpu.md`.

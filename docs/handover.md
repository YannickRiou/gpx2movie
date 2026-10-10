# Project state and handover

Updated 9 October 2026. This file is enough to resume work without the conversation history: read this file first,
then run `git status` and `npm run typecheck`.

## Branches, PRs, repository

- `master`: everything merged (PRs #1 to #11; #8 on 8 October 2026: small follow-ups, on-demand rendering, sweep,
  slow-motion on the beat, per-element styles and framing, command-line rendering, reconnaissance, technical docs;
  #9 on 8 October 2026: full project review and fixes; #10 on 9 October 2026: technical debt, small and medium
  roadmap features, documentation in English; #11 on 9 October 2026: end of the roadmap).
- History rewritten on 9 October 2026 (every branch): all commits authored by Yannick Riou
  (`59170639+YannickRiou@users.noreply.github.com`), messages in English. Old clones: `git fetch` then
  `git reset --hard origin/<branch>`. New commits: same identity, English messages.
- PR #12 (9 October 2026): review fixes, simplifications, knowledge base, `lot-suites` merge, Windows build fix
  (`safeZoneLayout.ts`); the "Desktop installers" workflow then passed on master for the three systems.
- `ai-dev/confident-darwin-83rxik` (cloud session, after PR #12): slider and helper simplifications, concise README and
  user guide (`docs/user-guide.html`, `docs/deploying.md`, `docs/roadmap.md`), and the features ported from the old
  branch chain (see "Work in progress").
- Old branch chain `landmarks-hide` → `track-style` → `ui-polish` → `timeline-polish` → `export-stream` →
  `timeline-videos` → `water` (7 October 2026): most of it reached master through other commits; what was missing
  (landmark hiding, point smoothing, texts and media attached to a stop, timeline edge scrolling, remembered folds)
  was ported on 9 October 2026. These branches and `lot-suites` can be deleted once this branch is merged.
- `lot-suites` (the user's batch after PR #7, pushed, no PR of its own): route scouting with planned times, forecast
  weather and a roadbook; opening / closing transitions (continuous, cut, fade to black or white); saving on close;
  shared helpers; and two work items left unfinished there (locator map from very high up with the region
  highlighted, Strava import; see "Work merged from `lot-suites`"). **Merged into this branch** (`merge-lot-suites`,
  started from `ai-dev/confident-darwin-83rxik`) on 9 October 2026, its documentation translated to English during the
  merge. The GitHub CI (`ci.yml`) runs on pull requests and on master (Rust tests only when `src-tauri/` changed).
- Method: one branch per batch, one PR with a manual test procedure, merge (`gh pr merge N --merge`), then a new
  branch from `origin/master`.
- **Push**: just `git push`. The `origin` remote is `git@github-yannickriou:YannickRiou/gpx2movie.git`, an SSH alias
  defined in `~/.ssh/config` (dedicated key `~/.ssh/id_ed25519_yannickriou`, registered on the personal account
  `YannickRiou`). Do not go back to `git@github.com`: this address authenticates the `yriouvortex` account, which has no
  rights here, and the HTTPS push with the `gh` token returned "Internal Server Error". `~/.gitconfig` still contains a
  plain-text personal access token of the `yriouvortex` account (`url.*.insteadOf` rule): the user must revoke and remove it.

## Cloud session (branch `ai-dev/confident-darwin-83rxik`)

- Startup hook `.claude/hooks/session-start.sh` (declared in `.claude/settings.json`, cloud sessions only):
  Node v24.21.0 (SHA-256 checksum verified) in `/opt/node-v24.21.0`, put first in the PATH; `npm install` (the npm of
  Node 24 leaves `package-lock.json` untouched; the one of Node 22 rewrites it); `OPENFLYOVER_CHROME` on the headless shell
  in `/opt/pw-browsers`; `LANG=C.UTF-8` (without a UTF-8 locale, Chromium names a download with an accented name
  "download"); Tauri Linux libraries via `apt-get` (WebKitGTK 4.1…). ~25 s the first time, < 1 s afterwards.
- Here, `cargo test` runs in `src-tauri/` (Ubuntu 24.04, 2 min for the first build): 9 tests pass.
- Network: the environment policy blocks tile hosts (`tiles.mapterhorn.com`, `tile.openstreetmap.org`…,
  403 from the proxy). `npm run e2e` with `OPENFLYOVER_E2E_SKIP_EXPORT=1`: 5/5 in ~20 s.

## Environment and method (WSL)

- Node 24 via nvm: `source ~/.nvm/nvm.sh && nvm use 24` before `npm …`.
- Checks: `npm run typecheck`, `npm run lint` (0 errors; about forty pre-existing React warnings, mostly in `src/scene`),
  `npx vitest run --maxWorkers=1` (current figures: "Work in progress"), `npm run build`.
- End-to-end tests: `npm run e2e` (`e2e/run.mjs`, puppeteer-core, Playwright's Chromium or `OPENFLYOVER_CHROME`,
  SwiftShader, Vite server started by the script without file watching). 5 scenarios: home screen and sample, tabs
  and help, T / Ctrl+Z / S, project saved then reopened, 320 × 180 export + still image. 7 to 8 min here (export
  5 to 6 min, clouds off); `OPENFLYOVER_E2E_SKIP_EXPORT=1`: under 1 min 30. Fails on any console error except network
  noise. Only one browser at a time on this machine.
- Checking the desktop app's Rust (Linux impossible here, Ubuntu 20.04 without webkit2gtk-4.1):
  `rustup target add x86_64-pc-windows-msvc`, then `RC_x86_64_pc_windows_msvc=<fake windres> cargo check -j 1 --target
  x86_64-pc-windows-msvc` in `src-tauri/`. The fake `windres` is an executable script named `windres` that answers `-V`
  with a line containing "GNU windres" and, otherwise, writes an empty file to the requested output (`-o`). `cargo test` does
  not run here.
- Dev server used for screenshots: `npm run dev -- --port 5190` (restart it).
- Visual check without a screen: headless Chromium (`~/.cache/ms-playwright/chromium_headless_shell-1223/…`) driven by
  puppeteer-core (`~/.npm/_npx/e0b87bb3fb84adaa/node_modules/puppeteer-core`), SwiftShader software GPU: 20–40 s per
  screenshot, **only one browser at a time**. Generic script to recreate in the session temporary directory: loads
  `http://127.0.0.1:<port>/`, clicks "Essayer avec l'exemple" ("Try with the sample"), runs steps (`click` by button text,
  `check` by label, `eval` JS, `shot`), viewport via `W`/`H`.
- **Do not measure export speed on this machine any more** (user decision, software GPU): the user measures it
  on a machine with a GPU. At the end of an export, the console shows `[export] N images … rendu … attente … encodage …`.
- Sub-agents: git strictly forbidden (two ran `git stash` / `pop` despite the instruction, with no loss found).
- Neutral commit messages, with no trailer or signature; nothing in the code or docs about the development tools. "Carte alpine" theme (`src/ui/theme.css`),
  not the Vortex theme. Code license: MIT (`LICENSE`).

## Decisions made by the user (do not ask again)

- Personal use, low traffic; hosting not decided (local exe, personal server or OVH-like). Two targets to keep
  working: static site and Tauri desktop app (phase 6). No API key, open sources only.
- Timeline like video editing software: the base is the flyover of the GPX; separate tracks for stops, texts, photos (videos
  later); film edited automatically on load, then adjusted. Presets without stops / texts / media.
- Interface "hyper-ergonomic like recent interfaces": MapDirector is an inspiration, not a model.
  Lucide icons (ISC, bundled), dark frame (ink) around the view with light panels (paper), tabs
  Trace · Carte · Survol · Habillage · Projet (Track · Map · Flyover · Overlays · Project), export from the top bar.
- README written simply, short sentences, each thing said once.

## Done and merged

See `git log` and PRs #1 to #7 (waves 3 and 4: overview map, points of interest, chained tracks, slow-motion and
titles at landmarks, sync to music, multi-track poster and flat map, one film per track in a folder,
"Mes projets" ("My projects"), native Linux encoder, installers); technical details in `ARCHITECTURE.md`, features in `README.md`, usage in `docs/user-guide.html`.

## Work in progress (branch `ai-dev/confident-darwin-83rxik`): review, simplification, knowledge base

Checked: typecheck, lint (0 errors), `npx vitest run --maxWorkers=1` (105 files, 1,588 tests, `lot-suites` and the ported
features included), `npm run build`,
`cargo test` (12). Screen check of the five tabs and the phone layout in Chromium without a GPU: no console error.

- **Review fixes**: held export frames re-rendered when the scene moves with time (animated figurine, clouds, water);
  settings panel and inspector `inert` during an export, batch cancel from the top bar; overlay element tabs as
  pressed buttons; unique "Générique" field id; `exposureEv` only in the camera-shot preset family; image pickers
  patch the current settings; path and climb caches keyed by the points (recolouring keeps them); track lines flush
  their pending re-drape before an export frame; manual haze measured from the ground on untimed tracks; Latin
  Extended font files loaded for the overlay; weather cache refreshes the last use; a photo with a bad position keeps
  its picture; ffmpeg's error output drained in a thread (a full pipe could block frame writes and cancel).
- **Simplifications**: `core/guards.ts` (`isRecord`, `inRange`, `oneOf`, `withDefaults`), `DEFAULT_LABELS`,
  `formatPercent`, `formatSecondsShort`; test-only `assembleFilm`, `TileNode.depth` and the `usePacing` alias removed.
- **Knowledge base**: `docs/how-it-works.html` rewritten for readers who do not know web development.
- **Second simplification pass**: `RangeField` (optional ⓘ tip and spoken value) for the settings sliders;
  `cumulativeDistances` in `geo/lonLat`; shared `createCanvas` / `createAbortError` for DEM and imagery; terrain area
  margins in `terrain/engine`; one `CAMERA_FOV_DEG`; `Fold` merged into `PanelSection`.
- **Ported from the old branch chain**: landmark hiding (`settings.landmarks.hiddenIds`, eye button in "Repères",
  also left out of the roadbook), point smoothing (`trackStyle.smoothingM`, recorded distances kept; ghost racers follow
  their smoothed lines; labels, picking, mini-map and poster keep the recorded points), texts and media attached to a
  stop (`stopId`, `followStops`, also on landmark-title, duration and pacing changes through `setLandmarkTitles` and
  `setFlightTiming`, on the "Par défaut" of "Durée et rythme" and on landmarks published again; see the last bullet),
  timeline edge scrolling (`edgeScrollSpeed`), fold state remembered per section title (`FOLDS_KEY`).
- **FIT `hr` messages**: the in-house decoder reads them again (chest strap heart rate written in bursts, swim and
  some multisport files: `event_timestamp` and packed 12-bit `event_timestamp_12`, `filtered_bpm`); a record without
  heart rate takes the bpm of the nearest sample within 2 s, records with heart rate keep theirs.
- **Leftovers closed** (9 October 2026, after the region highlight): a shot switched to "Depuis la région" with its
  default duration gets 9 s (`SITUATION_DURATION_S`, `updateShot`); the video export holds the region it started with
  (`holdRegion`: a region arriving mid-export waits for the end, none if it was still loading); attached items follow
  their stop on the "Durée et rythme" reset (same undo step, `followFlightTiming`) and when the first track's landmarks
  are published again (`followLandmarks`, no undo step; the first landmarks of a track move nothing, since landmarks
  are not saved and the film was saved with the times they gave); the free camera is lifted above the terrain when
  tiles or the exaggeration change under it while it sits still. Not seen on screen.
- **Thumbnails in "Mes projets"**: each write keeps a ~10 KB JPEG of the 3D view in the entry (`scene/thumbnail.ts`),
  older entries show an empty frame. Seen in headless Chromium (software GPU), not on a GPU nor in the desktop app.
- **Linux desktop export on the GPU**: MP4 encoded with `h264_nvenc`, else `h264_vaapi`, else `libx264`, chosen by a
  real ffmpeg probe once per run (`video.rs`); not tried on a GPU.
- **T with a stop selected**: the new text is attached to that stop (`addText` with the stop, one undo step).
- **Overlay-only export on the Linux desktop**: WebM / VP9 with alpha through ffmpeg (`yuva420p`), like the web;
  alpha checked with ffprobe and a decoded frame in the container, not tried in an editor (`docs/tests-gpu.md`).
- **UI pass before v0.1.0** (10 October 2026): "Carte alpine" tokens refined (`theme.css`: semantic roles, accent scale,
  attention / ok / error status colours, 3:1 control borders, two shadow levels, raised ink for menus and toasts; every
  text pair measured ≥ 4.5:1 in headless Chromium), selections in accent tint instead of ink slabs, white-pill
  segmented controls, neutral play button, tab labels under the rail icons; "Carte": "Atmosphère et météo" before
  "Lumière"; "Survol": "Transitions" under "Plus de réglages". Seen in headless Chromium (grey terrain), not on a GPU.
- **Camera smoothness on long tracks** (10 October 2026): measured with `cameraSmoothness.test.ts` (540 km raid-like
  track in 4 min 30 s, the sample in 60 s); heading averaged at the film's ground speed on unwrapped chord directions,
  corners of the line rounded over 0.5 s, aim height over at least 0.25 s of track with a B-spline grid; not seen on a GPU.
- **Left for later** (proposed, not done): the inspector's text field and « Taille » slider could use the shared
  `TextField` (`PanelSection.tsx`) and the overlay's size field (its « Position » is a 3 × 3 grid, the overlay's a
  list: kept apart), `diffEngineOptions` in `TerrainLayer` (used and tested, kept). Declined by the user: "Texte libre" drawn
  like a timeline text.

## Work merged from `lot-suites`

State at the last `lot-suites` commit (8 October 2026, evening): typecheck, lint (0 errors), build and `cargo check
--target x86_64-pc-windows-msvc` OK; vitest: 2 tests failing out of 1,487 (`src/flyover/filmCamera.test.ts`, "region
view": they still asserted the old distances). In the merge, these two tests follow the new region view (55–165 km,
eased dive) and the full suite passes: 1,539 tests in 96 files, `cargo test --locked` included (plugins oauth and
opener). Nothing from this batch has been seen in a browser.

Done (tests green, never seen on screen):

- **Planned outing, times**: `src/plan/timing.ts` (DIN 33466 for hiking, ITRA km-effort for trail running, a
  Naismith-like rule adapted to cycling, pace factor), "Prévoir la sortie" (plan the outing) in the card of a track
  without times (`TrackList.tsx`, `Track.timesEstimated`, "horaires estimés" (estimated times) chip, "Effacer les
  horaires" (clear the times)), weather from the Open-Meteo **forecast** (`api.open-meteo.com/v1/forecast`, 16 days,
  3 h memory cache; desktop CSP widened).
- **Roadbook**: `src/plan/roadbook.ts`, `src/ui/RoadbookPanel.tsx` ("Trace" tab, under "Montées et étiquettes" (climbs and labels)): steep
  sections ≥ 15 % / ≥ 25 %, key points (climbs, passes, summits, huts, water points, points of interest), km /
  elevation / D+ / time, click = playhead, "Copier" (copy), "Enregistrer (.txt)" (save as text). New landmark type
  `waterPoint` (water points, out of the film by default).
- **Shot transitions**: opening / closing "Enchaîné" (continuous, default), "Coupe" (cut), "Fondu au noir / au blanc"
  (fade to black / white, 0.3–2 s); `FilmShot.transition`, `dipS`, `transitionDipAt`, `shotWeight`. Not at stops
  (explained in `ARCHITECTURE.md`).
- **Saving on close**: desktop `onCloseRequested` (pending write, 4 s at most, then the question "Fermer sans
  enregistrer ?" (close without saving?) or "Fermer pendant l'export ?" (close during the export?)), site `pagehide` /
  `beforeunload`. When the application exits, the ffmpeg encodings in progress are stopped and their partial files
  deleted (`lib.rs`, `cancel_all` in `video.rs`).
- Shared helpers: `core/errors.ts` (`errorMessage`), `clamp` from `core/math.ts` everywhere.

- **Region highlight** (was "Interrupted 1", finished on 9 October 2026; the user's reference: MapDirector's
  "Valais/Wallis" view): shot inspector "Hauteur de départ" / "Hauteur de fin" and "Mettre en avant la région"
  (`FilmShot.highlight`, off by default), `syncRegion` called by `src/scene/RegionHighlight.tsx` only while a shot
  highlights the region, darkened outside, glowing border, name, orange dot, fading out during the dive
  (`regionHighlightOpacity`), OpenStreetMap credit; details in `ARCHITECTURE.md` (Camera). 98 test files, 1,568 tests.
  Seen only in headless Chromium without tiles (mocked Overpass): look, contrast on real imagery and loading of the
  coarse tiles from very high up still to check on a GPU; the atmosphere seen from very high up (clouds?) was not
  looked at.

**Interrupted 2 — Strava import** (almost finished): `src/strava/api.ts` (authorization, token exchange and refresh,
list of activities, GPS / time / altitude / sensor streams), `src/strava/track.ts` (streams → `Track`),
`src/ui/StravaImport.tsx` ("Importer depuis Strava" (import from Strava) on the home screen and "Strava" in the track list),
`src/platform/oauthRedirect.ts` + `public/oauth-callback.html` (site: login window that comes back to
`oauth-callback.html`; desktop: plugins `tauri-plugin-oauth` (listens on 127.0.0.1) and `tauri-plugin-opener`, in
`Cargo.toml`, `lib.rs` and `capabilities/default.json`), CSP for `www.strava.com`. Choice: "your own Strava
application" (Client ID / Secret pasted once, kept in the platform storage of this browser or this computer, sent
only to strava.com), because the token exchange requires the secret and the project has no server; no Strava key is
in the code. Documented in the user guide (`docs/user-guide.html`, "Import a track"), `ARCHITECTURE.md` ("Strava import") and
`docs/tests-gpu.md` (section 6 bis). **Checked by the user on 9 October 2026 with the Windows desktop application**:
connection and import of real activities through the API work. The website path (browser `fetch` of
`www.strava.com/oauth/token`) has not been tried yet; the desktop webview applies the same cross-origin rules, so it
is expected to work.

## Visual checks still to do (never seen on screen)

Checklist for the machine with a GPU, grouped by priority: [`docs/tests-gpu.md`](tests-gpu.md). The details below
remain the source for each work item.

- Color grading: each preset with and without atmosphere (no visible change in "Naturel" ("Natural"); without atmosphere,
  gradient sky graded too, no edge or band where it meets the terrain, SMAA aliasing comparable to MSAA),
  "Noir et blanc" ("Black and white") truly gray (track and overlays included: the 2D overlay is **not** graded, by design), vignetting
  identical in 16:9 and 9:16, exported still image and video identical to the preview (compare a screenshot), no stutter
  when dragging a slider (only the first change away from "Naturel" compiles the shader). Also to check in the
  atmosphere chain: SMAA, merged into the same pass as tone mapping, reads the pass input (image before
  aerial perspective and tone mapping) on detected edges; if light fringes appear on ridges,
  move it into its own pass.
- Region highlight ("Depuis la région" › "Mettre en avant la région", sample in the Alps): the region's border on the
  relief, readable name and dot, outside darkened but still legible, fade during the dive, same frames in a 1080p
  export, "Pays" start height, 9:16.
- Safe zones: button under "Recadrer" ("Reframe") (absent in "Libre" ("Free")), G, labels readable on a narrow preview, button
  strip in 9:16 and 4:5, 93% / 90% margins in 16:9, nothing in the export.

- Batch rendering: the three drawer modes on one line at 300 px ("Plusieurs formats" ("Several formats") short enough?), swatches for the 5
  formats × 4 resolutions, estimate (size after the codec probe, duration only after a first film), "Tout
  exporter" ("Export all") in Chrome (folder asked once, files growing in the folder, names, image and poster
  copied at the end, an existing name replaced), Firefox (one download per file, "Enregistrer à nouveau" ("Save again")),
  Windows desktop (folder dialog, files written under the folder without fs scope refusal), view reset between two films,
  "Tout annuler" ("Cancel all") and "Annuler" ("Cancel") in the top bar during the 2nd film (started file deleted, following ones cancelled),
  format refused by the encoder (9:16 4K in H.264?) marked as failed without stopping the others, interface during the short
  gap between two jobs (tabs briefly unlocked).

- Offline packs: "Hors ligne" ("Offline") section (estimate that changes with the corridor, the source and the level of detail;
  Esri allowed for personal use with a warning and 10,000 tiles per day; "Trop de tuiles" ("Too many tiles")), preparing the sample at 2 km (progress,
  "Pause" / "Reprendre" (Pause / Resume), "Annuler" that removes the new pack), list (size, "incomplet" ("incomplete"), "Supprimer" (Delete)), used space (site),
  then **offline** (DevTools › Network › Offline, or Wi-Fi off): reload, view and export with no gap in the
  corridor, coarser terrain beyond it, export wait time on missing tiles; Firefox (persistent storage
  request); Safari (quota); Windows desktop: folder `%APPDATA%\io.github.yannickriou.openflyover\tiles`
  created, files read on restart while offline, "Supprimer" that empties the folder.

- Video synced to the route, with real files and a timestamped track from the same outing: iPhone (Apple date),
  Android, GoPro (local time written as UTC: hour offset found automatically?), DJI, WebM (file date); check
  on each one whether the time read is the **start** of the recording (some devices may write the end in `mvhd`);
  "Caler sur le parcours" ("Sync to the route") toast (alone or with photos), inspector (time, approximate note, "Recaler" (Re-sync), keyboard
  offset, "Suivre" ("Follow") checkbox), playback at ×1 / ×2 / ×4 with "Suivre" (image that follows the marker without stutter, frozen
  during a stop, faster in a ×2 section), export with a following video (same images as the preview), Ctrl+Z,
  project saved then reopened (sync kept). Preset with full storage (fill `localStorage` by hand):
  error toast, preset usable until reload.

- Music (to listen to on a real machine, with speakers): adding via "Options" and by drop (MP3, M4A, OGG,
  WAV, FLAC; refusal above 30 MB and for an unreadable format, message), block waveform, synced playback at ×1 / ×2
  / ×0.5, pause and resume in the middle, moving the playhead during playback, audible fades, speaker,
  "Caler la durée du film" ("Fit the film length") (toast then inspector, Ctrl+Z), drag / trim the edges (the right edge stops at the end of the
  file), two overlapping music tracks, save / reopen a project with music; MP4 export (AAC on Windows
  / macOS, Opus on Linux) and WebM (Opus) in memory and on disk: sound synced with the image from start to end, fades,
  played by VLC, the system player and video editing software (Opus in MP4 does not play everywhere); browser without
  an audio encoder: silent video and note; Safari: `play()` outside a gesture may be refused; Windows desktop (WebView2).

- Poster: thumbnail in the 5 formats × 3 styles (long title, no time, no altitude), "Créer l'affiche" ("Create the poster") on
  the sample in A4 portrait then A3 landscape (framing of the whole track, north up, no marker, labels and track
  to scale, credits readable when printed), view restored as before after the export, thumbnail that reuses the rendered view,
  cancel during rendering, preset applied (style only), "Par défaut" ("Default"), Ctrl+Z on the title.

- Speed per section: "Vitesse" ("Speed") button (×2 block under "Plans" ("Shots"), inspector open), timeline bar still on
  one line at 1440 / 1280 px with this extra button, drag / stretch a block (it follows the pointer, stops against its
  neighbours, snapping, Alt), swatches and fine adjustment (label and film duration updated), from / to with the keyboard, Del and
  Ctrl+Z, playback and export: acceleration without stutter at the edges, slowed section dotted, right-click menu with
  three entries (flipped near the bottom), "garder la durée" ("keep the duration") turned on then off.

- Clarity pass: switches (state, focus, disabled), swatches (check mark, dotted "absent de cette trace" ("not in this track")), Habillage
  sections (sticky headers, options rule under each switch), weather on two lines at 280 px, tabs
  without a track, Projet tab without a preset, status strip before / during / after loading, export summary.

- Platform layer, on the site: "Ouvrir" ("Open") and Ctrl+O (input created on the fly: tracks, project, several files,
  "Annuler"), "Enregistrer" ("Save") (download, toast), drop on the window, automatic download of an export, in
  Chrome and Firefox. On the desktop: the same with the native dialogs ("Annuler" saves nothing and does not mark the
  project as saved), tiles / weather / Overpass under the CSP, "pas d'encodeur" ("no encoder") message on Linux. Follow-up: "Choisir un
  fichier" ("Choose a file") and "Ouvrir un projet…" ("Open a project…") on the home screen, "Ajouter" ("Add"), logo, "Média" ("Media") (filters, "Annuler", several files),
  tab and collapsed panel restored on reload, earlier presets and weather still there, "Enregistrer …" and toast
  action at the end of an export on the desktop.
- Timeline: drag a stop (snapping, Alt), stretch a text from both edges, opening edge, Ctrl+Z per gesture,
  Ctrl+wheel, a long film (scrolling).
- Photos: adding, thumbnails, full screen with slow zoom, map in the 3 styles, GPS placement, export with a photo.
- Videos: adding an MP4, a WebM and a MOV ("Média" button and drop), refusal of a file over 50 MB and of an
  unreadable format (message), block thumbnail and icon, synced playback (×0.5 to ×4), moving on the ruler while
  paused (the image follows, without flicker), left edge (start within the video), full screen and map, video during a stop,
  export (exact images, video that advances during a stop), save / reopen a project with a video, Ctrl+Z.
- Overlays (Habillage): texts at several positions, opening / closing cards aligned on the shots, credits in the 4 corners,
  in 9:16 and 720p.
- Interface: 1280 and 1000 px wide (drawer panel), export drawer during a real export ("42 % · Annuler",
  interface locked), toasts (stacking, "Annuler" after "Par défaut"), file drop (overlay), Projet tab,
  sun time: slider aligned with the sunrise / sunset marks, buttons on two lines at 280 px.
- Interface leftovers: toasts "Préréglage appliqué : …" ("Preset applied: …") and "Export annulé" ("Export cancelled"), "Repères (OpenStreetMap)" ("Landmarks (OpenStreetMap)") section
  collapsible (sticky header, "modifié" ("modified")), slow drag of a slider = a single Ctrl+Z, sunrise / sunset in local time
  with a FIT (or a GPX with an offset) and "en heure solaire" ("in solar time") with the sample.
- Last work item (inspector on the right, timeline bar, click on the track):
  - inspector: at 1440 px panel + view + inspector side by side; at 1280 px the panel collapses on selection and comes back
    on deselection; export drawer on top, then inspector back when it closes; sticky header; 3 × 3 grid
    (chosen cell, visible focus, arrows, label next to it); Esc in a field; dragging a block: the timeline does not jump
    on press, the inspector opens on release;
  - timeline bar at 1440 / 1280 / 1000 px (one or two clean lines, labels hidden at 1280 px), tooltips at the
    top never cut off (left and right edges), zoom slider and "Ajuster" ("Fit"), ■, "Options" menu above the bar
    ("modifié" dot, Esc, click outside, Tab), tinted stops on the flyover bar readable on the profile (selected
    stop in white), photos toast with "Placer sur le parcours" ("Place on the route"), S / T;
  - 3D view: hand cursor on the track only, click = playhead (not after a camera drag), right-click without
    dragging = menu at the pointer (flipped near the right and bottom edges), right-click drag = camera move without
    menu, keyboard menu (arrows, Esc), adding = block selected + inspector, one Ctrl+Z per addition; nothing during an
    export; Firefox (browser menu properly replaced).
- Older: ghost race markers, mini-map in the 3 styles, labels hidden under the maps, slow-motion.
- Real export on a machine with a GPU: speed (before `c8a00ed` / after), 60 s film in 1080p then 4K (memory), 9:16,
  track and labels to scale in 4K, burnt-in credits, still image.
- Direct write (Chrome / Edge, then Windows desktop): "Enregistrer" ("Save") dialog on click, file growing during
  the export (`.crswap` in Chrome), MP4 played by VLC, the system player and video editing software (duration, seeking),
  WebM if ".webm" is typed, cancel and dialog closed (no file left), disk full / drive removed (error
  message, file deleted), tab memory stable on a long 4K film; Firefox: warning above 1.5 GB and
  download as before.

## Proposed next steps

Updated on 9 October 2026 (afternoon). The roadmap is built; what remains, by owner:

**In progress (code)**
1. Volumetric clouds: done on the work branch (still views and exported frames averaged over 32 / 16–32 renders,
   sea of clouds with a dense base and wispy tops, lit at a low sun; ARCHITECTURE.md, clouds). The edge against the
   relief can only be softened through density (three-clouds has no option). To judge on a GPU (`docs/tests-gpu.md`).
2. « Mer de nuages » as a surface (« Nappe »): done on the work branch (« Rendu de la mer de nuages » › « Nappe »,
   `CloudSeaSurface`, noise-free billows, soft edges against the summits). Compare it with the volumetric sea on a
   real GPU (look, fps) and keep the better one as the default.
3. On the work branch, not yet merged: « Lissage de la trace » out of « Plus de réglages », « Plan de situation à
   l'ouverture / à la clôture » switches in the « Survol » tab (nothing on by default), WebGL context asking for the
   high-performance GPU.

**Proposed, waiting for the user's go**
4. **Camera smoothing in time**: done on the work branch (« Lissage de la visée », « Lissage de la caméra » 3 s by
   default, « Fin en douceur », « Lissage des virages » in metres; see ARCHITECTURE.md, "Flyover"). To check on a GPU.
5. **« Objectif »**: done on the work branch (« Flou de bougé »: radial speed blur from the film's camera speed, plus
   the exact shutter blur of the export, 8 sub-frames sharing the cloud renders, and a trail in the preview; « Halo lumineux », « Reflet d'objectif » (atmosphere only), « Profondeur de champ »
   on the marker; all off by default; ARCHITECTURE.md, "Lens"). Field of view kept fixed (too many framing
   computations depend on it). To check on a GPU (`docs/tests-gpu.md`).
6. **Situation shot, more control**: done on the work branch (« Lieu » among the areas containing the track,
   « Maintien » / « Plongée », « Cadrage » with « Capturer la vue actuelle », « Soleil » (« Plein jour » by default since 10 October 2026, « Heure du survol », « Accéléré »); see
   ARCHITECTURE.md, "Film and timeline", Camera). To check on a GPU (`docs/tests-gpu.md`); the place list was only
   tested against a mocked Overpass.
7. **Several tracks: « À la suite » or « En parallèle »**: done on the work branch (ARCHITECTURE.md, "Several
   tracks"). « Plusieurs traces » in the track list: « La première » (default, unchanged), « À la suite » (stages
   with their own colour, name and figures, one timeline segment each, stage card, cut or dip between stages, order
   of the list) and « En parallèle » (the ghost race, camera on the first track, the one ahead or all of them,
   leaderboard toggle); each stage with its own sun, clouds and weather. Left: no hold or camera move between stages
   (a stop placed before a cut gives one); to check on a GPU (`docs/tests-gpu.md`).
8. Extensions: all built, except those the user dropped (GoPro GPS time (GPMF); a built-in openh264 encoder, patents
   checked on 9 October 2026: Cisco's licence covers only its own binaries).

**Before the final release (`v0.1.0`), once the lots above are merged**
- **Final review** (user's request): one full pass over the product before tagging. Code: dead code and unused
  exports, consistency of naming and comments with the surrounding code, error handling and French messages, no
  secret or personal data, licences and attributions of every source (`docs/sources.md`), desktop CSP and permissions.
  Product: every feature present in both the website and the desktop app, French labels and tips consistent, defaults
  sensible, old projects still loading. Docs: README, user guide, ARCHITECTURE and how-it-works matching the code.
  Run the full checks and `npm run e2e`; list what only a GPU can confirm in `docs/tests-gpu.md`.
  Maintainability (user's requirement): code easy for a human to maintain and understand, kept to the essentials;
  remove needless complexity (indirections, options and abstractions used once, speculative code, duplicated logic),
  split or simplify modules and functions that are too long. Comments (user's rule): short and relevant, never a
  substitute for the documentation; the code should explain itself (names, structure), a comment only states a why
  the code cannot show, and anything longer belongs in ARCHITECTURE.md or docs/. Trim the long header and block
  comments accordingly.
  Tests (audit of 9 October 2026: relevant overall, 66 % of lines covered, 90 % outside UI components; details in
  the session notes). Done: poster layout cases merged (−90), low-value tests dropped, `TrackLines` tests on
  observable results, frozen v1 / v2 projects (`project/legacy.test.ts`), `projectActions` open / save, audio mix and
  `readAudio` (Web Audio fake), environment `node` with jsdom only where needed (run time ~41 s → ~18 s; 1,556 tests,
  lines 66.9 %, branches 61.9 %); the export loop (`ExportController.test.ts`: frame count, cancel deletes the file,
  error path); preview == export (`FlyoverRig` and the export both place the camera with `filmViewAt`, and playing
  the film reaches the progress of every exported frame, `schedule.test.ts`). A real Garmin file (`__fixtures__/lunch-run.fit`, 42 min run,
  2,307 points with heart rate, cadence and temperature) is read in `fit.test.ts`.
- **Review done** (branch `final-review`, 9 October 2026): docs checked against the code, ~450 comment lines cut,
  French messages for browser / system errors, error screen, WebGL 2 missing or context lost, file dialog failures
  shown, camera presets as a tile grid (12 presets), initial JS −16 kB gzip (overlay canvas and film inspector lazy).
  No unused dependency; every export flagged by knip is used in its module or its tests. Then fixed on the same
  branch: Windows command line prints to the calling terminal (`AttachConsole`), atomic project writes, external links
  in the system browser, `'wasm-unsafe-eval'` removed from the CSP, Esri optional (never default nor offline, « Powered
  by Esri »), Strava attribution and « Déconnecter Strava », `THIRD_PARTY_NOTICES.md` (npm packages, Rust crates, assets;
  no GPL / LGPL / AGPL). The overlay of the very first v1 projects (before the weather widget) is replaced by the default one with a warning, and frozen
  old projects with media / POIs / camera keys are not tested: both accepted by the user on 10 October 2026.
- **Optimisation pass** (user's request): done on 10 October 2026 for what a machine without a GPU can measure
  (headless Chromium, SwiftShader, tiles answered 404; scripts in the session's scratchpad), kept only with a measured
  or provable gain:

  | Measure (method) | Before | After |
  |---|---|---|
  | Downloaded before the first interaction (production preview, cold cache) | 2.60 MB, incl. mediabunny 695 kB and the export drawer | 1.86 MB (−29 %): the drawer and mediabunny load on its first opening |
  | Initial JS (index + react + store + trackColor + shell + small files, gzip) | ~204 kB | unchanged (chunks already split: three.js core / renderer / Takram / mediabunny, no duplication) |
  | Startup, median of 3 (shell interactive / first WebGL draw on the sample) | 0.37 s / 1.15 s | 0.43 s / 1.49 s: noise of this container (±0.5 s between runs), no claim |
  | WebGL resources, sample opened, closed and reopened 5× (`gl.info.memory`, closed state) | geometries 2 → 7, buffers 3 → 7 (+1 per cycle: drei's `ScreenQuad` under Takram's `<Sky>` never disposes its geometry) | geometries 1, buffers 2, textures 1, flat; heap still +0.4 MB per cycle after warm-up (JS side, not pursued) |
  | React commits during playback (devtools hook, PerformedWork flag) | one commit per frame re-renders `Timeline` only (+ `FilmOptions`, 8 `BarButton`, 11 `Icon`); idle 0 commits | unchanged (the playhead needs it; splitting the timeline waits for the UI redesign) |
  | `computeFilmView` (vitest, sample track, 2,000 calls) | 43 µs per call (33 µs without time smoothing) | unchanged: skipping it in `FlyoverRig` would save 0.3 % of a frame, rejected |
  | Export 320 × 180, 2 s, 10 i/s (`[export]` line, 2 runs) | 20 frames in 2.8–3.7 s: render 0.1 s, tile waits 0, encoding 2.2 s (software encoder) | unchanged (CPU path not touched) |
  | `npx vitest run` (105 files, 1,587 tests) | 21.9 s, forked processes | 16.0–17.0 s, worker threads (`pool: 'threads'`, still one isolated worker per file) |
  | CI `web` job (run 37999933851) | 58 s: npm ci 7 s, coverage 23 s, build 11 s; `rust` 54 s | unchanged |
  | Desktop installers | `dist` 16 MB: atmosphere EXR 9.3 MB, clouds 2.8 MB (`shape.bin` 2 MB raw noise), JS / CSS 3.3 MB, fonts 340 kB; nothing shipped twice | not buildable here (no webkit2gtk); levers: one Windows installer instead of NSIS + MSI, NSIS lzma already the default |

  Left to a GPU machine (`docs/tests-gpu.md`): preview frame time (clouds, « Nappe », lens effects, labels'
  line-of-sight sampling), cloud renders and motion-blur sub-frames per exported frame, texture memory with real tiles
  (bitmap cache 600 entries, height cache), the real export rate and the native encoder.

**Next, right after the `v0.1.0` tag (user's request, 10 October 2026)**
- **Web app highly usable on mobile** (large lot, user's request). Today the interface is built for a desktop screen,
  mouse and keyboard. To cover: a layout for phone and tablet widths (panels as bottom sheets, one panel at a time,
  the 3D view kept visible); touch gestures for the 3D view and the timeline (pinch, two-finger orbit, drag of clips,
  long press instead of right-click), touch-sized controls; a performance budget for mobile GPUs (pixel ratio cap,
  lighter clouds and tiles, memory limits on iOS); import from the phone (file picker, share target of an installed
  web app for GPX / FIT sent by Strava, Garmin or Komoot apps); export on mobile browsers (WebCodecs support and
  memory to check per browser, shorter or lower-resolution fallback); offline use as an installed web app. Check
  each browser's support (Safari iOS, Chrome Android) before choosing, and add a mobile scenario to `npm run e2e`.
  Done (10 October 2026, `ARCHITECTURE.md` "Installable web app and mobile", support table from MDN
  browser-compat-data 8.1.5): installable web app (manifest, icons, service worker, « Nouvelle version disponible »,
  iOS home screen hint), Android share target for GPX / FIT, iOS track picker without `accept` filter, share sheet
  instead of the download on phones without a save picker, device budget (pixel ratio, tile caches, imagery, preview
  clouds, « Nappe », export up to 1080p / 1440p). Checked in headless Chromium with phone emulation only. The export drawer
  now offers « Partager / Enregistrer » on such phones (from a tap: no automatic download) and shows the resolution
  cap next to « Résolution ». Left: memory and frame time on a real iPhone and Android phone.
  - *Layout and touch: done* (ARCHITECTURE.md "Interface", "Phone and tablet" and "Touch gestures"): bottom sheets with
    snaps on a portrait phone, tab bar, « Plus d'actions » menu, timeline strip, full-screen dialogs, tablet side
    sheets, 44 px targets, tap-reachable tips; double tap to fit, long press for the track menu, pinch on the
    timeline; e2e scenario `mobile`. Checked in Chromium device emulation only (no real phone yet): to try on an
    iPhone (Safari) and an Android phone, in particular the sheet drag, the safe areas and the long press.
  - Timeline fix: dragging the 4 s « Montée » stop to the right on a phone stretched it (16 px end grip, touch
    adjustment) and, the flight shortened to keep the duration, its block grew to the left; an edge grip now only takes
    the outer third of its side (`pressedGrip`). On a computer the block also seems to jump left on release: the
    inspector opens and the timeline is fitted again (by design).
  - Overpass memory cache bounded to the 32 most recently used results (`MEMORY_CACHE_ENTRIES`, LRU); the persistent
    cache is unchanged.
  - *Leftovers: done* (10 October 2026): pixel ratio 1.5 while fingers move the 3D view, as while playing
    (`scene/touchGesture.ts`). Checked in Chromium phone emulation only.

**In the user's hands**
9. Tests on the machine with a GPU (`docs/tests-gpu.md`): clouds (volumetric vs « Nappe », low sun), region highlight,
   steady camera, free camera, start / finish pins, export.
10. Pull requests #1 to #11 (closed): their commit tabs still show the pre-rewrite authors; GitHub has no archive for
   a pull request, only GitHub Support can remove those commits. The old branches are deleted; `export-loop-tests` and
   `final-review` (merged) are still to delete from a local clone (`git push origin --delete export-loop-tests
   final-review`): the session's proxy refuses branch deletion.
11. Command-line rendering once on a real machine. Strava import: checked by the user. No signing certificate (paid).
   `v0.1.0` tag once the optimisation and UI passes are merged (release published by `desktop.yml`); the GPU tests of
   `docs/tests-gpu.md` come after, when the user has a machine.

To watch, nothing to do now: the `THREE.Clock` warning comes from `@react-three/fiber` itself (9.8.1 is the latest
version on 9 October 2026); check again at its next release.

## Limits and open points

- FIT files are read by an in-house decoder (`src/import/fit.ts`, MIT); the Garmin FIT SDK, whose license forbids
  redistribution, is no longer a dependency. Esri terms (no key) to re-read for online use. Open-Meteo and EOX
  non-commercial; OpenTopoMap, Esri and swisstopo allowed in offline packs for personal use, with a low daily limit
  (`docs/sources.md`, "Attributions, licenses and offline use"). Yale star catalog: license not stated.
- HEIC photos refused (the browser does not decode them); EXIF read only in JPEG files.
- Videos: 50 MB at most (the project contains them: ~1.33 × their size in the JSON file), not placed
  by GPS (synced only by time, the track must be timestamped); an old project edited by hand with a video missing from its table keeps it in the film without
  showing it (`parseProject` only removes photos without an image).
- "Prévoir la sortie" reads the start time in the device's time zone, not one derived from the coordinates.
- Strava import: the user's own Strava application, limited by Strava to 100 requests per 15 minutes and 1,000 per
  day; read access includes private activities and privacy zones.
- Firefox / Safari not tested for export (WebCodecs). HTTPS required outside `localhost`.
- No component rendering tests (no Testing Library); `npm run e2e` checks the main flows in a
  real browser, but the look is still checked by hand, with screenshots.

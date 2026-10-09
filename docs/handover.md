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
- `ai-dev/confident-darwin-83rxik` (cloud session): review fixes, simplifications, knowledge base (see "Work in
  progress").
- `lot-suites` (not merged, the user's work in progress): route scouting with planned times, forecast weather and a
  roadbook; opening / closing transitions (cross-dissolve, cut, fade to black or white); saving on close; in
  progress: locator map from very high up with the region highlighted (2 `filmCamera` tests failing), Strava import.
  Next: merge it (27 conflicting files with `master`).
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
  SwiftShader, Vite server started by the script without file watching). 6 scenarios: home screen and sample, tabs
  and help, T / Ctrl+Z / S, project saved then reopened, 320 × 180 export + still image, reconnaissance (mocked Overpass). 7 to 8 min here (export
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
"Mes projets" ("My projects"), native Linux encoder, installers); technical details in `ARCHITECTURE.md`, features in `README.md`.

## Work in progress (branch `ai-dev/confident-darwin-83rxik`): review, simplification, knowledge base

Checked: typecheck, lint (0 errors), `npx vitest run --maxWorkers=1` (92 files, 1,478 tests), `npm run build`,
`cargo test` (9). Screen check of the five tabs and the phone layout in Chromium without a GPU: no console error.

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
- **Left for later** (proposed, not done): one `RangeField` for the ~15 hand-written sliders, `Fold` merged into
  `PanelSection`, shared "Position" / "Texte" / "Taille" fields, duplicated poster and terrain constants, test-only
  pacing and DEM helpers, `diffEngineOptions` in `TerrainLayer`; "Texte libre" drawn like a timeline text (behaviour
  change, needs the user's OK).

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

The roadmap has nothing left to build. What remains is in the user's hands:

1. Tests on the machine with a GPU (`docs/tests-gpu.md`), first run of the GitHub workflows, signing certificate if
   wanted; run command-line rendering once on a real machine.
2. Merge this branch's PR after review.
3. Reconnaissance: the user doubts its usefulness, do not extend it (bike / MTB profiles dropped); remove it if asked.

To watch, nothing to do now: the `THREE.Clock` warning comes from `@react-three/fiber` itself (9.8.1 is the latest
version on 9 October 2026); check again at its next release.

## Limits and open points

- Garmin FIT SDK license (not free, redistribution "except in the cases provided for"): to decide before public release; personal
  use OK. Esri terms (no key) to re-read for online use. Open-Meteo and EOX non-commercial; OpenTopoMap,
  Esri and swisstopo allowed in offline packs for personal use, with a low daily limit (README,
  "Sources"). Yale star catalog: license not stated.
- HEIC photos refused (the browser does not decode them); EXIF read only in JPEG files.
- Videos: 50 MB at most (the project contains them: ~1.33 × their size in the JSON file), not placed
  by GPS (synced only by time, the track must be timestamped); an old project edited by hand with a video missing from its table keeps it in the film without
  showing it (`parseProject` only removes photos without an image).
- Firefox / Safari not tested for export (WebCodecs). HTTPS required outside `localhost`.
- No component rendering tests (no Testing Library); `npm run e2e` checks the main flows in a
  real browser, but the look is still checked by hand, with screenshots.

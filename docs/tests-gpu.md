# Tests to run on a machine with a GPU

What has never been seen or measured for real: the development machine only has a simulated GPU (SwiftShader), too slow
to judge smoothness, export or sound. Check items off as you go; write the problem and the steps to
reproduce it next to the box.

## Preparation

- Recent Chrome or Edge (WebCodecs), then Firefox for the fallbacks. Speakers or headphones.
- `npm ci`, then `npm run dev`; for the desktop application (Windows): Tauri prerequisites from the README, `npm run tauri:dev`.
- Automated checks first: `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build`, then
  `npm run e2e` (end-to-end tests; faster with a real GPU).
- Useful files: a **timestamped** GPX or FIT track, a track without times, JPEG photos with GPS, an MP4 video from a
  phone or GoPro **shot during that outing**, a WebM, a MOV, a 3 min MP3 song, a file larger than
  50 MB.
- Browser console open: no red error expected. At the end of an export, the `[export] …` line gives the times
  (rendering, waiting for tiles, encoding) and the number of exceeded timeouts.

## 1. Priority: real export

- [ ] Speed: 60 s film in 1080p 30 fps, total time and `[export]` line; compare with commit `c8a00ed`
      (before optimization) if useful.
- [ ] 4K: same film, stable tab memory (browser Task Manager), track and labels at the same
      scale as in 1080p.
- [ ] 9:16 and 1:1: nothing cut off, overlay and credits well placed.
- [ ] Direct write to disk (Chrome / Edge): "Save" dialog on click, file that grows during
      the export, MP4 played by VLC, the system player and an editing program (duration, seeking); ".webm" typed → WebM.
- [ ] Name typed with ".webm": WebM file (VP9, Opus) played by VLC and Firefox; encoding time compared with MP4.
- [ ] Cancel during the export, or close the "Save" dialog: no file left behind, view and interface restored.
- [ ] Firefox: in-memory export, warning above an estimated 1.5 GB, download.
- [ ] Clouds enabled ("Météo" (weather) or "Manuel 50 %" (manual 50%) setting): export cost, same frames from one export to the next.
- [ ] PNG and JPEG still image, with and without overlay.
- [ ] Overlay only (transparent background): fast export, no waiting for tiles; WebM played with its transparency (Chrome
      on a colored background, Kdenlive or Shotcut), laid over the normal video of the same film: counters, profile, map,
      texts and photos match frame by frame; cancelling leaves no file.
- [ ] Batch render: 16:9 1080p + 9:16 1080p + still image + poster into a folder; file names, "Tout
      annuler" (cancel all) during the 2nd film (started file deleted), format rejected by the encoder marked as failed.
- [ ] One film per track: folder of 3 GPX / FIT + one broken file, 16:9 720p; one film per track, named after its
      file, stops and landmark titles redone for each track, broken file marked as failed; at the end, the
      previous tracks and film come back ("Enregistré" (saved) unchanged, Ctrl+Z has no effect on the batch); "Tout annuler".
- [ ] A4 portrait poster, then A3 landscape: overview with north up, credits readable when printed; graphics card
      size limit in A3 (17 MP render).
- [ ] Poster of several tracks (3 outings, then a ghost race of 3 tracks, then 8 outings) and "Carte à plat" (flat map):
      all tracks framed, each in its color, list readable in the 5 formats × 3 styles (8 outings:
      totals only); flat map sharp, north up, no haze, track correctly placed on the image, cancellation.

## 2. Sound (listen)

- [ ] Music: add through "Options" and by dropping a file (MP3, M4A, OGG, WAV, FLAC), waveform, playback in sync at ×1,
      ×2, ×0.5, audible fades, speaker button, "Caler la durée du film sur la musique" (fit the film length to the music).
- [ ] Export with music: sound in sync with the picture from start to end, AAC in the MP4 (Windows / macOS), Opus in the WebM;
      plays everywhere.
- [ ] "Caler sur le rythme" (sync to the beat) on 3 real songs (pop or electro, acoustic, no drums): announced tempo correct
      (compare with a BPM counter), block marks on the beats, stops and titles that land on the beat when
      listening (at ×1 and in the export); song without a clear beat: "trop incertain" (too uncertain) message, nothing moves; note whether
      the bar starts fall on the 1st beat.
- [ ] Video sound: clip sound at ×1, live volume adjustment, no click at the start or end of a clip, music lowered under the clip if the option is checked,
      clip following the flyover speed is muted; export identical to the preview.

## 3. Preview smoothness

- [ ] Playback of the sample in the 5 camera styles: no stutter, no hole in the terrain, smooth slow-downs and stops,
      intro and outro (descent from the overview).
- [ ] Intro and outro "Depuis la région" (from the region) (16:9 and 9:16, short and long track): terrain loaded in time for the
      very high view (no terrain edge, no blurry tiles), dive toward the track and climb back without stutter.
- [ ] "Depuis la région" with "Lieu" set to a park, an island or a range (e.g. « Parc naturel régional de Corse »):
      border and name of that place, framed whole; "Maintien" 2 s then "Plongée" 5 s: still, region whole, then the
      dive with the highlight fading; "Cadrage": "Inclinaison" 10°, "Distance" 35 km, "Boussole" 0° (north up), "Marge"
      20 % (place at the bottom of the frame), "Capturer la vue actuelle" after orbiting the 3D view (the shot starts
      from that view); no terrain edge at 60° of tilt; "Faire bouger le soleil" (low sun, morning outing): shadows
      sweeping the relief, no jump of light where the shot meets the flight; same in the exported video.
- [ ] Shot transitions (Opening / Closing inspector): clean "Coupe" (cut) at the start and at the end of the flight; "Fondu au
      noir" and "Fondu au blanc" (fade to black / to white, 0.3 s and 2 s): the picture goes through the color, the camera jump
      hidden at the darkest point, only the credits visible on top, tiles loaded when the picture comes back; same rendering
      in the exported video; "Enchaîné" (continuous) identical to before.
- [ ] Atmosphere, shadows, clouds ("Météo" / "Manuel" / "Aucun" (none)) and water: acceptable frames per second; clouds and water in
      low sun (reflections, ripples), no gray patches on the imagery.
- [ ] Color grading ("Carte" tab › "Couleurs" (colors)): presets "Naturel" → "Noir et blanc" (natural → black and white), with and without atmosphere; no
      cost with "Naturel"; without atmosphere, graded sky with no visible seam with the terrain; vignette in 16:9 and 9:16.
- [ ] "Objectif" ("Carte" tab), with and without atmosphere: "Halo lumineux" glows on snow and the sun, radius
      changes it; "Profondeur de champ" keeps the marker sharp and blurs the far ridges and the foreground, same share
      of the frame in a 4K export; "Reflet d'objectif" (atmosphere only) appears with the sun in the frame, disappears
      behind a summit or a cloud deck, no flicker as the sun nears an edge; "Flou de bougé": edges streaked towards the
      direction of travel and centre sharp in fast passages, nothing during stops and held shots, same in a paused
      preview and the exported frame; trail while playing; an exported film (with and without clouds, WebCodecs and desktop ffmpeg) shows a smooth
      blur in fast passages and sharp held frames and texts, no ghosting across the cut of an opening shot; export
      time × ~8 without clouds, much less with clouds (the cloud renders are shared). Frames per second of the
      preview with every effect on.
- [ ] Edge smoothing (atmosphere enabled): no light fringe and no staircase on the ridges and the track.
- [ ] Track and marker ("Survol" tab): width, dashes and dots during the flight, halo over forest and over snow, track
      drawn stuck to the marker, figures readable and flipped in turns, round avatar; default "Boule" (ball)
      identical to before.
- [ ] On-demand rendering: still view → the GPU drops to almost nothing (task manager, GPU tab); nothing
      frozen after a change: drag a slider, rotate the camera (damping to the end), tiles that
      arrive, clouds that settle (~0.5–1 s), label font, marker image, water, reframing (full
      animation); playback resumes without a jump after a long pause; export unchanged.
- [ ] Preview clouds (fewer computation steps than the "bas" (low) preset): no visible bands or holes compared
      with before; the export keeps its quality.
- [ ] Safe zones: button under "Recadrer" (reframe) or G key, social network bands in 9:16 and 4:5, margins in 16:9,
      absent from the export.

## 4. Editing in the timeline

- [ ] Drag a stop (snapping, Alt without snapping), stretch a text from both edges, intro edge, one Ctrl+Z
      per gesture, Ctrl+mouse wheel, long film (scrolling).
- [ ] Speed per section: ×2 block then ×0.5, acceleration without stutter at the edges, "garder la durée" (keep the duration).
- [ ] Camera at stops: "Tour lent" (slow turn) at the summit (the turn comes back without stutter), "Vue large" (wide view) (smooth pull-back and
      rise), "Fixe" (fixed) with the "Orbite" (orbit) style (the camera slows down, stops, starts again), "Comme le film" (same as the film).
- [ ] Camera smoothing ("Caméra" › "Plus de réglages"): "Lissage de la caméra" 0 then 7.5 s on a film with stops and a
      "Ralentir aux temps forts" slow-down: the camera anticipates and eases into each stop, no jerk at the start of the
      flight; "Lissage de la visée" 2 s: the marker drifts a little off-centre at stops, then comes back; "Fin en douceur"
      3 s: the camera comes to rest at the end and turns to watch the marker finish; "Lissage des virages" "Auto" vs
      1,5 km on a twisty track; an export with these on identical to the preview (stops included).
- [ ] Framings ("Garder ce cadrage ici" (keep this framing here), diamonds on the "Plans" (shots) track): high, wide view over a long section,
      smooth transition from one framing to another and back to the film setting, without stutter at the edges; dragged diamond; export
      identical to the preview.
- [ ] Photos: adding, thumbnails, "Placer sur le parcours" (place on the route) (GPS), full screen with slow zoom, map in the 3 styles.
- [ ] Videos: MP4, WebM, MOV; rejection above 50 MB; playback in sync from ×0.5 to ×4; left edge (start within the
      video); video during a stop; frame-by-frame export.
- [ ] Video placed on the route, with the files from the same outing: iPhone, Android, GoPro (local time), DJI —
      is the time read really the **start** of the recording? "Suivre la vitesse du survol" (follow the flyover speed): picture matched to the place, frozen
      during a stop.
- [ ] 3D view: click on the track = playhead; right-click = menu (stop, text, speed here); dragging the camera
      triggers nothing; Firefox (browser menu properly replaced).
- [ ] Points of interest: right-click on the terrain off the track, then on the track › "Point d'intérêt ici" (point of interest here), typed name;
      pin label at the right place, hidden behind a ridge and under the intro cards, present in the export;
      "Ajouter au marqueur" (add to the marker), rename, "Arrêt" (stop), ✕ and Ctrl+Z in the "Carte" tab.
- [ ] Slow down and show titles at landmarks: new Alpine track, landmarks loaded → titles "Col … · altitude" at the top center
      when passing, smooth slow-down without stutter, no slow-down on a stop (title only); uncheck / recheck, Ctrl+Z;
      moving a title unchecks the box; old project reopened unchanged; export identical to the preview.
- [ ] Project with texts, photos, videos and music: save, reload the page, reopen.

## 5. Interface

- [ ] Widths 1440, 1280 and 1000 px: panel, inspector on the right, export drawer, timeline bar on one line,
      panel as a drawer below 1024 px (closed at start, Esc or a click outside closes it).
- [ ] During an export: "42 % · Annuler" (cancel) button, interface locked (also during a whole batch render).
- [ ] Toast messages (stacking, "Annuler" (undo) after "Par défaut" (default)), dropping a file anywhere (overlay),
      tooltips never cut off, "?" help.
- [ ] Sun time: slider aligned with the sunrise / sunset marks, local time with a FIT.
- [ ] Sun "Jour" (day) ("Heure fixe" (fixed time)): December 21, then June 21 at 10:00, light and shadows that change, sunrise and
      sunset in the bar recomputed, "Jour de la sortie" (day of the outing); export identical to the preview.
- [ ] Track list: color dot (track, profile and mini-map recolored, playback not interrupted); arrow
      of a second track: it moves to the top and is flown over (no undo: tracks are outside the history).
- [ ] Labels in the view: markers every 1, 2, 5, 10 km at the right place (compared with the distance counter),
      giving way to named labels; "Taille" (size) ×0.6 to ×1.6 readable, also in 4K; "Portée" (range) 10 km, then
      150 km.
- [ ] Point of interest icons (hut, bivouac, summit…) sharp in the view and in the export; color and font
      of a film text (inspector), applied to the preview and to the export.
- [ ] New figures (mountaineer, bikepacking, motorcycle, light aircraft) readable and turned in the turns.
- [ ] "Animer la figurine" (animate the figurine): steady bounce and sway during playback, still when paused, identical
      in the export; off: the figurine as before.
- [ ] "Départ et arrivée" (start and finish) labels at both ends, a single label on a loop; "Photos, là où elles ont été
      prises" (photos where they were taken): a phone photo with GPS pinned at the right place, caption as its text.
- [ ] "Mer de nuages" (sea of clouds): a flat, dense layer filling the valleys, summits above « Sommet de la mer de
      nuages » emerging, warm at sunset (clouds not black at a low sun, unlike SwiftShader); identical in the export.
- [ ] "Mer de nuages", grain and shape: a still view settles within ~1 s into smooth clouds (no speckle, compare with
      the October 2026 screenshot); billows with shaded crevices, warm at golden hour, a broken top; the moving
      preview may keep a fine grain; an exported video has no grain on the clouds (« Qualité des nuages à
      l’export » « Moyenne » and « Fine »), and its export time per frame (×6 for the clouds) stays acceptable.
- [ ] « Rendu de la mer de nuages » › « Nappe » (surface) next to « Volumétrique », same views at noon and at golden
      hour: rolling cumulus tops without grain or shimmer (also far away and while the camera moves), creases darker
      than the tops, warm tops and long shadows at a low sun, a bright rim looking toward the sun, summits emerging
      without a hard line, the sea fading into the haze at the horizon; under the sea, a grey ceiling; frames per
      second against the volumetric sea; drifting with the wind, identical in the export.
- [ ] "Générique" (credits) of the closing card: the card holds, then card and lines roll up and leave the frame on the
      last frame, in 16:9 and 9:16, in the 3 overlay styles; readable on snow.
- [ ] "Transitions" (Survol tab) at 0.5 s then 4 s: easing into a stop, a pause and a "Vitesse" section shorter / longer,
      never a jump.
- [ ] Presets by family: save a "Style de carte" preset, change the camera, apply it: only the map changes; same for
      "Prise de vue" (camera and light only), "Habillage", "Trace, marqueur et étiquettes".
- [ ] "Contenu / Style / Visibilité" tabs of each overlay element: every former setting found in one of them.
- [ ] Ghost race (two tracks), mini-map in the 3 overlay styles, labels hidden under the cards.
- [ ] "Habillage" › "Couleurs et polices" (colors and fonts): swatches in the 320 px panel, accent, text and background applied to
      the preview and to the export, "Revenir au style" (back to the style); a single Ctrl+Z after a drag in the color picker.
- [ ] Ghost race ranking in the 3 styles: color dots and gaps aligned, no width jump,
      "Tête" (lead), then "Arrivée" (finish).
- [ ] "Plusieurs traces" › "À la suite" with two days of a hike: the film flies day 1 then day 2, a clean cut at the
      darkest point of the dip (no camera glide between the two days), the stage card (name, « Étape 2 sur 2 », date,
      distance, D+) centred for 5 s, the counters, profile and mini-map those of the stage; one segment per stage on the
      timeline; "Coupe" and "Fondu au blanc"; the up arrow swaps the stages; same frames in the export (16:9, 9:16).
- [ ] "Plusieurs traces" › "À la suite" with two stages on two different days (different weather): each stage shows
      its own day's sun (timeline time and light), clouds and weather in the scene and the overlay weather figures; the
      change happens on the cut, nothing in between; same in the export.
- [ ] "Plusieurs traces" › "En parallèle", "Caméra sur" « Celle en tête » (a cut when the lead changes or finishes)
      and « Toutes les traces » (all racers in the frame, the camera pulls back as they spread, no jump); a track
      chosen in the list becomes the first one; "Classement à l'image" with the overlay on; same in the export.

- [ ] Close the tab (Chrome, Firefox): nothing asked without changes, nor with a "Mes projets" project changed more than
      3 s ago; "Quitter le site ?" (leave site?, the browser's own wording) with "Modifié" outside "Mes projets", during an
      export, or right after a change to a kept project (reopened: the change is there).

- [ ] Join two tracks of a two-day hike ("Trace" tab, then when dropping both files): a single
      track "J1 → J2" (D1 → D2) or with the common name, no line between the end of day 1 and the start of day 2, marker that jumps
      over this gap; "Annuler" (undo) restores both tracks.
- [ ] Planned outing: Komoot or Visorando GPX without times, "Prévoir la sortie" (plan the outing; the day after tomorrow,
      8:00, hike); "horaires estimés" (estimated times) chip, plausible arrival time, sun and timeline time moving on,
      "Prévision" (forecast) weather in the panel and in the scene, "Temps" (time) counter preceded by "≈"; a start 20 days
      ahead has no weather and says so; "Effacer les horaires" (clear the times) returns to the track without times;
      project reopened: times and chip kept.
- [ ] Roadbook ("Feuille de route", "Trace" tab): Alpine route, "Repères" (landmarks) on; steep sections and passes, huts,
      water points in order, climb top merged with the pass; click on a line = marker and camera at the right place;
      "≈" times after "Prévoir la sortie"; "Copier" (copy) then paste into an editor, "Enregistrer (.txt)" (site and
      desktop); columns aligned in the 320 px panel.

## 6. Offline

- [ ] Prepare the sample at 2 km (with IGN, then Esri): estimate, progress, "Pause" / "Reprendre" (resume) / "Annuler" (cancel), pack listed.
- [ ] Cut the network (DevTools › Network › Offline, or Wi-Fi) and reload: view and export without holes in the corridor.
- [ ] Delete the pack: tiles fetched from the network again. Firefox (persistent storage), Safari (quota).

## 6 bis. Strava import (your own Strava application, created on strava.com/settings/api)

- [ ] Site (`npm run dev`, callback domain `localhost`): "Importer depuis Strava" (import from Strava), Client ID and
      Secret, "Se connecter" (connect): Strava window, "Autoriser" (authorize), window closed, list of activities; tracks
      already loaded untouched.
- [ ] Site: "Annuler" (cancel) while waiting, refusal on Strava ("Autorisation refusée", authorization refused), wrong
      Client Secret (message, form kept), pop-ups blocked (message).
- [ ] Site: "Plus" (more), search by name, import of two activities (ride with power, hike): names, dates, activity, D+,
      heart rate in the counters; activity without GPS refused with its name.
- [ ] Site: expired token (set `expiresAt` to 0 in `openflyover.strava.tokens.v1`) renewed without asking anything;
      access revoked on strava.com/settings/apps → back to "Se connecter"; "Déconnecter" (disconnect), "Oublier ces
      identifiants" (forget these credentials).
- [ ] Hosted site: callback domain = the site's host, same steps.
- [ ] Desktop (`npm run tauri:dev`, Windows): "Se connecter" opens the system browser on Strava, the "Connexion
      transmise" (connection passed on) page shows, the application lists the activities; import; no CSP error in the
      console.

## 7. Desktop application (Windows, Linux)

- [ ] `npm run tauri:dev`: window, map, weather and landmarks loaded (window security rules).
- [ ] "Ouvrir" / "Enregistrer" (open / save) with the system dialogs; "Annuler" (cancel) writes nothing.
- [ ] Video export written to disk, batch render into a folder, poster.
- [ ] Offline pack: folder `%APPDATA%\io.github.yannickriou.openflyover\tiles` created, read again on restart without
      network, emptied by "Supprimer" (delete).
- [ ] "Mes projets" (my projects): "Garder dans Mes projets" (keep in my projects), files in `%APPDATA%\io.github.yannickriou.openflyover\projects`,
      automatic save a few seconds after a change, list read again on restart, open, rename,
      delete.
- [ ] Close the window right after a change to a "Mes projets" project: closed without a question, change there on
      restart; outside "Mes projets" and "Modifié": "Enregistrer" (save; save dialog, "Annuler" there keeps the window
      open), "Fermer sans enregistrer" (close without saving), "Annuler"; during an export: "Fermer quand même" (close
      anyway).
- [ ] `npm run tauri:build`: installer produced, installed application that starts.

On Linux (Ubuntu 22.04 or later, WebKitGTK without WebCodecs: export through the system `ffmpeg`):

- [ ] `cargo test` in `src-tauri/` (ffmpeg arguments, quality → crf).
- [ ] Without ffmpeg: the "Exporter" (export) drawer says "installez ffmpeg" (install ffmpeg), button disabled, the still image works.
- [ ] `sudo apt install ffmpeg`, restart: MP4 (H.264) announced; 1080p 30 fps export of a film with music, file played
      by VLC and the system player, sound present and in sync, colors identical to the preview.
- [ ] Standard / maximum quality: different sizes, no missing frame (number of frames = the one in the drawer).
- [ ] "Habillage seul (fond transparent)": WebM (VP9) announced, `<trace> habillage.webm` written; opened in an editor
      that reads VP9 alpha (Kdenlive, Shotcut) on a track above a video: the footage shows around the counters, map and
      titles, half-transparent panels blend, same length as the film.
- [ ] Command line: `openflyover --rendu <dossier> --sortie <dossier> --formats 16:9@720p` (then with
      `--prereglage`): one film per track, `rendu-en-lot.txt`, window closed, exit code 0 (`echo $?`); unknown
      option or empty folder: message and code 2. On Windows too (`openflyover.exe` in the installation folder).
- [ ] Cancel during the export: file deleted, no `ffmpeg` process left, nothing from `openflyover-*.wav` in `/tmp`.
- [ ] Batch render into a folder (several formats, including 9:16); 4K if the machine allows it.
- [ ] Simulated failure (`pkill ffmpeg` during the export): the export stops with a message about ffmpeg, no partial
      file.
- [ ] From the AppImage and from the deb package: ffmpeg found and launched (AppImage environment variables).
- [ ] GPU encoder (NVIDIA with its driver, or Intel / AMD with `/dev/dri/renderD128`): start from a terminal, the
      first MP4 export prints `Encodeur H.264 de ffmpeg : h264_nvenc` (or `h264_vaapi`); export time of a 1080p film
      clearly shorter than the same export with an earlier build (libx264; note both); file played by VLC and the
      system player, colors identical; standard / maximum quality give different sizes. Without a usable GPU (or an
      ffmpeg built without them): `libx264` printed, export as before, its start delayed once by 10 s at most.

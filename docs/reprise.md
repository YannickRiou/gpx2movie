# État du projet et reprise

Mis à jour le 2026-10-08. Ce fichier suffit pour reprendre sans l'historique de conversation : lire
d'abord ce fichier, puis `git status` et `npm run typecheck`.

## Branches, PR, dépôt

- `master` : phases 1–2, historique réécrit sans trailers (poussé).
- PR #1 (`phase3-atmosphere`, phases 2 à 5 + début de la phase 7) **fusionnée** dans `master` le 2026-10-07.
- `timeline` (branche de travail courante) : timeline de montage + nouvelle interface. PR #2 → `master` :
  https://github.com/YannickRiou/gpx2movie/pull/2 (**à fusionner par l'utilisateur**, la fusion automatique est refusée).
- Règle demandée : une branche et une PR par fonctionnalité, description à jour + procédure de test manuel ; l'utilisateur
  fusionne.
- **Pousser** : `git push` tout simplement. Le remote `origin` est `git@github-yannickriou:YannickRiou/gpx2movie.git`,
  alias SSH défini dans `~/.ssh/config` (clé dédiée `~/.ssh/id_ed25519_yannickriou`, enregistrée sur le compte perso
  `YannickRiou`). Ne pas repasser par `git@github.com` : cette adresse authentifie le compte `yriouvortex`, sans droits
  ici, et le push HTTPS avec le jeton `gh` renvoyait « Internal Server Error ». `~/.gitconfig` contient encore un jeton
  d'accès personnel en clair du compte `yriouvortex` (règle `url.*.insteadOf`) : à révoquer et supprimer par l'utilisateur.

## Environnement et méthode (WSL)

- Node 24 via nvm : `source ~/.nvm/nvm.sh && nvm use 24` avant `npm …`.
- Vérifications : `npm run typecheck`, `npm run lint` (34 avertissements préexistants dans `src/scene`, 0 erreur),
  `npx vitest run --maxWorkers=1` (63 fichiers, 844 tests au dernier commit vert), `npm run build`.
- Tests de bout en bout : `npm run e2e` (`e2e/run.mjs`, puppeteer-core, Chromium de Playwright ou `OPENFLYOVER_CHROME`,
  SwiftShader, serveur Vite lancé par le script sans surveillance des fichiers). 5 scénarios : accueil et exemple, onglets
  et aide, T / Ctrl+Z / S, projet enregistré puis rouvert, export 320 × 180 + image fixe. 7 à 8 min ici (export
  5 à 6 min, nuages coupés) ; `OPENFLYOVER_E2E_SKIP_EXPORT=1` : moins de 1 min 30. Échoue sur toute erreur de console hors bruit
  réseau. Un seul navigateur à la fois sur cette machine.
- Serveur de dev utilisé pour les captures : `npm run dev -- --port 5190` (à relancer).
- Contrôle visuel sans écran : Chromium headless (`~/.cache/ms-playwright/chromium_headless_shell-1223/…`) piloté par
  puppeteer-core (`~/.npm/_npx/e0b87bb3fb84adaa/node_modules/puppeteer-core`), GPU logiciel SwiftShader : 20–40 s par
  capture, **un seul navigateur à la fois**. Script générique à recréer dans le répertoire temporaire de session : charge
  `http://127.0.0.1:<port>/`, clique « Essayer avec l'exemple », exécute des étapes (`click` par texte de bouton, `check`
  par libellé, `eval` JS, `shot`), viewport via `W`/`H`.
- **Ne plus mesurer la vitesse de l'export sur cette machine** (décision de l'utilisateur, GPU logiciel) : il la mesure
  sur une machine avec GPU. La console affiche en fin d'export `[export] N images … rendu … attente … encodage …`.
- Sous-agents : interdiction totale de git (deux ont fait `git stash` / `pop` malgré la consigne, sans perte constatée).
- Messages de commit neutres, sans trailer ni signature ; rien dans le code ou la doc sur les outils de développement. Charte « Carte alpine » (`src/ui/theme.css`),
  pas la charte Vortex. Licence du code : MIT (`LICENSE`).

## Décisions prises par l'utilisateur (ne pas redemander)

- Usage personnel, faible trafic ; hébergement non décidé (exe local, serveur perso ou type OVH). Deux cibles à garder
  fonctionnelles : site statique et application de bureau Tauri (phase 6). Pas de clé d'API, sources ouvertes seulement.
- Timeline façon logiciel de montage : la base est le survol du GPX ; pistes séparées pour arrêts, textes, photos (vidéos
  plus tard) ; film monté automatiquement au chargement puis retouché. Préréglages sans arrêts / textes / médias.
- Interface « hyper ergonomique comme les interfaces récentes » : MapDirector sert d'inspiration, pas de modèle.
  Icônes Lucide (ISC, embarquées), cadre sombre (encre) autour de la vue avec panneaux clairs (papier), onglets
  Trace · Carte · Survol · Habillage · Projet, export depuis la barre du haut.
- README écrit simplement, phrases courtes, chaque chose dite une fois.

## Fait et commité (branche `timeline`, du plus récent au plus ancien)

| Commit | Contenu |
|---|---|
| `f6e2784` + suivant | inspecteur de la timeline dans le panneau de droite, grille de position 3 × 3, barre de la timeline à icônes (■, zoom + « Ajuster », menu « Options »), arrêts marqués sur la barre du survol, raccourcis S / T, clic / clic droit sur la trace dans la vue 3D (`TrackPicker`) ; libellés de la barre masqués quand la timeline est étroite ; captures du README refaites |
| `6ce6085` | Survol : nombre d'arrêts dans la durée du film |
| `a215704` | messages éphémères (toasts), dépôt n'importe où, écran d'accueil, aide des raccourcis « ? », infobulles ; onglets Carte et Survol en sections, « Plus de réglages », heure du soleil (lever / coucher, boutons rapides) |
| `46b6b39` | le tiroir d'export réduit la vue (bug : la fenêtre s'élargissait) |
| `5e85a04` | photos dans la timeline (EXIF GPS / heure, plein écran ou carte, enregistrées dans le projet) + nouvelle interface (barre du haut, rail, cadrage au format, tiroir d'export, icônes) |
| `9bc52e3` | README : captures (`docs/images/interface.jpg`, `habillage.jpg`) — **périmées depuis la nouvelle interface** |
| `ca4453e` | textes de la timeline dans le film, cartons calés sur les plans, crédits des sources incrustés à l'export |
| `69569a7`, `fac1f81` | timeline sous la vue (pistes Plans / Arrêts / Textes, glisser-déposer, inspecteur, arrêts automatiques) |
| `1996237` | README réécrit + licence MIT |
| `b7ffe55` | modèle du film, horloge du film, caméra des plans d'ensemble |
| `e45ccd0` et avant | voir `git log` ; phases 2–5 et 7 sur `phase3-atmosphere` (PR #1) |

Détail technique : `ARCHITECTURE.md` (sections « Interface », « Film et timeline », « Habillage », « Export vidéo »…).
Feuille de route et fonctionnalités : `README.md`.

## Travail en cours

- Branche `lot-video-sync-phase7` : **chargement découpé** (non commité). Premier écran : ~510 kB (~170 kB gzip) au lieu de
  3,1 MB (930 kB gzip) ; scène 3D, tiroir d'export, hors ligne, atmosphère, FIT et mediabunny chargés à part
  (`ARCHITECTURE.md`, « Chargement »). Vérifié : tests, typecheck, lint, build. Non vu à l'écran : apparition de la scène
  et du tiroir après le premier affichage, atmosphère à la première trace, import d'un .fit, export vidéo.
- Branche `lot-videos-bureau-clarte` : **nuages volumétriques** (`@takram/three-clouds` 0.7.6, `src/weather/sceneClouds.ts`,
  `src/scene/CloudsLayer.tsx`, `cloudNoise.ts`, bloc « Nuages » de l'onglet Carte ; détail dans `ARCHITECTURE.md`,
  « Nuages volumétriques »). Vu à l'écran (aperçu, 1280 × 800) : manuel 50 % et 90 %, image fixe exportée avec nuages.
  Non vu : mode Météo sur une sortie nuageuse (l'exemple est par ciel dégagé), vidéo exportée sur GPU réel (coût, rendu
  identique d'un export à l'autre), dérive au vent pendant la lecture.
- Même branche : **eau réfléchissante** (`src/osm/water.ts`, `src/scene/waterMesh.ts`, `src/scene/WaterLayer.tsx`, case
  « Lacs et rivières reflétants » de « Fond de carte » ; `ARCHITECTURE.md`, « Eau réfléchissante »). Vu à l'écran : lac de Passy
  de près et en rasant (eau sombre teintée de ciel, fondu sur la rive), Arve. Non vu : reflet du soleil en contre-jour, vagues en
  lecture, export. À faire : crédit OpenStreetMap quand seule l'eau est chargée (barre d'état, export).
- Même branche : tuiles en **réessai** (3 fois, hors cache, aussi sur 400) : la Géoplateforme IGN renvoyait par rafales des 400
  « Layer … unknown » (les parallélogrammes gris).

Avant ce lot, vu à l’écran le 2026-10-08 (1440 × 900) : inspecteur ancré, menu du clic droit sur la trace, barre
de la timeline sur une ligne avec l'inspecteur ouvert, tiroir d'export avec l'habillage.

- Branche `lot-videos-bureau-clarte`, passe « clarté » de l'interface (non commitée, présentation et libellés seulement) :
  interrupteurs pour les fonctions entières, pastilles pour les types de repères et les compteurs, Habillage en six
  sections, météo en deux lignes + « Détails », ligne « Ajoutez une trace… » sans trace, bande d'état calme, infobulles et
  libellés raccourcis. Détail : `ARCHITECTURE.md`, « Interface », « Clarté des panneaux ».
- Même branche, vidéos dans la piste Médias (non commitées) : bouton « Média » (photos et vidéos, dépôt sur la timeline),
  MP4 / WebM / MOV de 50 Mo au plus gardés tels quels dans la table des médias du projet, vignette de la première image et
  icône de caméra sur le bloc, inspecteur (début dans la vidéo, mention « muette »), aperçu par `HTMLVideoElement`, export
  image par image décodé par mediabunny (`src/film/video.ts`). Détail : `ARCHITECTURE.md`, « Film et timeline », « Vidéos ».
- Même branche, phase 6, premier incrément (non commité) : couche `src/platform/` (site / bureau, testée), « Ouvrir »,
  « Enregistrer », dépôt et résultat d'export passés par elle, projet Tauri 2 `src-tauri/` (fenêtre, droits dialog + fs
  limités aux fichiers choisis, CSP des sources, icônes), scripts `tauri:dev` / `tauri:build`, message « pas d'encodeur »
  dans le panneau d'export. Vérifié : tests, `vite build`, `cargo check --target x86_64-pc-windows-msvc` (avec
  `RC_x86_64_pc_windows_msvc` pointant sur un faux `windres` qui écrit un fichier vide ; `rustup target add
  x86_64-pc-windows-msvc`). Impossible ici sous Linux : Ubuntu 20.04 n'a pas `libwebkit2gtk-4.1` ni GLib ≥ 2.70.
  Jamais lancé dans une vraie fenêtre. Détail : `ARCHITECTURE.md`, « Application de bureau ».
- Même branche, phase 6, suite (non commitée) : tous les choix de fichier par `getPlatform().openFiles` (accueil, « Ajouter »
  des traces, logo, « Média » de la timeline), préférences de l'interface, préréglages et cache météo par
  `getPlatform().storage` (mêmes clés), « Enregistrer … » au lieu de « Télécharger … » à la fin d'un export sur le bureau.
  Cache Overpass aussi (même lot que l'écriture directe ci-dessous) : `KeyValueStore.set` répond false quand le stockage
  refuse, `keys(préfixe)` liste les clés ; le cache libère ses propres entrées puis réessaie, comme avant. Images GIF et
  AVIF acceptées par « Média » (types connus de la couche plateforme).
- Même branche, phase 5, écriture directe sur le disque (non commitée) : `Platform.createWritableFile` (site :
  `showSaveFilePicker` ; bureau : plugin-fs `open` / `seek` / `write`, droits ajoutés dans `capabilities/default.json`),
  `capabilities.canStreamToDisk`, `StreamTarget` de mediabunny (MP4 sans fast start, morceaux de 4 Mio), fichier supprimé
  à l'annulation ou en cas d'erreur, « Enregistrement direct sur le disque » et alerte au-delà de 1,5 Go en mémoire dans le
  tiroir, « Vidéo enregistrée dans <nom> ». Vérifié : tests (logique pure, session d'encodage avec faux mediabunny,
  plateformes avec faux sélecteur et faux plugin-fs). Jamais vu : un vrai export écrit sur le disque (voir ci-dessous).
  Détail : `ARCHITECTURE.md`, « Export vidéo ».

- Même branche, phase 4, vitesse par portion (non commitée) : `film.speeds[]` `{ id, fromM, toM, factor }` (×0,25–×4,
  sans chevauchement, hors préréglages), multiplicateur de vitesse à transitions douces dans `flightPacing`, piste
  « Vitesse » sous « Plans » (glisser, bords, Suppr, un pas par geste), bouton « Vitesse » de la barre (×2 sur 1 km au
  marqueur), inspecteur (pastilles, réglage fin, de / à en km), « Accélérer / ralentir ici » au clic droit sur la trace.
  Vérifié : tests (rythme, horloge, modèle, gestes). Jamais vu à l'écran. Détail : `ARCHITECTURE.md`, « Film et timeline ».

- Même branche, phase 7, affiche (non commitée) : module `src/poster/` (réglages `settings.poster`, contenu, mise en page
  en boîtes pures, dessin, export), mode « Vidéo / Affiche » du tiroir d'export (`ExportPanel` enveloppe les deux, tous deux
  montés), vignette 2D en direct, image fixe d'ensemble dans `ExportController` (`still.overview`, `still.compose`), le
  préréglage ne garde que le style. Vérifié : tests (mise en page de chaque format × style, ajustement du texte, contenu,
  dessin sur faux contexte, préréglages), typecheck, lint, build. Jamais vu à l'écran. Détail : `ARCHITECTURE.md`,
  « Affiche ».

- Même branche, phase 7, musique (non commitée) : `film.audio[]` `{ id, src, startS, durationS, inS, volume, fadeInS,
  fadeOutS }` (hors préréglages), fichiers son de 30 Mo au plus gardés tels quels dans la table des médias avec leur forme
  d'onde, piste « Musique » sous « Médias » (glisser, bords, Suppr, un pas par geste), « Options » › « Ajouter une
  musique… » et dépôt de MP3 / M4A / AAC / OGG / Opus / WAV / FLAC, inspecteur (volume, fondus, début, durée, début dans
  le fichier, « Caler la durée du film sur la musique »), aperçu par `HTMLAudioElement` et bouton haut-parleur, export
  mixé par `OfflineAudioContext` puis encodé en AAC (repli Opus, sinon film muet avec une note). Vérifié : tests (modèle,
  gestes, volume et fondus, plan du mixage, aperçu sur faux éléments, encodeur avec faux mediabunny, projet). Jamais vu ni
  entendu. Détail : `ARCHITECTURE.md`, « Film et timeline », « Musique », et « Export vidéo ».

- Même branche, phase 7, vidéo embarquée synchronisée (non commitée) : heure de début du tournage lue à l'ajout (date Apple
  avec fuseau, sinon `mvhd` des MP4 / MOV, sinon date du fichier moins la longueur, « approximative »), `film.media[].sync`
  `{ startMs, offsetS, follow }`, « Caler sur le parcours » dans le toast de l'ajout et dans l'inspecteur (bloc « Calage sur
  le parcours » : heure, décalage de l'horloge en secondes, heures entières trouvées seules pour une caméra à l'heure
  locale, case « Suivre la vitesse du survol » : image de l'endroit du marqueur, figée pendant un arrêt), même temps dans
  le fichier pour le dessin et l'export, aperçu par `playbackRate` (recalage au-delà de 0,2 s). Aussi : préréglage non
  enregistré quand le stockage est plein (toast d'erreur, préréglage gardé pour la session). Vérifié : tests (lecture
  de l'heure sur des boîtes MP4 fabriquées, placement, temps dans le fichier, vitesse de l'aperçu sur faux élément,
  dessin, préréglages). Jamais vu ni essayé avec de vrais fichiers. Détail : `ARCHITECTURE.md`, « Vidéo calée sur le
  parcours ».

- Branche `lot-video-sync-phase7` : **géoïde** (fin de la phase 3) — `src/geo/geoid.ts` (EGM96, grille 1° générée par
  `scripts/gen-geoid.mjs`, 170 Ko), monde de l'atmosphère remonté de l'ondulation N à l'origine (`mslLocalToEcef`),
  altitudes des nuages + N ; la scène reste en hauteurs MSL. Non vu à l'écran : écart attendu minime (+51 m à Chamonix,
  soit ~0,6 % de densité d'air en moins sous la caméra), plus net au bord de mer où N est grand (−107 m au sud du Sri Lanka).

- Même branche, phase 6, packs hors ligne (non commités) : module `src/offline/` (plan des tuiles d'après la règle de
  découpage du moteur et la caméra de suivi, couloir 2 / 5 / 10 km ; politique par source ; téléchargement 4 à la fois
  avec pause, reprise, annulation et limite par jour ; liste des packs), `Platform.tileCache` (`src/platform/tileCache.ts` :
  Cache Storage sur le site, fichiers sous `<app data>/tiles/` sur le bureau, droits `fs:allow-mkdir`, `read-dir`,
  `exists` et portée `$APPDATA/tiles/**`), cache d'abord dans `src/terrain/fetch.ts` (`setStoredTileReader`), section
  « Hors ligne » de l'onglet Trace. Refusés : OpenTopoMap, Esri, swisstopo. Vérifié : tests (plan, politique,
  téléchargement, registre, cache d'abord, deux stockages sur faux Cache Storage et faux plugin-fs), typecheck, lint,
  build, `cargo check --target x86_64-pc-windows-msvc` (droits acceptés). Jamais vu à l'écran ni essayé sans réseau.
  Détail : `ARCHITECTURE.md`, « Packs hors ligne ».

- Même branche, phase 7, **rendu en lot** (non commité) : mode « Plusieurs formats » du tiroir d'export (pastilles de
  résolution par format, image fixe, affiche, estimation fichiers · images · taille · durée d'après le dernier film,
  « Tout exporter », avancement « 2 / 4 · 16:9 1080p · 42 % », « Tout annuler », liste des fichiers avec « Enregistrer à
  nouveau » quand ils sont en mémoire), `src/export/batch.ts` (tâches une à une par le store et l'`ExportController`
  existants), `src/platform/folder.ts` (dossier choisi une fois : `showDirectoryPicker` sur le site, fenêtre de dossier
  sur le bureau ; fichiers « <projet> – 16x9-1080p.mp4 »), `takeResult` et `secondsPerMegapixel` dans le store d'export.
  Vérifié : tests (liste des tâches, noms, estimation, enchaînement et annulation avec faux contrôleur, écriture dans un
  faux dossier, site et bureau), typecheck, lint, build. Jamais vu à l'écran. Détail : `ARCHITECTURE.md`, « Export vidéo ».

## Contrôles visuels encore à faire (jamais vus à l'écran)

- Rendu en lot : les trois modes du tiroir sur une ligne à 300 px (« Plusieurs formats » assez court ?), pastilles des 5
  formats × 4 résolutions, estimation (taille après le sondage des codecs, durée seulement après un premier film), « Tout
  exporter » dans Chrome (dossier demandé une fois, fichiers qui grossissent dans le dossier, noms, image et affiche
  copiées à la fin, un nom déjà présent remplacé), Firefox (un téléchargement par fichier, « Enregistrer à nouveau »),
  bureau Windows (fenêtre de dossier, fichiers écrits sous le dossier sans refus du scope fs), vue remise entre deux films,
  « Tout annuler » et « Annuler » de la barre du haut pendant le 2ᵉ film (fichier commencé supprimé, suivants annulés),
  format refusé par l'encodeur (9:16 4K en H.264 ?) marqué en échec sans arrêter les autres, interface pendant le court
  intervalle entre deux tâches (onglets brièvement déverrouillés).

- Packs hors ligne : section « Hors ligne » (estimation qui change avec le couloir, la source et le niveau de détail ;
  imagerie refusée avec Esri par défaut, relief seul ; « Trop de tuiles »), préparation de l'exemple en 2 km (progression,
  Pause / Reprendre, Annuler qui retire le pack neuf), liste (taille, « incomplet », Supprimer), espace utilisé (site),
  puis **hors ligne** (DevTools › Network › Offline, ou Wi-Fi coupé) : rechargement, vue et export sans trou dans le
  couloir, relief plus grossier au-delà, temps d'attente de l'export sur les tuiles absentes ; Firefox (demande de
  stockage persistant) ; Safari (quota) ; bureau Windows : dossier `%APPDATA%\io.github.yannickriou.openflyover\tiles`
  créé, fichiers lus au redémarrage hors ligne, Supprimer qui vide le dossier.

- Vidéo calée sur le parcours, avec de vrais fichiers et une trace horodatée de la même sortie : iPhone (date Apple),
  Android, GoPro (heure locale écrite comme UTC : décalage d'heures trouvé seul ?), DJI, WebM (date du fichier) ; vérifier
  sur chacun si l'heure lue est le **début** du tournage (certains appareils écrivent peut-être la fin dans `mvhd`) ;
  toast « Caler sur le parcours » (seul ou avec des photos), inspecteur (heure, mention approximative, Recaler, décalage
  au clavier, case « Suivre »), lecture à ×1 / ×2 / ×4 avec « Suivre » (image qui suit le marqueur sans saccade, figée
  pendant un arrêt, plus rapide dans une portion ×2), export avec une vidéo qui suit (mêmes images que l'aperçu), Ctrl+Z,
  projet enregistré puis rouvert (calage gardé). Préréglage avec un stockage plein (remplir `localStorage` à la main) :
  toast d'erreur, préréglage utilisable jusqu'au rechargement.

- Musique (à écouter sur une vraie machine, avec des haut-parleurs) : ajout par « Options » et par dépôt (MP3, M4A, OGG,
  WAV, FLAC ; refus au-delà de 30 Mo et d'un format non lu, message), forme d'onde du bloc, lecture synchronisée à ×1 / ×2
  / ×0,5, pause et reprise au milieu, déplacement de la tête de lecture pendant la lecture, fondus audibles, haut-parleur,
  « Caler la durée du film » (toast puis inspecteur, Ctrl+Z), glisser / couper les bords (le bord droit s'arrête à la fin du
  fichier), deux musiques qui se chevauchent, enregistrer / rouvrir un projet avec musique ; export MP4 (AAC sous Windows
  / macOS, Opus sous Linux) et WebM (Opus) en mémoire et sur le disque : son calé sur l'image du début à la fin, fondus,
  lu par VLC, le lecteur du système et un logiciel de montage (Opus en MP4 n'est pas lu partout) ; navigateur sans
  encodeur son : vidéo muette et note ; Safari : `play()` hors geste peut être refusé ; bureau Windows (WebView2).

- Affiche : vignette dans les 5 formats × 3 styles (titre long, sans heure, sans altitude), « Créer l'affiche » sur
  l'exemple en A4 portrait puis A3 paysage (cadrage de toute la trace, nord en haut, marqueur absent, étiquettes et trace à
  l'échelle, crédits lisibles à l'impression), vue remise comme avant après l'export, vignette qui reprend la vue rendue,
  annulation pendant le rendu, préréglage appliqué (style seul), « Par défaut », Ctrl+Z sur le titre.

- Vitesse par portion : bouton « Vitesse » (bloc ×2 sous « Plans », inspecteur ouvert), barre de la timeline encore sur
  une ligne à 1440 / 1280 px avec ce bouton de plus, glisser / étirer un bloc (il suit le pointeur, s'arrête contre ses
  voisins, aimantation, Alt), pastilles et réglage fin (libellé et durée du film mis à jour), de / à au clavier, Suppr et
  Ctrl+Z, lecture et export : accélération sans à-coup aux bords, portion ralentie en pointillés, menu du clic droit à
  trois entrées (retourné près du bas), « garder la durée » activé puis désactivé.

- Passe clarté : interrupteurs (état, focus, désactivé), pastilles (coche, pointillés « absent de cette trace »), sections
  de l'Habillage (en-têtes collants, filet des options sous chaque interrupteur), météo sur deux lignes à 280 px, onglets
  sans trace, onglet Projet sans préréglage, bande d'état avant / pendant / après le chargement, résumé de l'export.

- Couche plateforme, sur le site : « Ouvrir » et Ctrl+O (champ créé à la volée : traces, projet, plusieurs fichiers,
  Annuler), « Enregistrer » (téléchargement, toast), dépôt sur la fenêtre, téléchargement automatique d'un export, sous
  Chrome et Firefox. Sur le bureau : les mêmes avec les fenêtres natives (Annuler n'enregistre rien et ne marque pas le
  projet enregistré), tuiles / météo / Overpass sous la CSP, message « pas d'encodeur » sous Linux. Suite : « Choisir un
  fichier » et « Ouvrir un projet… » de l'accueil, « Ajouter », logo, « Média » (filtres, Annuler, plusieurs fichiers),
  onglet et panneau replié retrouvés au rechargement, préréglages et météo d'avant toujours là, « Enregistrer … » et action
  du toast à la fin d'un export sur le bureau.
- Timeline : glisser un arrêt (aimantation, Alt), étirer un texte des deux bords, bord de l'ouverture, Ctrl+Z par geste,
  Ctrl+molette, un film long (défilement).
- Photos : ajout, miniatures, plein écran avec zoom lent, carte dans les 3 styles, placement GPS, export avec photo.
- Vidéos : ajout d'un MP4, d'un WebM et d'un MOV (bouton « Média » et dépôt), refus d'un fichier de plus de 50 Mo et d'un
  format non lu (message), vignette et icône du bloc, lecture synchronisée (×0,5 à ×4), déplacement sur la règle en
  pause (l'image suit, sans clignoter), bord gauche (début dans la vidéo), plein écran et carte, vidéo pendant un arrêt,
  export (images exactes, vidéo qui avance pendant un arrêt), enregistrer / rouvrir un projet avec vidéo, Ctrl+Z.
- Habillage : textes à plusieurs positions, cartons d'ouverture / clôture calés sur les plans, crédits dans les 4 coins,
  en 9:16 et 720p.
- Interface : 1280 et 1000 px de large (panneau en tiroir), tiroir d'export pendant un vrai export (« 42 % · Annuler »,
  interface verrouillée), toasts (empilement, « Annuler » après « Par défaut »), dépôt d'un fichier (voile), onglet Projet,
  heure du soleil : curseur aligné sur les repères lever / coucher, boutons sur deux lignes à 280 px.
- Restes d'interface : toasts « Préréglage appliqué : … » et « Export annulé », section « Repères (OpenStreetMap) »
  repliable (en-tête collant, « modifié »), glisser lent d'un curseur = un seul Ctrl+Z, lever / coucher à l'heure locale
  avec un FIT (ou un GPX à décalage) et « en heure solaire » avec l'exemple.
- Dernier chantier (inspecteur à droite, barre de la timeline, clic sur la trace) :
  - inspecteur : à 1440 px panneau + vue + inspecteur côte à côte ; à 1280 px le panneau se replie à la sélection et revient
    à la désélection ; tiroir d'export par-dessus puis inspecteur revenu à sa fermeture ; en-tête collant ; grille 3 × 3
    (case choisie, focus visible, flèches, libellé à côté) ; Échap dans un champ ; glisser un bloc : la timeline ne saute pas
    à l'appui, l'inspecteur s'ouvre au relâcher ;
  - barre de la timeline à 1440 / 1280 / 1000 px (une ou deux lignes propres, libellés masqués à 1280 px), infobulles en
    haut jamais coupées (bords gauche et droit), curseur de zoom et « Ajuster », ■, menu « Options » au-dessus de la barre
    (point « modifié », Échap, clic dehors, Tab), arrêts teintés sur la barre du survol lisibles sur le profil (arrêt
    sélectionné en blanc), toast des photos avec « Placer sur le parcours », S / T ;
  - vue 3D : curseur main sur la trace seulement, clic = tête de lecture (pas après un glisser de caméra), clic droit sans
    glisser = menu au pointeur (retourné près des bords droit et bas), clic droit glissé = déplacement de la caméra sans
    menu, menu au clavier (flèches, Échap), ajout = bloc sélectionné + inspecteur, un Ctrl+Z par ajout ; rien pendant un
    export ; Firefox (menu du navigateur bien remplacé).
- Plus ancien : marqueurs de course fantôme, mini-carte dans les 3 styles, étiquettes effacées sous les cartes, ralentis.
- Export réel sur machine avec GPU : vitesse (avant `c8a00ed` / après), film 60 s en 1080p puis 4K (mémoire), 9:16,
  trace et étiquettes à l'échelle en 4K, crédits incrustés, image fixe.
- Écriture directe (Chrome / Edge, puis bureau Windows) : fenêtre « Enregistrer » au clic, fichier qui grossit pendant
  l'export (`.crswap` dans Chrome), MP4 lu par VLC, le lecteur du système et un logiciel de montage (durée, recherche),
  WebM si « .webm » est tapé, annulation et fenêtre fermée (aucun fichier restant), disque plein / clé retirée (message
  d'erreur, fichier supprimé), mémoire de l'onglet stable sur un film 4K long ; Firefox : alerte au-delà de 1,5 Go et
  téléchargement comme avant.

## Prochaines étapes proposées

1. Fusion de la PR #2 par l'utilisateur ; ensuite repartir de `master` avec une branche par fonctionnalité.
2. Contrôles visuels ci-dessus (surtout 1280 / 1000 px, glisser dans la timeline, photos, export réel).
3. Timeline : son des vidéos (`muted` réservé), musique calée sur les temps forts (ralentis et arrêts sur les temps d'une
   musique), photo attachée à un arrêt, défilement
   automatique pendant un glisser au bord, textes ancrés à un arrêt, mémoriser l'état ouvert / fermé des sections.
4. Phase 6 (bureau, Tauri) : premier lancement réel (`npm run tauri:dev`) sous Windows, puis macOS / Linux récent ;
   encodeur natif pour Linux (plan dans `ARCHITECTURE.md`, « Export vidéo sans WebCodecs »)  ; accès disque pour les photos et vidéos derrière `readMedia` (un chemin de fichier plutôt que les octets
   pour les grosses vidéos) ; sans WebCodecs, les vidéos sont refusées à l'ajout. Hébergement en sous-dossier : `/fonts/`, `/samples/`,
   `/favicon.svg` sont absolus → `import.meta.env.BASE_URL` (seulement si nécessaire).
5. Phase 7 : vidéo embarquée (reste : export de l'habillage seul sur fond transparent, heure GPS des GoPro dans
   le flux GPMF, relire l'heure des vidéos ajoutées avant le calage), rendu en lot d'un dossier de GPX (plusieurs formats d'un film : fait), calage musical ; affiche : plusieurs traces, carte à plat.

## Limites et points ouverts

- Licence du SDK Garmin FIT (non libre, redistribution « sauf cas prévus ») : à trancher avant diffusion publique ; usage
  perso OK. Conditions Esri (sans clé) à relire pour l'usage en ligne. Open-Meteo et EOX non commerciaux ; OpenTopoMap,
  Esri et swisstopo exclus des packs hors ligne (README, « Sources »). Catalogue d'étoiles de Yale : licence non indiquée.
- Photos HEIC refusées (le navigateur ne les décode pas) ; EXIF lu seulement dans les JPEG.
- Vidéos : muettes, 50 Mo au plus (le projet les contient : ~1,33 × leur taille dans le fichier JSON), non placées
  par GPS (calées seulement sur l'heure, la trace doit être horodatée) ; un ancien projet modifié à la main avec une vidéo absente de sa table la garde dans le film sans
  l'afficher (`parseProject` ne retire que les photos sans image).
- Firefox / Safari non testés pour l'export (WebCodecs). HTTPS obligatoire hors `localhost`.
- Aucun test de rendu de composants (pas de Testing Library) ; `npm run e2e` vérifie les parcours principaux dans un
  vrai navigateur, mais l'aspect se vérifie toujours à la main, par captures.

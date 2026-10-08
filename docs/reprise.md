# État du projet et reprise

Mis à jour le 2026-10-08 (soir). Ce fichier suffit pour reprendre sans l'historique de conversation : lire
d'abord ce fichier, puis `git status` et `npm run typecheck`.

## Branches, PR, dépôt

- `master` : tout ce qui est fusionné (PR #1 à #7 ; #7 le 2026-10-08 : vagues 3 et 4).
- `lot-suites` (branche courante, poussée) : reconnaissance d'itinéraire, transitions, enregistrement à la fermeture,
  aides partagées, et **deux chantiers interrompus** (plan de situation très haut + région mise en avant, import
  Strava ; voir « Travail en cours »). Pas encore de PR : terminer les deux chantiers, faire passer les 2 tests en
  échec, puis PR et fusion (fusion autorisée par l'utilisateur). La CI GitHub (`ci.yml`) tourne à chaque push.
- Méthode : une branche par lot, une PR avec procédure de test manuel, fusion (`gh pr merge N --merge`), puis nouvelle
  branche partie de `origin/master`.
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
- Vérifier le Rust de l'application de bureau (Linux impossible ici, Ubuntu 20.04 sans webkit2gtk-4.1) :
  `rustup target add x86_64-pc-windows-msvc`, puis `RC_x86_64_pc_windows_msvc=<faux windres> cargo check -j 1 --target
  x86_64-pc-windows-msvc` dans `src-tauri/`. Le faux `windres` est un script exécutable nommé `windres` qui répond à `-V`
  par une ligne contenant « GNU windres » et, sinon, écrit un fichier vide à la sortie demandée (`-o`). `cargo test` ne
  tourne pas ici.
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

## Fait et fusionné

Voir `git log` et les PR #1 à #5 ; détail technique dans `ARCHITECTURE.md`, fonctionnalités dans `README.md`.

## Travail en cours (branche `lot-suites`, état au 2026-10-08 au soir)

État des vérifications au dernier commit : typecheck OK, lint OK (0 erreur), build OK, `cargo check --target
x86_64-pc-windows-msvc` OK, **vitest : 2 tests en échec sur 1 487** (`src/flyover/filmCamera.test.ts`, « region view »,
chantier interrompu ci-dessous). Rien de ce lot n'a été vu dans un navigateur.

Terminé (tests verts, jamais vu à l'écran) :
- **Reconnaissance d'itinéraire, horaires** : `src/plan/timing.ts` (DIN 33466 pour la marche, km-effort ITRA pour le
  trail, règle de Naismith adaptée au vélo, facteur de rythme), « Prévoir la sortie » dans la carte d'une trace sans heure
  (`TrackList.tsx`, `Track.timesEstimated`, badge « horaires estimés », « Effacer les horaires »), météo par la
  **prévision** Open-Meteo (`api.open-meteo.com/v1/forecast`, 16 jours, cache mémoire de 3 h ; CSP du bureau élargie).
  Limite : l'heure de départ est lue à l'heure de l'appareil (pas de fuseau tiré des coordonnées).
- **Feuille de route** : `src/plan/roadbook.ts`, `src/ui/RoadbookPanel.tsx` (onglet Trace, sous « Montées ») : pentes
  raides ≥ 15 % / ≥ 25 %, points clés (montées, cols, sommets, refuges, points d'eau, points d'intérêt), km / altitude /
  D+ / heure, clic = tête de lecture, « Copier », « Enregistrer (.txt) ». Nouveau type de repère `waterPoint` (points
  d'eau, hors film par défaut).
- **Transitions des plans** : ouverture / clôture « Enchaîné » (défaut), « Coupe », « Fondu au noir / au blanc »
  (0,3–2 s) ; `FilmShot.transition`, `dipS`, `transitionDipAt`, `shotWeight`. Pas aux arrêts (expliqué dans
  `ARCHITECTURE.md`).
- **Enregistrement à la fermeture** : bureau `onCloseRequested` (écriture en attente, 4 s au plus, puis question
  « Fermer sans enregistrer ? » ou « Fermer pendant l'export ? »), site `pagehide` / `beforeunload`. À la sortie de
  l'application, les encodages ffmpeg en cours sont arrêtés et leurs fichiers partiels supprimés (`lib.rs`,
  `Videos::cancel_all`).
- Aides partagées : `core/errors.ts` (`errorText`), `clamp` de `core/math.ts` partout.

**Interrompu 1 — plan de situation très haut + région mise en avant** (demande de l'utilisateur : faire comme la vue
« Valais/Wallis » de MapDirector : vue presque de dessus de toute la région administrative de la sortie, extérieur
assombri, frontière blanche lumineuse, nom de la région au centre, point orange à la sortie, puis plongée) :
- fait : `src/osm/region.ts` (Overpass `is_in` puis `out geom`, niveaux admin 4 à 6, choix de la plus petite région qui
  contient la trace et la dépasse ×5, anneaux recousus avec `stitchRings`, simplifiés à 2 000 points, cache) ;
  `regionDistanceM` / `regionView` réécrits dans `src/flyover/filmCamera.ts` (hauteur « région » / « pays »
  `StartHeight`, cadrage sur la boîte de la région) ; moteur de relief : zone élargie et plafond de zoom hors du couloir
  (`src/terrain/quadtree.ts`, `engine.ts`, `src/scene/TerrainLayer.tsx`, `REGION_AREA_MARGIN_M`).
- reste : faire passer les 2 tests de `filmCamera.test.ts` (attentes de l'ancienne distance à revoir), le rendu
  `src/scene/RegionHighlight.tsx` (cité dans `region.ts`, **pas encore écrit** : assombrir hors de la région, trait
  lumineux, nom, point, fondu pendant la plongée, identique aperçu / export), le réglage dans l'inspecteur d'ouverture
  (« Hauteur de départ », « Mettre en avant la région »), le crédit OpenStreetMap quand la région est affichée,
  l'atmosphère vue de très haut (nuages coupés au-dessus d'une certaine hauteur ?), la doc (`ARCHITECTURE.md`
  « Plan de situation », README, `docs/tests-gpu.md`).
- **Interrompu 2 — import Strava** (presque fini) : `src/strava/api.ts` (autorisation, échange et renouvellement du
  jeton, liste des activités, flux GPS / heure / altitude / capteurs), `src/strava/track.ts` (flux → `Track`),
  `src/ui/StravaImport.tsx` (« Importer depuis Strava » à l'accueil et dans « Ajouter »), `src/platform/oauthRedirect.ts`
  + `public/oauth-callback.html` (site : fenêtre de connexion qui revient sur `oauth-callback.html` ; bureau : plugins
  `tauri-plugin-oauth` (écoute sur 127.0.0.1) et `tauri-plugin-opener`, ajoutés à `Cargo.toml` et `lib.rs`), CSP pour
  `www.strava.com`. Choix : « votre propre application Strava » (Client ID / Secret collés une fois, gardés en local,
  envoyés seulement à strava.com) car l'échange du jeton exige le secret et le projet n'a pas de serveur. README
  (« Importer depuis Strava ») et `docs/tests-gpu.md` (section 6 bis) écrits. Reste : relire le tout (l'agent a été
  arrêté pendant la doc), vérifier `ARCHITECTURE.md` (section « Import Strava »), droits des plugins dans
  `capabilities/default.json`, essai réel (CORS de `www.strava.com/oauth/token` depuis le navigateur à confirmer).

## Contrôles visuels encore à faire (jamais vus à l'écran)

Liste à cocher pour la machine avec GPU, regroupée par priorité : [`docs/tests-gpu.md`](tests-gpu.md). Le détail ci-dessous
reste la source de chaque chantier.

- Étalonnage : chaque préréglage avec et sans atmosphère (aucun changement visible en « Naturel » ; sans atmosphère, ciel
  dégradé étalonné lui aussi, pas de bord ni de bande au raccord avec le relief, crénelage du SMAA comparable au MSAA),
  Noir et blanc vraiment gris (trace et habillage compris : l'habillage 2D n'est **pas** étalonné, voulu), vignettage
  identique en 16:9 et 9:16, image fixe et vidéo exportées identiques à l'aperçu (comparer une capture), pas d'à-coup en
  glissant un curseur (seule la première sortie de « Naturel » compile le shader). À vérifier aussi dans la chaîne de
  l'atmosphère : le SMAA, fusionné dans la même passe que le tone mapping, lit l'entrée de la passe (image avant
  perspective aérienne et tone mapping) sur les bords détectés ; si des liserés clairs apparaissent sur les crêtes, le
  sortir dans sa propre passe.
- Zones de sécurité : bouton sous « Recadrer » (absent en « Libre »), G, étiquettes lisibles sur un aperçu étroit, bande des
  boutons en 9:16 et 4:5, marges 93 % / 90 % en 16:9, rien dans l'export.

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

1. Finir les deux chantiers interrompus ci-dessus, puis vérifications complètes, captures, PR de `lot-suites`, fusion.
2. Passe de performance de la scène (pas de rendu continu à l'arrêt, nuages moins chers en aperçu) — promise à
   l'utilisateur.
3. Mettre à jour la section « Feuille de route » du README (périmée : plusieurs lignes « à faire » sont faites :
   couleurs et polices, classement dans l'habillage, habillage seul, ralentis et titres, affiche à plusieurs traces et
   carte à plat, transitions, reconnaissance, stockage local des projets, installeurs) — promis à l'utilisateur.
4. L'utilisateur : tests sur la machine avec GPU (`docs/tests-gpu.md`), premier lancement des workflows GitHub,
   application Strava personnelle pour l'import.
5. Extensions proposées et non retenues pour l'instant : caméra propre à une photo ou un texte, vignettes dans Mes
   projets, heure GPS des GoPro (GPMF), habillage seul sur le bureau Linux, encodeur intégré openh264.
6. Petites suites : avertissement `THREE.Clock` (émis par `@react-three/fiber`) ; un export « .webm » demandé sur le
   bureau Linux sort en MP4 ; fuseau horaire tiré des coordonnées pour « Prévoir la sortie ».

## Limites et points ouverts

- Licence du SDK Garmin FIT (non libre, redistribution « sauf cas prévus ») : à trancher avant diffusion publique ; usage
  perso OK. Conditions Esri (sans clé) à relire pour l'usage en ligne. Open-Meteo et EOX non commerciaux ; OpenTopoMap,
  Esri et swisstopo permis dans les packs hors ligne pour un usage personnel, avec une limite par jour basse (README,
  « Sources »). Catalogue d'étoiles de Yale : licence non indiquée.
- Photos HEIC refusées (le navigateur ne les décode pas) ; EXIF lu seulement dans les JPEG.
- Vidéos : 50 Mo au plus (le projet les contient : ~1,33 × leur taille dans le fichier JSON), non placées
  par GPS (calées seulement sur l'heure, la trace doit être horodatée) ; un ancien projet modifié à la main avec une vidéo absente de sa table la garde dans le film sans
  l'afficher (`parseProject` ne retire que les photos sans image).
- Firefox / Safari non testés pour l'export (WebCodecs). HTTPS obligatoire hors `localhost`.
- Aucun test de rendu de composants (pas de Testing Library) ; `npm run e2e` vérifie les parcours principaux dans un
  vrai navigateur, mais l'aspect se vérifie toujours à la main, par captures.

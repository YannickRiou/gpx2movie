# État du projet et reprise

Mis à jour le 2026-10-08. Ce fichier suffit pour reprendre sans l'historique de conversation : lire
d'abord ce fichier, puis `git status` et `npm run typecheck`.

## Branches, PR, dépôt

- `master` : tout ce qui est fusionné (PR #1 à #7 ; #7 le 2026-10-08 : vagues 3 et 4).
- `ai-dev/confident-darwin-83rxik` (session cloud, PR #8 ouverte) : petites suites, reconnaissance (vague 5), rendu à la
  demande (voir « Travail en cours »).
- Méthode : une branche par lot, une PR avec procédure de test manuel, fusion (`gh pr merge N --merge`), puis nouvelle
  branche partie de `origin/master`.
- **Pousser** : `git push` tout simplement. Le remote `origin` est `git@github-yannickriou:YannickRiou/gpx2movie.git`,
  alias SSH défini dans `~/.ssh/config` (clé dédiée `~/.ssh/id_ed25519_yannickriou`, enregistrée sur le compte perso
  `YannickRiou`). Ne pas repasser par `git@github.com` : cette adresse authentifie le compte `yriouvortex`, sans droits
  ici, et le push HTTPS avec le jeton `gh` renvoyait « Internal Server Error ». `~/.gitconfig` contient encore un jeton
  d'accès personnel en clair du compte `yriouvortex` (règle `url.*.insteadOf`) : à révoquer et supprimer par l'utilisateur.

## Session cloud (branche `ai-dev/confident-darwin-83rxik`)

- Hook de démarrage `.claude/hooks/session-start.sh` (déclaré dans `.claude/settings.json`, sessions cloud seulement) :
  Node v24.21.0 (somme SHA-256 vérifiée) dans `/opt/node-v24.21.0` et mis en tête du PATH, `npm install` (le npm de
  Node 24 laisse `package-lock.json` intact ; celui de Node 22 le réécrit), `OPENFLYOVER_CHROME` sur le headless shell
  de `/opt/pw-browsers`, `LANG=C.UTF-8` (sans locale UTF-8, Chromium nomme « download » un téléchargement au nom
  accentué), bibliothèques Tauri Linux par `apt-get` (WebKitGTK 4.1…). ~25 s la première fois, < 1 s ensuite.
- Ici, `cargo test` tourne dans `src-tauri/` (Ubuntu 24.04, 2 min la première compilation) : 5 tests verts.
- Réseau : la politique de l'environnement refuse les hôtes de tuiles (`tiles.mapterhorn.com`, `tile.openstreetmap.org`…,
  403 du proxy). `npm run e2e` avec `OPENFLYOVER_E2E_SKIP_EXPORT=1` : 5/5 en ~20 s.

## Environnement et méthode (WSL)

- Node 24 via nvm : `source ~/.nvm/nvm.sh && nvm use 24` avant `npm …`.
- Vérifications : `npm run typecheck`, `npm run lint` (34 avertissements préexistants dans `src/scene`, 0 erreur),
  `npx vitest run --maxWorkers=1` (63 fichiers, 844 tests au dernier commit vert), `npm run build`.
- Tests de bout en bout : `npm run e2e` (`e2e/run.mjs`, puppeteer-core, Chromium de Playwright ou `OPENFLYOVER_CHROME`,
  SwiftShader, serveur Vite lancé par le script sans surveillance des fichiers). 6 scénarios : accueil et exemple, onglets
  et aide, T / Ctrl+Z / S, projet enregistré puis rouvert, export 320 × 180 + image fixe, reconnaissance (Overpass simulé). 7 à 8 min ici (export
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

Voir `git log` et les PR #1 à #7 (vagues 3 et 4 : plan de situation, points d'intérêt, traces enchaînées, ralentis et
titres aux repères, calage sur la musique, affiche à plusieurs traces et carte à plat, un film par trace d'un dossier,
Mes projets, encodeur natif Linux, installeurs) ; détail technique dans `ARCHITECTURE.md`, fonctionnalités dans `README.md`.

## Travail en cours (branche `ai-dev/confident-darwin-83rxik`, PR #8)

Vérifié : typecheck, lint (0 erreur), `npx vitest run --maxWorkers=1` (90 fichiers, 1 439 tests), `npm run build`
(premier écran sans three.js), `cargo test` (5), `npm run e2e` (6 scénarios ; ici la reconnaissance passe avec la source
de relief AWS, Mapterhorn étant bloqué par le réseau de la session). Le reste : [`docs/tests-gpu.md`](tests-gpu.md).

- **Petites suites** : copies de `clamp` → `core/math.ts` ; `errorMessage` partagé (`core/errors.ts`, 16 copies
  retirées) ; bureau Linux, nom en « .webm » → WebM VP9 + Opus par ffmpeg (vérifié par `cargo test` et un vrai ffmpeg) ;
  e2e qui attend la scène 3D avant d'exporter.
- **Reconnaissance (vague 5)** : « Préparer une sortie » (accueil et onglet Trace) : lieu (Nominatim, à la validation)
  ou coordonnées → relief sans trace (`planArea` du store) ; clic droit › « Point de passage ici » (épingles « Départ »,
  « Étape n », « Arrivée ») ; « Calculer l'itinéraire » : chemins OSM par Overpass (boîte calée sur une grille de 0,02°,
  2 km de marge, 0,3° au plus), A* qui préfère sentiers et pistes, altitudes des tuiles au zoom 13, trace `gpx` sans
  heures avec les points en waypoints ; « Modifier » reprend les points et recalcule (même couleur). Vu en capture :
  points, trace, montées et film monté sur une grille de chemins simulée. Jamais essayé sur de vrais chemins OSM
  (Overpass et Nominatim bloqués ici). Un seul profil (à pied).
- **Rendu à la demande** : `frameloop="demand"` (`scene/renderOnDemand.ts`) ; mesuré en rendu logiciel : plus aucune
  image demandée une fois la marge de 30 images écoulée, lecture et recadrage sans saut. Aperçu des nuages allégé
  (`PREVIEW_MARCH`), jamais vu à l'écran.

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

1. L'utilisateur : tests sur la machine avec GPU (`docs/tests-gpu.md`), premier lancement des workflows GitHub, certificat
   de signature s'il en veut un.
2. Fusionner la PR #8 après relecture.
3. Reste de la feuille de route (README, « Feuille de route »), à confirmer avant de construire : ouverture / clôture
   « balayage » et transitions réglables ; caméra propre à une photo ou une note ; couleurs et polices par widget ; ralentis
   calés sur le rythme de la musique ; rendu en lot en ligne de commande (sans Node à l'exécution : par l'application de
   bureau) ; profils de reconnaissance (vélo, VTT). Les lignes « Titres et textes », « Trace », « Points d'intérêt »,
   « Rendu », « Format », « Thèmes », « Éditeur » de la phase 4 sont des cahiers des charges sans état : à auditer.
4. Petites suites : avertissement `THREE.Clock` (émis par `@react-three/fiber` lui-même, à revoir à sa prochaine version).

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

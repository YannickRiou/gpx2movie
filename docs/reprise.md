# État du projet et reprise

Mis à jour le 2026-10-08. Ce fichier suffit pour reprendre sans l'historique de conversation : lire
d'abord ce fichier, puis `git status` et `npm run typecheck`.

## Branches, PR, dépôt

- `master` : tout ce qui est fusionné (PR #1 à #5, la dernière le 2026-10-08).
- `lot-video-sync-phase7` (branche courante) : géoïde, packs hors ligne, rendu en lot, chargement découpé, vagues 1 et 2
  des fonctions restantes (voir « Travail en cours »). PR vers `master` ouverte puis fusionnée dès que les vérifications
  sont vertes (fusion autorisée par l'utilisateur).
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

## Travail en cours (branche `lot-video-sync-phase7`)

Vérifié pour tout le lot : typecheck, lint (0 erreur), `npx vitest run --maxWorkers=1` (83 fichiers, 1 268 tests),
`npm run build`. Vu en capture (SwiftShader, 1440 × 900) : section « Trace et marqueur », figurine, zones de sécurité en
16:9, section « Couleurs », losange de cadrage et inspecteur « Cadrage ». Le reste est à voir ou écouter sur une machine
avec GPU : [`docs/tests-gpu.md`](tests-gpu.md).

- **Trace et marqueur** (onglet Survol) : `settings.trackStyle` (épaisseur, plein / tirets / points, halo, trace qui se
  dessine) et `settings.marker` (boule, 7 figurines, image ronde, taille). `ARCHITECTURE.md`, « Trace et marqueur ».
- **Étalonnage** (onglet Carte › Couleurs, 7 préréglages + 4 curseurs) et **zones de sécurité** (bouton sous « Recadrer »,
  touche G). Le SMAA de la chaîne de l'atmosphère est maintenant dans sa propre passe, après le tone mapping (il lisait
  l'image HDR brute sur les bords), l'étalonnage le suit dans la même passe.
- **Son des vidéos** : son et volume par clip, « Baisser la musique sous les vidéos » (−10 dB, rampes 0,3 s) ; anciens
  projets muets. Jamais écouté.
- **Habillage** : « Couleurs et polices » par-dessus le style (`overlay.overrides`, `resolveOverlayTheme`), widget
  « Classement » de la course fantôme (`overlay.leaderboard`).
- **Export « Habillage seul »** : WebM VP9 transparent (alpha par mediabunny), sans rendu 3D, mêmes images que le film.
- **Caméra par arrêt** (Comme le film / Tour lent / Vue large / Fixe ; « Fixe » tient maintenant aussi l'orbite) et
  **cadrages clés** (`film.cameraKeys`, losanges dans « Plans », « Garder ce cadrage ici », inspecteur « Cadrage »).
- **Chargement découpé** : premier écran ~540 kB (~177 kB gzip, three.js exclu : `flyover/cameraKeys.ts` sans three pour le panneau Caméra) ; scène, export, hors ligne, atmosphère, FIT et mediabunny
  à part.

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

Fonctions validées par l'utilisateur (« toutes pertinentes »), par vagues, quelques agents à la fois (mémoire) :

1. Vague 3 : plan de situation (ouverture depuis la région), points d'intérêt ajoutés à la main, traces enchaînées,
   ralentis et titres aux repères OpenStreetMap.
2. Vague 4 : ralentis et arrêts calés sur les temps de la musique, affiche à plusieurs traces et carte à plat, un film par
   GPX d'un dossier, projets rangés en local dans l'exe, encodeur natif sous Linux, installeurs signés (préparer la
   chaîne ; le certificat est à fournir par l'utilisateur).
3. Vague 5 : reconnaissance d'itinéraire (à confirmer avec l'utilisateur avant de construire).
4. Petites suites : `THREE.Clock` → `THREE.Timer` ; e2e qui attend les morceaux chargés à part ; aide de message d'erreur
   répétée ~12 fois ; copies de `clamp` restantes (`film/clock.ts`, `film/timeline.ts`, `film/audio.ts`,
   `terrain/dem.ts`) → `core/math.ts` ; passe de performance de la scène (pas de rendu continu à l'arrêt, nuages moins
   chers en aperçu).

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

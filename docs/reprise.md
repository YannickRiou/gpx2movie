# État du projet et reprise

Mis à jour le 2026-10-07. `master` réécrit sans trailers et poussé. PR « phases 2 à 5 » :
https://github.com/YannickRiou/gpx2movie/pull/1 (`phase3-atmosphere` → `master`, à fusionner par l'utilisateur). Travail en
cours sur la branche `timeline` (partie de `phase3-atmosphere`), une PR par fonctionnalité.

Pousser : `~/.gitconfig` réécrit les URL GitHub vers le SSH du compte `yriouvortex` (sans droits sur le dépôt) et git 2.25
ignore `GIT_CONFIG_GLOBAL` ; passer par le compte `YannickRiou` de `gh` avec un HOME temporaire :

```bash
G=$HOME/.config/gh; T=$(mktemp -d); HOME=$T GH_CONFIG_DIR=$G git -c credential.helper='!gh auth git-credential' push https://github.com/YannickRiou/gpx2movie.git <branche>; rm -rf $T
```

## Environnement (WSL)

- Node 24 via nvm : `source ~/.nvm/nvm.sh && nvm use 24` avant `npm …` (les chemins Windows de `CLAUDE.md` ne valent pas ici).
- Vérifications : `npm run typecheck`, `npm run lint`, `npx vitest run --maxWorkers=1` (un seul cœur évite les délais de
  démarrage des workers quand la machine est chargée).
- Contrôle visuel sans écran : Chromium headless (`~/.cache/ms-playwright/chromium_headless_shell-1223`) piloté par
  puppeteer-core (`~/.npm/_npx/e0b87bb3fb84adaa/node_modules/puppeteer-core`), GPU logiciel (SwiftShader) : très lent, compter
  20–40 s par capture et un seul navigateur à la fois. Script générique dans le répertoire temporaire de session (effacé au
  redémarrage) — à recréer : charge la page, clique « Charger l'exemple », règle des curseurs / cases / listes par libellé,
  capture.
- Ne jamais mentionner d'outil d'IA dans le code, les commentaires, la doc ou les messages de commit (pas de trailer).
- Charte « Carte alpine » (`src/ui/theme.css`), pas la charte Vortex.

## Fait et commité (du plus récent au plus ancien)

| Commit | Contenu |
|---|---|
| `ef6fe3e` | l'export suit le rythme du survol (ralentis, pauses) |
| `814fb37` | export vidéo image par image (MP4 H.264, repli HEVC / WebM VP9 / VP8), habillage incrusté, annulation |
| `ca1d5cc` | rythme : ralentis et pauses aux temps forts (montées, cols, sommets) |
| `736b1c5` | polices embarquées (hors ligne) |
| `1f3eccc` | mini-carte, étiquettes effacées derrière les cartes, mise à niveau des anciens réglages (`SETTING_UPGRADES`) |
| `0f4ac4b` | habillage du film (3 styles, cartes, compteurs, profil, logo, météo, texte) |
| `5ca3c0f` | repères OpenStreetMap (Overpass, cache, étiquettes 3D) |
| `e98519d` | montées détectées (cat. 4 à HC), waypoints GPX, étiquettes 3D WebGL |
| `8da79b1` | styles de caméra (poursuite, hélicoptère, orbite, dessus, cinéma), préréglages, durée |
| `0a19626` | météo historique Open-Meteo (panneau) |
| `f9ddccd` | montage étiquettes + export dans la scène, pont habillage → export |
| `f48ab83` | ombres portées, soleil à l'heure de la sortie, exposition auto, trace colorée, document de projet, fonds de carte |
| `fd1a4f0` | atmosphère physique Takram (ciel, brume, nuit) |
| `a68ee54` | phase 2 : survol, timeline, profil |

Le détail technique de chaque module est dans `ARCHITECTURE.md`, la feuille de route dans `README.md`.

## Travaux en cours

Lancer `git status` et `npm run typecheck` en premier.

1. **Course fantôme — faite et montée** (`<RaceMarkers />` après `<FlyoverRig />`), documentée. Reste un contrôle visuel :
   taille et couleur des marqueurs (atmosphère active ou non), halo sur neige et forêt, classement en direct, options
   désactivées sans horodatage. Limite : les arrêts de la trace de tête sont franchis instantanément.
2. **Export : vitesse et formats × résolutions — commités (`2b467e7`)** : préchargement des tuiles, attente limitée aux
   tuiles visibles (délai 5 s), replaquage synchrone, second placement de caméra seulement si le sol bouge de plus d'1 m ;
   formats 16:9 / 9:16 / 1:1 / 4:5 / 21:9 × 720p / 1080p / 1440p / 4K.
   - **Mesure à refaire sur une machine avec GPU** (décision de l'utilisateur : plus de benchmark sur la machine WSL, dont le
     GPU logiciel SwiftShader fausse tout). Mesure partielle WSL, 320×180, 10 i/s, 3 s, cache froid : ≈ 33 s / image après
     (27 images sur 30) contre 73 s avant, 12 délais dépassés contre 14. Le poste « encodage » (≈ 22 s / image) est en fait
     la copie de l'image WebGL (`composeFrame` → `drawImage`) qui attend la fin du rendu GPU.
   - **Comment mesurer** : lancer un export depuis le panneau ; à la fin, la console affiche
     `[export] N images (M rendues) en … s : rendu … s, attente des tuiles … s, encodage … s, K délai(s) dépassé(s)`.
     Faire deux exports identiques de suite (cache froid puis chaud). Pour un « avant », comparer avec `c8a00ed`.
   - Échelle de rendu appliquée à la trace (`TrackLines.tsx`) et aux étiquettes ; à vérifier à l'œil sur un export 4K.
3. **Météo dans la scène — faite** (`src/weather/sceneWeather.ts`, `src/scene/weatherEffect.ts`, réglage
   `settings.weatherScene`), documentée, vérifiée sur données réelles (effet discret le jour de l'exemple) et synthétiques
   (couvert, pluie, brouillard). Suite possible : nuages volumétriques `@takram/three-clouds` (voir ARCHITECTURE.md).

4. **Film et timeline, incrément 1 sur 4 — fait (`b7ffe55`)** : modèle pur du film (`src/film/model.ts`, réglage
   `settings.film`), assemblage automatique (`src/film/assemble.ts`), horloge du film (`src/film/clock.ts`) qui remplace le
   rythme dans l'aperçu (`FlyoverRig`) et l'export (`ExportController`), caméra des plans d'ouverture / clôture et des arrêts
   (`src/flyover/filmCamera.ts`), pauses du rythme devenues des arrêts (`flightPacing`). Aucune interface ajoutée (les
   panneaux caméra et export lisent l'horloge par `usePacing`). Détail : ARCHITECTURE.md, « Film et timeline ».
   - **Contrôle visuel à faire** : ouverture « descente » au lancement (la vue d'ensemble plonge vers le départ sans virage ni
     traversée du relief), raccord avec chaque style de caméra (orbite et cinéma compris), clôture en fin de lecture, export
     9:16 (toute la trace dans le cadre), arrêts avec rythme actif (pause tenue, caméra fixe), pause dans l'ouverture puis
     réglage caméra, image fixe pendant l'ouverture.
   - **Incrément 2 (timeline sous la vue) — fait, non commité** : `src/film/timeline.ts` (pur, testé : échelle, règle,
     aimantation, `dragFilm`, `stopPositionAt`, ajouts / retraits), `src/ui/Timeline.tsx` réécrit (pistes Plans / Arrêts /
     Textes, règle en temps du film, zoom Ctrl+molette, clavier), `src/ui/FilmInspector.tsx`, vue 3D dans `.view__stage`
     au-dessus de la timeline. Film : `autoMode` (`'temps-forts'` pour les nouveaux projets : un arrêt en orbite de 4 s à chaque
     temps fort même rythme désactivé ; `'rythme'` pour les anciens, par `withFilmDefaults` et la migration v1 → v2 du
     document), `materializeStops` à la première retouche d'un arrêt. Préréglages : seuls ouverture et clôture du film.
     `FlyoverRig` garde le temps du film quand l'horloge change. Détail : ARCHITECTURE.md, « Film et timeline ».
   - **Contrôle visuel à faire (incrément 2)** : à 1280 px de large, barre sur une ligne (sinon passage à la ligne propre),
     hauteur ~150 px, pistes repliées / dépliées ; profil dans le bloc du survol, plat pendant les arrêts ; glisser un arrêt
     (le bloc suit le pointeur, aimantation sur les temps forts, Alt sans aimant), étirer son bord droit, déplacer / étirer un
     texte par ses deux bords, bord de l'ouverture / clôture ; un geste = un Ctrl+Z ; arrêts pointillés tant qu'automatiques,
     pleins après une retouche, case « Arrêts automatiques » ; règle cliquée dans l'ouverture et la clôture (la caméra suit le
     plan), retouche en pause sans saut de la tête de lecture ; inspecteur au-dessus de la timeline sans masquer la barre,
     champs (texte, sous-titre, position, taille, début, durée ; libellé, durée, caméra ; style, durée) ; Espace, Suppr,
     flèches, Échap ; Ctrl+molette (zoom autour du pointeur, pas de zoom de la page) et défilement horizontal ; focus visible
     sur les blocs ; contrastes de la pastille « modifié » sur fond encre ; légende de couleur de la trace en bas à gauche.
   - **Incrément 3 (textes de la timeline dans le film) et crédits des sources incrustés — faits, non commités** :
     `drawOverlay(…, extras)` reçoit le temps du film (`OverlayTime`, `overlayTime(clock, progress, timeS)`), les textes
     (`settings.film.texts`, fondus 0,4 s, style du « Texte libre », empilés par ancre, un tiers de largeur à côté d'un texte
     d'une autre ancre de la rangée) et les crédits (`overlayCredits`, mêmes chaînes que la barre d'état ; réglage
     `overlay.credits { enabled, position }`, activés par défaut et pour les anciens projets, dessinés même habillage
     désactivé). Cartes d'ouverture / clôture calées sur le temps du film (première image → ouverture + `end` × vol ;
     ouverture + `start` × vol → dernière image), étiquettes 3D comprises. Export : une image tenue est rendue à nouveau
     quand l'habillage minuté change (`overlayTimedState`). Détail : ARCHITECTURE.md, « Habillage du film ».
   - **Contrôle visuel à faire (incrément 3 et crédits)** : texte de la timeline dans les 3 styles (aperçu et export,
     tailles 0,5 et 2), fondus d'entrée / sortie, sous-titre, deux textes à la même ancre (empilés) et à deux ancres d'une
     rangée (pas de chevauchement), texte long (deux lignes puis « … »), texte posé pendant un arrêt « fixe » (fondu
     visible à l'export) ; carte d'ouverture pendant le plan d'ouverture puis effacée peu après le départ, carte de clôture
     tenue pendant la clôture, étiquettes 3D effacées en même temps ; ligne des crédits dans les 4 coins et les 3 styles, sur
     neige et sur forêt, en 9:16 (repliée sur deux lignes ?), en 720p (lisibilité), avec météo et repères chargés, sans
     habillage, et absente une fois décochée ; recouvrement possible avec la légende de couleur de la trace (bas à gauche de
     l'aperçu, hors export).
   - Incrément suivant : 4 piste des médias (accès aux fichiers derrière une abstraction, pour le web et Tauri).

Pour intégrer proprement : finir chaque chantier, `npx vitest run --maxWorkers=1` + typecheck + lint verts, puis un commit
par fonctionnalité (les fichiers partagés `store.ts`, `document.ts`, fixtures de test contiennent des morceaux de plusieurs
chantiers : committer par hunks ou tout ensemble une fois l'arbre vert).

## Prochaines étapes proposées (après les travaux en cours)

- Contrôle visuel groupé : mini-carte dans les 3 styles, polices hors ligne, ralentis (sensation à 35 % sur ±1 km), course
  fantôme, étiquettes effacées sous les cartes, export complet 1080p d'un film de 60 s.
- Phase 4 restante : timeline de montage (incrément 4, ci-dessus), caméra par étape et images-clés, plan de situation
  (ouverture depuis le pays), ouverture / fermeture « balayage », vitesse par portion à la main, couleurs et polices par widget, thèmes de film, éditeur en modes
  (Trajet, Carte, Habillage, Survol, Prises de vue). Pastille « modifié » + « Par défaut » : faite par panneau,
  contrôle visuel à faire (position sur la ligne du titre, titres longs, bouton désactivé pendant un export) ; reste le
  grain plus fin (par sous-groupe, par réglage) et les sections hors panneaux (étiquettes des montées, course fantôme).
- Phase 3 restante : eau réfléchissante (masque d'eau), hauteurs calées sur le géoïde, nuages volumétriques
  (`@takram/three-clouds` compatible, non installé).
- Phase 5 restante : écriture directe sur disque pour les films longs. Image fixe PNG / JPEG faite (bouton « Image fixe »
  du panneau d'export) : contrôle visuel à faire (voir ARCHITECTURE.md, export).
- Phase 7 : vidéo embarquée synchronisée, comparatif avant / après (photos IGN anciennes), rendu en lot, affiche, calage musical,
  reconnaissance d'itinéraire.
- Limites connues : OpenTopoMap à exclure des futurs packs hors ligne ; Open-Meteo et EOX non commerciaux.
- Orbite et cinéma pendant les pauses du rythme, pause finale dans l'aperçu : corrigés (temps du film `playback.timeS`) ;
  contrôle visuel à faire (aperçu et export avec rythme actif).

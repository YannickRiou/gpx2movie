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
- Serveur de dev utilisé pour les captures : `npm run dev -- --port 5190` (à relancer).
- Contrôle visuel sans écran : Chromium headless (`~/.cache/ms-playwright/chromium_headless_shell-1223/…`) piloté par
  puppeteer-core (`~/.npm/_npx/e0b87bb3fb84adaa/node_modules/puppeteer-core`), GPU logiciel SwiftShader : 20–40 s par
  capture, **un seul navigateur à la fois**. Script générique à recréer dans le répertoire temporaire de session : charge
  `http://127.0.0.1:<port>/`, clique « Essayer avec l'exemple », exécute des étapes (`click` par texte de bouton, `check`
  par libellé, `eval` JS, `shot`), viewport via `W`/`H`.
- **Ne plus mesurer la vitesse de l'export sur cette machine** (décision de l'utilisateur, GPU logiciel) : il la mesure
  sur une machine avec GPU. La console affiche en fin d'export `[export] N images … rendu … attente … encodage …`.
- Sous-agents : interdiction totale de git (deux ont fait `git stash` / `pop` malgré la consigne, sans perte constatée).
- Aucune mention d'outil d'IA nulle part (code, doc, commits : pas de trailer). Charte « Carte alpine » (`src/ui/theme.css`),
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

Rien de non commité. Vu à l'écran le 2026-10-08 (1440 × 900) : inspecteur ancré, menu du clic droit sur la trace, barre
de la timeline sur une ligne avec l'inspecteur ouvert, tiroir d'export avec l'habillage.

## Contrôles visuels encore à faire (jamais vus à l'écran)

- Timeline : glisser un arrêt (aimantation, Alt), étirer un texte des deux bords, bord de l'ouverture, Ctrl+Z par geste,
  Ctrl+molette, un film long (défilement).
- Photos : ajout, miniatures, plein écran avec zoom lent, carte dans les 3 styles, placement GPS, export avec photo.
- Habillage : textes à plusieurs positions, cartons d'ouverture / clôture calés sur les plans, crédits dans les 4 coins,
  en 9:16 et 720p.
- Interface : 1280 et 1000 px de large (panneau en tiroir), tiroir d'export pendant un vrai export (« 42 % · Annuler »,
  interface verrouillée), toasts (empilement, « Annuler » après « Par défaut »), dépôt d'un fichier (voile), onglet Projet,
  heure du soleil : curseur aligné sur les repères lever / coucher, boutons sur deux lignes à 280 px.
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

## Prochaines étapes proposées

1. Fusion de la PR #2 par l'utilisateur ; ensuite repartir de `master` avec une branche par fonctionnalité.
2. Contrôles visuels ci-dessus (surtout 1280 / 1000 px, glisser dans la timeline, photos, export réel).
3. Timeline : vidéos dans la piste Médias (modèle déjà prêt, `kind: 'video'`), photo attachée à un arrêt, défilement
   automatique pendant un glisser au bord, textes ancrés à un arrêt, mémoriser l'état ouvert / fermé des sections.
4. Restes d'interface : `importError` encore dans le store (plus affiché) ;
   toast « Préréglage appliqué » / « Export annulé » ; section « Repères » repliable ; glisser lent de curseur = plusieurs
   pas d'annulation (> 400 ms) ; lever / coucher affichés en heure solaire, pas en heure légale.
5. Phase 6 (bureau, Tauri) : WebCodecs absent sous Linux (WebKitGTK) → encodeur natif ; `dragDropEnabled` intercepte les
   dépôts HTML5 ; accès disque pour les photos derrière `readPhoto`. Hébergement en sous-dossier : `/fonts/`, `/samples/`,
   `/favicon.svg` sont absolus → `import.meta.env.BASE_URL` (seulement si nécessaire).
6. Phase 3 restante : eau réfléchissante, géoïde, nuages volumétriques. Phase 5 : écriture directe sur disque pour les films
   longs. Phase 7 : vidéo embarquée, comparatif photos IGN anciennes, rendu en lot, affiche, calage musical.

## Limites et points ouverts

- Licence du SDK Garmin FIT (non libre, redistribution « sauf cas prévus ») : à trancher avant diffusion publique ; usage
  perso OK. Conditions Esri (sans clé) à relire. Open-Meteo et EOX non commerciaux ; OpenTopoMap CC BY-SA, à exclure des
  futurs packs hors ligne. Catalogue d'étoiles de Yale : licence non indiquée.
- Photos HEIC refusées (le navigateur ne les décode pas) ; EXIF lu seulement dans les JPEG.
- Firefox / Safari non testés pour l'export (WebCodecs). HTTPS obligatoire hors `localhost`.
- Aucun test de rendu de composants (pas de Testing Library) ; tout le visuel se vérifie à la main, par captures.

# État du projet et reprise

Mis à jour le 2026-10-07. Branche de travail : `phase3-atmosphere` (non poussée). `master` distant contient les phases 1–2
réécrites sans trailers (`34ce39a`) ; le force-push de `master` reste à faire depuis un compte ayant les droits sur
`YannickRiou/gpx2movie` :

```bash
git push --force-with-lease=master:a607fc8d3cff17764b0318f0b66d7adfd92a0952 origin master
```

Puis supprimer la sauvegarde locale : `git branch -D backup/avant-reecriture`.

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

Pour intégrer proprement : finir chaque chantier, `npx vitest run --maxWorkers=1` + typecheck + lint verts, puis un commit
par fonctionnalité (les fichiers partagés `store.ts`, `document.ts`, fixtures de test contiennent des morceaux de plusieurs
chantiers : committer par hunks ou tout ensemble une fois l'arbre vert).

## Prochaines étapes proposées (après les travaux en cours)

- Contrôle visuel groupé : mini-carte dans les 3 styles, polices hors ligne, ralentis (sensation à 35 % sur ±1 km), course
  fantôme, étiquettes effacées sous les cartes, export complet 1080p d'un film de 60 s.
- Phase 4 restante : caméra par étape et images-clés, plan de situation (ouverture depuis le pays), ouverture / fermeture
  « balayage » ou « saut », vitesse par portion à la main, couleurs et polices par widget, thèmes de film, éditeur en modes
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

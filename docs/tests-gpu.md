# Tests à faire sur une machine avec GPU

Ce qui n'a jamais été vu ni mesuré en vrai : la machine de développement n'a qu'un GPU simulé (SwiftShader), trop lent
pour juger la fluidité, l'export ou le son. Cocher au fur et à mesure ; noter le problème et les étapes pour le
reproduire à côté de la case.

## Préparer

- Chrome ou Edge récent (WebCodecs), puis Firefox pour les replis. Haut-parleurs ou casque.
- `npm ci`, puis `npm run dev` ; pour l'application de bureau (Windows) : prérequis Tauri du README, `npm run tauri:dev`.
- Vérifications automatiques d'abord : `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build`, puis
  `npm run e2e` (tests de bout en bout ; plus rapides avec un vrai GPU).
- Fichiers utiles : une trace GPX ou FIT **horodatée**, une trace sans heure, des photos JPEG avec GPS, une vidéo MP4 de
  téléphone ou GoPro **filmée pendant cette sortie**, un WebM, un MOV, une musique MP3 de 3 min, un fichier de plus de
  50 Mo.
- Console du navigateur ouverte : aucune erreur rouge attendue. En fin d'export, la ligne `[export] …` donne les temps
  (rendu, attente des tuiles, encodage) et le nombre de délais dépassés.

## 1. Priorité : export réel

- [ ] Vitesse : film de 60 s en 1080p 30 i/s, temps total et ligne `[export]` ; comparer avec le commit `c8a00ed`
      (avant optimisation) si utile.
- [ ] 4K : même film, mémoire de l'onglet stable (Gestionnaire des tâches du navigateur), trace et étiquettes à la même
      échelle qu'en 1080p.
- [ ] 9:16 et 1:1 : rien de coupé, habillage et crédits bien placés.
- [ ] Écriture directe sur le disque (Chrome / Edge) : fenêtre « Enregistrer » au clic, fichier qui grossit pendant
      l'export, MP4 lu par VLC, le lecteur du système et un logiciel de montage (durée, recherche) ; « .webm » tapé → WebM.
- [ ] Annuler pendant l'export, ou fermer la fenêtre « Enregistrer » : aucun fichier restant, vue et interface rétablies.
- [ ] Firefox : export en mémoire, alerte au-delà de 1,5 Go estimés, téléchargement.
- [ ] Nuages activés (réglage « Météo » ou « Manuel 50 % ») : coût de l'export, mêmes images d'un export à l'autre.
- [ ] Image fixe PNG et JPEG, avec et sans habillage.
- [ ] Rendu en lot : 16:9 1080p + 9:16 1080p + image fixe + affiche dans un dossier ; noms des fichiers, « Tout
      annuler » pendant le 2ᵉ film (fichier commencé supprimé), format refusé par l'encodeur marqué en échec.
- [ ] Affiche A4 portrait puis A3 paysage : vue d'ensemble nord en haut, crédits lisibles à l'impression ; limite de taille
      de la carte graphique en A3 (rendu de 17 Mpx).

## 2. Son (à écouter)

- [ ] Musique : ajout par « Options » et par dépôt (MP3, M4A, OGG, WAV, FLAC), forme d'onde, lecture synchronisée à ×1,
      ×2, ×0,5, fondus audibles, bouton haut-parleur, « Caler la durée du film sur la musique ».
- [ ] Export avec musique : son calé sur l'image du début à la fin, AAC dans le MP4 (Windows / macOS), Opus dans le WebM ;
      lu partout.
- [ ] Son des vidéos (en cours de réalisation) : son du clip à ×1, musique baissée sous le clip si l'option est cochée,
      clip qui suit la vitesse du survol muet ; export identique à l'aperçu.

## 3. Fluidité de l'aperçu

- [ ] Lecture de l'exemple dans les 5 styles de caméra : pas d'à-coup, pas de trou dans le relief, ralentis et arrêts
      doux, ouverture et clôture (descente depuis la vue d'ensemble).
- [ ] Atmosphère, ombres, nuages (Météo / Manuel / Aucun) et eau : images par seconde acceptables ; nuages et eau au
      soleil rasant (reflets, vaguelettes), pas de taches grises sur l'imagerie.
- [ ] Étalonnage (en cours de réalisation) : préréglages Naturel → Noir et blanc, aucun coût en « Naturel ».
- [ ] Style de la trace et marqueur (en cours de réalisation) : épaisseur, tirets, halo, trace qui se dessine, figurines et
      avatar.
- [ ] Zones de sécurité (en cours de réalisation) : touche G, guides visibles en 9:16, absents de l'export.

## 4. Montage dans la timeline

- [ ] Glisser un arrêt (aimantation, Alt sans aimantation), étirer un texte des deux bords, bord de l'ouverture, un Ctrl+Z
      par geste, Ctrl+molette, film long (défilement).
- [ ] Vitesse par portion : bloc ×2 puis ×0,5, accélération sans à-coup aux bords, « garder la durée ».
- [ ] Photos : ajout, miniatures, « Placer sur le parcours » (GPS), plein écran avec zoom lent, carte dans les 3 styles.
- [ ] Vidéos : MP4, WebM, MOV ; refus au-delà de 50 Mo ; lecture synchronisée ×0,5 à ×4 ; bord gauche (début dans la
      vidéo) ; vidéo pendant un arrêt ; export image par image.
- [ ] Vidéo calée sur le parcours, avec les fichiers de la même sortie : iPhone, Android, GoPro (heure locale), DJI —
      l'heure lue est-elle bien le **début** du tournage ? « Suivre la vitesse du survol » : image calée sur le lieu, figée
      pendant un arrêt.
- [ ] Vue 3D : clic sur la trace = tête de lecture ; clic droit = menu (arrêt, texte, vitesse ici) ; glisser la caméra ne
      déclenche rien ; Firefox (menu du navigateur bien remplacé).
- [ ] Projet avec textes, photos, vidéos et musique : enregistrer, recharger la page, rouvrir.

## 5. Interface

- [ ] Largeurs 1440, 1280 et 1000 px : panneau, inspecteur à droite, tiroir d'export, barre de la timeline sur une ligne,
      panneau en tiroir sous 1024 px (fermé au départ, Échap ou clic à côté le ferment).
- [ ] Pendant un export : bouton « 42 % · Annuler », interface verrouillée (aussi pendant tout un rendu en lot).
- [ ] Messages éphémères (empilement, « Annuler » après « Par défaut »), dépôt d'un fichier n'importe où (voile),
      infobulles jamais coupées, aide « ? ».
- [ ] Heure du soleil : curseur aligné sur les repères lever / coucher, heure locale avec un FIT.
- [ ] Course fantôme (deux traces), mini-carte dans les 3 styles d'habillage, étiquettes effacées sous les cartes.

## 6. Hors ligne

- [ ] Préparer l'exemple en 2 km (avec IGN puis Esri) : estimation, progression, Pause / Reprendre / Annuler, pack listé.
- [ ] Couper le réseau (DevTools › Network › Offline ou Wi-Fi) et recharger : vue et export sans trou dans le couloir.
- [ ] Supprimer le pack : tuiles reprises du réseau. Firefox (stockage persistant), Safari (quota).

## 7. Application de bureau (Windows)

- [ ] `npm run tauri:dev` : fenêtre, carte, météo et repères chargés (règles de sécurité de la fenêtre).
- [ ] Ouvrir / Enregistrer avec les fenêtres du système ; Annuler n'écrit rien.
- [ ] Export vidéo écrit sur le disque, rendu en lot dans un dossier, affiche.
- [ ] Pack hors ligne : dossier `%APPDATA%\io.github.yannickriou.openflyover\tiles` créé, relu au redémarrage sans
      réseau, vidé par « Supprimer ».
- [ ] `npm run tauri:build` : installeur produit, application installée qui démarre.

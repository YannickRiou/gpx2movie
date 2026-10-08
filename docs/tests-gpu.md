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
- [ ] Habillage seul (fond transparent) : export rapide, sans attente des tuiles ; WebM lu avec sa transparence (Chrome
      sur un fond coloré, Kdenlive ou Shotcut), posé sur la vidéo normale du même film : compteurs, profil, carte,
      textes et photos tombent image pour image ; annuler ne laisse aucun fichier.
- [ ] Rendu en lot : 16:9 1080p + 9:16 1080p + image fixe + affiche dans un dossier ; noms des fichiers, « Tout
      annuler » pendant le 2ᵉ film (fichier commencé supprimé), format refusé par l'encodeur marqué en échec.
- [ ] Un film par trace : dossier de 3 GPX / FIT + un fichier cassé, 16:9 720p ; un film par trace, nommé d'après son
      fichier, arrêts et titres des repères refaits pour chaque trace, fichier cassé marqué en échec ; à la fin, les
      traces et le film d'avant reviennent (« Enregistré » inchangé, Ctrl+Z sans effet du lot) ; « Tout annuler ».
- [ ] Affiche A4 portrait puis A3 paysage : vue d'ensemble nord en haut, crédits lisibles à l'impression ; limite de taille
      de la carte graphique en A3 (rendu de 17 Mpx).
- [ ] Affiche de plusieurs traces (3 sorties, puis une course fantôme de 3 traces, puis 8 sorties) et « Carte à plat » :
      toutes les traces cadrées, chacune dans sa couleur, liste lisible dans les 5 formats × 3 styles (8 sorties :
      seulement les sommes) ; carte à plat nette, nord en haut, sans brume, trace bien placée sur l'image, annulation.

## 2. Son (à écouter)

- [ ] Musique : ajout par « Options » et par dépôt (MP3, M4A, OGG, WAV, FLAC), forme d'onde, lecture synchronisée à ×1,
      ×2, ×0,5, fondus audibles, bouton haut-parleur, « Caler la durée du film sur la musique ».
- [ ] Export avec musique : son calé sur l'image du début à la fin, AAC dans le MP4 (Windows / macOS), Opus dans le WebM ;
      lu partout.
- [ ] « Caler sur le rythme » sur 3 vraies musiques (pop ou électro, acoustique, sans batterie) : tempo annoncé juste
      (comparer à un compteur de BPM), marques du bloc sur les temps, arrêts et titres qui tombent sur le temps à
      l'écoute (à ×1 et dans l'export) ; musique sans rythme net : message « trop incertain », rien ne bouge ; noter si
      les débuts de mesure tombent sur le 1er temps.
- [ ] Son des vidéos : son du clip à ×1, réglage du volume en direct, pas de clic au début ni à la fin d'un clip, musique baissée sous le clip si l'option est cochée,
      clip qui suit la vitesse du survol muet ; export identique à l'aperçu.

## 3. Fluidité de l'aperçu

- [ ] Lecture de l'exemple dans les 5 styles de caméra : pas d'à-coup, pas de trou dans le relief, ralentis et arrêts
      doux, ouverture et clôture (descente depuis la vue d'ensemble).
- [ ] Ouverture et clôture « Depuis la région » (16:9 et 9:16, trace courte et longue) : relief chargé à temps pour la vue
      de très haut (pas de bord du terrain ni de tuiles floues), plongée vers la trace et remontée sans à-coup.
- [ ] Transitions des plans (inspecteur Ouverture / Clôture) : « Coupe » nette au début et à la fin du vol ; « Fondu au
      noir » et « Fondu au blanc » (0,3 s et 2 s) : l'image passe par la couleur, le saut de caméra caché au plus sombre,
      crédits seuls visibles par-dessus, tuiles chargées au retour de l'image ; même rendu dans la vidéo exportée ;
      « Enchaîné » identique à avant.
- [ ] Atmosphère, ombres, nuages (Météo / Manuel / Aucun) et eau : images par seconde acceptables ; nuages et eau au
      soleil rasant (reflets, vaguelettes), pas de taches grises sur l'imagerie.
- [ ] Étalonnage (onglet Carte › Couleurs) : préréglages Naturel → Noir et blanc, avec et sans atmosphère ; aucun
      coût en « Naturel » ; sans atmosphère, ciel étalonné sans raccord visible avec le relief ; vignette en 16:9 et 9:16.
- [ ] Lissage des bords (atmosphère activée) : pas de liseré clair ni d'escalier sur les crêtes et la trace.
- [ ] Trace et marqueur (onglet Survol) : épaisseur, tirets et points pendant le vol, halo sur forêt et sur neige, trace
      qui se dessine collée au marqueur, figurines lisibles et retournées dans les virages, avatar rond ; « Boule » par
      défaut identique à avant.
- [ ] Zones de sécurité : bouton sous « Recadrer » ou touche G, bandes des réseaux en 9:16 et 4:5, marges en 16:9,
      absentes de l'export.

## 4. Montage dans la timeline

- [ ] Glisser un arrêt (aimantation, Alt sans aimantation), étirer un texte des deux bords, bord de l'ouverture, un Ctrl+Z
      par geste, Ctrl+molette, film long (défilement).
- [ ] Vitesse par portion : bloc ×2 puis ×0,5, accélération sans à-coup aux bords, « garder la durée ».
- [ ] Caméra des arrêts : « Tour lent » au sommet (le tour revient sans à-coup), « Vue large » (recul et montée
      doux), « Fixe » avec le style Orbite (la caméra ralentit, s'arrête, repart), « Comme le film ».
- [ ] Cadrages (« Garder ce cadrage ici », losanges de la piste « Plans ») : vue haute et large sur une longue portion,
      passage doux d'un cadrage à l'autre et retour au réglage du film, sans à-coup aux bords ; losange glissé ; export
      identique à l'aperçu.
- [ ] Photos : ajout, miniatures, « Placer sur le parcours » (GPS), plein écran avec zoom lent, carte dans les 3 styles.
- [ ] Vidéos : MP4, WebM, MOV ; refus au-delà de 50 Mo ; lecture synchronisée ×0,5 à ×4 ; bord gauche (début dans la
      vidéo) ; vidéo pendant un arrêt ; export image par image.
- [ ] Vidéo calée sur le parcours, avec les fichiers de la même sortie : iPhone, Android, GoPro (heure locale), DJI —
      l'heure lue est-elle bien le **début** du tournage ? « Suivre la vitesse du survol » : image calée sur le lieu, figée
      pendant un arrêt.
- [ ] Vue 3D : clic sur la trace = tête de lecture ; clic droit = menu (arrêt, texte, vitesse ici) ; glisser la caméra ne
      déclenche rien ; Firefox (menu du navigateur bien remplacé).
- [ ] Points d'intérêt : clic droit sur le relief hors de la trace puis sur la trace › « Point d'intérêt ici », nom tapé ;
      étiquette à épingle au bon endroit, cachée derrière une crête et sous les cartes d'ouverture, présente dans l'export ;
      « Ajouter au marqueur », renommer, « Arrêt », ✕ et Ctrl+Z dans l'onglet Carte.
- [ ] Ralentir et titrer aux repères : trace alpine neuve, repères chargés → titres « Col … · altitude » en haut au centre
      au passage, ralenti doux sans à-coup, pas de ralenti sur un arrêt (titre seul) ; décocher / recocher, Ctrl+Z ;
      déplacer un titre décoche la case ; ancien projet rouvert inchangé ; export identique à l'aperçu.
- [ ] Projet avec textes, photos, vidéos et musique : enregistrer, recharger la page, rouvrir.

## 5. Interface

- [ ] Largeurs 1440, 1280 et 1000 px : panneau, inspecteur à droite, tiroir d'export, barre de la timeline sur une ligne,
      panneau en tiroir sous 1024 px (fermé au départ, Échap ou clic à côté le ferment).
- [ ] Pendant un export : bouton « 42 % · Annuler », interface verrouillée (aussi pendant tout un rendu en lot).
- [ ] Messages éphémères (empilement, « Annuler » après « Par défaut »), dépôt d'un fichier n'importe où (voile),
      infobulles jamais coupées, aide « ? ».
- [ ] Heure du soleil : curseur aligné sur les repères lever / coucher, heure locale avec un FIT.
- [ ] Course fantôme (deux traces), mini-carte dans les 3 styles d'habillage, étiquettes effacées sous les cartes.
- [ ] Habillage › « Couleurs et polices » : nuanciers dans le panneau de 320 px, accent, texte et fond appliqués à
      l'aperçu et à l'export, « Revenir au style » ; un seul Ctrl+Z après un glissé dans le sélecteur de couleur.
- [ ] Classement de la course fantôme dans les 3 styles : points de couleur et écarts alignés, pas de saut de largeur,
      « Tête » puis « Arrivée ».

- [ ] Fermer l'onglet (Chrome, Firefox) : rien demandé sans changement ni avec un projet de « Mes projets » modifié
      il y a plus de 3 s ; « Quitter le site ? » avec « Modifié » hors « Mes projets », pendant un export, ou juste après
      un changement d'un projet gardé (rouvert : le changement est là).

- [ ] Enchaîner deux traces d'une randonnée de deux jours (onglet Trace, puis au dépôt des deux fichiers) : une seule
      trace « J1 → J2 » ou au nom commun, aucun trait entre la fin du jour 1 et le départ du jour 2, marqueur qui saute
      ce trou ; « Annuler » rend les deux traces.
- [ ] Sortie prévue : GPX Komoot ou Visorando sans heures, « Prévoir la sortie » (après-demain 8 h, randonnée) ;
      pastille « horaires estimés », heure d'arrivée plausible, soleil et heure de la timeline qui avancent, météo
      « Prévision » dans le panneau et la scène, compteur « Temps » précédé de « ≈ » ; un départ à 20 jours n'a pas de
      météo et le dit ; « Effacer les horaires » revient à la trace sans heures ; projet rouvert : horaires et pastille
      conservés.
- [ ] Feuille de route (onglet Trace) : itinéraire alpin, « Repères » allumé ; pentes raides et cols, refuges, points
      d'eau dans l'ordre, sommet de montée confondu avec le col ; clic sur une ligne = marqueur et caméra au bon endroit ;
      heures « ≈ » après « Prévoir la sortie » ; « Copier » puis coller dans un éditeur, « Enregistrer (.txt) » (site et
      bureau) ; colonnes alignées dans le panneau de 320 px.

## 6. Hors ligne

- [ ] Préparer l'exemple en 2 km (avec IGN puis Esri) : estimation, progression, Pause / Reprendre / Annuler, pack listé.
- [ ] Couper le réseau (DevTools › Network › Offline ou Wi-Fi) et recharger : vue et export sans trou dans le couloir.
- [ ] Supprimer le pack : tuiles reprises du réseau. Firefox (stockage persistant), Safari (quota).

## 6 bis. Import Strava (application Strava personnelle créée sur strava.com/settings/api)

- [ ] Site (`npm run dev`, domaine de rappel `localhost`) : « Importer depuis Strava », Client ID et Secret, « Se
      connecter » : fenêtre Strava, « Autoriser », fenêtre refermée, liste des activités ; traces déjà chargées intactes.
- [ ] Site : « Annuler » pendant l'attente, refus sur Strava (« Autorisation refusée »), mauvais Client Secret (message,
      formulaire gardé), fenêtres surgissantes bloquées (message).
- [ ] Site : « Plus », recherche par nom, import de deux activités (vélo avec puissance, randonnée) : noms, dates,
      activité, D+, fréquence cardiaque dans les compteurs ; activité sans GPS refusée avec son nom.
- [ ] Site : jeton expiré (mettre `expiresAt` à 0 dans `openflyover.strava.tokens.v1`) renouvelé sans rien demander ;
      accès retiré sur strava.com/settings/apps → retour à « Se connecter » ; « Déconnecter », « Oublier ces identifiants ».
- [ ] Site hébergé : domaine de rappel = l'hôte du site, même parcours.
- [ ] Bureau (`npm run tauri:dev`, Windows) : « Se connecter » ouvre le navigateur du système sur Strava, la page
      « Connexion transmise » s'affiche, l'application liste les activités ; import ; aucune erreur de CSP en console.

## 7. Application de bureau (Windows, Linux)

- [ ] `npm run tauri:dev` : fenêtre, carte, météo et repères chargés (règles de sécurité de la fenêtre).
- [ ] Ouvrir / Enregistrer avec les fenêtres du système ; Annuler n'écrit rien.
- [ ] Export vidéo écrit sur le disque, rendu en lot dans un dossier, affiche.
- [ ] Pack hors ligne : dossier `%APPDATA%\io.github.yannickriou.openflyover\tiles` créé, relu au redémarrage sans
      réseau, vidé par « Supprimer ».
- [ ] Mes projets : « Garder dans Mes projets », fichiers dans `%APPDATA%\io.github.yannickriou.openflyover\projects`,
      enregistrement automatique quelques secondes après un changement, liste relue au redémarrage, ouvrir, renommer,
      supprimer.
- [ ] Fermer la fenêtre juste après un changement d'un projet de « Mes projets » : fermée sans question, changement là
      au redémarrage ; hors « Mes projets » et « Modifié » : « Enregistrer » (fenêtre d'enregistrement, Annuler y laisse
      la fenêtre ouverte), « Fermer sans enregistrer », « Annuler » ; pendant un export : « Fermer quand même ».
- [ ] `npm run tauri:build` : installeur produit, application installée qui démarre.

Sous Linux (Ubuntu 22.04 ou plus, WebKitGTK sans WebCodecs : export par le `ffmpeg` du système) :

- [ ] `cargo test` dans `src-tauri/` (arguments de ffmpeg, qualité → crf).
- [ ] Sans ffmpeg : le tiroir « Exporter » dit « installez ffmpeg », bouton désactivé, l'image fixe marche.
- [ ] `sudo apt install ffmpeg`, relancer : MP4 (H.264) annoncé ; export 1080p 30 i/s d'un film avec musique, fichier lu
      par VLC et le lecteur du système, son présent et calé, couleurs identiques à l'aperçu.
- [ ] Qualité standard / maximale : tailles différentes, aucune image manquante (nombre d'images = celui du tiroir).
- [ ] Annuler pendant l'export : fichier supprimé, plus de processus `ffmpeg`, rien de `openflyover-*.wav` dans `/tmp`.
- [ ] Rendu en lot dans un dossier (plusieurs formats, dont 9:16) ; 4K si la machine le permet.
- [ ] Échec simulé (`pkill ffmpeg` pendant l'export) : l'export s'arrête avec un message sur ffmpeg, pas de fichier
      partiel.
- [ ] Depuis l'AppImage et depuis le paquet deb : ffmpeg trouvé et lancé (variables d'environnement de l'AppImage).

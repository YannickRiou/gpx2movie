# Polices embarquées

Servies depuis `/fonts/` et déclarées dans `src/ui/fonts.css` : l'interface, l'habillage du film et les étiquettes 3D
n'ont besoin d'aucun accès réseau pour leurs polices.

| Fichier | Famille | Graisses | Version | Licence |
|---|---|---|---|---|
| `fraunces-variable-latin.woff2`, `fraunces-variable-latin-ext.woff2` | Fraunces (variable, axes `opsz` 9–144 et `wght` 100–900) | 100–900 | 1.000 (Google Fonts v38) | SIL OFL 1.1, `OFL-Fraunces.txt` |
| `ibm-plex-sans-variable-latin.woff2`, `ibm-plex-sans-variable-latin-ext.woff2` | IBM Plex Sans (variable, axe `wght`) | 100–700 | 3.201 (Google Fonts v23) | SIL OFL 1.1, `OFL-IBM-Plex.txt` |
| `ibm-plex-sans-condensed-{500,600,700}-latin.woff2`, `…-latin-ext.woff2` | IBM Plex Sans Condensed (statique) | 500, 600, 700 | 1.3 (Google Fonts v15) | SIL OFL 1.1, `OFL-IBM-Plex.txt` |

- **Source** : fichiers WOFF2 servis par l'API Google Fonts CSS2 (`fonts.gstatic.com`), téléchargés le 2026-10-07 et
  copiés sans modification. Projets amont : <https://github.com/undercasetype/Fraunces> et <https://github.com/IBM/plex>.
- **Sous-ensembles** : découpage de Google Fonts, plages `unicode-range` reprises telles quelles dans `fonts.css`.
  - `latin` : U+0000–00FF, Œ œ, ‘ ’ “ ” – — … (ponctuation générale U+2000–206F), €, ™, −. Suffit pour le français.
  - `latin-ext` : Ÿ et les autres lettres latines accentuées (noms de lieux voisins : ł, ř, ő…).
  - Le navigateur ne télécharge un sous-ensemble que si le texte affiché en contient un caractère.
- **Taille totale** : 310 552 octets (≈ 303 Kio) pour les 10 fichiers WOFF2 ; l'interface ne charge en pratique que Fraunces et IBM Plex Sans `latin`
  (113 016 octets, ≈ 110 Kio), plus IBM Plex Sans Condensed `latin` (≈ 58 Kio) avec le style d'habillage « broadcast ».
- Les glyphes absents de ces polices (espace fine insécable U+202F, →, ≈, ▶, ❚) sont dessinés avec une police système.

# Installeurs de l'application de bureau

GitHub construit les installeurs de l'application de bureau (workflow `.github/workflows/desktop.yml`, « Installeurs ») :

| Système | Fichiers |
|---|---|
| Windows | `OpenFlyover_<version>_x64-setup.exe` (NSIS) et `OpenFlyover_<version>_x64_en-US.msi` |
| macOS | `OpenFlyover_<version>_universal.dmg` (Apple Silicon et Intel) |
| Linux | `OpenFlyover_<version>_amd64.AppImage` et `OpenFlyover_<version>_amd64.deb` (Ubuntu 22.04, Debian 12 ou plus récent) |

Compter 15 à 30 minutes par système (le cache Rust raccourcit les suivants).

## Produire les installeurs

**Pour essayer** : sur GitHub, onglet *Actions* › « Installeurs » › *Run workflow* (branche au choix) › *Run workflow*.

**Pour une version** :

1. Mettre le même numéro dans `src-tauri/tauri.conf.json` (`version`) et `src-tauri/Cargo.toml` (`version`), par exemple
   `0.2.0`. C'est ce numéro qui figure dans le nom des fichiers.
2. Créer et pousser l'étiquette : `git tag v0.2.0` puis `git push origin v0.2.0`.

## Où les télécharger

- Après *Run workflow* ou une étiquette : *Actions* › le passage du workflow › en bas, *Artifacts* (un fichier zip par
  installeur, gardé 90 jours).
- Après une étiquette, en plus : *Releases*, une version **brouillon** `OpenFlyover v0.2.0` avec tous les installeurs.
  Elle n'est visible que par le propriétaire du dépôt tant qu'elle n'est pas publiée (*Edit* › *Publish release*). Si
  deux brouillons apparaissent pour la même étiquette (les trois systèmes finissent en même temps), garder celui qui a
  tous les fichiers et supprimer l'autre.

## Sans certificat (situation actuelle)

Les installeurs fonctionnent, mais le système prévient au premier lancement :

- **Windows** (SmartScreen, « Windows a protégé votre ordinateur ») : cliquer **Informations complémentaires**, puis
  **Exécuter quand même**.
- **macOS** : l'application est signée « ad hoc » seulement (`signingIdentity: "-"` dans `tauri.conf.json`, sans quoi
  un Mac Apple Silicon la dit « endommagée »). Au premier lancement : clic droit sur l'application › **Ouvrir** ›
  **Ouvrir**. Depuis macOS 15, si ce n'est pas proposé : *Réglages Système* › *Confidentialité et sécurité* › en bas,
  **Ouvrir quand même**.
- **Linux** : rien à signer. AppImage : la rendre exécutable (`chmod +x OpenFlyover_*.AppImage`) puis la lancer. Paquet
  Debian : `sudo apt install ./OpenFlyover_*.deb`.

## Ajouter les certificats plus tard

Les certificats restent dans les **secrets** du dépôt, jamais dans un fichier : *Settings* › *Secrets and variables* ›
*Actions* › *New repository secret*. Dès qu'ils sont présents, le workflow signe ; sinon il construit sans signer.

### Windows (Authenticode)

Il faut un certificat de signature de code (fichier `.pfx` avec sa clé privée et son mot de passe). Méthode suivie :
<https://v2.tauri.app/distribute/sign/windows/> (le certificat est importé dans le magasin de l'utilisateur, puis Tauri
signe avec son empreinte, horodatage DigiCert, SHA-256).

| Secret | Contenu |
|---|---|
| `WINDOWS_CERTIFICATE` | le fichier `.pfx` en base64 |
| `WINDOWS_CERTIFICATE_PASSWORD` | le mot de passe du `.pfx` |

Convertir le `.pfx` en base64, sous Windows : `certutil -encode certificat.pfx certificat-base64.txt`, puis coller tout
le contenu du fichier texte dans le secret (les lignes `-----BEGIN…` et `-----END…` peuvent rester). Sous Linux ou
macOS : `openssl base64 -A -in certificat.pfx -out certificat-base64.txt`.

Un certificat neuf n'efface pas tout de suite l'alerte SmartScreen : Windows la retire quand l'application a acquis
une réputation (nombre de téléchargements). Les certificats sur clé matérielle ou dans le cloud (Azure Trusted Signing…)
ne s'exportent pas en `.pfx` : ils demandent une commande de signature (`bundle.windows.signCommand`), à ajouter alors.

### macOS (Developer ID et notarisation)

Il faut un compte Apple Developer et un certificat **Developer ID Application**, exporté du Trousseau en `.p12`. Méthode
suivie : <https://v2.tauri.app/distribute/sign/macos/>.

| Secret | Contenu |
|---|---|
| `APPLE_CERTIFICATE` | le fichier `.p12` en base64 : `openssl base64 -A -in certificat.p12 -out certificat-base64.txt` |
| `APPLE_CERTIFICATE_PASSWORD` | le mot de passe choisi à l'export du `.p12` |
| `APPLE_SIGNING_IDENTITY` | le nom du certificat, par exemple `Developer ID Application: Prénom Nom (ABCDE12345)` (`security find-identity -v -p codesigning`) |
| `APPLE_ID` | l'adresse du compte Apple (notarisation) |
| `APPLE_PASSWORD` | un **mot de passe pour app** créé sur <https://account.apple.com> (pas le mot de passe du compte) |
| `APPLE_TEAM_ID` | l'identifiant d'équipe (10 caractères, page *Membership* du compte développeur) |

Les trois premiers suffisent pour signer ; les trois derniers ajoutent la notarisation, qui supprime l'alerte de
Gatekeeper.

### Mise à jour automatique

L'application n'utilise pas l'extension de mise à jour de Tauri : aucune clé de signature de mise à jour n'est
nécessaire.

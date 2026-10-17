# SetRemote

**Lumière et écrans de plateau, pilotés à distance.** SetRemote transforme
des téléphones et tablettes en sources de lumière ou en écrans d'accessoire
pour le tournage, commandés depuis un autre appareil (la « télécommande ») :
couleur, température (CCT) et teinte, effets (stroboscope, flash, feu,
police…), images et vidéos, simulateur d'appel fictif, et **passerelle DMX**
(sACN / Art-Net) pour piloter les écrans depuis une console lumière.

- Sans compte, sans publicité, sans traceur.
- Appairage par QR code ou code court, **chiffrement de bout en bout**
  (AES-256-GCM) : ni le relais ni l'hébergeur ne lisent les commandes.
- Fonctionne dans le navigateur (PWA installable) et en app native iOS /
  Android (Expo), y compris hors ligne sur un même réseau local.

Éditeur : **ITSI APP**, 64 résidence Les Jardins de Saint-Colomban,
35350 Saint-Coulomb, France — pierre@itsi-app.com.

## Deux façons d'utiliser SetRemote

| | Version libre, auto-hébergée | Version officielle payante |
|---|---|---|
| **État** | disponible : ce dépôt | **pas encore disponible** (en préparation) |
| **Prix** | gratuit | licence par télécommande, valable 6 mois, achetée sur le site web |
| **Fonctions** | toutes, y compris la passerelle DMX | les mêmes, hébergées et maintenues par ITSI APP |
| **Hébergement** | le vôtre : version web et relais sur votre serveur | `set-remote.itsi-app.com` et le relais officiel d'ITSI APP |
| **Licence** | GNU AGPL v3 ([LICENSE](LICENSE)) | même code, plus une clé de licence |
| **Nom et logo** | à changer si vous modifiez et redistribuez ([TRADEMARK.md](TRADEMARK.md)) | SetRemote |

La version auto-hébergée **ne vérifie aucune licence** (`LICENSING: 'off'`
dans `web/js/01-config.js`, valeur par défaut). La conception de la future
version payante est décrite dans [docs/LICENSING.md](docs/LICENSING.md).

## Auto-héberger

- **Relais et version web sur un VPS** (Docker, Caddy, HTTPS automatique) :
  [relay/deploy/README.md](relay/deploy/README.md).
- **Bascule pas à pas vers votre hébergement** (réglages de l'app, CSP,
  redirections) : [docs/HOSTING.md](docs/HOSTING.md).
- Conception du relais : [docs/BROKER.md](docs/BROKER.md) ; passerelle DMX :
  [docs/DMX.md](docs/DMX.md) ; hors ligne : [docs/OFFLINE.md](docs/OFFLINE.md).

## Confidentialité

Politique de confidentialité : [confidentialite.html](confidentialite.html)
(français) · [privacy.html](privacy.html) (English). Si vous hébergez votre
propre instance, vous êtes responsable de traitement pour celle-ci : adaptez
la politique (voir [docs/HOSTING.md](docs/HOSTING.md), étape 5).

## Développer

```sh
npm ci && (cd relay && npm ci)
npm run build      # web/ → index.html (fichier généré, ne pas l'éditer)
npm test           # build à jour + tests (Playwright / Chromium)
```

Organisation : `web/` (sources de la PWA), `packages/protocol` (appairage et
chiffrement), `packages/dmx` (moteur DMX), `packages/license` (format de clé
et vérification des baux de licence, pas encore utilisé), `relay/` (relais
WebSocket et kit de déploiement), `expo-app/` (app native et modules natifs).
Pour contribuer : [CONTRIBUTING.md](CONTRIBUTING.md) (CLA requis,
[docs/CLA.md](docs/CLA.md)).

## Licences

Code : © 2026 ITSI APP, **GNU Affero General Public License v3 seule**
(`AGPL-3.0-only`). Si vous mettez en ligne une version modifiée, vous devez en
proposer le code source à ses utilisateurs (AGPL §13). Composants tiers :
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Nom et logo :
[TRADEMARK.md](TRADEMARK.md).

---

## English

**SetRemote** turns phones and tablets into remotely controlled light sources
and prop screens for film sets: colour, CCT and tint, effects, images and
video, a fictional call simulator, and a **DMX gateway** (sACN / Art-Net).
No account, no ads, no tracking; pairing by QR code and end-to-end
encryption. Runs as an installable web app (PWA) and as a native iOS /
Android app.

- **Free, self-hosted version**: this repository, all features including the
  DMX gateway, under **AGPL-3.0-only**. No licence check
  (`LICENSING: 'off'`). Self-hosting guide:
  [relay/deploy/README.md](relay/deploy/README.md) and
  [docs/HOSTING.md](docs/HOSTING.md).
- **Official paid version**: hosted by ITSI APP, with a per-remote licence
  key valid for 6 months, bought on the website. **Not available yet**; design
  in [docs/LICENSING.md](docs/LICENSING.md) (French).
- Privacy policy: [privacy.html](privacy.html).
- Contributing requires accepting the CLA: [CONTRIBUTING.md](CONTRIBUTING.md).
  The name and logo are trademarks of ITSI APP; forks must rename
  ([TRADEMARK.md](TRADEMARK.md)).

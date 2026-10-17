# Contribuer à SetRemote

Merci de votre intérêt ! SetRemote est un logiciel libre (GNU AGPL v3) édité
par ITSI APP. *English version below.*

## Avant tout : le CLA

**Toute contribution (code, doc, traduction, image) exige d'avoir accepté le
[contrat de licence de contributeur (CLA)](docs/CLA.md).** Vous restez
titulaire de vos droits ; le CLA permet à ITSI APP de distribuer aussi le code
sous d'autres conditions que l'AGPL (stores d'applications, future version
officielle payante) tout en s'engageant à garder vos contributions disponibles
en open source. Pour l'accepter, recopiez la phrase du §9 du CLA dans la
description de votre première pull request. Sans elle, la pull request ne peut
pas être fusionnée.

Si votre employeur peut détenir des droits sur votre travail, obtenez d'abord
son accord écrit.

## Signaler un problème

- **Faille de sécurité** : ne pas ouvrir de ticket public. Écrivez à
  pierre@itsi-app.com avec les étapes pour reproduire.
- **Bogue** : ouvrez un ticket avec l'appareil, le système, le navigateur ou
  la version de l'app, ce que vous attendiez et ce qui s'est passé.
- **Idée** : ouvrez un ticket pour en discuter **avant** d'écrire beaucoup de
  code ; certaines évolutions (interface, licence, stores) demandent une
  validation par ITSI APP.

## Préparer l'environnement

Node 22 ou plus récent.

```sh
npm ci                     # racine (Playwright pour les tests de l'interface)
(cd relay && npm ci)       # relais auto-hébergé
PW_CHROMIUM=/chemin/vers/chromium npm test   # ou sans PW_CHROMIUM après « npx playwright install chromium »
(cd expo-app && npm ci && npm test && npx tsc --noEmit)   # app native
```

## Règles du dépôt

- **Ne modifiez pas `index.html` à la main** : il est généré depuis `web/`
  (`npm run build`), et la CI vérifie qu'il est à jour.
- Quand `index.html` change, incrémentez `CACHE` dans `sw.js`.
- Les paquets `packages/*` restent **sans dépendance** (WebCrypto seulement).
- Chaque nouveau fichier source commence par l'en-tête
  `SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP`
  (`node scripts/spdx-headers.mjs` l'ajoute ; `npm test` le vérifie).
- Tout composant tiers ajouté dans `vendor/` ou comme dépendance doit avoir
  une licence compatible avec l'AGPL et une entrée dans
  `THIRD_PARTY_NOTICES.md` (`npm run notices`). Les licences GPL-2.0-only,
  SSPL, BUSL, « Commons Clause » ou non libres sont refusées.
- Pas de traceur, pas de publicité, pas de collecte de données personnelles :
  voir la politique de confidentialité (`confidentialite.html`).
- Interface : toute modification visible passe d'abord par une maquette
  validée par ITSI APP ; les tests visuels (`tests/visual.test.mjs`) la
  protègent.
- Messages de commit en français, clairs, au présent ; un sujet par commit.
- Les tests restent verts (`npm test`, et ceux d'`expo-app/` si vous y
  touchez).

## Le nom et le logo

Le code est libre, pas la marque : un fork distribué doit changer de nom et de
logo. Voir [TRADEMARK.md](TRADEMARK.md).

---

## Contributing (English)

SetRemote is free software (AGPL-3.0-only) published by ITSI APP.

- **A signed CLA is required** before any contribution is merged: read
  [docs/CLA.md](docs/CLA.md) (French text prevails, English summary at the end)
  and paste the acceptance sentence from its §9 into your first pull request.
  You keep your copyright; ITSI APP may also ship your contribution under other
  terms (app stores, the future paid official version) and commits to keep it
  available as open source.
- Report security issues privately to pierre@itsi-app.com, not in public
  issues. Discuss larger changes in an issue first.
- Setup: Node ≥ 22, `npm ci`, `(cd relay && npm ci)`, then `npm test`;
  `expo-app/` has its own `npm ci`, `npm test`, `npx tsc --noEmit`.
- Never edit `index.html` by hand (`npm run build` generates it from `web/`);
  bump `CACHE` in `sw.js` when it changes. Keep `packages/*` dependency-free.
  Add the SPDX header to new source files and a `THIRD_PARTY_NOTICES.md` entry
  for any third-party component (AGPL-compatible licences only).
- UI changes need a mock-up approved by ITSI APP first.
- Forks must be renamed: see [TRADEMARK.md](TRADEMARK.md).

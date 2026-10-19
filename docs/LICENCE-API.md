# Service de licence : contrat client (v1)

Ce que l'app SetRemote (PWA et apps iPhone / Android, code public de ce dépôt)
échange avec le service de licence de la version officielle. Modèle produit
et choix : [LICENSING.md](LICENSING.md). Code client :
[`web/js/14-licence.js`](../web/js/14-licence.js) (identité, vérification,
statistiques), [`web/js/77-licence-ui.js`](../web/js/77-licence-ui.js) (aperçu,
Réglages), [`web/js/76-demos.js`](../web/js/76-demos.js) (démos). Tests :
[`tests/licence.test.mjs`](../tests/licence.test.mjs), avec un faux service qui
applique ce contrat ([`tests/helpers/licence.mjs`](../tests/helpers/licence.mjs)).

Rien de tout cela ne tourne dans la version libre : `LICENSING: 'off'` (défaut
de `web/js/01-config.js`), aucune clé créée, aucune requête.

## Configuration (`web/js/01-config.js`, `LICENCE_BUILD`)

| Clé | Rôle |
|---|---|
| `LICENSING` | `'on'` : Tel et Séquence en aperçu sans licence |
| `LICENCE_PUBKEY` | clé publique ECDSA P-256 du service (SPKI DER, base64url sans `=`) qui signe les jetons ; vide = licence inactive |
| `LICENCE_API` | base `https://hôte[:port]` ; vide = hôte de `RELAY_URL` (`wss://hub.exemple` → `https://hub.exemple`) |
| `LICENCE_BUY_URL` | page d'achat (version web seulement ; jamais affichée dans l'app native) |

La licence n'est active que si `LICENSING === 'on'`, une clé et une base
existent. `window.SETREMOTE_CONFIG` ne peut que **restreindre** : passer
`LICENSING` à `'on'`, ou fournir une clé / une base / une page d'achat que le
build laisse vides.

## Identifiant d'appareil

- Paire **ECDSA P-256** créée sur l'appareil (WebCrypto), clé privée
  `extractable: false`, rangée dans IndexedDB (`setremote-licence`, magasin
  `keys`, clé `device`). Repli si IndexedDB est inutilisable : clé
  extractible en `localStorage` (`setremote-licence-key-v1`, JWK), pour que
  l'identifiant reste stable ; elle ne quitte jamais l'appareil.
- `pub` = SPKI DER de la clé publique, base64url sans remplissage.
- `id` = base32 de Crockford (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`) des
  **40 premiers bits** de SHA-256(SPKI DER) : 8 symboles affichés
  `XXXX-XXXX`. Forme canonique des API : majuscules, avec le tiret.
- Saisie (page d'achat) : retirer espaces et tirets, majuscules, `O` → `0`,
  `I` et `L` → `1`, puis remettre le tiret (`licNormalizeId`).
- `id` dérive de `pub` : recopié sur un autre appareil, il ne sert à rien sans
  la clé privée.

## `POST {LICENCE_API}/api/v1/licence/check`

Requête (`Content-Type: application/json`) :

```json
{ "v": 1, "id": "K7Q2-9XMB", "pub": "<SPKI b64url>", "ts": 1760000000000,
  "nonce": "<16 octets aléatoires b64url>", "sig": "<b64url>",
  "app": { "os": "ios|android|macos|windows|linux|other", "ver": "1.0.0", "inst": "native|pwa|browser" } }
```

- Message signé (UTF-8) : `srlic1|<id>|<ts>|<nonce>` ; `sig` = ECDSA P-256 /
  SHA-256, format **IEEE P1363** (`r||s`, 64 octets, format natif de WebCrypto).
- Le service vérifie `id == dérivé(pub)`, la signature, `|maintenant − ts| ≤
  10 min`, un nonce non rejoué (15 min) ; débit limité par IP. Il ne garde
  **rien** pour un identifiant qui n'est rattaché à aucune licence.

Réponse 200 : `{ "token": "<charge utile b64url>.<signature b64url>" }`.
Charge utile (JSON) :

```json
{ "v": 1, "id": "K7Q2-9XMB", "features": ["tel", "seq"], "holder": "Prod Nord",
  "end": 1776384000000, "devices": { "n": 3, "max": 5 }, "iat": 1760000000000, "exp": 1761209600000 }
```

- Sans licence active (inconnue, échue, révoquée) : `features: []`, sans
  `holder`, `end`, `devices` — toujours signé, pour qu'une révocation soit crue.
- `exp` = min(fin de licence, `iat` + 14 jours) : validité hors ligne.
- Signature : ECDSA P-256 / SHA-256, P1363, sur les octets ASCII de
  `<charge utile b64url>`, vérifiée avec `LICENCE_PUBKEY`.
- Erreurs : 400 (requête), 401 (signature, horloge), 429 (débit) ;
  corps `{ "error": "<code>" }`.

Côté app :

- vérification au lancement, toutes les 6 h tant que l'app est ouverte et en
  ligne, et sur « Vérifier maintenant » (Réglages › Licence) ;
- fonctionnalité accordée seulement si la signature est valide, `id` est
  celui de l'appareil et `maintenant < exp` (marge d'horloge 10 min) ;
- dernier jeton valide gardé en `localStorage` (`setremote-licence-v1`,
  `{ token, checked }`, il n'a rien de secret) ; un échec réseau le garde, un
  jeton valide sans fonctionnalité le remplace ; un jeton mal signé est ignoré.

## `POST {LICENCE_API}/api/v1/stats` (anonyme)

```json
{ "v": 1, "os": "ios", "ver": "1.0.0", "mode": "remote|screen", "inst": "native|pwa|browser" }
```

Rien d'autre : ni identifiant, ni clé. Au plus une fois par jour et par mode
(télécommande, écran de jeu), au choix du mode ; l'appareil ne retient que la
date du dernier envoi réussi (`setremote-stats-v1`). Réponse 204. Le service
déduit le pays de l'adresse IP puis l'oublie, et n'incrémente que des
compteurs journaliers `(jour, os, ver, mode, inst, pays)`.

## Navigateur et app native

- Requêtes `fetch` sans cookie ni référent (`credentials: 'omit'`,
  `referrerPolicy: 'no-referrer'`). Le service doit répondre aux requêtes
  CORS, préflight `OPTIONS` compris (`Content-Type: application/json`) :
  origine du site web, et origine `null` pour l'interface embarquée des apps
  (`file://`). Sans cookie, `Access-Control-Allow-Origin: *` suffit.
- Site web auto-hébergé (`relay/deploy/Caddyfile`) : la CSP autorise
  `https://` vers le nom du relais (`connect-src`).
- App native : aucun lien ni mention d'achat (règles des stores) ; seul
  l'identifiant est affiché, avec Copier et Partager.

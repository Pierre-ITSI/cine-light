# @setremote/protocol

Appairage, chiffrement de bout en bout et schéma des messages entre la
**télécommande** SetRemote et ses **écrans**. JavaScript (modules ES + JSDoc),
**zéro dépendance**, fonctionne dans les navigateurs, Node 22 et React Native
(Hermes) dès qu'une implémentation WebCrypto (`crypto.subtle` +
`crypto.getRandomValues`) est disponible ou injectée.

> Ce paquet est autonome : il ne modifie ni `index.html` ni `expo-app/`.
> L'intégration est décrite plus bas.

```sh
cd packages/protocol && npm test     # 57 tests node --test, aucune installation
# (également exécutés par le `npm test` racine via tests/protocol-package.test.mjs)
```

---

## 1. Pourquoi

Aujourd'hui, télécommande et écrans échangent du JSON **en clair** sur le
broker **public** `wss://broker.hivemq.com:8884/mqtt`, topic
`setremote/v1/<canal>/cmd`, avec des codes canal du type `set4271`
(≈ 13 bits d'entropie). N'importe qui peut :

- s'abonner à `setremote/v1/#` et **voir/télécharger tous les médias** de tous
  les tournages (photos, vidéos, sons, textes des faux appels) ;
- **injecter des commandes** (flash, stroboscope, noir, faux appel…) ou des
  charges malveillantes (XSS via `photo`, saturation mémoire via `total`,
  boucle infinie via `freq: 0`…) ;
- deviner un canal en < 10 000 essais.

## 2. Modèle de menace

| Adversaire | Capacité | Ce que le protocole garantit |
|---|---|---|
| **Observateur du relais** (broker public, opérateur du relais privé, hébergeur) | lit tout le trafic | **Confidentialité** : contenu chiffré AES-256-GCM, clés jamais transmises au relais. Le topic (128 bits dérivés) ne révèle pas le secret. |
| **Injecteur** (quiconque peut publier sur le relais) | publie des trames arbitraires, rejoue des trames enregistrées | **Intégrité/authenticité** : toute trame non produite par un détenteur du secret est rejetée (`auth`). **Anti-rejeu** par émetteur + contrôle d'horloge. **Schéma strict** même pour les détenteurs du secret. |
| **Attaquant actif pendant l'appairage manuel** | se place au milieu de l'échange ECDH | Détecté par la **SAS** à 6 chiffres comparée par l'utilisateur ; l'engagement (commit/reveal) ramène sa chance à 1/10⁶ par tentative. |
| **Personne qui voit le QR** | photographie l'écran de la télécommande | Rejoint la session tant qu'elle n'est pas renouvelée → n'afficher le QR que le temps de l'appairage ; « Nouvelle session » révoque tout le monde. |
| **Serveur web qui sert l'app** | reçoit les requêtes HTTP | Le secret est dans le **fragment** (`#…`), jamais envoyé au serveur ni dans le `Referer`. |

**Hors garanties / risques résiduels (assumés et documentés)**

- **Tous les appareils appairés sont de confiance.** Les clés sont
  symétriques : un écran possède la clé `r2s` pour déchiffrer, il pourrait donc
  aussi forger des ordres « télécommande ». Les clés par sens empêchent la
  *réflexion* d'une trame, pas un appareil compromis. Évolution possible :
  signature ECDSA des ordres par la télécommande.
- **Métadonnées visibles par le relais** : topic opaque, tailles, horaires,
  adresses IP, nombre d'appareils, nature de la trame (message ou fragment de
  média) et l'étiquette d'émetteur. Le **type** de message (`color`,
  `call:start`…) est **dans le chiffré** depuis la version 2 de la trame : le
  relais ne le voit plus. Les tailles et la cadence peuvent toutefois le
  laisser deviner (ex. rafale de fragments = média).
- **Pas de confidentialité persistante** (forward secrecy) au sein d'une
  session : si le secret fuit, le trafic enregistré de cette session se
  déchiffre. Mitigation : nouvelle session par tournage / journée.
- **Rejeu dans la tolérance d'horloge** : un récepteur qui vient de redémarrer
  (fenêtre vide) accepte une trame enregistrée il y a moins de **5 min**
  (`maxSkewMs`, réglable). Réciproquement, un appareil dont l'horloge dérive
  de plus de 5 min ignore toutes les trames (erreur `stale`).
- **Déni de service** : un relais public ne peut pas être protégé ; le relais
  privé doit plafonner la taille des paquets et le débit (voir
  [`docs/BROKER.md`](../../docs/BROKER.md)).
- **Sécurité de l'app elle-même** (XSS, stockage local) : le schéma bloque les
  charges connues, mais l'affichage doit continuer d'échapper le texte.

## 3. Format du protocole

### 3.1 Secret de session et URL d'appairage

La **télécommande** possède UN secret de session partagé par **tous** ses
écrans :

```js
{ channelId: <128 bits base64url, 22 car.>, key: <256 bits base64url, 43 car.> }
```

URL du QR — le secret n'est **que** dans le fragment :

```
https://<app>/#p=v1.<channelId>.<key>
```

`parsePairingUrl()` renvoie `null` pour tout autre fragment (dont l'ancien
`#set4271`), ce qui permet à l'app de basculer en mode historique.

### 3.2 Dérivation (HKDF-SHA256, IKM = key, sel = channelId)

| info | sortie | usage |
|---|---|---|
| `setremote/v1/session/topic` | 128 bits | topic opaque → `setremote/v2/s/<topic>` |
| `setremote/v1/session/key/remote-to-screen` | AES-256-GCM | ordres télécommande → écrans (`keys.r2s`) |
| `setremote/v1/session/key/screen-to-remote` | AES-256-GCM | retours écrans → télécommande (`keys.s2r`) |
| `setremote/v1/session/relay-auth` | 256 bits | preuve facultative pour un relais privé |

### 3.3 Trame (`seal` / `sealChunk`)

Chaîne base64url (sans remplissage) des octets :

```
0      version = 0x02
1      kind    = 0x01 message JSON | 0x02 fragment de média
2      senderLen (1..16), puis sender ASCII [A-Za-z0-9_-]
+4     seq  uint32 BE        (compteur par émetteur)
+6     ts   uint48 BE (ms)   (horloge de l'émetteur)
kind 1 : rien de plus (le type est dans le chiffré)
kind 2 : idLen + mediaId (≤ 64) + index u16 + total u16
──────── tout ce qui précède = AAD AES-GCM ────────
+12    IV aléatoire 96 bits
…      chiffré ‖ tag 128 bits
```

- Message : le clair est le JSON de l'objet **complet, `type` compris**
  (version 2 ; en version 1 le type était en clair dans l'en-tête — une trame
  v1 est refusée avec `version`). Plafond : **40 Kio** de clair. Tout message
  valide pour le schéma tient dessous (pire cas : `media:order` ou `caps` de
  500 identifiants de 64 caractères ≈ 36 Kio, vérifié par un test). Les gros
  contenus voyagent **en fragments** : images, sons, vidéo en base64 et
  **photo d'un faux appel** (`media-img-*` sous l'id `__callphoto`, comme le
  fond d'écran verrouillé `__lockwall`). Trame max. : **54 782 caractères**
  (`MAX_FRAME_CHARS`), donc un relais plafonné à **64 Kio par trame** suffit
  (avant : 1 Mio à cause de la photo d'appel en ligne).
- Fragment : clair binaire **≤ 16 Kio**, **≤ 4000** fragments par média
  (≈ 64 Mo), `mediaId` ≤ 64 caractères. `mediaId`, `index` et `total` sont dans
  l'AAD : un fragment ne peut
  être ni renuméroté ni déplacé vers un autre média.
- **Anti-rejeu** (`ReplayState`) : fenêtre glissante de 1024 séquences **par
  émetteur** (télécommande et chaque écran ont leur propre étiquette aléatoire
  `sender`, préfixée `r`/`s`), refus des doublons et des séquences trop
  anciennes, refus si `|maintenant − ts| > 5 min`. L'état n'est modifié
  qu'**après** authentification (une trame forgée ne peut pas l'empoisonner) ;
  vérification et enregistrement sont atomiques (deux copies simultanées : une
  seule acceptée).
- Erreurs : `ProtocolError` avec `code` ∈ `auth`, `replay`, `stale`,
  `malformed`, `version`, `kind`, `too-large`, `invalid-message`,
  `bad-pairing`, `bad-key`, `bad-argument`, `no-crypto`.

### 3.4 Schéma applicatif (`schema.js`)

`MESSAGE_TYPES` documente les **45 types** utilisés aujourd'hui par
`index.html` et `expo-app`, plus les nouveaux `screen:config` et `dmx:look`
(47 au total : 31 `r2s`, 15 `s2r`, 1 `both` ; sources et champs décrits).
`screen:alive` (écran → télécommande, sans champ) est le signe de vie qu'un
écran envoie toutes les 15 s.
`validate(msg, { direction })` est une **liste blanche stricte** : type ou
champ inconnu, mauvais type, nombre non fini, chaîne/tableau trop long,
data-URL non conforme ⇒ rejet. Les bornes sont **alignées sur `PROTO`**
(`web/js/22-protocol.js`) : strobe **0,1–30 Hz** et flash **15–2000 ms**,
vibreur ≤ 20 valeurs de 0 à 2000 ms, effet `count ≤ 32`,
`media-img-start.total ≤ 2000`, `media:upload.totalChunks ≤ 50 000` (chemin
base64 historique), identifiants ≤ 64 caractères, SDP ≤ 16 000 caractères
(une offre WebRTC « données seules » en fait ≈ 1 000). `call:start` n'a plus
de champ `photo` : `hasPhoto: true` indique que la photo a été envoyée avant,
en fragments sous `__callphoto`.

**Différence voulue avec `MSG_ROUTES`** : l'app *borne* une valeur hors plage
(flash de 5 ms ramené à 15 ms) ; le schéma la *rejette*, à l'envoi comme à la
réception. L'émetteur doit donc borner lui-même (voir §6, curseurs de flash).

Des tests de **dérive** relisent `web/js/*.js` (ou `index.html` à défaut) et
`expo-app`. Ils échouent dans trois cas :
- un type est utilisé sans être au schéma ;
- une route de `MSG_ROUTES` est absente du schéma ;
- une route est déclarée dans un sens différent.

**Multi-écran** :

- `target` (facultatif, tout message `r2s`) : absent = tous les écrans,
  `{ screens: [screenId, …] }` = écrans listés, `{ group: 'id' }` = membres du
  groupe. Côté écran : `isAddressedTo(msg, { screenId, groups })`.
- Chaque écran tire au **premier lancement** un `screenId` stable
  (`createScreenId()`, 96 bits) et l'annonce dans `caps` avec `name` et
  `groups`.
- `screen:config { target: { screens: [...] }, name?, groups? }` : la
  télécommande renomme un écran / fixe ses groupes.
- WebRTC (`rtc-offer`) : cibler **un** écran ; les réponses sont rattachées à
  l'écran par l'étiquette `sender` (authentifiée) apprise via `caps`.
- `dmx:look { target?, seq, live, look }` : émis par la passerelle DMX
  (`packages/dmx`), pas encore branché dans `web/js`. Règles de priorité
  console / télécommande : `docs/DMX.md`.

## 4. API

```js
import {
  // pairing.js
  createPairing, pairingUrl, parsePairingUrl,
  createRendezvous, rendezvousTopic, normalizeRendezvousCode, formatRendezvousCode,
  ecdhKeyPair, commitPublicKey, verifyCommitment, deriveSharedPairing, formatSas,
  sealSessionForPeer, openSessionFromPeer, validateRendezvousMessage,
  // crypto.js
  deriveSession, seal, open, sealChunk, openChunk, createReplayState,
  splitIntoChunks, createChunkAssembler, peekFrame, newSenderTag,
  // schema.js
  validate, explainInvalid, isAddressedTo, MESSAGE_TYPES, LIMITS,
  // channel.js (tout-en-un)
  createSecureChannel, createScreenId, SESSION_TOPIC_PREFIX, RENDEZVOUS_TOPIC_PREFIX,
  // environnement
  setCrypto, ProtocolError,
} from '@setremote/protocol';
```

Le plus simple pour une app : `createSecureChannel()` qui assemble dérivation,
chiffrement, anti-rejeu, schéma (à l'envoi **et** à la réception, avec le
sens), filtrage des échos, des trames des autres écrans et de l'adressage.

```js
const ch = await createSecureChannel({ pairing, role: 'screen', screenId, groups });
ch.mqttTopic;                       // 'setremote/v2/s/<topic opaque>'
await ch.seal({ type: 'caps', torch: true, vibrate: true, screenId, name });
const r = await ch.receive(frame);  // null (ignoré) | { kind: 'message', message, sender }
                                    //              | { kind: 'chunk', chunk, sender }
                                    // lève ProtocolError si invalide → ignorer la trame
```

## 5. Parcours utilisateur

### 5.1 QR code (cas normal, autant d'écrans que voulu)

1. Sur la télécommande : **« Nouvelle session »** → un QR s'affiche (et un
   bouton « Partager le lien »).
2. Sur chaque écran : scanner le QR avec l'appareil photo (ou l'app) → l'écran
   ouvre l'app, lit le secret dans le fragment, l'efface de la barre d'adresse
   et rejoint la session. Tous les écrans scannent **le même** QR.
3. La télécommande voit apparaître chaque écran (nom + identifiant via `caps`),
   peut le renommer et le ranger dans des groupes.
4. **« Masquer le QR »** dès que les écrans sont connectés ; **« Nouvelle
   session »** révoque tous les appareils (il faut rescanner).

### 5.2 Code manuel (sans caméra) — un code par écran

1. Télécommande : **« Ajouter un écran par code »** → affiche `K7P-Q4X`
   (2 minutes de validité, sans I/L/O/0/1).
2. Écran : **« J'ai un code »** → saisit `K7P-Q4X`.
3. Les **deux** appareils affichent un nombre à 6 chiffres, ex. `042 913`.
   L'utilisateur vérifie qu'ils sont **identiques** et appuie sur
   **« Ça correspond »** sur chacun (sinon **« Différent »** → abandon,
   nouveau code).
4. L'écran rejoint la session commune. Pour l'écran suivant : nouveau code.

Sous le capot (topic `setremote/v2/rdv/<rendezvousTopic(code)>`, messages en
clair validés par `validateRendezvousMessage`) :

```
Écran                                   Télécommande
  ecdhKeyPair()                           createRendezvous() → affiche le code
  pair:commit { commit = H(pkÉ) }  ──►
                                   ◄──    pair:key { jwk = pkT }   (ecdhKeyPair())
  pair:reveal { jwk = pkÉ }        ──►    verifyCommitment(pkÉ, commit) sinon abandon
  deriveSharedPairing(...)                deriveSharedPairing(...)
  → { pairing: temporaire, sas }          → { pairing: temporaire, sas }
             [ l'utilisateur compare les deux SAS ]
                                   ◄──    pair:session { frame = sealSessionForPeer(session, temporaire) }
  openSessionFromPeer(frame, temporaire) → secret de session commun
```

Publier chaque message toutes les ~1,5 s jusqu'à réponse (QoS 0), ignorer les
doublons, abandonner à l'expiration du code ou sur `pair:abort`.

## 6. Intégration dans la PWA (`web/`, `index.html` généré)

`index.html` est **généré** par `npm run build` à partir de `web/js/*.js`
(scripts classiques concaténés) et de `web/styles/*.css`. On ne le modifie
jamais à la main. Points d'accroche :

| Où | Quoi |
|---|---|
| `web/index.template.html` | charger le paquet (module ES) avant l'initialisation |
| `web/js/20-mqtt.js`, `client.on('message')` | **déchiffrer** (`ch.receive`) **en amont** de `dispatchMessage(msg)` |
| `web/js/20-mqtt.js`, `sendMsg(obj)` | **chiffrer** (`ch.seal`) ; topic `ch.mqttTopic` au lieu de `setremote/v1/<canal>/cmd` |
| `web/js/22-protocol.js`, `dispatchMessage` | inchangé : `MSG_ROUTES` reste la 2e barrière (rôle + bornage) |
| `web/js/66-torch-flash.js`, `sendCaps()` | ajouter `screenId`, `name`, `groups` |
| `web/js/24-resync.js` | multi-écran : la resynchronisation peut cibler `target: { screens: [caps.screenId] }` |
| `sw.js` | ajouter `./packages/protocol/*.js` au `SHELL` et incrémenter `CACHE` (aujourd'hui `setremote-v52`) |

1. **Chargement.** Les scripts de `web/js` sont classiques et ne peuvent pas
   faire `import`. Il faut donc un module qui publie l'API, et
   l'initialisation (`99-init.js`) doit attendre `srp-ready`. Rappel :
   WebCrypto n'est disponible qu'en HTTPS ou sur `localhost`.

   ```html
   <script type="module">
     import * as P from './packages/protocol/index.js';
     window.SRP = P; window.dispatchEvent(new Event('srp-ready'));
   </script>
   ```

2. **Télécommande.**
   - `pairing = SRP.createPairing()`, persisté en `localStorage` pour survivre
     au rechargement.
   - QR = `SRP.pairingUrl(location.href, pairing)`.
3. **Écran.**
   - Au démarrage, appeler `SRP.parsePairingUrl(location.href)`.
   - Si un appairage est trouvé, effacer le fragment avec
     `history.replaceState(null, '', location.pathname + location.search)`,
     puis persister l'appairage.
   - Sinon, si le fragment est un ancien code, passer en **mode historique**.
   - `screenId` : tiré par `SRP.createScreenId()` au premier lancement, puis
     conservé en `localStorage`.
4. **Réception et envoi** (`20-mqtt.js`) :

```js
// ch = await SRP.createSecureChannel({ pairing, role: mode, screenId, groups })
client.subscribe(ch.mqttTopic, { qos: 0 }, ...);
client.on('message', async (_t, payload) => {
  let r;
  try { r = await ch.receive(payload.toString()); }
  catch (e) { if (e.code === 'stale') signalerHorloge(); return; }   // trame ignorée
  if (!r) return;                                   // écho, autre écran, pas pour nous
  if (r.kind === 'message') dispatchMessage(r.message);   // MSG_ROUTES inchangé
  else onChunk(r.chunk);                                    // assembleur de fragments
});
async function sendMsg(obj) {
  if (!mqttClient || !mqttClient.connected) return;
  mqttClient.publish(ch.mqttTopic, await ch.seal(obj), { qos: 0 });
}
```

   `ch.seal` lève `invalid-message` si l'objet sort du schéma. Il faut
   journaliser cette erreur, pas l'avaler : elle signale un émetteur qui
   devrait borner ses valeurs.

5. **Médias.**
   - Télécommande : lire le fichier en `ArrayBuffer`, le découper avec
     `splitIntoChunks()`, annoncer par `media:upload` (avec `target` si
     besoin), envoyer `ch.sealChunk(...)` pour chaque fragment, puis
     `media:play`.
   - Écran : appeler `asm.expect(mediaId, totalChunks)` à réception du
     `media:upload`, puis `asm.add(chunk)` pour chaque fragment ;
     `asm.missing()` alimente `media:need-chunks`.
   - Le JSON base64 `media:chunk` (jusqu'à 50 000 fragments, comme
     aujourd'hui) reste accepté pour compatibilité.
6. **Repli `BroadcastChannel`** (même appareil). Aujourd'hui il transporte
   `color` et `strobe` en clair ; il peut transporter les mêmes trames
   chiffrées.
7. **À adapter avant d'activer la validation stricte à l'envoi.**
   - `flashDurSlider` et `flashDurMaxSlider` ont `min="5"` dans
     `web/index.template.html` : passer à **15**, ou borner dans
     `buildStrobePayload()`.
   - Les écrans d'appairage (QR « nouvelle session », saisie du code,
     comparaison de la SAS) sont une **interface nouvelle** : il faut une
     maquette validée avant de les implémenter.

## 7. Intégration React Native (`expo-app`, Expo SDK 56, Hermes)

Hermes n'a pas de `crypto.subtle`. Bibliothèque recommandée :
**[react-native-quick-crypto](https://github.com/margelo/react-native-quick-crypto)** (Margelo).

*Vérifié le 2026-10-15* : version **1.1.8** publiée le 2026-10-08 sur le
registre npm (`npm view react-native-quick-crypto`), projet actif (1.1.7 le
2026-08-15 ; billet « Four years of react-native-quick-crypto », juin 2026).
Lecture du code source 1.1.8 (`src/subtle.ts`, `src/ec.ts`) :
`subtle.generateKey` ECDH P-256 ✔, `deriveBits` ECDH et HKDF ✔,
`importKey` `jwk` (EC) et `raw` (HKDF, AES) ✔, `exportKey('jwk')` ✔ (la clé
publique est toujours exportable), `encrypt`/`decrypt` AES-GCM avec
`additionalData` ✔, `getRandomValues` ✔. Prérequis : **New Architecture**
(RN 0.85 de l'app : OK), pairs `react-native-nitro-modules ≥ 0.31.2` et
`react-native-quick-base64 ≥ 3`, plugin Expo fourni (`app.plugin.js`).
**Pas compatible Expo Go** : build de développement (`expo-dev-client`, déjà
utilisé par l'app pour BLE / TCP).

```sh
cd expo-app
npx expo install react-native-quick-crypto react-native-nitro-modules react-native-quick-base64
npx expo prebuild   # ou un build EAS
```

Injection **sans toucher aux globales** (recommandé — `install()` remplace
`global.crypto` et `global.Buffer` pour toute l'app) :

```ts
// expo-app/src/lib/protocol.ts — importé tout en haut de app/_layout.tsx
import QuickCrypto from 'react-native-quick-crypto';
import { setCrypto } from '@setremote/protocol';
setCrypto({ subtle: QuickCrypto.subtle as unknown as SubtleCrypto,
            getRandomValues: QuickCrypto.getRandomValues as any });
```

Alternative : `import { install } from 'react-native-quick-crypto'; install();`
(le paquet utilise alors `globalThis.crypto` sans appel à `setCrypto`).

- Dépendance locale : `"@setremote/protocol": "file:../packages/protocol"` et
  ajouter `../packages` aux `watchFolders` de Metro. Le paquet est en ESM avec
  un champ `exports` ; à défaut, importer `../packages/protocol/index.js`.
- Le build **web** d'Expo (`createTransport.web.ts`) utilise le WebCrypto du
  navigateur : aucun polyfill.
- UTF-8/base64 : le paquet a ses propres implémentations (pas de `Buffer`,
  `TextDecoder` facultatif).
- Les trames sont des chaînes : elles passent telles quelles par
  `MqttTransport`, `WifiTransport` (une trame par ligne) et `BleTransport`
  (découpage existant). À brancher dans `RemoteTransport.send/onMessage`.
- **À adapter dans l'UI** : la durée de flash native a `min={10}` → **15** ms.
- Repli possible pour Expo Go (non fourni ici) : un objet `{ subtle,
  getRandomValues }` construit sur `@noble/curves` / `@noble/ciphers` /
  `@noble/hashes` + `expo-crypto`, passé à `setCrypto`.

## 8. Migration (résumé — détails dans `docs/BROKER.md`)

1. Livrer le chiffrement **avant** le relais privé : les trames v2 circulent
   déjà sur le broker public (topic opaque 128 bits, contenu chiffré) → la
   fuite de médias et l'injection cessent immédiatement.
2. Mode historique (`#set4271`) conservé derrière un bandeau d'avertissement,
   en réception **validée par `validate()`** (bloque déjà les charges de la
   revue), puis désactivé par défaut, puis retiré.
3. Bascule vers le relais privé par simple changement d'URL/transport.

## 9. Limites connues / suites

- Pas de rotation automatique de clé ni de révocation d'un écran isolé
  (révocation = nouvelle session pour tous).
- `MESSAGE_TYPES` doit évoluer avec l'app : le test de dérive le rappelle.

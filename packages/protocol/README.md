# @setremote/protocol

Appairage, chiffrement de bout en bout et schéma des messages entre la
**télécommande** SetRemote et ses **écrans**. JavaScript (modules ES + JSDoc),
**zéro dépendance**, fonctionne dans les navigateurs, Node 22 et React Native
(Hermes) dès qu'une implémentation WebCrypto (`crypto.subtle` +
`crypto.getRandomValues`) est disponible ou injectée.

> Ce paquet est autonome. La PWA l'intègre (`index.html`, voir §6) ;
> `expo-app/` pas encore (§7).

```sh
cd packages/protocol && npm test     # 66 tests node --test, aucune installation
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
| **Appareil retiré** (perdu, rendu, membre d'équipe parti) | connaît l'ancien secret de session et sa clé par écran | « Retirer l'écran » (§ 3.5) : nouvelle session remise aux SEULS autres écrans, chiffrée avec leur clé par écran ; l'appareil retiré ne peut plus rien déchiffrer, même en rejouant l'ancien QR (QR et code renouvelés). |
| **Serveur web qui sert l'app** | reçoit les requêtes HTTP | Le secret est dans le **fragment** (`#…`), jamais envoyé au serveur ni dans le `Referer`. |

**Hors garanties / risques résiduels (assumés et documentés)**

- **Tous les appareils appairés sont de confiance.** Les clés sont
  symétriques : un écran possède la clé `r2s` pour déchiffrer, il pourrait donc
  aussi forger des ordres « télécommande ». Les clés par sens empêchent la
  *réflexion* d'une trame, pas un appareil compromis. Évolution possible :
  signature ECDSA des ordres par la télécommande. Le **retrait** d'un écran
  (§ 3.5) exclut un appareil pour la suite, mais il ne protège pas d'un
  appareil qui attaque **pendant** qu'il est encore appairé, notamment :
  - **échange de clé par écran détourné** : l'échange est authentifié par la
    session ; un membre malveillant de la session qui s'interpose au moment
    où un AUTRE écran établit sa clé (offre forgée au nom de la
    télécommande, ou réponse au nom de l'écran) pourrait obtenir cette clé, et
    donc la session suivante de cet écran après son propre retrait.
    Atténuations : l'écran garde la première clé établie avec une
    télécommande, la réponse doit venir de l'émetteur rattaché à l'écran
    visé et répondre à l'offre en cours, et la télécommande compare le kid
    annoncé par l'écran (caps) au sien ; une clé différente n'est jamais
    remplacée d'office et l'écran ne suit pas le retrait suivant (à
    réappairer). Parade complète (non faite) : clé d'identité ECDSA de la
    télécommande, dont l'empreinte serait le channelId, signant les offres ;
  - **retrait forgé** : `screen:revoked` est scellé avec la clé de session
    (l'écran retiré n'a peut-être pas de clé par écran) ; un membre de la
    session peut donc faire afficher « Écran retiré » à un autre écran
    (déni de service : il faut le réappairer) ;
  - **rattachement d'un écran** : un membre de la session peut annoncer un
    `caps` avec le screenId d'un autre écran ; la télécommande rattache
    alors cet émetteur (les messages qu'elle lui attribue, pas les clés).
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
  de plus de 5 min ignore toutes les trames (erreur `stale`) : la PWA le
  signale (« Horloge décalée » dans la pastille de la télécommande) après
  3 trames **authentiques** d'affilée d'un même émetteur refusées comme
  périmées (une trame forgée avec une vieille date ne compte pas).
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
`#set4271`) : la PWA affiche alors l'écran d'appairage.

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
1      kind    = 0x01 message JSON | 0x02 fragment de média | 0x03 message JSON pairwise
2      senderLen (1..16), puis sender ASCII [A-Za-z0-9_-]
+4     seq  uint32 BE        (compteur par émetteur)
+6     ts   uint48 BE (ms)   (horloge de l'émetteur)
kind 1, 3 : rien de plus (le type est dans le chiffré)
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

`MESSAGE_TYPES` documente **tous les types** utilisés par `index.html` et
`expo-app` (64 aujourd'hui : 42 `r2s`, 21 `s2r`, 1 `both` ; sources et champs
décrits).
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

**Tournage sans réseau** ([`docs/OFFLINE.md`](../../docs/OFFLINE.md)) : les
mêmes trames passent aussi en Wi-Fi local et en Bluetooth (pont natif `link:*`,
hors schéma : seule l'enveloppe change). Champs ajoutés : `call:start.photoId`
/ `audioId` (photo / bande son **préparées** d'un appel enregistré, ids
`__ph_` / `__au_` + 40 hex dérivés du contenu, `CALL_PHOTO_ID_RE` /
`CALL_AUDIO_ID_RE`), `rtc-offer.kind: 'cache'` et `media:upload.show: false`
(vidéo mise en cache sans interrompre ni afficher quoi que ce soit).

**Onglet Tel** : `call:start.kind: 'notif'` (notification d'application :
`present` `banner` / `lock`, `phone { date?, time? }` au format `AAAA-MM-JJ` /
`HH:MM`, `received { mode: now | ago (min ≤ 10 080) | at (date, time) }` ;
icône en fragments sous `__notificon`, fond verrouillé propre `__notifwall`).
`kind: 'chat'` / `'whatsapp'` (ancienne messagerie) reste accepté et s'affiche
en SMS. Discussion fictive : `chat:msg` (id `CHAT_ID_RE`, `from` contact /
actor, texte ≤ 300), `chat:open` (≤ 40 messages, sans doublon, postés ⊂ fil ;
`history: true` pour « Reprendre ici » / « Repartir de zéro » : postés = début
exact du fil, affichés d'un coup comme historique, sans lettre tapée),
`chat:rewind` (« ↶ » : `id` du dernier message affiché, remis en attente ;
`drop` : message improvisé, retiré du fil), `chat:post`, `chat:close`
(télécommande → écran) ; `chat:progress` (débit
limité à 4/s) et `chat:sent` (écran → télécommande). Tous petits : ils
passent aussi en Bluetooth.

**Onglet Séquence** (faux téléphone d'une séquence, `web/js/91-sequence.js` →
`94-sequence-phone.js`) : `phone:state` (télécommande → écran) décrit l'état
COMPLET du téléphone visé, renvoyé à chaque changement et à la
resynchronisation : `mode` (`off`, `locked`, `code`, `unlocked`, `home`),
`style` (Verre / Tonal / Épuré), `notifs` (≤ 8, ids `PHONE_NOTIF_ID_RE` sans
doublon, `kind` sms / notif / missed, textes bornés, `ago` en secondes ≤ 7 jours :
l'écran calcule l'heure relative avec sa propre horloge ; maquette 44 : `color`
= pastille de l'app d'un SMS, `who` = appelant d'un appel manqué — avatar rond
à ses initiales —, `img` = icône importée d'une notification ou photo de
l'appelant, préparée `__ph_…` et préchargée en fragments), `unlock { code: 0 | 4
| 6, then: app | home }` (aucun code ne voyage : chaque touche remplit le point
suivant ; `mode: 'code'` exige un code attendu), `home` (image d'accueil
préchargée en fragments sous `__seqhome`), `wall` (fond d'écran de la
séquence, maquette 42, préchargé sous `__seqwall` : écran verrouillé et pavé
du code), `watch` (gestes attendus de cet
écran, sans `unlock`) et `chime` (son de la notification qui vient d'arriver,
jamais à la resynchronisation). `phone:gesture { g, n? }` (écran →
télécommande, `PHONE_GESTURES` : touch, notif, hangup, answer, unlock, home ;
`n` seulement pour `notif`) : seuls les gestes attendus partent, `unlock`
toujours, au plus un par geste toutes les 400 ms et 5 par seconde ; la réponse
dans la discussion reste `chat:sent`. La console DMX ne pilote pas la Séquence.

**Barre d'état, veille, batterie, réseau** (maquettes 28b, 29b, 33, 34) :
`phone:state.bar` = barre d'état de la séquence (`clock { mode: run | frozen |
real, date?, time?, el? }` — `run` : l'heure avance depuis `date`/`time`, `el`
= secondes écoulées à l'envoi, l'écran ajoute le temps écoulé depuis la
réception ; `frozen` : figée ; `real` : heure de l'écran, sans date ni heure —,
`net { bars 0..4 (0 = « Pas de service »), type 3G / 4G / 5G, plane, wifi }`,
`bat { level 1..100, charging, pct, low? }`) affichée partout sur l'écran visé
et prioritaire ; `sleep { notif, touch, after 1..120 }` (écran verrouillé
seulement), `alert { id, kind?, level? }` (« Batterie faible » avec `level` ;
`kind: 'net'` : « Aucun réseau », maquette 44b, sans `level`, une fois par perte
du réseau ; fermée par le geste `dismiss`, toujours rapporté comme `unlock`), `power: 'off'` (ni `chime` ni
`watch` alors). `media:bar { bar | null }` (télécommande → écran) : même barre,
réglée dans l'onglet Média, en bandeau au-dessus d'un média affiché seul ;
celle de la séquence prime. Discussion : `chat:post.dur` (durée de « … écrit »,
1–60 s, avec `typing`), `chat:type { id, dur?, send }` (lecture auto : le texte
du comédien s'écrit tout seul en `dur` s et/ou part tout seul une fois complet),
`chat:open.auto { id, dur?, send, el? }` (reprise d'une frappe automatique) et
`chat:open.pend` (messages « Non distribué », ⊂ postés), `chat:sent.undelivered`
(envoyé sans réseau).

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
  `{ screens: [screenId, …] }` = écrans listés (1 à 64), `{ group: 'id' }` =
  membres du groupe. Côté écran : `isAddressedTo(msg, { screenId, groups })`,
  appliqué par `createSecureChannel` (un écran ne voit jamais un ordre adressé
  à d'autres).
- Chaque écran tire au **premier lancement** un `screenId` stable
  (`createScreenId()`, 96 bits) et l'annonce dans `caps` avec `name` et
  `groups`.
- `screen:config { target: { screens: [...] }, name?, groups? }` : la
  télécommande renomme un écran / fixe ses groupes (`name: ''` = nom par
  défaut).
- WebRTC (`rtc-offer`) : cibler **un** écran ; les réponses sont rattachées à
  l'écran par l'étiquette `sender` (authentifiée) apprise via `caps`.
- **Usage dans la PWA** (`web/js/28-screens.js`) : la télécommande ne produit
  que deux formes, rien (cible « Tous les écrans ») ou `{ screens }`. Un
  groupe est **résolu en liste d'écrans** au moment de l'envoi : les groupes
  vivent sur la télécommande, un écran qui aurait manqué son `screen:config`
  (hors ligne au moment du changement) reçoit quand même les ordres de son
  groupe. Les écrans apprennent tout de même leur nom et leurs groupes
  (`screen:config`, renvoyé à la resynchronisation si `caps` diffère) :
  affichage du nom, et `{ group }` reste utilisable par un autre émetteur.
  Aucun changement de schéma n'a donc été nécessaire.
- `dmx:look { target?, seq, live, look }` : émis par la passerelle DMX
  (`packages/dmx`, assemblé dans la PWA sous la globale `SRDMX` ;
  `web/js/86-dmx-gateway.js`), appliqué par l'écran (`web/js/36-dmx-screen.js`).
  Règles de priorité console / télécommande : `docs/DMX.md`.
- **Clés par écran et retrait** : voir § 3.5 (`key:offer`, `key:answer`,
  `screen:revoked` dans la session ; `key:confirm`, `key:ok`,
  `session:rekey`, `rekey:ok` scellés pairwise). `caps.kx` (échange pris en
  charge) et `caps.kid` (identifiant de la clé détenue).
- `tel:state { tel }` (écran → télécommande, optionnel) : la **couche Tel
  actuellement affichée**, envoyée juste après `caps` (connexion, réponse à
  `hello`), pour qu'une télécommande rechargée ou reconnectée la retrouve
  (« Retirer de l'écran », Raccrocher, « le dernier envoi gagne »). `tel` est
  `null` (rien d'affiché) ou l'objet strict
  `{ kind: 'call'|'sms'|'notif'|'chat', state: 'ringing'|'incall'|'notif'|'open', name?: ligne ≤ 40 }`
  (`chat` = discussion ouverte). Aucun texte de message, photo ni mode de
  présentation : seulement ce qu'il faut pour écrire « Appel « Maman » affiché
  sur … » et le retirer. Un **ancien écran** n'en envoie pas (la télécommande
  garde ce qu'elle sait) ; une **ancienne télécommande** (liste blanche stricte)
  écarte ce seul message : c'est pourquoi il n'est pas un champ de `caps`, qu'elle
  aurait rejeté en entier. Les états du faux téléphone d'une Séquence
  (`phone:state`) ne sont pas rapportés : la séquence tient l'écran.
- `screen:identify { target: { screens: [...] } }` : l'écran ciblé clignote
  3 s (« Identifier » du moniteur de la passerelle), sans changer son état.

### 3.5 Clés par écran et retrait d'un écran (`pairwise.js`)

Chaque écran établit avec la télécommande une clé AES-256-GCM qui lui est
propre, juste après l'appairage (QR ou code) ou à sa première connexion s'il
a été appairé avant cette version (`caps.kx = 1`) :

```
télécommande                                         écran
  key:offer   { rid, xid, jwk_R }   ── session ──►    (paires ECDH P-256
          ◄── session ──  key:answer { sid, rid, xid, jwk_E }   éphémères)
  secret = HKDF-SHA256(ECDH, sel = SHA-256(channelId ‖ rid ‖ sid ‖ xid ‖ jwk_R ‖ jwk_E))
  key:confirm { sid, rid, xid }     ── pairwise ──►   (l'ouvrir prouve la même clé)
          ◄── pairwise ──  key:ok { sid, xid }
```

- `rid` : identifiant stable de la télécommande (`createRemoteId()`), `sid` :
  screenId, `xid` : identifiant de l'échange. Clés par sens (r2s, s2r) et
  `kid` (64 bits, public, annoncé dans `caps`) : HKDF du secret, liées à
  `rid` et `sid`. Seul le secret (32 octets) est conservé, des deux côtés.
- Trame pairwise : type 0x03, même format que 0x01. Le type est dans l'AAD :
  une trame pairwise ne s'ouvre jamais avec `open()` ni une trame de session
  avec `openPairwise()`, même avec la mauvaise clé. Le schéma impose le
  canal (`explainInvalid(msg, { channel })`) : une `session:rekey` scellée
  avec la clé de session est refusée.
- L'écran garde la première clé établie avec une télécommande (une offre
  ultérieure est ignorée) ; rejoindre une AUTRE session (QR, code) l'efface.

Retrait (« Retirer l'écran », maquettes 5b et 5c) :

1. l'écran retiré reçoit `screen:revoked` (clé de session, ancien topic) : il
   efface sa session, sa clé et son nom, et affiche « Écran retiré » ;
2. la télécommande crée une nouvelle session (`createPairing()`, même
   dérivation) et la remet à chaque autre écran dans `session:rekey`, scellée
   avec SA clé par écran, sur l'ancien topic ; l'écran accuse (`rekey:ok`) et
   passe sur le nouveau topic en gardant affichage, cache et état ;
3. la télécommande bascule dès les accusés des écrans en ligne (3 s au plus) ;
   QR et code d'appairage sont renouvelés ; le nom, les groupes, la clé et le
   patch DMX de l'écran retiré sont oubliés ;
4. elle écoute l'ancien topic pendant 24 h (enregistré, 4 anciens topics au
   plus) : un écran absent pendant le retrait y reçoit la session EN COURS
   avec sa clé ; l'écran retiré, ou un appareil qui rejoue l'ancien QR, reçoit
   `screen:revoked`. Passé ce délai, un écran retiré absent reste muet et ne
   peut rien déchiffrer de la nouvelle session.

Un écran sans clé par écran (version antérieure jamais reconnectée, clé en
conflit) ne peut pas suivre : la confirmation du retrait le signale, et à son
retour il reçoit `screen:revoked { reason: 'renewed' }` (à réappairer).

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
  // pairwise.js (clés par écran) + crypto.js
  createRemoteId, createExchangeId, derivePairwiseSecret, pairwiseKeys, sealPairwise, openPairwise,
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

## 5. Parcours utilisateur (implémenté dans la PWA)

### 5.1 QR code (cas normal, autant d'écrans que voulu)

1. **Télécommande** : la session est créée au premier lancement et conservée
   (`localStorage`) ; la connexion est immédiate, sans code canal. L'onglet
   **📡 QR** affiche le QR d'appairage, généré **sur l'appareil**
   (`vendor/qrcode-generator-2.0.4.js`, plus aucun service en ligne).
2. **Écran** : *Écran projecteur* → la caméra arrière vise le QR, décodé par
   BarcodeDetector quand le navigateur le propose (Android, macOS), sinon par
   **jsQR** (`vendor/jsqr-1.4.0.js`, Apache-2.0, chargé seulement à
   l'ouverture de la caméra : iPhone, iPad, PWA iOS installée, Firefox). Sans
   caméra, l'appareil photo du téléphone ouvre le lien. L'app lit le secret dans le fragment, l'efface de la barre d'adresse,
   le retient pour la prochaine ouverture et rejoint la session. Tous les
   écrans scannent **le même** QR et reçoivent les mêmes commandes.
3. La télécommande liste les **écrans appairés** (identifiés par le `screenId`
   annoncé dans `caps`) et l'en-tête affiche l'état de la liaison
   (*Internet · chiffré*, *Reconnexion…*, *Hors ligne · N écran(s)* quand un
   écran n'a rien envoyé depuis 40 s ; il émet `screen:alive` toutes les 15 s).
4. **« Nouvelle session »** (onglet QR) révoque tous les écrans : il faut
   rescanner. Un ancien lien `#set4271` mène à l'écran d'appairage.

### 5.2 Code manuel (sans caméra) — un code par écran

1. Télécommande : l'onglet QR affiche aussi un code `K7M·4QP` (2 minutes,
   sans I/L/O/0/1, bouton ⟳ pour en tirer un autre ; renouvelé seul).
2. Écran : *Écran projecteur* → « ou saisir le code » → `K7M-4QP` → **OK**.
3. Les **deux** appareils affichent un nombre à 6 chiffres, ex. `482 917`.
   L'utilisateur vérifie qu'ils sont **identiques** et appuie sur
   **« Identique »** sur chacun (sinon **« Annuler »** → abandon, nouveau
   code).
4. L'écran reçoit le secret de session **commun** et rejoint les autres. Un
   nouveau code s'affiche aussitôt pour l'écran suivant.

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

`index.html` est **généré** par `npm run build`. Le paquet y est assemblé par
`web/bundle-protocol.mjs` en une IIFE (script classique, sans dépendance) qui
expose l'API dans la globale **`SRP`**, en tête du `<script>` unique.

| Où | Quoi |
|---|---|
| `web/js/12-session.js` | secret de la télécommande (`setremote-session-v1`), dernière session de l'écran, `screenId` stable, lien d'appairage : adresse publique fournie par la coque native (`window.SETREMOTE_NATIVE.publicUrl`, l'interface embarquée tournant en `file://`), sinon `location.origin + pathname` en http(s) uniquement, sinon pas de QR (le code reste possible) |
| `web/js/20-mqtt.js` | `connectSession()` : `createSecureChannel`, topic `ch.mqttTopic` ; **réception** une trame à la fois (`ch.receive` ; tout échec = trame ignorée, comptée dans `secStats`) puis `dispatchMessage` ; **envoi** `sendMsg` → forme JSON, bornage (`clampOutgoing`), `ch.seal`, publication dans l'ordre des appels |
| `web/js/22-protocol.js` | `MSG_ROUTES` reste la 2e barrière ; `clampOutgoing()` borne à l'émission (flash ≥ 15 ms, strobe ≤ 30 Hz, vibreur, effets…) sans toucher aux curseurs |
| `web/js/26-pairing.js` | rendez-vous par code (commit / key / reveal / session, répétés toutes les 1,5 s), dialogue de vérification du nombre, scan du QR dans l'app (BarcodeDetector, sinon jsQR chargé à la demande) |
| `web/js/32-status.js` | pastille de liaison (dont « Horloge décalée ») et liste des écrans appairés |
| `web/js/64-qr-utils.js` | QR en SVG (correction M) |

- **Tout** passe par `seal`/`open` : commandes, fragments d'images / sons /
  vidéo base64 (`media-img-*`, `media:chunk`), photo d'appel (`__callphoto`),
  signalisation WebRTC (`rtc-offer`, `rtc-answer`, `rtc-ice`). Le fichier
  vidéo lui-même passe par le canal de données WebRTC (chiffré DTLS).
- **Repli `BroadcastChannel`** (même appareil) : mêmes trames chiffrées
  (`color`, `strobe`), sous une étiquette d'émetteur distincte pour ne pas
  perturber la fenêtre anti-rejeu du flux MQTT.
- WebCrypto n'existe qu'en HTTPS, sur `localhost` ou en `file://`.
- **Plusieurs écrans** (`web/js/28-screens.js`, `39-screens-ui.js`,
  maquettes 5 et 6) : écrans nommés et regroupés (par session), cible
  « Tous / un groupe / un écran » choisie sous l'aperçu ; `sendMsg` ajoute la
  cible à chaque ordre (sauf `hello`, `media:order`, `media:evict`, communs à
  tous, et les messages déjà adressés : passerelle DMX, transferts). La
  télécommande tient l'**état attendu de chaque écran** (couleur, effet,
  strobe, noir, luminosité, média, cache) ; à chaque `caps`, la
  resynchronisation (`24-resync.js`) renvoie à **cet écran seul** son état et
  ce qui lui manque. Vidéo : une connexion WebRTC **par écran** visé (offre et
  ICE adressés, réponse rattachée par l'étiquette `sender`), repli base64
  **par écran** (`media:upload` / `media:chunk` adressés, accusés de cet
  écran).

## 7. Intégration React Native (`expo-app`, Expo SDK 56, Hermes)

> **Octobre 2026** : les écrans 100 % natifs d'`expo-app` et leurs transports
> en clair ont été retirés ; le protocole tourne dans la **vue web** de la
> coque (WebCrypto de WKWebView / WebView Android). Les liaisons hors ligne
> (Wi-Fi local, Bluetooth) transportent les trames telles quelles via le
> module natif `expo-app/modules/setremote-link` (`docs/OFFLINE-NATIVE.md`).
> Cette section ne sert que si du code React Native devait un jour chiffrer
> lui-même.

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
- Le build **web** d'Expo utilise le WebCrypto du navigateur : aucun
  polyfill.
- UTF-8/base64 : le paquet a ses propres implémentations (pas de `Buffer`,
  `TextDecoder` facultatif).
- Les trames sont des chaînes opaques : le relais MQTT et les liaisons hors
  ligne (`link:send` / `link:frames`, `docs/OFFLINE-NATIVE.md`) les
  transportent telles quelles.
- **À adapter dans l'UI** : la durée de flash native a `min={10}` → **15** ms.
- Repli possible pour Expo Go (non fourni ici) : un objet `{ subtle,
  getRandomValues }` construit sur `@noble/curves` / `@noble/ciphers` /
  `@noble/hashes` + `expo-crypto`, passé à `setCrypto`.

## 8. Migration (résumé — détails dans `docs/BROKER.md`)

1. Livrer le chiffrement **avant** le relais privé : les trames v2 circulent
   déjà sur le broker public (topic opaque 128 bits, contenu chiffré) → la
   fuite de médias et l'injection cessent immédiatement.
2. **Pas de coexistence** avec les anciens codes canal (décision produit) :
   la PWA ne parle plus que le protocole chiffré ; un ancien lien `#set4271`
   mène à l'écran d'appairage. L'app native (`expo-app`) doit migrer à son
   tour pour rester compatible.
3. Bascule vers le relais privé par simple changement d'URL/transport.

## 9. Limites connues / suites

- Pas de rotation automatique des clés : la session change au retrait d'un
  écran (§ 3.5) ou par « Nouvelle session » (qui révoque tous les écrans) ;
  les clés par écran, elles, ne sont pas renouvelées d'elles-mêmes.
- `MESSAGE_TYPES` doit évoluer avec l'app : le test de dérive le rappelle.

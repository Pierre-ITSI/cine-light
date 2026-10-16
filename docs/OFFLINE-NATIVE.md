# Liaisons hors ligne : Wi-Fi local et Bluetooth dans l'app native

Pour les développeurs. Module local `expo-app/modules/setremote-link` (Expo
SDK 56, New Architecture), branché dans `expo-app/app/index.tsx`. Il relie
une **télécommande** et ses **écrans** sur un plateau sans Internet, par deux
liaisons indépendantes : **Wi-Fi local** (`lan`, routeur de voyage ou réseau
filaire) et **Bluetooth LE** (`ble`, sans aucun réseau). Rédigé le
16 octobre 2026.

Le natif ne fait que **transporter des trames opaques** : elles sont déjà
chiffrées et authentifiées de bout en bout par la vue web
(`packages/protocol`). Il ne voit ni les clés de session, ni le contenu.

```
modules/setremote-link/
  expo-module.config.json     autolinking : SetRemoteLinkModule (iOS), expo.modules.setremotelink.SetRemoteLinkModule (Android)
  index.ts                    module natif + pont (src/wire.ts n'est pas exporté : hors bundle)
  src/bridge.ts               contrat, validation, dérivations du topic, relevé par lots (pur, testé sous Node)
  src/sha256.ts               SHA-256 / HMAC-SHA256 en TS pur (Hermes n'a pas crypto.subtle)
  src/wire.ts                 RÉFÉRENCE exécutable du format sur le fil v1 (tests, vecteurs pour le Kotlin)
  src/SetRemoteLinkModule.ts  requireOptionalNativeModule('SetRemoteLink') (null sans le module)
  ios/                        SetRemoteLinkModule.swift, LinkManager, LinkWire, LanLink (Network.framework), BleLink (CoreBluetooth), podspec
  android/                    SetRemoteLinkModule.kt, LinkManager, LinkWire, LanLink (NSD + sockets), BleLink (GATT), AndroidManifest.xml
  app.plugin.js               NSBonjourServices, textes d'autorisation iOS, permissions Android bornées
  test/                       bridge.test.mjs, wire.test.mjs, native.test.mjs   (cd expo-app && npm test)
```

## 1. Rôles et liaisons

| | Wi-Fi local (`lan`) | Bluetooth LE (`ble`) |
|---|---|---|
| Télécommande | **serveur** TCP, publié en Bonjour / mDNS | **central** : scanne, se connecte à chaque écran |
| Écran | **client** : cherche le service, se connecte | **périphérique** : annonce, sert un service GATT |
| Pairs côté télécommande | 64 écrans au plus | 8 écrans au plus (limites des piles, § 6) |
| Trame maximale | 64 Kio | 4 Kio |
| Débit, latence | Mbit/s, quelques ms | quelques Ko/s à quelques dizaines de Ko/s par écran (§ 6) |

Les deux liaisons peuvent tourner ensemble (`modes: ['lan', 'ble']`) : un
écran est alors vu sous deux identifiants de pair, un par liaison. C'est à la
vue web de choisir par où envoyer (`to`) et de dédoublonner à la réception
(numéros de séquence de `packages/protocol`).

## 2. Contrat du pont (figé, partagé avec le côté web)

### 2.1 Page → natif

`window.ReactNativeWebView.postMessage(JSON.stringify(msg))`.

| Message | Effet |
|---|---|
| `{type:'link:start', modes:['lan'\|'ble', …], role:'remote'\|'screen', room:<topic base64url, 22 caractères>, name?:string}` | Démarre les liaisons demandées pour ce topic, ou **remplace** la configuration en cours : les liaisons non listées s'arrêtent ; une liaison listée avec le même topic, le même rôle et le même nom continue sans couper ses pairs. |
| `{type:'link:stop', modes?:[…]}` | Arrête les liaisons listées (toutes si `modes` est absent). Pairs retirés, file vidée quand plus rien ne tourne. |
| `{type:'link:send', frames:[string], to?:[peerId]}` | Télécommande : à tous ses pairs, ou à ceux listés. Écran : à sa télécommande (ses pairs, en pratique un seul). Ordre conservé par pair. |
| `{type:'link:state?'}` | Réponse `link:state` immédiate. |

### 2.2 Natif → page

`webView.injectJavaScript("window.SRNative&&window.SRNative.receive(" + JSON + ");true;")`
(U+2028 / U+2029 échappés). Tant que la page n'a pas défini
`window.SRNative.receive`, les messages sont perdus sans erreur.

| Message | Quand |
|---|---|
| `{type:'link:frames', frames:[{peer, mode, data}]}` | Trames reçues, **par lots toutes les 20 ms** (au plus 256 trames et 1 Mio par lot ; jamais de lot vide), dans l'ordre d'arrivée. |
| `{type:'link:peers', peers:[{peer, mode, name?}]}` | **À chaque changement** (pair admis ou parti), liste complète. Les trames déjà reçues passent avant. |
| `{type:'link:state', lan:{available, active, error?}, ble:{available, active, error?}}` | À chaque changement, et en réponse à `link:state?`. |
| `{type:'link:error', mode:'lan'\|'ble'\|null, reason}` | Voir § 2.4. `mode` vaut `null` quand l'erreur ne tient pas à une liaison (validation). |

### 2.3 Précisions

- **Validation** (`src/bridge.ts`, refaite par le natif) : `modes` tableau non
  vide de `'lan'` / `'ble'` (doublons retirés) ; `role` `'remote'` ou
  `'screen'` ; `room` exactement 22 caractères `[A-Za-z0-9_-]` ; `name`
  facultatif, chaîne rognée d'au plus **64 caractères et 128 octets UTF-8**,
  sans caractère de contrôle ; `frames` 1 à **256** chaînes non vides ; `to`
  1 à **64** identifiants `[A-Za-z0-9_-]{1,64}` (doublons retirés). Message
  invalide : `link:error` `invalid-…`, rien n'est envoyé au natif.
- **Plafonds** : **64 Kio** par trame en Wi-Fi, **4 Kio** en Bluetooth (octets
  UTF-8). Une trame de plus de 64 Kio est refusée par le pont (`too-large`
  pour chaque liaison active) ; une trame de 4 à 64 Kio part vers les pairs
  Wi-Fi et est refusée pour les pairs Bluetooth (`too-large`, mode `ble`, une
  fois par `link:send`). Les autres trames du même `link:send` partent.
- **Identifiants de pair** : opaques, tirés au hasard à chaque connexion
  (`l-` ou `b-` + 12 chiffres hexadécimaux). Une reconnexion donne un nouvel
  identifiant : l'identité durable d'un écran est celle de
  `packages/protocol`, pas celle-ci.
- **`name`** : affiché chez le pair (`link:peers`). Il voyage dans le HELLO,
  donc **avant** que le pair soit authentifié : n'y mettre rien de confidentiel
  (« Télécommande », « Écran 3 »). Il n'est jamais annoncé (ni TXT Bonjour, ni
  annonce Bluetooth).
- **Débit et pertes** : file de réception native bornée (**1 024 trames,
  8 Mio**) ; si JS prend du retard, les trames **les plus anciennes** sont
  jetées (`congested`, une fois par épisode). Côté envoi, chaque pair a sa
  file (Wi-Fi 1 Mio, Bluetooth 64 Kio) qui jette aussi ses plus anciennes
  quand le pair ne suit pas. Pas d'accusé de réception : la vue web gère la
  reprise (resynchronisation de `packages/protocol`).
- **Ordre** : toutes les fonctions natives sont **synchrones** et postent sur
  une file série : `link:start` puis `link:send` arrivent dans cet ordre.
  Une trame d'un pair peut arriver juste après le `link:peers` qui l'a retiré.
- **Cycle de vie** : **premier plan uniquement**. En arrière-plan, le natif
  arrête tout (iOS : immédiatement ; Android : après 2 s, pour ne pas couper
  pendant une boîte de dialogue d'autorisation), publie `link:peers` vide, et
  **rouvre au retour** ce que la page avait demandé. Un **nouveau document**
  dans la vue web (navigation, rechargement, plantage du moteur web, bouton
  « Réessayer ») arrête toutes les liaisons ; un changement d'ancre (`#`) non.
- **Autorisations** demandées **au premier `link:start` qui contient `'ble'`**,
  jamais avant (§ 5.4). L'invite « réseau local » d'iOS apparaît au premier
  `link:start` qui contient `'lan'`.

### 2.4 Raisons de `link:error`

| `reason` | `mode` | Origine | Effet |
|---|---|---|---|
| `invalid-modes`, `invalid-role`, `invalid-room`, `invalid-name`, `invalid-frames`, `invalid-peers` | `null` | validation (pont, puis natif) | commande ignorée |
| `too-large` | liaison | trame au-delà du plafond (§ 2.3) | trame refusée pour cette liaison |
| `not-started` | `null` | `link:send` sans liaison démarrée | rien n'est envoyé |
| `unknown-peer` | `null` | un destinataire de `to` n'est pas (ou plus) connecté | les autres reçoivent |
| `native-unavailable` | liaison ou `null` | binaire sans le module (Expo Go, ancien build) | — |
| `start-failed` | liaison | erreur inattendue du natif au démarrage | liaison arrêtée |
| `no-network` | `lan` | (dans `link:state` seulement) ni Wi-Fi ni Ethernet | reprend seule quand un réseau revient |
| `local-network-denied` | `lan` | iOS : accès au réseau local refusé | en attente ; reprend si l'utilisateur l'autorise (Réglages › SetRemote › Réseau local) |
| `listen-failed`, `advertise-failed`, `browse-failed` | `lan` | écoute TCP, publication ou recherche Bonjour / NSD refusée | nouvel essai automatique toutes les 10 s |
| `advertise-failed`, `gatt-failed`, `scan-failed` | `ble` | annonce, service GATT ou scan refusé | nouvel essai automatique toutes les 10 s |
| `unsupported` | `ble` | pas de Bluetooth LE, ou pas de rôle périphérique / d'annonce (certains Android) | liaison arrêtée |
| `powered-off` | `ble` | Bluetooth désactivé | reprend seule quand il est rallumé |
| `unauthorized` | `ble` | autorisation refusée (iOS Bluetooth ; Android « appareils à proximité », ou localisation jusqu'à Android 11) | liaison arrêtée ; un nouveau `link:start` repose la question (Android ne réaffiche plus la boîte après deux refus) |
| `location-off` | `ble` | Android ≤ 11, télécommande : localisation coupée, le scan ne verra aucun écran | la liaison continue |
| `too-many-peers` | liaison | plafond atteint (§ 6) : nouveau pair refusé | une fois par épisode |
| `congested` | liaison | file de réception ou d'envoi pleine : plus anciennes trames jetées | une fois par épisode |
| `link-failed` | liaison ou `null` | erreur inattendue, ou raison illisible venue du natif | — |

### 2.5 `link:state`

- `available` : `lan` — un réseau Wi-Fi ou Ethernet existe (avec ou sans
  Internet) ; `ble` — Bluetooth LE présent, allumé et non refusé.
- `active` : la liaison tourne (télécommande : écoute **et** publication
  Bonjour, ou scan Bluetooth ; écran : recherche Bonjour, ou annonce Bluetooth).
- `error` : raison qui bloque la liaison demandée (`no-network`,
  `powered-off`, `unauthorized`, `local-network-denied`…), absente sinon.
- Un téléphone qui sert **lui-même de point d'accès** n'a pas de réseau Wi-Fi
  client : `lan` peut afficher `no-network` alors que les écrans connectés à
  son point d'accès le joignent quand même.

## 3. Découverte sans fuite du topic

Le pont dérive deux valeurs du topic `room` et ne transmet **que** celles-ci au
natif :

- `roomTag` = 8 premiers octets de SHA-256(UTF-8(room)), en hexadécimal
  (16 caractères) : seule information de session **diffusée** ;
- `authKey` = SHA-256(UTF-8(`"setremote-link/v1/auth:"` + room)) : clé de la
  poignée de main locale (§ 4.2), jamais diffusée.

| Liaison | Ce qui est diffusé |
|---|---|
| Wi-Fi | service `_setremote._tcp`, instance `SetRemote-<6 hex aléatoires>`, TXT `r=<roomTag>` et `v=1` |
| Bluetooth, écran iOS | UUID du service SetRemote ; nom local `SR<roomTag>` (iOS n'annonce ni données de service ni données fabricant) |
| Bluetooth, écran Android | UUID du service ; en réponse au scan, données de service `[0x01][roomTag]` (Android ne peut pas choisir le nom local sans renommer l'appareil) |

La télécommande accepte les deux formes. Limite : `roomTag` est stable pendant
une session, donc un observateur à portée peut reconnaître les appareils d'un
même plateau pendant la session (ni topic, ni clé, ni nom ne fuient).

## 4. Format sur le fil, version 1

Référence exécutable : `src/wire.ts` ; implémentations : `ios/LinkWire.swift`,
`android/…/LinkWire.kt`.

### 4.1 Messages

| Type | Octets | Contenu |
|---|---|---|
| HELLO `0x01` | 28 + n | `[0x01][version 1][rôle 'R' 0x52 \| 'S' 0x53][roomTag 8][nonce 16][n][nom UTF-8, n ≤ 128]` |
| AUTH `0x02` | 33 | `[0x02][HMAC-SHA256 32]` |
| DATA `0x03` | 1 + trame | `[0x03][trame UTF-8]` |
| PING `0x04` | 1 | maintien de la liaison, ignoré à la réception |

Décodage strict (longueurs exactes, version 1, rôle connu) ; un nom reçu est
décodé en UTF-8 tolérant, sans caractère de contrôle, coupé à 64 caractères.
Après admission, un type inconnu est ignoré (extensions futures).

### 4.2 Poignée de main

Chaque côté envoie HELLO dès que le canal est prêt (s'il ne l'a pas encore
fait, il l'envoie juste avant son AUTH) ; à réception du HELLO de l'autre, il
vérifie le rôle opposé et le `roomTag`, puis envoie
`AUTH = HMAC-SHA256(authKey, "SRL1" ‖ rôle de l'émetteur ‖ nonce du destinataire ‖ nonce de l'émetteur)` ;
il **admet** le pair quand l'AUTH reçu est vérifié (comparaison en temps
constant). Avant admission, seuls HELLO, AUTH et PING sont acceptés ; DATA
ferme la connexion. Nonces de 16 octets tirés à chaque connexion (pas de
rejeu) ; le rôle dans le MAC empêche de renvoyer à la télécommande son propre
AUTH (réflexion).

Ce n'est **pas** la sécurité des trames (assurée de bout en bout par
`packages/protocol`) : c'est un **filtre** qui écarte, avant qu'il n'occupe une
place de pair ou la file de réception, tout appareil qui ne connaît pas le
topic — y compris celui qui recopie le `roomTag` d'une annonce.

### 4.3 Wi-Fi : enregistrements

`[longueur u32 gros-boutiste][message]`, un flux TCP par pair. Longueur
vérifiée **avant** de lire le corps : 1 à 160 octets avant admission, 1 à
65 537 après. Avant admission, 256 octets en tout et 5 s au plus ; après,
PING si rien n'a été envoyé depuis 5 s, connexion fermée après **15 s sans
rien recevoir**. Pas de PING avant admission.

### 4.4 Bluetooth : fragmentation

Un message est découpé en valeurs GATT d'au plus MTU − 3 octets (plafonné à
512) : `[frameId u8][index u16 BE][count u16 BE][morceau]`. `frameId` est un
compteur propre à chaque pair et à chaque sens. Réassemblage tolérant au
désordre et aux doublons, avec limites : `count` 1 à 512, `index < count`,
message de 160 octets au plus avant admission et 4 097 après, **4 messages
incomplets** au plus par pair (le plus ancien est jeté), **5 s** pour
compléter un message. Même PING / 15 s qu'en Wi-Fi, en plus de la supervision
du lien radio.

GATT : service `CA098D33-DCA0-45ED-8875-D0DA84EF2400` ; caractéristique RX
`…2401` (write, write without response ; télécommande → écran) ; TX `…2402`
(notify ; écran → télécommande). Le central écrit **sans réponse** et
s'abonne à TX ; les écritures longues (préparées) sont refusées.

## 5. Choix techniques

### 5.1 Wi-Fi : TCP à longueur préfixée plutôt que WebSocket

- Les deux bouts sont **notre code natif** (la vue web ne se connecte jamais
  directement) : la poignée de main HTTP et le masquage WebSocket
  n'apportent rien.
- Android n'a **aucun serveur WebSocket** dans le système (il faudrait une
  bibliothèque) ; iOS en a un (`NWProtocolWebSocket`), mais deux piles
  différentes doubleraient la surface de bugs.
- Un en-tête de 4 octets se borne avant toute allocation (« 4 Go annoncés »
  ferme la connexion) ; pas d'analyseur HTTP exposé aux appareils étrangers.
- `NWConnection.receive(minimumIncompleteLength:maximumLength:)` et
  `DataInputStream.readInt()` / `readFully()` lisent exactement ce format.

**iOS** (`ios/LanLink.swift`) : `NWListener` TCP sur un port éphémère avec
`NWListener.Service` (TXT construit en format DNS-SD) ; `NWBrowser`
`.bonjourWithTXTRecord` ; `NWConnection` vers le résultat retenu. `noDelay`,
keepalive TCP, `includePeerToPeer = false` (pas d'AWDL), cellulaire interdit
(`prohibitedInterfaceTypes`). Au plus 256 Kio confiés à TCP par pair
(`.contentProcessed`), le reste attend dans la file bornée.
`NWPathMonitor` pour `available`.

**Android** (`android/…/LanLink.kt`) : `ServerSocket` sur un port éphémère,
toutes interfaces ; `NsdManager.registerService` (TXT `r`, `v`) ;
`discoverServices` puis `resolveService` **une résolution à la fois**
(obligatoire avant l'API 34, délai de garde 5 s) ; ne garde que les services
dont le TXT correspond. Le socket client est attaché au réseau Wi-Fi (ou
Ethernet) par **`Network.bindSocket()`** : sinon, quand les données mobiles
sont actives, un Wi-Fi sans Internet n'est pas le réseau par défaut et la
connexion partirait sur le cellulaire. Pas `bindProcessToNetwork()`, qui
détournerait aussi la vue web. Un fil de lecture et un fil d'écriture par
connexion (au plus 72 connexions, soit 144 fils), état sur un seul thread.
Suivi des réseaux Wi-Fi / Ethernet **avec ou sans Internet**
(`NetworkCallback`, regroupé 500 ms) ; recherche relancée quand un réseau
revient. Service fantôme (télécommande tuée sans retrait de l'annonce) ou
coupure passagère : après 4 échecs de connexion, un essai toutes les 30 s
seulement (il n'est pas oublié : NSD / le browser ne le reproposeraient pas
tant que l'annonce reste en cache) ; une télécommande relancée s'annonce sous
un nouveau nom, essayé en premier.

**Commun** : 8 connexions non admises à la fois (au-delà, fermées aussitôt),
64 pairs admis (au-delà, `too-many-peers`) ; reconnexion de l'écran avec
attente croissante (0,5 → 5 s), 30 s après un AUTH refusé.

### 5.2 Bluetooth

**iOS** (`ios/BleLink.swift`) : `CBCentralManager` (télécommande) et
`CBPeripheralManager` (écran) créés sur la file du module, **seulement** au
démarrage de la liaison (`CBManager.authorization` lu avant : pas de
création si l'accès est refusé). Scan sur l'UUID avec doublons autorisés
(au premier plan) pour voir la réponse au scan. MTU négocié par iOS
(`maximumWriteValueLength(for: .withoutResponse)`,
`maximumUpdateValueLength`). Écriture sans réponse au rythme de
`canSendWriteWithoutResponse` / `peripheralIsReady`, notifications au rythme
de `updateValue` / `peripheralManagerIsReady`. Un périphérique iOS **ne peut
pas déconnecter** un central : un central étranger ou muet est ignoré (60 s
après un AUTH refusé), au plus 4 centraux suivis.

**Android** (`android/…/BleLink.kt`) : `BluetoothLeScanner` filtré sur
l'UUID (`SCAN_MODE_LOW_LATENCY`, scan actif) ; `connectGatt(…,
TRANSPORT_LE)`, `requestMtu(517)`, `CONNECTION_PRIORITY_HIGH`, découverte,
CCCD ; écriture `WRITE_TYPE_NO_RESPONSE` une à la fois au rythme de
`onCharacteristicWrite` (API 33+ : nouvelles signatures, sinon anciennes).
Écran : `BluetoothGattServer` (CCCD déclaré à la main) et
`BluetoothLeAdvertiser` (`ADVERTISE_MODE_LOW_LATENCY`, puissance haute,
connectable) ; notifications une à la fois au rythme de `onNotificationSent`.
Le serveur GATT ne touche **jamais** aux connexions d'autres appareils
(montre, écouteurs) : seuls les centraux abonnés à notre service ont une
session. Suivi de `ACTION_STATE_CHANGED` (Bluetooth éteint / rallumé).
Échec 133 et déconnexions : nouvel essai au scan suivant (1 s après une
liaison admise, 5 s après un échec, 60 s après un AUTH refusé).

### 5.3 Files et contre-pression

| File | Plafond | Plein |
|---|---|---|
| Réception (natif → JS) | 1 024 trames, 8 Mio | les plus anciennes jetées, `congested` |
| Lot remis à JS | 256 trames, 1 Mio, toutes les 20 ms | le reste attend le relevé suivant |
| Envoi Wi-Fi, par pair | 1 Mio (+ 256 Kio confiés à TCP) | les plus anciennes jetées, `congested` |
| Envoi Bluetooth, par pair | 64 Kio (≈ 10 s à 6 Ko/s) | idem |
| Réassemblage Bluetooth, par pair | 4 messages incomplets, 4 097 octets chacun, 5 s | le plus ancien jeté |

### 5.4 Autorisations

| | iOS | Android |
|---|---|---|
| Wi-Fi | invite « réseau local » (`NSLocalNetworkUsageDescription`, déjà dans `app.json`) ; `NSBonjourServices` contient `_setremote._tcp` (config plugin) | `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE` (installation). Android 17 (API 37) ajoutera `ACCESS_LOCAL_NETWORK` (exécution) : à déclarer et demander avant de cibler l'API 37 (cible actuelle : 36). |
| Bluetooth | `NSBluetoothAlwaysUsageDescription` (texte dans `app.json`, option du plugin) ; invite à la création du premier gestionnaire CoreBluetooth ; **aucun** mode d'arrière-plan | API 31+ : `BLUETOOTH_SCAN` (`neverForLocation`) + `BLUETOOTH_CONNECT` (télécommande), `BLUETOOTH_ADVERTISE` + `BLUETOOTH_CONNECT` (écran), demandées au démarrage via le gestionnaire d'Expo. API ≤ 30 : `BLUETOOTH`, `BLUETOOTH_ADMIN`, `ACCESS_FINE_LOCATION` bornées par `maxSdkVersion="30"` ; la localisation n'est demandée qu'à la télécommande (scan). `bluetooth_le` non requis. |

## 6. Limites des plateformes

- **Connexions Bluetooth simultanées** : aucune limite documentée par Apple
  ni par Android ; en pratique un central iOS tient environ 8 à 10 liaisons
  actives, un central Android 4 à 7 selon la puce (souvent 7 dans les piles
  anciennes). Le module plafonne à **8 écrans Bluetooth** par télécommande
  (`maxBlePeers` / `MAX_BLE_PEERS`) et **4 centraux** par écran. Au-delà, ou
  pour plus de quelques écrans, utiliser le Wi-Fi local.
- **Débit Bluetooth** : partagé entre toutes les liaisons d'un même
  téléphone (une seule radio). Ordre de grandeur avec écriture sans
  réponse : quelques Ko/s à quelques dizaines de Ko/s par écran selon le MTU
  (23 à 517), l'intervalle de connexion (iOS : 15 à 30 ms) et la PHY. Un
  `dmx:look` chiffré fait 200 à 700 caractères (`docs/DMX-NATIVE.md` § 6) :
  30 messages/s pour un écran passent ; des médias, non (plafond de 4 Kio par
  trame). À mesurer : `expo-app/TESTFLIGHT.md`, « Liaisons hors ligne ».
- **Arrière-plan iOS** : un périphérique iOS en arrière-plan n'annonce plus son
  nom local et un central n'y scanne qu'au ralenti ; les sockets sont
  suspendus. D'où le choix **premier plan uniquement** (l'app garde déjà
  l'écran allumé). Android : même règle, pour la batterie et parce que le
  système limite le scan en arrière-plan.
- **Android ≤ 11** : sans localisation activée, le scan ne voit rien
  (`location-off`). Android 12+ : rien de tel (`neverForLocation`).
- **Pas d'AWDL** (Wi-Fi d'égal à égal d'Apple) : la liaison Wi-Fi suppose un
  routeur (même sans Internet), un réseau filaire, ou un point d'accès.
- **Annonce Bluetooth** : 31 octets ; l'UUID 128 bits prend 18 octets du
  paquet d'annonce, le `roomTag` passe dans la réponse au scan (scan actif
  requis : c'est le cas au premier plan sur les deux plateformes).

## 7. Vérifié / à vérifier

Vérifié sans appareil (Linux) :

- `npx tsc --noEmit` ; `cd expo-app && npm test` : pont (validation,
  plafonds, lots, événements, `reset`), SHA-256 / HMAC et `roomTag` contre
  `node:crypto`, format sur le fil (poignée de main contre appareils
  étrangers, rejeu, réflexion ; enregistrements et fragments hostiles,
  délais, plafonds), cohérence des constantes / UUID / noms entre TS, Swift
  et Kotlin, config plugin, branchement de la coque ;
- `npx expo export` iOS et Android (le bundle contient le pont, pas
  `src/wire.ts`, ni rien des anciens transports) ;
- `npx expo prebuild` iOS et Android dans une copie : pod `SetRemoteLink` et
  projet Gradle `setremote-link` autoliés ; Info.plist (`NSBonjourServices`
  `_setremote._tcp`, textes Bluetooth et réseau local, aucun
  `UIBackgroundModes`) ; manifeste Android (permissions ci-dessus, aucune
  localisation au-delà de l'API 30) ; plus aucune trace de
  `react-native-ble-plx` ni de `react-native-tcp-socket` ;
- **Kotlin compilé** (Kotlin 2.0.21, framework Android API 36 + stubs
  reprenant les signatures d'`expo-modules-core` 56.0.17) et codec rejoué sur
  JVM contre les vecteurs de la référence TypeScript (HELLO, HMAC,
  enregistrements, fragments, réassemblage, déluge aléatoire, file bornée) ;
- **Swift** : syntaxe vérifiée (tree-sitter-swift), **pas compilé** (ni Xcode
  ni compilateur Swift ici) : le premier build EAS iOS le vérifiera ; en cas
  d'erreur, elle est dans `modules/setremote-link/ios/*.swift`.

À vérifier sur appareils : `expo-app/TESTFLIGHT.md`, « Liaisons hors ligne »
(deux à quatre téléphones, routeur de voyage sans Internet, mode avion avec
Bluetooth, arrière-plan, portée, iPhone ↔ Android).

## 8. Anciens écrans natifs retirés

Les écrans `app/native.tsx`, `app/remote.tsx`, `app/screen.tsx` et leurs
transports **en clair** (`src/transport/` : MQTT, TCP 8777 une trame JSON par
ligne, BLE central seul) ont été supprimés, avec `src/components/`, les
utilitaires de `src/lib/` qu'ils étaient seuls à utiliser (seul
`pdfPreview.ts` reste) et `expo-app/CONNECTIVITY.md`. Dépendances retirées :
`react-native-ble-plx` (et son plugin : permissions Bluetooth et localisation
**sans borne**), `react-native-tcp-socket`, `mqtt`, `react-native-qrcode-svg`,
`react-native-svg`, `expo-network`, `expo-image`, `expo-video` (et son
plugin). Conservés car la vue web en a besoin : `expo-camera` et
`expo-image-picker` (textes d'autorisation appareil photo, micro, photos pour
`getUserMedia` et les sélecteurs de fichiers), `expo-navigation-bar`,
`expo-print`, `expo-file-system`, `expo-brightness`, `expo-keep-awake`.

## 9. Risques et suites

- **Swift jamais compilé** : erreurs de typage possibles au premier build.
- **Comportements radio** non testés : flux de rappels CoreBluetooth / GATT
  propres à certains appareils (erreur 133, rappels manquants : filets de
  sécurité en place, à valider), interopérabilité iPhone ↔ Android.
- **Nom avant authentification** (§ 2.3) et **`roomTag` stable** (§ 3) :
  fuites mineures assumées ; une étiquette tournante (HMAC du topic et d'une
  période) supprimerait la seconde au prix d'une découverte plus complexe.
- **Pertes sous charge** : files bornées qui jettent les plus anciennes ; la
  vue web doit tolérer des trous (elle le fait déjà pour MQTT).
- **Coupure Android pendant l'aperçu PDF** : l'activité d'impression met
  l'app en pause plus de 2 s ; les liaisons sont coupées puis rouvertes au
  retour.
- **API 37 Android** : `ACCESS_LOCAL_NETWORK` à ajouter avant de la cibler.

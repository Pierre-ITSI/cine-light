# Passerelle DMX : réception UDP dans l'app native (Expo SDK 56)

Pour les développeurs. Complète `docs/DMX.md` (manuel des pupitreurs) et le
paquet `packages/dmx` (moteur). Sources consultées le **15 octobre 2026**
(§ 9 : 16 octobre 2026).

> **État** : l'option B est réalisée dans `expo-app/modules/setremote-udp`
> (Swift, Kotlin, pont TypeScript). Le **contrat du pont** entre la vue web et
> le natif, les choix de sockets et la variable d'entitlement sont au **§ 9**,
> qui prime sur les propositions des § 1 et 4. Le **côté vue web** (moteur
> assemblé dans la PWA sous la globale `SRDMX`, écrans de la passerelle) est
> au **§ 10**.

## 1. Ce qu'il faut côté natif

Le moteur (`packages/dmx`, JavaScript sans dépendance) tourne dans Hermes : il
analyse les datagrammes, fusionne les sources, décode les personnalités et
produit les messages `dmx:look`. Le natif n'a que trois rôles :

1. **Recevoir** les datagrammes UDP sur **5568** (sACN) et **6454** (Art-Net),
   en unicast, et si possible en multicast (`239.255.{hi}.{lo}`) et broadcast.
2. **Envoyer** un datagramme UDP (ArtPollReply, unicast vers la console).
3. **Remonter les datagrammes à JS** avec l'adresse de l'émetteur, sans
   saturer le pont : par lots (par exemple toutes les 10 ms), en `Uint8Array`.

Ordre de grandeur : un univers sACN complet à 44 Hz = 44 paquets/s de
638 octets ; même 8 univers (≈ 350 paquets/s) restent légers pour Hermes. Inutile
de décoder en natif.

```js
// Intégration visée (pseudo-code)
import { GatewayEngine, Patch } from '@setremote/dmx';
const engine = new GatewayEngine({
  patch, send: (msg) => channel.send(msg),                     // session chiffrée (packages/protocol)
  sendUdp: (bytes, host, port) => Udp.send(bytes, host, port), // ArtPollReply
  artPollReply: { ip: myIp, shortName: 'SetRemote GW', longName: 'SetRemote passerelle DMX' },
  callEntries, smsEntries,                                     // listes enregistrées de la télécommande
});
Udp.addListener('packets', ({ packets }) => packets.forEach((p) => engine.handlePacket(p.data, p)));
engine.start();                                                 // tick() toutes les 10 ms
```

## 2. Contraintes de la plateforme

- **Expo SDK 56 / React Native 0.85** : depuis le SDK 55, la **New
  Architecture est toujours active** et l'ancienne architecture est gelée
  depuis juin 2025 ([Expo, New Architecture](https://docs.expo.dev/guides/new-architecture/)).
  Une bibliothèque sans TurboModule ne fonctionne que via la couche de
  compatibilité (interop) : à tester, sans garantie à long terme.
- Le projet utilise déjà un **dev client** (`react-native-tcp-socket`,
  `react-native-ble-plx`) : un module natif de plus ne change pas la chaîne de
  build (`expo prebuild`, EAS).
- iOS : `NSLocalNetworkUsageDescription` est déjà déclaré dans
  `expo-app/app.json` (invite « réseau local »).
- La passerelle doit rester **au premier plan, écran allumé**
  (`expo-keep-awake` est déjà présent) : iOS suspend les sockets d'une app en
  arrière-plan.

## 3. Option A : `react-native-udp`

| Critère | Constat |
|---|---|
| Maintenance | Dernière version **4.1.7 du 26/01/2023** (registre npm), aucune depuis. |
| New Architecture | **Pas de spec TurboModule** (`codegenConfig` absent) : module « legacy » via la couche d'interop. Demande de support New Arch ouverte en janvier 2026 ([issues](https://github.com/tradle/react-native-udp/issues)). |
| Expo | Pas de config plugin ; utilisable en dev client. |
| Multicast | iOS : `joinMulticastGroup` (CocoaAsyncSocket `GCDAsyncUdpSocket`). Android : `addMembership` sur `MulticastSocket`, avec **acquisition d'un `MulticastLock`** ([UdpSockets.java](https://github.com/tradle/react-native-udp/blob/master/android/src/main/java/com/tradle/react/UdpSockets.java)). |
| Performances | Un événement JS **par datagramme**, charge utile en **base64** dans une chaîne : 44 à 350 événements/s et un décodage base64 par paquet. |
| Variante | [`react-native-udp-turbo`](https://github.com/OwenRay/react-native-udp-turbo) est un TurboModule, mais **Android uniquement**. |

Bilan : utilisable pour un prototype, mais une dépendance figée depuis 2023 sur
la couche d'interop, sans regroupement des paquets ni données binaires, n'est
pas une base solide.

## 4. Option B (recommandée) : module Expo local en Swift et Kotlin

Créé avec `npx create-expo-module@latest --local` (dossier `modules/`,
autolinking ; [Expo Modules](https://docs.expo.dev/modules/get-started/)).
API proposée, volontairement minimale (proposition initiale ; l'API réalisée,
pilotée par la vue web, est au § 9) :

```ts
// modules/setremote-udp/index.ts
start(opts: { ports: number[]; multicastGroups?: string[]; interfaceName?: string }): Promise<void>
stop(): Promise<void>
send(data: Uint8Array, host: string, port: number): Promise<void>
getInterfaces(): Promise<{ name: string; address: string; wired: boolean }[]>
// événement 'packets' : { packets: { data: Uint8Array; address: string; port: number; localPort: number }[] }
// émis au plus toutes les 10 ms (regroupement natif)
```

### iOS (Swift)

- **Unicast** : sockets BSD UDP (`socket`/`bind`/`recvfrom`) sur une
  `DispatchQueue` dédiée, une par port, avec `SO_REUSEADDR` ; ou `NWListener`
  (Network.framework) en UDP. Les deux fonctionnent **sans autorisation
  spéciale** : seule l'invite « réseau local » s'affiche.
- **Multicast / broadcast** : `NWConnectionGroup` + `NWMulticastGroup`
  (méthode décrite par Apple) ; exige l'**autorisation
  `com.apple.developer.networking.multicast`** (voir § 5).
- Envoi de l'ArtPollReply : `sendto` sur le socket lié au port 6454 (la
  réponse part du port 6454, unicast vers la console).
- Données remontées en `Data` → `Uint8Array` côté JS (typed arrays pris en
  charge par Expo Modules).

### Android (Kotlin)

- **Unicast et broadcast** : `DatagramSocket` lié au port (`reuseAddress =
  true`, `broadcast = true`) ; boucle de réception sur un thread dédié.
- **Multicast sACN** : `MulticastSocket(5568).joinGroup(InetSocketAddress(group,
  0), networkInterface)` pour chaque univers patché.
- **`WifiManager.MulticastLock`** : sans lui, la pile Wi-Fi filtre les paquets
  qui ne sont pas adressés à l'appareil ; l'acquérir pendant la réception,
  le relâcher à l'arrêt (consommation) — également utile pour le broadcast
  (ArtPoll) sur certains appareils
  ([MulticastLock](https://developer.android.com/reference/android/net/wifi/WifiManager.MulticastLock)).
- **Permissions** : `INTERNET`, `ACCESS_WIFI_STATE`,
  `CHANGE_WIFI_MULTICAST_STATE`. **Android 17 (API 37)** ajoute la permission
  d'exécution **`ACCESS_LOCAL_NETWORK`** (groupe NEARBY_DEVICES) : obligatoire
  dès que l'app cible l'API 37 (les erreurs UDP apparaissent alors en `EPERM`) ;
  en dessous, elle est accordée implicitement avec `INTERNET`
  ([Local network permission](https://developer.android.com/privacy-and-security/local-network-permission),
  [changements Android 17](https://developer.android.com/about/versions/17/behavior-changes-17)).
- **Ethernet** : un adaptateur USB-C → Ethernet apparaît comme une interface
  distincte (souvent `eth0`) ; choisir explicitement l'interface pour
  `joinGroup`. Le `MulticastLock` ne concerne que le Wi-Fi (inoffensif en
  filaire).

### Pourquoi l'option B

Binaire natif de bout en bout (pas de base64), regroupement des paquets,
API du New Arch via Expo Modules, choix de l'interface (filaire ou Wi-Fi),
code court (≈ 200 lignes par plateforme) et maîtrisé, alors que
`react-native-udp` est figé depuis 2023.

## 5. iOS : l'autorisation « multicast networking »

- Pour **recevoir (ou envoyer) du multicast ou du broadcast UDP**, une app iOS
  doit disposer de l'autorisation (*entitlement*)
  **`com.apple.developer.networking.multicast`**, **accordée par Apple sur
  demande** :
  documentation <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.networking.multicast>,
  formulaire <https://developer.apple.com/contact/request/networking-multicast>,
  présentation <https://developer.apple.com/news/?id=0oi77447>.
- L'**UDP unicast n'en a pas besoin** (FAQ Local Network Privacy du support
  développeurs Apple : <https://developer.apple.com/forums/thread/663875>) ;
  seule l'invite « réseau local » s'applique.
- Conséquence : **la passerelle fonctionne sur iPhone et iPad dès maintenant
  en sACN ou Art-Net unicast**, la console envoyant vers l'IP de la passerelle.
  Il faut l'autorisation pour : sACN multicast, découverte Art-Net (ArtPoll en
  broadcast, donc l'apparition automatique de la passerelle dans la console),
  découverte sACN (univers 64214).
- Démarches : remplir le formulaire avec l'usage précis (sACN 239.255.x.y:5568,
  ArtPoll broadcast :6454) ; délai rapporté de quelques jours à deux semaines,
  sans suivi ; une fois accordée, activer la capacité sur l'App ID et le profil
  de provisionnement, puis déclarer l'entitlement. Le simulateur fonctionne
  sans. **Ne pas l'écrire dans `app.json`** : il est ajouté par le config
  plugin du module quand `SETREMOTE_MULTICAST_ENTITLEMENT=1` (§ 9.4).

## 6. Débits : console → passerelle → écrans

**Entrée (réseau lumière)**, par univers à 44 Hz : sACN 638 octets + 42
d'en-têtes ≈ **30 ko/s (240 kbit/s)** ; Art-Net 530 + 42 ≈ 25 ko/s. Négligeable,
y compris en Wi-Fi.

**Sortie (session)**, mesuré avec `packages/protocol` (trame chiffrée) :
`dmx:look` couleur seule = 110 octets JSON → **200 caractères** chiffrés ;
look complet = 386 ; un look partagé par 20 écrans en miroir = 682. Avec les
en-têtes MQTT/WebSocket/TLS/TCP/IP, compter **≈ 320 octets** par message
simple.

| Cas | Messages/s | Débit montant de la passerelle | Reçu par chaque écran |
|---|---:|---:|---:|
| 1 écran, fondu continu (≤ 30/s) | 30 | ≈ 10 ko/s | ≈ 10 ko/s |
| 20 écrans, tous différents, fondus continus | 600 | ≈ 190 ko/s (1,5 Mbit/s) | **liaison locale** : ≈ 10 ko/s · **relais** : ≈ 190 ko/s |
| 20 écrans en miroir (un seul look) | 30 | ≈ 24 ko/s | ≈ 24 ko/s |
| Repos (maintien 1/s) | 20 | ≈ 6 ko/s | ≈ 0,3 ko/s (local) |

- **Relais (MQTT)** : la session n'a **qu'un topic** ; chaque écran reçoit
  **tous** les messages de la passerelle et jette ceux qui ne lui sont pas
  destinés (`target`). À 20 écrans actifs, chaque téléphone déchiffre 600
  trames/s pour en garder 30, et le relais réémet ≈ 3,8 Mo/s (20 × 190 ko/s).
  S'y ajoutent 50 à 200 ms de latence et de la gigue. Acceptable pour quelques
  écrans ou des changements lents ; sinon baisser `maxRate` (ex. 10/s).
- **Liaison locale (recommandée)** : la passerelle sert les écrans en direct sur
  le réseau du plateau (comme le mode Wi-Fi local, TCP 8777) et n'envoie à chaque
  socket que les messages qui le concernent : ≤ 30 messages/s par écran,
  latence de quelques ms. Chaîne complète typique : console → passerelle < 1 ms
  (filaire), regroupement ≤ 33 ms (limite 30/s), réseau ≈ 5 ms, affichage
  ≈ 16 ms : **≈ 30 à 60 ms**.

## 7. Plan de mise en œuvre

1. **Module natif** `modules/setremote-udp` (Expo Modules) : **fait** (§ 9),
   regroupement 20 ms, choix d'interface ; reste à tester sur appareil avec
   `sACNView`, la sortie unicast d'une console (grandMA3 onPC, Eos Nomad,
   MagicQ PC, Titan onPC) et Wireshark (`expo-app/TESTFLIGHT.md`).
2. **iOS unicast d'abord** (sockets BSD), sans autorisation : **fait** ;
   **déposer la demande d'autorisation multicast** en parallèle.
3. **Android** : `MulticastSocket`, `MulticastLock`, permissions : **fait**
   (`ACCESS_LOCAL_NETWORK` à ajouter avant de cibler l'API 37 ; cible
   actuelle : 36).
4. **Brancher le moteur** — dans la **vue web** (le moteur y tourne, § 9) :
   `GatewayEngine.handlePacket` sur les `dmx:packets`, `sendUdp` sur
   `udp:send`, `send` sur le canal chiffré : **fait** (§ 10).
5. **Écran de la passerelle** — **fait** (maquettes 14 à 17, § 10) : IP,
   masque et interface (lecture seule) avec voyant de réception, univers
   reçus, patch (`Patch.check()`, `autoAddress()`), moniteur de tous les
   canaux d'un écran, table des canaux d'un mode.
6. **Côté écran** — **fait pour la PWA** (`web/js/36-dmx-screen.js`) : route
   `dmx:look` dans `MSG_ROUTES` ; ordre `seq` ; priorité console tant que
   `live` ; reprise par la télécommande après `live: false` ou 3 s sans
   message ; strobe redémarré seulement s'il change (voir `docs/DMX.md`
   § 7–8). Reste l'équivalent dans l'écran natif d'`expo-app`.
7. **Appels et SMS** — **fait** : la télécommande-passerelle donne au moteur
   les 20 premières entrées de ses listes enregistrées (onglet Appel,
   maquette 18) à chaque modification (`setTriggerEntries`) ; une entrée
   déclenchée envoie d'abord sa photo / sa bande son (`__callphoto`,
   `__callaudio`) si elles diffèrent de celles en cache sur les écrans, puis
   `call:start`.
8. **Liaison locale passerelle → écrans** pour les plateaux de plus de
   quelques écrans (§ 6).
9. **Retirer l'ancien mode DMX** (3CH/9CH, pont WebSocket, plugin Capacitor
   `SACN`) : **fait** (bouton « Mode DMX » de l'accueil, `screen.html`,
   `web/js/60-sacn.js` supprimés ; voir `docs/DMX.md` § 8).

## 8. Codes de rejet des analyseurs

Les analyseurs ne lèvent jamais d'exception sur une donnée réseau ; ils
renvoient `{ ok: false, reason }` (comptés dans `engine.snapshot().counters`).

| Protocole | Codes |
|---|---|
| sACN (`parseSacn`) | `type`, `too-short`, `too-long`, `preamble`, `postamble`, `acn-id`, `root-flags`, `root-length`, `root-vector`, `framing-flags`, `framing-length`, `framing-vector`, `priority` (> 200), `sync-address`, `universe` (hors 1–63999), `dmp-flags`, `dmp-length`, `dmp-vector`, `dmp-address-type`, `dmp-first-address`, `dmp-increment`, `dmp-count`, `start-code` (START code non nul), `discovery-flags`, `discovery-length`, `discovery-vector` |
| Art-Net (`parseArtNet`) | `type`, `too-short`, `too-long`, `id`, `protocol-version` (< 14), `length` (Length hors 2–512 ou impaire), `truncated`, `port-address` (Net > 127), `unsupported-opcode` |
| Moteur (`handlePacket`) | `unknown-protocol` ; issues de fusion : `applied`, `unchanged`, `staged`, `held`, `synced`, `terminated`, `ignored-preview`, `out-of-sequence`, `ignored-extra-source`, `discovery`, `poll-replied`, `poll-not-targeted`, `poll-ignored` |

## 9. Module `setremote-udp` : contrat du pont et choix techniques

Réalisé dans `expo-app/modules/setremote-udp` (module Expo local, autolinké
depuis `expo-app/modules/`) et branché dans `expo-app/app/index.tsx`. La
passerelle tourne dans la **vue web** (moteur `packages/dmx` côté page) ; le
natif ne fait que recevoir et envoyer des datagrammes.

```
modules/setremote-udp/
  expo-module.config.json   autolinking : SetRemoteUdpModule (iOS), expo.modules.setremoteudp.SetRemoteUdpModule (Android)
  index.ts                  module natif + pont
  src/bridge.ts             contrat, validation, relevé par lots (pur, testé sous Node)
  src/SetRemoteUdpModule.ts requireOptionalNativeModule('SetRemoteUdp') (null sans le module)
  ios/                      SetRemoteUdpModule.swift (API JS), UdpGateway.swift (sockets), SetRemoteUdp.podspec
  android/                  SetRemoteUdpModule.kt, UdpGateway.kt, AndroidManifest.xml (permissions)
  app.plugin.js             entitlement multicast (variable d'environnement), permissions Android
  test/bridge.test.mjs      cd expo-app && npm test
```

### 9.1 Contrat du pont (figé, partagé avec le côté web)

**Page → natif** : `window.ReactNativeWebView.postMessage(JSON.stringify(msg))`.

| Message | Effet |
|---|---|
| `{type:'dmx:listen', protocol:'sacn'\|'artnet', universes:[int], multicast:boolean}` | Démarre l'écoute, ou **remplace** celle en cours (une seule à la fois). sACN : UDP **5568** ; si `multicast`, adhésion à `239.255.(u>>8).(u&255)` pour chaque univers, sur l'interface active (Ethernet, sinon Wi-Fi). Art-Net : UDP **6454**, unicast + broadcast. |
| `{type:'dmx:stop'}` | Arrête l'écoute, vide la file. |
| `{type:'udp:send', host:string, port:int, data:base64}` | Envoie un datagramme (ex. ArtPollReply) **depuis le socket d'écoute**, donc depuis le port 5568 ou 6454. |
| `{type:'net:info'}` | Demande la liste des interfaces (réponse `net:info`). |

**Natif → page** : `webView.injectJavaScript("window.SRNative&&window.SRNative.receive(" + JSON + ");true;")`.
La page définit `window.SRNative = { receive(msg) { … } }` ; tant qu'elle ne
l'a pas fait, les messages sont perdus sans erreur.

| Message | Quand |
|---|---|
| `{type:'dmx:packets', packets:[{src:'ip', port:int, data:base64}]}` | Datagrammes bruts reçus, **par lots toutes les 20 ms**, jamais de lot vide. `src`/`port` = adresse et port de l'**émetteur**. |
| `{type:'net:info', interfaces:[{name, kind:'ethernet'\|'wifi'\|'other', ip, mask}]}` | En réponse à `net:info`, à chaque **changement de réseau** (regroupé, sans doublon) et au retour au premier plan. **IPv4 uniquement.** |
| `{type:'dmx:error', reason:string}` | Voir § 9.2. |

Précisions :

- **Validation** (`src/bridge.ts`, refaite par le natif) : `protocol` ∈
  {sacn, artnet} ; `universes` : tableau d'au plus **64** entiers (absent =
  `[]`, doublons retirés), sACN 1–63999 plus **64214** (découverte E1.31),
  Art-Net 0–32767 (Port-Address) ; `multicast` : seul `true` l'active ;
  `host` : IPv4 littérale `a.b.c.d` (jamais de DNS, ni `0.0.0.0`) ; `port`
  1–65535 ; `data` : base64 avec bourrage, **1 à 1500 octets**. Message
  invalide : `dmx:error` `invalid-…`, rien n'est envoyé au natif.
- **`multicast` en Art-Net** (qui n'utilise pas le multicast) : « je veux aussi
  le trafic de groupe », c'est-à-dire l'**ArtPoll en broadcast**. Android
  prend alors le `MulticastLock` (le Wi-Fi filtre aussi le broadcast) ; iOS
  sans entitlement répond `multicast-not-permitted`. Le socket reçoit le
  broadcast quand le système le permet, quel que soit le drapeau.
- **Débit** : file native de 512 datagrammes ; le pont la relève toutes les
  20 ms, au plus **128** paquets par lot. Si JS prend du retard, ce sont les
  **plus anciens** qui sont jetés (file pleine, ou plus de 128 en attente au
  relevé) : en DMX seul l'état le plus récent d'un univers compte. Datagrammes
  de plus de 1500 octets ignorés (sACN ≤ 638, Art-Net ≤ 530). Limite : le
  contrat n'a pas d'accusé de réception ; si c'est le **moteur de la vue web**
  (et non le thread JS de React Native) qui prend du retard, les lots déjà
  injectés s'exécutent en différé au lieu d'être jetés. La page doit donc
  traiter un lot vite (analyse et fusion, rendu à part).
- **Cycle de vie** : en arrière-plan, le natif **ferme les sockets** (iOS les
  suspendrait ; Android relâche aussi le `MulticastLock`) et les **rouvre au
  retour** si la page écoutait, puis republie `net:info`. Un **nouveau
  document** dans la vue web (navigation, rechargement, plantage du moteur
  web) arrête l'écoute ; un simple changement d'ancre (`#`) non. Le natif ne
  journalise jamais le contenu des paquets.
- **Décodage côté page** : `Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0))`
  puis `engine.handlePacket(bytes, { address: p.src, port: p.port })` ; pour
  `sendUdp(bytes, host, port)` du moteur : `udp:send` avec
  `btoa(String.fromCharCode(...bytes))`.

### 9.2 Raisons de `dmx:error`

| `reason` | Origine | État de l'écoute |
|---|---|---|
| `invalid-protocol`, `invalid-universes`, `invalid-host`, `invalid-port`, `invalid-data` | validation (pont, puis natif) | inchangé ; commande ignorée |
| `native-unavailable` | binaire sans le module (Expo Go, ancien build, navigateur) | — |
| `bind-failed` | port 5568 / 6454 refusé (pris par une autre app sans partage) | **arrêtée** |
| `socket-failed` | erreur de réception (socket invalidé par le système) | **arrêtée** |
| `listen-failed` | erreur inattendue du module au démarrage | **arrêtée** |
| `multicast-not-permitted` | iOS : binaire sans l'entitlement multicast (ou groupe refusé, EPERM) ; aussi `udp:send` vers une adresse de groupe | **l'unicast continue** |
| `multicast-failed` | adhésion multicast refusée pour une autre raison | **l'unicast continue** |
| `not-listening` | `udp:send` sans écoute (pas de port source) | — |
| `send-failed` | échec de l'envoi (iOS : souvent l'accès au réseau local refusé) | inchangé |

Après une erreur « arrêtée », la page peut renvoyer `dmx:listen`.

### 9.3 Choix des sockets

**iOS (Swift)** : `ios/UdpGateway.swift`.

- **Unicast et broadcast : un socket BSD** par écoute (`socket`/`bind` sur
  `0.0.0.0:<port>`, `SO_REUSEADDR` + `SO_REUSEPORT`, `SO_BROADCAST`, non
  bloquant), lu par une `DispatchSource` sur une file série. Pourquoi pas
  `NWListener` : Network.framework **ne gère pas le broadcast** (TN3151 :
  « If you need something that's not supported by Network framework, use BSD
  Sockets » ; Quinn, forums Apple 655920 et 756489) ; en UDP, un `NWListener`
  crée une `NWConnection` par émetteur (à accepter, démarrer et nettoyer) et
  ne permet pas d'envoyer **depuis son port** vers un hôte quelconque ; or
  l'ArtPollReply doit partir du port 6454. `recvfrom()` donne directement
  l'adresse de l'émetteur et `sendto()` répond depuis le même socket.
- **Multicast sACN : `NWConnectionGroup` + `NWMulticastGroup`** (méthode
  documentée par Apple), `requiredInterface` = interface filaire sinon Wi-Fi
  (d'après `NWPathMonitor`), `allowLocalEndpointReuse` pour partager le port
  5568 avec le socket BSD. Si le groupe échoue pour une autre raison qu'une
  permission (ex. `EADDRINUSE` si le partage de port est refusé), **repli** :
  `IP_ADD_MEMBERSHIP` sur le socket BSD (l'entitlement couvre aussi les
  sockets BSD). Le groupe est recréé quand l'interface préférée change.
- **Sans l'entitlement** : recevoir de l'**unicast** n'exige ni
  l'entitlement ni même l'accès au réseau local (TN3179, tableau « Receiving
  an incoming UDP unicast : no »). Le module sait si le binaire porte
  l'entitlement grâce à la clé Info.plist `SetRemoteMulticastEntitlement`
  (posée par le config plugin) : sinon il répond `multicast-not-permitted` dès
  `dmx:listen` (sACN `multicast:true`, ou Art-Net `multicast:true`), sans
  tenter le groupe, et l'unicast continue. Un échec `EPERM`/`EACCES` du groupe
  donne la même raison. Le simulateur est réputé autorisé.
- **Invite « réseau local »** : l'envoi (ArtPollReply) l'exige. Au démarrage
  de l'écoute, le module connecte un socket UDP à une adresse du sous-réseau
  (port 9, aucun trafic, méthode de TN3179) pour faire apparaître l'invite à
  ce moment-là plutôt qu'au premier ArtPollReply.
- **`net:info`** : `getifaddrs` (IPv4, interfaces actives hors boucle locale) ;
  type d'après `NWPathMonitor` (`.wiredEthernet`, `.wifi`), à défaut
  heuristique `en0` = Wi-Fi, autres `enN` = Ethernet (les noms BSD ne sont
  pas une API, TN3179).

**Android (Kotlin)** : `android/…/UdpGateway.kt`.

- **Un `MulticastSocket`** lié à `0.0.0.0:<port>` (`SO_REUSEADDR`,
  `SO_BROADCAST`, tampon de réception 1 Mo), lu par un **thread dédié** ;
  toute la gestion d'état sur un seul thread (`ScheduledExecutorService`).
- **Réseau** : Ethernet s'il existe (`NetworkCapabilities.TRANSPORT_ETHERNET`),
  sinon Wi-Fi. Les sockets y sont attachés par **`Network.bindSocket()`**,
  pas par `bindProcessToNetwork()` qui ferait aussi passer la vue web (relais
  MQTT, WebRTC) par un réseau lumière souvent sans Internet. Les groupes sont
  rejoints sur l'interface de ce réseau. Changement de réseau (callback
  `ConnectivityManager`, regroupé 300 ms) : sockets rouverts sur le nouveau.
- **`WifiManager.MulticastLock`** (non compté) tenu **seulement pendant une
  écoute `multicast:true`**, relâché à l'arrêt et en arrière-plan.
- Linux limite les adhésions IGMP à **20 par socket**
  (`igmp_max_memberships`) : au-delà, des sockets auxiliaires sur un port
  éphémère portent les adhésions suivantes et le socket principal reçoit ces
  groupes (`IP_MULTICAST_ALL`, actif par défaut sous Linux).
- **`net:info`** : `ConnectivityManager` / `LinkProperties` de chaque réseau,
  type par `TRANSPORT_ETHERNET` / `TRANSPORT_WIFI` (VPN : `other`).
- **Permissions** (manifeste du module + config plugin) : `INTERNET`,
  `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE`.
  Cible actuelle : API 36 ; `ACCESS_LOCAL_NETWORK` (permission d'exécution)
  sera à ajouter et à demander avant de cibler l'API 37.

**Commun** : base64 calculé en natif à la réception (pas sur le thread JS) ;
file bornée, relevée par `drain(max)` **synchrone** depuis le pont toutes les
20 ms : si le thread JS est en retard, il relève moins souvent et la file jette
les plus anciens. Événements natifs nommés `onSetRemoteUdpError` et
`onSetRemoteUdpNetwork` (sur iOS, un événement est remis à tout module qui
déclare le même nom).

### 9.4 Entitlement multicast iOS : variable `SETREMOTE_MULTICAST_ENTITLEMENT`

| Valeur | Effet au prebuild (`app.plugin.js`) |
|---|---|
| absente, `0`, `false`… (**défaut**) | pas d'entitlement ; Info.plist `SetRemoteMulticastEntitlement = false` → sACN multicast et ArtPoll broadcast répondent `multicast-not-permitted`, l'unicast fonctionne |
| `1`, `true`, `yes`, `on` | `com.apple.developer.networking.multicast = true` dans `SetRemote.entitlements` ; Info.plist `SetRemoteMulticastEntitlement = true` |

À n'activer **qu'une fois l'autorisation accordée par Apple** et la capacité
« Multicast Networking » cochée sur l'App ID `com.pikoo.setremote` (sinon la
signature du build échoue). La variable doit être visible **à la résolution
de la config par EAS CLI et sur le serveur de build** : la mettre dans le
profil de build, par exemple

```json
"preview": { "env": { "SETREMOTE_MULTICAST_ENTITLEMENT": "1" }, … }
```

ou dans les variables d'environnement EAS du projet ; en local,
`SETREMOTE_MULTICAST_ENTITLEMENT=1 npx expo prebuild --platform ios`. Un
prebuild sans `--clean` retire l'entitlement si la variable repasse à 0.

### 9.5 Vérifié / à vérifier

Vérifié sans appareil (Linux) : `npx tsc --noEmit` ; tests Node du pont et de
la cohérence TS / Swift / Kotlin / plugin (`cd expo-app && npm test`) ;
`npx expo export` iOS et Android ; `npx expo prebuild` iOS et Android dans
une copie : module autolinké (pod `SetRemoteUdp` résolu,
`ExpoModulesProvider` avec `SetRemoteUdpModule`, projet Gradle
`setremote-udp` avec `expo.modules.setremoteudp.SetRemoteUdpModule`),
entitlement présent seulement avec la variable, permissions Android ; code
Kotlin **compilé** (Kotlin 2.0.21) contre le framework Android API 36 et des
stubs reprenant les signatures d'`expo-modules-core` 56, file et analyse IPv4
exécutées sur JVM. **Le Swift n'a pas pu être compilé** (pas de Xcode) : à
compiler au premier build EAS. Procédure sur appareil :
`expo-app/TESTFLIGHT.md`, « Passerelle DMX ».

Références : Apple TN3151 *Choosing the right networking API* ; TN3179
*Understanding local network privacy*
(<https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy>) ;
forums Apple <https://developer.apple.com/forums/thread/655920>,
<https://developer.apple.com/forums/thread/756489>,
<https://developer.apple.com/forums/thread/708731> (multicast sur iPad en
Ethernet : `NWMulticastGroup` fonctionne, entitlement requis) ; Android
[`Network.bindSocket`](https://developer.android.com/reference/android/net/Network#bindSocket(java.net.DatagramSocket)),
[`MulticastLock`](https://developer.android.com/reference/android/net/wifi/WifiManager.MulticastLock).

## 10. Côté vue web : la passerelle dans la PWA

La passerelle est la **télécommande** de la PWA embarquée, ouverte depuis
l'onglet **QR** (bouton « Passerelle DMX », visible seulement dans l'app :
`IN_NATIVE_APP`, pont présent ; dans un navigateur, la vue indique qu'il faut
l'app). Le contrat du pont est celui du § 9.1, inchangé.

| Fichier | Rôle |
|---|---|
| `web/bundle-protocol.mjs`, `web/build.mjs` | `packages/dmx` assemblé dans `index.html` sous la globale `SRDMX`, juste après `SRP` |
| `web/js/00-native-bridge.js` | `nativePost(msg)` (page → coque) et `window.SRNative.receive(msg)` (coque → page : objet ou chaîne JSON ; message inconnu ignoré) |
| `web/js/86-dmx-gateway.js` | moteur (`GatewayEngine`, `tick()` toutes les 10 ms), écoute, patch mémorisé **par session** (`localStorage`, clé `setremote-dmx-v1`, 8 sessions au plus), envoi des `dmx:look` et des appels / SMS, ArtPollReply |
| `web/js/87-dmx-gateway-ui.js` | écrans de la passerelle (maquettes 14 à 17) et table des canaux en PDF |
| `web/js/36-dmx-screen.js` | écran de jeu : `dmx:look`, priorité console, Identifier |
| `web/js/82-call-list.js` | listes d'appels et de SMS numérotées (maquette 18) |

Ce que la page envoie, et quand :

- `net:info` **à chaque ouverture** de l'écran de la passerelle : la coque ne
  l'envoie pas d'elle-même au démarrage (seulement en réponse, à un changement
  de réseau ou au retour au premier plan).
- `dmx:listen` au démarrage de la passerelle, puis **à chaque changement** de
  patch ou de protocole (il remplace l'écoute en cours) : univers patchés du
  protocole (64 au plus), ou `[1]` (sACN) / `[0]` (Art-Net) tant que rien
  n'est patché. `multicast: true` au départ, pour les deux protocoles (sACN :
  groupes 239.255.x.y ; Art-Net : ArtPoll en broadcast) ; `false` dès que la
  coque l'a refusé une fois, jusqu'au prochain lancement de l'app.
- `dmx:stop` à l'arrêt de la passerelle et en quittant la télécommande (pas
  après une erreur fatale : la coque a déjà arrêté l'écoute).
- `udp:send` pour chaque ArtPollReply construit par le moteur, vers l'IP de
  la console qui a envoyé l'ArtPoll, port 6454.

Réponse de la page à `dmx:error` (raisons du § 9.2) :

| `reason` | Passerelle | Affichage (écran 14) |
|---|---|---|
| `multicast-not-permitted`, `multicast-failed` | continue (l'unicast continue côté natif) ; plus de multicast demandé, **pas de réécoute** | conseil ambre : sACN « envoyez les univers en unicast vers *IP* » ; Art-Net « la console ne verra pas la passerelle (ArtPoll) : saisissez *IP* comme destination unicast » |
| `bind-failed` | **arrêtée** (les écrans gardent leur look, la télécommande reprend la main) | « Port 5568 / 6454 déjà utilisé par une autre app… », bouton « Démarrer la passerelle » pour relancer |
| `socket-failed`, `listen-failed` | **arrêtée** | « Réception interrompue… » / « La réception n'a pas pu démarrer… » |
| `native-unavailable` | **arrêtée** | « Cette version de l'app ne sait pas encore recevoir le DMX : mettez SetRemote à jour. » |
| `send-failed`, `not-listening` | continue | ArtPollReply non envoyée (iOS : autoriser le réseau local) |
| `invalid-…`, autre | continue | « Commande refusée par l'app (…) » / « Erreur de réception (…) » ; une raison hors `[a-z0-9-]` n'est jamais affichée telle quelle |

Traitement des `dmx:packets` (pas d'accusé de réception ni de régulation) :
chaque lot est traité **aussitôt, de façon synchrone et entièrement**
(base64 → octets, `engine.handlePacket`, statistiques) ; le rendu des écrans
de la passerelle est regroupé à part (au plus 5 fois par seconde) et le
voyant ne fait que basculer une classe. Un lot de 128 datagrammes injecté
exactement comme par la coque est vérifié par les tests. Bornes côté page :
2 000 datagrammes par lot, 4 096 caractères base64 par datagramme. `src` sert
d'identité de source (Art-Net, réponse aux ArtPoll, affichage) ; `port`
(port de l'émetteur) n'est pas utilisé.

Tests : `tests/dmx-gateway.test.mjs` simule la coque (paquets construits avec
`packages/dmx`, messages postés relevés) ; `tests/call-list.test.mjs` couvre
les listes d'appels.

### Table des canaux en PDF (écran 17)

Le bouton « PDF » de la table des canaux produit un document HTML autonome
(A4, noir sur blanc, polices système, aucune requête) : titre, date et
protocole, patch en cours (écran, univers, adresses, mode), puis la table de
chaque mode utilisé (celle du mode affiché si rien n'est patché) et, pour
Étendu 16, la règle des emplacements.

| Sens | Message |
|---|---|
| page → coque | `{ type: 'pdf:preview', html, title }` (html ≤ 1 Mo en UTF-8, titre ≤ 120 caractères sans caractère de contrôle) |
| coque → page | `{ type: 'pdf:error', reason }` : `invalid-html`, `too-large`, `invalid-title`, `unavailable` (binaire sans `expo-print`), `print-failed` |

La coque (`expo-app/src/lib/pdfPreview.ts`, branché dans `app/index.tsx`)
ouvre la feuille système d'`expo-print` (`Print.printAsync({ html })`, A4,
marges passées en option sur iOS) : impression, partage et « Enregistrer en
PDF ». Fermer la feuille sans imprimer n'est pas une erreur ; une seule
demande à la fois. Le titre est validé mais `expo-print` ne permet pas de
nommer la tâche d'impression. Dans un navigateur, la page imprime le même
document depuis un iframe caché (`print()`). Tests :
`tests/dmx-channels-pdf.test.mjs` et `expo-app/test/pdf-preview.test.mjs`.

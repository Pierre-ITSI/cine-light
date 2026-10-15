# Passerelle DMX : réception UDP dans l'app native (Expo SDK 56)

Pour les développeurs. Complète `docs/DMX.md` (manuel des pupitreurs) et le
paquet `packages/dmx` (moteur). Sources consultées le **15 octobre 2026**.

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
API proposée, volontairement minimale :

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
  de provisionnement, puis déclarer l'entitlement
  (`ios.entitlements` dans `app.json`). Le simulateur fonctionne sans.

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

1. **Module natif** `modules/setremote-udp` (Expo Modules) : API du § 4,
   regroupement 10 ms, choix d'interface ; tests sur appareil avec `sACNView`,
   la sortie unicast d'une console (grandMA3 onPC, Eos Nomad, MagicQ PC, Titan
   onPC) et Wireshark.
2. **iOS unicast d'abord** (sockets BSD ou `NWListener`), sans autorisation ;
   **déposer la demande d'autorisation multicast** en parallèle.
3. **Android** : `DatagramSocket` + `MulticastSocket`, `MulticastLock`,
   permissions (dont `ACCESS_LOCAL_NETWORK` avant de cibler l'API 37).
4. **Brancher le moteur** : `GatewayEngine.handlePacket` sur l'événement
   `packets`, `sendUdp` sur `send`, `send` sur le canal chiffré ; consommer
   `packages/dmx` depuis l'app Expo (Metro : `watchFolders` vers `packages/`).
5. **Écran de la passerelle** : IP et interface (filaire/Wi-Fi), éditeur de
   patch (`Patch.check()`, `autoAddress()`), moniteur (`engine.snapshot()` :
   univers, sources, état du signal, écrans, compteurs de rejets).
6. **Côté écran** : route `dmx:look` dans `MSG_ROUTES`
   (`web/js/22-protocol.js`) et équivalent natif ; ordre `seq` ; priorité
   console tant que `live` ; reprise par la télécommande après `live: false` ou
   3 s sans message ; strobe redémarré seulement s'il change (voir
   `docs/DMX.md` § 7–8).
7. **Appels et SMS** : fournir à la passerelle les 20 premières entrées des
   listes enregistrées de la télécommande (`setTriggerEntries`) — mécanisme de
   synchronisation à définir.
8. **Liaison locale passerelle → écrans** pour les plateaux de plus de
   quelques écrans (§ 6).
9. **Retirer l'ancien mode DMX** (3CH/9CH, pont WebSocket, plugin Capacitor
   `SACN`) une fois la passerelle validée.

## 8. Codes de rejet des analyseurs

Les analyseurs ne lèvent jamais d'exception sur une donnée réseau ; ils
renvoient `{ ok: false, reason }` (comptés dans `engine.snapshot().counters`).

| Protocole | Codes |
|---|---|
| sACN (`parseSacn`) | `type`, `too-short`, `too-long`, `preamble`, `postamble`, `acn-id`, `root-flags`, `root-length`, `root-vector`, `framing-flags`, `framing-length`, `framing-vector`, `priority` (> 200), `sync-address`, `universe` (hors 1–63999), `dmp-flags`, `dmp-length`, `dmp-vector`, `dmp-address-type`, `dmp-first-address`, `dmp-increment`, `dmp-count`, `start-code` (START code non nul), `discovery-flags`, `discovery-length`, `discovery-vector` |
| Art-Net (`parseArtNet`) | `type`, `too-short`, `too-long`, `id`, `protocol-version` (< 14), `length` (Length hors 2–512 ou impaire), `truncated`, `port-address` (Net > 127), `unsupported-opcode` |
| Moteur (`handlePacket`) | `unknown-protocol` ; issues de fusion : `applied`, `unchanged`, `staged`, `held`, `synced`, `terminated`, `ignored-preview`, `out-of-sequence`, `ignored-extra-source`, `discovery`, `poll-replied`, `poll-not-targeted`, `poll-ignored` |

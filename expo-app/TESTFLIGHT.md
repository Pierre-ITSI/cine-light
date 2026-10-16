# TestFlight — SetRemote iOS

L'app iOS est une **coque native** (Expo) qui affiche l'interface web de
SetRemote en plein écran, et ajoute en natif : barre d'état masquée en
permanence, écran toujours allumé, vraie luminosité matérielle pilotée depuis
la télécommande, réception UDP pour la passerelle DMX (module local
`modules/setremote-udp`, voir « Passerelle DMX » plus bas) et liaisons hors
ligne télécommande ↔ écrans en Wi-Fi local et en Bluetooth (module local
`modules/setremote-link`, voir « Liaisons hors ligne » plus bas).

L'interface web est **embarquée dans le binaire** et chargée en `file://`
(plus aucun chargement depuis GitHub Pages : App Review 2.5.2 / 4.2,
confidentialité). Conséquence : une mise à jour de la PWA n'apparaît dans
l'app **qu'avec un nouveau build**. Voir « Interface embarquée » plus bas.

Les anciens écrans 100 % natifs (`/native`, `/remote`, `/screen`) et leurs
transports en clair (`react-native-ble-plx`, `react-native-tcp-socket`) ont
été retirés : la vue web est la seule interface.

## Préparation (une seule fois)

> ⚠️ TestFlight exige l'**Apple Developer Program** (individuel ou
> Organisation). L'**Apple Developer Enterprise Program** (distribution interne
> « in-house ») n'a pas accès à TestFlight ni à l'App Store.

1. **Identifiant de l'app** — developer.apple.com → Certificates, Identifiers &
   Profiles → Identifiers → **+** → App IDs → App → Bundle ID explicite
   `com.pikoo.setremote`.
2. **Fiche App Store Connect** — appstoreconnect.apple.com → Apps → **+** →
   Nouvelle app : iOS, nom affiché (doit être unique sur l'App Store),
   langue Français, bundle ID `com.pikoo.setremote`, SKU `setremote`.
   Noter l'**Apple ID** numérique de l'app (Informations sur l'app) → `ASC_APP_ID`.
3. **Clé API App Store Connect** — Utilisateurs et accès → Intégrations →
   App Store Connect API → Clés d'équipe → **+**, accès **Admin**.
   Noter le *Key ID* et l'*Issuer ID*, télécharger le fichier `AuthKey_XXXX.p8`
   (téléchargeable une seule fois).
4. **Team ID** — developer.apple.com → Membership details.
5. **Jeton Expo** — compte gratuit sur expo.dev, puis Account settings →
   Access tokens → Create.

## Variables d'environnement

| Variable | Valeur |
|---|---|
| `EXPO_TOKEN` | jeton Expo |
| `EXPO_ASC_KEY_ID` | Key ID de la clé API |
| `EXPO_ASC_ISSUER_ID` | Issuer ID |
| `ASC_API_KEY_P8_BASE64` | contenu du `.p8` en base64 (`base64 -i AuthKey_XXXX.p8`) |
| `EXPO_APPLE_TEAM_ID` | Team ID Apple |
| `ASC_APP_ID` | Apple ID numérique de l'app |

Ce sont des secrets : ne jamais les committer ni les coller dans un chat.

Depuis une session Claude Code cloud, le réseau doit aussi autoriser
`expo.dev`, `api.expo.dev`, `appstoreconnect.apple.com` et
`api.appstoreconnect.apple.com`.

## Lancer

```bash
cd expo-app
npm ci
./scripts/testflight.sh
```

Le script lie le projet Expo, compile sur EAS (≈ 15–25 min, plus l'attente en
file sur l'offre gratuite) puis envoie le build à App Store Connect.
Après le traitement Apple (≈ 10–30 min) : App Store Connect → TestFlight →
**Test interne** → ajouter les testeurs (membres de l'équipe App Store
Connect, jusqu'à 100). Pas de revue Apple pour le test interne.
Les testeurs installent l'app **TestFlight** puis SetRemote.

## Interface embarquée

| Étape | Qui | Quoi |
|---|---|---|
| `npm run build` (racine) | développeur | génère `index.html` depuis `web/` (à committer) |
| `scripts/embed-web.mjs` | hook EAS `eas-build-pre-install`, plugin au prebuild, ou `npm run embed-web` | vérifie que `index.html` est à jour, copie `index.html`, `manifest.webmanifest`, les icônes et `vendor/` (mqtt.js, polices, licences) dans `web-embed/` (non versionné), puis contrôle que toute ressource relative citée par la page est présente |
| `plugins/with-embedded-web.js` | `expo prebuild` (local ou EAS) | iOS : copie dans `ios/SetRemote/web/`, ajoutée au projet Xcode comme **référence de dossier** (Copy Bundle Resources, arborescence conservée). Android : copie dans `android/app/src/main/assets/web/` |
| `app/index.tsx` | au lancement | iOS : `SetRemote.app/web/index.html` (lecture limitée au dossier `web/`) ; Android : `file:///android_asset/web/index.html` |

Pas de service worker dans l'app (`sw.js` n'est pas embarqué ; son
enregistrement échoue sans bruit en `file://`). Les écrans de lancement de la
PWA (`splash-*.png`) ne sont pas embarqués : les WebView les ignorent.

**Pourquoi `file://` plutôt qu'un petit serveur HTTP local** : aucune
dépendance native de plus, rien à démarrer ni à relancer au retour du premier
plan (iOS coupe les sockets d'écoute en arrière-plan), pas de port à réserver
(l'origine `http://localhost:<port>` change si le port est pris, et
`localStorage` serait perdu). `file://` est un **contexte sécurisé** dans
WKWebView comme dans la WebView Android : `getUserMedia`, WebRTC et
`crypto.subtle` (chiffrement de bout en bout) restent disponibles.

### Développement : charger une URL distante

Option réservée au développement (`__DEV__`), ignorée par les builds preview et
production : définir `EXPO_PUBLIC_WEB_URL` avant `npx expo start --dev-client`
(dans `expo-app/.env.local`, non versionné, ou dans l'environnement).

```bash
# PWA publiée
EXPO_PUBLIC_WEB_URL=https://pierre-itsi.github.io/cine-light/ npx expo start --dev-client
# ou le dépôt servi en local, pour itérer sur web/ sans rebuild natif
npx serve -l 8080 ..        # depuis expo-app/, après « npm run build » à la racine
EXPO_PUBLIC_WEB_URL=http://<IP du poste>:8080/ npx expo start --dev-client
```

Sans cette variable, le dev client affiche l'interface embarquée **au moment
de son build natif** : après une modification de `web/`, il faut soit cette
variable, soit un nouveau build.

## Vérifications à faire sur appareil

Vérifié sous Linux (sans appareil) : `npx tsc --noEmit`, `npx expo export`
iOS et Android, `npx expo prebuild` iOS et Android dans une copie propre
(dossier `web/` présent dans les deux projets natifs, référence de dossier et
`PrivacyInfo.xcprivacy` dans Copy Bundle Resources, prebuild relancé sans
doublon), contrôle de complétude du paquet, et tests Chromium de la page
embarquée en `file://` (`tests/native-embed.test.mjs` : aucune requête réseau,
polices locales, contexte sécurisé, `crypto.subtle`, détection de la coque).
Reste à vérifier sur iPhone (WKWebView) et sur Android :

**Inspecteur** : build de développement, puis Safari → Développement →
appareil → page SetRemote (iOS) ou `chrome://inspect` (Android). Dans la
console :

```js
location.href                       // file:///…/SetRemote.app/web/index.html (iOS)
isSecureContext                     // true
IN_NATIVE_APP                       // true (classe « in-app » sur <html>)
SETREMOTE_NATIVE                    // { platform, bridge: 1, publicUrl }
await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt'])  // CryptoKey
[...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight)
```

- [ ] **Hors ligne** : mode avion, lancer l'app : l'accueil s'affiche, en
      DM Mono et Lato (comparer avec la PWA dans Safari).
- [ ] **Contexte sécurisé et WebCrypto** : les lignes ci-dessus (iOS et Android).
- [ ] **localStorage persistant** : enregistrer une mémoire de couleur, tuer
      l'app, relancer : elle est toujours là. Refaire après l'installation d'un
      build TestFlight plus récent par-dessus.
      ⚠️ Les mémoires enregistrées avec un build antérieur (origine GitHub
      Pages) ne sont **pas** reprises : nouvelle origine, perte unique pour
      les testeurs.
- [ ] **Android, détection de la coque au démarrage à froid** : réglage de
      luminosité de l'écran de jeu → vraie luminosité (pas de voile noir).
- [ ] **Caméra / torche** : onglet Flash. Seule l'invite système d'accès à
      l'appareil photo doit apparaître (pas d'invite WebKit en plus). Android :
      la torche s'allume. iPhone : message « non disponible », comme avant.
- [ ] **Appairage MQTT** télécommande ↔ écran, puis couleur, effets, appel.
- [ ] **Vidéo WebRTC** télécommande → écran (deux appareils).
- [ ] **Sélecteurs de fichiers** : images et vidéos du pool, photo
      d'appelant, fond d'écran verrouillé, bande son.
- [ ] **Liens externes** : s'ouvrent dans Safari / Chrome, pas dans l'app.
- [ ] **Onglet QR** : ⚠️ régression connue tant que `web/js/64-qr-utils.js`
      n'est pas adapté (refonte de l'appairage en cours) : le QR et l'adresse
      affichée reprennent `location`, donc une URL `file://` inutilisable par
      un autre appareil. Correctif attendu côté web : utiliser
      `window.SETREMOTE_NATIVE.publicUrl` quand il existe.
- [ ] **Invite « réseau local » (iOS)** : noter quand elle apparaît (vidéo
      WebRTC sur le Wi-Fi, mode Wi-Fi local natif).
- [ ] **Privacy Report** : Xcode → Archive → Organizer → Generate Privacy
      Report ; après envoi, surveiller l'e-mail Apple (ITMS-91053).
- [ ] **Table des canaux DMX → PDF** (passerelle › Patch › Table des canaux,
      bouton « PDF » ; module natif `expo-print`, nouveau build requis) :
      la feuille système d'aperçu s'ouvre sur un A4 (titre, date, patch,
      table de chaque mode utilisé) ; partage et « Enregistrer en PDF »
      (iOS : Partager › Enregistrer dans Fichiers ; Android : imprimante
      « Enregistrer au format PDF »). Fermer la feuille sans imprimer
      n'affiche aucune erreur. Vérifier les marges (iOS : marges passées à
      expo-print, voir `src/lib/pdfPreview.ts`) et qu'aucun texte n'est
      coupé.

## Passerelle DMX (module `setremote-udp`)

Le module natif `modules/setremote-udp` reçoit le sACN (UDP 5568) et
l'Art-Net (UDP 6454) pour la vue web ; contrat du pont et choix techniques :
`docs/DMX-NATIVE.md` § 9. C'est du code natif : il faut un **nouveau build**
(dev client ou TestFlight), un simple rechargement JS ne suffit pas.

Vérifié sous Linux : types, tests Node du pont (`npm test` dans `expo-app`),
`expo export` et `expo prebuild` iOS / Android (module autolinké, entitlement
seulement avec la variable, permissions Android), Kotlin compilé contre
l'API Android 36. **Le Swift n'a jamais été compilé** : le premier build EAS
iOS le vérifie ; en cas d'erreur, elle est dans
`modules/setremote-udp/ios/*.swift`.

### Entitlement multicast iOS : `SETREMOTE_MULTICAST_ENTITLEMENT`

Désactivé par défaut. **Ne l'activer qu'après l'accord d'Apple**
(<https://developer.apple.com/contact/request/networking-multicast>) et une
fois la capacité « Multicast Networking » cochée sur l'App ID
`com.pikoo.setremote` ; sinon la signature échoue. Pour l'activer, ajouter au
profil de build voulu dans `eas.json` :

```json
"env": { "SETREMOTE_MULTICAST_ENTITLEMENT": "1" }
```

(ou une variable d'environnement EAS du projet), puis relancer un build : le
config plugin ajoute `com.apple.developer.networking.multicast` et la clé
Info.plist `SetRemoteMulticastEntitlement = true`. Sans elle, l'app reçoit
l'**unicast** et répond `dmx:error` « multicast-not-permitted » aux demandes
multicast / broadcast.

### Matériel et logiciels

- iPhone ou iPad (puis Android) avec le build ; un ordinateur sur le **même
  réseau** (Wi-Fi dédié, ou switch + adaptateur **USB-C → Ethernet** sur
  l'appareil).
- Émetteur : **sACNView** (gratuit, Windows / macOS / Linux) pour le sACN ;
  pour l'Art-Net, la version hors ligne d'une console (grandMA3 onPC, Eos
  Nomad, MagicQ PC, Titan onPC) ou tout émetteur Art-Net unicast.
- **Wireshark** sur l'ordinateur (filtres `udp.port == 5568`,
  `udp.port == 6454`).
- Inspecteur web : Safari → Développement → appareil → page SetRemote (iOS),
  `chrome://inspect` (Android). Tant que l'écran de passerelle de la page n'est
  pas branché, piloter le pont depuis la console de l'inspecteur :

```js
let n = 0, last = null;
window.SRNative = { receive(m) {
  if (m.type === 'dmx:packets') { n += m.packets.length; last = m.packets[m.packets.length - 1]; }
  else console.log(m);
} };
setInterval(() => { if (n) console.log('paquets/s', n); n = 0; }, 1000);
nativePost({ type: 'net:info' });   // → { type: 'net:info', interfaces: [...] }
```

### Étapes (unicast d'abord)

- [ ] **Réseau** : `net:info` liste l'IPv4 de l'appareil ; Wi-Fi en
      `kind: 'wifi'` ; avec l'adaptateur Ethernet, une seconde interface en
      `kind: 'ethernet'`. Brancher / débrancher l'adaptateur : un `net:info`
      arrive seul, sans demande.
- [ ] **sACN unicast** : `nativePost({ type: 'dmx:listen', protocol: 'sacn', universes: [1], multicast: false })`.
      sACNView → Transmit, univers 1, **Unicast** vers l'IP de l'appareil,
      faire bouger un fader. Attendu : `paquets/s` (≈ 44 pendant un
      mouvement, moins au repos selon l'émetteur), `last.src` = IP de
      l'ordinateur, `atob(last.data).slice(4, 13) === 'ASC-E1.17'`. iOS :
      aucune invite système n'est nécessaire pour recevoir de l'unicast ;
      l'invite « réseau local » apparaît au démarrage de l'écoute (texte :
      « … recevoir le DMX de la console lumière … ») : l'accepter.
- [ ] **Art-Net unicast** : `nativePost({ type: 'dmx:listen', protocol: 'artnet', universes: [0], multicast: false })`
      (remplace l'écoute sACN). Console : sortie Art-Net **unicast** vers
      l'IP de l'appareil. Attendu : `atob(last.data).startsWith('Art-Net\0')`.
- [ ] **Envoi depuis le port d'écoute** (ArtPollReply) :
      `nativePost({ type: 'udp:send', host: '<IP ordinateur>', port: 6454, data: btoa('Art-Net\0test') })`.
      Wireshark : datagramme de l'appareil, **port source 6454**. Sans écoute
      en cours : `dmx:error` « not-listening ».
- [ ] **Validation** : `nativePost({ type: 'udp:send', host: 'console.local', port: 6454, data: 'AA==' })`
      → « invalid-host » ; 65 univers → « invalid-universes ».
- [ ] **Sans entitlement (iOS)** : `dmx:listen` sACN avec `multicast: true`
      → « multicast-not-permitted », et l'unicast continue d'arriver.
- [ ] **Arrière-plan** : écoute en cours, revenir à l'écran d'accueil 30 s,
      rouvrir l'app : les paquets reprennent sans nouveau `dmx:listen`, et un
      `net:info` arrive. Wireshark / sACNView ne doivent rien montrer
      d'anormal pendant l'absence (les sockets sont fermés).
- [ ] **Charge** : 8 univers dans sACNView, 44 Hz, 10 minutes : ≈ 350
      paquets/s, aucun `dmx:error`, mémoire stable (Xcode → Debug navigator ;
      Android Studio → Profiler), latence visuelle inchangée au bout de
      10 minutes (pas d'arriéré qui s'accumule).
- [ ] **Rechargement** : recharger la page (inspecteur), redéfinir
      `window.SRNative` comme ci-dessus : plus aucun `dmx:packets` (l'écoute
      appartient au document qui l'a demandée).
- [ ] **`dmx:stop`** : `nativePost({ type: 'dmx:stop' })` → plus de paquets.

### Puis multicast

- [ ] **Android** (pas d'entitlement) : `dmx:listen` sACN `universes: [1, 2]`,
      `multicast: true` ; sACNView en **multicast** (239.255.0.1 et
      239.255.0.2) : réception en Wi-Fi puis en Ethernet. Pendant l'écoute,
      `adb shell dumpsys wifi | grep -i -A3 multicast` montre le verrou
      « SetRemoteUdp » ; il disparaît après `dmx:stop` ou en arrière-plan.
      Art-Net `multicast: true` : l'ArtPoll d'une console (broadcast) arrive.
- [ ] **iOS, une fois l'entitlement accordé** : build avec
      `SETREMOTE_MULTICAST_ENTITLEMENT=1`, puis mêmes essais : sACN multicast
      en Wi-Fi puis en Ethernet (l'écoute suit l'interface quand on branche
      l'adaptateur), ArtPoll broadcast reçu, plus de « multicast-not-permitted ».

## Liaisons hors ligne (module `setremote-link`)

Le module `modules/setremote-link` relie la télécommande et ses écrans sans
Internet : **Wi-Fi local** (Bonjour + TCP) et **Bluetooth LE** (écran
périphérique, télécommande centrale). Contrat, format et limites :
`docs/OFFLINE-NATIVE.md`. Code natif : **nouveau build** obligatoire.

Vérifié sous Linux : types, tests Node (`npm test` dans `expo-app`),
`expo export`, `expo prebuild` iOS / Android (autolinking, `NSBonjourServices`,
permissions), Kotlin compilé et rejoué sur JVM. **Le Swift n'a jamais été
compilé** : le premier build EAS iOS le vérifie (erreurs éventuelles dans
`modules/setremote-link/ios/*.swift`).

### Matériel

- **Deux à quatre téléphones** avec le build : au moins un iPhone et un
  Android (tester les deux sens : télécommande iPhone → écran Android, et
  l'inverse), idéalement un Android 11 ou plus ancien.
- Un **routeur de voyage sans Internet** (port WAN débranché), réseau Wi-Fi
  dédié.
- Un ordinateur sur ce Wi-Fi : Safari → Développement (iPhone),
  `chrome://inspect` (Android) ; sur Mac, `dns-sd -B _setremote._tcp` puis
  `dns-sd -L <instance> _setremote._tcp` ; `nc` pour l'essai « appareil
  étranger ».
- Un mètre ou un couloir de 50 m pour l'essai de portée.

Tant que l'interface de la page n'est pas branchée, piloter le pont depuis la
console de l'inspecteur, sur **chaque** appareil (même `ROOM` partout) :

```js
const ROOM = 'AbCdEfGhIjKlMnOpQrStUv';          // 22 caractères base64url, identique partout
let rx = 0, peers = [];
window.SRNative = { receive(m) {
  if (m.type === 'link:frames') { rx += m.frames.length; window.last = m.frames.at(-1); }
  else if (m.type === 'link:peers') { peers = m.peers; console.log('pairs', JSON.stringify(m.peers)); }
  else console.log(JSON.stringify(m));
} };
setInterval(() => { if (rx) console.log('trames/s', rx); rx = 0; }, 1000);
// Télécommande :
nativePost({ type: 'link:start', modes: ['lan'], role: 'remote', room: ROOM, name: 'Télécommande' });
// Écran :
nativePost({ type: 'link:start', modes: ['lan'], role: 'screen', room: ROOM, name: 'Écran 1' });
// Envoi (télécommande → tous, écran → sa télécommande) :
nativePost({ type: 'link:send', frames: ['bonjour ' + Date.now()] });
// Débit : trames de 4 Kio en continu
let n = 0; const flood = setInterval(() => nativePost({ type: 'link:send', frames: [String(n++).padEnd(4096, 'x')] }), 10);
// clearInterval(flood)
```

### Wi-Fi local (routeur sans Internet)

- [ ] **Démarrage** : télécommande puis un écran sur le Wi-Fi du routeur,
      **données mobiles activées** (Android : vérifie que le socket passe par
      le Wi-Fi sans Internet, pas par le 4G). `link:state` : `lan.active:
      true` des deux côtés ; iOS : l'invite « réseau local » apparaît au
      premier `link:start` (pas au lancement de l'app). `link:peers` arrive
      des deux côtés en moins de 3 s, avec les noms.
- [ ] **Annonce** : sur le Mac, `dns-sd -L` montre le TXT `r=<16 hex>` et
      `v=1`, une instance `SetRemote-xxxxxx` ; ni topic ni nom d'appareil.
- [ ] **Trames** : dans les deux sens, contenu identique (`last.data`),
      ordre conservé (compteur), `to: [<peer>]` n'atteint que cet écran ;
      `to: ['l-000000000000']` → `unknown-peer`. Une trame de 65 536
      caractères passe ; 65 537 → `too-large` (mode `lan`).
- [ ] **Plusieurs écrans** (2 à 3) : tous dans `link:peers` ; un envoi sans
      `to` arrive partout ; `trames/s` stable avec le flot de 4 Kio.
- [ ] **Autre plateau** : un écran avec un autre `ROOM` n'apparaît jamais.
- [ ] **Appareil étranger** : depuis l'ordinateur, `nc <ip> <port>` puis taper
      n'importe quoi, et `head -c 100000000 /dev/urandom | nc <ip> <port>` :
      la connexion est fermée en moins de 5 s, aucune entrée dans
      `link:peers`, pas de plantage, mémoire stable (Xcode / Android Studio).
- [ ] **Reconnexion** : Wi-Fi coupé puis rétabli sur l'écran ; routeur
      redémarré ; app télécommande tuée puis relancée (et `link:start`
      renvoyé) : les écrans reviennent seuls dans `link:peers`. Un écran tué
      disparaît de la liste en moins de 15 s.
- [ ] **Arrière-plan** : télécommande à l'écran d'accueil 30 s (les écrans
      la voient partir), retour : liaisons rouvertes **sans** nouveau
      `link:start`. Même essai côté écran. Android : ouvrir puis fermer
      aussitôt le volet de notifications ne coupe rien (délai de grâce 2 s).
- [ ] **Rechargement** de la page (inspecteur) : plus aucune trame, les autres
      appareils voient le pair partir.
- [ ] **iOS, réseau local refusé** (Réglages › SetRemote › Réseau local
      désactivé) : `link:error` `local-network-denied` ; le réactiver : la
      liaison repart seule.

### Bluetooth (mode avion, Bluetooth activé)

- [ ] **Autorisations** : aucune invite Bluetooth au lancement de l'app ; elle
      apparaît au premier `link:start` avec `modes: ['ble']`. Android 12+ :
      « Appareils à proximité » seulement (aucune demande de localisation) ;
      Android ≤ 11, télécommande : localisation ; localisation coupée →
      `location-off`.
- [ ] **Appairage** : mode avion **avec Bluetooth activé** sur tous les
      appareils, `modes: ['ble']` ; écran puis télécommande : `link:peers`
      en moins de 5 s, pour chaque combinaison iPhone / Android
      (télécommande iPhone + écran Android, et l'inverse).
- [ ] **Trames** : 4 096 caractères passent, 4 097 → `too-large` (mode
      `ble`) ; ordre et contenu conservés.
- [ ] **Débit et latence** : flot de 4 Kio pendant 60 s, noter `trames/s`
      (≈ Ko/s) dans chaque sens et pour chaque combinaison ; aller-retour
      (écran qui renvoie chaque trame reçue) sur 100 trames courtes : noter
      la médiane. Avec 3 écrans : noter le débit par écran.
- [ ] **Plusieurs écrans** : jusqu'à 3 (ou 8 si disponibles) ; un 9ᵉ →
      `too-many-peers`.
- [ ] **Bluetooth coupé** pendant la liaison : `powered-off`, pairs partis ;
      rallumé : la liaison repart seule.
- [ ] **Autorisation refusée** : `unauthorized` ; un nouveau `link:start`
      repose la question (Android : plus de boîte après deux refus).
- [ ] **Arrière-plan / premier plan** : comme en Wi-Fi ; au retour, la
      liaison repart sans nouveau `link:start`.
- [ ] **Les deux liaisons** : `modes: ['lan', 'ble']` ; chaque écran apparaît
      deux fois (`l-…` et `b-…`) ; couper le Wi-Fi : la liaison Bluetooth
      reste.
- [ ] **Autres appareils Bluetooth** : avec une montre ou des écouteurs
      connectés à l'écran Android, démarrer puis arrêter la liaison : la
      montre / les écouteurs ne sont jamais déconnectés.

### Portée

- [ ] Télécommande fixe, un écran qui s'éloigne par pas de 5 m (en vue
      directe, puis à travers une cloison) : noter la distance où les
      trames cessent et celle où le pair disparaît (15 s), en Wi-Fi (routeur
      au milieu) et en Bluetooth ; revenir : reconnexion seule, délai noté.
- [ ] 30 minutes de trames courtes (30/s) en Bluetooth : batterie et
      température notées, aucun `congested`.

# TestFlight — SetRemote iOS

L'app iOS est une **coque native** (Expo) qui affiche l'interface web de
SetRemote en plein écran, et ajoute en natif : barre d'état masquée en
permanence, écran toujours allumé, vraie luminosité matérielle pilotée depuis
la télécommande, et réception UDP pour la passerelle DMX (module local
`modules/setremote-udp`, voir « Passerelle DMX » plus bas).

L'interface web est **embarquée dans le binaire** et chargée en `file://`
(plus aucun chargement depuis GitHub Pages : App Review 2.5.2 / 4.2,
confidentialité). Conséquence : une mise à jour de la PWA n'apparaît dans
l'app **qu'avec un nouveau build**. Voir « Interface embarquée » plus bas.

Les anciens écrans 100 % natifs restent accessibles via `setremote:///native`
(développement uniquement).

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
| `scripts/embed-web.mjs` | hook EAS `eas-build-pre-install`, plugin au prebuild, ou `npm run embed-web` | vérifie que `index.html` est à jour, copie `index.html`, `screen.html`, `manifest.webmanifest`, les icônes et `vendor/` (mqtt.js, polices, licences) dans `web-embed/` (non versionné), puis contrôle que toute ressource relative citée par les pages est présente |
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
- [ ] **Mode DMX** : le bouton ouvre la même page d'accueil qu'avant ; les
      liens GitHub s'ouvrent dans le navigateur.
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

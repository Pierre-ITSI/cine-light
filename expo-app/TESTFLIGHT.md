# TestFlight — SetRemote iOS

L'app iOS est une **coque native** (Expo) qui affiche l'interface web de
SetRemote en plein écran, et ajoute en natif : barre d'état masquée en
permanence, écran toujours allumé, vraie luminosité matérielle pilotée depuis
la télécommande.

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

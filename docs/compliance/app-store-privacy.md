# App Store Connect : confidentialité, Privacy Manifest, chiffrement, classification par âge

Document de travail pour remplir App Store Connect pour SetRemote (bundle `com.pikoo.setremote`).

- **Partie A** : réponses **cibles**, valables une fois la migration terminée (chiffrement de bout en bout, relais sans stockage, polices et QR locaux, STUN auto-hébergé).
- **Partie B** : réponses dans l'**état actuel** (bout en bout, QR et polices locaux livrés ; relais encore public, STUN de Google), si l'app est publiée avant la fin de la migration. Mieux vaut basculer d'abord sur le relais auto-hébergé : voir la check-list interne de migration (hors dépôt).

Sources vérifiées le **2026-10-14** :

| Sujet | URL |
|---|---|
| Définitions « App privacy details » (collecte, catégories, divulgation facultative) | https://developer.apple.com/app-store/app-privacy-details/ |
| API à motif obligatoire (required reason API) | https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api |
| Codes de motif par catégorie | https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype |
| Clés `NSPrivacyCollectedDataType…` | https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype |
| Privacy manifests avec Expo (`ios.privacyManifests`) | https://docs.expo.dev/guides/apple-privacy/ (lu via un extrait de recherche : le domaine était bloqué par le proxy de la session) |
| Chiffrement : `ITSAppUsesNonExemptEncryption` | https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations |
| Chiffrement : documents à fournir (dont la déclaration française) | https://developer.apple.com/help/app-store-connect/reference/export-compliance-documentation-for-encryption |
| Classification par âge (questionnaire 2025, paliers 4+/9+/13+/16+/18+) | https://developer.apple.com/help/app-store-connect/reference/age-ratings |
| App Review Guidelines (1.1.6, 2.3.7, 2.3.10, 2.5.2, 4.2, 5.1.1, 5.2.5) | https://developer.apple.com/app-store/review/guidelines/ |

---

## A. Réponses CIBLES (après migration)

### A.1 Question principale

> **Do you or your third-party partners collect data from this app?**
> → **No, we do not collect data from this app.**

L'étiquette publique sera **« Données non collectées » / « Data Not Collected »**.

**Justification.** Apple définit la collecte ainsi : *« "Collect" refers to transmitting data off the device and storing it in a readable form for longer than the time it takes you and/or your third-party partners to service the request »*. Apple précise aussi : *« if an authentication token or IP address is sent on a server call and not retained […] you do not need to disclose this »* et *« Data that is processed only on device is not "collected" »*.

Dans l'architecture cible :

1. Les contenus (photos, vidéos, audio, noms et photos d'appelant fictif, textes de message) quittent l'appareil **chiffrés de bout en bout**. Ni l'éditeur ni l'hébergeur n'ont les clés. Ils ne sont donc jamais « stockés sous forme lisible » hors des appareils de l'utilisateur.
2. Le relais ne fait que transmettre et **ne stocke rien**. L'adresse IP n'est utilisée que pour acheminer la connexion, sans être conservée. C'est le cas d'exemption cité par Apple.
3. Les mémoires et préréglages restent en stockage local.
4. L'export de projet (avec ou sans médias) crée un fichier que l'utilisateur enregistre ou partage lui-même par le menu de partage du système. Rien n'est transmis à l'éditeur.
5. Il n'y a ni SDK d'analyse, ni SDK publicitaire, ni rapport de plantage tiers. Seuls les rapports de plantage d'Apple existent, et *« You are not responsible for disclosing data collected by Apple »*.

> ⚠️ « No » n'est exact que si **toutes** les conditions de la section 2 de la check-list interne de migration (hors dépôt) sont remplies. Un seul SDK d'analyse ou de crash ajouté plus tard (Sentry, Firebase…) oblige à refaire ce questionnaire.

### A.2 Justification catégorie par catégorie

Les réponses ne sont saisies que si l'on répond « Yes » en A.1. Ce tableau sert à documenter le « No ».

| Catégorie Apple | Types | Réponse cible | Pourquoi |
|---|---|---|---|
| Contact Info | Name, Email Address, Phone Number, Physical Address, Other User Contact Info | Non collecté | Aucun compte ni formulaire. Le **nom d'appelant fictif** est un texte saisi pour un accessoire : il est chiffré de bout en bout et ne quitte que vers l'appareil appairé. Le support se fait par e-mail **hors de l'app**, donc pas de collecte « from this app ». |
| Health & Fitness | Health, Fitness | Non collecté | Aucune fonction santé |
| Financial Info | Payment Info, Credit Info, Other Financial Info | Non collecté | App gratuite, sans achat intégré |
| Location | Precise, Coarse | Non collecté | Aucune API de localisation. L'IP vue par le relais n'est ni conservée ni utilisée pour localiser. |
| Sensitive Info | — | Non collecté | — |
| Contacts | — | Non collecté | Aucun accès au carnet d'adresses |
| User Content | Emails or Text Messages, Photos or Videos, Audio Data, Gameplay Content, Customer Support, Other User Content | Non collecté | Contenus chiffrés de bout en bout, illisibles par l'éditeur et l'hébergeur, cachés uniquement sur l'appareil récepteur. Les textes de « SMS » fictifs ne sont pas de vrais messages. |
| Browsing History | — | Non collecté | La WebView ne charge que l'interface de l'app. Les liens externes s'ouvrent dans le navigateur système. |
| Search History | — | Non collecté | — |
| Identifiers | User ID, Device ID | Non collecté | Pas de compte, pas d'IDFA ni d'IDFV transmis. L'identifiant de session du relais est aléatoire, éphémère et non rattaché à l'appareil. |
| Purchases | Purchase History | Non collecté | — |
| Usage Data | Product Interaction, Advertising Data, Other Usage Data | Non collecté | Aucune mesure d'audience |
| Diagnostics | Crash Data, Performance Data, Other Diagnostic Data | Non collecté | Aucun SDK de crash. Les rapports Apple (opt-in) ne sont pas à déclarer. |
| Surroundings | Environment Scanning | Non collecté | — |
| Body | Hands, Head | Non collecté | — |
| Other Data | Other Data Types | Non collecté | Les commandes de couleur et d'effet sont chiffrées et non conservées |

### A.3 Suivi (tracking) et publicité

- **Tracking** : Non. Aucune donnée n'est liée à des données tierces à des fins publicitaires, ni partagée avec un courtier en données. Pas de demande App Tracking Transparency, pas de `NSUserTrackingUsageDescription`.
- **Identifiant publicitaire (IDFA)** : non utilisé.

### A.4 Liens obligatoires

| Champ App Store Connect | Valeur |
|---|---|
| Privacy Policy URL | `https://pierre-itsi.github.io/cine-light/confidentialite.html` (FR) et `https://pierre-itsi.github.io/cine-light/privacy.html` (EN) : pages `confidentialite.html` / `privacy.html` à la racine du dépôt, fidèles à l'état actuel (voir B). Une fois la migration terminée, y reporter le texte cible de `politique-confidentialite.md` / `privacy-policy.md` (ou changer d'URL si un domaine propre est pris) |
| Privacy Choices URL (facultatif) | Laisser vide : il n'y a rien à paramétrer |
| Lien **dans l'app** (guideline 5.1.1(i) : *« within the app in an easily accessible manner »*) | **Présent** : télécommande › engrenage de l'en-tête (Réglages, maquette 13) › « Politique de confidentialité ». La page est embarquée dans l'app (`expo-app/scripts/embed-web.mjs`) et s'ouvre sans réseau, en anglais si l'anglais est choisi dans les Réglages. |

---

## B. Réponses dans l'état ACTUEL (bout en bout livré, relais encore public)

*Mis à jour le 16 octobre 2026.* Depuis `main@5e0323d`, l'état décrit ici auparavant (commandes et médias **en clair** sur le broker public, QR fabriqué par `api.qrserver.com`, Google Fonts, interface de l'app chargée depuis GitHub Pages) n'existe plus :

- **tous** les messages et médias sont chiffrés de bout en bout (`packages/protocol`, AES-256-GCM), y compris le repli des vidéos sur le broker ; le sujet MQTT est opaque (dérivé du secret) ;
- le QR d'appairage est dessiné sur l'appareil (`vendor/qrcode-generator`) : plus aucun service de QR ;
- les polices sont auto-hébergées (`vendor/fonts/`) : plus de Google Fonts ;
- l'app native embarque son interface (`file://`) : elle ne la charge plus depuis GitHub Pages.

Restent dans la production actuelle (voir `web/js/01-config.js`, `20-mqtt.js`) :

- le relais est encore le broker MQTT **public** `broker.hivemq.com` (`RELAY_URL` vide) : il ne voit que des trames chiffrées, mais il voit l'adresse IP et les métadonnées (heure, taille, sujet), tout abonné peut voir passer les trames chiffrées, et HiveMQ n'est pas un sous-traitant sous contrat ;
- le serveur STUN public de Google (`stun.l.google.com`) voit l'adresse IP lors de l'envoi d'une vidéo ;
- la version web est hébergée par GitHub Pages (États-Unis).

**Réponse proposée : « No, we do not collect data from this app »** (même raisonnement qu'en A.1) : aucun contenu n'est plus lisible hors des appareils de l'utilisateur, et l'adresse IP ne sert qu'à acheminer la connexion. **Réserve** : on ne connaît pas la durée de conservation des journaux du broker public ; la politique publiée le dit explicitement. Le plus sûr reste de basculer sur le relais auto-hébergé (`docs/BROKER.md` § 5) avant la soumission : les réponses A s'appliquent alors sans réserve.

- **Privacy Policy** : la version conforme à l'état actuel existe : `confidentialite.html` / `privacy.html` à la racine du dépôt. Elle nomme HiveMQ (broker public), Google (STUN) et GitHub (Pages, États-Unis), et ne contient aucune affirmation de la cible. Au passage au relais auto-hébergé, seul son paragraphe balisé `RELAIS : DÉBUT / FIN` (`RELAY: START / END` en anglais) change ; un test (`tests/privacy.test.mjs`) vérifie que le service n'est nommé nulle part ailleurs et qu'il correspond à la configuration de production.
- *Identifiers* reste « Non » : le `clientId` MQTT est aléatoire à chaque connexion.

---

## C. Privacy Manifest (`PrivacyInfo.xcprivacy`)

### C.1 API à motif obligatoire probablement utilisées

J'ai inventorié les `PrivacyInfo.xcprivacy` et le code natif iOS des dépendances installées (`expo-app/node_modules`, versions verrouillées : expo 56.0.12, react-native 0.85.3, react-native-webview 13.16.1, expo-file-system 56.0.8, expo-video 56.1.4, expo-image 56.0.11 avec SDWebImage ~5.21, react-native-ble-plx 3.5.1, react-native-tcp-socket 6.4.1).

| Catégorie | Code(s) | Signification (Apple) | Qui l'utilise (preuve) |
|---|---|---|---|
| `NSPrivacyAccessedAPICategoryFileTimestamp` | **C617.1** | Horodatage, taille ou métadonnées de fichiers **dans le conteneur de l'app** | React Native (`React/Resources/PrivacyInfo.xcprivacy`, `cxxreact`, glog, RCT-Folly, boost) ; `expo-video` (`ios/Cache/VideoCacheManager.swift`, sans manifest propre) ; `expo-modules-core` (`PersistentFileLog.swift`) ; SDWebImage (cache) |
| | **3B52.1** | Métadonnées de fichiers **choisis explicitement par l'utilisateur** (sélecteur de documents ou d'images) | `expo-file-system` (déclare `0A2A.1` + `3B52.1`). `0A2A.1` est réservé aux SDK tiers qui enveloppent l'API : **ne pas** le reprendre au niveau de l'app. |
| `NSPrivacyAccessedAPICategoryUserDefaults` | **CA92.1** | Lire et écrire des préférences accessibles **uniquement à l'app** | React Native, `expo-constants`, `expo-system-ui`, `expo-video` (`UserDefaults.standard`) ; `expo-dev-launcher` et `expo-dev-menu` en build de développement |
| `NSPrivacyAccessedAPICategorySystemBootTime` | **35F9.1** | Mesurer le temps écoulé entre deux événements de l'app, ou des minuteurs | boost / React Native (`mach_absolute_time`) |
| `NSPrivacyAccessedAPICategoryDiskSpace` | **E174.1** | Vérifier l'espace disponible avant d'écrire des fichiers | `expo-file-system` (déclare `E174.1` + `85F4.1`). `85F4.1` (*afficher* l'espace disque) ne s'applique pas à SetRemote, qui n'affiche jamais l'espace disque : ne pas le déclarer au niveau de l'app. |
| `NSPrivacyAccessedAPICategoryActiveKeyboards` | — | — | Non utilisé |

`localStorage` dans la WebView (WKWebView) n'est **pas** une API à motif obligatoire : c'est le stockage web, pas `NSUserDefaults`.

Pourquoi tout déclarer au niveau de l'app ? Expo indique qu'Apple n'analyse pas correctement les `PrivacyInfo` des dépendances CocoaPods **statiques** (paquets Expo compris). Il recommande de reporter leurs motifs dans le manifest de l'app (`ios.privacyManifests` dans `app.json`). Apple refuse l'envoi d'un binaire qui utilise une API à motif obligatoire sans motif déclaré depuis le 1er mai 2024.

### C.2 Fichier cible

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyTracking</key>
  <false/>
  <key>NSPrivacyTrackingDomains</key>
  <array/>
  <key>NSPrivacyCollectedDataTypes</key>
  <array/>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>C617.1</string><string>3B52.1</string></array>
    </dict>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>CA92.1</string></array>
    </dict>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategorySystemBootTime</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>35F9.1</string></array>
    </dict>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryDiskSpace</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>E174.1</string></array>
    </dict>
  </array>
</dict>
</plist>
```

Équivalent Expo, à mettre dans `expo-app/app.json` sous `expo.ios`. Je ne l'ai pas appliqué : `expo-app/` est en lecture seule pour cette tâche.

```json
"privacyManifests": {
  "NSPrivacyTracking": false,
  "NSPrivacyTrackingDomains": [],
  "NSPrivacyCollectedDataTypes": [],
  "NSPrivacyAccessedAPITypes": [
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryFileTimestamp", "NSPrivacyAccessedAPITypeReasons": ["C617.1", "3B52.1"] },
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults", "NSPrivacyAccessedAPITypeReasons": ["CA92.1"] },
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategorySystemBootTime", "NSPrivacyAccessedAPITypeReasons": ["35F9.1"] },
    { "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryDiskSpace", "NSPrivacyAccessedAPITypeReasons": ["E174.1"] }
  ]
}
```

### C.3 Variante intermédiaire (si B s'applique)

Garder `NSPrivacyAccessedAPITypes` identique. Remplacer `NSPrivacyCollectedDataTypes` par trois entrées : `NSPrivacyCollectedDataTypePhotosorVideos`, `NSPrivacyCollectedDataTypeAudioData` et `NSPrivacyCollectedDataTypeOtherUserContent`. Chacune avec `NSPrivacyCollectedDataTypeLinked = false`, `NSPrivacyCollectedDataTypeTracking = false` et `NSPrivacyCollectedDataTypePurposes = [NSPrivacyCollectedDataTypePurposeAppFunctionality]`. Le manifest et les réponses d'App Store Connect doivent rester cohérents.

### C.4 Vérification avant envoi

1. `cd expo-app && npx expo prebuild --platform ios --clean`, puis vérifier `ios/SetRemote/PrivacyInfo.xcprivacy`.
2. Archiver dans Xcode, puis Organizer → clic droit sur l'archive → **Generate Privacy Report**. Le rapport agrège les manifests de l'app et des SDK.
3. Après l'envoi sur App Store Connect, surveiller l'e-mail d'Apple. Un avertissement « Missing API declaration » (code ITMS-91053) indique une catégorie oubliée. Ajouter le motif correspondant.
4. Refaire l'inventaire à chaque ajout de dépendance native.
5. `expo-dev-client` fait partie des `dependencies`. Vérifier que le build de **production** n'embarque pas le lanceur de développement. S'il l'embarque, ses usages de `UserDefaults` sont couverts par `CA92.1`.

---

## D. Conformité export et chiffrement

**Aujourd'hui**, `app.json` déclare `ITSAppUsesNonExemptEncryption: false`. C'est cohérent tant que l'app n'utilise que TLS (HTTPS/WSS) et DTLS fournis par le système.

**Après migration** (AES-256-GCM de bout en bout), selon la page *Export compliance documentation for encryption* d'Apple :

| Implémentation | Documents à fournir dans App Store Connect |
|---|---|
| Chiffrement fourni par le système Apple : **WebCrypto `crypto.subtle` dans WKWebView**, CryptoKit, CommonCrypto | *« No documentation required »* |
| Algorithme standard **non fourni** par le système, par exemple une bibliothèque JS embarquée (tweetnacl, libsodium.js, node-forge…) | **Déclaration française de chiffrement** à téléverser (*« only required if you're distributing your app on the App Store in France »*) |
| Algorithme propriétaire | CCATS + déclaration française |

**Recommandation** : implémenter AES-256-GCM, la dérivation de clés (HKDF/ECDH) et les nombres aléatoires **uniquement avec `crypto.subtle` et `crypto.getRandomValues`**, sans bibliothèque cryptographique embarquée. Dans ce cas :

- on reste dans la ligne « within the Apple operating system » ;
- `ITSAppUsesNonExemptEncryption` peut vraisemblablement rester à `false`, puisque seul un chiffrement exempté de documentation est utilisé. Sinon, App Store Connect pose le questionnaire à chaque build.

Points juridiques **à faire valider** (questions ouvertes) :

- Obligation éventuelle, au titre de l'EAR américain, d'un rapport annuel d'auto-classification pour un logiciel grand public qui chiffre des communications. Apple : *« If your app uses exempt forms of encryption, you might alternatively be required to submit a year-end self-classification report »*.
- Régime **ANSSI** de déclaration de fourniture de moyens de cryptologie en France, indépendamment de ce qu'Apple exige comme pièces.

---

## E. Classification par âge (questionnaire App Store Connect, version 2025)

| Section | Question | Réponse | Commentaire |
|---|---|---|---|
| In-App Controls | Parental Controls | Non | |
| | Age Assurance | Non | |
| Capabilities | Unrestricted Web Access | **Non** | La WebView n'affiche que l'interface de l'app. Les liens externes s'ouvrent dans le navigateur système (`onShouldStartLoadWithRequest`). |
| | User-Generated Content | **Non** | La définition d'Apple vise la *« broad distribution of content created by users »*. Ici, le contenu ne va que vers l'appareil appairé, sans diffusion large. Même si la réponse était Oui, le palier resterait 4+. |
| | Messaging and Chat | **Non** | Aucune communication entre utilisateurs. Le « message » fictif est un texte d'accessoire affiché sur l'écran de jeu de la même équipe. |
| | Social Media | Non | |
| | Advertising | Non | |
| Mature Themes | Profanity, Horror/Fear, Alcohol/Tobacco/Drugs | Aucun | |
| Medical or Wellness | Medical/Treatment, Health/Wellness | Aucun | |
| Sexuality or Nudity | toutes | Aucun | |
| Violence | Cartoon/Fantasy, Realistic, Graphic, Guns or Other Weapons | Aucun | Les effets « Police » (gyrophare) et « Éclair » sont des ambiances lumineuses, sans violence. |
| Chance-Based Activities | Gambling, Simulated Gambling, Contests, Loot Boxes | Aucun | |

**Résultat attendu : 4+.**

- **Made for Kids** : Non.
- Le questionnaire ne contient aucune question sur la photosensibilité. L'avertissement figure dans la description de la fiche (voir `store-listing.md`) et dans l'app, avant l'activation du stroboscope.

---

## F. Autres champs App Store Connect

| Champ | Réponse proposée |
|---|---|
| Content Rights : *Does your app contain, show, or access third-party content?* | **Non**. L'app n'affiche que des contenus fournis par l'utilisateur. |
| Sign-in required | Non (aucun compte) |
| Catégorie principale / secondaire | **Photo & Video** / **Utilities** (voir `store-listing.md`) |
| Copyright | `© 2026 [RAISON SOCIALE]` |
| Support URL | `[SITE WEB]/support` |
| Marketing URL (facultatif) | `[SITE WEB]` |
| Notes pour App Review | Voir `app-review-notes.md` |
| Achats intégrés | Aucun |
| Accessibility Nutrition Labels (facultatif) | À évaluer plus tard. Les boutons à icône seule n'ont pas encore d'`aria-label` (voir `i18n/README.md`). |

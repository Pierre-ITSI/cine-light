# Tester Ciné Light sur iPhone (EAS Build)

L'app utilise des modules natifs (torche via `expo-camera`, `expo-video`,
`expo-navigation-bar`, vibreur…). **Expo Go ne suffit pas** : il faut un
*development build* ou un *preview build* généré par EAS.

EAS Build compile **dans le cloud** : pas besoin de Mac ni de Xcode pour
fabriquer l'app. En revanche, pour l'installer sur un **iPhone physique**, il
faut un **compte Apple Developer Program payant (99 $/an)** — c'est Apple qui
l'exige pour signer une app installable sur un appareil réel (provisioning
ad hoc / TestFlight).

> Sans compte payant, la seule option gratuite est `npx expo run:ios --device`
> sur un Mac avec Xcode (certificat valable 7 jours). Tout le reste ci-dessous
> concerne le chemin EAS recommandé.

---

## Prérequis (une seule fois)

1. **Node 20+** installé sur ta machine.
2. **Compte Expo** (gratuit) : https://expo.dev/signup
3. **Compte Apple Developer Program** (99 $/an) : https://developer.apple.com/programs/
4. Installer le CLI EAS :
   ```bash
   npm install -g eas-cli
   ```

---

## Étapes

Toutes les commandes se lancent depuis le dossier `expo-app/`.

### 1. Connexion et initialisation du projet

```bash
cd expo-app
eas login
eas init          # crée le projet sur expo.dev et ajoute extra.eas.projectId dans app.json
```

> `eas init` ajoute automatiquement un `projectId` dans `app.json`. Pense à le
> committer ensuite.

### 2. Enregistrer ton iPhone (pour development / preview)

Le build « internal distribution » doit connaître l'UDID de ton appareil :

```bash
eas device:create
```

Choisis « Website / register via URL », ouvre le lien **sur l'iPhone**,
installe le profil proposé. L'appareil apparaît alors dans ton compte Apple.

### 3. Lancer le build

Deux profils utiles (définis dans `eas.json`) :

| Profil | Commande | Pour quoi |
|--------|----------|-----------|
| `preview` | `npm run build:ios:preview` | **Recommandé pour tester.** App autonome, s'installe directement, pas de serveur Metro à lancer. |
| `development` | `npm run build:ios:dev` | Dev build avec rechargement à chaud (`npx expo start --dev-client`). Idéal pour itérer sur le code. |

Exemple :
```bash
npm run build:ios:preview
```

La première fois, EAS demande de te connecter à ton **compte Apple** et génère
tout seul les certificats et le provisioning profile (laisse-le gérer, réponds
« yes »).

### 4. Installer sur l'iPhone

À la fin du build (~10-20 min), EAS affiche un **QR code** et un lien.
Scanne le QR avec l'appareil photo de l'iPhone → installe l'app.

Au premier lancement : **Réglages → Général → VPN et gestion de l'appareil →**
fais confiance au profil développeur.

### 5. Itérer (profil development uniquement)

```bash
npx expo start --dev-client
```

Scanne le QR depuis l'app Ciné Light installée : le code se recharge sans
rebuild tant que tu ne touches pas aux modules natifs.

---

## Dev client — tester Wi-Fi local & Bluetooth (spec 5)

Les modes **Wi-Fi local** et **Bluetooth** reposent sur des modules natifs
(`react-native-tcp-socket`, `react-native-ble-plx`) **absents d'Expo Go**. Il
faut un **dev client** — c'est le profil `development`.

### Approche CNG (aucun dossier natif à committer)

Le projet est en **Continuous Native Generation** : les dossiers `ios/` et
`android/` ne sont **pas** versionnés (ils sont dans `.gitignore`). EAS
exécute `expo prebuild` automatiquement dans le cloud à chaque build, en
appliquant les config plugins (permissions Bluetooth, réseau local, etc.).
Rien à générer ni committer manuellement.

> Vérifié : `expo prebuild` applique bien le plugin `react-native-ble-plx`
> (permissions `BLUETOOTH_SCAN/CONNECT`, `ACCESS_FINE_LOCATION`) et la
> permission réseau local iOS (`NSLocalNetworkUsageDescription`).

### Construire et lancer le dev client

```bash
cd expo-app
npx expo install --fix        # aligne les versions natives sur le SDK 56
npm run build:ios:dev         # build dev client (cloud EAS) → QR à scanner
# puis, une fois installé sur l'iPhone :
npx expo start --dev-client   # serveur Metro ; scanne le QR depuis l'app
```

Le JS se recharge à chaud ; un rebuild n'est nécessaire que si tu ajoutes ou
changes un module **natif**.

### Tester le Wi-Fi local

1. Mets l'iPhone (écran projecteur) et le téléphone télécommande sur le
   **même Wi-Fi** — aucune connexion Internet requise.
2. Télécommande → onglet **Canal** → mode **Wi-Fi local** → « Démarrer l'hôte ».
   Un QR `ip:port` (ex. `192.168.1.5:8777`) s'affiche.
3. Écran projecteur → mode **Wi-Fi local** → saisis `ip:port` (ou scanne).
4. Pilote couleur / strobe / torche : tout passe par le réseau local.

### Bluetooth — état

La télécommande (rôle central) est prête. Le rôle **périphérique** de l'écran
nécessite encore un module natif dédié à trancher — voir `CONNECTIVITY.md`.

### Option locale sans EAS (Mac uniquement)

```bash
npx expo run:ios --device     # prebuild + build + install via Xcode
```
Nécessite un Mac avec Xcode ; certificat gratuit valable 7 jours.

---

## Plus tard : TestFlight / App Store

```bash
npm run build:ios:prod      # build de production signé
eas submit --platform ios   # envoie vers App Store Connect / TestFlight
```

---

## Profils disponibles (`eas.json`)

- **development** — dev client, distribution interne, rechargement à chaud.
- **ios-simulator** — build pour le simulateur iOS (Mac, sans compte Apple).
- **preview** — app autonome, distribution interne (test sur appareil réel).
- **production** — build signé pour l'App Store / TestFlight, build number
  auto-incrémenté.

## Notes

- `ITSAppUsesNonExemptEncryption: false` est déjà déclaré → pas de question de
  conformité export à chaque envoi TestFlight.
- Le `bundleIdentifier` est `com.pikoo.cinelight`. Garde-le stable.
- La PWA (`/index.html`, racine du repo) reste indépendante : elle continue de
  fonctionner pour les tests rapides sans rien installer.

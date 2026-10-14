# TestFlight — SetRemote iOS

L'app iOS est une **coque native** (Expo) qui affiche la PWA
(`https://pierre-itsi.github.io/cine-light/`) en plein écran, et ajoute en natif :
barre d'état masquée en permanence, écran toujours allumé, vraie luminosité
matérielle pilotée depuis la télécommande. Toute mise à jour de la PWA est
donc visible dans l'app **sans nouveau build**.

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

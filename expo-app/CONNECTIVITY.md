# Connectivité — trois modes de transport

Ciné Light relie la télécommande et l'écran projecteur via une abstraction
commune `RemoteTransport` (`connect/disconnect/send/onMessage/onStatusChange`).
Le reste de l'app (couleur, strobe, vibreur, torche, pool média) envoie des
messages JSON **sans savoir** par quel transport ils transitent.

| Mode | Classe | Internet | Module natif | Web |
|------|--------|----------|--------------|-----|
| **Internet** | `MqttTransport` | requis | — | ✅ |
| **Wi-Fi local** | `WifiTransport` | non | `react-native-tcp-socket` | ❌ masqué |
| **Bluetooth** | `BleTransport` | non | `react-native-ble-plx` | ❌ masqué |

La fabrique `createTransport(mode, role)` choisit l'implémentation. Le build
web utilise `createTransport.web.ts` (résolu par Metro) qui n'importe que
`MqttTransport` → les modules natifs ne sont **jamais** inclus dans le bundle
web (vérifié : le bundle passe de 923 à 788 modules).

## Sélection du mode

- Toggle manuel dans l'onglet **Canal** de la télécommande et sur l'écran de
  connexion du projecteur (masqué sur web).
- Suggestion automatique indicative (`expo-network`) : Internet joignable →
  Internet ; Wi-Fi sans Internet → Wi-Fi local ; sinon → Bluetooth. Badge
  « recommandé », sans forcer le choix.

## Wi-Fi local

- La **télécommande héberge** un serveur TCP (port `8777`) — rôle fixe.
- Elle expose son `ip:port`, encodé dans le QR code existant.
- L'écran projecteur scanne le QR ou saisit `ip:port` pour se connecter.
- Les deux appareils doivent être sur le même réseau Wi-Fi (Internet non
  requis). iOS : `NSLocalNetworkUsageDescription` déclaré.
- Découverte automatique (mDNS/Bonjour) volontairement non implémentée dans
  cette première itération (cf. spec).

## Bluetooth (BLE) — état et limite à valider

- Télécommande = **central** : scan, connexion, écriture des commandes sur la
  caractéristique. **Implémenté et complet** (`BleTransport` rôle `remote`).
- Écran projecteur = **périphérique** : doit annoncer le service GATT.

> ⚠️ **Limite native importante.** `react-native-ble-plx` n'implémente que le
> rôle **central**, pas le rôle **périphérique**. Le côté écran (annonce du
> service) exige donc un **module natif distinct** (p. ex.
> `react-native-ble-peripheral` / `react-native-peripheral`, ou un module
> maison), à choisir et **valider sur appareil réel**. Tant que ce choix
> n'est pas tranché, le rôle `screen` en Bluetooth remonte une erreur
> explicite plutôt que de feindre de fonctionner. C'est cohérent avec la spec
> (« rôles à valider en implémentation », « à valider sur device réel »).

UUIDs et découpage de trames (MTU) sont centralisés dans
`src/transport/transportConfig.ts`.

## Important : Expo Go ne suffit plus

Dès `react-native-tcp-socket` / `react-native-ble-plx`, il faut un **dev
client** (pas Expo Go) :

```bash
cd expo-app
npx expo install --fix        # aligner les versions natives sur le SDK
npx expo prebuild             # génère ios/ + android/
npm run build:ios:dev         # ou build:ios:preview (cf. EAS-BUILD.md)
```

Le **mode Internet continue de fonctionner en Expo Go** et sur le web : les
modes Wi-Fi/Bluetooth sont simplement absents de ces cibles.

## Validation restante (sur device réel)

- [ ] Wi-Fi local : connexion écran↔télécommande sur Wi-Fi sans Internet.
- [ ] BLE : choisir/intégrer le module périphérique pour l'écran.
- [ ] BLE : mesurer latence et MTU réels avant de valider les presets de
      strobe en Bluetooth (le découpage de trames est déjà prévu).
- [ ] BLE iPhone ↔ Android : vérifier l'interopérabilité.

# Audio de l'appel décroché : app native (écouteur, haut-parleur, écran noir)

Un faux appel décroché joue la voix du correspondant sur l'écran de jeu. Dans
un navigateur, elle sort par la sortie normale (haut-parleur) et le capteur de
proximité est ignoré. Dans l'app SetRemote, le module local
`expo-app/modules/setremote-audio` joue la voix lui-même : **à l'oreille** (comme
un vrai appel) ou **au haut-parleur**, avec **écran noir contre l'oreille**.
La télécommande règle, **l'écran de jeu décide** : ses réglages ne sont jamais
désactivés, et une note les rappelle (« Son à l'oreille et écran noir :
uniquement sur les écrans de jeu avec l'app native »).

## Réglages (vue « Au décroché », entrée enregistrée, `call:start.audio`)

| Réglage | Valeurs | Défaut |
|---|---|---|
| Délai avant la voix | 0 à 15 s (partout, navigateur compris) | 0 |
| Sortie du son | `ear` (à l'oreille) / `speaker` (haut-parleur) | `ear` |
| Écran noir contre l'oreille | `prox` booléen | oui |

Protocole : `packages/protocol/README.md` (`call:start.audio`, `call:speaker`,
`tel:state.tel.speaker`). Une entrée enregistrée avant cette version n'a pas
d'`audio` : elle garde l'ancien comportement (voix tout de suite, sortie du
système) jusqu'à sa mise à jour. Dans les fichiers projet `.rem`, ces réglages
sont sous `audioCfg` (la clé `audio` y désigne la bande son).

## Bouton « Haut-parleur »

Barre Tel pendant un appel décroché, et bouton de l'écran de jeu : le même état,
synchronisé dans les deux sens par `call:speaker { on, from }`. L'écran fait foi :
la télécommande demande, l'écran applique puis renvoie l'état réel, la
télécommande ne change qu'à ce retour (jamais d'écho). L'écran renvoie aussi
l'état au décroché ; une télécommande rechargée le retrouve par `tel:state`.

## Pont page ↔ coque (JSON, `00-native-bridge.js`, `src/bridge.ts`)

Actif seulement si `window.SETREMOTE_NATIVE.caps.audioRoute === true` (coque à
jour, `bridge: 2`). Sinon : voix WebAudio, aucun message `audio:*`.

page → coque :

- `audio:load { id, mime, size, i, n, data }` : bande son (celle du cache de
  l'écran, ≤ 8 Mo) en morceaux base64 de 512 Kio de caractères, envoyée **pendant
  que ça sonne** et une seule fois par contenu (`id` = empreinte). `size` = nombre
  total de caractères base64, tous les morceaux sont pleins, le dernier porte le
  reste. La coque l'écrit dans `cache/appels-audio/` (3 fichiers gardés).
- `audio:call-start { route, proximity }` au décroché.
- `audio:play { id, delay }` : voix après `delay` s (délai tenu par le natif).
- `audio:route { route }` : bascule à chaud.
- `audio:call-end {}` : raccroché, refus, fin, nouvel appel.

coque → page (`window.SRNative.receive`) :

- `audio:state { route?, proximityNear?, proximityAvailable? }` : sortie
  réellement utilisée (sorties intégrées seulement ; un casque garde la priorité
  du système), contre l'oreille ou non, capteur absent.
- `audio:loaded { id }`, `audio:error { reason }` (`bad-chunk`, `write-failed`,
  `not-loaded`, `unavailable`, `session-failed`, `route-failed`, `play-failed`).
  Une erreur de lecture fait repartir la voix en WebAudio.

## Natif

- **iOS** (`ios/CallAudio.swift`) : `AVAudioSession` `.playAndRecord` + mode
  `.voiceChat` (seule combinaison qui donne la sortie « écouteur »), `.allowBluetooth` ;
  écouteur = aucun forçage, haut-parleur = `overrideOutputAudioPort(.speaker)` ;
  `AVAudioPlayer` (délai : `play(atTime:)`) ; `UIDevice.isProximityMonitoringEnabled`
  pendant l'appel décroché seulement, si demandé ; catégorie d'origine rétablie à
  la fin (`notifyOthersOnDeactivation`). **Aucune entrée micro n'est ouverte.**
- **Android** (`android/…/CallAudio.kt`) : `MODE_IN_COMMUNICATION`, focus audio
  transitoire, `MediaPlayer` en `USAGE_VOICE_COMMUNICATION` / `CONTENT_TYPE_SPEECH` ;
  API 31+ `setCommunicationDevice` (écouteur / haut-parleur intégrés), avant :
  `isSpeakerphoneOn` ; `PROXIMITY_SCREEN_OFF_WAKE_LOCK` si pris en charge
  (sinon `proximityAvailable: false`). Permissions « normales » du manifeste du
  module : `MODIFY_AUDIO_SETTINGS`, `WAKE_LOCK`. Pas de `RECORD_AUDIO`.

## Choix conservateurs et App Store

- Aucune clé nouvelle dans `app.json` / Info.plist. `NSMicrophoneUsageDescription`
  existe déjà (plugins `expo-camera` et `expo-image-picker`, vidéo filmée) ; le
  module n'ouvre aucune entrée, donc iOS ne pose aucune question micro pour cette
  fonction. `privacyManifests` inchangé (`NSPrivacyCollectedDataTypes` vide).
- `.playAndRecord` seul n'est pas un enregistrement, mais peut être relevé en
  revue : phrase prête, « catégorie requise par iOS pour router la voix vers
  l'écouteur ; aucun enregistrement, aucune donnée collectée ». Si Apple refuse,
  l'option « À l'oreille » disparaît sur iOS (le haut-parleur reste).
- Pas de mode d'arrière-plan « audio » : en arrière-plan, iOS suspend l'app comme
  avant. Aucun module sans la coque : Expo Go et ancien binaire ne reçoivent rien.

## À vérifier sur appareil (jamais compilé ni lancé hors appareil)

Le Swift et le Kotlin n'ont été ni compilés ni exécutés ; le premier build EAS les
vérifie. `cd expo-app && npm test` couvre le pont TypeScript et la cohérence des
noms.

iPhone :
- [ ] Voix **à l'oreille** par défaut, audible dans l'écouteur, pas au haut-parleur.
- [ ] Bascule **à chaud** (bouton de l'écran, bouton de la télécommande) sans coupure.
- [ ] Délai de 0, 2, 15 s depuis le décroché (manuel et décroché auto).
- [ ] **Écran noir** contre l'oreille, retour en l'éloignant ; réglage décoché :
      jamais noir. Appui sur l'écran noir ignoré par le système.
- [ ] Casque filaire, AirPods : la sortie suit le système, l'écran suit
      (`audio:state` ignoré pour ces sorties), pas de boucle de bascule.
- [ ] Appel entrant réel (ou alarme) pendant la voix : reprise après.
- [ ] Raccrocher : sortie et catégorie d'avant rétablies (sonnerie, vidéo de
      l'onglet Média : volume et sortie normaux), capteur coupé (écran jamais noir ensuite).
- [ ] 30 s de lecture écran verrouillé par le comédien : comportement noté.
- [ ] Aucune demande de permission micro, aucun indicateur orange.
- [ ] TestFlight (build externe) : pas de refus de `playAndRecord`.

Android (API 29, 31, 34, un constructeur sans capteur de proximité) :
- [ ] Écouteur par défaut, haut-parleur à chaud, délai.
- [ ] `PROXIMITY_SCREEN_OFF_WAKE_LOCK` : écran noir contre l'oreille **malgré**
      `useKeepAwake` (écran toujours allumé de la coque) ; sinon noter et décider.
- [ ] Sans capteur : `proximityAvailable: false`, aucune erreur.
- [ ] Casque / Bluetooth branché : la sortie suit le système.
- [ ] Raccrocher : mode audio, haut-parleur et focus rendus (musique d'une autre
      app reprise), verrou relâché.
- [ ] Android 12+ : `availableCommunicationDevices` contient un écouteur ; sinon `route-failed`.

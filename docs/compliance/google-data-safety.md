# Google Play : section « Sécurité des données » et exigences pour une nouvelle app

Document de travail pour la Play Console (package `com.pikoo.setremote`).

- **Partie A** : réponses **cibles**, après migration.
- **Partie B** : réponses dans l'**état actuel** (bout en bout livré, relais encore public), si l'app était publiée avant la fin de la migration.
- **Partie C** : les autres exigences Play pour une nouvelle app en 2026.

Sources vérifiées le **2026-10-14**. `support.google.com` était bloqué par le proxy de la session : les textes de règles Play ci-dessous viennent d'extraits de recherche web qui citent ces pages. **Relire les pages officielles dans la Play Console avant soumission.**

| Sujet | URL |
|---|---|
| Section Data safety (définitions, exemptions dont le chiffrement de bout en bout) | https://support.google.com/googleplay/android-developer/answer/10787469 |
| Niveau d'API cible requis (page officielle, lue directement) | https://developer.android.com/google/play/requirements/target-sdk |
| Exigences de test pour les nouveaux comptes personnels | https://support.google.com/googleplay/android-developer/answer/14151465 |
| Règle sur les autorisations photos et vidéos (`READ_MEDIA_*`) | https://support.google.com/googleplay/android-developer/answer/14115180 |
| Déclarations « Contenu de l'application » | https://support.google.com/googleplay/android-developer/answer/9859455 |
| Classification du contenu (IARC) | https://support.google.com/googleplay/android-developer/answer/9898843 et https://support.google.com/googleplay/android-developer/answer/188189 |
| Comportement trompeur, imitation d'éléments système (règle « Deceptive Behavior ») | Centre des règles : https://play.google/developer-content-policy/ ; page renvoyée par la recherche : https://support.google.com/googleplay/android-developer/answer/9887877 |
| Divulgation visible, politique de confidentialité dans l'app | https://support.google.com/googleplay/android-developer/answer/11150561 |
| Vérification des développeurs Android (2026) | Presse : https://thehackernews.com/2026/06/google-sets-sept-30-deadline-for.html (application à partir du 30 septembre 2026 au Brésil, en Indonésie, à Singapour et en Thaïlande ; extension mondiale prévue en 2027) |

---

## A. Formulaire Data safety — réponses CIBLES

### A.1 Collecte et partage

> **Votre application collecte-t-elle ou partage-t-elle l'un des types de données utilisateur requis ?**
> → **Non**

La fiche affichera « Aucune donnée collectée » et « Aucune donnée partagée avec des tiers ».

**Justification**, d'après les exemptions décrites dans l'aide Play Console :

1. **Chiffrement de bout en bout.** Les données envoyées hors de l'appareil n'ont pas à être déclarées si elles sont chiffrées de bout en bout, c'est-à-dire illisibles par tout intermédiaire, **développeur compris**, seuls l'expéditeur et le destinataire détenant les clés. C'est exactement le cas des contenus SetRemote (AES-256-GCM, clés dérivées sur les appareils, relais sans clé).
2. **Accès et traitement sur l'appareil.** Les mémoires et préréglages sont stockés localement. Le choix des photos se fait via le sélecteur système. Rien de tout cela n'est transmis.
3. **Transfert à l'initiative de l'utilisateur.** L'export de projet (avec ou sans médias) est un fichier que l'utilisateur enregistre ou partage lui-même par le menu de partage du système. Rien n'est envoyé à l'éditeur.
4. **Adresse IP au relais.** Elle n'est utilisée que pour acheminer la connexion et n'est pas conservée. Ce n'est pas un type de données de la liste Play (« Device or other IDs » vise l'IMEI, l'identifiant publicitaire, etc.). Elle n'est utilisée ni pour localiser ni pour identifier.
5. **Aucun SDK** d'analyse, de publicité ou de crash.

### A.2 Tableau des catégories Play

| Catégorie Play | Types | Réponse | Justification |
|---|---|---|---|
| Localisation | Approximative, précise | Non collectée | La permission de localisation déclarée par la bibliothèque BLE n'est requise par le système que pour le scan Bluetooth jusqu'à Android 11. Aucune position n'est lue ni transmise. |
| Infos personnelles | Nom, e-mail, ID utilisateur, adresse, téléphone, etc. | Non collectées | Le nom d'appelant fictif est un contenu chiffré de bout en bout (exempté) |
| Infos financières | — | Non | Pas d'achat |
| Santé et remise en forme | — | Non | |
| Messages | E-mails, SMS ou MMS, autres messages dans l'app | Non | Les textes de messages fictifs sont chiffrés de bout en bout et ne sont pas de vrais messages |
| Photos et vidéos | Photos, vidéos | Non collectées | Chiffrées de bout en bout, cachées uniquement sur l'appareil appairé |
| Fichiers audio | Enregistrements vocaux ou sonores, fichiers musicaux, autres | Non collectés | Idem |
| Fichiers et documents | — | Non | L'export de projet est créé et partagé par l'utilisateur, sans transmission à l'éditeur |
| Agenda, contacts | — | Non | Aucun accès |
| Activité dans l'app | Interactions, historique de recherche, applis installées, autre contenu généré, autres actions | Non | Pas de mesure d'audience. Les commandes de couleur et d'effet sont chiffrées de bout en bout. |
| Navigation sur le Web | — | Non | |
| Infos et performances de l'app | Journaux de plantage, diagnostics, autres | Non | Aucun SDK de crash. Les « Android vitals » sont collectés par Google, pas par l'app. |
| Appareil ou autres ID | — | Non | Pas d'identifiant publicitaire. L'ID de session est aléatoire et éphémère. |

### A.3 Questions suivantes, si la console les affiche malgré le « Non »

| Question | Réponse |
|---|---|
| Les données sont-elles chiffrées en transit ? | **Oui** (TLS vers le relais, DTLS pour WebRTC, plus le chiffrement de bout en bout) |
| Méthodes de création de compte | **« Mon application ne permet pas de créer de compte »** |
| URL de suppression de compte ou des données | Non applicable (aucun compte, aucune donnée conservée) |
| Examen de sécurité indépendant (MASA) | Non (facultatif) |
| Conformité à la règle Familles | Non applicable (public cible 18+, voir C.5) |

---

## B. Formulaire Data safety — réponses dans l'état ACTUEL (relais encore public)

*Mis à jour le 16 octobre 2026.* L'état décrit ici auparavant (`main@5e0323d` : contenus **en clair** sur le broker public, QR fabriqué par `api.qrserver.com`, Google Fonts) n'existe plus : tous les messages et médias sont chiffrés de bout en bout (AES-256-GCM, y compris le repli des vidéos sur le broker), le QR est dessiné sur l'appareil et les polices sont auto-hébergées. Restent : le broker MQTT **public** `broker.hivemq.com` comme relais (trames chiffrées ; il voit l'adresse IP et les métadonnées, et n'est pas un sous-traitant sous contrat), le STUN public de Google (adresse IP lors de l'envoi d'une vidéo) et GitHub Pages pour la version web.

> Collecte ou partage de types requis ? → **Non** (mêmes exemptions qu'en A.1 : chiffrement de bout en bout, traitement sur l'appareil ; l'adresse IP n'est pas un type de la liste Play)

- **Réserve** : la conservation des journaux du broker public n'est pas connue ; la politique publiée le dit. Le plus sûr reste de basculer sur le relais auto-hébergé avant la soumission.
- Chiffrées en transit : **Oui** (TLS vers le broker, DTLS pour WebRTC, plus le chiffrement de bout en bout).
- Politique de confidentialité : `confidentialite.html` (et `privacy.html`) à la racine du dépôt décrit cet état réel et nomme HiveMQ, Google (STUN) et GitHub. Au passage au relais, seul son paragraphe balisé `RELAIS : DÉBUT / FIN` change.

---

## C. Autres exigences Google Play pour une nouvelle app (2026)

### C.1 Type de compte développeur et test fermé obligatoire

- **Comptes personnels créés après le 13 novembre 2023** : avant de pouvoir demander l'accès à la production, il faut un **test fermé avec au moins 12 testeurs** inscrits **pendant 14 jours consécutifs** (page d'aide 14151465). Tant que ce n'est pas fait, les pistes Production et Préinscription restent désactivées.
  - Prévoir 15 à 20 testeurs. Plusieurs sources indiquent que le compteur repart de zéro si le nombre passe sous 12 pendant la période.
  - Les testeurs doivent installer l'app et l'utiliser réellement. Google pose ensuite des questions sur le test lors de la demande d'accès à la production.
- **Comptes organisation** : d'après les sources tierces consultées, ils ne sont pas soumis à cette règle. Je ne l'ai pas confirmé sur la page Google : à vérifier dans la Play Console.
  - **Recommandation** : publier sous un **compte organisation** au nom de ITSI APP. Cela demande un numéro D-U-N-S. On évite ainsi les 14 jours de test, et l'éditeur affiché correspond au responsable de traitement de la politique de confidentialité.
- **Vérification des développeurs Android** : appliquée à partir du **30 septembre 2026** au Brésil, en Indonésie, à Singapour et en Thaïlande, puis étendue mondialement en 2027. Les comptes Play Console déjà vérifiés sont en règle dans la quasi-totalité des cas. Il suffit de vérifier que l'identité et le package sont enregistrés.

### C.2 Niveau d'API cible

Extrait de la page officielle Android :

> *« New apps and app updates must target Android 16 (API level 36) or higher to be submitted to Google Play »* (depuis le 31 août 2026 ; une prolongation jusqu'au 1er novembre 2026 est possible sur demande).

**État du projet** : React Native 0.85.3 fixe `targetSdk = "36"`, `compileSdk = "36"` et `minSdk = "24"` (vérifié dans `react-native/gradle/libs.versions.toml`). **Conforme**, à condition de ne pas abaisser `targetSdkVersion` via `expo-build-properties`.

### C.3 Autorisations Android et déclarations

Autorisations attendues dans le manifeste fusionné, d'après les `AndroidManifest.xml` des modules et les plugins Expo. **À vérifier** sur le résultat de `npx expo prebuild --platform android`, fichier `android/app/src/main/AndroidManifest.xml`, ou avec `aapt dump permissions` sur l'AAB.

| Autorisation | Origine | Niveau | Action |
|---|---|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_NETWORK_STATE` | RN, expo-network, react-native-tcp-socket | Normale | Rien |
| `CAMERA` | expo-camera, expo-image-picker | Dangereuse (exécution) | Justifiée (photo ou vidéo à diffuser, torche). Pas de formulaire Play. |
| `RECORD_AUDIO` | plugins expo-camera / expo-image-picker (`microphonePermission`) | Dangereuse | Justifiée **uniquement** pour filmer une vidéo. Pas de formulaire Play. Si la capture vidéo native n'est pas livrée en v1, mettre `microphonePermission: false` pour la retirer. |
| `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` (`maxSdkVersion=32`) | expo-file-system, expo-image-picker, expo-image | Dangereuse, ignorée à partir d'Android 13 | Acceptable (bornée) |
| `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` | **Non ajoutées** : expo-image-picker utilise le **sélecteur de photos** Android | — | **Garder ainsi.** La règle Play sur les photos et vidéos réserve ces autorisations aux apps dont la fonction principale exige un accès large, avec un formulaire de déclaration. SetRemote ne fait qu'un usage ponctuel, couvert par le sélecteur. |
| `BLUETOOTH`, `BLUETOOTH_ADMIN` (`maxSdkVersion=30`), `BLUETOOTH_SCAN` (`neverForLocation`), `BLUETOOTH_CONNECT` | react-native-ble-plx | Dangereuse (« appareils à proximité ») | Justifiées si le mode Bluetooth est livré. **Sinon, retirer le plugin BLE de la v1.** |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | react-native-ble-plx, **sans `maxSdkVersion`** | Dangereuse | Ajouter `android:maxSdkVersion="30"` via un config plugin : à partir d'Android 12, `BLUETOOTH_SCAN` avec `neverForLocation` suffit. Pas d'arrière-plan, donc **pas de formulaire de localisation**, mais l'autorisation reste visible sur la fiche. |
| `WRITE_SETTINGS` | plugin `expo-brightness`, s'il est appliqué automatiquement au prebuild | Spéciale | **Bloquer** (`android.blockedPermissions`) : l'app ne règle que la luminosité de sa propre fenêtre (`setBrightnessAsync`), ce qui ne demande aucune autorisation. |
| `VIBRATE` | À ajouter si la vibration du récepteur doit fonctionner dans la WebView (`navigator.vibrate`) | Normale | Rien côté Play |
| `FOREGROUND_SERVICE*` | expo-video **uniquement si** `supportsBackgroundPlayback` | — | Non activé : garder ainsi, sinon il faut déclarer le service de premier plan |
| `com.google.android.gms.permission.AD_ID` | — | — | Absent. Déclaration de l'identifiant publicitaire : **« Non »** |

**Aucune autorisation sensible ou restreinte nécessitant un formulaire Play** (SMS, journal d'appels, localisation en arrière-plan, accès à tous les fichiers, `READ_MEDIA_*`, services d'accessibilité, `QUERY_ALL_PACKAGES`) n'est requise, à condition de suivre les actions ci-dessus. Le simulateur d'appel n'utilise **aucune** API de téléphonie ni de SMS.

**Divulgation visible et consentement** : Play l'exige quand des données sont collectées d'une façon que l'utilisateur ne peut pas raisonnablement anticiper. Ce n'est pas le cas ici, puisqu'aucune collecte n'a lieu et que chaque permission est demandée au moment de l'action. Afficher tout de même une phrase d'explication avant la demande système (par exemple « Pour filmer une vidéo à envoyer à l'écran de jeu, SetRemote a besoin de l'appareil photo et du micro »).

### C.4 Politique de confidentialité

Obligatoire dans la Play Console pour **toutes** les apps, même sans collecte. Play l'exige aussi **dans l'app** pour les apps qui accèdent à des données sensibles (appareil photo, micro). Apple l'exige dans l'app dans tous les cas (5.1.1(i)). **Fait** : télécommande › engrenage (Réglages) › « Politique de confidentialité », page embarquée dans l'app (`confidentialite.html`, `privacy.html` si l'anglais est choisi), lisible sans réseau.

### C.5 Déclarations « Contenu de l'application »

| Déclaration | Réponse |
|---|---|
| Règles de confidentialité | `https://pierre-itsi.github.io/cine-light/confidentialite.html` (tant que la version web reste sur GitHub Pages) |
| Annonces | **Non**, l'app ne contient pas d'annonces |
| Accès à l'application | « Toutes les fonctionnalités sont disponibles sans accès particulier ». **Ajouter les instructions** de test sur deux appareils (texte adapté de `app-review-notes.md`, section 2), et le lien vers la vidéo de démonstration. |
| Classification du contenu | Questionnaire IARC (C.6) |
| Public cible et contenu | **18 ans et plus** uniquement. C'est un outil professionnel, et ce choix évite les obligations de la règle Familles. « L'app pourrait-elle attirer les enfants ? » → **Non** |
| Application d'actualités | Non |
| Sécurité des données | Partie A (ou B) |
| Application gouvernementale | Non |
| Fonctionnalités financières | « Mon application ne propose aucune fonctionnalité financière » |
| Applications de santé | « Mon application n'a pas de fonctionnalités liées à la santé » (si le formulaire est affiché) |
| Identifiant publicitaire | **Non** |

### C.6 Questionnaire de classification IARC

Je n'ai pas pu relire mot pour mot l'intitulé actuel des questions. Les réponses ci-dessous suivent la structure habituelle du questionnaire.

- **Catégorie** : celle qui couvre les apps utilitaires et de productivité (« Utility, Productivity, Communication, or Other » ou intitulé équivalent). **Pas** « Jeu ».
- Violence, peur et horreur, sexualité et nudité, langage grossier, substances contrôlées (alcool, tabac, drogues), humour grossier, jeux d'argent réels ou simulés : **Non** à tout.
- **Les utilisateurs peuvent-ils interagir ou échanger du contenu ?** → **Oui**, réponse prudente. Une personne peut envoyer images et textes vers l'écran de jeu d'une autre personne, après appairage volontaire par QR code ou code. Cela ajoute l'élément interactif « Interaction entre utilisateurs » sans changer l'âge.
- Partage de la position avec d'autres utilisateurs : **Non**.
- Achats numériques : **Non**.
- Accès Internet non restreint (navigateur) : **Non**.
- Contenu promotionnel ou publicitaire : **Non**.

**Résultat attendu** : PEGI 3, ESRB Everyone (E), USK 0, ClassInd L, IARC 3+, avec l'élément interactif « Users Interact ».

### C.7 Éléments graphiques de la fiche

Exigences Play à respecter :

- icône **512 × 512** PNG 32 bits ;
- **image de présentation 1024 × 500** (obligatoire) ;
- **au moins 2 captures** par type d'appareil, 8 au maximum, en JPEG ou PNG 24 bits, côté le plus court ≥ 320 px, côté le plus long ≤ 3840 px, rapport ≤ 2:1 ;
- captures tablette 7" et 10" recommandées, car l'app fonctionne en écran de jeu sur tablette.

Plan de prises de vue : voir `store-listing.md`.

### C.8 Risques de règles à anticiper

| Règle Play | Risque pour SetRemote | Mesures prises ou à prendre |
|---|---|---|
| Comportement trompeur : imitation d'éléments système, de notifications ou d'autres apps | Faux écran d'appel, faux écran verrouillé, fausse notification | Styles neutres sans marque (Verre, Tonal, Épuré). Affichage **uniquement dans SetRemote**, sur l'écran de jeu, et uniquement sur commande de la télécommande appairée. Aucune notification système. Le champ « nom d'app fictive » invite à inventer un nom. Fonction décrite comme accessoire de tournage dans la fiche, absente des captures et des mots-clés. |
| Usurpation d'identité et marques | Un utilisateur saisit « WhatsApp » comme nom d'app | Texte d'aide existant (« Pas de marque réelle »). Envisager un filtre de noms de marques connues. |
| Affirmations trompeuses | Promettre le Bluetooth ou le Wi-Fi local s'ils ne sont pas livrés | La fiche n'annonce que les modes réellement livrés (voir `store-listing.md`) |
| Contenu dangereux (stroboscope) | Clignotements jusqu'à 30 Hz | Avertissement photosensibilité avant activation, rappelé dans la description |
| Fonctionnalité minimale | App qui exige deux appareils | Instructions d'accès et vidéo de démonstration (C.5) |

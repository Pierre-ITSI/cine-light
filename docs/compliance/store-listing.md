# Fiches App Store et Google Play : textes FR / EN

Textes prêts à coller. Chaque champ est dans un bloc dédié. Les longueurs sont recalculées
automatiquement (voir le tableau « Contrôle des longueurs » en fin de document).

Règles appliquées à tous les textes :

- **aucune marque tierce** : pas de nom d'app de messagerie, de fabricant de téléphone, de système d'exploitation ni de fabricant de projecteurs (App Store 2.3.7 / 2.3.10, règles de métadonnées Play) ;
- **le simulateur d'appel n'apparaît ni dans les mots-clés ni dans les captures**. Il est décrit une seule fois dans la description, comme accessoire de tournage fictif, parce qu'App Review interdit les fonctions cachées (guideline 2.3.1) ;
- on n'annonce **que des fonctions livrées**. Les phrases entre `[OPTIONNEL : …]` ne sont à garder que si la fonction est dans la version soumise.

---

## 1. App Store

### 1.1 Nom (≤ 30 caractères)

Nom principal, identique en FR et en EN :

<!-- id=apple.name max=30 -->
```text
SetRemote
```

Variantes si « SetRemote » est déjà pris sur l'App Store. Le nom doit y être unique.

<!-- id=apple.name.alt1 max=30 -->
```text
SetRemote Plateau
```
<!-- id=apple.name.alt2 max=30 -->
```text
SetRemote – Lumière de plateau
```
<!-- id=apple.name.alt3 max=30 -->
```text
SetRemote Ciné
```
Variantes EN, pour la localisation anglaise :
<!-- id=apple.name.alt1.en max=30 -->
```text
SetRemote Set Light
```
<!-- id=apple.name.alt2.en max=30 -->
```text
SetRemote – Film Set Lighting
```

### 1.2 Sous-titre (≤ 30)

<!-- id=apple.subtitle.fr max=30 -->
```text
Lumière et écrans de plateau
```
<!-- id=apple.subtitle.en max=30 -->
```text
Set lighting & prop screens
```
Variantes :
<!-- id=apple.subtitle.alt.fr max=30 -->
```text
Lumière pilotée à distance
```
<!-- id=apple.subtitle.alt.en max=30 -->
```text
Remote light panels for film
```

### 1.3 Texte promotionnel (≤ 170, modifiable sans nouvelle version)

<!-- id=apple.promo.fr max=170 -->
```text
Un téléphone devient source de lumière ou écran d'accessoire, piloté depuis un second appareil. CCT, tint, effets, médias. Sans compte ni pub, chiffré de bout en bout.
```
<!-- id=apple.promo.en max=170 -->
```text
Turn a phone into a light source or prop screen, controlled from a second device. CCT, tint, effects, media. No account, no ads, end-to-end encrypted.
```

### 1.4 Mots-clés (≤ 100, séparés par des virgules sans espace)

Ils ne répètent pas les mots du nom et du sous-titre (qu'Apple indexe déjà). Ils ne contiennent ni « appel », ni « SMS », ni « faux », ni aucune marque.

<!-- id=apple.keywords.fr max=100 bytes=100 -->
```text
éclairage,tournage,cinéma,accessoiriste,électro,régie,LED,CCT,kelvin,strobe,effet,DMX,vidéo
```
<!-- id=apple.keywords.en max=100 bytes=100 -->
```text
film,cinema,gaffer,props,light panel,LED,CCT,kelvin,strobe,DMX,sACN,video,shoot,crew,cue
```

### 1.5 Description (≤ 4000)

La même description sert pour Google Play (section 2.3).

<!-- id=desc.fr max=4000 -->
```text
SetRemote transforme un téléphone ou une tablette en source de lumière et en écran d'accessoire pour vos tournages, piloté à distance depuis un second appareil.

Pensé pour les accessoiristes, les électros, la régie, les pupitreurs, la mise en scène et les chefs opérateurs, SetRemote fonctionne avec deux appareils :
• la télécommande, que vous gardez en main ;
• l'écran de jeu, placé dans le décor ou utilisé comme petite source.

Appairez-les en scannant un QR code ou en saisissant un code court. Aucun compte n'est nécessaire.

COULEUR ET LUMIÈRE
• Dimmer maître et luminosité de l'écran de jeu
• Température de couleur de 1 700 K à 20 000 K et tint vert/magenta
• Roue chromatique, HUE ou RGB, avec fondu blanc ↔ couleur
• Mémoires de couleur : enregistrez, rappelez et mettez à jour vos cues
• Blackout instantané depuis la télécommande

LABORATOIRE D'EFFETS
• Chaser (bande, rond ou losange ; loop, bounce, wing), noise, aurore, caustiques
• Pulse BPM avec tap tempo, phares de voiture, soudure, néon défectueux, gyrophare, éclair, rafales de flashs
• Flicker TV, bougie, feu
• Réglages fins : vitesse, intensité, chaos, dérive, couleurs ; mémoires d'effets
• Stroboscope régulier ou aléatoire, jusqu'à 30 Hz

MÉDIAS
• Pool d'images et de vidéos à afficher sur l'écran de jeu
• Lecture en boucle, une fois puis pause, ou une fois puis noir
• Média suivant depuis la télécommande ou d'un simple toucher sur l'écran de jeu
• Les médias partent directement vers l'écran appairé et y restent en cache le temps de la session

ÉCRANS D'ACCESSOIRE
• Écran d'appel entrant ou de notification de message entièrement fictif, au style neutre (Verre, Tonal, Épuré), pour les scènes où un personnage reçoit un appel : vous choisissez le nom, la photo, le texte, la sonnerie et la bande son au décroché.
• Aucun appel, SMS ou notification système réel n'est émis. SetRemote n'accède ni à vos contacts ni à votre journal d'appels.

TORCHE ET VIBREUR (selon l'appareil utilisé comme écran de jeu)
• Torche LED : marche/arrêt, intensité, effets, synchronisation avec le stroboscope
• Vibrations courtes, longues ou en motif

PROJETS
• Exportez un projet (réglages et mémoires), avec ou sans ses médias.

[OPTIONNEL : PASSERELLE DMX (app iPhone, iPad et Android) — la télécommande reçoit le sACN ou l'Art-Net de votre console sur le réseau local et pilote les écrans de jeu patchés.]

CONFIDENTIALITÉ
• Tout ce qui passe entre vos deux appareils est chiffré de bout en bout (AES-256-GCM).
• Le serveur relais transmet des messages chiffrés et ne stocke rien.
• Pas de compte, pas de publicité, pas de mesure d'audience, pas de suivi.

AVERTISSEMENT PHOTOSENSIBILITÉ
Le stroboscope et certains effets produisent des lumières clignotantes rapides pouvant provoquer des crises chez les personnes photosensibles. Un avertissement s'affiche avant l'activation du stroboscope et des effets à flashs rapides. Prévenez les personnes présentes sur le plateau.

Respectez le droit à l'image et le droit d'auteur des contenus que vous diffusez.
```

<!-- id=desc.en max=4000 -->
```text
SetRemote turns a phone or tablet into a light source and a prop screen for your shoots, controlled remotely from a second device.

Built for prop masters, sparks, board ops, directors and DPs, SetRemote works with two devices:
• the remote, which stays in your hand;
• the playback screen, placed in the set or used as a small source.

Pair them by scanning a QR code or typing a short code. No account needed.

COLOR AND LIGHT
• Master dimmer and playback-screen brightness
• Color temperature from 1,700 K to 20,000 K, plus green/magenta tint
• Color wheel, HUE or RGB, with a white ↔ color crossfade
• Color cues: record, recall and update
• Instant blackout from the remote

EFFECTS LAB
• Chaser (bar, circle or diamond; loop, bounce, wing), noise, aurora, caustics
• BPM pulse with tap tempo, passing headlights, welding, faulty neon, police lights, lightning, flash bursts
• TV flicker, candle, fire
• Fine control: speed, intensity, chaos, drift, colors; effect cues
• Regular or random strobe, up to 30 Hz

MEDIA
• A pool of images and videos to show on the playback screen
• Loop, play once then hold, or play once then black
• Next item from the remote or with a tap on the playback screen
• Media goes straight to the paired screen and stays cached there for the session

PROP SCREENS
• A fully fictional incoming-call or message-notification screen in neutral styles (Glass, Tonal, Minimal) for scenes where a character gets a call: you choose the name, photo, text, ringtone and the audio played on pick-up.
• No real call, text message or system notification is ever sent. SetRemote does not access your contacts or call log.

TORCH AND VIBRATION (depending on the device used as the playback screen)
• LED torch: on/off, intensity, effects, sync with the strobe
• Short, long or patterned vibrations

PROJECTS
• Export a project (settings and cues), with or without its media.

[OPTIONAL: DMX GATEWAY (iPhone, iPad and Android app) — the remote receives sACN or Art-Net from your lighting console on the local network and drives the patched playback screens.]

PRIVACY
• Everything sent between your two devices is end-to-end encrypted (AES-256-GCM).
• The relay server forwards encrypted messages and stores nothing.
• No account, no ads, no analytics, no tracking.

PHOTOSENSITIVITY WARNING
The strobe and some effects produce rapid flashing lights that may trigger seizures in people with photosensitive epilepsy. A warning is shown before the strobe or a fast-flashing effect is turned on. Warn everyone on set.

Respect image rights and copyright for the content you display.
```

### 1.6 Catégories et classification

| Champ | FR / EN |
|---|---|
| Catégorie principale | **Photo et vidéo** / Photo & Video |
| Catégorie secondaire | **Utilitaires** / Utilities |
| Classification | **4+** (détail des réponses dans `app-store-privacy.md`, partie E) |
| Prix | Gratuit, sans achat intégré |

### 1.7 Notes de version 1.0 (« Nouveautés »)

<!-- id=apple.whatsnew.fr max=4000 -->
```text
Première version : lumière CCT/tint/couleur, laboratoire d'effets, stroboscope avec avertissement photosensibilité, pool média, écrans d'accessoire fictifs, export de projet, chiffrement de bout en bout.
```
<!-- id=apple.whatsnew.en max=4000 -->
```text
First release: CCT/tint/color lighting, effects lab, strobe with photosensitivity warning, media pool, fictional prop screens, project export, end-to-end encryption.
```

---

## 2. Google Play

### 2.1 Titre (≤ 30)

<!-- id=play.title.fr max=30 -->
```text
SetRemote : lumière de plateau
```
<!-- id=play.title.en max=30 -->
```text
SetRemote: Set Light & Props
```

### 2.2 Description courte (≤ 80)

<!-- id=play.short.fr max=80 -->
```text
Pilotez à distance la lumière et les écrans d'accessoire de vos tournages.
```
<!-- id=play.short.en max=80 -->
```text
Control set lighting and prop screens remotely from a second phone or tablet.
```

### 2.3 Description complète (≤ 4000)

Reprendre `desc.fr` / `desc.en` (section 1.5) à l'identique. Les puces « • » et les titres en capitales sont acceptés par Play. N'ajouter ni emoji, ni classement (« n° 1 », « meilleure app »), ni témoignages.

### 2.4 Catégorie, tags, classification

| Champ | Valeur |
|---|---|
| Type | Application |
| Catégorie | **Photographie** / Photography. Alternative : Outils / Tools. |
| Tags (choisis dans la liste Play) | Photographie, Production vidéo et cinéma, ou les tags les plus proches proposés par la console |
| Classification | PEGI 3 / ESRB Everyone, élément interactif « Interaction entre utilisateurs » (voir `google-data-safety.md`, C.6) |
| Public cible | 18 ans et plus |
| Coordonnées | `[EMAIL DE CONTACT]`, `[SITE WEB]`, adresse [ADRESSE] (obligatoire si l'app est monétisée, sinon recommandée) |

---

## 3. Plan des captures d'écran

### 3.1 Règles

- **Ne jamais montrer** l'onglet Appel ni les écrans d'appel, de notification ou d'écran verrouillé fictifs.
- Aucun logo ou nom de marque : ni dans les médias affichés, ni dans le décor, ni sur les projecteurs à l'image. Pas de barre d'état indiquant un opérateur.
- N'utiliser que des images et vidéos **dont l'éditeur détient les droits**. Aucune personne identifiable sans autorisation écrite.
- **Ne pas capturer** l'encart « Non disponible sur iPhone » de l'onglet Flash : il nomme des plateformes (guideline 2.3.10).
- Pas de stroboscope en action. Si l'onglet strobe est montré, l'avertissement photosensibilité doit être visible ou mentionné dans la légende.
- Play : pas de cadre d'appareil d'une autre plateforme. Le plus simple est de ne mettre aucun cadre.
- Légendes courtes, au-dessus de l'image, en FR et en EN (ci-dessous).

### 3.2 Formats

| Store | Jeu | Taille de base |
|---|---|---|
| App Store | iPhone 6,9" (obligatoire) | 1320 × 2868 portrait (acceptés aussi : 1290 × 2796, 1260 × 2736) |
| App Store | iPad 13" (obligatoire car `supportsTablet: true`) | 2064 × 2752 portrait, ou 2752 × 2064 paysage pour l'écran de jeu |
| Google Play | Téléphone | 1080 × 1920 minimum conseillé (9:16), 2 à 8 captures |
| Google Play | Tablette 7" et 10" | 1200 × 1920 / 1600 × 2560, recommandées |
| Google Play | Image de présentation | 1024 × 500 (obligatoire) |

Vérifier les tailles exactes dans App Store Connect au moment de l'envoi. Elles évoluent ; sources : guides tiers consultés le 2026-10-14.

### 3.3 Liste des plans (8 captures, ordre de la fiche)

| # | Écran à capturer | Mise en scène | Légende FR | Légende EN |
|---|---|---|---|---|
| 1 | Télécommande, onglet **Couleur** : roue chromatique, curseur CCT, aperçu | À côté, ou en incrustation, l'écran de jeu allumé en 3200 K dans un décor nocturne | Votre téléphone devient une source de lumière | Your phone becomes a light source |
| 2 | Onglet **Couleur**, section Température et Tint | Puces 2700K / 5600K visibles, tint ±GM | CCT de 1 700 à 20 000 K, tint vert/magenta | CCT from 1,700 to 20,000 K, green/magenta tint |
| 3 | Onglet **Effets** : grille du laboratoire, effet « Feu » ou « Flicker TV » actif | Écran de jeu montrant le feu sur un visage de figurant **autorisé**, ou sur un objet | 14 effets prêts pour le plateau | 14 set-ready effects |
| 4 | Panneau de réglages d'un **chaser** (forme, course, wing) | Tablette en écran de jeu montrant les bandes | Chaser, pulse BPM, tap tempo | Chaser, BPM pulse, tap tempo |
| 5 | Onglet **Média** : pool avec 4 à 6 vignettes, une en diffusion | Tablette en écran de jeu affichant une image libre de droits (faux écran de surveillance, affiche…) | Envoyez images et vidéos à l'écran de jeu | Send images and videos to the playback screen |
| 6 | **Mémoires** de couleur ou d'effets (4 à 6 cues) | — | Enregistrez et rappelez vos cues | Record and recall your cues |
| 7 | Écran d'**appairage** : QR code et code court | Deux appareils côte à côte | Appairage en un scan, chiffré de bout en bout | One-scan pairing, end-to-end encrypted |
| 8 | **Écran de jeu** plein écran, en paysage, sur iPad | Effet « Aurore » ou couleur saturée dans un décor | Un écran de jeu pour vos accessoires | A playback screen for your props |

Pour l'iPad, reprendre les plans 1, 3, 5 et 8, avec l'iPad en **écran de jeu** et en télécommande.

Image de présentation Play (1024 × 500) : fond noir, un téléphone qui éclaire un décor en lumière chaude, le logo SetRemote, et le texte « Lumière et écrans de plateau ». Pas de faux appel, pas de marque.

### 3.4 Vidéo d'aperçu (facultative)

App Store : 15 à 30 s, sans écran d'appel. Reprendre les plans 1, 3, 5 et 8 du script de `app-review-notes.md`, section 6.

---

## 4. Contrôle des longueurs

Tableau généré automatiquement à partir des blocs ci-dessus. « Car. » = caractères Unicode, « Octets » = octets UTF-8. Les mots-clés Apple restent sous 100 octets par prudence.

<!-- LENGTH-TABLE-START -->
| Champ | Car. | Octets | Limite | Statut |
|---|---|---|---|---|
| `apple.name` | 9 | 9 | 30 | OK |
| `apple.name.alt1` | 17 | 17 | 30 | OK |
| `apple.name.alt2` | 30 | 33 | 30 | OK |
| `apple.name.alt3` | 14 | 15 | 30 | OK |
| `apple.name.alt1.en` | 19 | 19 | 30 | OK |
| `apple.name.alt2.en` | 29 | 31 | 30 | OK |
| `apple.subtitle.fr` | 28 | 30 | 30 | OK |
| `apple.subtitle.en` | 27 | 27 | 30 | OK |
| `apple.subtitle.alt.fr` | 26 | 29 | 30 | OK |
| `apple.subtitle.alt.en` | 28 | 28 | 30 | OK |
| `apple.promo.fr` | 167 | 174 | 170 | OK |
| `apple.promo.en` | 150 | 150 | 170 | OK |
| `apple.keywords.fr` | 91 | 96 | 100 (100 octets) | OK |
| `apple.keywords.en` | 88 | 88 | 100 (100 octets) | OK |
| `desc.fr` | 3024 | 3165 | 4000 | OK |
| `desc.en` | 2596 | 2648 | 4000 | OK |
| `apple.whatsnew.fr` | 203 | 208 | 4000 | OK |
| `apple.whatsnew.en` | 165 | 165 | 4000 | OK |
| `play.title.fr` | 30 | 31 | 30 | OK |
| `play.title.en` | 28 | 28 | 30 | OK |
| `play.short.fr` | 74 | 77 | 80 | OK |
| `play.short.en` | 77 | 77 | 80 | OK |
<!-- LENGTH-TABLE-END -->

# Tourner sans réseau : Wi-Fi local, Bluetooth et préparation des écrans

Maquettes validées : **10 · Préparer le tournage hors ligne** (vue « Tourner
sans réseau »), **13 · Réglages** (ligne « Liaison par défaut »), **4 ·
Indicateur de liaison** (pastilles « Wi-Fi local » et « Bluetooth ») et **5 ·
Écrans connectés** (liaison de chaque écran).

Côté page (PWA, `web/`) :

| Fichier | Rôle |
|---|---|
| `web/js/21-links.js` | liaisons locales : pont `link:*`, choix de liaison, envoi et routage par liaison, liaison de chaque écran |
| `web/js/20-mqtt.js` | session chiffrée : Internet séparé (`internetConnect`), chaque trame sur toutes les liaisons (`_transmit`), réception commune (`receiveFrame`), doublons et ordre |
| `web/js/32-status.js` | pastille (5 états de la maquette 4), liste des écrans appairés |
| `web/js/93-offline.js`, `web/styles/93-offline.css` | vue « Tourner sans réseau » et moteur de préparation |
| `web/js/00-native-bridge.js` | aiguillage des messages de la coque |

La coque native (`expo-app/`) implémente l'autre moitié du contrat (§ 2).

---

## 1. Principe

Les trames sont **exactement** celles de la session chiffrée de bout en bout
(`packages/protocol`, AES-256-GCM, anti-rejeu, schéma strict). La coque ne fait
que les porter entre appareils proches : elle ne voit, comme le broker MQTT,
qu'un topic opaque et des octets chiffrés. Rien ne change dans le modèle de
menace (README du protocole, § 2), sinon que les voisins radio voient la salle
(topic opaque) et la cadence des trames.

Chaque trame scellée part sur **toutes** les liaisons ouvertes :

```
                 ┌──── Internet (broker MQTT ou relais, 20-mqtt.js / 19-relay.js)
seal(msg) ──────►├──── Wi-Fi local  (link:send, ≤ 64 Kio)
                 └──── Bluetooth    (link:send, ≤ 4 Kio, commandes seulement)

réception : MQTT, link:frames (lan / ble) ──► receiveFrame() ──► ch.receive() ──► dispatchMessage()
                                                                (anti-rejeu : le 2e exemplaire est écarté)
```

Sans liaison locale ouverte (navigateur, choix « Internet », coque sans
liaison), le chemin Internet est **inchangé** : mêmes envois, mêmes contrôles.

## 2. Contrat du pont (coque ⇄ page)

Même pont que la passerelle DMX (`docs/DMX-NATIVE.md`) : la page appelle
`nativePost(msg)` (`window.ReactNativeWebView.postMessage(JSON)`), la coque
appelle `window.SRNative.receive(msg)` (objet ou chaîne JSON).

### 2.1 Page → coque

| Message | Champs | Sens |
|---|---|---|
| `link:start` | `modes: ['lan' \| 'ble', …]`, `role: 'remote' \| 'screen'`, `room: string` (22 car.), `name?: string` | Ouvre **ou remplace** les liaisons locales de la session courante. La télécommande héberge / scrute, les écrans s'annoncent / cherchent. Un nouvel appel remplace le précédent (modes ET salle). |
| `link:stop` | `modes?: [...]` | Ferme les liaisons citées, ou toutes. |
| `link:send` | `frames: [string]`, `to?: [peerId]` | Trames à remettre. `to` : identifiants de `link:peers` ; absent = tous les pairs. |
| `link:state?` | — | Demande un `link:state`. |

Précisions côté page :

- **`room`** = `_sec.topic`, topic opaque de la session (HKDF du secret,
  128 bits en base64url, **22 caractères**). Deux appareils ne se relient que
  s'ils ont la même salle : seuls les appareils de la même session se
  trouvent. Après un retrait d'écran (§ 8), la nouvelle session est annoncée
  par un nouveau `link:start`.
- **`name`** n'est **pas** envoyé : le nom d'un écran (« Téléphone de Julie »)
  serait diffusé en clair par radio ; la télécommande reconnaît chaque pair
  par ses trames authentifiées.
- **`link:send` : une trame par message** (`frames` d'un élément). La page ne
  passe jamais à la coque une trame qu'une liaison visée ne peut pas porter :
  - Bluetooth : ≤ **4 096** caractères et jamais de média (§ 4) ;
  - Wi-Fi local : ≤ **65 536** caractères.
  Quand une trame est interdite au Bluetooth, la page donne **toujours** un
  `to` explicite (pairs Wi-Fi local seulement) ; `to` n'est omis que pour une
  trame acceptée par toutes les liaisons et adressée à tous les pairs.
- La **télécommande** restreint `to` aux pairs des écrans visés (`target`)
  quand elle les connaît (appris des trames authentifiées) ; sinon elle
  envoie à tous (les écrans filtrent eux-mêmes ce qui ne leur est pas adressé).
- Un **écran** utilise aussi `to` (pour réserver au Wi-Fi local un `caps`
  volumineux ou la signalisation WebRTC) : **la coque doit honorer `to` dans
  les deux rôles**.

### 2.2 Coque → page

| Message | Champs |
|---|---|
| `link:frames` | `frames: [{ peer, mode: 'lan' \| 'ble', data: string }]` |
| `link:peers` | `peers: [{ peer, mode, name? }]` — liste complète, **à chaque changement** |
| `link:state` | `lan: { available: boolean, active: boolean, error?: string }`, `ble: { … }` |
| `link:error` | `mode`, `reason` |

Attentes de la page (à respecter par la coque) :

- **Identifiants de pairs distincts par liaison.** Un même appareil joint en
  Wi-Fi local et en Bluetooth apparaît deux fois, avec deux `peer` différents
  (par ex. `lan:…` et `ble:…`). Un identifiant présent sur les deux liaisons
  est ambigu : la page ne lui envoie alors plus aucune trame interdite au
  Bluetooth (médias, > 4 Kio), même en Wi-Fi local.
- **Topologie en étoile** : un écran n'a pour pairs que des télécommandes de la
  même salle (pas les autres écrans).
- **Ordre** : les trames d'une même liaison arrivent dans l'ordre d'envoi
  (Wi-Fi local : flux type TCP ; Bluetooth : écriture avec accusé, ou
  numérotation). Une perte est tolérée (§ 3.3), un désordre au sein d'une
  liaison ne l'est pas pour les fragments de médias.
- `link:peers` arrive aussi après chaque `link:start` (salle changée : liste
  vide, puis les nouveaux pairs). `link:state` répond à `link:start`,
  `link:stop` et `link:state?`, et suit tout changement (Bluetooth coupé,
  autorisation retirée…).
- La page ignore une trame plus longue que le plafond de sa liaison, et au plus
  512 trames par `link:frames`.
- Défense en profondeur souhaitée : la coque refuse elle aussi toute trame de
  plus de 4 Kio vers un pair Bluetooth.

## 3. « Auto » : liaisons en parallèle

### 3.1 Choix (télécommande, mémorisé : `setremote-link-v1`)

| Choix | Internet | Wi-Fi local | Bluetooth |
|---|---|---|---|
| **Auto** (défaut) | oui | oui (si l'app le permet) | oui (si l'app le permet) |
| Internet | oui | — | — |
| Wi-Fi local | — | oui | — |
| Bluetooth | — | — | oui (commandes seulement) |

Un **écran** ouvre toujours Internet **et** toutes les liaisons locales de
l'app : il suit la télécommande quel que soit son choix (il n'a pas de
réglage). Un choix forcé (« Wi-Fi local », « Bluetooth ») ferme Internet sur
la télécommande : rien ne sort du plateau. Une liaison que la coque déclare
indisponible (`available: false`) est grisée et signalée dans la vue.

Garde-fou : une liaison locale ne peut être choisie seule, et Internet n'est
fermé, **qu'une fois que la coque l'a déclarée disponible** (`available:
true`). Une coque d'avant ces liaisons (qui ne répond jamais) ou une liaison
coupée ne laissent donc jamais la télécommande reliée à rien : Internet reste
ouvert, les boutons restent grisés. En « Auto », une liaison encore inconnue
est demandée quand même (`link:start`) : la coque répondra par son état.

### 3.2 Pourquoi en parallèle

La maquette dit « Auto : Internet si disponible, sinon Wi-Fi local, sinon
Bluetooth (commandes uniquement) ». Deux lectures possibles :

1. **repli séquentiel** : n'ouvrir le Wi-Fi local qu'après avoir constaté la
   perte d'Internet, puis le Bluetooth après celle du Wi-Fi ;
2. **liaisons en parallèle**, la **priorité** ne servant qu'à l'**affichage**
   et au **choix des chemins pour les médias**.

SetRemote retient la seconde :

- **Aucune coupure visible.** Constater une perte prend du temps (le relais
  déclare un lien mort après 70 s de silence, un écran est déclaré muet après
  40 s, mqtt.js retente toutes les 3 s). Pendant ce temps, en repli
  séquentiel, les ordres partiraient dans le vide : en plein « Moteur ! », un
  noir ou un appel arriverait en retard ou jamais. En parallèle, l'ordre est
  déjà arrivé par la liaison locale.
- **Pas de découverte à froid.** Ouvrir une liaison locale (Bonjour/mDNS,
  scan Bluetooth, appairage radio) prend plusieurs secondes ; tenue ouverte,
  elle est prête au moment où le Wi-Fi du lieu ou la 4G lâche.
- **Gratuit pour la fiabilité** : la fenêtre anti-rejeu du protocole (1 024
  séquences par émetteur) écarte déjà les doublons ; rien n'est appliqué deux
  fois (§ 3.3).
- **Coût maîtrisé** : une trame de commande fait ~100 à 600 octets ; les
  médias ne vont jamais en Bluetooth ; la télécommande adresse ses trames aux
  seuls écrans visés.

« Internet si disponible, sinon… » reste vrai pour ce que l'utilisateur voit :
la pastille et la liste des écrans montrent Internet tant qu'il relie l'écran,
sinon le Wi-Fi local, sinon le Bluetooth.

### 3.3 Doublons et ordre

- **Doublons** : le même texte de trame (même émetteur, même n° de séquence)
  arrive par 2 ou 3 liaisons ; le premier exemplaire est ouvert et appliqué,
  les suivants sont refusés par l'anti-rejeu (`replay`, comptés dans
  `secStats.duplicates`). La télécommande authentifie tout de même un doublon
  (sans toucher à la fenêtre, au plus toutes les 2 s par liaison) pour noter
  que cette liaison relie l'écran.
- **Ordre entre liaisons** : chaque liaison livre dans l'ordre, mais deux
  liaisons peuvent se doubler (trame perdue en Bluetooth, rattrapée plus tard
  par Internet). Pour les états où « le dernier gagne » (`color`, `strobe`,
  `effect`, `blackout`, `screen:brightness`, torche, `media:autoadvance`,
  `media:endmode`, `dmx:look`, `media-progress`, `call:state`), une trame d'un
  n° de séquence inférieur au dernier appliqué (même émetteur, même type) est
  ignorée (`lastError = 'order'`).

### 3.4 Liaison affichée

Télécommande : chaque trame authentifiée d'un écran note la liaison qui l'a
portée (y compris un doublon) ; un écran émet un signe de vie toutes les 15 s
sur toutes ses liaisons. Liaison d'un écran = Internet s'il est relié par
Internet (et la télécommande aussi), sinon Wi-Fi local, sinon Bluetooth ;
« Hors ligne » après 40 s sans rien. La pastille montre la liaison **la plus
faible** encore en service (« Bluetooth » dès qu'un écran n'est plus relié
qu'en Bluetooth : ses médias doivent être préparés), « Hors ligne · n écran(s) »
si l'un est muet, « Reconnexion… » sans aucune liaison.

## 4. Bluetooth : commandes seulement

Ne passent **jamais** en Bluetooth (`LINK_MEDIA_TYPES`) : `media-img-start`,
`media-img-chunk`, `media:upload`, `media:chunk`, `media:play`,
`media:chunkack`, `media:need-chunks`, `rtc-offer`, `rtc-answer`, `rtc-ice`,
ni aucune trame de plus de 4 096 caractères.

Passent : couleur, effets, stroboscope, noir, luminosité, torche, vibreur,
`media:show` d'un média **déjà en cache**, lecture / pause / position d'une
vidéo en cache, `call:start` / `call:answer` / `call:end` avec sons et photos
**déjà en cache**, looks DMX, `hello` / `caps` / signes de vie, échanges de
clés et retrait.

Quand le Bluetooth est la seule liaison :

- `sendMsg` n'envoie aucun média (il ne partirait nulle part) ;
- onglet Média : « ⚠ Bluetooth : « nom » n'est pas préparé sur l'écran — il
  faut Internet ou le Wi-Fi local » ; l'état attendu est gardé et le média
  part dès le retour d'une liaison à haut débit (resynchronisation) ;
- un appel non préparé sonne sans photo ni bande son (jamais celles d'un autre
  appel restées en cache) ; un son importé absent est remplacé par le son
  intégré ;
- un `caps` trop long pour 4 Kio part sans la liste du cache (la télécommande
  garde celle de la dernière annonce).

## 5. Préparation des écrans

### 5.1 Ce qu'un écran doit avoir

| Élément | Id en cache sur l'écran |
|---|---|
| médias du pool (images, vidéos) | `m1`, `m2`… |
| sonneries / sons de notification importés (choix de chaque type, sons des appels et SMS enregistrés) | `__ring_<16 hex>` |
| photo de chaque appel / SMS enregistré | `__ph_<40 hex>` (SHA-256 du contenu) |
| bande son de chaque appel enregistré | `__au_<40 hex>` |
| fond de l'écran verrouillé | `__lockwall` |

Ce qui manque à chaque écran se lit dans son état (`28-screens.js` : liste
exacte de son cache annoncée par `caps`, accusés `media:cached`).

### 5.2 « Tout préparer maintenant »

Pour chaque élément, aux seuls écrans joignables à haut débit (Internet ou
Wi-Fi local) qui ne l'ont pas : envoi adressé, puis attente de l'accusé
(délai proportionnel à la taille ; arrêt dès que la liaison de l'écran tombe).
Petits éléments d'abord (fond, sons, photos), puis images, puis vidéos (une
par écran, pair-à-pair WebRTC, sinon fragments).

Rien ne s'affiche ni ne s'interrompt sur les écrans : images et sons avec
`show: false` (existant), vidéos avec une offre WebRTC `kind: 'cache'` (la
vidéo affichée n'est pas mise en pause) et `{ meta, show: false }` sur le
canal de données, ou `media:upload { show: false }` en fragments. Une
diffusion lancée par l'utilisateur vers un écran passe avant (la préparation
attend, ou cède sa place).

États de la maquette 10 : **Prêt** (vert), **NN %** (orange, transfert en
cours, « 12/18 médias · transfert en cours »), **Non préparé** (gris).
États ajoutés (non dessinés) : **Incomplet** (gris, une partie seulement,
« 12/18 médias · manque sonnerie, fond d'écran »), **Interrompu** (rouge,
liaison perdue pendant la préparation), détails « Ouvrez SetRemote sur « … »
pour lancer la préparation » (écran hors ligne), « Bluetooth seul : il faut
Internet ou le Wi-Fi local pour le préparer », bouton « PRÉPARATION EN
COURS… » / « TOUT EST PRÊT » et note quand aucune liaison à haut débit n'existe.

### 5.3 Appel préparé

`call:start` gagne deux champs facultatifs (schéma, `packages/protocol`) :
`photoId` (`__ph_…`) et `audioId` (`__au_…`). La télécommande ne les envoie
qu'aux écrans qui ont **accusé** ces deux éléments ; les autres reçoivent
l'appel comme avant (photo `__callphoto` et bande son `__callaudio` envoyées
juste avant). Un appel préparé ne transporte donc que des ids : il part même
en Bluetooth, y compris depuis la console DMX (entrées 1 à 20).

**Compatibilité** : les ids préparés font 45 caractères ; un écran d'une
version antérieure n'accepte en cache que des ids de 40 caractères au plus.
Il ne les accuse donc jamais et ne reçoit jamais `photoId` / `audioId` (qu'il
refuserait). `rtc-offer.kind: 'cache'` et `media:upload.show` sont refusés par
un tel écran : sa vidéo n'est simplement pas préparée (rien ne s'affiche).

### 5.4 Règles d'éviction côté écran (vérifiées)

Le cache d'un écran (`_mediaCache`, 75-media-screen.js) vit **en mémoire,
pour toute la session** : il n'est vidé que par un `media:evict` explicite de
la télécommande (média retiré du pool, son supprimé, bande son du formulaire
retirée) ; un changement de session après un retrait d'écran le garde. Les
éléments préparés ne sont jamais évincés implicitement.

Ajusté : les transferts d'images / sons **simultanés** étaient plafonnés à 4,
le plus ancien abandonné au-delà ; la préparation s'ajoutant à la
resynchronisation et aux diffusions, le plafond passe à **6** et c'est le
transfert **le plus inactif** (aucun fragment reçu depuis le plus longtemps)
qui cède sa place, plus celui qui reçoit encore.

Non changé, volontairement : le cache n'est **pas** écrit sur le disque de
l'écran. La politique de confidentialité (`confidentialite.html` § 3) promet
que les médias reçus restent en mémoire et disparaissent à la fermeture de
l'app ; un écran dont l'app est fermée (ou tuée par le système) doit être
préparé de nouveau, ce que la vue montre (« Non préparé ») dès son retour.
La ligne « Purger les médias des écrans » de la maquette 13 reste donc sans
objet.

## 6. Navigateur seul

Hors de l'app native (`IN_NATIVE_APP` faux) : aucun message `link:*`,
« Wi-Fi local » et « Bluetooth » grisés dans la vue, encadré « 📶 Nécessite
l'app SetRemote » (même présentation que la passerelle DMX). « Auto » y vaut
Internet seul. La préparation fonctionne par Internet.

## 7. Appairage

- **QR code** : le secret de session est **dans** le QR. Scanné avec le
  scanner intégré de l'app (Écran projecteur → caméra), il ne demande aucun
  réseau : l'écran ouvre aussitôt ses liaisons locales dans la salle de la
  session et rejoint la télécommande en Wi-Fi local ou en Bluetooth, même sans
  Internet ; la clé par écran (29-revoke.js) s'établit par la même liaison.
  C'est le **premier appairage sans Internet** (testé). Scanné avec
  l'appareil photo du téléphone, le QR ouvre la version web : dans un
  navigateur, il faut Internet.
- **Code à 6 caractères** : le rendez-vous (commit / key / reveal / session)
  passe par Internet. Le porter en local demanderait que la télécommande soit
  à la fois dans la salle de sa session et dans celle du rendez-vous, or
  `link:start` n'ouvre qu'**une** salle. **Limitation** : l'appairage par
  code exige Internet. Évolution possible du contrat : `link:start { room,
  rooms?: [rendezvous] }` ou un `link:rdv { room }` éphémère ; la page
  réutiliserait alors `26-pairing.js` tel quel (messages en clair validés par
  `SRP.validateRendezvousMessage`, comme sur le relais).

## 8. Retrait d'un écran et nouvelle session

Le retrait (29-revoke.js) fonctionne en Wi-Fi local comme par Internet :
`screen:revoked` (adressé aux pairs de l'écran retiré), `session:rekey`
(scellé avec la clé de chaque écran) et les accusés `rekey:ok` passent par
toutes les liaisons ; l'écran qui suit, puis la télécommande, passent sur la
nouvelle session et l'annoncent à la coque par `link:start` (nouvelle
`room`). L'écran retiré ferme ses liaisons (`link:stop`).

**Limitation** : l'écoute de l'ancien topic pendant 24 h (écran absent
pendant le retrait) passe par Internet seulement, la coque n'ayant qu'une
salle. Un écran absent qui revient **sans Internet** reste dans l'ancienne
salle et n'est pas remis à niveau : il faut Internet (ou le réappairer par QR).

## 9. Limites connues

- Liaison affichée : la perte d'Internet **côté télécommande** est vue
  aussitôt ; côté écran, elle l'est au plus 40 s après (signes de vie).
- Le `name` des pairs n'est ni envoyé ni utilisé (§ 2.1).
- Une liste `caps.cached` ne dépasse pas 500 ids (schéma) : au-delà, la
  télécommande croirait manquer des éléments en fait présents.
- Le fond verrouillé n'a qu'un emplacement (`__lockwall`) : un écran dont la
  télécommande a été relancée depuis l'envoi est réputé à jour s'il en a un.
- Seuls les appels **enregistrés** ont photo et bande son préparées ; ceux du
  formulaire gardent l'emplacement unique `__callphoto` / `__callaudio`
  (annoncés en Bluetooth seulement si chaque écran visé a déjà ceux-là).
- Version mixte : un écran d'une version antérieure n'est pas préparé pour les
  appels ni les vidéos (§ 5.3).
- La politique de confidentialité ne décrit pas encore les liaisons locales
  (trames chiffrées échangées en Wi-Fi local / Bluetooth, salle visible des
  voisins radio) ni les autorisations « réseau local » et « Bluetooth » que la
  coque demandera : à compléter avec la coque.

## 10. Tests

`tests/offline.test.mjs`, avec un faux pont (`tests/helpers/links.mjs`) qui
relie les pages entre elles en Wi-Fi local et en Bluetooth (plafond 4 Kio,
`link:peers`, `link:state`, coupures par liaison et par appareil) :

- Internet coupé, Wi-Fi local actif : commandes, médias, liaison par écran ;
- Bluetooth seul : commandes oui, médias non, trames trop grandes refusées
  avant l'envoi ;
- la même trame par Internet, Wi-Fi local et Bluetooth n'est appliquée qu'une
  fois ; ordre gardé entre liaisons ;
- Auto : bascule Internet → Wi-Fi local → Bluetooth → Internet ; liaison
  forcée ; Internet seul ;
- préparation : seul ce qui manque part, progression, rien d'affiché ; puis en
  Bluetooth, appel préparé et vidéo préparée ;
- navigateur seul ; réglage persistant ; retrait d'un écran en Wi-Fi local ;
  premier appairage par QR sans Internet.

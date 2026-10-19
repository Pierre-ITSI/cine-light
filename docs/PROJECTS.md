# Projets SetRemote (`.setremote`) : export, import, projets locaux

Moteur : `web/js/72-project.js` (télécommande). Nouvelle séquence / nouvelle
discussion : `seqNew` (`web/js/96-sequences-saved.js`), `chatNew`
(`web/js/89-discussions-saved.js`). Coque native : `expo-app/src/lib/projectFiles.ts`.
Tests : `tests/project.test.mjs`, `expo-app/test/project-files.test.mjs`.

**État : moteur seulement.** Aucun bouton ni aucune vue dans l'app : l'interface
(Réglages › Projet, feuilles d'export / d'aperçu / de compte rendu, liste des
projets, « + Nouvelle séquence », « + Nouvelle discussion ») attend la
validation des maquettes 45 à 47b.

## 1. Ce qu'est un projet

Tout ce qu'une télécommande a préparé pour une production, pour le passer à une
autre télécommande, l'archiver, ou tenir plusieurs productions sur le même
téléphone.

| Section    | Contenu                                                                                      | Source                                  |
|------------|----------------------------------------------------------------------------------------------|-----------------------------------------|
| `seq`      | séquences enregistrées : étapes, cibles, départs, « Téléphone au départ », images d'accueil (déverrouillage) et fond d'écran | `96-sequences-saved.js`, `91-sequence.js` |
| `chat`     | discussions enregistrées : contact, comédien, style, messages et timings, photo du contact   | `89-discussions-saved.js`               |
| `calls`    | appels, SMS, notifications enregistrés : noms, textes, style, son (intégré ou importé, volume, vibreur), photo / icône, bande son | `82-call-list.js` |
| `callers`  | appelants enregistrés, photos                                                                | `79-callers.js`                         |
| `rings`    | sons importés (bibliothèque commune) et choix par type (son, volume, vibreur)                 | `81-ringtones.js`                       |
| `memories` | mémoires couleur (avec stroboscope) et mémoires d'effet                                      | `62-memories.js`                        |
| `media`    | pool média (images, vidéos) — **facultatif** à l'export (`includeMedia`), peut être lourd    | `70-media-remote.js` (en mémoire)       |
| `work`     | état de travail : « Séquence en cours » et « Fil en cours » de la discussion, photo du contact | `91-sequence.js`, `83-discussion.js`   |

Choix :
- **Formulaire Tel** (appel / SMS / notification en cours de saisie) : non
  exporté. Il n'est pas enregistré par l'app (mémoire seulement) ; ce qui compte
  est enregistré dans les listes.
- **`work`** est toujours écrit dans le fichier (petit, utile pour « Ouvrir comme
  nouveau projet » et pour changer de projet sans rien perdre) ; à l'import dans
  le projet ouvert, il n'est appliqué que si `sections` le demande
  explicitement (« Ajouter » ne touche jamais la séquence ni le fil en cours).
- **Effets en cours, couleur en cours** : non persistés par l'app, donc non
  exportés ; seules les mémoires le sont.
- Les séquences gardent des **références** vers les autres sections (pas de
  copies) : exporter les séquences sans les appels rend leurs étapes « élément
  introuvable » à l'arrivée (question ouverte : prévenir dans la feuille d'export).

## 2. Inventaire du stockage de `web/js` (octobre 2026)

### localStorage

| Clé                              | Module                     | Contenu                                         | Projet ? |
|----------------------------------|----------------------------|-------------------------------------------------|----------|
| `setremote-session-v1`           | 12-session.js              | **secret** de session de la télécommande         | jamais   |
| `setremote-screen-session-v1`    | 12-session.js              | **secret** de la session rejointe (écran)        | jamais   |
| `setremote-screen-id`            | 12-session.js              | identifiant de cet écran                        | jamais   |
| `setremote-screen-config-v1`     | 12-session.js              | nom et groupes de cet écran                     | jamais   |
| `setremote-remote-id`            | 12-session.js              | identifiant stable de la télécommande           | jamais   |
| `setremote-screen-pairwise-v1`   | 12-session.js / 29-revoke  | **clé par écran** côté écran                    | jamais   |
| `setremote-screens-v1`           | 28-screens.js              | registre des écrans (noms, groupes, **clés par écran**) | jamais |
| `setremote-rekey-v1`             | 29-revoke.js               | anciens topics et **clés** (retrait d'un écran) | jamais   |
| `setremote-licence-v1`           | 14-licence.js              | **jeton** de licence                            | jamais   |
| `setremote-licence-key-v1`       | 14-licence.js              | **clé privée** d'appareil (repli sans IndexedDB) | jamais  |
| `setremote-stats-v1`             | 14-licence.js              | statistiques d'usage du jour                    | jamais   |
| `setremote-link-v1`              | 21-links.js                | liaison par défaut (réglage de l'appareil)      | jamais   |
| `setremote-strobe-warning-v1`    | 46-strobe-warning.js       | « ne plus demander » (par session)              | jamais   |
| `setremote-dmx-v1`               | 86-dmx-gateway.js          | patch DMX par session                           | jamais   |
| `setremote-mediabar-v1`          | 98-phone-params.js         | barre d'état de l'onglet Média (session appairée) | jamais |
| `setremote-lang-v1`              | 92-settings.js             | langue                                          | jamais   |
| `setremote-project-v1`           | 72-project.js              | projet ouvert `{ v, active }`                   | jamais   |
| `setremote-fx-memories`          | 62-memories.js             | mémoires d'effet                                | `memories` |
| `setremote-color-memories`       | 62-memories.js             | mémoires couleur                                | `memories` |
| `setremote-callers-v1`           | 79-callers.js              | appelants enregistrés                           | `callers` |
| `setremote-ring-v1`              | 81-ringtones.js            | choix de son par type                           | `rings`  |
| `setremote-call-list-v1`         | 82-call-list.js            | appels, SMS, notifications enregistrés          | `calls`  |
| `setremote-chat-v1`              | 83-discussion.js           | fil en cours (+ état de reprise sur les écrans) | `work` (sans l'état des écrans) |
| `setremote-chat-avatar-v1`       | 83-discussion.js           | photo du contact du fil en cours                | `work`   |
| `setremote-chat-saved-v1`        | 89-discussions-saved.js    | discussions enregistrées                        | `chat`   |
| `setremote-seq-v1`               | 91-sequence.js             | séquence en cours                               | `work`   |
| `setremote-seq-saved-v1`         | 96-sequences-saved.js      | séquences enregistrées                          | `seq`    |

### IndexedDB

| Base                    | Magasins          | Contenu                                                                                     | Projet ? |
|-------------------------|-------------------|---------------------------------------------------------------------------------------------|----------|
| `setremote-licence`     | (clé d'appareil)  | **clé privée** non extractible de la licence                                                 | jamais   |
| `setremote-ringtones`   | `meta`, `data`    | sons importés (nom, durée… ; data-URL)                                                      | `rings`  |
| `setremote-call-assets` | `assets`          | `<id>:photo`, `<id>:audio` (appels, SMS, notifications) ; `chat-<id>:photo` ; `caller-<id>:photo` ; `seqhome-<empreinte>:photo` (images d'accueil et fonds d'écran) | `calls`, `chat`, `callers`, `seq`, `work` |
| `setremote-projects`    | `meta`, `snap`    | projets locaux (72-project.js)                                                              | —        |

Ni `sessionStorage` ni cookies. Cache Storage : celui du service worker (`sw.js`), coquille de l'app seulement.

## 3. Jamais dans un projet

Secrets et identité : secret de session, secrets d'appairage, clés par écran,
registre des écrans, retraits en cours, identifiant de la télécommande, jeton,
clé et identifiant de licence ; réglages de l'appareil (liaison, langue,
avertissement stroboscope, patch DMX, barre d'état Média, relais).
Liste exacte : `PRJ_NEVER_KEYS` (72-project.js). L'export n'en lit aucune ; en
plus, un garde-fou (`_prjSecretScan`) cherche dans le texte de l'export chaque
secret présent sur l'appareil (champs `key`, `s`, `token`, `d`, `priv`, `ch`,
`channelId` de ces clés, identifiant de la télécommande, identifiant de
licence) et **refuse l'export** (`secret`) s'il en trouve un — par exemple une
clé recopiée dans un message. Test : `tests/project.test.mjs` (« jamais de secret »).

Les écrans, l'appairage et les réglages restent **communs à tous les projets**.

## 4. Format (version 1)

Fichier `Nom.setremote` = ZIP (méthodes 0 « stocké » et 8 « deflate », sans ZIP64,
noms UTF-8) :

```
project.json            { format: "setremote-project", version: 1, app: "1.0.0",
                          created: "2026-10-19T21:00:00.000Z", name: "Tournage B",
                          sections: ["seq","chat","calls","callers","rings","memories","work"],
                          counts: { seq: 4, chat: 3, calls: 8, … }, calls: { call, sms, notif },
                          files: 12, mediaBytes? }
data/seq.json           { list: [séquence enregistrée], images: { <empreinte>: réf } }
data/chat.json          { list: [discussion + photo: réf | null] }
data/calls.json         { call: [...], sms: [...], notif: [...] }  (+ photo, audio : réf | null)
data/callers.json       { list: [{ id, name, label, photo }] }
data/rings.json         { lib: [{ id, name, mime, size, dur, at, file: réf }], settings: { call, sms, notif, discussion } }
data/memories.json      { color: [...], fx: [...] }
data/media.json         { list: [{ id, kind: "img"|"vid", name, file: réf }] }
data/work.json          { seq, chat, avatar: réf | null, images }
files/<sha256>.<ext>    photos, sons, images, médias, dédupliqués par empreinte SHA-256
```

Référence de fichier : `{ "f": "files/<64 hex>.<ext>", "t": "<type MIME>" }`.
Les JSON sont compressés (deflate, fflate) ; les fichiers binaires sont stockés
tels quels quand deflate n'y gagne rien. Sans fflate (fichier absent), l'export
se fait sans compression et la lecture passe par `DecompressionStream`.

Bibliothèque : **fflate 0.8.2** (MIT, `vendor/fflate-0.8.2.min.js`, `umd/index.js`
du paquet npm non modifié, licence `vendor/fflate-LICENSE.txt`, chargée à la
demande comme jsQR, précachée par `sw.js`). Le conteneur ZIP (en-têtes,
répertoire central, CRC-32) est écrit et lu par 72-project.js.

## 5. Import : validation et modes

Validation stricte, rien n'est écrit si le fichier est refusé :
- taille du fichier ≤ 512 Mo, ≤ 4 000 entrées, total décompressé ≤ 512 Mo ;
  par entrée : manifeste 64 Kio, JSON 8 Mo, image 15 Mo, son 12 Mo (sonnerie :
  5 Mo comme `RING_MAX_BYTES` ; bande son : 8 Mo comme `CALL_AUDIO_MAX_BYTES`),
  vidéo 400 Mo (`PRJ_LIMITS`) ;
- CRC-32 vérifié pour chaque entrée lue ; décompression bornée à la taille
  annoncée (bombe → `corrupt`) ; chiffrement, ZIP64, méthode inconnue refusés ;
- chaque élément repasse par la validation de son module (`_sqsvSanitize`,
  `seqSanitizeSteps`, `_chsvSanitize`, `_validCallStart` + `_clSanitize`,
  `_crSanitize`, `_ringSanitizeMeta`, `safeImageData` / `safeAudioData`,
  `phoneBarSanitize`, `seqWallSanitize`) ; mémoires : champs connus bornés
  (curseurs de l'app), effet connu (`EFFECT_CONFIG`), réglages en valeurs simples ;
  sons importés décodés (WebAudio) comme un import à la main ;
- plafonds de l'app : 100 séquences, 100 discussions, 99 entrées par liste,
  50 appelants ; et 200 mémoires de chaque type, 100 sons, 200 médias.

| Mode       | API                         | Effet |
|------------|-----------------------------|-------|
| Ajouter    | `mode: 'merge'` (défaut)    | ajoute à la suite ; id déjà pris → nouvel id, **références des séquences corrigées** (étapes couleur, effet, appel, SMS, notification, appel manqué, discussion, média ; images par empreinte ; son importé par empreinte) ; nom déjà pris → « Nom (2) » ; appelant déjà présent (même nom et sous-titre) et son identique : non dupliqués (`same`) ; au-delà des plafonds : `skipped` |
| Remplacer  | `mode: 'replace'`           | les sections importées sont vidées (photos, sons et images qui ne servent plus effacés) puis chargées ; ids gardés |
| Nouveau projet | `mode: 'new'`           | fichier rangé comme nouveau projet local (§ 7), sans toucher au projet ouvert |

Médias : ids toujours renumérotés (le pool en attribue) ; les étapes Média
suivent. Choix du son par type : remplacé seulement en mode « Remplacer ».

Compte rendu :
```
{ ok: true, mode, name, sections: { calls: { added, removed, skipped, renamed, same }, … },
  warnings: [{ section, code: 'file', name }], preview: ['tel'?, 'seq'?] }
```
Échec : `{ ok: false, code, message }` (§ 8).

**Aperçu sans licence** (77-licence-ui.js) : les données importées sont à
l'utilisateur. Elles sont écrites dans le stockage réel (jamais dans le
masque de démonstration) ; l'aperçu reste affiché (`preview` dans le compte
rendu) et elles apparaissent quand la licence arrive. L'export lit lui aussi
le stockage réel : jamais la démo.

Après l'import : listes relues et redessinées, passerelle DMX resynchronisée
(entrées 1 à 20), pool média réordonné et préchargé sur les écrans.

## 6. Fichiers : web et app native

| | Web | App native (vue web : `<a download>` sans effet) |
|-|-----|------|
| Enregistrer | `projectSave(blob, nom)` → téléchargement `Nom.setremote` (URL blob) | pont `project:save` → fichier temporaire (`cache/projets/`), feuille de partage (expo-sharing) |
| Choisir | `projectPick()` → `<input type=file accept=".setremote,application/zip">` | pont `project:open` → sélecteur de fichier (`File.pickFileAsync` d'expo-file-system) |

Pont, par morceaux de `PRJ_CHUNK` = 512 Kio de caractères base64 (multiple de 4
sauf le dernier), dans l'ordre, fichier ≤ 256 Mo :

```
page → coque  { type: 'project:save', id, name, size, i, n, data }
              { type: 'project:open', id }
coque → page  { type: 'project:saved', id, ok: true, shared: true }
              { type: 'project:file', id, name, size, i, n, data } | { type: 'project:file', id, cancelled: true }
              { type: 'project:error', id, reason }   reason : bad-chunk, too-large, unavailable,
                                                      read-failed, write-failed, share-failed
```

Dépendance ajoutée à la coque (version de l'Expo SDK 56, `bundledNativeModules`) :
`expo-sharing ~56.0.18` (package.json et package-lock mis à jour hors ligne ;
équivalent de `cd expo-app && npx expo install expo-sharing`). Le sélecteur
vient d'expo-file-system (déjà là) : pas besoin d'expo-document-picker. Un
**nouveau build natif** est nécessaire (module natif ajouté).

## 7. Projets locaux

Plusieurs projets sur le téléphone, un seul ouvert. Le contenu du projet
ouvert est l'espace de travail habituel (stockage des modules, § 2) ; les
autres sont rangés comme instantanés `.setremote` (IndexedDB
`setremote-projects` : `meta` `{ id, name, created, updated, size, counts }`,
`snap` : le fichier). Projet ouvert : `setremote-project-v1`.

| API | Effet |
|-----|-------|
| `projectsList()` | `{ ok, active, list: [{ id, name, created, updated, size, counts, active }] }` ; projet ouvert : compteurs actuels. Premier appel : les données existantes deviennent « Mon projet » (migration) |
| `projectCreate({ name, from: 'empty' \| 'current' })` | nouveau projet vide, ou copie du projet ouvert ; ne l'ouvre pas |
| `projectSwitch(id)` | instantané du projet ouvert rangé, puis chargement du projet visé (chemin de l'import « Remplacer » ; sections absentes vidées). Échec : l'espace de travail quitté est rétabli |
| `projectRename(id, nom)`, `projectDuplicate(id)`, `projectDelete(id)` | supprimer le projet ouvert : refusé (`active`) |
| `projectExportStored(id)` | `{ ok, name, blob }` sans ouvrir le projet |
| `projectImport(file, { mode: 'new' })` / `projectImportAsNew(file)` | fichier validé puis rangé comme nouveau projet |

Choix :
- **Pool média** : commun, hors projets (il ne vit qu'en mémoire, le temps de
  la session) ; un changement de projet le laisse tel quel.
- **Refus pendant le jeu** (`busy`) : séquence lancée (en cours ou arrêtée),
  discussion ouverte sur des écrans, appel en cours sur un écran. Arrêter
  d'abord (Recommencer, fermer la discussion, raccrocher).
- Plafonds : 50 projets, 1 Go d'instantanés (`quota`).
- Une seule opération de projet à la fois (`pending`).

## 8. Codes d'erreur

| Code | Message |
|------|---------|
| `not-zip` | Fichier non reconnu : ce n'est pas un projet SetRemote (.setremote). |
| `not-project` | Ce fichier n'est pas un projet SetRemote. |
| `version` | Ce projet vient d'une version plus récente de SetRemote : mettez l'app à jour pour l'ouvrir. |
| `too-large` | Fichier trop volumineux (plus de {max} Mo). |
| `too-many` | Projet trop gros : trop d'éléments. |
| `corrupt` | Fichier abîmé : le projet ne peut pas être lu. |
| `invalid` | Contenu du projet invalide. |
| `empty` | Rien à importer. |
| `read` | Lecture du fichier impossible. |
| `secret` | Export interrompu : une donnée privée allait y figurer. |
| `storage-full` | Mémoire de l'appareil pleine : l'opération n'a pas pu aller au bout. |
| `busy` | Une séquence, un appel ou une discussion est en cours sur les écrans : arrêtez-les d'abord. |
| `pending` | Une opération sur les projets est déjà en cours. |
| `active` | Le projet ouvert ne peut pas être supprimé : ouvrez-en un autre d'abord. |
| `not-found` | Projet introuvable. |
| `quota` | Plus de place pour les projets : supprimez-en un. |
| `cancelled` | Annulé. |
| `unavailable` | Fonction indisponible sur cet appareil. |
| `timeout` | L'app n'a pas répondu. |

## 9. Nouvelle séquence, nouvelle discussion

- `seqNew(opts)` : repart d'une séquence vide. Modifications non enregistrées
  (`seqHasUnsavedChanges()`) : `{ ok: false, code: 'dirty', name }` tant que
  l'appelant n'a pas choisi `save` (nom, `''` = nom par défaut : enregistrée
  d'abord comme **nouvelle** entrée) ou `discard: true`. Déroulé commencé :
  remis à zéro. Aperçu sans licence : `locked`.
- `chatNew(opts)` : fil vierge (aucun message, contact sans nom ni photo ;
  comédien et style gardés), mêmes règles (`chatHasUnsavedChanges()`),
  discussion ouverte sur les écrans : `live`.
- Dans les deux cas, la nouvelle séquence / le nouveau fil n'est lié à aucune
  entrée enregistrée : l'enregistrer crée une nouvelle entrée, celle chargée
  auparavant reste telle quelle.

## 10. Écritures partielles

Un import valide est écrit section par section. Si la mémoire de l'appareil se
remplit en cours de route (`storage-full`), les sections déjà écrites le
restent. Le changement de projet, lui, rétablit l'espace de travail quitté.

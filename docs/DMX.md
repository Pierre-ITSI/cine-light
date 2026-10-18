# SetRemote — Passerelle DMX : manuel de la fixture « Écran SetRemote »

À l'usage des pupitreurs et des chefs électros. Dernière vérification des
sources : **15 octobre 2026**.

Une instance de l'app native, posée sur le réseau lumière de la console
(téléphone ou tablette), sert de **passerelle** : elle reçoit le **sACN**
(ANSI E1.31) ou l'**Art-Net 4** de la console et pilote chaque écran de jeu
connecté à la session comme une **fixture** : un univers, une adresse de
départ, une personnalité (mode). Le moteur est dans `packages/dmx`.

```
Console ──sACN / Art-Net (UDP)──► Passerelle (iPhone, iPad, Android)
                                    │ fusion par univers, décodage par écran
                                    ▼
                         session chiffrée SetRemote
                 (liaison locale de préférence, sinon relais)
                                    ▼
                  Écran 1 · Écran 2 · … (téléphones accessoires, panneaux)
```

---

## 1. Les personnalités en un coup d'œil

| Personnalité | Identifiant | Canaux | Contenu | Usage conseillé |
|---|---|---:|---|---|
| **Simple 3** | `simple3` | 3 | R, G, B (l'intensité est dans les valeurs RGB) | patch « RGB générique » sans fixture perso |
| **Couleur 5** | `color5` | 5 | Dimmer, R, G, B, Strobe | panneaux couleur simples |
| **Standard 8** | `standard8` | 8 | Dimmer, R, G, B, CCT, Tint, Mix couleur/blanc, Strobe | cas général : blanc réglable + couleur |
| **Étendu 16** | `extended16` | 16 | Couleur 16 bits, effets, médias, appels, SMS, écran | écrans « accessoires » pilotés en séquence |

Règles communes à toutes les personnalités :

- **Strobe** : 0 = pas de strobe ; 1 → 255 = **0,5 → 30 Hz linéaire**
  (`f = 0,5 + (v − 1) × 29,5 / 254`), **plafond strict 30 Hz**. La durée du
  flash est automatique : la moitié de la période, entre 15 et 50 ms. ⚠️
  Prévenir l'équipe et le public : les stroboscopes entre 3 et 30 Hz peuvent
  déclencher des crises chez les personnes photosensibles.
- **Avertissement photosensibilité : jamais sur le chemin console.** Sur la
  télécommande, une boîte d'avertissement précède l'activation du strobe et
  des effets à flashs rapides (Police, Éclair, Paparazzi, Soudure, Néon HS,
  clignotements rapides de la torche ; maquette 11, `web/js/46-strobe-warning.js`).
  La passerelle, elle, n'affiche **rien** : un strobe ou un effet demandé par
  la console (canal Strobe, canal Effet de l'Étendu 16) part aussitôt vers les
  écrans patchés, sans confirmation, comme sur n'importe quel projecteur. Le
  **pupitreur** en est responsable : il prévient l'équipe et le public avant
  de programmer un strobe ou un effet clignotant. Le choix « Ne plus demander »
  de la télécommande n'a aucun effet sur la console, et inversement.
- **CCT** : 0 → 255 sur la plage de l'app, **1700 → 20000 K**
  (`K = round(1700 + v/255 × 18300)`) ; 21 ≈ 3200 K, 54 ≈ 5600 K.
- **Tint** : 0 = magenta maximal (−100), **128 = neutre**, 255 = vert
  maximal (+100). Même rendu que le curseur Tint de la télécommande.
- **Mix couleur/blanc** : 0 = RGB pur, 255 = blanc CCT pur (avec son tint),
  fondu linéaire entre les deux. Le Dimmer s'applique après le mélange.
- Le rendu reprend exactement les formules de couleur de l'app
  (`kelvinToRgb`, `tintWhite`, mélange puis dimmer), vérifiées par les tests
  contre le code de `web/js`.

## 2. Tables de canaux (le « manuel » de la fixture)

Le numéro de canal est un **décalage depuis l'adresse de départ** (canal 1 =
adresse de départ). « Défaut » = valeur de repos (home) à saisir dans la
fixture de la console.

### Simple 3 — `simple3` (3 canaux)

| Canal | Fonction | Valeurs DMX | Défaut |
|---:|---|---|---:|
| 1 | Rouge | 0–255 | 0 |
| 2 | Vert | 0–255 | 0 |
| 3 | Bleu | 0–255 | 0 |

Pas de dimmer : l'intensité est portée par les valeurs RGB (0,0,0 = noir).

### Couleur 5 — `color5` (5 canaux)

| Canal | Fonction | Valeurs DMX | Défaut |
|---:|---|---|---:|
| 1 | Dimmer | 0–255 : 0 → 100 %, linéaire | 0 |
| 2 | Rouge | 0–255 | 255 |
| 3 | Vert | 0–255 | 255 |
| 4 | Bleu | 0–255 | 255 |
| 5 | Strobe | 0 : pas de strobe<br>1–255 : 0,5 → 30 Hz | 0 |

### Standard 8 — `standard8` (8 canaux)

| Canal | Fonction | Valeurs DMX | Défaut |
|---:|---|---|---:|
| 1 | Dimmer | 0–255 : 0 → 100 %, linéaire | 0 |
| 2 | Rouge | 0–255 | 255 |
| 3 | Vert | 0–255 | 255 |
| 4 | Bleu | 0–255 | 255 |
| 5 | CCT | 0–255 : 1700 → 20000 K | 54 (≈ 5575 K) |
| 6 | Tint | 0–127 : magenta −100 → −0,8<br>128 : neutre<br>129–255 : vert +0,8 → +100 | 128 |
| 7 | Mix couleur/blanc | 0 = RGB pur → 255 = blanc CCT pur | 0 |
| 8 | Strobe | 0 : pas de strobe<br>1–255 : 0,5 → 30 Hz | 0 |

### Étendu 16 — `extended16` (16 canaux)

| Canal | Groupe | Fonction | Valeurs DMX | Défaut |
|---:|---|---|---|---:|
| 1 | Couleur | Dimmer | 0–255 : 0 → 100 % (octet fort du 16 bits) ; maître des effets aussi | 0 |
| 2 | Couleur | Dimmer Fine | octet faible du 16 bits (canaux 1–2 = dimmer 16 bits) | 0 |
| 3 | Couleur | Rouge | 0–255 | 255 |
| 4 | Couleur | Vert | 0–255 | 255 |
| 5 | Couleur | Bleu | 0–255 | 255 |
| 6 | Couleur | CCT | 0–255 : 1700 → 20000 K | 54 |
| 7 | Couleur | Tint | 0–127 magenta · 128 neutre · 129–255 vert | 128 |
| 8 | Couleur | Mix couleur/blanc | 0 = RGB pur → 255 = blanc CCT pur | 0 |
| 9 | Couleur | Strobe | 0 : pas de strobe · 1–255 : 0,5 → 30 Hz | 0 |
| 10 | Effets | Effet | 0 : aucun effet · 1–9 : pas de changement · n×10…n×10+9 : effet n (tableau ci-dessous) · 150–255 : pas de changement | 0 |
| 11 | Effets | Vitesse effet | 0–255 : de la vitesse min à la vitesse max de l'effet, linéaire | 128 |
| 12 | Médias | Média | 0 : masquer le média · 1–9 : pas de changement · 10–19 : média 1 · 20–29 : média 2 · … · 240–249 : média 24 · 250–255 : média 25 | 0 |
| 13 | Médias | Lecture | 0–63 : lecture · 64–127 : pause · 128–191 : lecture en boucle · 192–255 : retour au début et pause | 0 |
| 14 | Déclencheurs | Appel | 0 : raccrocher (fin ou refus de l'appel en cours) · 1–9 : pas de changement · 10–19 : appel 1 · … · 200–209 : appel 20 · 210–255 : pas de changement | 0 |
| 15 | Déclencheurs | SMS | 0 : fermer la notification · 1–9 : pas de changement · 10–19 : SMS 1 · … · 200–209 : SMS 20 · 210–255 : pas de changement | 0 |
| 16 | Déclencheurs | Écran | 0–127 : écran allumé · 128–255 : blackout (noir total, média et effet compris) | 0 |

**Effets (canal 10) et plage du canal 11** — ordre de la liste d'effets de
l'app (`web/js/50-effects-remote.js`) :

| Valeurs | Effet | Vitesse (canal 11 : 0 → 255) |
|---|---|---|
| 0 | Aucun effet | — |
| 10–19 | Chaser (`chaser`) | 0,1 → 6 |
| 20–29 | Noise (`noise`) | 1 → 30 img/s |
| 30–39 | Aurora (`aurora`) | 0,05 → 2 |
| 40–49 | Caustiques (`water`) | 0,1 → 3 |
| 50–59 | Pulse BPM (`pulse`) | 20 → 240 BPM |
| 60–69 | Phares (`traffic`) | 0,05 → 2 passages/s |
| 70–79 | Soudure (`weld`) | 0,2 → 6 |
| 80–89 | Néon HS (`neon`) | 0,2 → 6 |
| 90–99 | Police (`police`) | 0,5 → 8 |
| 100–109 | Éclair (`lightning`) | 0,1 → 3 |
| 110–119 | Paparazzi (`paparazzi`) | 0,2 → 4 rafales/s |
| 120–129 | TV (`tv`) | 0,5 → 15 img/s |
| 130–139 | Bougie (`candle`) | 0,2 → 5 |
| 140–149 | Feu (`fire`) | 0,5 → 10 |
| 1–9, 150–255 | Pas de changement | — |

L'effet utilise ses propres couleurs ; son intensité suit le Dimmer
(canaux 1–2) : Dimmer à 0 = écran noir, même avec un effet.

### Convention des « emplacements » (canaux 10, 12, 14, 15)

- La valeur **n×10 à n×10+9 choisit l'élément n** : 10–19 = élément 1,
  20–29 = élément 2, etc.
- **1–9** et les valeurs **au-delà du dernier élément** veulent dire **« pas
  de changement »** : l'écran garde le choix précédent. Limites : 14 effets
  (dernier : 140–149), 25 médias (250–255 = média 25), 20 appels et 20 SMS
  (200–209 = élément 20).
- **Effet** : 0 = aucun effet. **Média** : 0 = média masqué. Les médias sont
  numérotés dans l'**ordre du pool** de la télécommande.

### Appel et SMS : déclenchement sur front

- Ces deux canaux **déclenchent une action une seule fois**, au moment où la
  valeur **entre dans un nouvel emplacement** ; tant que la valeur reste dans
  le même emplacement, rien ne se redéclenche. **0 agit une fois** (raccrocher
  / fermer la notification).
- Passer par une valeur « pas de changement » (1–9, 210–255) ne réarme pas :
  revenir ensuite dans le même emplacement ne relance pas l'appel. Pour
  relancer le même appel : passer par 0 (raccrocher) puis revenir.
- **À la première trame reçue** (démarrage de la passerelle ou nouveau patch),
  la valeur présente est seulement mémorisée, sans déclenchement : une
  passerelle qui redémarre ne rejoue jamais un appel.
- Appel *n* = entrée *n* de la **liste d'appels enregistrés de la télécommande**
  (20 premières entrées) ; SMS *n* = entrée *n* de sa liste de SMS.
- Les **notifications d'application** (liste « Notifs » de l'onglet Tel) et la
  **discussion** ne se déclenchent jamais depuis la console : le canal SMS ne
  vise que la liste des SMS. Une ancienne entrée « messagerie » est devenue un
  SMS et se déclenche comme tel. La **Séquence** (onglet Séquence : GO, ↶,
  STOP, faux téléphone) ne se pilote pas non plus depuis la console ; quand la
  console a la priorité, ses étapes Couleur, Effet et Média sont ignorées par
  les écrans patchés, comme tout ordre de look de la télécommande.
- Programmez ces canaux **sans fondu** (snap / « jump ») : un fondu de 30 à 0
  traverserait les emplacements 2 et 1 et déclencherait les appels 2 et 1.
  Même conseil pour Effet et Média.
- Appel 0 ne ferme pas une notification SMS affichée, et SMS 0 ne raccroche
  pas un appel en cours.

## 3. Priorité console / télécommande et perte de signal

Une seule règle, pour tous les écrans patchés :

1. **Tant que le signal de la console est présent, la console a la priorité.**
   Les réglages de la télécommande sur un écran patché sont ignorés : couleur,
   strobe, effet, blackout, affichage et lecture des médias.
2. **Perte du signal** : chaque écran **garde le dernier look reçu**.
3. **À partir de là, la télécommande peut reprendre la main** sur cet écran :
   son prochain réglage s'applique.
4. **Dès que le signal DMX revient, la console reprend la priorité
   immédiatement** (le look de la console est renvoyé sans attendre).

Quand la passerelle considère-t-elle le signal perdu ?

| Protocole | Délai | Justification |
|---|---|---|
| sACN | **2,5 s** sans paquet de données de l'univers, ou dès qu'une source envoie *Stream_Terminated* | E1.31, `E131_NETWORK_DATA_LOSS_TIMEOUT` = 2,5 s ; les paquets de synchronisation et de découverte ne maintiennent pas une source en vie (précisé par E1.31-2025) |
| Art-Net | **5 s** sans ArtDmx de l'univers | Art-Net ne définit pas de délai de perte côté récepteur ; la section ArtDmx demande de réémettre les données inchangées environ toutes les 4 s : 4 s + 1 s de marge |

Arrêter la passerelle a le même effet qu'une perte de signal : les écrans
gardent leur look et la télécommande reprend la main. Par sécurité, un écran
qui ne reçoit plus rien de la passerelle pendant 3 s (le maintien est envoyé
chaque seconde) se comporte aussi comme après une perte de signal.

Plusieurs sources sur le même univers :

- **sACN** : la source de **priorité la plus haute** gagne (0–200, 100 par
  défaut) ; à priorité égale, fusion **HTP** canal par canal. Les données
  « preview » ne sont jamais affichées.
- **Art-Net** : fusion de **deux consoles au plus**, distinguées par leur
  adresse IP (une troisième est ignorée), en **HTP** (LTP en option) ; une
  source qui s'arrête reste 10 s dans la fusion, comme le prévoit Art-Net 4.

## 4. Patcher la fixture sur les consoles

Principe commun : créer une fixture personnalisée (« SetRemote Écran ») avec
un **mode par personnalité** (3, 5, 8, 16 canaux) en reprenant les tables
ci-dessus, puis patcher un écran par adresse. **Simple 3** se patche aussi en
« RGB générique 3 canaux » et **Couleur 5** en « Dimmer + RGB + strobe »
générique si la console en propose un : dans ce cas, vérifier que la plage du
strobe générique correspond (0 = arrêt, 1–255 = lent → rapide).

Pour les canaux à emplacements (Effet, Média, Appel, SMS), déclarer des
plages de 10 valeurs (« slots ») et désactiver le fondu (snap). Pour la CCT,
indiquer 1700 K à 0 et 20000 K à 255. Pour le Tint, marquer 128 comme
neutre.

### grandMA3

- **Créer la fixture** : *Patch* → *Fixture Types* → *Edit* ; le manuel
  conseille de copier un type proche puis d'adapter. Créer un DMX Mode par
  personnalité (onglet *DMXModes*, l'empreinte s'affiche entre crochets).
  Alternative : construire la fixture dans le *GDTF Builder* et l'importer.
  Sources : [Fixture Type Editor](https://help.malighting.com/grandMA3/2.3/HTML/ft_build.html),
  [Edit Fixture Types](https://help.malighting.com/grandMA3/2.4/HTML/edit-fixture-types.html).
- **Sortie réseau** : *Menu* → *DMX Protocols*. **sACN** : multicast par
  défaut (univers 1 = 239.255.0.1) ; choisir le mode *Output Unicast* et saisir
  l'IP de la passerelle dans *Destination IP*. **Art-Net** : en mode *Auto*,
  envoi en unicast tant qu'il y a au plus 5 récepteurs par univers (*Broadcast
  Threshold*). Sources :
  [Network protocols](https://help.malighting.com/grandMA3/2.5/HTML/network_design_protocols.html),
  [sACN](https://help.malighting.com/grandMA3/2.3/HTML/dmx_ethernet_sacn.html).

### ETC Eos (Eos, Ion, Element, Nomad)

- **Créer la fixture** : *Patch* → softkey *{Fixtures}* → **Fixture Editor** :
  nom, paramètres, adresses et plages, modes. La fixture est enregistrée **dans
  le fichier de show** (pas dans la bibliothèque) ; pour la réutiliser,
  fusionner le show (« Merging Custom Fixtures into a New Show File »). ETC
  accepte aussi les demandes de profils et signale que les GDTF tiers peuvent
  demander des retouches. Sources :
  [Fixture Editor](https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/06_Patch/06_Fixture_Editor/About_the_Fixture_Editor.htm),
  [Fixture absente de la bibliothèque](https://support.etcconnect.com/ETC/Consoles/Eos_Family/Software_and_Programming/Help_My_Fixture_isn't_in_the_Eos_Family_Fixture_Library).
- **Sortie réseau** : *Patch* → *Protocols*. sACN : multicast par défaut ;
  saisir l'IP de la passerelle comme **destination unicast** de l'univers
  (possible depuis Eos 3.2 ; aussi en ligne de commande, `Unicast
  Destinations`). Art-Net : activer le protocole dans *Patch > Protocols* et
  dans *Setup > Device > Network*, avec l'option unicast. **Sur Eos, les
  univers Art-Net commencent à 0**, les univers sACN à 1. Source :
  [Patch > Protocols](https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/06_Patch/Patch_Protocols.htm).

### ChamSys MagicQ

- **Créer la fixture** : éditeur de têtes intégré, **Head Editor** (les têtes
  sont dans le dossier `show/heads`, et le show garde sa copie des têtes
  utilisées) ; ChamSys crée aussi des personnalités sur demande. MagicQ importe
  directement les fichiers **GDTF** (depuis la 1.8.4.4). Sources :
  [Head Editor](https://docs.chamsys.co.uk/magicq/manual/head_editor.html),
  [MagicQ Concepts](https://docs.chamsys.co.uk/magicq/manual/console_concepts.html),
  [import GDTF](https://www.livedesignonline.com/news/chamsys-magicq-software-now-supports-import-gdtf-personality-files).
- **Sortie réseau** : *Setup* → *DMX I/O* ; pour le sACN, saisir l'IP de la
  passerelle dans les **colonnes unicast**. Source :
  [sACN Set Up and Trouble Shooting](https://info.chamsyslighting.com/article/529-sacn-trouble-shooting).

### Avolites Titan

- **Créer la fixture** : application **Personality Builder** livrée avec
  Titan ; ranger la personnalité dans le dossier utilisateur (lu avant la
  bibliothèque, non écrasé par les mises à jour) puis **redémarrer Titan**.
  Sources : [Fixture personalities](https://manual.avolites.com/docs/fixture-personalities),
  [v14](https://manual.avolites.com/docs/14.0/fixture-personalities).
- **Sortie réseau** : Titan envoie le sACN **en multicast seulement** (constaté
  sur Titan v15, 2022) mais l'**Art-Net en unicast** vers une IP, par univers.
  **Avec Avolites, utiliser l'Art-Net unicast** vers la passerelle. Sources :
  [avosupport — sACN unicast](https://avosupport.de/wiki/tricks/sacn_unicast),
  [Controlling fixtures over a network](https://manual.avolites.com/docs/17.0/networking/controlling-fixtures-over-a-network).

## 5. sACN ou Art-Net : réglages

| | sACN (E1.31) | Art-Net 4 |
|---|---|---|
| Port UDP | 5568 | 6454 |
| Univers | 1–63999 | Port-Address 15 bits 0–32767 = Net (0–127) · Sub-Net (0–15) · Univers (0–15) |
| Diffusion | multicast `239.255.{hi}.{lo}` par univers, ou unicast | unicast (ArtDmx en broadcast déconseillé) |
| Découverte | paquets de découverte sur l'univers 64214 (multicast) | ArtPoll en broadcast, réponses ArtPollReply en unicast |
| Plusieurs consoles | priorités 0–200, HTP à priorité égale | 2 sources max, HTP (LTP en option) |

**Recommandation : envoyer en UNICAST vers l'adresse IP de la passerelle**,
surtout quand la passerelle est un **iPhone ou un iPad** : iOS ne laisse une
app recevoir du multicast ou du broadcast qu'avec une autorisation spéciale
d'Apple (*entitlement* « multicast networking », accordé sur demande), alors
que l'UDP unicast fonctionne sans elle. Conséquences tant que cette
autorisation n'est pas obtenue :

- sACN : régler la console en **unicast** vers l'IP de la passerelle (le
  multicast `239.255.x.y` n'arrivera pas) ;
- Art-Net : la **découverte automatique** (ArtPoll en broadcast) ne verra pas
  la passerelle ; **saisir son IP à la main** comme destination unicast.
  Quand la passerelle reçoit un ArtPoll (Android, ou iOS avec l'autorisation),
  elle répond en unicast avec un ArtPollReply qui annonce un port de sortie par
  univers patché.

L'IP de la passerelle est affichée dans son écran (télécommande, onglet QR →
« Passerelle DMX »), avec un voyant qui clignote à chaque paquet reçu et la
liste des univers reçus (source, IP, cadence, ou délai depuis le dernier
paquet) : vérifier là la numérotation des univers Art-Net (0 ou 1 selon la
console).

## 6. Réseau : conseils de plateau

- **Réseau lumière dédié** : ne pas mélanger le DMX sur IP avec le Wi-Fi de la
  production. Adresses fixes pour la console et la passerelle ; Art-Net
  utilise traditionnellement les plages 2.x.x.x ou 10.x.x.x, le sACN n'impose
  rien.
- **Passerelle en filaire** : adaptateur **USB-C → Ethernet** branché sur le
  switch de la console (iPad, iPhone USB-C et la plupart des Android
  l'acceptent). C'est la configuration la plus fiable.
- **Wi-Fi, si inévitable** : point d'accès dédié, isolation des clients
  désactivée, **unicast** plutôt que multicast (le multicast Wi-Fi part au débit
  de base, se perd plus et fatigue les batteries), économie d'énergie du
  téléphone désactivée, appli au premier plan et écran allumé.
- **Switches** : en multicast sACN, un switch avec IGMP snooping et querier évite
  d'inonder le réseau ; sans querier, préférer l'unicast.
- **Passerelle → écrans** : préférer la **liaison locale** (même réseau, pas
  d'Internet) au relais Internet : latence de quelques millisecondes au lieu de
  50 à 200 ms et pas de dépendance à la 4G/5G. Détails chiffrés dans
  `docs/DMX-NATIVE.md`.

## 7. Pour les développeurs : message `dmx:look`

La passerelle envoie aux écrans, dans la session chiffrée :

```json
{ "type": "dmx:look", "target": { "screens": ["AbCdEfGh12345678"] }, "seq": 812, "live": true,
  "look": { "color": "#ffefe1", "strobe": { "freq": 15.25, "dur": 33 },
            "effect": { "name": "fire", "speed": 3, "intensity": 80 },
            "media": { "index": 3, "playback": "loop" }, "blackout": true } }
```

- `look` omet les valeurs par défaut : `{ "color": "#000000" }` = pas de
  strobe, pas d'effet, média masqué, écran allumé. `color` a déjà le dimmer et
  le mélange appliqués. `effect.intensity` (0–100) = dimmer de la console.
- `live: true` : signal présent, priorité console. `live: false` (envoyé une
  fois à la perte du signal ou à l'arrêt) : garder ce look, accepter de nouveau
  la télécommande.
- Envoi au changement (au plus 30 messages/s par écran), maintien toutes les
  secondes tant que `live`, looks identiques regroupés (`target.screens` ≤ 64).
- `seq` : compteur 16 bits ; l'écran ignore un `seq` plus ancien
  (`isNewerSeq`) sauf après 3 s sans message de la passerelle (redémarrage).
- Appel/SMS : messages existants `call:start` (champs de l'entrée enregistrée,
  `kind: 'call'` ou `'sms'`) et `call:end`, ciblés sur les écrans concernés.
- Le schéma strict est dans `packages/protocol/schema.js` (`dmx:look`, sens
  télécommande → écran).

**Branché dans la PWA** (16 octobre 2026) :

- **Passerelle** (télécommande dans l'app native) : `web/js/86-dmx-gateway.js`
  (moteur `packages/dmx` assemblé sous la globale `SRDMX`, contrat du pont
  natif : `docs/DMX-NATIVE.md` § 9) et `87-dmx-gateway-ui.js` (maquettes 14
  à 17).
- **Écran** : route `dmx:look` de `MSG_ROUTES` (`web/js/22-protocol.js`,
  validée par `expandLook()`), appliquée par `screenApplyDmxLook`
  (`web/js/36-dmx-screen.js`) : ordre `seq`, couleur, strobe redémarré
  seulement si sa fréquence ou sa durée change (§ 8, défaut n° 4 corrigé :
  il flashe la couleur de la console), effet et vitesse, média et lecture,
  noir. Tant que `live` est vrai (et moins de 3 s depuis le dernier
  `dmx:look`), `dispatchMessage` ignore `color`, `strobe`, `effect`,
  `blackout`, `media:show`, `media-stop`, `media-ctrl` de la télécommande ;
  une image ou une vidéo diffusée par la télécommande est mise en cache sans
  s'afficher.
- **Médias** : la console n'affiche que des médias **déjà en cache** sur
  l'écran (les images du pool sont préchargées ; une vidéo l'est à sa
  première lecture depuis la télécommande). Un média absent du cache n'est pas
  redemandé (la rediffusion s'afficherait aussi sur les autres écrans) : il
  apparaît dès qu'il arrive en cache.
- **Appels / SMS** : entrée *n* = n-ième entrée des listes « Appels » / « SMS »
  de l'onglet Appel (maquette 18) ; sa photo et sa bande son partent avant
  `call:start` si elles diffèrent de celles en cache sur les écrans. Son
  importé de l'entrée (sonnerie, son de notification : `ringId`, maquette
  12) : envoyé aux écrans dès le démarrage de la passerelle (et à chaque
  modification des entrées 1 à 20), l'appel console sonne donc sans transfert.
- **Identifier** (moniteur) : message `screen:identify` ciblé ; l'écran
  clignote 3 s à 2 Hz sans changer d'état.

## 8. Ancien mode DMX 3CH / 9CH (supprimé) : incohérences constatées

L'app contenait un mode « DMX » antérieur (réception via un pont WebSocket ou
un plugin Capacitor `SACN`), remplacé par la passerelle et les personnalités
ci-dessus. Il a été **supprimé** : bouton « Mode DMX » de l'accueil, page
`screen.html`, écran de configuration `#screen-sacn-config`,
`web/js/60-sacn.js` et `web/styles/60-sacn.css`, ainsi que les types
`setUniverse` / `dmx` de son pont WebSocket. Le constat ci-dessous est
conservé pour la migration des patchs existants ; les références renvoient
au commit `4db93f6`, où ce code existait encore :

**3CH (Dim, CCT, Tint)** — cohérent entre `screenApplyDmx` et
`applyDmxToOutput` (`web/js/60-sacn.js` l. 90–95 et 227–233) : Dimmer
`v/255`, CCT `1700 + v/255 × 18300`, Tint ≤ 127 → `(v/127 − 1) × 100`,
≥ 128 → `(v − 128)/127 × 100` (**127 et 128 sont tous deux neutres**). Rendu
`dmxKelvinGM` = mêmes formules que la télécommande. → Reproduit par
**Standard 8** avec Mix = 255 (blanc pur) ; seule différence : Tint 1–127,
décalé de moins d'un pas (le nouveau neutre est 128 seul). Testé.

**9CH : quatre définitions incompatibles pour les mêmes 9 canaux**

| Canal | Bouton de l'écran DMX (`web/index.template.html` l. 110) et tables de `screen.html` (l. 143–151, 192–200) | Libellés `SACN_MODES['9ch']` (`web/js/60-sacn.js` l. 131–141) | Décodage réel `screenApplyDmx` (`web/js/60-sacn.js` l. 96–116) |
|---:|---|---|---|
| 1 | Dim | Red | Rouge |
| 2 | CCT | Green | Vert |
| 3 | Tint (−128…+127) | Blue | Bleu |
| 4 | Color XFade | Dimmer | Dimmer |
| 5 | Rouge | Kelvin L | **ignoré** |
| 6 | Vert | Kelvin H | **ignoré** |
| 7 | Bleu | GM Shift | Tint appliqué **au RGB** (formule `tintWhite`) |
| 8 | Shutter Hz (1–255 → 0,5–25 Hz) | Strobe Hz | Strobe `0,5 + v/255 × 24,5` Hz (v = 1 → 0,596 Hz, pas 0,5) |
| 9 | Shutter ms (5–500) | Strobe ms | Durée `5 + v/255 × 495` ms |

Défauts associés :

1. L'ordre affiché aux pupitreurs (Dim, CCT, Tint, XFade, R, G, B, …) n'est
   **pas** celui que décode l'écran (R, G, B, Dim, …) : un patch fait d'après la
   documentation donne des couleurs fausses.
2. Les canaux 5–6 « Kelvin L/H » (CCT 16 bits ?) ne sont **jamais lus** : pas
   de CCT ni de crossfade en 9CH.
3. `screen.html` (pont local) décode autrement : champs nommés `dim, cct,
   tint, colorXFade, r, g, b` fournis par le pont, tint **additif**
   (`tint > 0` : G + 60·t, R/B − 20·t ; `tint < 0` : R/B + 30·t, G − 40·t ;
   l. 289–296) au lieu du tint multiplicatif de l'app, et **aucun strobe**
   (canaux 8–9 non utilisés).
4. En 9CH, le strobe fait clignoter `screenBaseColor` (dernière couleur de la
   télécommande, `#1a1a1a` par défaut), **pas la couleur DMX**, car le chemin
   DMX écrit la couleur directement sans mettre à jour `screenBaseColor`
   (`web/js/34-screen-display.js` l. 2–4 et 31–51). Et `receiveStrobe` est
   rappelé **à chaque trame** (≈ 44 Hz) : le cycle redémarre sans cesse, si
   bien que la fréquence réelle suit la cadence du réseau et non le canal 8.
5. Avec le plugin natif, `startMode` force le mode 9CH
   (`web/js/30-navigation.js` l. 13) mais `CapSACN.start({ universe,
   baseAddr })` (`web/js/60-sacn.js` l. 32) ne transmet pas le mode : le
   décodage dépend du plugin natif, absent du dépôt.
6. Le plafond était 25 Hz ; il est désormais de 30 Hz.

**Migration** : 3CH → Standard 8 (R = G = B = 255, Mix = 255) ; 9CH →
Standard 8 (même contenu, ordre propre, CCT et mix enfin actifs) ou Couleur 5.

## 9. Et ensuite : un fichier GDTF

Proposition : produire un fichier **GDTF** (General Device Type Format,
normalisé DIN SPEC 15800) « SetRemote Écran » avec ses quatre modes, publié sur
[GDTF Share](https://gdtf-share.com). grandMA3 et MagicQ l'importent
directement ; Eos accepte les GDTF avec d'éventuelles retouches. Cela évite à
chaque pupitreur de recréer la fixture. Les tables ci-dessus sont générées
depuis `packages/dmx/personalities.js`, qui pourra aussi générer le GDTF.

## 10. Références

Consultées le 15 octobre 2026. Les PDF des normes n'ont pas pu être
téléchargés depuis l'environnement de développement (proxy) : les champs ont
été recoupés avec les extraits publiés et les implémentations de référence
citées.

- **ANSI E1.31-2018** (sACN), ESTA :
  <https://tsp.esta.org/tsp/documents/docs/E1-31-2018.pdf> (exemplaire marqué
  *SUPERSEDED*) ; remplacée par **ANSI E1.31-2025** (même format de paquets ;
  délai de perte compté sur les seuls paquets de données) :
  <https://webstore.ansi.org/standards/esta/ansie1312018>. Sections utilisées :
  tableaux 4-1 (paquet de données), 4-2 (synchronisation), 4-3 (découverte) ;
  §5 couche racine (identifiant ACN, *Flags and Length*, vecteurs, CID) ; §6.2.3
  priorité 0–200 ; §6.2.4 adresse de synchronisation ; §6.2.5 numéro de
  séquence ; §6.2.6 options (*Preview_Data* bit 7, *Stream_Terminated* bit 6,
  *Force_Synchronization* bit 5) ; §6.2.7 univers 1–63999 ; §6.7.1 perte de
  données réseau ; §6.7.2 numérotation de séquence (rejet si B − A ∈ ]−20, 0]
  en arithmétique signée 8 bits) ; §7 couche DMP (0xa1, adresse 0, incrément 1,
  1 à 513 valeurs, START code) ; §9 adressage multicast IPv4 et port 5568 ;
  §11 synchronisation d'univers ; annexe A (constantes, 2,5 s, univers 64214).
- **Art-Net 4**, Artistic Licence, révision 1.4dp du 23/10/2025 :
  <https://art-net.org.uk/downloads/art-net.pdf> — ArtPoll (Flags, mode ciblé
  TargetPortAddressTop/Bottom), ArtPollReply (239 octets, réponse **unicast**
  obligatoire, broadcast interdit), ArtDmx (ProtVer 14, Sequence, Physical,
  SubUni, Net, Length pair 2–512, réémission ≈ 4 s), *Data merging* (2 sources,
  HTP/LTP, maintien 10 s), Port-Address 15 bits.
- Recoupements : OLA, [ArtNetPackets.h](https://github.com/OpenLightingProject/ola/blob/master/plugins/artnet/ArtNetPackets.h)
  et [DMPE131Inflator.cpp](https://github.com/OpenLightingProject/ola/blob/master/libs/acn/DMPE131Inflator.cpp)
  (délai 2 500 ms, fenêtre −20, priorité > 200 ignorée) ;
  [jwetzell/artnet-go](https://github.com/jwetzell/artnet-go) (champs Art-Net 4
  de l'ArtPollReply) ; [hideakitai/ArtNet](https://github.com/hideakitai/ArtNet).
- Consoles : liens donnés au § 4.
- Apple, autorisation multicast :
  <https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.networking.multicast>,
  demande : <https://developer.apple.com/contact/request/networking-multicast>.

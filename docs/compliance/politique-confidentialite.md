<!--
INTERNE — ce commentaire ne s'affiche pas une fois le Markdown rendu ; le retirer avant
publication en HTML brut.
Cette politique décrit l'architecture CIBLE (chiffrement de bout en bout, relais sans
stockage, polices auto-hébergées, QR généré sur l'appareil, STUN auto-hébergé).
NE PAS la publier avant la fin de la migration : voir
la check-list interne de migration (hors dépôt), section 2.
Remplacer tous les [CROCHETS] avant publication.
La politique PUBLIÉE dès maintenant est confidentialite.html (racine du dépôt, servie
par GitHub Pages et embarquée dans l'app, ouverte depuis Réglages) : elle décrit l'état
RÉEL de la production (broker MQTT public HiveMQ, STUN de Google, GitHub Pages). Au passage
au relais auto-hébergé, ne changer que son paragraphe balisé « RELAIS : DÉBUT / FIN ».
-->

# Politique de confidentialité de SetRemote

Dernière mise à jour : [DATE DE PUBLICATION]

## En bref

- **Pas de compte**, pas de publicité, pas de mesure d'audience, pas de traceur, pas de revente de données.
- Ce que vous envoyez d'un appareil à l'autre (photos, vidéos, sons, textes, couleurs, effets) est **chiffré de bout en bout** sur votre appareil (AES-256-GCM). Les clés sont créées sur vos appareils au moment de l'appairage et ne sont jamais envoyées à nos serveurs. **Nous n'avons techniquement pas accès à vos contenus.**
- Notre serveur relais se contente de **faire passer des messages chiffrés** entre vos deux appareils appairés. Il ne stocke rien.
- Vos réglages et mémoires restent **sur votre appareil**.

## 1. Qui est responsable de vos données ?

Le responsable du traitement est :

**ITSI APP**, [FORME JURIDIQUE] au capital de [CAPITAL] €, immatriculée au RCS de [VILLE] sous le numéro [SIREN]
Siège social : 64 résidence Les Jardins de Saint-Colomban, 35350 Saint-Coulomb
E-mail : pierre@itsi-app.com
Site web : [SITE WEB]

[Si un délégué à la protection des données (DPO) est désigné : « Délégué à la protection des données : [NOM / CONTACT DPO] ». Sinon : « Nous n'avons pas désigné de délégué à la protection des données ; pour toute question, écrivez à pierre@itsi-app.com. »]

## 2. Comment fonctionne SetRemote

SetRemote utilise deux appareils :

- la **télécommande**, depuis laquelle vous réglez la couleur, les effets, les médias et les écrans d'accessoire ;
- l'**écran de jeu**, qui affiche ce que la télécommande lui envoie.

Vous reliez les deux appareils en scannant un **QR code** ou en saisissant un **code court** affiché par l'autre appareil. Ce code sert à créer, sur chacun des deux appareils, les clés de chiffrement de la session. Les messages passent ensuite :

- soit par notre **serveur relais**, qui ne voit que des données chiffrées ;
- soit **directement** d'un appareil à l'autre (connexion WebRTC), quand le réseau le permet.

## 3. Quelles données sont traitées ?

### 3.1 Les contenus que vous diffusez

Il s'agit des photos, vidéos et clips audio que vous ajoutez, du nom et de la photo d'un appelant fictif, des textes de messages fictifs, du fond d'écran verrouillé fictif, ainsi que des commandes de couleur, d'effets, de torche et de vibration.

- Ils sont **chiffrés sur l'appareil qui les envoie** et **déchiffrés uniquement sur l'appareil appairé** qui les reçoit.
- Ils sont mis en cache **uniquement sur l'écran de jeu qui les reçoit**, le temps de la session. Ils sont effacés quand vous les retirez du pool média, quand vous mettez fin à la session ou quand vous fermez l'application.
- **Ni nous ni notre hébergeur ne pouvons les lire.**

Si vous diffusez l'image ou la voix d'une personne (un comédien, par exemple) ou une œuvre protégée, c'est à vous d'obtenir les autorisations nécessaires.

### 3.2 Les données techniques de connexion

Pour faire suivre les messages chiffrés, le serveur relais traite **en mémoire vive** l'adresse IP de chaque appareil, l'heure de connexion, un identifiant de session aléatoire et la taille des messages. Il le fait **uniquement pendant la connexion** et **n'enregistre rien**.

[À conserver seulement si l'hébergeur conserve des journaux réseau : « Notre hébergeur peut conserver des journaux techniques (adresse IP, horodatage) pendant [DURÉE] pour la sécurité de son infrastructure. »]

Pour la connexion directe, chacun des deux appareils apprend l'adresse IP de l'autre. Ces adresses sont échangées par le canal chiffré. Un serveur STUN ([SERVEUR STUN — ex. « auto-hébergé sur l'infrastructure du relais »]) indique à votre appareil son adresse IP publique. Il n'enregistre rien et ne reçoit aucun contenu.

### 3.3 Les clés de chiffrement

Le secret d'appairage (QR code ou code court) et les clés de chiffrement sont **générés et conservés sur vos appareils**. Ils ne sont jamais transmis à nos serveurs. Le QR code est dessiné sur l'appareil lui-même, sans service tiers.

### 3.4 Vos réglages, mémoires et projets

Vos mémoires de couleur et d'effets et vos préférences sont stockés **localement** (stockage de l'application ou du navigateur). Ils ne quittent pas l'appareil, sauf si vous les exportez vous-même. Ils sont supprimés quand vous les effacez ou désinstallez l'application.

**Export de projet.** Vous pouvez exporter un projet (réglages et mémoires) **avec ou sans ses médias**. Le fichier est créé sur votre appareil et enregistré ou partagé **là où vous le choisissez** (stockage de fichiers, menu de partage du système, messagerie…). Nous ne le recevons pas. S'il contient des médias, traitez-le comme n'importe quel fichier qui contient vos photos et vidéos.

### 3.5 Si vous nous contactez

Si vous nous écrivez, nous utilisons votre adresse e-mail et le contenu de votre message pour vous répondre.

### 3.6 Les données traitées par Apple et Google

Quand vous téléchargez SetRemote sur l'App Store ou Google Play, Apple ou Google traitent des données (compte, téléchargement, appareil) **en tant que responsables de traitement indépendants**, selon leurs propres politiques :

- Apple : https://www.apple.com/fr/legal/privacy/
- Google : https://policies.google.com/privacy?hl=fr

Ces plateformes nous fournissent des **statistiques agrégées** (nombre de téléchargements, versions installées…). Si vous avez accepté de partager vos données d'analyse avec les développeurs dans les réglages de votre appareil, elles nous fournissent aussi des **rapports de plantage anonymisés**. Ces rapports ne contiennent pas vos contenus.

### 3.7 Si vous utilisez la version web

La version web de SetRemote est hébergée par [HÉBERGEUR DU SITE WEB], qui reçoit les données techniques de toute visite de site (adresse IP, navigateur, page demandée) et les conserve [DURÉE DES JOURNAUX DE L'HÉBERGEUR]. La version web ne dépose **aucun cookie**. Elle utilise le stockage local du navigateur uniquement pour vos mémoires et pour fonctionner hors ligne, à votre demande. Ce stockage est exempté de consentement (article 82 de la loi Informatique et Libertés).

### 3.8 Ce que nous ne faisons pas

Nous ne créons pas de compte et ne faisons ni mesure d'audience ni publicité. Nous ne suivons pas votre activité d'une application à l'autre, ne vendons aucune donnée et ne faisons pas de profilage. SetRemote n'accède **pas** à vos contacts, à votre localisation, à votre journal d'appels ni à vos SMS. Les écrans d'appel et de message de SetRemote sont **entièrement fictifs** : aucun appel, SMS ou notification système réel n'est émis.

## 4. Pourquoi et sur quelle base légale ?

| Finalité | Données | Base légale (RGPD) |
|---|---|---|
| Transmettre vos contenus chiffrés entre vos appareils appairés | Données techniques de connexion (3.2) ; contenus chiffrés, illisibles pour nous (3.1) | Exécution du contrat, c'est-à-dire la fourniture du service que vous demandez (art. 6.1.b) |
| Protéger le relais contre les abus (limitation de débit, blocage d'une connexion anormale) | Adresse IP, en mémoire vive uniquement | Intérêt légitime à assurer la sécurité du service (art. 6.1.f) |
| Conserver vos réglages et mémoires sur votre appareil | Réglages locaux (3.4) | Stockage nécessaire au service que vous avez expressément demandé (art. 82 de la loi Informatique et Libertés) ; aucune transmission |
| Vous répondre | E-mail et message (3.5) | Intérêt légitime à répondre aux demandes (art. 6.1.f) |
| Améliorer la stabilité de l'application | Statistiques et rapports de plantage agrégés fournis par Apple ou Google (3.6) | Intérêt légitime (art. 6.1.f) |
| Respecter nos obligations légales | Selon la demande | Obligation légale (art. 6.1.c) |

Aucune décision automatisée produisant des effets juridiques n'est prise à votre sujet.

## 5. Combien de temps ?

| Données | Durée de conservation |
|---|---|
| Contenus diffusés (3.1) | Chiffrés en transit, jamais stockés par nous. Sur l'écran de jeu : le temps de la session. |
| Données techniques au relais (3.2) | Pendant la connexion uniquement, en mémoire vive. Aucun enregistrement. |
| Réglages, mémoires et projets exportés (3.4) | Sur votre appareil ou à l'emplacement que vous avez choisi, jusqu'à ce que vous les supprimiez |
| Échanges par e-mail (3.5) | 3 ans après le dernier échange |
| Statistiques des plateformes (3.6) | Selon les durées d'Apple et de Google |

## 6. Qui reçoit des données ?

Nous ne vendons ni ne louons aucune donnée. Seuls les destinataires suivants interviennent :

| Destinataire | Rôle | Ce qu'il reçoit | Localisation |
|---|---|---|---|
| [HÉBERGEUR DU RELAIS — raison sociale] | Sous-traitant : héberge le serveur relais [et le serveur STUN] | Messages **chiffrés** (illisibles), données techniques de connexion en transit | [PAYS — de préférence UE/EEE] |
| [HÉBERGEUR DU SITE WEB] | Sous-traitant : héberge le site et la version web | Données techniques de visite (3.7) | [PAYS] |
| [FOURNISSEUR DE MESSAGERIE E-MAIL] | Sous-traitant : messagerie du support | Vos e-mails (3.5) | [PAYS] |
| Apple Distribution International Ltd. ; Google Ireland Limited | Responsables indépendants : distribution de l'application | Données liées à votre compte de store (3.6) | Irlande, avec transferts possibles hors UE selon leurs politiques |
| Autorités compétentes | Sur réquisition légale uniquement | Ce que nous détenons, c'est-à-dire presque rien, puisque nous n'avons accès à aucun contenu | France |

Nos sous-traitants sont liés par un contrat conforme à l'article 28 du RGPD. Ils offrent un niveau de protection au moins équivalent à celui décrit ici.

## 7. Transferts hors de l'Union européenne

Nous hébergeons le relais et le site **dans l'Union européenne** [À CONFIRMER selon l'hébergeur choisi]. Nous ne transférons pas vos données hors de l'UE. Apple et Google peuvent transférer des données hors de l'UE, notamment vers les États-Unis, dans le cadre de leurs propres politiques (EU-US Data Privacy Framework ou clauses contractuelles types de la Commission européenne).

[Si un prestataire est situé hors UE : « [PRESTATAIRE] est situé en [PAYS] ; le transfert est encadré par [décision d'adéquation / Data Privacy Framework / clauses contractuelles types], dont vous pouvez obtenir une copie à pierre@itsi-app.com. »]

## 8. Vos droits

Vous disposez des droits d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité de vos données. Vous pouvez aussi définir des directives sur leur sort après votre décès (article 85 de la loi Informatique et Libertés).

Pour les exercer, écrivez à **pierre@itsi-app.com** ou à 64 résidence Les Jardins de Saint-Colomban, 35350 Saint-Coulomb. Nous répondons dans un délai d'un mois.

Nous ne détenons ni vos contenus ni de compte à votre nom, et ne pouvons donc généralement pas vous identifier (article 11 du RGPD). Vous gardez la main directement sur votre appareil :

- supprimer vos mémoires et projets dans l'application ;
- désinstaller l'application, ce qui efface son stockage local ;
- retirer à tout moment les autorisations d'accès (appareil photo, photos, micro, réseau local, Bluetooth) dans les réglages de votre appareil.

Si vous estimez que vos droits ne sont pas respectés, vous pouvez introduire une réclamation auprès de la **CNIL** : 3 place de Fontenoy, TSA 80715, 75334 Paris Cedex 07, https://www.cnil.fr/fr/plaintes.

## 9. Autorisations demandées sur votre appareil

SetRemote ne demande une autorisation qu'au moment où vous utilisez la fonction concernée. Vous pouvez la refuser ou la retirer à tout moment. Seule cette fonction sera alors indisponible.

| Autorisation | Pourquoi | Ce que SetRemote ne fait pas |
|---|---|---|
| **Appareil photo** | Prendre une photo ou filmer une vidéo à diffuser sur l'écran de jeu ; piloter la **torche LED** de l'écran de jeu, car le système passe par l'appareil photo pour cela | Pas de capture en arrière-plan. Rien n'est envoyé ailleurs que vers votre appareil appairé. |
| **Photos et vidéos** | Choisir les images et vidéos à diffuser, la photo d'un appelant fictif ou un fond d'écran fictif. Quand le système le permet, seuls les éléments que vous sélectionnez sont accessibles. | Pas de parcours ni d'envoi de votre photothèque |
| **Micro** | **Uniquement quand vous filmez une vidéo** à diffuser : il enregistre le son de cette vidéo | Pas d'écoute en arrière-plan. Pas d'enregistrement en dehors du tournage de la vidéo. |
| **Réseau local** | Relier directement vos deux appareils sur le même réseau Wi-Fi ; recevoir des données DMX (sACN, Art-Net) avec la passerelle DMX | Pas de collecte d'informations sur les autres appareils du réseau |
| **Bluetooth** | Relier vos deux appareils sans Wi-Fi | Pas de localisation. Pas de recherche d'appareils autres que SetRemote. |

Certaines versions d'Android (11 et antérieures) exigent l'autorisation de **localisation** pour utiliser le Bluetooth. SetRemote **n'utilise pas et ne collecte pas** votre position.

Le réglage de la luminosité de l'écran, le maintien de l'écran allumé et la vibration ne demandent aucune donnée personnelle.

## 10. Enfants

SetRemote est un outil professionnel destiné aux équipes de tournage. Il ne s'adresse pas aux enfants de moins de 15 ans. Nous ne collectons sciemment aucune donnée les concernant, et l'application ne collecte d'ailleurs aucune donnée personnelle pour notre compte.

## 11. Sécurité

- **Chiffrement de bout en bout** de tous les messages entre la télécommande et l'écran de jeu (AES-256-GCM). Les clés sont dérivées sur les appareils lors de l'appairage et ne sont jamais envoyées à nos serveurs.
- Connexions **chiffrées en transit** (TLS vers le relais, DTLS pour la connexion directe).
- Le **relais ne stocke rien** et ne peut pas déchiffrer les messages.
- **Aucun compte**, donc aucun mot de passe à protéger chez nous.

Pour garder le contrôle :

- ne montrez le QR code ou le code d'appairage qu'aux personnes de confiance ;
- mettez fin à la session pour rompre l'appairage ;
- protégez vos appareils avec un code de verrouillage.

## 12. Avertissement photosensibilité

Ce point ne relève pas des données personnelles, mais il concerne votre sécurité. Le stroboscope (jusqu'à 30 Hz) et certains effets produisent des lumières clignotantes qui peuvent provoquer des crises chez les personnes photosensibles. Un avertissement s'affiche avant l'activation du stroboscope et des effets à flashs rapides. Prévenez les personnes présentes sur le plateau.

## 13. Modifications

Nous pouvons mettre à jour cette politique, par exemple si une fonction change. La date en haut de page indique la dernière version. En cas de changement important, nous vous en informerons dans l'application ou sur [SITE WEB] avant son entrée en vigueur.

## 14. Contact

ITSI APP — 64 résidence Les Jardins de Saint-Colomban, 35350 Saint-Coulomb — pierre@itsi-app.com — [SITE WEB]

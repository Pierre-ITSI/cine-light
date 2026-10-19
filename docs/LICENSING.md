# Version officielle : licence Tel + Séquence

> **État au 19 octobre 2026 : côté app, implémenté et testé** (désactivé dans
> ce dépôt : `LICENSING: 'off'`). Contrat client détaillé (vérification,
> jeton, statistiques) : [LICENCE-API.md](LICENCE-API.md). Le service de
> licence, la page d'achat (Stripe) et leur administration ne font pas
> partie de ce dépôt.
>
> Ce document **remplace** la conception précédente (clé de licence saisie dans
> l'app, une télécommande à la fois, baux Ed25519, essai de 30 jours puis
> quotas journaliers sur Média et Appel, maquettes 19 à 23). Le paquet
> [`packages/license`](../packages/license) qui l'implémentait reste dans le
> dépôt avec ses tests, mais **l'app ne l'utilise pas**.

## Sommaire

1. [Principes](#1-principes)
2. [Identifiant d'appareil](#2-identifiant-dappareil)
3. [Achat et activation](#3-achat-et-activation)
4. [Vérification et hors ligne](#4-vérification-et-hors-ligne)
5. [Aperçu sans licence](#5-aperçu-sans-licence)
6. [Réglages › Licence](#6-réglages--licence)
7. [Statistiques anonymes](#7-statistiques-anonymes)
8. [Version libre et auto-hébergée](#8-version-libre-et-auto-hébergée)
9. [Règles des stores](#9-règles-des-stores)
10. [Hébergement et sécurité](#10-hébergement-et-sécurité)
11. [Questions ouvertes](#11-questions-ouvertes)

---

## 1. Principes

- **Gratuit** : tout, sauf les onglets **Tel** (appels, SMS, notifications,
  discussions) et **Séquence**. Média, couleur, effets, flash, plusieurs
  écrans, passerelle DMX, tournage sans réseau : gratuits, sans quota ni
  essai. Les écrans de jeu n'ont jamais besoin de licence.
- **Licence** = fonctionnalités `tel` et `seq`, pour **1, 3 ou 5 appareils**
  (paliers d'achat ; l'administration peut fixer un autre maximum), valable
  6 mois. Les fonctionnalités peuvent être accordées séparément.
- **Pas de compte, pas de clé à saisir** : une licence liste des
  *identifiants d'appareil*. L'appareil prouve qu'il détient l'identifiant
  (signature) et reçoit un jeton signé.
- **Sans licence : aperçu**, jamais de blocage. Les onglets Tel et Séquence
  montrent des démos prêtes à jouer, sans limite (§5). **Plus d'essai de
  30 jours, plus de compteur du jour.**
- **Achat uniquement sur le site web** ; dans les apps iPhone / Android, aucun
  lien, prix ni mention d'achat : seul l'identifiant est affiché (§9).

## 2. Identifiant d'appareil

Chaque installation crée une paire de clés **ECDSA P-256** (WebCrypto), clé
privée non extractible, rangée dans IndexedDB. L'identifiant (`K7Q2-9XMB`)
est tiré de la clé publique : base32 de Crockford des 40 premiers bits de
SHA-256(SPKI). Il est aléatoire, ne dit rien de l'appareil ni de son
propriétaire, et ne sert à rien sans la clé privée (copié ailleurs, il ne
débloque rien). Créé à la première demande : au lancement de la version
officielle seulement. Détails : [LICENCE-API.md](LICENCE-API.md#identifiant-dappareil).

Effacer les données du site ou désinstaller l'app crée un **nouvel**
identifiant au lancement suivant : l'acheteur remplace alors l'ancien dans sa
licence (service client / administration).

## 3. Achat et activation

1. Dans l'app, Réglages › Licence › **Identifiant de cet appareil** :
   Copier / Partager (maquette 37).
2. Sur la page d'achat (`LICENCE_BUY_URL`, version web seulement) : nombre
   d'appareils (1, 3 ou 5), identifiants (format contrôlé, normalisé :
   `O` → `0`, `I` / `L` → `1`), e-mail ; paiement Stripe ; licence de 6 mois.
3. La licence s'active **toute seule** à la vérification suivante (au plus
   6 h, ou tout de suite par « Vérifier maintenant »).

Le lien d'achat de l'app ajoute l'identifiant de l'appareil (`?id=K7Q2-9XMB`)
pour préremplir le formulaire.

## 4. Vérification et hors ligne

- Requête signée au lancement, toutes les 6 h tant que l'app est ouverte et en
  ligne, et sur « Vérifier maintenant ». Réponse : jeton signé par le service
  (ECDSA P-256), vérifié dans l'app avec la clé publique embarquée
  (`LICENCE_PUBKEY`).
- **Hors ligne** : le dernier jeton valide suffit jusqu'à `exp` = min(fin de
  licence, vérification + 14 jours). Un échec réseau ne retire jamais rien.
- **Révocation, échéance** : le jeton suivant arrive sans fonctionnalité (il
  est signé, donc cru) ; à défaut de réseau, l'aperçu revient à `exp`.
- Jamais d'exception ni de blocage : au pire, l'onglet repasse en aperçu.

## 5. Aperçu sans licence

Maquettes validées **39** (Tel) et **39b** (Séquence), **sans le compteur du
jour** qu'elles montraient :

- bandeau « Aperçu · Tel » / « Aperçu · Séquence » : « Exemples prêts à jouer
  sur l'écran, non modifiables. La licence débloque vos propres appels, SMS et
  discussions » (Séquence : « … vos propres séquences ») ; pastille de
  l'identifiant (toucher : copier) ; « Obtenir une licence › » sur le web
  seulement ;
- **démos** ([`web/js/76-demos.js`](../web/js/76-demos.js)) :
  - Tel : un appel (Maman, mobile), un SMS (« Tu es où ? »), une notification
    d'une application fictive, une discussion avec Maman ;
  - Séquence « Démo — « Batterie à plat » » : SMS de Maman au GO →
    déverrouillage quand le comédien touche l'écran → discussion avec Maman
    (lecture auto) une fois déverrouillé → batterie faible après 25 s →
    extinction 8 s plus tard ;
- **verrouillé** : style et sonnerie (« Régler › » visible, non modifiable),
  champs, photos, sons, appelants enregistrés, enregistrer / supprimer /
  réordonner / renommer, ajout et édition d'étapes, « Téléphone au départ »,
  séquences et discussions enregistrées ;
- **libre et sans limite** : Faire sonner, Envoyer, Appeler n°…, discussion
  (GO, ↶, lecture auto), Séquence GO / ↶ / STOP / Recommencer, console DMX.

Les données de l'utilisateur ne sont **ni lues ni écrites** pendant l'aperçu :
les clés de stockage des onglets sont masquées par une copie en mémoire (la
démo), et ce que l'app y écrit reste en mémoire (photos et sons compris).
À l'arrivée de la licence, les onglets rechargent les données réelles, sans
redémarrer l'app ; le formulaire Tel en cours est rendu tel qu'il était.

**Fonctionnalités séparées** (cas rares, comportement simple) :

- Tel sous licence, Séquence en aperçu : la démo Séquence joue ses propres
  SMS et discussion. Son étape Discussion occupe le « Fil en cours » de Tel
  comme toute séquence : le fil de l'utilisateur est mis de côté et revient à
  « Recommencer » ou avec la licence Séquence.
- Séquence sous licence, Tel en aperçu : les étapes Appel / SMS /
  Notification / Discussion de l'utilisateur pointent vers ses éléments Tel,
  masqués : « élément introuvable », étape sautée, jusqu'à la licence Tel.
  Rien n'est perdu.

## 6. Réglages › Licence

Maquettes **37** (sans licence) et **37b** (licence active), en tête des
Réglages, version officielle seulement (absentes de la version libre) :

- **Licence** : « Aucune licence », ou « Active · jusqu'au 17 avril 2027 »
  (« expire dans n j » en orange les 7 derniers jours), Titulaire, Appareils
  « 3 sur 5 », Comprend « Tel, Séquence », Vérifiée « il y a 2 h », Hors ligne
  « valable jusqu'au 30 juil. » ; bouton **Vérifier maintenant** (un échec
  demandé s'affiche ; ceux des vérifications de fond restent discrets) ;
- **Identifiant de cet appareil** en grand, **Copier**, **Partager** (Web
  Share si disponible, sinon copie) ; sur le web et sans licence : « Transmettez
  cet identifiant lors de l'achat sur … » et **Obtenir une licence ›**.

## 7. Statistiques anonymes

Version officielle seulement, même service : au plus une fois par jour et par
mode (télécommande / écran de jeu), `{ os, ver, mode, inst }` — ni
identifiant, ni clé, ni contenu. Le service déduit le pays de l'adresse IP
puis l'oublie et n'incrémente que des compteurs journaliers. L'appareil ne
retient que la date du dernier envoi. Décrit dans la politique de
confidentialité (§ 3.10).

## 8. Version libre et auto-hébergée

- `LICENCE_BUILD.LICENSING: 'off'` dans `web/js/01-config.js` — **défaut du
  dépôt** : aucune vérification, aucune requête, aucune clé, aucun bandeau ;
  Tel et Séquence complets. L'interface est identique à celle d'avant la
  licence (captures de référence inchangées).
- Le build officiel fixe `LICENSING: 'on'` et `LICENCE_PUBKEY` (et au besoin
  `LICENCE_API`, `LICENCE_BUY_URL`). `window.SETREMOTE_CONFIG` ne peut que
  restreindre (activer, ou fournir ce que le build laisse vide) : un build
  officiel ne peut être ni désactivé ni détourné vers une autre clé par
  configuration.
- Un fork peut retirer la licence (AGPL) ; il ne peut ni se présenter comme
  SetRemote ([TRADEMARK.md](../TRADEMARK.md)) ni utiliser le service d'ITSI APP.

## 9. Règles des stores

Décision du propriétaire (17/10/2026), inchangée : **achat uniquement sur le
web, licence reconnue aussi dans les apps natives, sans achat intégré**.
Conditions respectées par l'app :

- **aucun prix, aucun bouton ni lien d'achat, aucune mention** du type
  « achetez sur notre site » dans les apps iPhone / Android (règle
  anti-incitation, App Store 3.1.1 / 3.1.3, Google Play « Paiements ») : la
  pastille et la carte n'affichent que l'identifiant, Copier, Partager ;
- l'app reste **utile sans licence** (tout le reste est gratuit, et les démos
  Tel / Séquence se jouent) ;
- il n'y a plus de « clé de licence » saisie dans l'app (cas cité par 3.1.1) :
  l'app montre un identifiant d'appareil et lit un droit acquis ailleurs, comme
  les apps « compagnon » d'un service professionnel (3.1.3(c)).

Risque résiduel : un relecteur peut assimiler ce déblocage à 3.1.1. Repli :
lien externe autorisé (UE / États-Unis) ou achat intégré. À revérifier au
lancement.

## 10. Hébergement et sécurité

- Le service de licence tourne à côté du relais (même nom d'hôte, chemins
  `/api/v1/…`) ; le kit de déploiement public n'en contient que les points
  d'extension génériques ([HOSTING.md](HOSTING.md)).
- Clé privée de signature des jetons : uniquement sur le serveur, jamais dans
  ce dépôt. L'app n'embarque que la clé publique. Rotation : publier d'abord
  une version de l'app avec la nouvelle clé publique.
- Requête signée par l'appareil, horodatée (± 10 min) et à usage unique
  (nonce) : un identifiant observé ne peut pas être rejoué.
- Le service ne garde rien pour un identifiant qui n'est rattaché à aucune
  licence ; pour un identifiant rattaché : dernière vérification, système,
  version et type d'installation.
- Le jeton n'est pas un secret (il ne vaut que pour la clé de l'appareil).

## 11. Questions ouvertes

1. Prix des paliers 1, 3, 5 appareils ; renouvellement (prolongation).
2. Remplacement d'un identifiant perdu (réinstallation) : en libre-service
   sur la page d'achat, ou par le service client seulement.
3. Lancement : vérifier que la CSP du site officiel autorise `https://` vers
   le service et que celui-ci répond au CORS (origine `null` des apps).

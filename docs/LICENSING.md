# Version officielle payante : conception des licences

> **État au 17 octobre 2026 : rien n'est implémenté côté paiement ni côté
> interface.** Ce document prépare la version payante. Ce qui existe déjà :
> le paquet [`packages/license`](../packages/license) (format des clés,
> vérification hors ligne des baux signés, avec ses tests) et le drapeau
> `LICENSING: 'off'` de `web/js/01-config.js`. **Aucun des deux n'est utilisé
> par l'app.** Aucune clé Stripe, aucun appel à Stripe dans ce dépôt.
>
> Les choix marqués **[DÉCISION]** reviennent au propriétaire (ITSI APP). Les
> mentions **« à vérifier »** signalent une information non confirmée à la
> source au moment de la rédaction.

## Sommaire

1. [Principes](#1-principes)
2. [Format de la clé](#2-format-de-la-clé)
3. [Parcours d'achat](#3-parcours-dachat)
4. [Service de licence : données](#4-service-de-licence--données)
5. [Une télécommande à la fois](#5-une-télécommande-à-la-fois)
6. [Hors ligne sur le plateau : les baux signés](#6-hors-ligne-sur-le-plateau--les-baux-signés)
7. [Ce que la licence débloque, et la version libre](#7-ce-que-la-licence-débloque-et-la-version-libre)
8. [Règles des stores : le risque principal](#8-règles-des-stores--le-risque-principal)
9. [Relais officiel et relais auto-hébergé](#9-relais-officiel-et-relais-auto-hébergé)
10. [Sécurité](#10-sécurité)
11. [Plan de mise en œuvre et estimation](#11-plan-de-mise-en-œuvre-et-estimation)
12. [Questions ouvertes](#12-questions-ouvertes)

---

## 1. Principes

- **Une licence = une télécommande**, valable **6 mois**, achetée **sur le
  site web** (Stripe), jamais dans les stores (voir §8 pour les conséquences).
- Les **écrans** n'ont jamais besoin de licence : seule la télécommande en
  porte une.
- **Une seule télécommande à la fois** par code. Toute télécommande qui
  connaît le code peut **reprendre** la licence (« déplacer la licence ici »)
  ou **libérer** le siège.
- **Aucun compte** SetRemote : le code de licence est le seul identifiant.
  Pas d'adresse e-mail stockée chez nous.
- **Fonctionne hors ligne** sur le plateau : la télécommande garde un bail
  signé de quelques jours, vérifié localement.
- La **version libre / auto-hébergée** ne vérifie rien : `LICENSING: 'off'`,
  aucune requête, aucun écran de licence.

## 2. Format de la clé

Implémenté dans [`packages/license/key.js`](../packages/license/key.js),
testé dans `packages/license/test/key.test.js`.

```
7K3M-9QXR-2D42          12 caractères, 3 groupes de 4
└──── 11 données ───┘└ contrôle
```

| Élément | Choix |
|---|---|
| Alphabet | Base32 de Crockford : `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (sans I, L, O, U) — 32 symboles, 5 bits chacun |
| Données | 11 caractères tirés par `crypto.getRandomValues` (« octet & 31 » : sans biais, 256 étant multiple de 32) |
| Contrôle | 12e caractère = Σ αⁱ⁺¹·dᵢ dans GF(32), polynôme primitif x⁵ + x² + 1 |
| Saisie | casse indifférente ; espaces, tirets (y compris –, —), points et soulignés ignorés ; chiffres pleine largeur (NFKC) ; **O → 0, I → 1, L → 1** ; U refusé |

**Entropie.** 11 × 5 = **55 bits** après le caractère de contrôle (exigence :
≥ 50). Soit 3,6 × 10¹⁶ clés possibles. Avec 100 000 licences vendues, une clé
tirée au hasard a une chance sur 3,6 × 10¹¹ d'être valide : avec la limite de
débit du §5.4 (quelques dizaines d'essais par jour et par adresse IP), deviner
une clé en ligne est hors de portée. Hors ligne, l'empreinte stockée est
protégée par un secret serveur (§4.2), sans quoi 2⁵⁵ calculs SHA-256
resteraient faisables pour un attaquant équipé : c'est pourquoi on ne stocke
pas un simple SHA-256.

**Caractère de contrôle.** Il attrape les fautes de frappe **sans réseau**,
avant tout appel au service :

- 100 % des substitutions d'un caractère (poids non nuls) ;
- 100 % des permutations de deux caractères différents, adjacents ou non
  (le changement vaut (wᵢ + wⱼ)(a + b), produit de deux non-nuls dans un
  corps ; les poids αⁱ sont distincts car α est d'ordre 31) ;
- toute autre erreur passe avec une probabilité de 1/32.

Un simple « somme modulo 32 » ne détecterait aucune permutation ; le symbole
de contrôle officiel de Crockford (modulo 37) ajoute des symboles `*~$=U` hors
alphabet. D'où ce choix.

**Formes.** Canonique = 12 caractères sans tiret (stockage, calcul
d'empreinte) ; affichée = `XXXX-XXXX-XXXX`. `formatKeyInput()` met en forme
pendant la saisie.

## 3. Parcours d'achat

```
 Navigateur                    Stripe                      Service de licence (VPS, hub.itsi-app.com)
 ──────────                    ──────                      ───────────────────────────────────────────
 Page « Licence » (site web)
   │  POST /v1/checkout ──────────────────────────────────▶ crée une Checkout Session (clé API Stripe
   │                                                         restreinte, côté serveur), renvoie l'URL
   │◀──────────────────────── 303 vers Stripe Checkout
   │  paiement (CB, Apple Pay…), TVA (Stripe Tax), facture
   │                           │ checkout.session.completed
   │                           └──── webhook signé ───────▶ vérifie la signature, paiement « paid »,
   │                                                         crée la licence, dérive la clé (§4.2)
   │◀── redirection success_url?session_id={CHECKOUT_SESSION_ID}
   │  GET /v1/checkout/<session_id>/key ──────────────────▶ « en attente » tant que le webhook n'est pas
   │◀─────────────────────────── clé XXXX-XXXX-XXXX ─────── traité ; puis la clé (affichage unique)
```

### 3.1 Stripe Checkout depuis l'app web

- Un bouton « Acheter une licence » sur une page **du site web**
  (`set-remote.itsi-app.com/licence`), pas dans l'app native (§8).
- Le service crée la **Checkout Session** côté serveur (`mode: 'payment'`, un
  `price` « Licence SetRemote — 1 télécommande — 6 mois »), avec :
  - `automatic_tax: { enabled: true }` (Stripe Tax, §3.3) ;
  - `invoice_creation: { enabled: true }` (facture PDF envoyée par Stripe) ;
  - `consent_collection` / `custom_text` pour la **renonciation au droit de
    rétractation** : contenu numérique fourni immédiatement, le consommateur
    doit y consentir expressément (Code de la consommation, art. L221-28 13°
    — à faire valider) ;
  - `success_url` = `…/licence/merci?session_id={CHECKOUT_SESSION_ID}`.
- **Webhook** `checkout.session.completed` (et
  `checkout.session.async_payment_succeeded` pour les moyens de paiement
  différés) reçu par le service, **signature `Stripe-Signature` vérifiée**
  (§10.3). On ne crée la licence que si `payment_status === 'paid'`.
- `charge.refunded` / `charge.dispute.created` → licence révoquée (§5.3).
- **Page de succès** : elle interroge le service avec le `session_id` (long,
  imprévisible, fourni par Stripe). Tant que le webhook n'est pas arrivé, le
  service répond « en attente » et la page réessaie (≈ 30 s). La clé est
  affichée avec « Copier » et « Enregistrer (.txt) », et l'invitation à la
  saisir dans **Réglages → Licence** de la télécommande.

### 3.2 Envoi de la clé par e-mail : arbitrage

| Option | Pour | Contre |
|---|---|---|
| **A. Reçu / facture Stripe seuls** | rien à opérer ; adresse jamais chez nous | Stripe ne peut pas y mettre une clé créée **après** le paiement : le client qui ferme la page perd sa clé (support) |
| **B. E-mail transactionnel envoyé par le service** (SMTP OVH ou Brevo) | clé retrouvable dans la boîte mail ; texte à nous (FR/EN, mode d'emploi) | la clé (secret au porteur) transite en clair par e-mail ; l'adresse, lue dans le webhook, passe chez un prestataire d'envoi ; délivrabilité (SPF, DKIM, DMARC) à soigner |
| **C. Clé pré-générée dans un champ de facture Stripe** (`invoice_data.custom_fields`) | une seule communication, la facture | la clé est **stockée chez Stripe** (tiers) et figée avant paiement ; détournement d'un champ prévu pour autre chose |

**Recommandation : A + B.** Stripe envoie reçu et facture (comptabilité) ; le
service envoie **un** e-mail avec la clé, sans conserver l'adresse (elle est
lue dans l'événement Stripe, utilisée pour l'envoi, jamais écrite en base).
Un client qui a perdu sa clé écrit au support : la clé est **re-dérivable**
depuis l'identifiant de session Stripe (§4.2), après vérification de l'achat
dans le tableau de bord Stripe. **[DÉCISION]**

### 3.3 TVA et factures

- **Stripe Tax** calcule la TVA selon le pays du client (vente B2C de
  services électroniques dans l'UE : TVA du pays de l'acheteur, déclarée via
  le guichet unique **OSS** ; seuil de 10 000 € de ventes intra-UE à
  surveiller — à vérifier avec le comptable). Prix affiché **TTC**.
- Achats professionnels : collecte du numéro de TVA (`tax_id_collection`),
  autoliquidation calculée par Stripe Tax.
- **Factures** émises par Stripe (numérotation continue, mentions légales de
  l'éditeur à paramétrer dans Stripe : raison sociale, adresse, SIREN, TVA).
- Conservation des pièces comptables : 10 ans (Code de commerce L123-22),
  **chez Stripe** et dans la comptabilité d'ITSI APP, pas dans le service de
  licence.

### 3.4 Aucun compte

Le code est le seul titre. Conséquences assumées : pas de « mot de passe
oublié » ; le support retrouve un achat par l'e-mail **dans Stripe**, jamais
dans notre base ; un code partagé est un code prêté (le siège unique, §5,
limite l'usage simultané).

**Renouvellement** : au bout de 6 mois, racheter une licence (nouveau code)
**ou** « prolonger ce code » (Checkout avec le `lid` en métadonnée, `lexp`
+ 6 mois). **[DÉCISION]** — la prolongation évite de ressaisir un code sur le
plateau.

## 4. Service de licence : données

Petit service Node (même VPS, derrière Caddy, à côté du relais :
`hub.itsi-app.com/licence/…` ou un sous-domaine), base **SQLite**, aucune
dépendance lourde.

### 4.1 Modèle minimal

```sql
CREATE TABLE licence (
  lid              TEXT PRIMARY KEY,   -- identifiant opaque aléatoire (128 bits), figure dans les baux
  key_mac          BLOB NOT NULL UNIQUE, -- HMAC-SHA-256(PEPPER, clé canonique) — jamais la clé brute
  key_gen          INTEGER NOT NULL DEFAULT 0, -- n° de réémission (clé compromise → nouvelle clé)
  stripe_session   TEXT NOT NULL UNIQUE, -- cs_… (idempotence du webhook, support)
  stripe_payment   TEXT,               -- pi_… (remboursements, litiges)
  livemode         INTEGER NOT NULL,   -- 0 = mode test Stripe
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,   -- created_at + 6 mois (lexp des baux)
  revoked_at       INTEGER,            -- remboursement, litige, fraude
  seat             TEXT,               -- identifiant d'installation titulaire, NULL = siège libre
  seat_since       INTEGER,
  lease_issued_at  INTEGER            -- dernier bail émis
);
CREATE TABLE seat_event (               -- historique LIMITÉ (anti-abus, support)
  lid    TEXT NOT NULL REFERENCES licence(lid) ON DELETE CASCADE,
  at     INTEGER NOT NULL,
  kind   TEXT NOT NULL,                 -- activate | takeover | release | renew-denied
  seat_h BLOB NOT NULL                  -- HMAC(PEPPER, seat) : comparer sans conserver l'identifiant
);
```

Pas d'e-mail, pas de nom, pas d'adresse IP en base. Le **siège** est un
identifiant d'installation aléatoire de 128 bits (`randomId()`), créé par
l'app au premier lancement de l'écran Licence et gardé dans son stockage local
— **pas** un identifiant matériel (empreinte d'appareil proscrite par les règles de confidentialité d'Apple, 5.1.2, à vérifier ;
et inutile ici). Réinstaller l'app = nouveau siège : il suffit de
« déplacer la licence ici ».

### 4.2 La clé brute n'est jamais stockée

- **Empreinte** : `key_mac = HMAC-SHA-256(PEPPER, clé canonique)`. `PEPPER`
  (32 octets aléatoires) vit dans le `.env` du VPS, pas dans la base : une
  fuite de la base seule ne permet ni de retrouver ni de tester des clés.
  Recherche directe par `key_mac` (index unique), pas de sel par ligne
  (impossible de chercher sinon).
- **Dérivation déterministe** : `clé = Crockford(HMAC-SHA-256(KEY_SECRET,
  stripe_session ‖ key_gen))` tronqué à 55 bits + caractère de contrôle. Le
  service peut ainsi **réafficher** la clé sur la page de succès (et la
  re-dériver pour le support) sans l'avoir écrite nulle part. Justification :
  pas de stockage temporaire en clair, pas de chiffrement réversible à gérer.
  Contrepartie : `KEY_SECRET` + la base suffisent à recalculer toutes les
  clés. Il est donc distinct de `PEPPER` et de la clé de signature, en
  `.env` (chmod 600), sauvegardé hors du VPS, et une clé compromise se
  remplace en incrémentant `key_gen`.
- La page de succès ne montre la clé que pour une session `paid`, pendant
  **24 h** après le paiement (au-delà : support).

### 4.3 Conservation (RGPD)

| Donnée | Durée | Base légale |
|---|---|---|
| Ligne `licence` | jusqu'à `expires_at` + 12 mois (remboursements, litiges), puis suppression | exécution du contrat |
| `seat_event` | 20 derniers événements **et** 90 jours glissants au plus | intérêt légitime (anti-abus) |
| Journaux HTTP du service | 14 jours, sans corps de requête ni clé | intérêt légitime (sécurité) |
| E-mail, nom, adresse, moyen de paiement | **jamais chez nous** : chez Stripe (factures 10 ans) | obligation légale (comptabilité) |

La politique de confidentialité devra décrire ce traitement (Stripe en
sous-traitant / responsable indépendant pour le paiement, service de licence
hébergé chez OVH en France). Les **baux** ne contiennent aucune donnée
personnelle (§6.1).

## 5. Une télécommande à la fois

### 5.1 API (corps JSON, jamais la clé dans l'URL)

| Requête | Réponse |
|---|---|
| `POST /v1/activate {key, seat}` | siège libre ou déjà à ce siège → **bail** ; tenu par un autre → `409 {held: true, since}` |
| `POST /v1/activate {key, seat, takeover: true}` | le siège passe à `seat` → **bail** ; l'ancien titulaire le perd |
| `POST /v1/renew {key, seat}` | `seat` titulaire → nouveau bail ; sinon `409 {seatLost: true}` |
| `POST /v1/release {key}` | siège libéré (depuis n'importe quelle télécommande qui connaît le code) |
| `GET`-équivalent `POST /v1/status {key, seat}` | `{expiresAt, seatHeld, isThisSeat}` — rien sur l'autre titulaire |

La clé est validée **localement** (caractère de contrôle) avant tout appel.

### 5.2 Reprise du siège (B reprend à A)

1. B saisit le code. Le service répond « utilisée sur une autre télécommande
   depuis le … ».
2. B affiche un choix **explicite** : « Déplacer la licence sur cette
   télécommande ? L'autre télécommande la perdra. » (écran 4, §11.3).
3. B confirme → `takeover: true` → B reçoit un bail.
4. A **perd le siège à sa prochaine vérification** : au prochain
   renouvellement (en ligne), réponse `seatLost` → A efface son bail et
   affiche « Licence déplacée sur une autre télécommande ». **Hors ligne, A
   continue jusqu'à la fin de son bail** (§6.3) : c'est le prix du
   fonctionnement hors ligne, borné par la durée du bail.

### 5.3 Libérer le siège, révocation

- « Libérer la licence » (depuis A ou depuis toute télécommande qui a le
  code) → siège vide ; le bail en cours de A reste valable hors ligne jusqu'à
  son terme, mais n'est plus renouvelé.
- **Révocation** par ITSI APP (remboursement, litige, fraude) → `revoked_at`
  ; tout renouvellement échoue ; même délai de propagation que ci-dessus.
- Pas de liste de révocation poussée aux appareils : la durée courte des
  baux suffit (7 jours + grâce).

### 5.4 Anti-abus

- **Débit par IP** : 10 requêtes / minute, 200 / jour ; **5 clés
  invalides / heure** puis attente exponentielle (devinette de clés).
- **Par licence** : 3 reprises de siège / 24 h et 10 / 30 jours ; au-delà
  `429` « contactez le support » (signe de partage du code entre équipes).
- **Historique limité** : 20 derniers événements, 90 jours (§4.3) — de quoi
  juger un abus, pas de quoi suivre quelqu'un.
- Le siège est comparé par HMAC dans l'historique : on peut dire « déjà vu »
  sans conserver l'identifiant.
- Mêmes protections au webhook : signature, horodatage, idempotence.

## 6. Hors ligne sur le plateau : les baux signés

Implémenté côté vérification dans
[`packages/license/lease.js`](../packages/license/lease.js) (tests :
`packages/license/test/lease.test.js`, clés générées à la volée).

### 6.1 Le bail

```
SRL1.<charge utile JSON en base64url>.<signature Ed25519 base64url>
```

```json
{ "v": 1, "kid": "k2026a", "lid": "q3J…22c", "seat": "Zx8…22c",
  "iat": 1800000000, "exp": 1800604800, "lexp": 1815552000, "feat": ["official"] }
```

- Signé **Ed25519** par le service ; la signature couvre `SRL1.<charge>`
  (séparation de domaine).
- **Champs exacts** : tout champ en plus est refusé par l'app — impossible d'y
  glisser une donnée personnelle par mégarde. `lid` est un identifiant
  aléatoire (ni la clé, ni son empreinte) ; `seat` l'identifiant
  d'installation.
- `exp − iat` ≤ 31 jours (refus au-delà, même signé), `exp ≤ lexp`.

### 6.2 Cycle de vie sur la télécommande

| Paramètre | Proposition | Rôle |
|---|---|---|
| Durée du bail **N** | **7 jours** | autonomie hors ligne garantie |
| Renouvellement | à chaque ouverture **en ligne**, si le bail a plus de 24 h | le bail reste « plein » |
| Délai de grâce | **3 jours** après `exp` | bandeau d'avertissement, fonctions conservées |
| Après la grâce | fonctions payantes verrouillées, jamais en plein tournage sans avertissement préalable | |
| Fin de licence (`lexp`) | pas de grâce au-delà ; rappels 14 j et 3 j avant | |
| Tolérance d'horloge | 5 min sur `iat` | |

**[DÉCISION]** N et la grâce : 7 + 3 jours couvrent une semaine de tournage
sans réseau. Plus long = plus de confort, mais une reprise de siège met plus
longtemps à s'appliquer.

**Horloge reculée.** Hors ligne, on ne peut pas prouver l'heure. Mesure
proposée : l'app retient l'heure la plus tardive déjà vue (y compris `iat`
des baux) ; une horloge qui recule de plus de 24 h sous ce repère force une
vérification en ligne. Le gain pour un fraudeur reste borné par `lexp`.

### 6.3 Propagation d'une reprise de siège

```
jour 0   A active (bail jusqu'à J7)          siège = A
jour 2   B « déplace la licence ici »        siège = B, B reçoit un bail jusqu'à J9
         ├─ A en ligne : renouvellement refusé dès sa prochaine ouverture → A verrouillée (message clair)
         └─ A hors ligne : A fonctionne jusqu'à J7, puis grâce jusqu'à J10, puis verrouillée
```

Deux télécommandes peuvent donc fonctionner ensemble **au plus N + grâce
jours** (10 jours) si l'une reste hors ligne. C'est la contrepartie du
fonctionnement sans réseau. On peut raccourcir la grâce pour un bail issu
d'une reprise **[DÉCISION]**.

### 6.4 Ed25519 dans les WebView : prise en charge et repli

La télécommande vérifie le bail **dans la page** (PWA ou WebView de l'app
native), par WebCrypto `subtle.verify({name: 'Ed25519'})`. Prise en charge
(sources : billet IPFS d'août 2025, notes de version ; tableau caniuse **à
vérifier**) :

| Moteur | Ed25519 WebCrypto |
|---|---|
| Safari / WKWebView | Safari **17.0** (sept. 2023) → iOS 17+ — à vérifier pour WKWebView (même moteur WebKit, attendu identique) |
| Chrome / Android System WebView | Chrome **137** (mai 2025) ; la WebView Android suit Chrome (mise à jour par le Play Store) |
| Firefox | **129** (août 2024) |
| Node.js | 22 (utilisé par les tests et le futur service) |
| Hermes (React Native) | pas de WebCrypto ; sans objet : la vérification se fait dans la WebView |

`ed25519Support()` ne se fie pas à la détection de nom : elle **vérifie le
vecteur de test 1 de la RFC 8032** et qu'une signature altérée est refusée.

**Repli** si `'none'` (iOS < 17, WebView Android pas à jour) :
`setEd25519Verifier(fn)` accepte un vérificateur injecté, soumis au même
autotest :

1. **app native** : un petit module natif (CryptoKit
   `Curve25519.Signing.PublicKey.isValidSignature` sur iOS 13+ ; Android :
   `java.security` Ed25519 sur API 33+, sinon Tink/BouncyCastle) exposé par le
   pont existant — recommandé ;
2. **PWA** : implémentation JavaScript auditée (`@noble/ed25519`, MIT, à
   vendre dans `vendor/` avec son entrée dans THIRD_PARTY_NOTICES) chargée à
   la demande, comme jsQR.

Sans vérificateur, le statut est `invalid / unsupported`, **jamais
`valid`**. Politique de l'app dans ce cas **[DÉCISION]** : recommandation,
ne pas verrouiller une télécommande qui a été vue valide en ligne dans les
dernières 24 h (le service a déjà vérifié), afficher « mettez à jour votre
système » sinon.

## 7. Ce que la licence débloque, et la version libre

### 7.1 Build officiel (`LICENSING: 'on'`, servi par ITSI APP) — décidé le 17/10/2026

**[DÉCIDÉ]** Seuls les onglets **Média** et **Appel** (appels, SMS, messages)
sont concernés. Tout le reste (couleur, effets, flash, QR, plusieurs écrans,
passerelle DMX, hors ligne) reste gratuit sans limite. Les écrans de jeu sont
toujours gratuits.

| Période (par télécommande) | Média | Appel / SMS / message |
|---|---|---|
| Jours 1 à 30 (essai) | illimité | illimité |
| Après 30 jours, sans licence | 5 envois de médias par jour | 5 déclenchements par jour (tous types confondus) |
| Avec licence (6 mois) | illimité | illimité |

- **Aucun texte dans l'interface** n'annonce l'essai ni les quotas : ils
  figurent uniquement dans les conditions générales. L'interface n'apparaît
  qu'au moment où une action est bloquée (quota du jour atteint) : elle
  propose alors de s'authentifier (voir §7.3). Ce message sera maquetté et
  validé avant implémentation.
- **Ce qui compte comme un envoi** (à confirmer sur maquette) : un média
  affiché sur au moins un écran (sélection dans le pool ou avance), un appel,
  un SMS ou un message déclenché (télécommande, liste numérotée ou console
  DMX). Rejouer le même média ne recompte pas dans la journée.
- **Journée** : jour calendaire local de la télécommande, remise à zéro à
  minuit.
- **Début de l'essai** : premier lancement de la télécommande sur l'appareil.
  Sans compte, l'essai et les compteurs vivent sur l'appareil : une
  réinstallation les remet à zéro. Variante plus robuste : enregistrer la
  date de premier usage auprès du service de licence avec l'identifiant
  d'installation (ne survit pas non plus à une réinstallation). Choix
  assumé : le modèle repose sur la bonne foi des professionnels, le code
  étant de toute façon libre.
- **DMX** : la console qui déclenche un appel ou un SMS consomme le même
  quota. Quota épuisé : l'appel n'est pas lancé et la télécommande affiche
  la demande d'authentification (pas l'écran de jeu, qui reste neutre sur
  le plateau).

### 7.3 Authentification par le site (web view)

**[DÉCIDÉ]** Quand une licence est demandée, l'app ouvre une page du site
d'ITSI APP dans une **web view**, qui invite à saisir la clé de licence ; la
page renvoie ensuite à l'app par une **URL de retour**.

Conception proposée :
- **App native** : `expo-web-browser` `openAuthSessionAsync` (iOS
  `ASWebAuthenticationSession`, Android Custom Tabs) avec le schéma de
  retour `setremote://licence`. **PWA** : redirection vers la page de
  licence puis retour sur l'app, résultat dans le **fragment** de l'URL
  (`#licence=…`), jamais dans la requête (pas de trace dans les journaux).
- **Ce qui revient** : pas la clé brute, mais le **bail signé** du §6
  (et l'identifiant de siège). La page vérifie la clé auprès du service,
  gère la reprise de siège (§5.2) et renvoie le bail. La clé n'apparaît
  ainsi jamais dans une URL ; l'app garde seulement le bail, qu'elle
  renouvelle en arrière-plan.
- **Paramètres d'appel** : `seat` (identifiant d'installation),
  `state` (valeur aléatoire anti-rejeu, vérifiée au retour),
  `src=app|web`.
- **Règles des stores** : quand `src=app`, la page **n'affiche ni prix, ni
  bouton, ni lien d'achat** — uniquement le champ de clé et « Libérer le
  siège ». La page d'achat Stripe n'est accessible que depuis le site,
  hors de l'app (§8.4).
- La même page sert à libérer ou reprendre le siège depuis n'importe quelle
  télécommande qui connaît le code (§5.3).

### 7.4 Version libre / auto-hébergée

- `LICENSING: 'off'` dans `web/js/01-config.js` — **valeur par défaut du
  dépôt**, constante de build (ni `window.SETREMOTE_CONFIG` ni la coque native
  ne peuvent la changer).
- `'off'` = aucune vérification, **aucune requête** au service de licence,
  aucun écran ni bandeau de licence, toutes les fonctions. Le paquet
  `packages/license` n'est même pas chargé.
- Le build officiel est le seul à passer `'on'` (commit de publication ou
  variable de build), avec les clés publiques de signature. Un fork peut le
  retirer : c'est permis par l'AGPL ; il ne peut pas en revanche se présenter
  comme SetRemote (TRADEMARK.md) ni utiliser le service d'ITSI APP.

## 8. Règles des stores : le risque principal

### 8.1 Apple (App Store Review Guidelines)

Texte consulté le **17 octobre 2026** sur
`developer.apple.com/app-store/review/guidelines/` :

- **3.1.1** : « If you want to unlock features or functionality within your
  app […] you must use in-app purchase. Apps may not use their own mechanisms
  to unlock content or functionality, such as **license keys**, augmented
  reality markers, QR codes […] ». Notre clé est exactement le cas cité.
- **3.1.3(b) Multiplatform Services** : une app peut donner accès à ce qui a
  été acheté sur une autre plateforme ou sur le site web, « **provided those
  items are also available as in-app purchases within the app** ».
- **3.1.3** : les apps de cette section ne peuvent pas inciter, dans l'app, à
  payer ailleurs, **sauf sur la vitrine des États-Unis** et dans les cas de
  3.1.1(a).
- **3.1.1(a)** : liens vers d'autres moyens d'achat via les *StoreKit
  External Purchase Link Entitlements*, limités à certaines vitrines ; **aux
  États-Unis, boutons et liens externes sont permis sans entitlement**.
- **3.1.3(a) Reader** (magazines, livres, audio, musique, vidéo) et
  **3.1.3(f)** (compagnon gratuit d'un outil web de VoIP, stockage, e-mail ou
  hébergement) : **SetRemote n'entre dans aucune de ces catégories**.
- **UE (DMA)** : conditions alternatives (liens de sortie, paiement tiers,
  commissions spécifiques) décrites hors des guidelines, page « DMA and apps
  in the EU » : **à vérifier** (montants et conditions changent souvent).

### 8.2 Google Play

Règle « Paiements » : Google Play Billing obligatoire pour débloquer des
fonctions numériques, avec interdiction d'orienter vers un autre paiement,
sauf programmes : **facturation alternative / choix de l'utilisateur** et
**offres externes**. Depuis le **30 juin 2026** (accord avec Epic), ces
programmes couvrent **États-Unis, Royaume-Uni et EEE** avec inscription,
écran de choix et frais de service réduits mais non nuls (presse spécialisée,
juin 2026 ; page officielle `support.google.com/googleplay/android-developer/answer/17161464`
non consultable depuis cet environnement : **à vérifier**).

### 8.3 Les options

| | Option | Pour | Contre |
|---|---|---|---|
| **1** | **Licence imposée seulement dans la PWA (web)** ; apps natives gratuites, sans licence (`LICENSING: 'off'` dans les binaires des stores) | aucun risque de refus ; zéro commission ; simple ; cohérent avec la version libre | les fonctions de l'app native (passerelle DMX en UDP, liaison locale Wi-Fi / Bluetooth) ne rapportent rien ; un utilisateur peut éviter de payer en installant l'app |
| **2** | **IAP dans les apps natives aussi** (achat intégré non renouvelable « 6 mois », même offre qu'en web ; App Store Server Notifications / Play Developer API → le service crée la licence) ; une clé web marche alors dans l'app (3.1.3(b)) | conforme partout ; achat en un geste dans l'app | commission 15 % (programme petites entreprises Apple / Google) ; double tuyauterie (Stripe + 2 stores) ; prix alignés ; remboursements gérés par les stores ; ≈ 2 à 3 semaines de travail |
| **3** | **Liens externes par région** : bouton « Acheter sur le site » aux États-Unis (sans entitlement), entitlements UE/DMA, programmes Google US/UK/EEE | paiement Stripe même depuis l'app dans ces régions | **ne lève pas 3.1.1** : débloquer par clé reste interdit sans IAP (à vérifier pour les États-Unis) ; règles par pays, frais DMA, suivi juridique permanent ; le reste du monde n'est pas couvert |
| **4** | **Apps natives sans aucun parcours d'achat**, qui se contentent de lire une licence achetée ailleurs | aucun lien, aucun prix dans l'app | **toujours risqué** : 3.1.1 vise le *déblocage* lui-même (« license keys » cités), pas seulement l'achat ; 3.1.3(b) n'autorise l'accès multiplateforme que si l'IAP existe aussi ; ni « Reader » ni 3.1.3(f). Refus probable à la revue, ou retrait plus tard |

### 8.4 Décision du propriétaire (17/10/2026)

**Retenu : achat uniquement sur la version web, licence acceptée aussi dans
les apps natives, sans achat intégré.** Le propriétaire applique déjà ce
modèle à une autre application d'ITSI APP (abonnement vendu seulement sur le
site, app acceptée sur les stores, version navigateur disponible).

Conditions à respecter dans les apps natives pour rester dans ce cadre
(c'est le profil des apps « compagnon » d'un service vendu ailleurs) :

- **aucun prix, aucun bouton ni lien d'achat, aucune mention** du type
  « achetez sur notre site » dans l'app (règle anti-incitation 3.1.1 /
  3.1.3) ; l'app se contente d'un champ « Code de licence » ;
- l'app reste **utile sans licence** (version libre complète) ;
- la fiche store et les notes App Review décrivent le code comme l'accès à
  un service souscrit ailleurs, sans parler d'achat dans l'app ;
- le public visé est professionnel (équipes de tournage, sociétés de
  production), ce qui rapproche du cas 3.1.3(c) « Enterprise Services ».

Risque résiduel : la lettre de 3.1.1 cite les clés de licence ; un refus
reste possible selon le relecteur. Repli prévu : option 3 (lien externe
autorisé, UE / États-Unis) ou option 2 (achat intégré). À revérifier au
lancement de la version payante. **[DÉCIDÉ]**

## 9. Relais officiel et relais auto-hébergé

| | A. Relais officiel ouvert à tous (recommandé au lancement) | B. Relais officiel réservé aux télécommandes sous licence |
|---|---|---|
| Fonctionnement | le relais `hub.itsi-app.com` relaie toute session, limites de débit comme aujourd'hui | à la création d'une salle, la télécommande présente son bail ; le relais vérifie la signature (clé publique seulement, pas de base) |
| Utilisateurs gratuits | utilisent le relais officiel | **auto-hébergent** le relais (relay/deploy) ou restent en réseau local / broker public |
| Apps natives gratuites (option 1) | fonctionnent | n'ont plus de relais officiel : incohérent avec l'option 1, sauf relais public séparé |
| Coût | trafic de tous à la charge d'ITSI APP (faible : trames chiffrées courtes ; vidéo en pair-à-pair) | maîtrisé |
| Confidentialité | inchangée | le relais voit `lid`/`seat` (identifiants opaques, sans donnée personnelle) et peut corréler les sessions d'une même licence — à mentionner dans la politique |
| Effort | aucun | ≈ 1 à 2 jours (vérification du bail dans `relay/server.js`, tests) |

Recommandation : **A** ; passer à **B** seulement si le coût du relais
l'exige, après avoir tranché le cas des apps natives. **[DÉCISION]**

## 10. Sécurité

### 10.1 La clé est un secret au porteur

Qui la connaît peut reprendre le siège. Donc : jamais dans une URL, un
journal, un rapport de plantage ou un QR code ; corps de requête HTTPS
seulement ; dans l'app, stockée localement (PWA : stockage de la page ; app
native : Keychain / Keystore via un stockage sécurisé, nouvelle dépendance à
ajouter le moment venu) et affichée masquée (`XXXX-••••-••XX`). Réémission
possible (`key_gen`, §4.2) si elle fuit.

### 10.2 Baux signés et clé de signature

- Clé privée Ed25519 **uniquement sur le VPS**, dans le `.env` du service
  (`chmod 600`, propriétaire dédié), **jamais dans le dépôt** ni dans une
  image Docker publiée ; sauvegarde chiffrée hors ligne.
- L'app embarque les **clés publiques** par `kid` (`keys: { k2026a: '…' }`).
- **Rotation** (planifiée, annuelle) :
  1. générer `k2027a`, publier sa clé publique dans une version de l'app
     **avant** de s'en servir ;
  2. quand la grande majorité des installations l'a, signer les nouveaux baux
     avec `k2027a` ;
  3. retirer `k2026a` de l'app **au moins 31 jours** après (durée maximale
     d'un bail).
- **Compromission** : arrêter de signer avec la clé, publier une version de
  l'app qui la retire ; les faux baux restent bornés à 31 jours par l'app, et
  à la durée de mise à jour des installations.

### 10.3 Webhook Stripe

- Secret `whsec_…` dans le `.env`, différent en mode test et en production.
- Vérification de `Stripe-Signature` (HMAC-SHA-256 sur `t.` + corps **brut**,
  comparaison à temps constant, horodatage ≤ 5 min), avant toute lecture du
  JSON.
- Idempotence par `event.id` et `stripe_session` unique (Stripe rejoue les
  événements).
- On ne fait confiance qu'aux champs de l'événement signé (montant, statut),
  jamais aux paramètres de la page de succès.
- Clé API Stripe **restreinte** (`rk_…`, droits minimaux : Checkout Sessions
  en écriture, rien d'autre), dans le `.env`.

### 10.4 Pas de données personnelles dans les baux

Garanti par le format (§6.1, champs exacts, identifiants à motif
`[A-Za-z0-9_-]`), testé (`leasePayloadProblem` refuse un champ `email` ou un
siège contenant `@`).

### 10.5 Divers

TLS par Caddy ; service sans état hors SQLite ; secrets jamais journalisés ;
sauvegarde quotidienne chiffrée de la base ; dépendances minimales.

## 11. Plan de mise en œuvre et estimation

### 11.1 Phases

| Phase | Contenu | Effort (jours de dev) |
|---|---|---|
| **0 — Préparation** (fait) | ce document, `packages/license`, drapeau `LICENSING: 'off'` | — |
| **1 — Décisions et maquettes** | trancher les **[DÉCISION]** ; maquettes des écrans §11.3 validées par le propriétaire ; CGV, mentions légales, politique de confidentialité (avocat) | 1 à 2 + délais de validation |
| **2 — Service de licence** | Node + SQLite dans `relay/deploy` (Docker, Caddy) : webhook, dérivation de clé, activation / reprise / libération / renouvellement, baux, limites de débit, rétention automatique, tests | 5 à 7 |
| **3 — Stripe** | produit et prix, Stripe Tax (inscription OSS), Checkout, page d'achat et de succès, e-mail transactionnel, tests en mode test Stripe | 3 à 4 |
| **4 — Intégration à l'app (web)** | build officiel `'on'`, siège, saisie de la clé, stockage et renouvellement du bail, verrouillage des fonctions, bandeaux | 5 à 8 |
| **5 — Recette** | parcours complet en mode test, hors ligne / reprise de siège sur appareils réels, revue de sécurité, bêta fermée | 3 à 5 |
| **6 — (option 2) IAP natifs** | StoreKit 2 + App Store Server Notifications, Play Billing + RTDN, rapprochement avec les licences | 10 à 15 |

Total hors option 2 : **≈ 17 à 26 jours** de développement.

### 11.2 Ce qui reste à décider avant la phase 2

Voir §12.

### 11.3 Écrans à maquetter (validation du propriétaire avant tout code)

Site web :

1. **Offre et achat** : ce qui est inclus, prix TTC, durée, « 1 licence = 1
   télécommande », case CGV / renonciation au droit de rétractation, bouton
   vers Stripe.
2. **Merci / votre clé** : clé en grand, Copier, Enregistrer, « Saisissez-la
   dans Réglages → Licence », état « paiement en cours de confirmation ».
3. **E-mail** de la clé (FR / EN).

Télécommande (build officiel seulement) :

4. **Réglages → Licence**, saisie : champ formaté pendant la frappe, erreur
   immédiate de caractère de contrôle, état « vérification… ».
5. **« Licence utilisée sur une autre télécommande »** : choix explicite
   « Déplacer la licence ici » / « Annuler ».
6. **État de la licence** : valable jusqu'au …, bail renouvelé le …, « Libérer
   cette licence », clé masquée.
7. **Bandeau hors ligne / délai de grâce** : « Connectez-vous avant le … pour
   garder les fonctions de la licence ».
8. **Licence déplacée** (siège perdu) et **licence expirée / révoquée** :
   explication, renouvellement.
9. **Fonction réservée** : présentation sobre de ce qu'apporte la licence (et
   comment l'obtenir, sur le web uniquement).
10. **Licences open source** : écran « À propos → Licences » (AGPL,
    THIRD_PARTY_NOTICES), utile dans tous les builds.

## 12. Questions ouvertes

1. Option store (§8.4) : web seul au lancement, puis IAP ?
2. Ce qui est payant dans le build officiel (§7.1) et le prix.
3. Durée du bail et de la grâce (§6.2), grâce réduite après reprise de siège.
4. Renouvellement : nouveau code ou prolongation du même code (§3.4).
5. E-mail transactionnel (§3.2) et prestataire d'envoi.
6. Relais officiel ouvert ou réservé (§9).
7. Politique quand Ed25519 manque (§6.4).
8. Validation juridique : CGV, rétractation (L221-28 13°), politique de
   confidentialité, TVA OSS, CLA (docs/CLA.md).

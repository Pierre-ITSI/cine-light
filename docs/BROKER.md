# Relais privé pour SetRemote — comparatif et recommandation

*Rédigé les 14 et 15 octobre 2026.* Les chiffres viennent de recherches web
faites ces jours-là (sources en fin de section). **Méthode** : l'accès direct
aux pages de tarifs était bloqué depuis l'environnement de rédaction. Les
valeurs ont donc été relevées dans les extraits des pages officielles fournis
par le moteur de recherche, et recoupées quand c'était possible. Quand les
sources se contredisent, c'est indiqué **« à confirmer »**. Il faut revérifier
ces valeurs à l'ouverture des comptes.

**Mise à jour du 16 octobre 2026** : la recommandation devient le **relais
SetRemote auto-hébergé sur le VPS OVH existant** (gratuit, en France, sans
tiers). Il est implémenté et testé (`relay/`), avec un kit de déploiement
(`relay/deploy/`, mode d'emploi en français) et un transport client désactivé
par défaut (`RELAY_URL`, §5). Cloudflare reste l'alternative (§2).

## 0. Ce dont on a réellement besoin

Avec le chiffrement de bout en bout de `packages/protocol`, le relais ne voit
que des trames opaques sur un topic opaque. Le contenu est chiffré et
authentifié, et le topic fait 128 bits dérivés du secret. **Le relais n'a donc
plus de rôle de sécurité pour la confidentialité ni l'intégrité.** Il lui reste
trois rôles :

1. **Isolation des topics.** Personne ne doit pouvoir s'abonner avec un joker
   (`#`, `+`) ni lister les sessions actives. Sinon un tiers apprend les
   topics, voit les métadonnées et peut inonder une session.
2. **Limitation de débit** par connexion et par session.
3. **Plafond de taille de paquet.** Depuis la version 2 de la trame, la photo
   d'un faux appel passe par fragments (`__callphoto`) comme les autres
   médias : le JSON clair d'un message est plafonné à 40 Kio
   (`MAX_MESSAGE_BYTES`), soit une trame d'au plus **54 782 caractères**
   (`MAX_FRAME_CHARS`). Un fragment de média fait environ 22 Ko. Un plafond de
   **64 Kio par trame** suffit (compatible avec l'offre gratuite d'Ably).

À cela s'ajoutent la disponibilité et le support des WebSockets depuis un
navigateur (PWA) et depuis React Native.

Profil de charge estimé pour un plateau actif, soit 1 télécommande et 1 à
8 écrans pendant environ 10 h :

- couleur et curseurs jusqu'à environ 25 messages/s par moments ;
- `media-progress` à 4 Hz pendant la lecture vidéo ;
- rafales de fragments : une vidéo de 64 Mo représente 4000 trames de 16 Kio.

## 1. Options comparées

| | **HiveMQ Cloud Serverless** | **HiveMQ Cloud Starter** | **EMQX Cloud Serverless** | **Mosquitto / EMQX auto-hébergé (VPS)** | **Cloudflare Workers + Durable Objects** | **Ably** (pub/sub managé) | **Relais SetRemote auto-hébergé** (VPS OVH existant, `relay/`) |
|---|---|---|---|---|---|---|---|
| Prix / gratuit | Gratuit : 100 connexions, 10 Go/mois | 0,34 $/h (≈ 248 $/mois) + 0,80 $/M messages ; 100 $ de crédit offert au 1er cluster | Gratuit/mois : 1 M minutes-session (≈ 23 connexions 24 h/24), 1 Go de trafic. Puis 2 $/M minutes-session, 0,15 $/Go. Plafond de dépense réglable (0 par défaut) | VPS Hetzner CX23 ≈ 4 à 5,50 €/mois HT (tarifs relevés en avril 2026, sources divergentes) | Gratuit : 100 000 requêtes/jour, 13 000 Go-s/jour. Payant : 5 $/mois minimum, 1 M requêtes et 400 000 Go-s inclus, puis 0,15 $/M requêtes et 12,50 $/M Go-s. Messages WebSocket entrants facturés au ratio 20:1, sortants gratuits | Gratuit : 6 M messages/mois, 200 connexions simultanées, 200 canaux. Standard 29 $/mois + usage | **0 € de plus** : le VPS est déjà payé ; trafic des VPS OVH en principe illimité (à vérifier selon l'offre) |
| Taille max. message | 5 Mo | 5 Mo | 1 Mo (à confirmer) | Configurable (`max_packet_size`) | 32 Mio en réception (depuis le 31/10/2025) | **64 Kio** (gratuit) | **64 Kio** (réglable) ; 4 Kio en rendez-vous |
| Connexions | **100 au total** | 10 000 (pricing) ou 25 000 (page produit) : à confirmer | 1000 sessions max. ; publication 10 msg/s par client (à confirmer) | Celles du VPS (plusieurs milliers) | Pas de plafond documenté par objet ; une instance par session | 200 (gratuit) ; 50 msg/s par canal | 4000 par défaut (réglable) ; mesuré : 450 connexions à 25 trames/s ≈ 25 % d'un cœur |
| Auth et ACL : un client limité à un topic par jeton court ? | **Non.** Identifiants nom/mot de passe créés à la console. Une seule permission (un filtre de topic) par identifiant. Pas de JWT | **Partiel.** JWT via JWKS, mais uniquement les claims standards (`iss`, `sub`, `aud`, `iat`, `exp`, `scope`). D'après le forum, on ne peut pas attribuer de rôle ou de topic via le JWT (option Enterprise) | **Non.** Ni JWT, ni auth HTTP, ni autorisation étendue. Mot de passe ou X.509, ACL en base interne | **Oui.** EMQX : JWT avec claim `acl`. Mosquitto : plugin d'auth (ex. mosquitto-go-auth, JWT ou HTTP), maintenance à vérifier | **Oui, par construction.** Le relais est notre code : le topic est la capacité, sans abonnement joker possible, plus une preuve `relayAuth` | **Oui.** Jeton ou JWT avec `capability` limitée à un canal | **Oui, par construction** (même conception que la colonne Cloudflare) : une salle par topic, aucun joker, preuve `relayAuth` en TOFU |
| WebSocket navigateur | WSS (8884) | WSS | WSS | À configurer (listener `websockets` + TLS) | Natif | SDK JS / React Native | Natif (`wss://`, TLS par Caddy) |
| UE | Région Serverless non documentée (Serverless et Starter sur AWS seulement) | Francfort (eu-central-1) au choix | Région « Europe » (Francfort) depuis 2024 | Allemagne / Finlande | Juridiction `eu` des Durable Objects. Le TLS est terminé au point de présence le plus proche | UE en option, plutôt Enterprise (à confirmer) | **France** (OVHcloud) ; TLS terminé sur notre serveur ; aucun tiers |
| Exploitation | Nulle | Nulle | Nulle | **Élevée** : mises à jour, TLS, supervision, sauvegardes, astreinte | Faible : environ 150 lignes de code à maintenir et tester, pas de serveur | Nulle | **Faible à moyenne** : `docker compose`, certificat automatique, redémarrage automatique ; mises à jour d'images à appliquer ; environ 300 lignes de code testées |
| Bloquant pour nous | 100 connexions pour **toute** la base d'utilisateurs ; isolation impossible | Coût fixe élevé dès le 1er jour ; isolation par topic incertaine | Débit par client (si confirmé) incompatible avec 25 Hz et les fragments ; isolation impossible | Exploitation | Écrire un relais (simple) | Facturation à chaque livraison (les 64 Kio par message suffisent depuis la trame v2) | Rien de bloquant ; disponibilité = celle d'un seul VPS (pas de redondance) |

Autres options écartées :

- **Supabase Realtime** (Broadcast). Gratuit d'après une source tierce :
  200 clients et 100 messages/s. C'est surtout utile si on adopte Supabase
  pour autre chose.
- **AWS IoT Core** avec autoriseur personnalisé. Il est puissant, mais trop
  lourd à mettre en place et à exploiter pour notre taille.

### Pourquoi l'isolation compte encore, même chiffré

Avec un identifiant partagé intégré à l'app, cas forcé chez HiveMQ Serverless
et EMQX Serverless, n'importe qui peut extraire cet identifiant de l'app. Il
peut alors s'abonner à `setremote/v2/#` : il ne lit rien, mais il découvre les
sessions actives et peut les inonder. C'est un déni de service et une fuite de
métadonnées. Le chiffrement ne protège pas contre ça. Seul un relais qui
refuse les jokers et limite le débit le fait.

### Sources (consultées les 14 et 15/10/2026)

- **HiveMQ**
  - Page produit : https://www.hivemq.com/products/mqtt-cloud-broker/ (Serverless 100 connexions et 10 Go/mois ; Starter « illimité », plafonné temporairement à 25 000).
  - Tarifs : https://www.hivemq.com/pricing/ et https://www.hivemq.com/pricing/fully-managed/ (Starter dès 0,34 $/h + 0,80 $/M messages ; « Serverless et Starter : AWS uniquement »).
  - AWS Marketplace : https://aws.amazon.com/marketplace/pp/prodview-hterz4h2j6wza (0,34 $/h, 0,80 $/M, 10 000 connexions, 1 Mo/s).
  - Taille max. : https://hivemq.atlassian.net/wiki/spaces/HCSP/pages/2749857832/What+is+the+maximum+payload+size+and+throughput (5 Mo).
  - Accès par offre : https://docs.hivemq.com/hivemq-platform/connect/access-management-options-per-cloud-plan.html (JWT sur Starter, claims standards, JWKS, une méthode d'auth par cluster).
  - https://docs.hivemq.com/hivemq-cloud/authn-authz.html et https://www.hivemq.com/blog/manage-iot-data-streams-custom-permissions-mqtt-clients-hivemq-cloud/ (Serverless : permission attachée au nom d'utilisateur, un filtre de topic).
  - Forum : https://community.hivemq.com/t/assign-role-when-using-json-web-tokens-in-hivemq-cloud/3388 (rôle via JWT non pris en charge sur Cloud).
  - Région et crédit : https://docs.hivemq.com/hivemq-cloud/quick-start-guide.html (Starter : Francfort ou Oregon) et https://www.hivemq.com/blog/hivemq-cloud-serverless-vs-starter-mqtt-iot-or-iiot/ (100 $ de crédit).
- **EMQX**
  - Tarifs : https://docs.emqx.com/en/cloud/latest/price/pricing.html (quota gratuit, 2 $/M minutes-session, 0,15 $/Go, plafond de dépense).
  - Offres : https://docs.emqx.com/en/cloud/latest/price/plans.html (1000 sessions, 1 Mo, 10 TPS par client, 10 abonnements par client ; alignement du tableau ambigu).
  - JWT : https://docs.emqx.com/en/cloud/latest/deployments/jwt_auth.html (non disponible en Serverless).
  - Auth : https://docs.emqx.com/en/cloud/latest/deployments/auth_overview.html (Serverless : mot de passe et X.509).
  - Autorisation : https://docs.emqx.com/en/cloud/latest/deployments/authz_overview.html.
  - Région UE : https://emqx.com/en/blog/emqx-expands-global-reach-with-cloud-serverless-service-launch-in-emea-region (Francfort, février 2024).
  - Licence BSL 1.1 depuis la 5.9, usage gratuit en production sur un seul nœud : https://www.emqx.com/en/blog/adopting-business-source-license-to-accelerate-mqtt-and-ai-innovation et https://www.emqx.com/en/content/license-faq.
  - JWT avec claim `acl` (auto-hébergé) : https://docs.emqx.com/en/emqx/latest/access-control/authn/jwt.html.
- **Mosquitto**
  - `max_packet_size` porte sur le paquet complet ; un dépassement entraîne une déconnexion (commentaires de `mosquitto.conf`).
  - mosquitto-go-auth (backends JWT local/distant, HTTP) : https://hub.docker.com/r/iegomez/mosquitto-go-auth. Maintenance non confirmée.
- **Hetzner** (hausse d'avril 2026, CX22 remplacé par CX23) : https://agentdeals.dev/hetzner-pricing-2026 et https://kimmo.suominen.com/stuff/cpc-2026-08.txt. Les deux sources divergent (3,99 à 5,49 €). À confirmer sur hetzner.com.
- **Cloudflare**
  - Tarifs DO : https://developers.cloudflare.com/durable-objects/platform/pricing/ (gratuit et payant, ratio 20:1, hibernation non facturée).
  - Tarifs Workers : https://developers.cloudflare.com/workers/platform/pricing/ (5 $/mois).
  - Notes de version : https://developers.cloudflare.com/durable-objects/release-notes/ (DO SQLite sur l'offre gratuite).
  - Limites : https://developers.cloudflare.com/durable-objects/platform/limits/ et https://developers.cloudflare.com/changelog/2025-10-31-increased-websocket-message-size-limit (32 Mio).
  - Localisation : https://developers.cloudflare.com/durable-objects/reference/data-location/ (juridictions `eu`, `us`, `fedramp`).
- **Ably**
  - Tarifs : https://ably.com/pricing.
  - Offre gratuite : https://ably.com/docs/platform/pricing/free.
  - Limites : https://ably.com/docs/platform/pricing/limits (64 Kio, 50 msg/s par canal).
  - Capacités : https://ably.com/docs/auth/capabilities.
- **Supabase** : https://supabase.com/docs/guides/realtime/limits.

## 2. Recommandation (mise à jour du 16 octobre 2026)

**(a) Recommandé : le relais SetRemote auto-hébergé sur le VPS OVH existant**
(`relay/server.js`, déployé par `relay/deploy/`).

- **Gratuit** : le VPS est déjà payé ; aucun compte, aucune carte, aucune
  facturation à l'usage.
- **Confidentialité** : serveur en France chez OVHcloud, TLS terminé chez
  nous, **aucun tiers** (ni HiveMQ, ni Cloudflare) ne voit les métadonnées
  (IP, topics, horaires). Aucun journal de connexion (voir
  `relay/deploy/README.md`, « Ce qui est journalisé »).
- **Même conception que le relais Cloudflare** (§2.1) : une salle par topic
  opaque, aucun joker, plafonds de taille et de débit, preuve `relayAuth` en
  TOFU. Le contrat de connexion (chemins, sous-protocole, preuve) est le
  même : un relais Cloudflare pourrait le remplacer sans toucher au client.
- **Exploitation raisonnable** : trois conteneurs (`docker compose`),
  certificat Let's Encrypt automatique (Caddy), redémarrage automatique,
  script de vérification depuis l'extérieur, mode d'emploi en français pour
  un non-spécialiste.
- **Mesuré** (Docker, TLS) : 50 plateaux simulés (450 connexions, 25 trames/s
  par télécommande en continu) → relais 22 Mio et 25 % d'un cœur, Caddy
  64 Mio et 40 % d'un cœur. Le plus petit VPS suffit pour des dizaines de
  plateaux simultanés.
- **Limites assumées** : un seul serveur (une panne du VPS coupe les
  plateaux jusqu'à son retour, sauf repli autorisé, §5) ; mises à jour
  d'images à appliquer ; sans fichier TOFU, un redémarrage réarme la preuve.

**(b) Alternative : Cloudflare Workers + Durable Objects**, juridiction `eu`,
offre Workers Paid à 5 $/mois. À préférer si l'on ne veut plus aucun serveur à
maintenir, ou pour une disponibilité multi-région :

- une instance d'objet par session : isolation native, aucun joker ;
- pas de serveur, hibernation des WebSockets inactifs ;
- montée en charge session par session, coût proportionnel. Estimation : un
  plateau actif 10 h, éveillé environ 50 % du temps, consomme environ
  2 300 Go-s par jour ; pour 1000 journées-plateau par mois, environ 30 à
  60 $/mois au total ;
- à implémenter en reprenant le contrat de connexion de `relay/server.js` et
  sa suite de tests (`relay/test/`).

**(c) Passage à l'échelle** : mesuré, 50 plateaux dans le pire cas
(curseurs en mouvement permanent) prennent un quart de cœur au relais et
40 % d'un cœur à Caddy ; l'usage réel, bien plus calme, laisse de la marge
pour bien davantage. Au-delà : VPS plus gros, puis Durable Objects (b). Si un besoin MQTT
natif apparaît (passerelles sACN/IoT tierces), ajouter un EMQX auto-hébergé
sous licence commerciale, avec JWT `acl` par topic. HiveMQ Starter est à
écarter tant que l'attribution d'ACL par JWT n'est pas confirmée.

### 2.1 Conception du relais (implémentée : `relay/server.js`)

Conception d'origine, prévue pour Cloudflare. L'implémentation Node en un seul
processus la suit ; ses écarts et précisions sont listés en §2.2.

- **Routes** :
  - `wss://relay.<domaine>/v2/s/<topic>` : `<topic>` = `session.topic`, 22 caractères base64url, refus sinon.
  - `wss://relay.<domaine>/v2/rdv/<id>` : rendez-vous.
- **Routage** : le Worker valide le chemin et limite les nouvelles connexions
  par IP (binding Rate Limiting). Il transmet ensuite à
  `env.ROOMS.jurisdiction('eu').idFromName(topic)`.
- **Durable Object, API d'hibernation**
  (`ctx.acceptWebSocket`, `webSocketMessage`) :
  - rediffuse chaque trame texte aux autres sockets de la session ;
  - trames binaires et caractères hors `[A-Za-z0-9_-]` refusés ;
  - **64 Kio max.** par trame (fermeture 1009 au-delà ; trame légitime ≤ 54 782 caractères) ;
  - **seau à jetons** par socket : environ 100 trames/s en rafale, 2 Mo/s ;
  - **32 sockets max.** par session.
  - Rendez-vous : 4 sockets, trames de 4 Kio, durée de vie de 5 min.
- **Preuve d'appartenance facultative**
  (`relayAuth`, dérivée du secret par `deriveSession`) :
  - le client l'envoie dans `Sec-WebSocket-Protocol`, jamais dans l'URL, pour
    éviter les journaux ;
  - la 1re connexion enregistre `SHA-256(relayAuth)` dans le stockage de
    l'objet (principe TOFU) ; les suivantes doivent présenter la même valeur ;
  - un tiers qui ne connaît que le topic (journaux, captures) ne peut alors
    ni écouter ni inonder ;
  - une alarme purge les sessions inactives depuis 30 jours.
- **Aucune journalisation** des contenus. Seuls des compteurs sont tenus :
  rejets de taille, de débit et de format.

### 2.2 Implémentation auto-hébergée : écarts et précisions

| Point | Conception (Durable Objects) | `relay/server.js` (Node 22, un processus, dépendance unique `ws`) |
|---|---|---|
| Salles | un objet par session | `Map` en mémoire ; salle vide libérée aussitôt |
| Plafonds globaux | plateforme | sockets (4000), salles (2000), mémoire (RSS > 384 Mio : nouvelles connexions refusées), plus `mem_limit` Docker |
| Limites par IP | binding Rate Limiting | dans le processus : 30 nouvelles connexions en rafale puis 60/min, 64 sockets simultanés ; IPv6 comptée par /64. `X-Forwarded-For` lu seulement si le pair direct est le proxy déclaré (`RELAY_TRUST_PROXY`), de droite à gauche |
| Débit | seau à jetons, trame refusée | seau à jetons par socket (100 trames/s, 2 Mo/s, capacité 1 s). Au-delà, la lecture du socket est suspendue et les trames attendent leur tour, dans l'ordre : l'émetteur est ralenti, **rien n'est perdu** (une rafale de resynchronisation passe entière). File démesurée : fermeture 1008 |
| Destinataire lent | — | au-delà de 4 Mio en attente d'envoi, ses trames sont perdues (comme le QoS 0 de MQTT) |
| Alphabet | `[A-Za-z0-9_-]` | sessions : `[A-Za-z0-9_-]` (sorties de `seal` / `sealChunk`) ; rendez-vous : JSON compact des messages `pair:*`, donc en plus `{ } [ ] " : ,` |
| Rendez-vous | 5 min | 5 min depuis la création, non prolongeables en se reconnectant ; puis fermeture 4410 et refus 410 pendant 5 min |
| TOFU | stockage de l'objet, alarme à 30 jours | `Map` LRU en mémoire (100 000 entrées max.), purge à 30 jours d'inactivité ; fichier JSON facultatif (`RELAY_AUTH_FILE`) : SHA-256 du topic, SHA-256 de la preuve, jour d'activité. **Sans fichier, un redémarrage réarme le TOFU** : la 1re connexion qui suit fait foi. La 1re preuve vue évince les sockets sans preuve (4401). `RELAY_REQUIRE_AUTH=1` (kit de déploiement) refuse toute connexion de session sans preuve |
| Keepalive | hibernation | ping/pong toutes les 25 s (socket muet coupé) et battement texte vide, que le navigateur voit (contrairement aux pings) : le client se reconnecte après 70 s de silence |
| Arrêt | — | SIGTERM : plus de nouvelles connexions, sockets fermés en 1001 (les clients se reconnectent et se resynchronisent), fichier TOFU écrit |
| Journaux | compteurs | aucun journal par connexion ; compteurs agrégés sur `/healthz` |

**Contrat de connexion** (à respecter par tout autre relais, par exemple
Cloudflare) :

- `wss://<relais>/v2/s/<topic>` et `wss://<relais>/v2/rdv/<id>` : 22
  caractères base64url canoniques (16 octets), rien d'autre dans l'URL ;
- sous-protocoles `setremote.v2` (toujours ; le seul renvoyé par le relais)
  et `auth.<relayAuth>` (43 caractères, sessions seulement, jamais renvoyé) ;
- trames texte relayées telles quelles aux AUTRES sockets de la salle (pas
  d'écho) ; une trame vide est un battement, ignorée par le client ;
- refus HTTP avant la poignée de main : 404 (chemin), 401 (preuve), 403
  (origine, si `RELAY_ORIGINS`), 410 (rendez-vous expiré), 429 (limites par
  IP), 503 (plafonds, arrêt). Fermetures : 1001, 1003, 1007, 1008, 1009,
  4401, 4410.

## 3. Ce que le responsable produit doit faire

**Relais auto-hébergé (recommandé)** :

1. **Déployer le relais** sur le VPS en suivant `relay/deploy/README.md`
   (environ 30 minutes) : sous-domaine DNS, ports 80 et 443 (TCP) et 3478
   (UDP et TCP), Docker, `.env`, `docker compose up -d --build`, puis
   `check.sh` depuis l'extérieur.
2. **Choisir le moment de la bascule** (§5), hors tournage, et prévoir de
   recharger l'app sur tous les appareils.
3. **RGPD** :
   - mettre à jour la politique de confidentialité (texte proposé dans
     `relay/deploy/README.md`, « Ce qui est journalisé ») ;
   - registre des traitements : OVHcloud (France) comme sous-traitant ;
     après la bascule, plus aucun échange par le broker public de HiveMQ.
4. **Exploitation** : appliquer les mises à jour une fois par mois
   (`docker compose pull`, `docker compose build --pull`,
   `docker compose up -d`), surveiller `https://<relais>/healthz` (un
   service de surveillance externe n'y verrait que des totaux). Aucune
   sauvegarde indispensable : les certificats se redemandent, la mémoire TOFU
   se reconstitue.
5. Arbitrer **la fin du broker public** : retirer mqtt.js une fois l'app
   native passée au relais.

**Alternative Cloudflare (si choisie plus tard)** : compte d'organisation
(e-mail générique, 2FA, rôles limités) ; Workers Paid à 5 $/mois avec carte et
alertes de facturation ; domaine du relais (zone chez Cloudflare ou
`*.workers.dev`) et jeton d'API limité au déploiement pour la CI ; DPA
Cloudflare accepté et archivé, juridiction `eu`.

## 4. Plan de migration depuis le broker public

| Phase | Contenu | État, compatibilité |
|---|---|---|
| **0** | `packages/protocol` intégré ; validation stricte à la réception | Fait |
| **1** | Sessions **v2 chiffrées** (QR `#p=v1.…` ou code + SAS) sur `broker.hivemq.com`, topic opaque `setremote/v2/s/<topic>` | Fait. Pas de mode historique : décision produit (`packages/protocol/README.md`, §8) |
| **2** | Relais auto-hébergé déployé et vérifié ; client prêt mais **désactivé** (`RELAY_URL` vide) | Livré avec `relay/` ; rien ne change pour les utilisateurs |
| **3** | **Bascule** : `RELAY_URL` et `STUN_URLS` renseignés, nouvelle PWA et nouvelle version native (qui embarque l'interface) | §5 : deux versions sur des transports différents ne se voient pas |
| **4** | Après le passage de l'app native : suppression du broker public, de mqtt.js (`vendor/mqtt-5.16.1.min.js`) et de `RELAY_FALLBACK_MQTT` | Les anciens clients sont invités à mettre à jour |

**Retour arrière** : remettre `RELAY_URL` à `''`, reconstruire et publier :
retour au broker public, chiffrement inchangé. Le relais peut rester en
service.

**Côté code** :

- PWA : fait. `transportConnect()` (`web/js/19-relay.js`) choisit le
  transport ; `RelayClient` a la même surface que le client mqtt.js utilisé
  par `web/js/20-mqtt.js` (session) et `web/js/26-pairing.js` (rendez-vous).
- `expo-app` : ajouter un `RelayTransport` (interface `RemoteTransport`
  existante) qui respecte le contrat de §2.2, quand l'app native adoptera le
  protocole chiffré.
- Les trames étant des chaînes, les transports Wi-Fi local et BLE
  transportent aussi les trames chiffrées sans modification de format.

## 5. Bascule vers le relais (transition)

> Valeurs pour le VPS OVH (`hub.itsi-app.com`) et procédure complète, avec
> le déménagement de la PWA sur `set-remote.itsi-app.com` : `docs/HOSTING.md`.

**Réglages** (`web/js/01-config.js`, puis `npm run build`) :

| Réglage | Défaut | Rôle |
|---|---|---|
| `RELAY_URL` | `''` (broker public) | `'wss://relais.mondomaine.fr'` : sessions ET rendez-vous d'appairage passent par le relais. `wss://` exigé (`ws://` accepté seulement sur la machine locale, pour les tests) |
| `STUN_URLS` | `['stun:stun.l.google.com:19302']` | `['stun:relais.mondomaine.fr:3478']` : le coturn du kit remplace le STUN de Google pour la vidéo WebRTC |
| `RELAY_FALLBACK_MQTT` | `false` | `true` : si le relais reste injoignable dès le départ (3 échecs), cette connexion passe par le broker public (toujours chiffrée) jusqu'à la prochaine session ou au rechargement |

Une coque native ou un test peut aussi fournir `window.SETREMOTE_CONFIG`
(mêmes clés) avant le script de l'app ; toute valeur invalide est ignorée.

**Ce qui change** : seulement le transport. Le scellement, les secrets de
session et les appairages existants sont identiques (aucun réappairage). La
preuve `relayAuth` part dans `Sec-WebSocket-Protocol`. Les libellés de
l'interface ne changent pas (« Internet · chiffré », « Reconnexion… »).

**Reconnexion** : attente exponentielle de 1 s à 30 s avec gigue, remise à 1 s
après 10 s de connexion stable, nouvelle tentative immédiate au retour du
réseau, reconnexion après 70 s sans rien recevoir. Chaque reconnexion émet
`connect` : la télécommande renvoie `hello`, les écrans `caps`, et la
resynchronisation existante (`web/js/24-resync.js`) remet chaque écran dans
l'état exact de la télécommande. Testé avec un vrai relais redémarré
(`tests/relay.test.mjs`).

**Repli** : par défaut, un relais en panne laisse la pastille sur
« Reconnexion… » jusqu'à son retour. `RELAY_FALLBACK_MQTT: true` rétablit la
liaison par le broker public, mais une télécommande repliée et un écran resté
sur le relais ne se voient pas : à n'activer qu'en connaissance de cause.

**Versions mélangées** : télécommande et écrans doivent utiliser le même
transport.

- La PWA prend la nouvelle version au prochain chargement (service worker,
  navigation réseau d'abord) ; un écran resté ouvert plusieurs jours garde
  l'ancienne : **recharger tous les appareils après la bascule**.
- L'app native embarque l'interface au moment de sa construction
  (`expo-app/scripts/embed-web.mjs`) : il faut une nouvelle version publiée
  sur les stores. D'ici là, un appareil natif et une PWA à jour ne se voient
  pas.
- Si cela pose problème, une période de double publication (relais et broker
  public à la fois) est possible : les doublons seraient éliminés
  gratuitement par l'anti-rejeu (même émetteur, même `seq`). Elle n'est pas
  implémentée.

**Procédure proposée** :

1. Déployer le relais et passer `check.sh` (§3).
2. Essayer sur un plateau de test : construction avec `RELAY_URL`, ou
   injection de `window.SETREMOTE_CONFIG` par la coque native.
3. Entre deux tournages : renseigner les réglages, `npm run build`,
   augmenter `CACHE` dans `sw.js`, `npm test`, publier la PWA, publier
   l'app native.
4. Faire recharger l'app sur tous les appareils.
5. Surveiller `/healthz` les premiers jours (`refused_by_status`,
   `tofu_rejected`, `throttled`, `dropped_slow`).

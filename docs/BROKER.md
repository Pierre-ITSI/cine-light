# Relais privé pour SetRemote — comparatif et recommandation

*Rédigé les 14 et 15 octobre 2026.* Les chiffres viennent de recherches web
faites ces jours-là (sources en fin de section). **Méthode** : l'accès direct
aux pages de tarifs était bloqué depuis l'environnement de rédaction. Les
valeurs ont donc été relevées dans les extraits des pages officielles fournis
par le moteur de recherche, et recoupées quand c'était possible. Quand les
sources se contredisent, c'est indiqué **« à confirmer »**. Il faut revérifier
ces valeurs à l'ouverture des comptes.

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
3. **Plafond de taille de paquet.** La plus grosse trame légitime vient d'un
   `call:start` avec photo. La photo peut atteindre 600 000 caractères
   (plafond actuel de l'app), ce qui donne au plus 640 Kio de JSON chiffré,
   soit environ 875 Ko en base64url. Un fragment de média fait environ 22 Ko.
   Un plafond de **1 Mio** suffit. Si l'on veut descendre à 64 Kio, par
   exemple pour Ably, il faut d'abord faire passer la photo par fragments.

À cela s'ajoutent la disponibilité et le support des WebSockets depuis un
navigateur (PWA) et depuis React Native.

Profil de charge estimé pour un plateau actif, soit 1 télécommande et 1 à
8 écrans pendant environ 10 h :

- couleur et curseurs jusqu'à environ 25 messages/s par moments ;
- `media-progress` à 4 Hz pendant la lecture vidéo ;
- rafales de fragments : une vidéo de 64 Mo représente 4000 trames de 16 Kio.

## 1. Options comparées

| | **HiveMQ Cloud Serverless** | **HiveMQ Cloud Starter** | **EMQX Cloud Serverless** | **Mosquitto / EMQX auto-hébergé (VPS)** | **Cloudflare Workers + Durable Objects** | **Ably** (pub/sub managé) |
|---|---|---|---|---|---|---|
| Prix / gratuit | Gratuit : 100 connexions, 10 Go/mois | 0,34 $/h (≈ 248 $/mois) + 0,80 $/M messages ; 100 $ de crédit offert au 1er cluster | Gratuit/mois : 1 M minutes-session (≈ 23 connexions 24 h/24), 1 Go de trafic. Puis 2 $/M minutes-session, 0,15 $/Go. Plafond de dépense réglable (0 par défaut) | VPS Hetzner CX23 ≈ 4 à 5,50 €/mois HT (tarifs relevés en avril 2026, sources divergentes) | Gratuit : 100 000 requêtes/jour, 13 000 Go-s/jour. Payant : 5 $/mois minimum, 1 M requêtes et 400 000 Go-s inclus, puis 0,15 $/M requêtes et 12,50 $/M Go-s. Messages WebSocket entrants facturés au ratio 20:1, sortants gratuits | Gratuit : 6 M messages/mois, 200 connexions simultanées, 200 canaux. Standard 29 $/mois + usage |
| Taille max. message | 5 Mo | 5 Mo | 1 Mo (à confirmer) | Configurable (`max_packet_size`) | 32 Mio en réception (depuis le 31/10/2025) | **64 Kio** (gratuit) |
| Connexions | **100 au total** | 10 000 (pricing) ou 25 000 (page produit) : à confirmer | 1000 sessions max. ; publication 10 msg/s par client (à confirmer) | Celles du VPS (plusieurs milliers) | Pas de plafond documenté par objet ; une instance par session | 200 (gratuit) ; 50 msg/s par canal |
| Auth et ACL : un client limité à un topic par jeton court ? | **Non.** Identifiants nom/mot de passe créés à la console. Une seule permission (un filtre de topic) par identifiant. Pas de JWT | **Partiel.** JWT via JWKS, mais uniquement les claims standards (`iss`, `sub`, `aud`, `iat`, `exp`, `scope`). D'après le forum, on ne peut pas attribuer de rôle ou de topic via le JWT (option Enterprise) | **Non.** Ni JWT, ni auth HTTP, ni autorisation étendue. Mot de passe ou X.509, ACL en base interne | **Oui.** EMQX : JWT avec claim `acl`. Mosquitto : plugin d'auth (ex. mosquitto-go-auth, JWT ou HTTP), maintenance à vérifier | **Oui, par construction.** Le relais est notre code : le topic est la capacité, sans abonnement joker possible, plus une preuve `relayAuth` | **Oui.** Jeton ou JWT avec `capability` limitée à un canal |
| WebSocket navigateur | WSS (8884) | WSS | WSS | À configurer (listener `websockets` + TLS) | Natif | SDK JS / React Native |
| UE | Région Serverless non documentée (Serverless et Starter sur AWS seulement) | Francfort (eu-central-1) au choix | Région « Europe » (Francfort) depuis 2024 | Allemagne / Finlande | Juridiction `eu` des Durable Objects. Le TLS est terminé au point de présence le plus proche | UE en option, plutôt Enterprise (à confirmer) |
| Exploitation | Nulle | Nulle | Nulle | **Élevée** : mises à jour, TLS, supervision, sauvegardes, astreinte | Faible : environ 150 lignes de code à maintenir et tester, pas de serveur | Nulle |
| Bloquant pour nous | 100 connexions pour **toute** la base d'utilisateurs ; isolation impossible | Coût fixe élevé dès le 1er jour ; isolation par topic incertaine | Débit par client (si confirmé) incompatible avec 25 Hz et les fragments ; isolation impossible | Exploitation | Écrire un relais (simple) | 64 Kio par message (photo d'appel trop grosse) ; facturation à chaque livraison |

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

## 2. Recommandation

**(a) Lancement sous quelques semaines, exploitation quasi nulle : un relais
WebSocket sur Cloudflare Workers + Durable Objects, juridiction `eu`, offre
Workers Paid à 5 $/mois.**

- Une instance d'objet par session : isolation native et aucun joker
  possible.
- Plafond de taille et limitation de débit codés dans le relais.
- Pas de serveur à maintenir, hibernation des WebSockets inactifs.
- Le client est un simple `WebSocket`, ce qui permet de supprimer mqtt.js.
- **En attendant** que le relais soit prêt, livrer les trames chiffrées v2 sur
  le broker public actuel. La fuite de contenu et l'injection cessent
  immédiatement.

**(b) Passage à l'échelle : rester sur Durable Objects**, qui montent en
charge session par session avec un coût proportionnel. Estimation : un
plateau actif 10 h, éveillé environ 50 % du temps, consomme environ 2 300 Go-s
par jour. Pour 1000 journées-plateau par mois, on arrive à environ 30 à
60 $/mois au total. Si un besoin MQTT natif apparaît (passerelles sACN/IoT
tierces), ajouter un cluster EMQX auto-hébergé sous licence commerciale, avec
JWT `acl` par topic. HiveMQ Starter est à écarter tant que l'attribution d'ACL
par JWT n'est pas confirmée.

### 2.1 Conception du relais (à implémenter, environ 150 lignes TypeScript)

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
  - **1 Mio max.** par trame (fermeture 1009 au-delà) ;
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

## 3. Ce que le responsable produit doit faire

1. **Créer un compte Cloudflare d'organisation**, et non un compte personnel :
   - e-mail générique, 2FA obligatoire ;
   - inviter les développeurs avec des rôles limités.
2. **Souscrire Workers Paid** (5 $/mois) avec une **carte bancaire** :
   - activer les alertes de facturation ;
   - l'offre gratuite suffit pour une bêta, mais elle coupe net au-delà des
     quotas journaliers.
3. **Choisir le nom de domaine** du relais (ex. `relay.<domaine-de-l-app>`) :
   - zone DNS chez Cloudflare, ou à défaut le sous-domaine `*.workers.dev` ;
   - créer un **jeton d'API** limité au déploiement des Workers pour la CI.
4. **RGPD** :
   - mettre à jour la politique de confidentialité : le relais traite des
     adresses IP et des métadonnées, le contenu est chiffré de bout en bout ;
   - accepter et archiver le DPA de Cloudflare dans le tableau de bord ;
   - valider le choix de la juridiction `eu`.
5. **Plan B uniquement** (EMQX Serverless, à éviter pour les raisons
   ci-dessus) : compte EMQX, région Europe, carte, plafond de dépense à 0 au
   départ.
6. Arbitrer **la date de fin du mode historique en clair**. Proposition :
   8 semaines après la sortie de l'app native compatible.

## 4. Plan de migration depuis le broker public (avec rétrocompatibilité)

| Phase | Contenu | Compatibilité |
|---|---|---|
| **0** (immédiat) | Intégrer `packages/protocol`. La validation à la réception existe déjà dans la PWA (`MSG_ROUTES`, `web/js/22-protocol.js`, qui borne les valeurs). On peut y ajouter `validate()` du paquet comme contrôle strict | Aucun changement de protocole ; les charges de la revue sont déjà bloquées |
| **1** (S+1 à S+2) | Nouvelles sessions **v2 chiffrées** (QR `#p=v1.…` ou code + SAS), **toujours sur `broker.hivemq.com`**, topic `setremote/v2/s/<topic>` | Un ancien QR ou code (`#set4271`) ouvre le **mode historique** avec un bandeau « non sécurisé ». Une télécommande à jour peut piloter un ancien écran via « Mode compatibilité », désactivé par défaut |
| **2** (S+2 à S+4) | Déploiement du relais Cloudflare. Les apps v2 publient **sur les deux** (relais + broker public) et s'abonnent aux deux | Les copies en double sont **éliminées gratuitement par l'anti-rejeu** (même émetteur et même `seq` : la 2e est rejetée). Des versions v2 mixtes se retrouvent donc toujours |
| **3** (quand > 95 % des sessions viennent de versions capables du relais) | Arrêt de la publication sur le broker public ; mode historique masqué derrière un réglage avancé | La PWA se met à jour via le service worker en quelques jours. Le natif dépend de la validation des stores : attendre au moins un cycle de version |
| **4** | Suppression du mode historique et de mqtt.js (`vendor/mqtt-5.16.1.min.js`, `MqttTransport`) | Les anciens clients ne peuvent plus se connecter et sont invités à mettre à jour |

**Retour arrière** : chaque phase est derrière un indicateur de
fonctionnalité. Revenir de la phase 2 à la phase 1 consiste à ne plus
utiliser le relais. Le chiffrement reste actif.

**Côté code** :

- PWA : remplacer `connectMQTT` et `sendMsg` (`web/js/20-mqtt.js`) par un transport abstrait, avec
  une implémentation MQTT (phases 1-2) et une implémentation WebSocket relais
  (phases 2-4).
- `expo-app` : ajouter un `RelayTransport` qui implémente l'interface
  `RemoteTransport` existante.
- Les trames étant des chaînes, les transports Wi-Fi local et BLE
  transportent aussi les trames chiffrées sans modification de format.

# Relais SetRemote sur votre VPS OVH : mode d'emploi

Ce dossier installe, sur **un seul VPS** (celui que vous avez déjà chez OVH),
le relais privé de SetRemote. Il remplace à terme le broker MQTT public
`broker.hivemq.com` : gratuit (le VPS est déjà payé), en Europe, sans tiers.

Trois petits services Docker :

| Service | Rôle | Port(s) ouvert(s) |
|---|---|---|
| **relay** | relais WebSocket SetRemote (`relay/server.js`) : transmet les trames chiffrées entre la télécommande et les écrans, sans pouvoir les lire | aucun vers l'extérieur (127.0.0.1:8080 seulement) |
| **caddy** | certificat HTTPS Let's Encrypt automatique et renouvelé, puis transmission au relais | 80/tcp, 443/tcp |
| **stun** | coturn en mode STUN seul : aide les appareils à se joindre en direct pour la vidéo (WebRTC) | 3478/udp, 3478/tcp |

Tout le contenu (commandes, images, sons, signalisation vidéo) est **chiffré de
bout en bout** par l'app : ni le relais, ni OVH, ni vous ne pouvez le lire.

Durée : environ 30 minutes la première fois.

**Ce qu'il vous faut** : le VPS (Debian ou Ubuntu), un accès SSH
(`ssh ubuntu@IP-DU-VPS` ou `ssh debian@…`), et un nom de domaine dont vous
gérez la zone DNS (chez OVH ou ailleurs).

---

## 1. Créer le sous-domaine (DNS)

Choisissez un sous-domaine, par exemple `relais.mondomaine.fr`.

Chez OVH : **Web Cloud → Noms de domaine → mondomaine.fr → Zone DNS →
Ajouter une entrée** :

- type **A**, sous-domaine `relais`, cible = **adresse IPv4 du VPS**
  (page du VPS dans l'espace client) ;
- si votre VPS a une IPv6 configurée : même chose en type **AAAA** avec
  l'adresse IPv6. Sans IPv6 fonctionnelle sur le VPS, ne créez **pas** d'AAAA.

La propagation prend de quelques minutes à quelques heures. Vérifiez depuis
votre ordinateur :

```sh
dig +short relais.mondomaine.fr      # doit afficher l'IP du VPS
```

## 2. Ouvrir les ports

| Port | Pour quoi |
|---|---|
| 22/tcp | SSH (votre accès : à garder ouvert !) |
| 80/tcp | obtention et renouvellement du certificat (Let's Encrypt) |
| 443/tcp | le relais (WebSocket sécurisé `wss://`) |
| 3478/udp et 3478/tcp | STUN (vidéo pair-à-pair) |

**Pare-feu du VPS (ufw)**, sur le VPS :

```sh
sudo apt install -y ufw
sudo ufw allow OpenSSH          # d'abord, pour ne pas vous couper l'accès
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw enable
sudo ufw status
```

Ici ufw protège réellement ces services : Caddy et coturn utilisent le réseau
de l'hôte, et le relais n'est publié que sur 127.0.0.1. (Docker contourne ufw
pour les ports publiés sur toutes les interfaces, ce que ce kit ne fait pas.)

**Pare-feu réseau OVH (Edge Network Firewall)** : il est désactivé par défaut.
Si vous ne l'avez jamais activé, ufw suffit. S'il est actif (espace client :
**Bare Metal Cloud → Network → IP**, bouton `…` de l'IP du VPS →
**Configurer l'Edge Network Firewall** ; les libellés d'OVH changent
parfois), il faut ces règles, sinon le certificat ou STUN échoueront :

| Priorité | Action | Protocole | Détail |
|---|---|---|---|
| 0 | Autoriser | TCP | option « established » (réponses aux connexions sortantes) |
| 1 | Autoriser | TCP | port destination 22 |
| 2 | Autoriser | TCP | port destination 80 |
| 3 | Autoriser | TCP | port destination 443 |
| 4 | Autoriser | UDP | port destination 3478 |
| 5 | Autoriser | TCP | port destination 3478 |
| 6 | Autoriser | UDP | port source 53 (réponses DNS) |
| 7 | Autoriser | UDP | port source 123 (heure, NTP) |
| 19 | Refuser | IPv4 | tout le reste |

Ce pare-feu OVH ne filtre que l'IPv4 ; ufw couvre aussi l'IPv6.

## 3. Installer Docker (s'il n'est pas déjà là)

```sh
docker compose version     # déjà installé ? Passez à l'étape 4.
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh      # script officiel Docker (Debian, Ubuntu)
sudo usermod -aG docker "$USER"
exit                       # puis reconnectez-vous en SSH
docker compose version     # doit afficher « Docker Compose version v2… » ou plus
```

## 4. Copier le kit sur le VPS

Le dossier `relay/` du dépôt suffit. Depuis votre ordinateur, à la racine du
dépôt :

```sh
scp -r relay ubuntu@IP-DU-VPS:~/setremote-relay
```

(ou, sur le VPS, `git clone` du dépôt puis `cd …/relay`.)

## 5. Régler

Sur le VPS :

```sh
cd ~/setremote-relay/deploy
cp .env.example .env
nano .env        # remplacer relais.exemple.fr par VOTRE sous-domaine, enregistrer (Ctrl+O, Entrée, Ctrl+X)
```

Les autres réglages ont des valeurs par défaut adaptées (commentées dans le
fichier). Le fichier `.env` ne contient aucun secret.

## 6. Démarrer

```sh
docker compose up -d --build
docker compose ps
```

Les trois services doivent être « Up », le relais « (healthy) ». Le
certificat est obtenu dans la minute :

```sh
docker compose logs caddy      # aucune ligne « error » attendue
```

Les services redémarrent seuls après une panne ou un redémarrage du VPS
(`restart: unless-stopped`).

## 7. Vérifier depuis l'extérieur

Sur **votre ordinateur** (pas le VPS), à la racine du dépôt :

```sh
relay/deploy/check.sh relais.mondomaine.fr
```

Il faut `curl`, et Node 22 (ou plus) ou Docker. Résultat attendu :

```
DNS
  ✓ relais.mondomaine.fr → 203.0.113.10
HTTPS
  ✓ certificat valide, /healthz : {"ok":true,…}
WebSocket (wss://relais.mondomaine.fr)
  ✓ poignée de main WebSocket, sous-protocole setremote.v2
  ✓ trame relayée d'un socket à l'autre
  ✓ preuve différente refusée (TOFU)
  ✓ rendez-vous d'appairage relayé
  ✓ chemin invalide refusé
STUN (relais.mondomaine.fr:3478)
  ✓ UDP IPv4 : adresse publique vue par le serveur 198.51.100.7:51234
  ✓ TCP : adresse publique vue par le serveur 198.51.100.7:50122
Tout est en ordre.
```

L'« adresse publique vue par le serveur » est celle de **votre** connexion :
c'est exactement ce que STUN doit renvoyer.

## 8. Brancher l'app (une fois la vérification au vert)

L'app utilise le broker public tant que rien n'est changé. Pour basculer
(voir aussi `docs/BROKER.md`, §5) :

1. Dans `web/js/01-config.js` :
   ```js
   RELAY_URL: 'wss://relais.mondomaine.fr',
   STUN_URLS: Object.freeze(['stun:relais.mondomaine.fr:3478']),
   ```
   (`RELAY_FALLBACK_MQTT: true` seulement si vous voulez un repli sur le
   broker public quand le relais est injoignable : à éviter, il annule
   l'intérêt du relais privé.)
2. `npm run build`, augmenter `CACHE` dans `sw.js`, `npm test`, publier.
3. Tester sur un vrai plateau : appairage QR et code, couleurs, médias, vidéo.

Les télécommandes et écrans gardent leur appairage : seul le transport change.

## Mise à jour et retour arrière

```sh
cd ~/setremote-relay/deploy
docker tag setremote-relay:local setremote-relay:previous   # garde la version en service
# récupérer le nouveau code : scp -r relay … (étape 4) ou git pull
docker compose pull                  # correctifs de Caddy et coturn
docker compose build --pull          # correctifs de Node 22 et du relais
docker compose up -d
```

puis `check.sh` depuis votre ordinateur. Pendant le redémarrage du relais
(quelques secondes), les appareils se reconnectent seuls et se
resynchronisent ; évitez tout de même de le faire pendant une prise.

**Retour arrière** (si quelque chose ne va pas) :

```sh
docker tag setremote-relay:previous setremote-relay:local
docker compose up -d --no-build relay
```

**Arrêter** : `docker compose down` (les volumes, donc certificats et mémoire
TOFU, sont conservés ; `down -v` les supprime).

## Ce qui est journalisé (pour la politique de confidentialité)

| Composant | Ce qui est écrit | Ce qui n'est **jamais** écrit |
|---|---|---|
| Relais | une ligne au démarrage (port, réglages), une à l'arrêt | adresses IP, topics de session, contenus, horaires de connexion |
| `/healthz` | totaux agrégés (sockets, salles, trames, refus) | aucune donnée par connexion |
| Caddy | erreurs de démarrage et de certificat (niveau WARN) | aucun journal d'accès ; les erreurs de requêtes (qui contiendraient l'IP et le chemin) sont exclues |
| coturn | configuration au démarrage | les requêtes STUN (IP) : pas de mode « verbose » |
| Docker | ces journaux, plafonnés à 2 × 1 Mo par service | |

Ce que le relais garde **en mémoire seulement** : l'adresse IP (IPv6 : son
préfixe /64) le temps de la connexion et quelques minutes après, pour les
limites anti-abus ; les topics des sessions actives (identifiants opaques
de 128 bits, dérivés du secret).

Le fichier TOFU (`/data/tofu.json`, volume `relay-data`) contient, par
session : l'empreinte SHA-256 du topic, l'empreinte SHA-256 de la preuve
d'appartenance, et le **jour** de dernière activité. Effacé au bout de
30 jours d'inactivité. Sans ce fichier (`RELAY_AUTH_FILE=` vide), rien n'est
écrit sur disque, mais chaque redémarrage du relais **réarme** le TOFU : la
première connexion qui suit fait foi pour chaque session.

Inévitable : comme tout serveur, le VPS voit passer les adresses IP et le
volume des échanges (métadonnées réseau). OVHcloud, hébergeur en France, est
sous-traitant au sens du RGPD : son accord de traitement des données fait
partie de ses conditions contractuelles (à vérifier dans votre contrat).

Texte possible pour la politique de confidentialité : « Les échanges entre
la télécommande et les écrans transitent par notre serveur relais hébergé
chez OVHcloud en France. Leur contenu est chiffré de bout en bout : le
serveur ne peut pas le lire. Le serveur traite votre adresse IP en mémoire,
le temps de la connexion, pour se protéger des abus ; il ne la conserve pas
et ne tient aucun journal des connexions. »

## Le VPS a déjà un proxy sur le port 443 (nginx, Traefik…)

Dans `.env`, mettez `COMPOSE_PROFILES=stun` (pas de Caddy), puis
`docker compose up -d --build` : le relais écoute sur `127.0.0.1:8080`.
Ensuite :

- **nginx** : `variants/nginx.conf` (bloc serveur prêt, avec certbot) ;
- **Traefik installé sur l'hôte** : `variants/traefik-file.yml` ;
- **Traefik en conteneur** : `variants/traefik-compose.yml` (étiquettes Docker).

Gardez les journaux d'accès désactivés pour ce site (déjà le cas dans ces
fichiers), sinon l'IP et le topic de chaque connexion seraient écrits.

## Activer TURN plus tard

STUN suffit quand les appareils peuvent se joindre directement. Sur certains
réseaux (Wi-Fi isolant les appareils, 4G), il faut un relais de trafic TURN.
La marche à suivre est en commentaire à la fin de `turnserver.conf`
(`use-auth-secret`, plage de ports à ouvrir). L'app devra alors recevoir des
identifiants TURN éphémères : à développer, le secret ne doit jamais être
embarqué dans l'app.

## Dépannage

| Symptôme | Piste |
|---|---|
| `check.sh` : DNS ✗ | enregistrement A absent ou pas encore propagé |
| HTTPS ✗, `docker compose logs caddy` parle de « challenge » | port 80 fermé (ufw, pare-feu OVH) ou DNS qui pointe ailleurs |
| HTTPS ✗, « connection refused » | `docker compose ps` : Caddy arrêté ? un autre service occupe 80/443 ? (voir « proxy déjà présent ») |
| HTTPS ✓ mais WebSocket ✗ | `docker compose ps` : relais « unhealthy » ? `docker compose logs relay` |
| STUN UDP ✗, TCP ✓ | port 3478/udp fermé (ufw, pare-feu OVH) |
| `up` : « Pool overlaps with other one on this address space » | changer `RELAY_SUBNET` dans `.env` (ex. `172.30.54.0/24`) |
| `/healthz` en 503 | mémoire au-delà de `RELAY_MEM_LIMIT_MB` : regarder `docker stats` |

## Ressources

Mesuré avec ce kit (Docker, Caddy en TLS) : au repos, relais ≈ 18 Mio,
Caddy ≈ 13 Mio, coturn ≈ 7 Mio de mémoire. Avec **50 plateaux simultanés**
(1 télécommande + 8 écrans chacun, 450 connexions) dont la télécommande
envoie en continu 25 couleurs par seconde, le pire cas, pendant 30 s :
relais ≈ 22 Mio et 25 % d'un cœur, Caddy ≈ 64 Mio et 40 % d'un cœur ;
99,9 % des 300 000 trames attendues reçues (le reste était en vol à
l'arrêt), aucune ralentie ni perdue.

Par plateau actif, au pire : environ 1 Mio de mémoire, 1 % d'un cœur, et
**0,5 Mbit/s** pendant les mouvements de curseurs (bien moins le reste du
temps). Une image de 300 Ko envoyée à 8 écrans fait environ 0,5 Mo entrant
et 4,5 Mo sortant. Les vidéos passent en direct entre appareils (WebRTC) et
non par le relais, sauf repli quand le pair-à-pair échoue.

Le plus petit VPS OVH suffit donc largement pour des dizaines de plateaux
simultanés. Le trafic des VPS OVH est en principe illimité ; le débit
maximal dépend de l'offre (à vérifier dans votre espace client).

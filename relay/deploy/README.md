# SetRemote sur votre VPS OVH : relais et version web, mode d'emploi

Ce dossier installe, sur **un seul VPS** (celui que vous avez déjà chez OVH) :

- le **relais privé** de SetRemote, à `hub.itsi-app.com`. Il remplacera à
  terme le broker MQTT public `broker.hivemq.com` : gratuit (le VPS est déjà
  payé), en Europe, sans tiers ;
- la **version web** (PWA), à `https://set-remote.itsi-app.com/`. Elle
  remplacera à terme GitHub Pages (`pierre-itsi.github.io/cine-light`).

Installer ce kit **ne change rien pour les utilisateurs** : l'app continue
d'utiliser GitHub Pages et le broker public tant que la bascule, décrite dans
`docs/HOSTING.md`, n'est pas faite.

Trois petits services Docker, plus un minuteur :

| Élément | Rôle | Port(s) ouvert(s) |
|---|---|---|
| **relay** | relais WebSocket SetRemote (`relay/server.js`) : transmet les trames chiffrées entre la télécommande et les écrans, sans pouvoir les lire | aucun vers l'extérieur (127.0.0.1:8080 seulement) |
| **caddy** | certificats HTTPS Let's Encrypt automatiques et renouvelés pour les deux noms ; transmission au relais (`hub…`) ; fichiers de la PWA avec les bons en-têtes (`set-remote…`) | 80/tcp, 443/tcp |
| **stun** | coturn en mode STUN seul : aide les appareils à se joindre en direct pour la vidéo (WebRTC) | 3478/udp, 3478/tcp |
| **minuteur** `setremote-app-update` | toutes les 5 minutes, va chercher sur GitHub la dernière version publiée de la PWA, la vérifie, puis la met en service d'un coup | aucun (le VPS appelle GitHub, rien n'entre) |

Tout le contenu (commandes, images, sons, signalisation vidéo) est **chiffré de
bout en bout** par l'app : ni le relais, ni OVH, ni vous ne pouvez le lire.

Durée : environ 30 minutes la première fois.

**Ce qu'il vous faut** : le VPS (Debian ou Ubuntu), un accès SSH
(`ssh ubuntu@IP-DU-VPS` ou `ssh debian@…`), et la zone DNS de `itsi-app.com`
(chez OVH ou ailleurs).

---

## 1. Créer les deux sous-domaines (DNS)

Chez OVH : **Web Cloud → Noms de domaine → itsi-app.com → Zone DNS →
Ajouter une entrée**, deux fois :

| Type | Sous-domaine | Cible |
|---|---|---|
| **A** | `hub` | adresse IPv4 du VPS (page du VPS dans l'espace client) |
| **A** | `set-remote` | la même adresse IPv4 |

Si votre VPS a une IPv6 configurée : ajoutez aussi deux entrées **AAAA**
(`hub` et `set-remote`) vers l'adresse IPv6. Sans IPv6 fonctionnelle sur le
VPS, ne créez **pas** d'AAAA.

La propagation prend de quelques minutes à quelques heures. Vérifiez depuis
votre ordinateur :

```sh
dig +short hub.itsi-app.com          # doit afficher l'IP du VPS
dig +short set-remote.itsi-app.com   # idem
```

## 2. Ouvrir les ports

| Port | Pour quoi |
|---|---|
| 22/tcp | SSH (votre accès : à garder ouvert !) |
| 80/tcp | obtention et renouvellement des certificats (Let's Encrypt) |
| 443/tcp | le relais (`wss://`) et la version web (`https://`) |
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
parfois), il faut ces règles, sinon les certificats, STUN ou la mise à jour
de la PWA échoueront :

| Priorité | Action | Protocole | Détail |
|---|---|---|---|
| 0 | Autoriser | TCP | option « established » (réponses aux connexions sortantes : GitHub, Let's Encrypt) |
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
nano .env        # vérifier, enregistrer (Ctrl+O, Entrée, Ctrl+X)
```

`RELAY_DOMAIN=hub.itsi-app.com` et `APP_DOMAIN=set-remote.itsi-app.com` sont
déjà renseignés. Les autres réglages ont des valeurs par défaut adaptées
(commentées dans le fichier). Le fichier `.env` ne contient aucun secret.

## 6. Installer la mise à jour automatique de la version web

```sh
sudo ./install-app-update.sh
```

Ce script (à relire avant, il est court) :

1. installe `update-app.sh` sous le nom `/usr/local/bin/setremote-update-app`
   et `verify-app.mjs` dans `/usr/local/lib/setremote/` ;
2. recopie les réglages `APP_*` de `.env` dans `/etc/setremote/app.env` ;
3. installe le minuteur systemd `setremote-app-update.timer` (toutes les
   5 minutes) ;
4. fait la première mise à jour (environ une minute).

Résultat attendu, à la fin :

```
✓ Paquet vérifié : 46 fichiers, index.html à jour, toutes les références présentes
SetRemote app : version 1a2b…-20261020T081500Z-1234 en service (précédente : aucune)
SetRemote app : en service : releases/1a2b…
```

**Comment ça marche.** À chaque passage, le VPS demande à GitHub le dernier
commit de la branche `main` du dépôt public (quelques octets). S'il a changé :

1. il télécharge l'archive de **ce commit précis** (`codeload.github.com`) et
   contrôle qu'elle correspond bien à ce commit ;
2. dans un conteneur Node 22 **sans réseau**, en lecture seule, il ne garde
   que les fichiers de la PWA (liste blanche : `index.html`, `sw.js`, le
   manifeste, les icônes et écrans de lancement, les deux politiques de
   confidentialité, `vendor/`) et vérifie le paquet : `index.html` à jour avec
   les sources, chaque fichier cité présent, chaque fichier précaché par le
   service worker présent ;
3. il range cette version dans `/srv/setremote-app/releases/` et fait pointer
   le lien `current` dessus **d'un seul coup** : un visiteur ne voit jamais
   un mélange de deux versions. La version d'avant reste dans `previous`.

Si une vérification échoue, **rien ne change** : la version en service
continue, et le minuteur réessaiera au prochain commit. Jamais publiés :
`relay/`, `tests/`, `docs/`, `expo-app/`, `web/`, `packages/`, fichiers cachés.
Aucun secret, aucun compte GitHub, aucun accès entrant : c'est le VPS qui
va chercher.

Une **nouvelle version** est donc en ligne au plus 5 minutes environ après
le `git push` sur `main`. (Ajout d'un fichier à la racine du dépôt que la PWA
doit servir : l'ajouter à la liste blanche de `verify-app.mjs`, sinon la
vérification refuse la version et le dit dans le journal.)

Suivre :

```sh
systemctl list-timers setremote-app-update.timer   # prochain passage
journalctl -u setremote-app-update -n 20           # dernières mises à jour (rien quand tout est à jour)
sudo setremote-update-app --status                 # versions en place
```

Sans systemd (rare) : une ligne cron fait la même chose,
`echo '*/5 * * * * root /usr/local/bin/setremote-update-app' | sudo tee /etc/cron.d/setremote-app`.

## 7. Démarrer

```sh
docker compose up -d --build
docker compose ps
```

Les trois services doivent être « Up », le relais « (healthy) ». Les
certificats sont obtenus dans la minute :

```sh
docker compose logs caddy      # aucune ligne « error » attendue
```

Les services redémarrent seuls après une panne ou un redémarrage du VPS
(`restart: unless-stopped`).

## 8. Vérifier depuis l'extérieur

Sur **votre ordinateur** (pas le VPS), à la racine du dépôt :

```sh
relay/deploy/check.sh hub.itsi-app.com set-remote.itsi-app.com
```

Il faut `curl`, et Node 22 (ou plus) ou Docker. Résultat attendu :

```
DNS
  ✓ hub.itsi-app.com → 203.0.113.10
HTTPS
  ✓ certificat valide, /healthz : {"ok":true,…}
WebSocket (wss://hub.itsi-app.com)
  ✓ poignée de main WebSocket, sous-protocole setremote.v2
  ✓ trame relayée d'un socket à l'autre
  ✓ preuve différente refusée (TOFU)
  ✓ rendez-vous d'appairage relayé
  ✓ chemin invalide refusé
STUN (hub.itsi-app.com:3478)
  ✓ UDP IPv4 : adresse publique vue par le serveur 198.51.100.7:51234
  ✓ TCP : adresse publique vue par le serveur 198.51.100.7:50122
PWA (https://set-remote.itsi-app.com/)
  ✓ DNS : set-remote.itsi-app.com → 203.0.113.10
  ✓ HTTPS : certificat valide, page d'accueil servie
  ✓ HSTS
  ✓ Referrer-Policy : no-referrer
  ✓ Permissions-Policy : caméra pour le site seul
  ✓ X-Content-Type-Options : nosniff
  ✓ CSP stricte, WebSocket vers wss://hub.itsi-app.com permis
  ✓ index.html : Cache-Control no-cache
  ✓ sw.js : servi en JavaScript, no-cache
  ✓ manifest.webmanifest : application/manifest+json
  ✓ dossiers du dépôt non publiés, aucune liste de dossier (404)
Tout est en ordre.
```

L'« adresse publique vue par le serveur » est celle de **votre** connexion :
c'est exactement ce que STUN doit renvoyer.

Vous pouvez aussi ouvrir `https://set-remote.itsi-app.com/` dans un
navigateur : c'est l'app, identique à celle de GitHub Pages.

## 9. Basculer l'app (plus tard, une fois tout au vert)

Rien ne change pour les utilisateurs tant que vous ne basculez pas. La
procédure complète (relais, adresse des QR codes, app native, redirection de
GitHub Pages, politique de confidentialité) est dans **`docs/HOSTING.md`**.
Chaque étape est indépendante et réversible.

## Mise à jour et retour arrière

### Version web

Automatique (minuteur). Pour revenir à la version **précédente** :

```sh
sudo setremote-update-app --rollback    # immédiat ; suspend aussi les mises à jour automatiques
sudo setremote-update-app --status
```

Une fois le problème corrigé sur `main` :

```sh
sudo setremote-update-app --resume      # reprend les mises à jour et installe la dernière version
```

`sudo setremote-update-app --force` réinstalle la dernière version même si
elle est déjà en service. Seules deux versions sont gardées (en service et
précédente).

Les visiteurs reçoivent la version en service à leur prochain chargement
(`index.html` et `sw.js` ne sont jamais mis en cache par le navigateur) ;
pour une PWA installée, le service worker la prend au prochain retour à
l'accueil.

### Relais et services Docker

```sh
cd ~/setremote-relay/deploy
docker tag setremote-relay:local setremote-relay:previous   # garde la version en service
# récupérer le nouveau kit : scp -r relay … (étape 4) ou git pull
docker compose pull                  # correctifs de Caddy et coturn
docker compose build --pull          # correctifs de Node 22 et du relais
docker compose up -d
sudo ./install-app-update.sh         # si update-app.sh ou verify-app.mjs ont changé
```

puis `check.sh` depuis votre ordinateur. Pendant le redémarrage du relais
(quelques secondes), les appareils se reconnectent seuls et se
resynchronisent ; évitez tout de même de le faire pendant une prise.

**Retour arrière du relais** :

```sh
docker tag setremote-relay:previous setremote-relay:local
docker compose up -d --no-build relay
```

**Arrêter** : `docker compose down` (les volumes, donc certificats et mémoire
TOFU, sont conservés ; `down -v` les supprime) et
`sudo systemctl disable --now setremote-app-update.timer`.

## Ce qui est journalisé (pour la politique de confidentialité)

| Composant | Ce qui est écrit | Ce qui n'est **jamais** écrit |
|---|---|---|
| Relais | une ligne au démarrage (port, réglages), une à l'arrêt | adresses IP, topics de session, contenus, horaires de connexion |
| `/healthz` | totaux agrégés (sockets, salles, trames, refus) | aucune donnée par connexion |
| Caddy (relais et version web) | erreurs de démarrage et de certificat (niveau WARN) | aucun journal d'accès : ni IP, ni page demandée, ni navigateur ; les erreurs de requêtes (qui contiendraient l'IP et le chemin) sont exclues |
| coturn | configuration au démarrage | les requêtes STUN (IP) : pas de mode « verbose » |
| Mise à jour de la version web (journal systemd) | le commit installé ou la raison d'un refus | rien sur les visiteurs |
| Docker | ces journaux, plafonnés à 2 × 1 Mo par service | |

Le minuteur appelle GitHub toutes les 5 minutes : GitHub voit l'adresse IP
du VPS (pas celle des visiteurs).

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

Le texte de la politique de confidentialité pour la bascule est déjà prêt,
en commentaire dans `confidentialite.html` et `privacy.html` (repères
`RELAIS` et `HÉBERGEMENT`) : voir `docs/HOSTING.md`.

## En-têtes de la version web (pour information)

| En-tête | Valeur | Pourquoi |
|---|---|---|
| `Cache-Control` | `no-cache` pour `/`, `index.html`, `sw.js`, le manifeste et les politiques ; un an (`immutable`) pour `vendor/nom-1.2.3.js` ; une heure sinon ; `no-store` pour les erreurs | une nouvelle version est vue tout de suite ; les seuls fichiers dont le nom change à chaque version sont les bibliothèques versionnées (`verify-app.mjs` refuse qu'elles changent sous le même nom) |
| `Content-Security-Policy` | `default-src 'self'`, connexions vers `wss://hub.itsi-app.com` et, tant qu'il sert, le broker public (`APP_CONNECT_EXTRA`) ; `data:` et `blob:` pour les médias | n'autorise que ce dont l'app a besoin. Les scripts et styles « inline » restent permis : l'app est un seul fichier avec des `onclick` |
| `Strict-Transport-Security` | un an, ce nom seulement | HTTPS obligatoire |
| `Referrer-Policy` | `no-referrer` | aucune adresse transmise aux sites liés (le secret d'appairage, après `#`, n'est de toute façon jamais envoyé) |
| `Permissions-Policy` | caméra pour le site seul ; micro, localisation, paiement… refusés | scan du QR et torche uniquement |
| `X-Content-Type-Options`, `X-Frame-Options`, `Cross-Origin-Opener-Policy` | `nosniff`, `SAMEORIGIN`, `same-origin` | protections classiques |

Après la bascule vers le relais (plus de broker public), mettez
`APP_CONNECT_EXTRA=` (vide) dans `.env` puis `docker compose up -d`.

## Le VPS a déjà un proxy sur le port 443 (nginx, Traefik…)

Dans `.env`, mettez `COMPOSE_PROFILES=stun` (pas de Caddy), puis
`docker compose up -d --build` : le relais écoute sur `127.0.0.1:8080`.
Ensuite :

- **nginx** : `variants/nginx.conf` (bloc serveur prêt, avec certbot) ;
- **Traefik installé sur l'hôte** : `variants/traefik-file.yml` ;
- **Traefik en conteneur** : `variants/traefik-compose.yml` (étiquettes Docker).

Gardez les journaux d'accès désactivés pour ce site (déjà le cas dans ces
fichiers), sinon l'IP et le topic de chaque connexion seraient écrits.

Ces variantes ne couvrent que le relais. Pour la version web, servez le
dossier `/srv/setremote-app/current` (mis à jour par le minuteur, qui reste
valable) en reprenant les en-têtes du site `{$APP_DOMAIN}` du `Caddyfile`.

## Extensions privées (facultatif)

Le `Caddyfile` importe `extra/*.caddy` dans le site du relais et
`extra/sites/*.caddy` au niveau supérieur (dossier `extra/` du kit, monté en
lecture seule) : par défaut, des commentaires seulement, rien ne change. Le
relais publie aussi un compteur interne (`http://relay:9090/metrics`, réseau
Docker seulement). Voir `docs/HOSTING.md`, « Extensions privées ».

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
| PWA : HTTPS en 404 sur `/` | aucune version installée : `sudo setremote-update-app --status`, puis `journalctl -u setremote-app-update -n 30` |
| PWA : la nouvelle version n'arrive pas | `journalctl -u setremote-app-update -n 30` : « refusée » = la vérification a trouvé un problème (souvent `npm run build` oublié avant le commit) ; « GitHub injoignable » = réseau sortant ; mises à jour suspendues après un `--rollback` ? (`--status`) |
| PWA : le minuteur ne démarre pas (« Failed to set up mount namespacing ») | le dossier `APP_ROOT` n'existe pas : relancer `sudo ./install-app-update.sh` |
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

La version web se télécharge en moins de 1 Mo au premier chargement
(`index.html` compressé : ≈ 230 Ko), puis presque rien tant qu'elle ne
change pas (le service worker la garde). Chaque version occupe environ
2,5 Mo sur le disque du VPS (deux gardées).

Le plus petit VPS OVH suffit donc largement pour des dizaines de plateaux
simultanés. Le trafic des VPS OVH est en principe illimité ; le débit
maximal dépend de l'offre (à vérifier dans votre espace client).

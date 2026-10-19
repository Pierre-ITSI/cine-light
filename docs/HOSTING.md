# Hébergement de SetRemote sur le VPS OVH : bascule pas à pas

> **État au 16 octobre 2026 : rien n'est basculé.** La PWA est servie par
> GitHub Pages (`https://pierre-itsi.github.io/cine-light/`), les messages
> passent par le broker MQTT public, la vidéo utilise le STUN de Google.
> Tout ce qui suit est **prêt mais inactif** ; chaque bascule est une étape
> unique, documentée ici, réversible.

| Rôle | Aujourd'hui | Cible |
|---|---|---|
| Version web (PWA) | GitHub Pages, `pierre-itsi.github.io/cine-light/` | VPS OVH, **`https://set-remote.itsi-app.com/`** |
| Relais des messages | `wss://broker.hivemq.com:8884/mqtt` (public) | VPS OVH, **`wss://hub.itsi-app.com`** |
| STUN (vidéo WebRTC) | `stun:stun.l.google.com:19302` | VPS OVH, **`stun:hub.itsi-app.com:3478`** |
| Adresse des QR codes | adresse de la page (web) ; `pierre-itsi.github.io/cine-light/` (app native) | `https://set-remote.itsi-app.com/` |

Les réglages concernés, en un seul endroit chacun :

| Où | Réglage | Valeur actuelle (défaut) | Valeur cible |
|---|---|---|---|
| `web/js/01-config.js` | `RELAY_URL` | `''` (broker public) | `'wss://hub.itsi-app.com'` (sans chemin : l'app ajoute elle-même `/v2/s/<topic>` et `/v2/rdv/<id>`) |
| `web/js/01-config.js` | `STUN_URLS` | `['stun:stun.l.google.com:19302']` | `['stun:hub.itsi-app.com:3478']` |
| `web/js/01-config.js` | `PUBLIC_URL` | `''` (adresse de la page) | `'https://set-remote.itsi-app.com/'` |
| `expo-app/src/config.ts` | `PUBLIC_WEB_URL` | `'https://pierre-itsi.github.io/cine-light/'` | `'https://set-remote.itsi-app.com/'` (identique à `PUBLIC_URL` : un test l'exige) |
| `relay/deploy/.env` (VPS) | `APP_CONNECT_EXTRA` | `wss://broker.hivemq.com:8884` | vide, quand plus personne n'utilise le broker public |

## Étape 1 — Installer le VPS (aucun effet pour les utilisateurs)

Suivre `relay/deploy/README.md` : DNS de `hub` et `set-remote`, ports,
Docker, `sudo ./install-app-update.sh` (minuteur de mise à jour de la PWA),
`docker compose up -d --build`, puis depuis votre ordinateur :

```sh
relay/deploy/check.sh hub.itsi-app.com set-remote.itsi-app.com
```

Tout doit être au vert. `https://set-remote.itsi-app.com/` sert alors la
même app que GitHub Pages (même code, mis à jour dans les 5 minutes qui
suivent chaque `git push` sur `main`), avec encore le broker public.
Personne n'y est envoyé tant que l'étape 2 n'est pas faite.

Essai sur un vrai plateau avant de basculer : ouvrir
`https://set-remote.itsi-app.com/` sur la télécommande et les écrans
(appairage, couleurs, médias, vidéo). Un QR affiché par cette page pointe
déjà vers `set-remote.itsi-app.com` (adresse de la page).

## Étape 2 — Basculer l'app : un commit, puis publier

Entre deux tournages, dans **un seul commit** :

1. `web/js/01-config.js` :
   ```js
   RELAY_URL: 'wss://hub.itsi-app.com',
   RELAY_FALLBACK_MQTT: false,
   STUN_URLS: Object.freeze(['stun:hub.itsi-app.com:3478']),
   PUBLIC_URL: 'https://set-remote.itsi-app.com/',
   ```
2. `expo-app/src/config.ts` :
   ```ts
   export const PUBLIC_WEB_URL = 'https://set-remote.itsi-app.com/';
   ```
3. Politique de confidentialité (étape 5 ci-dessous) : appliquer les blocs
   `HÉBERGEMENT` / `HOSTING`, et réécrire le paragraphe `RELAIS` / `RELAY`
   (relais et STUN sur notre serveur OVH ; texte proposé dans
   `relay/deploy/README.md`, « Ce qui est journalisé ») ; mettre à jour la
   date « Dernière mise à jour ».
4. Reconstruire et vérifier :
   ```sh
   npm run build
   # sw.js : augmenter CACHE (setremote-vNN → vNN+1)
   PW_CHROMIUM=/chemin/vers/chromium npm test
   cd expo-app && npm test && npx tsc --noEmit && cd ..
   ```
   Les tests `tests/privacy.test.mjs` rappellent ce qui doit changer avec la
   configuration (broker et STUN nommés dans la politique).
5. Commit, `git push` sur `main`. **Publication** : le VPS installe la
   version dans les 5 minutes (`sudo setremote-update-app --status`) ;
   GitHub Pages la publie aussi tant que l'étape 4 n'est pas faite, donc les
   deux adresses parlent au même relais.
6. **Nouvelle version native** : `expo-app/EAS-BUILD.md` / `TESTFLIGHT.md`
   (l'interface est embarquée au moment du build : `RELAY_URL`, `STUN_URLS`
   et l'adresse des QR codes n'y changent qu'avec un nouveau build publié
   sur les stores).
7. Faire recharger l'app sur tous les appareils (voir `docs/BROKER.md`, §5 :
   télécommande et écrans doivent utiliser le même transport ; un appareil
   natif pas encore mis à jour reste sur le broker public).

On peut aussi faire `PUBLIC_URL` (adresse des QR) et `RELAY_URL`/`STUN_URLS`
(transport) en deux commits séparés : ils sont indépendants.

**Retour arrière** : revenir sur ce commit (`git revert`), `npm run build`,
augmenter `CACHE`, publier. Sur le VPS, en urgence, sans attendre :
`sudo setremote-update-app --rollback` (version web précédente, mises à jour
suspendues ; `--resume` ensuite).

## Étape 3 — Fermer le broker public dans la CSP (quelques jours après)

Quand plus aucun appareil n'utilise le broker public (app native mise à
jour), sur le VPS :

```sh
cd ~/setremote-relay/deploy
nano .env                 # APP_CONNECT_EXTRA=   (vide)
docker compose up -d      # Caddy reprend la nouvelle CSP
```

Retour arrière : remettre `APP_CONNECT_EXTRA=wss://broker.hivemq.com:8884`.

## Étape 4 — Remplacer GitHub Pages par une redirection

Une seule manipulation, dans GitHub :

1. **Settings → Pages → Build and deployment → Source : « GitHub Actions »**.
2. **Actions → « Pages : redirection vers set-remote.itsi-app.com » → Run
   workflow**, taper `REDIRIGER`, laisser l'adresse proposée, valider
   (`.github/workflows/pages-redirect.yml`, il ne se lance jamais seul).

Le site `pierre-itsi.github.io/cine-light/` devient alors
(`web/pages-redirect.mjs`) :

- `index.html`, `404.html`, `confidentialite.html`, `privacy.html` : renvoient
  vers la même page sur `https://set-remote.itsi-app.com/` par
  `location.replace`, **en gardant le fragment** `#p=…` (le secret
  d'appairage d'un QR code) et la requête. Une balise meta refresh perdrait
  le fragment : elle ne sert que si JavaScript est désactivé ;
- `sw.js` : remplace l'ancien service worker ; il vide ses caches et se
  désinstalle. Une PWA installée depuis github.io le reçoit à sa prochaine
  ouverture (vérification du service worker), se recharge dès le retour à
  l'accueil (jamais en pleine session), et affiche alors la page de
  redirection au lieu de l'ancienne version ;
- PWA installée ouverte sans lien d'appairage : la page explique le
  déménagement (bouton vers la nouvelle adresse) au lieu d'ouvrir un autre
  site dans la fenêtre de l'app ; avec un lien d'appairage, elle redirige.

Les anciens QR codes imprimés ou partagés, les favoris et le lien de la
politique de confidentialité déclaré aux stores continuent donc de
fonctionner. Vérifié par `tests/pages-redirect.test.mjs` (vraie PWA
installée puis remplacée).

Sans GitHub Actions : `node web/pages-redirect.mjs --out site` puis publier
ce dossier sur une branche `gh-pages` (Settings → Pages → Source : branche
`gh-pages`, dossier `/`).

**Retour arrière** : Settings → Pages → Source : « Deploy from a branch »,
`main`, `/ (root)`. L'ancienne app revient sur github.io (les PWA dont le
service worker s'est désinstallé le réinstallent à la visite suivante).

**Après** : mettre à jour l'URL de la politique de confidentialité dans App
Store Connect et la Play Console
(`https://set-remote.itsi-app.com/confidentialite.html` et `…/privacy.html`)
et les mentions de `pierre-itsi.github.io` dans `docs/compliance/`.

### Ce que les utilisateurs doivent savoir (à leur dire)

- **Réinstaller** : une PWA installée depuis `pierre-itsi.github.io` ne
  devient pas celle de `set-remote.itsi-app.com`. Ouvrir la nouvelle adresse
  dans le navigateur, « Ajouter à l'écran d'accueil », supprimer l'ancienne
  icône.
- **Les données locales ne suivent pas** : le navigateur les range par
  adresse (origine). Restent sur l'ancienne : les mémoires de couleur et
  d'effets, les appels et SMS enregistrés (photos, bandes son), les
  sonneries importées, les réglages (langue, sons, avertissement
  stroboscope, patch DMX), le secret de session et les **écrans appairés**.
  Sur la nouvelle adresse il faut les recréer et **refaire l'appairage**.
  L'app native n'est pas concernée (elle embarque son interface ; ses
  données restent).
- Un outil d'export / import (fichier chiffré à transférer d'une adresse à
  l'autre) serait possible mais n'est pas prévu ici.

## Étape 5 — Politique de confidentialité

Le texte est prêt mais **pas appliqué** (le texte affiché décrit la
production actuelle). Dans `confidentialite.html` et `privacy.html`, trois
passages sont balisés :

```html
<!-- HÉBERGEMENT § 3.6 : DÉBUT. … Remplacement :
<p>La version web de SetRemote est hébergée sur notre propre serveur, chez OVHcloud … en France …</p>
-->
<p>La version web de SetRemote est hébergée par GitHub Pages …</p>   ← ligne actuelle
<!-- HÉBERGEMENT § 3.6 : FIN -->
```

Pour chacun (§ 3.6 la version web, § 6 les destinataires, § 7 les
transferts hors UE ; `HOSTING § …: START/END` en anglais) : remplacer tout le
bloc, commentaires compris, par la ligne « Remplacement ». À faire **dans le
commit de l'étape 2**, avec le paragraphe `RELAIS` (relais et STUN sur le
VPS) et la date de mise à jour ; le commentaire d'en-tête des deux pages
(« Servie par GitHub Pages ») aussi. `tests/privacy.test.mjs` vérifie que le
remplacement est bien formé (même plan, même balise).

À relire à ce moment-là : § 5 (durées : nous ne tenons plus de journal pour
la version web et le relais) et § 8 (prestataires des § 3.2, 3.3 et 3.6) ;
§ 3.3 si le STUN de Google n'est plus utilisé.

## Ce qui a été vérifié (16 octobre 2026, Docker dans le bac à sable)

- Kit lancé tel quel (`docker compose up`, images officielles
  `caddy:2.11-alpine`, `coturn/coturn:4.18-alpine`, relais construit), seule
  différence : `local_certs` (autorité interne de Caddy) au lieu de Let's
  Encrypt, les noms réels `set-remote.itsi-app.com` et `hub.itsi-app.com`
  résolus vers la machine.
- `update-app.sh` : archive GitHub réelle (`pierre-itsi/cine-light`,
  `main` et un commit plus ancien), puis faux GitHub local : archive dont
  l'en-tête annonce un autre commit → refusée ; `index.html` périmé →
  refusé, la version en service continue ; bascule, `--rollback` (et
  suspension), `--resume`, `--force` ; 1 600 requêtes pendant des bascules :
  toutes en 200.
- `check.sh hub.itsi-app.com set-remote.itsi-app.com` : tout au vert sauf le
  DNS (enregistrements pas encore créés).
- Navigateur (Chromium) sur `https://set-remote.itsi-app.com/` avec les vrais
  en-têtes : service worker installé, rechargement hors ligne, polices,
  politique dans son cadre, impression de la table DMX, images `data:` et
  `blob:`, aucune violation CSP ; télécommande + écran via
  `wss://hub.itsi-app.com` (QR sur le nouveau domaine, couleur reçue, vidéo
  en pair-à-pair avec le STUN coturn) ; une connexion vers un autre hôte est
  bien refusée par la CSP, `eval` aussi.
- Non vérifié ici : le minuteur systemd lui-même (pas de systemd dans le
  bac à sable ; syntaxe des unités contrôlée par `systemd-analyze verify`, le
  script qu'elles lancent a été exécuté directement), `install-app-update.sh`,
  Let's Encrypt réel, iOS/Android réels.

## Extensions privées et compteur du relais

Le kit public prévoit deux points d'extension Caddy, inertes par défaut, pour
des services privés hébergés à côté (par exemple le service de licence de la
version officielle, [LICENSING.md](LICENSING.md)) sans modifier ce dépôt :

- `import /etc/caddy/extra/*.caddy` **dans** le site du relais
  (`RELAY_DOMAIN`), avant le relais : routes supplémentaires de ce nom
  (`handle /api/… { … }`) ;
- `import /etc/caddy/extra/sites/*.caddy` au niveau supérieur : sites
  supplémentaires (autres noms).

Le dossier `relay/deploy/extra/` du kit est monté sur `/etc/caddy/extra` ; il
ne contient qu'un fichier de commentaire par emplacement, pour que chaque
import trouve toujours un fichier. Une surcharge compose privée peut monter
son propre dossier à la place.

Le relais expose aussi `GET /metrics` → `{ "channels": n, "clients": n }`
(salles de session actives, sockets connectés ; aucun identifiant) sur une
écoute **interne** séparée : port 9090 du conteneur `relay`, joignable des
seuls conteneurs du réseau Docker `relaynet` (`http://relay:9090/metrics`),
jamais publié ni routé par Caddy. `RELAY_METRICS_PORT=0` dans `.env` la coupe ;
hors Docker, elle est désactivée par défaut.

## Risques

- **Données locales perdues au changement d'adresse** (voir ci-dessus) :
  prévenir les utilisateurs avant l'étape 4.
- **Versions mélangées** pendant la bascule du transport : un appareil natif
  pas encore mis à jour reste sur le broker public et ne voit pas les autres
  (`docs/BROKER.md`, §5).
- **Un seul VPS** : s'il tombe, plus de version web (sauf PWA déjà
  installées, qui démarrent hors ligne) ni de relais. GitHub Pages reste un
  plan B tant que l'étape 4 n'est pas faite.
- **Dépendance à GitHub pour les mises à jour** (API et codeload,
  sans compte : 60 requêtes par heure et par IP, le minuteur en fait 12) :
  si GitHub est indisponible, la version en service continue simplement.
- **Dépôt public = ce qui est servi** : tout commit sur `main` qui passe les
  vérifications part en production dans les 5 minutes. Les vérifications
  attrapent un `index.html` non reconstruit ou un fichier manquant, pas un
  bogue fonctionnel : garder `npm test` vert avant chaque push (la CI le
  lance), et `--rollback` en cas de souci.
- **CSP avec `'unsafe-inline'`** pour les scripts et styles : imposé par
  l'architecture (un seul `index.html`, gestionnaires `onclick="…"`). Le
  reste est strict (`default-src 'self'`, connexions limitées au relais et
  au broker public, pas d'`eval`, pas d'objets, pas de `<base>`).
- **Cache d'un an** pour `vendor/nom-1.2.3.js` : ne jamais modifier un tel
  fichier sans changer son nom (`verify-app.mjs` refuse la version sinon).

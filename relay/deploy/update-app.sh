#!/bin/sh
# ════════════════════════════════════════════════════════════════════════════
# SetRemote : mise à jour des fichiers de la PWA servis par Caddy (APP_DOMAIN).
# Lancé toutes les 5 minutes par le minuteur systemd setremote-app-update.timer
# (installé par install-app-update.sh), en root. Aucun secret, aucun accès
# entrant : le VPS va chercher lui-même la version publique sur GitHub.
#
#   setremote-update-app              met à jour si la branche a changé
#   setremote-update-app --force      réinstalle la version de la branche
#   setremote-update-app --rollback   revient à la version précédente ET suspend
#                                     les mises à jour automatiques
#   setremote-update-app --resume     reprend les mises à jour automatiques
#   setremote-update-app --status     affiche les versions en place
#
# Étapes : 1. commit de la branche (API GitHub, quelques octets) ; rien à faire
# s'il est déjà en service. 2. archive de CE commit (codeload.github.com),
# contrôle de l'identifiant de commit inscrit dans l'archive. 3. sélection de
# la liste blanche et vérification (verify-app.mjs) dans un conteneur Node 22
# sans réseau. 4. bascule atomique du lien symbolique « current » ; l'ancienne
# version reste dans « previous » (retour arrière), les autres sont supprimées.
#
# Réglages : /etc/setremote/app.env (écrit par install-app-update.sh depuis
# .env) ou variables d'environnement : APP_REPO, APP_BRANCH, APP_ROOT,
# APP_VERIFY_IMAGE. Requis : curl, tar, gzip, flock, docker.
# ════════════════════════════════════════════════════════════════════════════
set -eu
umask 022

ENV_FILE=${SETREMOTE_ENV:-/etc/setremote/app.env}
if [ -r "$ENV_FILE" ]; then
  # Lecture clé=valeur des seules clés connues (pas d'exécution du fichier)
  while IFS='=' read -r k v; do
    case "$k" in
      APP_REPO|APP_BRANCH|APP_ROOT|APP_VERIFY_IMAGE|SETREMOTE_LIB)
        v=$(printf '%s' "$v" | sed -e 's/^["'\'']//' -e 's/["'\'']$//')
        eval "_env_$k=\$v" ;;
    esac
  done < "$ENV_FILE"
fi
APP_REPO=${APP_REPO:-${_env_APP_REPO:-pierre-itsi/cine-light}}
APP_BRANCH=${APP_BRANCH:-${_env_APP_BRANCH:-main}}
APP_ROOT=${APP_ROOT:-${_env_APP_ROOT:-/srv/setremote-app}}
APP_VERIFY_IMAGE=${APP_VERIFY_IMAGE:-${_env_APP_VERIFY_IMAGE:-node:22-alpine}}
SETREMOTE_LIB=${SETREMOTE_LIB:-${_env_SETREMOTE_LIB:-$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)}}
# Adresses GitHub (modifiables pour les essais locaux uniquement)
GITHUB_API=${GITHUB_API:-https://api.github.com}
GITHUB_CODELOAD=${GITHUB_CODELOAD:-https://codeload.github.com}

say() { printf '%s\n' "SetRemote app : $*"; }
die() { printf '%s\n' "SetRemote app : ERREUR : $*" >&2; exit 1; }

printf '%s' "$APP_REPO" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || die "APP_REPO invalide : $APP_REPO"
printf '%s' "$APP_BRANCH" | grep -Eq '^[A-Za-z0-9_./-]+$' || die "APP_BRANCH invalide : $APP_BRANCH"
case "$APP_ROOT" in /*) ;; *) die "APP_ROOT doit être un chemin absolu : $APP_ROOT" ;; esac
case "$APP_ROOT" in *[!A-Za-z0-9_./-]*) die "APP_ROOT : lettres, chiffres, « _ . / - » seulement" ;; esac
[ -f "$SETREMOTE_LIB/verify-app.mjs" ] || die "verify-app.mjs introuvable dans $SETREMOTE_LIB"

mkdir -p "$APP_ROOT/releases"
chmod 755 "$APP_ROOT" "$APP_ROOT/releases"
cd "$APP_ROOT"

# Une seule exécution à la fois (minuteur + commande manuelle)
exec 9>"$APP_ROOT/.lock"
flock -n 9 || { say "une mise à jour est déjà en cours"; exit 0; }

target() { [ -L "$1" ] && readlink "$1" || true; }
# Remplace le lien $1 par un lien vers $2, de façon atomique (rename)
relink() { ln -sfn "$2" "$1.new" && mv -Tf "$1.new" "$1"; }

case "${1:-}" in
  --status)
    cur=$(target current); prev=$(target previous)
    say "en service : ${cur:-aucune}"
    say "précédente : ${prev:-aucune}"
    if [ -e HOLD ]; then say "mises à jour automatiques SUSPENDUES (--resume pour reprendre)"; fi
    exit 0 ;;
  --rollback)
    cur=$(target current); prev=$(target previous)
    [ -n "$prev" ] && [ -d "$prev" ] || die "aucune version précédente"
    relink current "$prev"
    if [ -n "$cur" ]; then relink previous "$cur"; fi
    : > HOLD
    say "retour à ${prev#releases/} ; mises à jour automatiques suspendues (--resume pour reprendre)"
    exit 0 ;;
  --resume) rm -f HOLD; say "mises à jour automatiques reprises" ;;
  --force|'') ;;
  *) die "option inconnue : $1 (voir l'en-tête du script)" ;;
esac

if [ -e HOLD ] && [ "${1:-}" != "--force" ]; then exit 0; fi

# 1. Commit de la branche
SHA=$(curl -fsS --max-time 20 --retry 2 -H 'Accept: application/vnd.github.sha' \
  "$GITHUB_API/repos/$APP_REPO/commits/$APP_BRANCH") || die "GitHub injoignable (API)"
printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{40}$' || die "réponse inattendue de l'API GitHub"
CUR=$(target current)
case "$CUR" in
  releases/"$SHA"-*) if [ -d "$CUR" ] && [ "${1:-}" != "--force" ]; then exit 0; fi ;;
esac

# 2. Archive de ce commit
STAGE="$APP_ROOT/.staging"
rm -rf "$STAGE"
mkdir -p "$STAGE/src" "$STAGE/out"
trap 'rm -rf "$STAGE"' EXIT
curl -fsS --max-time 300 --retry 2 --max-filesize 209715200 -o "$STAGE/app.tar.gz" \
  "$GITHUB_CODELOAD/$APP_REPO/tar.gz/$SHA" || die "téléchargement de l'archive impossible"
# git archive inscrit le commit dans l'en-tête de l'archive (pax « comment »)
gzip -dc "$STAGE/app.tar.gz" 2>/dev/null | head -c 1024 | grep -aq "comment=$SHA" \
  || die "l'archive ne correspond pas au commit $SHA"
tar -xzf "$STAGE/app.tar.gz" -C "$STAGE/src" --strip-components=1 --no-same-owner --no-same-permissions \
  || die "archive illisible"
rm -f "$STAGE/app.tar.gz"
chmod -R a+rX "$STAGE/src"

# 3. Sélection + vérification, isolées : pas de réseau, système de fichiers en
#    lecture seule (sauf le dossier de sortie), utilisateur « nobody »
chown 65534:65534 "$STAGE/out"
CURMOUNT=""
[ -n "$CUR" ] && [ -d "$CUR" ] && CURMOUNT="-v $APP_ROOT/$CUR:/current:ro"
# shellcheck disable=SC2086
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user 65534:65534 --memory 512m --pids-limit 64 \
  -v "$SETREMOTE_LIB/verify-app.mjs:/verify-app.mjs:ro" \
  -v "$STAGE/src:/src:ro" -v "$STAGE/out:/out" $CURMOUNT \
  "$APP_VERIFY_IMAGE" node /verify-app.mjs --src /src --out /out ${CURMOUNT:+--current /current} \
  || die "version ${SHA} refusée : rien n'a changé, la version en service continue"

# Contrôles indépendants du conteneur : uniquement des fichiers et dossiers
# ordinaires, aucun fichier caché
chown -R 0:0 "$STAGE/out"
[ -z "$(find "$STAGE/out" ! -type f ! -type d)" ] || die "lien ou fichier spécial dans le paquet"
[ -z "$(find "$STAGE/out" -mindepth 1 -name '.*')" ] || die "fichier caché dans le paquet"
[ -f "$STAGE/out/index.html" ] && [ -f "$STAGE/out/sw.js" ] || die "paquet incomplet"
chmod -R u=rwX,go=rX "$STAGE/out"

# 4. Bascule atomique : nouvelle version dans son propre dossier
#    (<commit>-<date UTC>-<n° de processus>), puis renommage du lien « current »
NEW="releases/$SHA-$(date -u +%Y%m%dT%H%M%SZ)-$$"
[ ! -e "$NEW" ] || die "$NEW existe déjà"
mv "$STAGE/out" "$NEW"
relink current "$NEW"
if [ -n "$CUR" ] && [ -d "$CUR" ]; then relink previous "$CUR"; fi
PREV=$(target previous)
for d in releases/*; do
  [ -d "$d" ] || continue
  [ "$d" = "$NEW" ] || [ "$d" = "$PREV" ] || rm -rf "$d"
done
PREV=${PREV#releases/}
say "version ${NEW#releases/} en service (précédente : ${PREV:-aucune})"

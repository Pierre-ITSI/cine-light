#!/bin/sh
# ════════════════════════════════════════════════════════════════════════════
# SetRemote : installe (ou réinstalle) la mise à jour automatique des fichiers
# de la PWA sur le VPS. À lancer depuis ce dossier, après « cp .env.example .env » :
#
#   sudo ./install-app-update.sh
#
# Installe update-app.sh (→ /usr/local/bin/setremote-update-app),
# verify-app.mjs (→ /usr/local/lib/setremote/), les réglages APP_* de .env
# (→ /etc/setremote/app.env) et le minuteur systemd (toutes les 5 minutes),
# puis fait une première mise à jour. Relancer après une mise à jour du kit ou
# un changement de APP_ROOT, APP_REPO ou APP_BRANCH dans .env.
# ════════════════════════════════════════════════════════════════════════════
set -eu
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
die() { printf '%s\n' "ERREUR : $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "à lancer avec sudo : sudo ./install-app-update.sh"
for c in curl tar gzip flock docker systemctl; do
  command -v "$c" >/dev/null 2>&1 || die "commande « $c » absente (Docker installé ? « sudo apt install -y curl util-linux »)"
done
[ -f "$HERE/.env" ] || die "$HERE/.env absent : « cp .env.example .env » puis l'adapter"

# Réglages APP_* de .env (valeurs par défaut sinon)
get() { sed -n "s/^$1=//p" "$HERE/.env" | tail -n 1 | sed -e 's/^["'\'']//' -e 's/["'\'']$//'; }
APP_ROOT=$(get APP_ROOT); APP_ROOT=${APP_ROOT:-/srv/setremote-app}
APP_REPO=$(get APP_REPO); APP_REPO=${APP_REPO:-pierre-itsi/cine-light}
APP_BRANCH=$(get APP_BRANCH); APP_BRANCH=${APP_BRANCH:-main}
case "$APP_ROOT" in /*) ;; *) die "APP_ROOT doit être un chemin absolu" ;; esac
case "$APP_ROOT" in *[!A-Za-z0-9_./-]*) die "APP_ROOT : lettres, chiffres, « _ . / - » seulement" ;; esac

install -D -m 0755 "$HERE/update-app.sh" /usr/local/bin/setremote-update-app
install -D -m 0644 "$HERE/verify-app.mjs" /usr/local/lib/setremote/verify-app.mjs
install -d -m 0755 /etc/setremote "$APP_ROOT"
cat > /etc/setremote/app.env <<EOF
# Écrit par install-app-update.sh depuis $HERE/.env : modifier .env puis relancer l'installation
APP_ROOT=$APP_ROOT
APP_REPO=$APP_REPO
APP_BRANCH=$APP_BRANCH
SETREMOTE_LIB=/usr/local/lib/setremote
EOF
chmod 0644 /etc/setremote/app.env

sed "s#^ReadWritePaths=.*#ReadWritePaths=$APP_ROOT#" "$HERE/systemd/setremote-app-update.service" \
  > /etc/systemd/system/setremote-app-update.service
install -m 0644 "$HERE/systemd/setremote-app-update.timer" /etc/systemd/system/setremote-app-update.timer
systemctl daemon-reload

echo "Image de vérification (Node 22) :"
docker pull -q node:22-alpine
echo "Première mise à jour (environ une minute) :"
if systemctl start setremote-app-update.service; then
  journalctl -u setremote-app-update.service -n 5 --no-pager -o cat || true
else
  journalctl -u setremote-app-update.service -n 20 --no-pager -o cat || true
  die "la première mise à jour a échoué (voir ci-dessus)"
fi
systemctl enable --now setremote-app-update.timer
/usr/local/bin/setremote-update-app --status
echo "Minuteur actif : systemctl list-timers setremote-app-update.timer"

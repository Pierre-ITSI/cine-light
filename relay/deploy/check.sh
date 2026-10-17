#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
# Vérifie le relais et la PWA SetRemote depuis l'EXTÉRIEUR (votre ordinateur,
# pas le VPS) :
#   relais : DNS, HTTPS (certificat valide) + /healthz, WebSocket (wss), STUN (3478) ;
#   PWA    : DNS, HTTPS, en-têtes de sécurité et de cache, sw.js et manifeste,
#            dossiers du dépôt NON publiés (relay/, tests/, docs/…).
#   ./check.sh hub.itsi-app.com set-remote.itsi-app.com
#   ./check.sh hub.itsi-app.com          (relais seul)
# Requis : curl, et Node 22 ou plus OU Docker (pour WebSocket + STUN : check.mjs).
# Essai local : CHECK_CURL_OPTS="--cacert root.crt --resolve nom:443:127.0.0.1"
set -u
set -f  # CHECK_CURL_OPTS découpé en mots, sans motifs de fichiers
DOMAIN="${1:-}"
APP_DOMAIN="${2:-}"
[ -n "$DOMAIN" ] || { echo "Usage : $0 hub.exemple.fr [app.exemple.fr]" >&2; exit 2; }
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
FAIL=0
ok() { echo "  ✓ $1"; }
ko() { echo "  ✗ $1"; FAIL=1; }
# shellcheck disable=SC2086
CURL() { curl ${CHECK_CURL_OPTS:-} "$@"; }

resolve() {
  if command -v getent >/dev/null 2>&1; then
    getent ahosts "$1" | awk '{print $1}' | sort -u | tr '\n' ' '
  elif command -v dig >/dev/null 2>&1; then
    (dig +short A "$1"; dig +short AAAA "$1") | tr '\n' ' '
  else
    host "$1" 2>/dev/null | awk '/has (IPv6 )?address/ {print $NF}' | tr '\n' ' '
  fi
}

echo "DNS"
IPS=$(resolve "$DOMAIN")
if [ -n "$IPS" ]; then ok "$DOMAIN → $IPS"; else ko "$DOMAIN ne se résout pas (enregistrement A/AAAA ?)"; fi

echo "HTTPS"
if OUT=$(CURL -fsS --max-time 15 "https://$DOMAIN/healthz"); then
  ok "certificat valide, /healthz : $OUT"
else
  ko "https://$DOMAIN/healthz injoignable (ports 80/443, certificat, docker compose ps ?)"
fi

if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  node "$HERE/check.mjs" "$DOMAIN" || FAIL=1
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -v "$HERE/check.mjs:/check.mjs:ro" node:22-alpine node /check.mjs "$DOMAIN" || FAIL=1
else
  ko "Node 22 ou Docker requis pour vérifier WebSocket et STUN"
fi

if [ -n "$APP_DOMAIN" ]; then
  echo "PWA (https://$APP_DOMAIN/)"
  IPS=$(resolve "$APP_DOMAIN")
  if [ -n "$IPS" ]; then ok "DNS : $APP_DOMAIN → $IPS"; else ko "DNS : $APP_DOMAIN ne se résout pas (enregistrement A/AAAA ?)"; fi
  # En-têtes d'une adresse, en minuscules, ligne de statut comprise
  head_of() { CURL -sS -o /dev/null -D - --max-time 15 "https://$APP_DOMAIN$1" 2>/dev/null | tr -d '\r' | tr '[:upper:]' '[:lower:]'; }
  H=$(head_of /)
  has() { printf '%s\n' "$H" | grep -q "$1"; }
  if has '^http/[0-9.]* 200'; then ok "HTTPS : certificat valide, page d'accueil servie"
  else ko "HTTPS : https://$APP_DOMAIN/ injoignable ou en erreur (certificat ? sur le VPS : sudo setremote-update-app --status)"; fi
  if has '^strict-transport-security: max-age='; then ok "HSTS"; else ko "en-tête Strict-Transport-Security absent"; fi
  if has '^referrer-policy: no-referrer'; then ok "Referrer-Policy : no-referrer"; else ko "Referrer-Policy absente ou différente de no-referrer"; fi
  if has '^permissions-policy:.*camera=(self)'; then ok "Permissions-Policy : caméra pour le site seul"; else ko "Permissions-Policy absente"; fi
  if has '^x-content-type-options: nosniff'; then ok "X-Content-Type-Options : nosniff"; else ko "X-Content-Type-Options absent"; fi
  CSP=$(printf '%s\n' "$H" | sed -n 's/^content-security-policy: //p')
  RELAY_LC=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')
  case "$CSP" in
    *"default-src 'self'"*"connect-src 'self' wss://$RELAY_LC"*) ok "CSP stricte, WebSocket vers wss://$DOMAIN permis" ;;
    '') ko "en-tête Content-Security-Policy absent" ;;
    *) ko "CSP inattendue (connect-src sans wss://$DOMAIN ?) : $CSP" ;;
  esac
  if has '^cache-control: no-cache'; then ok "index.html : Cache-Control no-cache"; else ko "index.html : Cache-Control no-cache attendu"; fi
  H=$(head_of /sw.js)
  if has '^http/[0-9.]* 200' && has '^content-type: text/javascript' && has '^cache-control: no-cache'; then
    ok "sw.js : servi en JavaScript, no-cache"
  else ko "sw.js : absent, mauvais type ou mis en cache"; fi
  H=$(head_of /manifest.webmanifest)
  if has '^http/[0-9.]* 200' && has '^content-type: application/manifest+json'; then ok "manifest.webmanifest : application/manifest+json"
  else ko "manifest.webmanifest : absent ou mauvais type"; fi
  # Rien d'autre que la PWA : ni dossiers du dépôt, ni liste de dossier
  LEAK=""
  for p in /relay/ /relay/server.js /tests/ /docs/ /docs/BROKER.md /expo-app/ /web/ /web/js/01-config.js \
    /packages/ /package.json /README.md /vendor/ /releases/ /current/ /.git/config /.env; do
    code=$(CURL -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$APP_DOMAIN$p")
    [ "$code" = 404 ] || LEAK="$LEAK $p($code)"
  done
  if [ -z "$LEAK" ]; then ok "dossiers du dépôt non publiés, aucune liste de dossier (404)"; else ko "adresses inattendues :$LEAK"; fi
fi

if [ "$FAIL" -eq 0 ]; then echo "Tout est en ordre."; else echo "Au moins une vérification a échoué : voir README.md, « Dépannage »."; fi
exit "$FAIL"

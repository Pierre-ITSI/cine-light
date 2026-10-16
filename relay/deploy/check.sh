#!/bin/sh
# Vérifie le relais SetRemote depuis l'EXTÉRIEUR (votre ordinateur, pas le VPS) :
# DNS, HTTPS (certificat valide) + /healthz, WebSocket (wss) et STUN (3478).
#   ./check.sh relais.exemple.fr
# Requis : curl, et Node 22 ou plus OU Docker (pour WebSocket + STUN : check.mjs).
set -u
DOMAIN="${1:-}"
[ -n "$DOMAIN" ] || { echo "Usage : $0 relais.exemple.fr" >&2; exit 2; }
HERE=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
FAIL=0

echo "DNS"
if command -v getent >/dev/null 2>&1; then
  IPS=$(getent ahosts "$DOMAIN" | awk '{print $1}' | sort -u | tr '\n' ' ')
elif command -v dig >/dev/null 2>&1; then
  IPS=$( (dig +short A "$DOMAIN"; dig +short AAAA "$DOMAIN") | tr '\n' ' ')
else
  IPS=$(host "$DOMAIN" 2>/dev/null | awk '/has (IPv6 )?address/ {print $NF}' | tr '\n' ' ')
fi
if [ -n "$IPS" ]; then echo "  ✓ $DOMAIN → $IPS"; else echo "  ✗ $DOMAIN ne se résout pas (enregistrement A/AAAA ?)"; FAIL=1; fi

echo "HTTPS"
if OUT=$(curl -fsS --max-time 15 "https://$DOMAIN/healthz"); then
  echo "  ✓ certificat valide, /healthz : $OUT"
else
  echo "  ✗ https://$DOMAIN/healthz injoignable (ports 80/443, certificat, docker compose ps ?)"; FAIL=1
fi

if command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  node "$HERE/check.mjs" "$DOMAIN" || FAIL=1
elif command -v docker >/dev/null 2>&1; then
  docker run --rm -v "$HERE/check.mjs:/check.mjs:ro" node:22-alpine node /check.mjs "$DOMAIN" || FAIL=1
else
  echo "  ✗ Node 22 ou Docker requis pour vérifier WebSocket et STUN"; FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then echo "Tout est en ordre."; else echo "Au moins une vérification a échoué : voir README.md, « Dépannage »."; fi
exit "$FAIL"

#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
# Compile l'app iOS sur EAS (cloud, pas de Mac) puis l'envoie sur TestFlight.
# Sans aucune question : tout passe par des variables d'environnement.
#
# Variables requises (secrets, jamais dans le dépôt) :
#   EXPO_TOKEN              jeton d'accès Expo (expo.dev → Access tokens)
#   EXPO_ASC_KEY_ID         ID de la clé API App Store Connect
#   EXPO_ASC_ISSUER_ID      Issuer ID de cette clé
#   ASC_API_KEY_P8_BASE64   contenu du fichier AuthKey_XXXX.p8, encodé en base64
#   EXPO_APPLE_TEAM_ID      Team ID Apple (10 caractères)
#   ASC_APP_ID              Apple ID numérique de l'app dans App Store Connect
# Optionnelle :
#   EXPO_APPLE_TEAM_TYPE    COMPANY_OR_ORGANIZATION (défaut) | INDIVIDUAL
set -euo pipefail
cd "$(dirname "$0")/.."   # dossier expo-app

EAS="npx --yes eas-cli@24.14.0"

for v in EXPO_TOKEN EXPO_ASC_KEY_ID EXPO_ASC_ISSUER_ID ASC_API_KEY_P8_BASE64 EXPO_APPLE_TEAM_ID ASC_APP_ID; do
  if [ -z "${!v:-}" ]; then echo "✗ Variable manquante : $v" >&2; exit 1; fi
done
export EXPO_APPLE_TEAM_TYPE="${EXPO_APPLE_TEAM_TYPE:-COMPANY_OR_ORGANIZATION}"

# Clé API App Store Connect : écrite dans un fichier temporaire, supprimé à la fin
KEY_DIR="$(mktemp -d)"
trap 'rm -rf "$KEY_DIR"' EXIT
printf '%s' "$ASC_API_KEY_P8_BASE64" | base64 -d > "$KEY_DIR/AuthKey.p8"
export EXPO_ASC_API_KEY_PATH="$KEY_DIR/AuthKey.p8"

echo "→ Compte Expo : $($EAS whoami)"

# 1. Lier le projet EAS (crée extra.eas.projectId dans app.json la 1re fois)
if ! grep -q '"projectId"' app.json; then
  $EAS init --non-interactive --force
fi

# 2. Renseigner l'app App Store Connect pour l'envoi automatique
node -e '
  const fs = require("fs");
  const p = "eas.json", d = JSON.parse(fs.readFileSync(p, "utf8"));
  d.submit = d.submit || {};
  d.submit.production = d.submit.production || {};
  d.submit.production.ios = Object.assign({}, d.submit.production.ios, { ascAppId: process.env.ASC_APP_ID });
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
'

# 3. Compiler (certificats et profils générés via la clé API) puis envoyer
$EAS build --platform ios --profile production --non-interactive --auto-submit --wait

echo "✓ Build envoyé à App Store Connect. Il apparaît dans TestFlight après le traitement Apple (~10–30 min)."

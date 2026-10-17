<!-- GÉNÉRÉ par scripts/third-party-notices.mjs — ne pas éditer à la main : modifier le script puis le relancer. -->
# Avis relatifs aux composants tiers — SetRemote

SetRemote est © 2026 ITSI APP, distribué sous licence GNU AGPL v3 seule
(`AGPL-3.0-only`, voir [LICENSE](LICENSE)). Il inclut ou s'appuie sur les
composants tiers ci-dessous, chacun sous **sa propre licence**, qui reste
applicable à ce composant. Les textes de licence des copies figées sont livrés
à côté des fichiers, dans `vendor/`.

Contrôle : `node scripts/third-party-notices.mjs --check` (lancé par
`npm test`, tests/open-source.test.mjs). Régénération : même commande sans
`--check`, de préférence après `npm ci` dans `expo-app/` et `relay/` (pour
relever les lignes « Copyright » des paquets). Dans les tableaux npm, « — »
signifie que le paquet ne livre pas de ligne « Copyright » exploitable (licence
seule, ou pas de fichier de licence) : le titulaire est alors l'auteur indiqué
dans son `package.json`.

## 1. Copies figées servies par la PWA et embarquées dans l'app (`vendor/`)

### MQTT.js 5.16.1

- **Licence** : MIT — texte : [`vendor/mqtt-LICENSE.md`](vendor/mqtt-LICENSE.md)
- **Copyright** : Copyright (c) 2015-2016 MQTT.js contributors ; Copyright 2011-2014 by Adam Rudd
- **Provenance** : npm mqtt@5.16.1, dist/mqtt.min.js
- **Fichiers** : `vendor/mqtt-5.16.1.min.js`
- **Note** : Bundle navigateur produit par le projet MQTT.js : il inclut ses dépendances d'exécution (mqtt-packet, readable-stream, buffer, events, process, debug, lru-cache, rfdc, worker-timers…), toutes sous licences permissives (MIT / ISC) d'après leurs paquets npm. Liste exhaustive des modules inclus : à vérifier (métafichier esbuild de mqtt).

### QR Code Generator (qrcode-generator) 2.0.4

- **Licence** : MIT — texte : [`vendor/qrcode-generator-LICENSE.md`](vendor/qrcode-generator-LICENSE.md)
- **Copyright** : Copyright (c) 2009 Kazuhiko Arase
- **Provenance** : npm qrcode-generator@2.0.4, dist/qrcode.js
- **Fichiers** : `vendor/qrcode-generator-2.0.4.js`
- **Note** : « QR Code » est une marque déposée de DENSO WAVE INCORPORATED.

### jsQR 1.4.0

- **Licence** : Apache-2.0 — texte : [`vendor/jsqr-LICENSE.txt`](vendor/jsqr-LICENSE.txt)
- **Copyright** : Cosmo Wolfe, Jefff Nelson (auteurs déclarés dans le package.json ; le paquet n'a pas de ligne Copyright ni de fichier NOTICE)
- **Provenance** : npm jsqr@1.4.0, dist/jsQR.js
- **Fichiers** : `vendor/jsqr-1.4.0.js`

### DM Mono (via @fontsource/dm-mono) 5.3.0

- **Licence** : OFL-1.1 — texte : [`vendor/fonts/dm-mono-OFL.txt`](vendor/fonts/dm-mono-OFL.txt)
- **Copyright** : Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono)
- **Provenance** : npm @fontsource/dm-mono@5.3.0 (fichiers identiques à ceux de Google Fonts, DM Mono v16)
- **Fichiers** : `vendor/fonts/dm-mono-latin-300-normal.woff2`, `vendor/fonts/dm-mono-latin-400-normal.woff2`, `vendor/fonts/dm-mono-latin-500-normal.woff2`, `vendor/fonts/dm-mono-latin-ext-300-normal.woff2`, `vendor/fonts/dm-mono-latin-ext-400-normal.woff2`, `vendor/fonts/dm-mono-latin-ext-500-normal.woff2`

### Lato (via @fontsource/lato) 5.3.0

- **Licence** : OFL-1.1 — texte : [`vendor/fonts/lato-OFL.txt`](vendor/fonts/lato-OFL.txt)
- **Copyright** : Copyright (c) 2010-2011 by tyPoland Lukasz Dziedzic (team@latofonts.com), Reserved Font Name « Lato »
- **Provenance** : npm @fontsource/lato@5.3.0 (fichiers identiques à ceux de Google Fonts, Lato v25)
- **Fichiers** : `vendor/fonts/lato-latin-400-normal.woff2`, `vendor/fonts/lato-latin-700-normal.woff2`, `vendor/fonts/lato-latin-ext-400-normal.woff2`, `vendor/fonts/lato-latin-ext-700-normal.woff2`
- **Note** : Police non modifiée : le nom réservé « Lato » peut être conservé.

## 2. Relais auto-hébergé (`relay/`, image Docker)

### Dépendances npm de production du relais

Licences : MIT : 1.

<!-- npm:relay:begin -->
| Paquet | Version | Licence | Copyright (1re ligne du fichier de licence) | Direct |
|---|---|---|---|---|
| `ws` | 8.22.0 | MIT | Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com> | oui |
<!-- npm:relay:end -->

L'image Docker du relais est construite localement par l'exploitant
(`relay/Dockerfile`, base `node:22-alpine` : Node.js sous licence MIT,
paquets Alpine sous diverses licences dont GPL-2.0 pour BusyBox). ITSI APP ne
publie pas d'image : si une image était un jour publiée sur un registre, les
obligations de ces paquets (offre des sources GPL notamment) s'appliqueraient.
Les images référencées par `relay/deploy/docker-compose.yml`, **Caddy**
(Apache-2.0) et **coturn** (BSD-3-Clause), sont téléchargées par l'exploitant
depuis leurs éditeurs et ne sont pas redistribuées par SetRemote.

## 3. Application native (`expo-app/`, iOS / Android)

### Dépendances npm de production de l'app native

590 paquets — licences : MIT : 510 · ISC : 24 · Apache-2.0 : 13 · MPL-2.0 : 12 · BSD-3-Clause : 9 · BlueOak-1.0.0 : 6 · BSD-2-Clause : 4 · (MIT OR CC0-1.0) : 3 · 0BSD : 2 · Unlicense : 2 · (BSD-3-Clause OR GPL-2.0) : 1 · (MIT OR Apache-2.0) : 1 · CC-BY-4.0 : 1 · MIT AND Apache-2.0 : 1 · Python-2.0 : 1.

Ensemble large : il inclut les outils de build tirés par `expo` (Metro, Babel,
lightningcss, `@expo/cli`…), qui ne sont pas embarqués dans le binaire. La liste
exacte des modules JavaScript embarqués se lit dans le bundle Metro de
production (à affiner avant la publication). « ⚠ » = licence hors de la liste
compatible par défaut, examinée au §4.

<!-- npm:expo-app:begin -->
| Paquet | Version | Licence | Copyright (1re ligne du fichier de licence) | Direct |
|---|---|---|---|---|
| `@adobe/css-tools` | 4.5.0 | MIT | Copyright (c) 2012 TJ Holowaychuk <tj@vision-media.ca> |  |
| `@babel/code-frame` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/compat-data` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/core` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/generator` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-annotate-as-pure` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-compilation-targets` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-create-class-features-plugin` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-create-regexp-features-plugin` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-define-polyfill-provider` | 0.6.8 | MIT | Copyright (c) 2014-present Nicolò Ribaudo and other contributors |  |
| `@babel/helper-globals` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-member-expression-to-functions` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-module-imports` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-module-transforms` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-optimise-call-expression` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-plugin-utils` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-remap-async-to-generator` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-replace-supers` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-skip-transparent-expression-wrappers` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-string-parser` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-validator-identifier` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-validator-option` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helper-wrap-function` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/helpers` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/parser` | 7.29.7 | MIT | Copyright (C) 2012-2014 by various contributors (see AUTHORS) |  |
| `@babel/plugin-proposal-decorators` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-proposal-export-default-from` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-syntax-decorators` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-syntax-dynamic-import` | 7.8.3 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-syntax-export-default-from` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-syntax-flow` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-syntax-jsx` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-syntax-nullish-coalescing-operator` | 7.8.3 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-syntax-optional-chaining` | 7.8.3 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-syntax-typescript` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-arrow-functions` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-async-generator-functions` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-async-to-generator` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-block-scoping` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-class-properties` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-class-static-block` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-classes` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-destructuring` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-export-namespace-from` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-flow-strip-types` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-for-of` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-logical-assignment-operators` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-modules-commonjs` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-named-capturing-groups-regex` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-nullish-coalescing-operator` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-object-rest-spread` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-optional-catch-binding` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-optional-chaining` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-parameters` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-private-methods` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-private-property-in-object` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-react-display-name` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-react-jsx` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-react-jsx-development` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-react-jsx-self` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-react-jsx-source` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-react-pure-annotations` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-regenerator` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-runtime` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-shorthand-properties` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-template-literals` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-typescript` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/plugin-transform-unicode-regex` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/preset-typescript` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/runtime` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/template` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/traverse` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@babel/types` | 7.29.7 | MIT | Copyright (c) 2014-present Sebastian McKenzie and other contributors |  |
| `@egjs/hammerjs` | 2.0.17 | MIT | Copyright (c) 2018-present NAVER Corp. |  |
| `@expo-google-fonts/material-symbols` | 0.4.38 | MIT AND Apache-2.0 | Copyright (c) 2020 Expo |  |
| `@expo/cli` | 56.1.16 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/code-signing-certificates` | 0.0.6 | MIT | Copyright (c) 2020-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/config` | 56.0.9 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/config-plugins` | 56.0.9 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/config-types` | 56.0.6 | MIT | Copyright (c) 2020-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/devcert` | 1.2.1 | MIT | — |  |
| `@expo/devtools` | 56.0.2 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/dom-webview` | 56.0.5 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/env` | 2.3.0 | MIT | Copyright (c) 2023-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/expo-modules-macros-plugin` | 0.2.2 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/fingerprint` | 0.19.4 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/image-utils` | 0.10.1 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/inline-modules` | 0.0.12 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/json-file` | 10.2.0 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/local-build-cache-provider` | 56.0.8 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/log-box` | 56.0.13 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/metro` | 56.0.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `@expo/metro-config` | 56.0.14 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/metro-file-map` | 56.0.3 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/metro-runtime` | 56.0.15 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | oui |
| `@expo/osascript` | 2.6.0 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/package-manager` | 1.12.1 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/plist` | 0.7.0 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/prebuild-config` | 56.0.16 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/require-utils` | 56.1.3 | MIT | Copyright (c) 2025-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/router-server` | 56.0.14 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/schema-utils` | 56.0.2 | MIT | Copyright (c) 2025-present 650 Industries, Inc. (aka Expo) |  |
| `@expo/sdk-runtime-versions` | 1.0.0 | MIT | — |  |
| `@expo/spawn-async` | 1.8.0 | MIT | Copyright (c) 2015 650 Industries |  |
| `@expo/sudo-prompt` | 9.3.2 | MIT | Copyright (c) 2015 Joran Dirk Greef |  |
| `@expo/ui` | 56.0.18 | MIT | — |  |
| `@expo/ws-tunnel` | 2.0.0 | MIT | — |  |
| `@expo/xcpretty` | 4.4.4 | BSD-3-Clause | — |  |
| `@isaacs/ttlcache` | 1.4.1 | ISC | Copyright (c) 2022-2023 - Isaac Z. Schlueter and Contributors |  |
| `@jest/schemas` | 29.6.3 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `@jest/types` | 29.6.3 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `@jridgewell/gen-mapping` | 0.3.13 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |  |
| `@jridgewell/remapping` | 2.3.5 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |  |
| `@jridgewell/resolve-uri` | 3.1.2 | MIT | Copyright 2019 Justin Ridgewell <jridgewell@google.com> |  |
| `@jridgewell/source-map` | 0.3.11 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |  |
| `@jridgewell/sourcemap-codec` | 1.5.5 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |  |
| `@jridgewell/trace-mapping` | 0.3.31 | MIT | Copyright 2024 Justin Ridgewell <justin@ridgewell.name> |  |
| `@radix-ui/primitive` | 1.1.4 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-collection` | 1.1.10 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-compose-refs` | 1.1.3 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-context` | 1.1.4 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-dialog` | 1.1.17 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-direction` | 1.1.2 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-dismissable-layer` | 1.1.13 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-focus-guards` | 1.1.4 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-focus-scope` | 1.1.10 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-id` | 1.1.2 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-portal` | 1.1.12 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-presence` | 1.1.6 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-primitive` | 2.1.6 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-roving-focus` | 1.1.13 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-slot` | 1.3.0 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-tabs` | 1.1.15 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-use-callback-ref` | 1.1.2 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-use-controllable-state` | 1.2.3 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-use-effect-event` | 0.0.3 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-use-escape-keydown` | 1.1.2 | MIT | Copyright (c) 2022 WorkOS |  |
| `@radix-ui/react-use-layout-effect` | 1.1.2 | MIT | Copyright (c) 2022 WorkOS |  |
| `@react-native-masked-view/masked-view` | 0.3.2 | MIT | Copyright (c) 2015-present, Facebook, Inc. |  |
| `@react-native/assets-registry` | 0.85.3 | MIT | — |  |
| `@react-native/babel-plugin-codegen` | 0.85.3 | MIT | — |  |
| `@react-native/babel-preset` | 0.85.3 | MIT | — |  |
| `@react-native/codegen` | 0.85.3 | MIT | — |  |
| `@react-native/community-cli-plugin` | 0.85.3 | MIT | — |  |
| `@react-native/debugger-frontend` | 0.85.3 | BSD-3-Clause | — |  |
| `@react-native/debugger-shell` | 0.85.3 | MIT | — |  |
| `@react-native/dev-middleware` | 0.85.3 | MIT | — |  |
| `@react-native/gradle-plugin` | 0.85.3 | MIT | — |  |
| `@react-native/js-polyfills` | 0.85.3 | MIT | — |  |
| `@react-native/metro-babel-transformer` | 0.85.3 | MIT | — |  |
| `@react-native/metro-config` | 0.85.3 | MIT | — |  |
| `@react-native/normalize-colors` | 0.74.89 | MIT | — |  |
| `@react-native/normalize-colors` | 0.85.3 | MIT | — |  |
| `@react-native/virtualized-lists` | 0.85.3 | MIT | — |  |
| `@react-navigation/core` | 7.21.1 | MIT | Copyright (c) 2017 React Navigation Contributors |  |
| `@react-navigation/native` | 7.3.3 | MIT | Copyright (c) 2017 React Navigation Contributors | oui |
| `@react-navigation/routers` | 7.6.0 | MIT | Copyright (c) 2017 React Navigation Contributors |  |
| `@sinclair/typebox` | 0.27.10 | MIT | Copyright (c) 2017-2023 Haydn Paterson (sinclair) <haydn.developer@gmail.com> |  |
| `@testing-library/dom` | 10.4.1 | MIT | Copyright (c) 2017 Kent C. Dodds |  |
| `@testing-library/jest-dom` | 6.9.1 | MIT | Copyright (c) 2017 Kent C. Dodds |  |
| `@testing-library/user-event` | 14.6.1 | MIT | Copyright (c) 2020 Giorgio Polvara |  |
| `@types/aria-query` | 5.0.4 | MIT | Copyright (c) Microsoft Corporation. |  |
| `@types/emscripten` | 1.41.5 | MIT | Copyright (c) Microsoft Corporation. |  |
| `@types/hammerjs` | 2.0.46 | MIT | Copyright (c) Microsoft Corporation. |  |
| `@types/istanbul-lib-coverage` | 2.0.6 | MIT | Copyright (c) Microsoft Corporation. |  |
| `@types/istanbul-lib-report` | 3.0.3 | MIT | Copyright (c) Microsoft Corporation. |  |
| `@types/istanbul-reports` | 3.0.4 | MIT | Copyright (c) Microsoft Corporation. |  |
| `@types/node` | 26.0.0 | MIT | Copyright (c) Microsoft Corporation. |  |
| `@types/react` | 19.2.17 | MIT | Copyright (c) Microsoft Corporation. |  |
| `@types/react-test-renderer` | 19.1.0 | MIT | Copyright (c) Microsoft Corporation. |  |
| `@types/yargs` | 17.0.35 | MIT | Copyright (c) Microsoft Corporation. |  |
| `@types/yargs-parser` | 21.0.3 | MIT | Copyright (c) Microsoft Corporation. |  |
| `@ungap/structured-clone` | 1.3.1 | ISC | Copyright (c) 2021, Andrea Giammarchi, @WebReflection |  |
| `@xmldom/xmldom` | 0.8.13 | MIT | Copyright 2019 - present Christopher J. Brody and other contributors, as listed in: https://github.com/xmldom/xmldom/graphs/contributors |  |
| `@xmldom/xmldom` | 0.9.10 | MIT | Copyright 2019 - present Christopher J. Brody and other contributors, as listed in: https://github.com/xmldom/xmldom/graphs/contributors |  |
| `abort-controller` | 3.0.0 | MIT | Copyright (c) 2017 Toru Nagashima |  |
| `accepts` | 1.3.8 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> |  |
| `accepts` | 2.0.0 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> |  |
| `acorn` | 8.17.0 | MIT | Copyright (C) 2012-2022 by various contributors (see AUTHORS) |  |
| `agent-base` | 7.1.4 | MIT | Copyright (c) 2013 Nathan Rajlich <nathan@tootallnate.net> |  |
| `anser` | 1.4.10 | MIT | Copyright (c) 2012-20 Ionică Bizău <bizauionica@gmail.com> (https://ionicabizau.net) |  |
| `ansi-escapes` | 4.3.2 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |  |
| `ansi-regex` | 4.1.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `ansi-regex` | 5.0.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `ansi-styles` | 3.2.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `ansi-styles` | 4.3.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `ansi-styles` | 5.2.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `arg` | 5.0.2 | MIT | Copyright (c) 2021 Vercel, Inc. |  |
| `argparse` | 2.0.1 | Python-2.0 ⚠ | Copyright (c) 1991 - 1995, Stichting Mathematisch Centrum Amsterdam, |  |
| `aria-hidden` | 1.2.6 | MIT | Copyright (c) 2017 Anton Korzunov |  |
| `aria-query` | 5.3.0 | Apache-2.0 | Copyright 2020 A11yance |  |
| `asap` | 2.0.6 | MIT | Copyright 2009–2014 Contributors. All rights reserved. |  |
| `babel-plugin-polyfill-corejs2` | 0.4.17 | MIT | Copyright (c) 2014-present Nicolò Ribaudo and other contributors |  |
| `babel-plugin-polyfill-corejs3` | 0.13.0 | MIT | Copyright (c) 2014-present Nicolò Ribaudo and other contributors |  |
| `babel-plugin-polyfill-regenerator` | 0.6.8 | MIT | Copyright (c) 2014-present Nicolò Ribaudo and other contributors |  |
| `babel-plugin-react-compiler` | 1.0.0 | MIT | — |  |
| `babel-plugin-react-native-web` | 0.21.2 | MIT | Copyright (c) Nicolas Gallagher. |  |
| `babel-plugin-syntax-hermes-parser` | 0.33.3 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `babel-plugin-transform-flow-enums` | 0.0.2 | MIT | — |  |
| `babel-preset-expo` | 56.0.15 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `balanced-match` | 4.0.4 | MIT | — |  |
| `barcode-detector` | 3.2.0 | MIT | Copyright (c) 2023 Ze-Zheng Wu |  |
| `base64-js` | 1.5.1 | MIT | Copyright (c) 2014 Jameson Little |  |
| `baseline-browser-mapping` | 2.10.38 | Apache-2.0 | — |  |
| `big-integer` | 1.6.52 | Unlicense | — |  |
| `bplist-creator` | 0.1.0 | MIT | Copyright (c) 2012 Near Infinity Corporation |  |
| `bplist-parser` | 0.3.1 | MIT | — |  |
| `brace-expansion` | 5.0.6 | MIT | Copyright Julian Gruber <julian@juliangruber.com> |  |
| `braces` | 3.0.3 | MIT | Copyright (c) 2014-present, Jon Schlinkert. |  |
| `browserslist` | 4.28.2 | MIT | Copyright 2014 Andrey Sitnik <andrey@sitnik.es> and other contributors |  |
| `bser` | 2.1.1 | Apache-2.0 | — |  |
| `buffer-from` | 1.1.2 | MIT | Copyright (c) 2016, 2018 Linus Unnebäck |  |
| `bytes` | 3.1.2 | MIT | Copyright (c) 2012-2014 TJ Holowaychuk <tj@vision-media.ca> |  |
| `camelcase` | 6.3.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |  |
| `caniuse-lite` | 1.0.30001799 | CC-BY-4.0 ⚠ | — |  |
| `chalk` | 2.4.2 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `chalk` | 4.1.2 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `chrome-launcher` | 0.15.2 | Apache-2.0 | Copyright 2014 Google Inc. |  |
| `chromium-edge-launcher` | 0.3.0 | Apache-2.0 | Copyright 2014 Google Inc. |  |
| `ci-info` | 2.0.0 | MIT | Copyright (c) 2016-2018 Thomas Watson Steen |  |
| `ci-info` | 3.9.0 | MIT | Copyright (c) 2016 Thomas Watson Steen |  |
| `cli-cursor` | 2.1.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `cli-spinners` | 2.9.2 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |  |
| `client-only` | 0.0.1 | MIT | — |  |
| `cliui` | 8.0.1 | ISC | Copyright (c) 2015, Contributors |  |
| `clone` | 1.0.4 | MIT | Copyright © 2011-2015 Paul Vorbach <paul@vorba.ch> |  |
| `color` | 4.2.3 | MIT | Copyright (c) 2012 Heather Arthur |  |
| `color-convert` | 1.9.3 | MIT | Copyright (c) 2011-2016 Heather Arthur <fayearthur@gmail.com> |  |
| `color-convert` | 2.0.1 | MIT | Copyright (c) 2011-2016 Heather Arthur <fayearthur@gmail.com> |  |
| `color-name` | 1.1.3 | MIT | Copyright (c) 2015 Dmitry Ivanov |  |
| `color-name` | 1.1.4 | MIT | Copyright (c) 2015 Dmitry Ivanov |  |
| `color-string` | 1.9.1 | MIT | Copyright (c) 2011 Heather Arthur <fayearthur@gmail.com> |  |
| `commander` | 12.1.0 | MIT | Copyright (c) 2011 TJ Holowaychuk <tj@vision-media.ca> |  |
| `commander` | 2.20.3 | MIT | Copyright (c) 2011 TJ Holowaychuk <tj@vision-media.ca> |  |
| `commander` | 7.2.0 | MIT | Copyright (c) 2011 TJ Holowaychuk <tj@vision-media.ca> |  |
| `compressible` | 2.0.18 | MIT | Copyright (c) 2013 Jonathan Ong <me@jongleberry.com> |  |
| `compression` | 1.8.1 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> |  |
| `connect` | 3.7.0 | MIT | Copyright (c) 2010 Sencha Inc. |  |
| `convert-source-map` | 2.0.0 | MIT | Copyright 2013 Thorsten Lorenz. |  |
| `core-js-compat` | 3.49.0 | MIT | Copyright (c) 2013–2025 Denis Pushkarev (zloirock.ru) |  |
| `cross-fetch` | 3.2.0 | MIT | Copyright (c) 2017 Leonardo Quixadá |  |
| `cross-spawn` | 7.0.6 | MIT | Copyright (c) 2018 Made With MOXY Lda <hello@moxy.studio> |  |
| `css-in-js-utils` | 3.1.0 | MIT | Copyright (c) 2017 Robin Frischmann |  |
| `css.escape` | 1.5.1 | MIT | — |  |
| `csstype` | 3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol |  |
| `debug` | 2.6.9 | MIT | Copyright (c) 2014 TJ Holowaychuk <tj@vision-media.ca> |  |
| `debug` | 3.2.7 | MIT | Copyright (c) 2014 TJ Holowaychuk <tj@vision-media.ca> |  |
| `debug` | 4.4.3 | MIT | Copyright (c) 2014-2017 TJ Holowaychuk <tj@vision-media.ca> |  |
| `decode-uri-component` | 0.2.2 | MIT | Copyright (c) 2017, Sam Verschueren <sam.verschueren@gmail.com> (github.com/SamVerschueren) |  |
| `deepmerge` | 4.3.1 | MIT | Copyright (c) 2012 James Halliday, Josh Duff, and other contributors |  |
| `defaults` | 1.0.4 | MIT | Copyright (c) 2022 Sindre Sorhus |  |
| `depd` | 2.0.0 | MIT | Copyright (c) 2014-2018 Douglas Christopher Wilson |  |
| `dequal` | 2.0.3 | MIT | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) |  |
| `destroy` | 1.2.0 | MIT | Copyright (c) 2014 Jonathan Ong me@jongleberry.com |  |
| `detect-libc` | 2.1.2 | Apache-2.0 | — |  |
| `detect-node-es` | 1.1.0 | MIT | Copyright (c) 2017 Ilya Kantor |  |
| `dnssd-advertise` | 1.1.6 | MIT | Copyright (c) Phil Pluckthun, |  |
| `dom-accessibility-api` | 0.5.16 | MIT | Copyright (c) 2020 Sebastian Silbermann |  |
| `dom-accessibility-api` | 0.6.3 | MIT | Copyright (c) 2020 Sebastian Silbermann |  |
| `ee-first` | 1.1.1 | MIT | Copyright (c) 2014 Jonathan Ong me@jongleberry.com |  |
| `electron-to-chromium` | 1.5.376 | ISC | Copyright 2018 Kilian Valkhof |  |
| `emoji-regex` | 8.0.0 | MIT | — |  |
| `encodeurl` | 1.0.2 | MIT | Copyright (c) 2016 Douglas Christopher Wilson |  |
| `encodeurl` | 2.0.0 | MIT | Copyright (c) 2016 Douglas Christopher Wilson |  |
| `error-stack-parser` | 2.1.4 | MIT | Copyright (c) 2017 Eric Wendelin and other contributors |  |
| `es-errors` | 1.3.0 | MIT | Copyright (c) 2024 Jordan Harband |  |
| `escalade` | 3.2.0 | MIT | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) |  |
| `escape-html` | 1.0.3 | MIT | Copyright (c) 2012-2013 TJ Holowaychuk |  |
| `escape-string-regexp` | 1.0.5 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `escape-string-regexp` | 4.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |  |
| `etag` | 1.8.1 | MIT | Copyright (c) 2014-2016 Douglas Christopher Wilson |  |
| `event-target-shim` | 5.0.1 | MIT | Copyright (c) 2015 Toru Nagashima |  |
| `expo` | 56.0.12 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | oui |
| `expo-asset` | 56.0.17 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `expo-brightness` | 56.0.5 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | oui |
| `expo-camera` | 56.0.8 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | oui |
| `expo-constants` | 56.0.18 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | oui |
| `expo-dev-client` | 56.0.27 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | oui |
| `expo-dev-launcher` | 56.0.28 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `expo-dev-menu` | 56.0.23 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `expo-dev-menu-interface` | 56.0.1 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `expo-file-system` | 56.0.8 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | oui |
| `expo-font` | 56.0.7 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `expo-glass-effect` | 56.0.4 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `expo-image-loader` | 56.0.3 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `expo-image-picker` | 56.0.18 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | oui |
| `expo-json-utils` | 56.0.0 | MIT | — |  |
| `expo-keep-awake` | 56.0.3 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | oui |
| `expo-linking` | 56.0.14 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | oui |
| `expo-manifests` | 56.0.4 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `expo-modules-autolinking` | 56.0.16 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `expo-modules-core` | 56.0.17 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `expo-modules-jsi` | 56.0.10 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `expo-navigation-bar` | 56.0.3 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | oui |
| `expo-print` | 56.0.4 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | oui |
| `expo-router` | 56.2.11 | MIT | — | oui |
| `expo-server` | 56.0.5 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `expo-status-bar` | 56.0.4 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | oui |
| `expo-symbols` | 56.0.6 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `expo-system-ui` | 56.0.5 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) | oui |
| `expo-updates-interface` | 56.0.2 | MIT | Copyright (c) 2015-present 650 Industries, Inc. (aka Expo) |  |
| `exponential-backoff` | 3.1.3 | Apache-2.0 | Copyright 2019 Coveo Solutions Inc. |  |
| `fast-deep-equal` | 3.1.3 | MIT | Copyright (c) 2017 Evgeny Poberezkin |  |
| `fb-dotslash` | 0.5.8 | (MIT OR Apache-2.0) | — |  |
| `fb-watchman` | 2.0.2 | Apache-2.0 | — |  |
| `fbjs` | 3.0.5 | MIT | Copyright (c) 2013-present, Facebook, Inc. |  |
| `fbjs-css-vars` | 1.0.2 | MIT | Copyright (c) 2013-present, Facebook, Inc. |  |
| `fdir` | 6.5.0 | MIT | Copyright 2023 Abdullah Atta |  |
| `fetch-nodeshim` | 0.4.10 | MIT | Copyright (c) Phil Pluckthun, |  |
| `fill-range` | 7.1.1 | MIT | Copyright (c) 2014-present, Jon Schlinkert. |  |
| `filter-obj` | 1.1.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `finalhandler` | 1.1.2 | MIT | Copyright (c) 2014-2017 Douglas Christopher Wilson <doug@somethingdoug.com> |  |
| `flow-enums-runtime` | 0.0.6 | MIT | — |  |
| `fontfaceobserver` | 2.3.0 | BSD-2-Clause | Copyright (c) 2014 - Bram Stein |  |
| `fresh` | 0.5.2 | MIT | Copyright (c) 2012 TJ Holowaychuk <tj@vision-media.ca> |  |
| `function-bind` | 1.1.2 | MIT | Copyright (c) 2013 Raynos. |  |
| `gensync` | 1.0.0-beta.2 | MIT | Copyright 2018 Logan Smyth <loganfsmyth@gmail.com> |  |
| `get-caller-file` | 2.0.5 | ISC | Copyright 2018 Stefan Penner |  |
| `get-nonce` | 1.0.1 | MIT | Copyright (c) 2020 Anton Korzunov |  |
| `getenv` | 2.0.0 | MIT | Copyright (c) 2012-2019 Christoph Tavan <dev@tavan.de> |  |
| `glob` | 13.0.6 | BlueOak-1.0.0 | — |  |
| `graceful-fs` | 4.2.11 | ISC | Copyright (c) 2011-2022 Isaac Z. Schlueter, Ben Noordhuis, and Contributors |  |
| `has-flag` | 3.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `has-flag` | 4.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `hasown` | 2.0.4 | MIT | Copyright (c) Jordan Harband and contributors |  |
| `hermes-compiler` | 250829098.0.10 | MIT | — |  |
| `hermes-estree` | 0.33.3 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `hermes-estree` | 0.35.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `hermes-parser` | 0.33.3 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `hermes-parser` | 0.35.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `hoist-non-react-statics` | 3.3.2 | BSD-3-Clause | Copyright (c) 2015, Yahoo! Inc. All rights reserved. |  |
| `hosted-git-info` | 7.0.2 | ISC | Copyright (c) 2015, Rebecca Turner |  |
| `http-errors` | 2.0.1 | MIT | Copyright (c) 2014 Jonathan Ong me@jongleberry.com |  |
| `https-proxy-agent` | 7.0.6 | MIT | Copyright (c) 2013 Nathan Rajlich <nathan@tootallnate.net> |  |
| `hyphenate-style-name` | 1.1.0 | BSD-3-Clause | Copyright (c) 2015, Espen Hovlandsdal |  |
| `ignore` | 5.3.2 | MIT | — |  |
| `image-size` | 1.2.1 | MIT | Copyright © 2013-Present Aditya Yadav, http://netroy.in |  |
| `indent-string` | 4.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `inherits` | 2.0.4 | ISC | Copyright (c) Isaac Z. Schlueter |  |
| `inline-style-prefixer` | 7.0.1 | MIT | Copyright (c) 2015 Robin Frischmann |  |
| `invariant` | 2.2.4 | MIT | Copyright (c) 2013-present, Facebook, Inc. |  |
| `is-arrayish` | 0.3.4 | MIT | Copyright (c) 2015 JD Ballard |  |
| `is-core-module` | 2.16.2 | MIT | Copyright (c) 2014 Dave Justice |  |
| `is-docker` | 2.2.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |  |
| `is-fullwidth-code-point` | 3.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `is-number` | 7.0.0 | MIT | Copyright (c) 2014-present, Jon Schlinkert. |  |
| `is-wsl` | 2.2.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `isexe` | 2.0.0 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |  |
| `jest-get-type` | 29.6.3 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `jest-util` | 29.7.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `jest-validate` | 29.7.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `jest-worker` | 29.7.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `jimp-compact` | 0.16.1 | MIT | — |  |
| `js-tokens` | 4.0.0 | MIT | Copyright (c) 2014, 2015, 2016, 2017, 2018 Simon Lydell |  |
| `js-yaml` | 4.2.0 | MIT | Copyright (C) 2011-2015 by Vitaly Puzrin |  |
| `jsc-safe-url` | 0.2.4 | 0BSD | — |  |
| `jsesc` | 3.1.0 | MIT | — |  |
| `json5` | 2.2.3 | MIT | Copyright (c) 2012-2018 Aseem Kishore, and [others]. |  |
| `kleur` | 3.0.3 | MIT | Copyright (c) Luke Edwards <luke.edwards05@gmail.com> (lukeed.com) |  |
| `lan-network` | 0.2.1 | MIT | Copyright (c) Phil Pluckthun, |  |
| `leven` | 3.1.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `lighthouse-logger` | 1.4.2 | Apache-2.0 | Copyright 2014 Google Inc. |  |
| `lightningcss` | 1.32.0 | MPL-2.0 ⚠ | — |  |
| `lightningcss-android-arm64` | 1.32.0 | MPL-2.0 ⚠ | — |  |
| `lightningcss-darwin-arm64` | 1.32.0 | MPL-2.0 ⚠ | — |  |
| `lightningcss-darwin-x64` | 1.32.0 | MPL-2.0 ⚠ | — |  |
| `lightningcss-freebsd-x64` | 1.32.0 | MPL-2.0 ⚠ | — |  |
| `lightningcss-linux-arm-gnueabihf` | 1.32.0 | MPL-2.0 ⚠ | — |  |
| `lightningcss-linux-arm64-gnu` | 1.32.0 | MPL-2.0 ⚠ | — |  |
| `lightningcss-linux-arm64-musl` | 1.32.0 | MPL-2.0 ⚠ | — |  |
| `lightningcss-linux-x64-gnu` | 1.32.0 | MPL-2.0 ⚠ | — |  |
| `lightningcss-linux-x64-musl` | 1.32.0 | MPL-2.0 ⚠ | — |  |
| `lightningcss-win32-arm64-msvc` | 1.32.0 | MPL-2.0 ⚠ | — |  |
| `lightningcss-win32-x64-msvc` | 1.32.0 | MPL-2.0 ⚠ | — |  |
| `lodash.debounce` | 4.0.8 | MIT | — |  |
| `lodash.throttle` | 4.1.1 | MIT | — |  |
| `log-symbols` | 2.2.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `loose-envify` | 1.4.0 | MIT | Copyright (c) 2015 Andres Suarez <zertosh@gmail.com> |  |
| `lru-cache` | 10.4.3 | ISC | Copyright (c) 2010-2023 Isaac Z. Schlueter and Contributors |  |
| `lru-cache` | 11.5.1 | BlueOak-1.0.0 | — |  |
| `lru-cache` | 5.1.1 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |  |
| `lz-string` | 1.5.0 | MIT | Copyright (c) 2013 pieroxy |  |
| `makeerror` | 1.0.12 | BSD-3-Clause | Copyright (c) 2014, Naitik Shah. All rights reserved. |  |
| `marky` | 1.3.0 | Apache-2.0 | Copyright 2016 Nolan Lawson |  |
| `memoize-one` | 5.2.1 | MIT | Copyright (c) 2019 Alexander Reardon |  |
| `memoize-one` | 6.0.0 | MIT | Copyright (c) 2019 Alexander Reardon |  |
| `merge-stream` | 2.0.0 | MIT | Copyright (c) Stephen Sugden <me@stephensugden.com> (stephensugden.com) |  |
| `metro` | 0.84.4 | MIT | — |  |
| `metro-babel-transformer` | 0.84.4 | MIT | — |  |
| `metro-cache` | 0.84.4 | MIT | — |  |
| `metro-cache-key` | 0.84.4 | MIT | — |  |
| `metro-config` | 0.84.4 | MIT | — |  |
| `metro-core` | 0.84.4 | MIT | — |  |
| `metro-file-map` | 0.84.4 | MIT | — |  |
| `metro-minify-terser` | 0.84.4 | MIT | — |  |
| `metro-resolver` | 0.84.4 | MIT | — |  |
| `metro-runtime` | 0.84.4 | MIT | — |  |
| `metro-source-map` | 0.84.4 | MIT | — |  |
| `metro-symbolicate` | 0.84.4 | MIT | — |  |
| `metro-transform-plugins` | 0.84.4 | MIT | — |  |
| `metro-transform-worker` | 0.84.4 | MIT | — |  |
| `micromatch` | 4.0.8 | MIT | Copyright (c) 2014-present, Jon Schlinkert. |  |
| `mime` | 1.6.0 | MIT | Copyright (c) 2010 Benjamin Thomas, Robert Kieffer |  |
| `mime-db` | 1.52.0 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> |  |
| `mime-db` | 1.54.0 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> |  |
| `mime-types` | 2.1.35 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> |  |
| `mime-types` | 3.0.2 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> |  |
| `mimic-fn` | 1.2.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `min-indent` | 1.0.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com), James Kyle <me@thejameskyle.com> (thejameskyle.com) |  |
| `minimatch` | 10.2.5 | BlueOak-1.0.0 | — |  |
| `minipass` | 7.1.3 | BlueOak-1.0.0 | — |  |
| `mkdirp` | 1.0.4 | MIT | Copyright James Halliday (mail@substack.net) and Isaac Z. Schlueter (i@izs.me) |  |
| `ms` | 2.0.0 | MIT | Copyright (c) 2016 Zeit, Inc. |  |
| `ms` | 2.1.3 | MIT | Copyright (c) 2020 Vercel, Inc. |  |
| `multitars` | 1.0.0 | MIT | Copyright (c) Phil Pluckthun, |  |
| `nanoid` | 3.3.13 | MIT | Copyright 2017 Andrey Sitnik <andrey@sitnik.ru> |  |
| `negotiator` | 0.6.3 | MIT | Copyright (c) 2012-2014 Federico Romero |  |
| `negotiator` | 0.6.4 | MIT | Copyright (c) 2012-2014 Federico Romero |  |
| `negotiator` | 1.0.0 | MIT | Copyright (c) 2012-2014 Federico Romero |  |
| `node-fetch` | 2.7.0 | MIT | Copyright (c) 2016 David Frank |  |
| `node-forge` | 1.4.0 | (BSD-3-Clause OR GPL-2.0) ⚠ | Copyright (c) 2010, Digital Bazaar, Inc. |  |
| `node-int64` | 0.4.0 | MIT | Copyright (c) 2014 Robert Kieffer |  |
| `node-releases` | 2.0.48 | MIT | Copyright (c) 2017 Sergey Rubanov (https://github.com/chicoxyzzy) |  |
| `npm-package-arg` | 11.0.3 | ISC | — |  |
| `nullthrows` | 1.1.1 | MIT | Copyright (c) 2016 Andres Suarez |  |
| `ob1` | 0.84.4 | MIT | — |  |
| `object-assign` | 4.1.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `on-finished` | 2.3.0 | MIT | Copyright (c) 2013 Jonathan Ong <me@jongleberry.com> |  |
| `on-finished` | 2.4.1 | MIT | Copyright (c) 2013 Jonathan Ong <me@jongleberry.com> |  |
| `on-headers` | 1.1.0 | MIT | Copyright (c) 2014 Douglas Christopher Wilson |  |
| `onetime` | 2.0.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `open` | 7.4.2 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |  |
| `ora` | 3.4.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `parse-png` | 2.1.0 | MIT | Copyright (c) Kevin Mårtensson <kevinmartensson@gmail.com> (github.com/kevva) |  |
| `parseurl` | 1.3.3 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> |  |
| `path-key` | 3.1.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `path-parse` | 1.0.7 | MIT | Copyright (c) 2015 Javier Blanco |  |
| `path-scurry` | 2.0.2 | BlueOak-1.0.0 | — |  |
| `picocolors` | 1.1.1 | ISC | Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov |  |
| `picomatch` | 2.3.2 | MIT | Copyright (c) 2017-present, Jon Schlinkert. |  |
| `picomatch` | 4.0.4 | MIT | Copyright (c) 2017-present, Jon Schlinkert. |  |
| `plist` | 3.1.1 | MIT | Copyright (c) 2010-2017 Nathan Rajlich <nathan@tootallnate.net> |  |
| `pngjs` | 3.4.0 | MIT | — |  |
| `postcss` | 8.5.15 | MIT | Copyright 2013 Andrey Sitnik <andrey@sitnik.es> |  |
| `postcss-value-parser` | 4.2.0 | MIT | Copyright (c) Bogdan Chadkin <trysound@yandex.ru> |  |
| `pretty-format` | 27.5.1 | MIT | — |  |
| `pretty-format` | 29.7.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `proc-log` | 4.2.0 | ISC | — |  |
| `progress` | 2.0.3 | MIT | Copyright (c) 2017 TJ Holowaychuk <tj@vision-media.ca> |  |
| `promise` | 7.3.1 | MIT | Copyright (c) 2014 Forbes Lindesay |  |
| `promise` | 8.3.0 | MIT | Copyright (c) 2014 Forbes Lindesay |  |
| `prompts` | 2.4.2 | MIT | Copyright (c) 2018 Terkel Gjervig Nielsen |  |
| `query-string` | 7.1.3 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (http://sindresorhus.com) |  |
| `queue` | 6.0.2 | MIT | Copyright (c) 2014 Jesse Tane <jesse.tane@gmail.com> |  |
| `range-parser` | 1.2.1 | MIT | Copyright (c) 2012-2014 TJ Holowaychuk <tj@vision-media.ca> |  |
| `react` | 19.2.3 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | oui |
| `react-devtools-core` | 6.1.5 | MIT | — |  |
| `react-dom` | 19.2.3 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | oui |
| `react-fast-compare` | 3.2.2 | MIT | Copyright (c) 2018 Formidable Labs |  |
| `react-freeze` | 1.0.4 | MIT | Copyright (c) 2021 Software Mansion |  |
| `react-is` | 16.13.1 | MIT | — |  |
| `react-is` | 17.0.2 | MIT | — |  |
| `react-is` | 18.3.1 | MIT | — |  |
| `react-is` | 19.2.7 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `react-native` | 0.85.3 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. | oui |
| `react-native-drawer-layout` | 4.2.5 | MIT | Copyright (c) 2017 React Native Community |  |
| `react-native-gesture-handler` | 2.31.2 | MIT | Copyright (c) 2016 Software Mansion <swmansion.com> | oui |
| `react-native-is-edge-to-edge` | 1.3.1 | MIT | Copyright (c) 2024 Mathieu Acthernoene |  |
| `react-native-reanimated` | 4.4.1 | MIT | Copyright (c) 2016 Software Mansion <swmansion.com> |  |
| `react-native-safe-area-context` | 5.7.0 | MIT | Copyright (c) 2019 Th3rd Wave | oui |
| `react-native-screens` | 4.25.2 | MIT | Copyright (c) 2018 Software Mansion <swmansion.com> | oui |
| `react-native-web` | 0.21.2 | MIT | Copyright (c) Nicolas Gallagher. | oui |
| `react-native-webview` | 13.16.1 | MIT | Copyright (c) 2015-present, Facebook, Inc. | oui |
| `react-native-worklets` | 0.9.2 | MIT | Copyright (c) 2024 nobody |  |
| `react-refresh` | 0.14.2 | MIT | — |  |
| `react-remove-scroll` | 2.7.2 | MIT | Copyright (c) 2017 Anton Korzunov |  |
| `react-remove-scroll-bar` | 2.3.8 | MIT | — |  |
| `react-style-singleton` | 2.2.3 | MIT | Copyright (c) 2017 Anton Korzunov |  |
| `redent` | 3.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `regenerate` | 1.4.2 | MIT | — |  |
| `regenerate-unicode-properties` | 10.2.2 | MIT | — |  |
| `regenerator-runtime` | 0.13.11 | MIT | Copyright (c) 2014-present, Facebook, Inc. |  |
| `regexpu-core` | 6.4.0 | MIT | — |  |
| `regjsgen` | 0.8.0 | MIT | — |  |
| `regjsparser` | 0.13.2 | BSD-2-Clause | — |  |
| `require-directory` | 2.1.1 | MIT | Copyright (c) 2011 Troy Goode <troygoode@gmail.com> |  |
| `resolve` | 1.22.12 | MIT | Copyright (c) 2012 James Halliday |  |
| `resolve-from` | 5.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `resolve-workspace-root` | 2.0.1 | MIT | Copyright (c) 2024-present Cedric van Putten <me@cedric.dev> |  |
| `restore-cursor` | 2.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `safe-buffer` | 5.2.1 | MIT | Copyright (c) Feross Aboukhadijeh |  |
| `sax` | 1.6.0 | BlueOak-1.0.0 | — |  |
| `scheduler` | 0.27.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `semver` | 6.3.1 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |  |
| `semver` | 7.8.4 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |  |
| `send` | 0.19.2 | MIT | Copyright (c) 2012 TJ Holowaychuk |  |
| `serialize-error` | 2.1.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `serve-static` | 1.16.3 | MIT | Copyright (c) 2010 Sencha Inc. |  |
| `server-only` | 0.0.1 | MIT | — |  |
| `setimmediate` | 1.0.5 | MIT | Copyright (c) 2012 Barnesandnoble.com, llc, Donavon West, and Domenic Denicola |  |
| `setprototypeof` | 1.2.0 | ISC | Copyright (c) 2015, Wes Todd |  |
| `sf-symbols-typescript` | 2.2.0 | MIT | Copyright (c) 2023 Fernando Rojo |  |
| `shallowequal` | 1.1.0 | MIT | Copyright (c) 2017 Alberto Leal <mailforalberto@gmail.com> (github.com/dashed) |  |
| `shebang-command` | 2.0.0 | MIT | Copyright (c) Kevin Mårtensson <kevinmartensson@gmail.com> (github.com/kevva) |  |
| `shebang-regex` | 3.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `shell-quote` | 1.8.4 | MIT | Copyright (c) 2013 James Halliday (mail@substack.net) |  |
| `signal-exit` | 3.0.7 | ISC | Copyright (c) 2015, Contributors |  |
| `simple-plist` | 1.3.1 | MIT | Copyright (c) 2013 Joe Wollard |  |
| `simple-swizzle` | 0.2.4 | MIT | Copyright (c) 2015 Josh Junon |  |
| `sisteransi` | 1.0.5 | MIT | Copyright (c) 2018 Terkel Gjervig Nielsen |  |
| `slugify` | 1.6.9 | MIT | Copyright (c) Simeon Velichkov <simeonvelichkov@gmail.com> |  |
| `source-map` | 0.5.7 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors |  |
| `source-map` | 0.6.1 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors |  |
| `source-map-js` | 1.2.1 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors |  |
| `source-map-support` | 0.5.21 | MIT | Copyright (c) 2014 Evan Wallace |  |
| `split-on-first` | 1.1.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `stackframe` | 1.3.4 | MIT | Copyright (c) 2017 Eric Wendelin and other contributors |  |
| `stacktrace-parser` | 0.1.11 | MIT | Copyright (c) 2014-2019 Georg Tavonius |  |
| `standard-navigation` | 0.0.5 | MIT | — |  |
| `standard-navigation` | 0.0.7 | MIT | — |  |
| `statuses` | 1.5.0 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> |  |
| `statuses` | 2.0.2 | MIT | Copyright (c) 2014 Jonathan Ong <me@jongleberry.com> |  |
| `stream-buffers` | 2.2.0 | Unlicense | — |  |
| `strict-uri-encode` | 2.0.0 | MIT | Copyright (c) Kevin Martensson <kevinmartensson@gmail.com> (github.com/kevva) |  |
| `string-width` | 4.2.3 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `strip-ansi` | 5.2.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `strip-ansi` | 6.0.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `strip-indent` | 3.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `structured-headers` | 0.4.1 | MIT | — |  |
| `styleq` | 0.1.3 | MIT | Copyright (c) Nicolas Gallagher |  |
| `supports-color` | 5.5.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `supports-color` | 7.2.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `supports-color` | 8.1.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |  |
| `supports-hyperlinks` | 2.3.0 | MIT | Copyright (c) James Talmage <james@talmage.io> (github.com/jamestalmage) |  |
| `supports-preserve-symlinks-flag` | 1.0.0 | MIT | Copyright (c) 2022 Inspect JS |  |
| `tagged-tag` | 1.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |  |
| `terminal-link` | 2.1.1 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `terser` | 5.48.0 | BSD-2-Clause | Copyright 2012-2018 (c) Mihai Bazon <mihai.bazon@gmail.com> |  |
| `throat` | 5.0.0 | MIT | Copyright (c) 2013 Forbes Lindesay |  |
| `tinyglobby` | 0.2.17 | MIT | Copyright (c) 2024 Madeline Gurriarán |  |
| `tmpl` | 1.0.5 | BSD-3-Clause | Copyright (c) 2014, Naitik Shah. All rights reserved. |  |
| `to-regex-range` | 5.0.1 | MIT | Copyright (c) 2015-present, Jon Schlinkert. |  |
| `toidentifier` | 1.0.1 | MIT | Copyright (c) 2016 Douglas Christopher Wilson <doug@somethingdoug.com> |  |
| `toqr` | 0.1.1 | MIT | Copyright (c) Phil Pluckthun, |  |
| `tr46` | 0.0.3 | MIT | — |  |
| `tslib` | 2.8.1 | 0BSD | Copyright (c) Microsoft Corporation. |  |
| `type-fest` | 0.21.3 | (MIT OR CC0-1.0) | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https:/sindresorhus.com) |  |
| `type-fest` | 0.7.1 | (MIT OR CC0-1.0) | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com) |  |
| `type-fest` | 5.7.0 | (MIT OR CC0-1.0) | — |  |
| `typescript` | 6.0.3 | Apache-2.0 | — |  |
| `ua-parser-js` | 1.0.41 | MIT | Copyright (c) 2012-2025 Faisal Salman <<f@faisalman.com>> |  |
| `undici-types` | 8.3.0 | MIT | Copyright (c) Matteo Collina and Undici contributors |  |
| `unicode-canonical-property-names-ecmascript` | 2.0.1 | MIT | — |  |
| `unicode-match-property-ecmascript` | 2.0.0 | MIT | — |  |
| `unicode-match-property-value-ecmascript` | 2.2.1 | MIT | — |  |
| `unicode-property-aliases-ecmascript` | 2.2.0 | MIT | — |  |
| `unpipe` | 1.0.0 | MIT | Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> |  |
| `update-browserslist-db` | 1.2.3 | MIT | Copyright 2022 Andrey Sitnik <andrey@sitnik.ru> and other contributors |  |
| `use-callback-ref` | 1.3.3 | MIT | Copyright (c) 2017 Anton Korzunov |  |
| `use-latest-callback` | 0.2.6 | MIT | Copyright (c) 2023 Satyajit Sahoo |  |
| `use-sidecar` | 1.1.3 | MIT | Copyright (c) 2017 Anton Korzunov |  |
| `use-sync-external-store` | 1.6.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |  |
| `utils-merge` | 1.0.1 | MIT | Copyright (c) 2013-2017 Jared Hanson |  |
| `uuid` | 7.0.3 | MIT | Copyright (c) 2010-2016 Robert Kieffer and other contributors |  |
| `validate-npm-package-name` | 5.0.1 | ISC | Copyright (c) 2015, npm, Inc |  |
| `vary` | 1.1.2 | MIT | Copyright (c) 2014-2017 Douglas Christopher Wilson |  |
| `vaul` | 1.1.2 | MIT | Copyright (c) 2023 Emil Kowalski |  |
| `vlq` | 1.0.1 | MIT | Copyright (c) 2017 [these people](https://github.com/Rich-Harris/vlq/graphs/contributors) |  |
| `walker` | 1.0.8 | Apache-2.0 | Copyright 2013 Naitik Shah |  |
| `warn-once` | 0.1.1 | MIT | Copyright (c) 2022 Satyajit Sahoo |  |
| `wcwidth` | 1.0.1 | MIT | Copyright (C) 2012 by Jun Woong. |  |
| `webidl-conversions` | 3.0.1 | BSD-2-Clause | Copyright (c) 2014, Domenic Denicola |  |
| `whatwg-fetch` | 3.6.20 | MIT | Copyright (c) 2014-2023 GitHub, Inc. |  |
| `whatwg-url` | 5.0.0 | MIT | Copyright (c) 2015–2016 Sebastian Mayr |  |
| `whatwg-url-minimum` | 0.1.2 | MIT | Copyright (c) Phil Pluckthun, |  |
| `which` | 2.0.2 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |  |
| `wrap-ansi` | 7.0.0 | MIT | Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com) |  |
| `ws` | 7.5.11 | MIT | Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com> |  |
| `ws` | 8.21.0 | MIT | Copyright (c) 2011 Einar Otto Stangvik <einaros@gmail.com> |  |
| `xcode` | 3.0.1 | Apache-2.0 | Copyright 2012-2020 The Apache Software Foundation |  |
| `xml2js` | 0.6.0 | MIT | Copyright 2010, 2011, 2012, 2013. All rights reserved. |  |
| `xmlbuilder` | 11.0.1 | MIT | Copyright (c) 2013 Ozgur Ozcitak |  |
| `xmlbuilder` | 15.1.1 | MIT | Copyright (c) 2013 Ozgur Ozcitak |  |
| `y18n` | 5.0.8 | ISC | Copyright (c) 2015, Contributors |  |
| `yallist` | 3.1.1 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |  |
| `yaml` | 2.9.0 | ISC | Copyright Eemeli Aro <eemeli@gmail.com> |  |
| `yargs` | 17.7.3 | MIT | Copyright 2010 James Halliday (mail@substack.net); Modified work Copyright 2014 Contributors (ben@npmjs.com) |  |
| `yargs-parser` | 21.1.1 | ISC | Copyright (c) 2016, Contributors |  |
| `zod` | 3.25.76 | MIT | Copyright (c) 2025 Colin McDonnell |  |
| `zxing-wasm` | 3.1.0 | MIT | Copyright (c) 2023 Ze-Zheng Wu |  |
<!-- npm:expo-app:end -->

**Composants natifs hors npm (à vérifier avant publication).** Le build
natif (EAS) résout aussi des dépendances CocoaPods / Gradle qui n'apparaissent
pas dans `package-lock.json` : moteur Hermes et Yoga (MIT, dans react-native),
Folly (Apache-2.0), glog / double-conversion (BSD-3-Clause), Boost (BSL-1.0),
fmt (MIT), bibliothèques AndroidX et Kotlin (Apache-2.0)… Leur liste exacte
doit être extraite du build (plugin Gradle de licences, fichier
`Pods/Target Support Files/*/…-acknowledgements.markdown`) et intégrée à un
écran « Licences » de l'app.

**Gabarit Expo.** `expo-app/App.tsx` et `expo-app/index.ts` proviennent du
gabarit create-expo-app, © 2015-present 650 Industries, Inc. (Expo), licence
MIT (`expo-app/LICENSE`). Ils ne portent donc pas l'en-tête SPDX d'ITSI APP.

## 4. Compatibilité avec l'AGPL-3.0-only

Compatibles par défaut (permissives) : MIT, ISC, 0BSD, BSD-2-Clause, BSD-3-Clause, Apache-2.0, Unlicense, CC0-1.0, BlueOak-1.0.0, Zlib, OFL-1.1, (MIT OR CC0-1.0), (MIT OR Apache-2.0), MIT AND Apache-2.0.
Apache-2.0 est compatible avec la GPLv3 / AGPLv3 (pas avec la GPLv2) ; les
polices sous OFL-1.1 sont des œuvres distinctes, livrées avec leur licence
(simple agrégation).

Licences examinées une à une :

- **MPL-2.0** — Compatible (MPL-2.0 §3.3, « Secondary License » GPL/AGPL). Ici lightningcss, outil de build CSS de Metro : non embarqué dans l'app.
- **Python-2.0** — argparse (portage JS, via js-yaml) : licence PSF, compatible GPL selon la FSF. Outil de configuration, non embarqué.
- **CC-BY-4.0** — caniuse-lite (données de compatibilité navigateurs, via browserslist) : attribution requise, pas une licence logicielle ; outil de build, non embarqué.
- **(BSD-3-Clause OR GPL-2.0)** — node-forge (via @expo/cli, signature de code au build) : choix BSD-3-Clause, compatible. Non embarqué.

Points d'attention (détail dans le rapport de préparation) :

- `expo-app/LICENSE` est la licence MIT du gabarit Expo ; elle peut laisser
  croire que tout `expo-app/` est sous MIT. À remplacer par un renvoi au
  LICENSE racine (en conservant l'avis MIT pour les deux fichiers du gabarit).
- Distribution sur l'App Store : la FSF considère les conditions de l'App Store
  incompatibles avec la GPL/AGPL pour les **tiers** (affaire VLC, 2011). ITSI
  APP, titulaire des droits (et des contributions via le CLA), peut publier
  ses propres builds ; un fork tiers ne le pourrait pas forcément.
- AGPL §13 : quiconque exploite une version **modifiée** (PWA ou relais) pour
  des utilisateurs à distance doit leur offrir le code source correspondant.

## 5. Marques citées

« QR Code » est une marque de DENSO WAVE INCORPORATED. « Art-Net™ Designed by
and Copyright Artistic Licence Holdings Ltd ». sACN désigne la norme ANSI
E1.31 (ESTA). Apple, App Store, iOS sont des marques d'Apple Inc. ; Google
Play et Android de Google LLC. Le nom et le logo SetRemote : voir
[TRADEMARK.md](TRADEMARK.md).

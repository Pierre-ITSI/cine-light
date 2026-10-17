#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ════════════════════════════════════════════════════════════════════════════
// THIRD_PARTY_NOTICES.md : génération et contrôle (Node 22, aucune dépendance).
//
// Sources :
//   • VENDORED ci-dessous : copies figées de vendor/ (nom, version, licence,
//     titulaire, fichiers couverts). Tout fichier de vendor/ doit y figurer ;
//   • relay/package-lock.json : dépendances de production du relais ;
//   • expo-app/package-lock.json : dépendances de production de l'app native
//     (« dev » exclues). Ensemble LARGE : il inclut les outils de build tirés
//     par expo (Metro, Babel, lightningcss, @expo/cli…), qui ne finissent pas
//     dans le binaire. Mieux vaut un avis de trop qu'un avis manquant.
//   • titulaires des paquets npm : 1re ligne « Copyright » du fichier de
//     licence dans node_modules/ quand il est installé, sinon valeur déjà
//     présente dans THIRD_PARTY_NOTICES.md, sinon « — ».
//
//   node scripts/third-party-notices.mjs           (ré)écrit THIRD_PARTY_NOTICES.md
//   node scripts/third-party-notices.mjs --check   contrôle (code 1 si écart) :
//       chaque fichier de vendor/ couvert, chaque paquet des package-lock
//       présent avec la bonne version et la bonne licence, aucune licence hors
//       de la liste compatible sans examen (REVIEWED). Ne dépend pas de
//       node_modules : utilisable en CI.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NOTICES = 'THIRD_PARTY_NOTICES.md';

// ── Copies figées (vendor/) ─────────────────────────────────────────────────
export const VENDORED = [
  {
    name: 'MQTT.js', version: '5.16.1', license: 'MIT',
    copyright: 'Copyright (c) 2015-2016 MQTT.js contributors ; Copyright 2011-2014 by Adam Rudd',
    files: ['vendor/mqtt-5.16.1.min.js'], licenseFile: 'vendor/mqtt-LICENSE.md',
    source: 'npm mqtt@5.16.1, dist/mqtt.min.js',
    note: 'Bundle navigateur produit par le projet MQTT.js : il inclut ses dépendances d\'exécution '
      + '(mqtt-packet, readable-stream, buffer, events, process, debug, lru-cache, rfdc, worker-timers…), '
      + 'toutes sous licences permissives (MIT / ISC) d\'après leurs paquets npm. '
      + 'Liste exhaustive des modules inclus : à vérifier (métafichier esbuild de mqtt).',
  },
  {
    name: 'QR Code Generator (qrcode-generator)', version: '2.0.4', license: 'MIT',
    copyright: 'Copyright (c) 2009 Kazuhiko Arase',
    files: ['vendor/qrcode-generator-2.0.4.js'], licenseFile: 'vendor/qrcode-generator-LICENSE.md',
    source: 'npm qrcode-generator@2.0.4, dist/qrcode.js',
    note: '« QR Code » est une marque déposée de DENSO WAVE INCORPORATED.',
  },
  {
    name: 'jsQR', version: '1.4.0', license: 'Apache-2.0',
    copyright: 'Cosmo Wolfe, Jefff Nelson (auteurs déclarés dans le package.json ; le paquet n\'a pas de ligne Copyright ni de fichier NOTICE)',
    files: ['vendor/jsqr-1.4.0.js'], licenseFile: 'vendor/jsqr-LICENSE.txt',
    source: 'npm jsqr@1.4.0, dist/jsQR.js',
  },
  {
    name: 'DM Mono (via @fontsource/dm-mono)', version: '5.3.0', license: 'OFL-1.1',
    copyright: 'Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono)',
    files: [
      'vendor/fonts/dm-mono-latin-300-normal.woff2', 'vendor/fonts/dm-mono-latin-400-normal.woff2',
      'vendor/fonts/dm-mono-latin-500-normal.woff2', 'vendor/fonts/dm-mono-latin-ext-300-normal.woff2',
      'vendor/fonts/dm-mono-latin-ext-400-normal.woff2', 'vendor/fonts/dm-mono-latin-ext-500-normal.woff2',
    ],
    licenseFile: 'vendor/fonts/dm-mono-OFL.txt',
    source: 'npm @fontsource/dm-mono@5.3.0 (fichiers identiques à ceux de Google Fonts, DM Mono v16)',
  },
  {
    name: 'Lato (via @fontsource/lato)', version: '5.3.0', license: 'OFL-1.1',
    copyright: 'Copyright (c) 2010-2011 by tyPoland Lukasz Dziedzic (team@latofonts.com), Reserved Font Name « Lato »',
    files: [
      'vendor/fonts/lato-latin-400-normal.woff2', 'vendor/fonts/lato-latin-700-normal.woff2',
      'vendor/fonts/lato-latin-ext-400-normal.woff2', 'vendor/fonts/lato-latin-ext-700-normal.woff2',
    ],
    licenseFile: 'vendor/fonts/lato-OFL.txt',
    source: 'npm @fontsource/lato@5.3.0 (fichiers identiques à ceux de Google Fonts, Lato v25)',
    note: 'Police non modifiée : le nom réservé « Lato » peut être conservé.',
  },
];

// ── Licences compatibles avec une distribution sous AGPL-3.0-only ───────────
// (permissives, ou à copyleft faible fichier par fichier). Toute autre licence
// doit être examinée et justifiée dans REVIEWED, sinon --check échoue.
export const COMPATIBLE = new Set([
  'MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'Unlicense', 'CC0-1.0',
  'BlueOak-1.0.0', 'Zlib', 'OFL-1.1', '(MIT OR CC0-1.0)', '(MIT OR Apache-2.0)', 'MIT AND Apache-2.0',
]);
export const REVIEWED = {
  'MPL-2.0': 'Compatible (MPL-2.0 §3.3, « Secondary License » GPL/AGPL). Ici lightningcss, outil de build CSS de Metro : non embarqué dans l\'app.',
  'Python-2.0': 'argparse (portage JS, via js-yaml) : licence PSF, compatible GPL selon la FSF. Outil de configuration, non embarqué.',
  'CC-BY-4.0': 'caniuse-lite (données de compatibilité navigateurs, via browserslist) : attribution requise, pas une licence logicielle ; outil de build, non embarqué.',
  '(BSD-3-Clause OR GPL-2.0)': 'node-forge (via @expo/cli, signature de code au build) : choix BSD-3-Clause, compatible. Non embarqué.',
};

// ── Lecture des package-lock ────────────────────────────────────────────────
export function lockPackages(lockPath, { includeDev = false } = {}) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const rootPkg = lock.packages[''] || {};
  const direct = new Set(Object.keys(rootPkg.dependencies || {}));
  const seen = new Map();
  for (const [k, v] of Object.entries(lock.packages)) {
    if (!k || (v.dev && !includeDev) || v.link) continue;
    const name = v.name || k.slice(k.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const id = name + '@' + v.version;
    if (!seen.has(id)) seen.set(id, { name, version: v.version, license: v.license || 'UNKNOWN', direct: direct.has(name) && k === 'node_modules/' + name, path: k });
    else if (direct.has(name) && k === 'node_modules/' + name) seen.get(id).direct = true;
  }
  return [...seen.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1));
}

// « Copyright (c) 2015 X », « Copyright 2011 X », « Copyright Meta… », « (c) 2020 X », « © 2020 X »
const COPYRIGHT_LINE = /^(?:[Cc]opyright\s*(?:\([cC]\)|©)?\s*(?:\d{4}|[A-Z][\w.-]*\s)|\([cC]\)\s*\d{4}|©\s*\d{4})/;
const LICENSE_FILES =/^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;
function copyrightFromNodeModules(baseDir, pkgPath) {
  const dir = join(baseDir, pkgPath);
  if (!existsSync(dir)) return null;
  let names;
  try { names = readdirSync(dir).filter((n) => LICENSE_FILES.test(n)).sort(); } catch (_) { return null; }
  for (const n of names) {
    const lines = readFileSync(join(dir, n), 'utf8').split(/\r?\n/);
    const line = lines.map((l) => l.trim()).find((l) => COPYRIGHT_LINE.test(l) && !/\[yyyy\]|\{yyyy\}|<year>/i.test(l));
    if (line) return line.replace(/\s+/g, ' ').slice(0, 160);
  }
  return null;
}

// Lignes de tableau déjà présentes : « | nom | version | licence | copyright | … »
function existingCopyrights(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = /^\| `([^`]+)` \| ([^|]+?) \| [^|]+? \| ([^|]+?) \|/.exec(line);
    if (m) map.set(m[1] + '@' + m[2], m[3]);
  }
  return map;
}

const esc = (s) => String(s).replace(/\|/g, '\\|');

function npmSection(id, title, intro, pkgs, nodeModulesDir, previous) {
  const rows = pkgs.map((p) => {
    const cr = copyrightFromNodeModules(nodeModulesDir, p.path) || previous.get(p.name + '@' + p.version) || '—';
    const flag = COMPATIBLE.has(p.license) ? '' : ' ⚠';
    return `| \`${p.name}\` | ${p.version} | ${esc(p.license)}${flag} | ${esc(cr)} | ${p.direct ? 'oui' : ''} |`;
  });
  return [
    `### ${title}`, '', intro, '',
    `<!-- npm:${id}:begin -->`,
    '| Paquet | Version | Licence | Copyright (1re ligne du fichier de licence) | Direct |',
    '|---|---|---|---|---|',
    ...rows,
    `<!-- npm:${id}:end -->`, '',
  ].join('\n');
}

export function expected(root = ROOT_DIR) {
  return {
    relay: lockPackages(join(root, 'relay', 'package-lock.json')),
    expo: lockPackages(join(root, 'expo-app', 'package-lock.json')),
  };
}

export function generate(root = ROOT_DIR) {
  const prevText = existsSync(join(root, NOTICES)) ? readFileSync(join(root, NOTICES), 'utf8') : '';
  const previous = existingCopyrights(prevText);
  const { relay, expo } = expected(root);
  const count = (pkgs) => {
    const c = {};
    for (const p of pkgs) c[p.license] = (c[p.license] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([l, n]) => `${l} : ${n}`).join(' · ');
  };
  const vendored = VENDORED.map((v) => [
    `### ${v.name} ${v.version}`, '',
    `- **Licence** : ${v.license} — texte : [\`${v.licenseFile}\`](${v.licenseFile})`,
    `- **Copyright** : ${v.copyright}`,
    `- **Provenance** : ${v.source}`,
    `- **Fichiers** : ${v.files.map((f) => '`' + f + '`').join(', ')}`,
    ...(v.note ? [`- **Note** : ${v.note}`] : []),
    '',
  ].join('\n')).join('\n');
  const reviewed = Object.entries(REVIEWED).map(([l, n]) => `- **${l}** — ${n}`).join('\n');
  return `<!-- GÉNÉRÉ par scripts/third-party-notices.mjs — ne pas éditer à la main : modifier le script puis le relancer. -->
# Avis relatifs aux composants tiers — SetRemote

SetRemote est © 2026 ITSI APP, distribué sous licence GNU AGPL v3 seule
(\`AGPL-3.0-only\`, voir [LICENSE](LICENSE)). Il inclut ou s'appuie sur les
composants tiers ci-dessous, chacun sous **sa propre licence**, qui reste
applicable à ce composant. Les textes de licence des copies figées sont livrés
à côté des fichiers, dans \`vendor/\`.

Contrôle : \`node scripts/third-party-notices.mjs --check\` (lancé par
\`npm test\`, tests/open-source.test.mjs). Régénération : même commande sans
\`--check\`, de préférence après \`npm ci\` dans \`expo-app/\` et \`relay/\` (pour
relever les lignes « Copyright » des paquets). Dans les tableaux npm, « — »
signifie que le paquet ne livre pas de ligne « Copyright » exploitable (licence
seule, ou pas de fichier de licence) : le titulaire est alors l'auteur indiqué
dans son \`package.json\`.

## 1. Copies figées servies par la PWA et embarquées dans l'app (\`vendor/\`)

${vendored}
## 2. Relais auto-hébergé (\`relay/\`, image Docker)

${npmSection('relay', 'Dépendances npm de production du relais', `Licences : ${count(relay)}.`, relay, join(root, 'relay'), previous)}
L'image Docker du relais est construite localement par l'exploitant
(\`relay/Dockerfile\`, base \`node:22-alpine\` : Node.js sous licence MIT,
paquets Alpine sous diverses licences dont GPL-2.0 pour BusyBox). ITSI APP ne
publie pas d'image : si une image était un jour publiée sur un registre, les
obligations de ces paquets (offre des sources GPL notamment) s'appliqueraient.
Les images référencées par \`relay/deploy/docker-compose.yml\`, **Caddy**
(Apache-2.0) et **coturn** (BSD-3-Clause), sont téléchargées par l'exploitant
depuis leurs éditeurs et ne sont pas redistribuées par SetRemote.

## 3. Application native (\`expo-app/\`, iOS / Android)

${npmSection('expo-app', 'Dépendances npm de production de l\'app native', `${expo.length} paquets — licences : ${count(expo)}.

Ensemble large : il inclut les outils de build tirés par \`expo\` (Metro, Babel,
lightningcss, \`@expo/cli\`…), qui ne sont pas embarqués dans le binaire. La liste
exacte des modules JavaScript embarqués se lit dans le bundle Metro de
production (à affiner avant la publication). « ⚠ » = licence hors de la liste
compatible par défaut, examinée au §4.`, expo, join(root, 'expo-app'), previous)}
**Composants natifs hors npm (à vérifier avant publication).** Le build
natif (EAS) résout aussi des dépendances CocoaPods / Gradle qui n'apparaissent
pas dans \`package-lock.json\` : moteur Hermes et Yoga (MIT, dans react-native),
Folly (Apache-2.0), glog / double-conversion (BSD-3-Clause), Boost (BSL-1.0),
fmt (MIT), bibliothèques AndroidX et Kotlin (Apache-2.0)… Leur liste exacte
doit être extraite du build (plugin Gradle de licences, fichier
\`Pods/Target Support Files/*/…-acknowledgements.markdown\`) et intégrée à un
écran « Licences » de l'app.

**Gabarit Expo.** \`expo-app/App.tsx\` et \`expo-app/index.ts\` proviennent du
gabarit create-expo-app, © 2015-present 650 Industries, Inc. (Expo), licence
MIT (\`expo-app/LICENSE\`). Ils ne portent donc pas l'en-tête SPDX d'ITSI APP.

## 4. Compatibilité avec l'AGPL-3.0-only

Compatibles par défaut (permissives) : ${[...COMPATIBLE].join(', ')}.
Apache-2.0 est compatible avec la GPLv3 / AGPLv3 (pas avec la GPLv2) ; les
polices sous OFL-1.1 sont des œuvres distinctes, livrées avec leur licence
(simple agrégation).

Licences examinées une à une :

${reviewed}

Points d'attention (détail dans le rapport de préparation) :

- \`expo-app/LICENSE\` est la licence MIT du gabarit Expo ; elle peut laisser
  croire que tout \`expo-app/\` est sous MIT. À remplacer par un renvoi au
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
`;
}

// Fichiers de vendor/ (relatifs à la racine, « / »)
export function vendorFiles(root = ROOT_DIR) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const a = join(d, n);
      if (statSync(a).isDirectory()) walk(a); else out.push(relative(root, a).split(sep).join('/'));
    }
  };
  if (existsSync(join(root, 'vendor'))) walk(join(root, 'vendor'));
  return out;
}

/** Fichiers de vendor/ sans entrée dans VENDORED. */
export function uncoveredVendorFiles(root = ROOT_DIR, vendored = VENDORED) {
  const covered = new Set(vendored.flatMap((v) => [...v.files, v.licenseFile]));
  return vendorFiles(root).filter((f) => !covered.has(f));
}

/** Liste des écarts entre THIRD_PARTY_NOTICES.md et le dépôt (vide = à jour). */
export function check(root = ROOT_DIR) {
  const problems = [];
  for (const f of uncoveredVendorFiles(root)) problems.push(`vendor : ${f} sans entrée dans VENDORED (scripts/third-party-notices.mjs)`);
  for (const v of VENDORED) {
    for (const f of [...v.files, v.licenseFile]) if (!existsSync(join(root, f))) problems.push(`vendor : ${f} déclaré mais absent`);
  }
  const path = join(root, NOTICES);
  if (!existsSync(path)) return [...problems, NOTICES + ' absent'];
  const text = readFileSync(path, 'utf8');
  for (const v of VENDORED) {
    if (!text.includes(`### ${v.name} ${v.version}`)) problems.push(`${NOTICES} : entrée « ${v.name} ${v.version} » absente`);
  }
  const { relay, expo } = expected(root);
  for (const [id, pkgs] of [['relay', relay], ['expo-app', expo]]) {
    const begin = text.indexOf(`<!-- npm:${id}:begin -->`), end = text.indexOf(`<!-- npm:${id}:end -->`);
    if (begin < 0 || end < begin) { problems.push(`${NOTICES} : section npm « ${id} » absente`); continue; }
    const rows = new Map();
    for (const line of text.slice(begin, end).split('\n')) {
      const m = /^\| `([^`]+)` \| ([^|]+?) \| (.+?)(?: ⚠)? \| /.exec(line);
      if (m) rows.set(m[1] + '@' + m[2], m[3].replace(/\\\|/g, '|'));
    }
    const want = new Set();
    for (const p of pkgs) {
      const key = p.name + '@' + p.version;
      want.add(key);
      if (!rows.has(key)) problems.push(`${NOTICES} [${id}] : ${key} absent`);
      else if (rows.get(key) !== p.license) problems.push(`${NOTICES} [${id}] : ${key} licence ${rows.get(key)} ≠ ${p.license}`);
      if (!COMPATIBLE.has(p.license) && !(p.license in REVIEWED)) problems.push(`[${id}] ${key} : licence ${p.license} à examiner (REVIEWED)`);
    }
    for (const key of rows.keys()) if (!want.has(key)) problems.push(`${NOTICES} [${id}] : ${key} n'est plus une dépendance`);
  }
  return problems;
}

function main(argv) {
  if (argv.includes('--check')) {
    const problems = check();
    if (problems.length) {
      console.error('✗ ' + NOTICES + ' à revoir :\n  ' + problems.join('\n  ') + '\n  → node scripts/third-party-notices.mjs');
      process.exit(1);
    }
    console.log('✓ ' + NOTICES + ' couvre vendor/ et les dépendances des package-lock');
    return;
  }
  writeFileSync(join(ROOT_DIR, NOTICES), generate());
  const left = check();
  if (left.length) { console.error('✗ ' + left.join('\n  ')); process.exit(1); }
  console.log('✓ ' + NOTICES + ' régénéré');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2));

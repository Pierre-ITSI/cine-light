#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ════════════════════════════════════════════════════════════════════════════
// En-têtes de licence des sources first-party (Node 22, aucune dépendance).
//
// Chaque fichier source écrit pour SetRemote porte, en 1re ligne (ou juste
// après le shebang), l'en-tête :
//
//   // SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP     (JS, TS, Kotlin, Swift)
//   /* SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP */  (CSS)
//   # SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP      (shell, Python)
//
// Les copies de tiers (vendor/) et les fichiers repris tels quels du gabarit
// Expo (EXCLUDED ci-dessous, licence MIT d'expo-app/LICENSE) n'en portent pas :
// voir THIRD_PARTY_NOTICES.md.
//
// web/build.mjs retire cette ligne des fragments web/js et web/styles avant
// de les assembler (index.html porte l'avis une seule fois, dans son en-tête),
// et web/bundle-protocol.mjs retire déjà les lignes de commentaire : le
// <style>, le <script> et le balisage générés restent inchangés.
//
//   node scripts/spdx-headers.mjs           ajoute l'en-tête là où il manque
//   node scripts/spdx-headers.mjs --check   liste les fichiers sans en-tête (code 1)
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SPDX_TEXT = 'SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP';

// Dossiers parcourus (récursivement) et fichiers isolés, relatifs à la racine
const ROOTS = [
  'web', 'packages', 'relay', 'scripts', 'tests',
  'expo-app/src', 'expo-app/modules', 'expo-app/app', 'expo-app/scripts',
  'expo-app/plugins', 'expo-app/test',
];
const SINGLE_FILES = ['sw.js', 'gen_icons.py', 'gen_splash.py'];
const SKIP_DIRS = new Set(['node_modules', '.artifacts', 'screenshots', 'build', 'Pods', 'web-embed']);
// Fichiers du gabarit create-expo-app conservés tels quels (MIT, 650 Industries)
export const EXCLUDED = new Set(['expo-app/App.tsx', 'expo-app/index.ts']);

const STYLES = {
  js: 'line', mjs: 'line', cjs: 'line', ts: 'line', tsx: 'line', kt: 'line', swift: 'line',
  css: 'block', sh: 'hash', py: 'hash',
};

/** Ligne d'en-tête attendue pour un chemin, ou null si le type n'est pas concerné. */
export function headerFor(path) {
  const ext = path.slice(path.lastIndexOf('.') + 1);
  const style = STYLES[ext];
  if (!style) return null;
  if (style === 'block') return `/* ${SPDX_TEXT} */`;
  if (style === 'hash') return `# ${SPDX_TEXT}`;
  return `// ${SPDX_TEXT}`;
}

function walk(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(abs, out); }
    else out.push(abs);
  }
}

/** Fichiers first-party concernés (chemins relatifs, séparateur « / »). */
export function listSourceFiles(root = ROOT_DIR) {
  const abs = [];
  for (const r of ROOTS) {
    try { walk(join(root, r), abs); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  for (const f of SINGLE_FILES) {
    try { if (statSync(join(root, f)).isFile()) abs.push(join(root, f)); } catch (_) {}
  }
  return abs.map((a) => relative(root, a).split(sep).join('/'))
    .filter((p) => headerFor(p) && !EXCLUDED.has(p))
    .sort();
}

/** L'en-tête est-il présent (1re ligne, ou 2e après un shebang) ? */
export function hasHeader(text, header) {
  const lines = text.split('\n');
  const i = lines[0].startsWith('#!') ? 1 : 0;
  return lines[i] === header;
}

export function addHeader(text, header) {
  if (hasHeader(text, header)) return text;
  if (text.startsWith('#!')) {
    const nl = text.indexOf('\n');
    return text.slice(0, nl + 1) + header + '\n' + text.slice(nl + 1);
  }
  return header + '\n' + text;
}

export function missingHeaders(root = ROOT_DIR) {
  return listSourceFiles(root).filter((p) => !hasHeader(readFileSync(join(root, p), 'utf8'), headerFor(p)));
}

function main(argv) {
  const missing = missingHeaders();
  if (argv.includes('--check')) {
    if (missing.length) {
      console.error('✗ en-tête SPDX absent :\n  ' + missing.join('\n  ') + '\n  → node scripts/spdx-headers.mjs');
      process.exit(1);
    }
    console.log('✓ en-tête SPDX présent dans ' + listSourceFiles().length + ' fichiers');
    return;
  }
  for (const p of missing) {
    const abs = join(ROOT_DIR, p);
    writeFileSync(abs, addHeader(readFileSync(abs, 'utf8'), headerFor(p)));
  }
  console.log('✓ en-tête ajouté à ' + missing.length + ' fichier(s)');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2));

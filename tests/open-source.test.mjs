// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Préparation open source : texte de licence officiel, en-têtes SPDX des
// sources first-party, licence déclarée par chaque paquet. Aucun navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ROOT_DIR, SPDX_TEXT, listSourceFiles, missingHeaders, addHeader, hasHeader, headerFor, EXCLUDED } from '../scripts/spdx-headers.mjs';
import { check as checkNotices, uncoveredVendorFiles, VENDORED, lockPackages, COMPATIBLE, REVIEWED } from '../scripts/third-party-notices.mjs';
import { build, HEADER } from '../web/build.mjs';

const read = (p) => readFileSync(path.join(ROOT_DIR, p), 'utf8');

test('LICENSE : texte officiel de la GNU AGPL v3 (SHA-256 du fichier gnu.org)', () => {
  const sha = createHash('sha256').update(readFileSync(path.join(ROOT_DIR, 'LICENSE'))).digest('hex');
  assert.equal(sha, '8486a10c4393cee1c25392769ddd3b2d6c242d6ec7928e1414efff7dfb2f07ef');
  assert.match(read('LICENSE'), /^ +GNU AFFERO GENERAL PUBLIC LICENSE\n +Version 3, 19 November 2007\n/);
});

test('en-tête SPDX sur chaque source first-party', () => {
  const files = listSourceFiles();
  assert.ok(files.length > 150, files.length + ' fichiers');
  for (const must of ['web/js/01-config.js', 'web/styles/00-base.css', 'packages/dmx/index.js', 'relay/server.js',
    'relay/deploy/check.sh', 'expo-app/src/config.ts', 'expo-app/app/index.tsx', 'tests/build.test.mjs', 'scripts/spdx-headers.mjs']) {
    assert.ok(files.includes(must), must + ' couvert');
  }
  assert.ok(!files.some((f) => f.startsWith('vendor/')), 'pas de vendor/');
  for (const f of EXCLUDED) assert.ok(!files.includes(f));
  assert.deepEqual(missingHeaders(), [], 'lancez : node scripts/spdx-headers.mjs');
});

test('addHeader : après le shebang, idempotent, style selon l\'extension', () => {
  assert.equal(headerFor('a.css'), `/* ${SPDX_TEXT} */`);
  assert.equal(headerFor('a.sh'), `# ${SPDX_TEXT}`);
  assert.equal(headerFor('a.swift'), `// ${SPDX_TEXT}`);
  assert.equal(headerFor('a.json'), null);
  const h = headerFor('x.mjs');
  const once = addHeader('#!/usr/bin/env node\nconsole.log(1);\n', h);
  assert.equal(once, `#!/usr/bin/env node\n${h}\nconsole.log(1);\n`);
  assert.equal(addHeader(once, h), once);
  assert.ok(hasHeader(once, h));
  assert.equal(addHeader('x\n', h), h + '\nx\n');
});

test('index.html : avis de licence une seule fois (en-tête), fragments assemblés sans leur ligne SPDX', () => {
  const { html } = build();
  assert.match(HEADER, /SPDX-License-Identifier: AGPL-3\.0-only — © 2026 ITSI APP/);
  assert.equal(html.split(SPDX_TEXT).length - 1, 1);
});

test('paquets : licence AGPL-3.0-only déclarée', () => {
  for (const p of ['package.json', 'relay/package.json', 'packages/protocol/package.json', 'packages/dmx/package.json', 'expo-app/package.json']) {
    assert.equal(JSON.parse(read(p)).license, 'AGPL-3.0-only', p);
  }
});

test('documents d\'ouverture présents, liens relatifs valides', () => {
  const docs = ['README.md', 'CONTRIBUTING.md', 'TRADEMARK.md', 'THIRD_PARTY_NOTICES.md', 'docs/CLA.md', 'docs/LICENSING.md'];
  for (const doc of docs) {
    const text = read(doc);
    for (const m of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(m[1])) continue;
      assert.ok(existsSync(path.join(ROOT_DIR, path.dirname(doc), m[1])), `${doc} → ${m[1]}`);
    }
  }
  assert.match(read('docs/CLA.md'), /AVOCAT/);
  assert.match(read('README.md'), /relay\/deploy\/README\.md/);
  assert.match(read('README.md'), /docs\/HOSTING\.md/);
  assert.match(read('README.md'), /confidentialite\.html/);
});

test('LICENSING : \'off\' par défaut (version libre), valeurs de build hors de SETREMOTE_DEFAULTS', () => {
  const cfg = read('web/js/01-config.js');
  assert.match(cfg, /^const LICENCE_BUILD = Object\.freeze\(\{ LICENSING: 'off', LICENCE_PUBKEY: '', LICENCE_API: '', LICENCE_BUY_URL: '' \}\);$/m);
  const defaults = cfg.slice(cfg.indexOf('const SETREMOTE_DEFAULTS'), cfg.indexOf('});', cfg.indexOf('const SETREMOTE_DEFAULTS')));
  assert.doesNotMatch(defaults, /LICEN[CS]/);
  // Une seule porte d'entrée : LIC_ON (14-licence.js) ; SETREMOTE_CONFIG ne peut
  // que restreindre (tests/licence.test.mjs)
  const code = build().html.split('\n').filter((l) => !/^\s*\/\//.test(l) && /\bLICENSING\b/.test(l)).map((l) => l.trim());
  assert.deepEqual(code, [
    "const LICENCE_BUILD = Object.freeze({ LICENSING: 'off', LICENCE_PUBKEY: '', LICENCE_API: '', LICENCE_BUY_URL: '' });",
    "const LICENSING = LICENCE_BUILD.LICENSING === 'on' || _cfgIn.LICENSING === 'on' ? 'on' : 'off';",
    "const LIC_ON = LICENSING === 'on' && !!LICENCE_PUBKEY && !!LICENCE_API;",
  ]);
});

// ── THIRD_PARTY_NOTICES.md ──────────────────────────────────────────────────
test('THIRD_PARTY_NOTICES.md à jour : vendor/ couvert, package-lock relais et app native listés', () => {
  assert.deepEqual(checkNotices(), [], 'lancez : node scripts/third-party-notices.mjs');
  assert.deepEqual(uncoveredVendorFiles(), []);
  const text = read('THIRD_PARTY_NOTICES.md');
  for (const v of VENDORED) assert.ok(text.includes(v.licenseFile), v.name);
});

test('un fichier ajouté dans vendor/ sans entrée fait échouer le contrôle', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'notices-'));
  try {
    mkdirSync(path.join(dir, 'vendor', 'fonts'), { recursive: true });
    for (const v of VENDORED) for (const f of [...v.files, v.licenseFile]) writeFileSync(path.join(dir, f), 'x');
    assert.deepEqual(uncoveredVendorFiles(dir), []);
    writeFileSync(path.join(dir, 'vendor', 'leaflet-1.9.4.js'), '/* tiers */');
    writeFileSync(path.join(dir, 'vendor', 'fonts', 'inter-400.woff2'), 'x');
    assert.deepEqual(uncoveredVendorFiles(dir), ['vendor/fonts/inter-400.woff2', 'vendor/leaflet-1.9.4.js']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('licences des dépendances livrées : compatibles AGPL ou examinées une à une', () => {
  for (const lock of ['relay/package-lock.json', 'expo-app/package-lock.json']) {
    for (const p of lockPackages(path.join(ROOT_DIR, lock))) {
      assert.ok(COMPATIBLE.has(p.license) || p.license in REVIEWED, `${lock} : ${p.name}@${p.version} (${p.license})`);
      assert.doesNotMatch(p.license, /^(GPL|LGPL|AGPL|SSPL|BUSL|Commons-Clause|UNKNOWN)/, p.name);
    }
  }
});

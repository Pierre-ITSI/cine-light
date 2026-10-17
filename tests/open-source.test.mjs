// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Préparation open source : texte de licence officiel, en-têtes SPDX des
// sources first-party, licence déclarée par chaque paquet. Aucun navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { ROOT_DIR, SPDX_TEXT, listSourceFiles, missingHeaders, addHeader, hasHeader, headerFor, EXCLUDED } from '../scripts/spdx-headers.mjs';
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

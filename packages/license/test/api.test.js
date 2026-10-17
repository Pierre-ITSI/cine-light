// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// API publique et isolement : le paquet n'a aucune dépendance et n'est pas
// encore utilisé par l'app (préparation, docs/LICENSING.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as api from '../index.js';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(PKG, '..', '..');

test('index.js expose les fonctions de clé et de bail', () => {
  for (const name of ['generateLicenseKey', 'parseLicenseKey', 'normalizeLicenseKey', 'isValidLicenseKey', 'formatLicenseKey',
    'formatKeyInput', 'checkCharacter', 'verifyLease', 'decodeLease', 'ed25519Support', 'setEd25519Verifier', 'signLease', 'randomId']) {
    assert.equal(typeof api[name], 'function', name);
  }
  assert.equal(api.KEY_ENTROPY_BITS, 55);
});

test('aucune dépendance : imports relatifs seulement', () => {
  const pkg = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.license, 'AGPL-3.0-only');
  for (const f of readdirSync(PKG).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(path.join(PKG, f), 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/gm)) assert.match(m[1], /^\.\//, f + ' → ' + m[1]);
  }
});

test('pas encore utilisé par l\'app (web/, index.html, expo-app/)', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /packages\/license|verifyLease|generateLicenseKey/);
  const dirs = [path.join(ROOT, 'web', 'js'), path.join(ROOT, 'expo-app', 'app'), path.join(ROOT, 'expo-app', 'src')];
  for (const d of dirs) {
    for (const f of readdirSync(d, { recursive: true })) {
      if (!/\.(js|ts|tsx)$/.test(f)) continue;
      assert.doesNotMatch(readFileSync(path.join(d, f), 'utf8'), /packages\/license|@setremote\/license/, f);
    }
  }
});

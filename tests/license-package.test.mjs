// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Paquet packages/license (format des clés de licence, baux signés Ed25519 ;
// préparation de la version payante, non utilisé par l'app) : sa propre suite
// node --test, rattachée ici pour que `npm test` (et la CI) l'exécute. Aucun
// navigateur requis. Exécution isolée :
//   npm run test:license   ou   node --test packages/license/test/
import '../packages/license/test/index.js';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { bundlePackage } from '../web/bundle-protocol.mjs';

test('packages/license assemblable en script classique (comme SRP / SRDMX), le jour où l\'app l\'utilisera', async () => {
  const b = bundlePackage({ dir: fileURLToPath(new URL('../packages/license', import.meta.url)), globalName: 'SRLIC', label: '@setremote/license' });
  const L = new Function(b.code + '\nreturn SRLIC;')();
  const esm = await import('../packages/license/index.js');
  assert.deepEqual(Object.keys(L).sort(), Object.keys(esm).sort());
  assert.ok(L.isValidLicenseKey(esm.generateLicenseKey()));
});

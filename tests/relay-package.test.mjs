// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Relais WebSocket auto-hébergé (relay/) : sa propre suite node --test,
// rattachée ici pour que `npm test` (et la CI) l'exécute. Aucun navigateur
// requis. `ws` vient de relay/node_modules (cd relay && npm ci) ou, à défaut,
// de la racine (devDependency à la même version exacte, installée par
// `npm ci` : voir le test de cohérence ci-dessous). Exécution isolée :
//   cd relay && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../relay/test/relay.test.js';

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));

test('relay : ws épinglé à la même version exacte (relay/ et racine, paquets et verrous)', () => {
  const v = json('../relay/package.json').dependencies.ws;
  assert.match(v, /^\d+\.\d+\.\d+$/, 'version exacte');
  assert.deepEqual(Object.keys(json('../relay/package.json').dependencies), ['ws'], 'aucune autre dépendance');
  assert.equal(json('../package.json').devDependencies.ws, v);
  assert.equal(json('../relay/package-lock.json').packages['node_modules/ws'].version, v);
  assert.equal(json('../package-lock.json').packages['node_modules/ws'].version, v);
});

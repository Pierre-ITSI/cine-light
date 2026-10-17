// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Réglages de la coque (src/config.ts) : adresse publique des liens d'appairage,
// script injecté avant la page, cohérence avec PUBLIC_URL du web.
//
//   cd expo-app && npm test        (Node ≥ 22.18 : TypeScript sans transpilation)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { PUBLIC_WEB_URL, isValidPublicUrl, nativeBootstrapScript } from '../src/config.ts';

const webConfig = readFileSync(new URL('../../web/js/01-config.js', import.meta.url), 'utf8');

test('PUBLIC_WEB_URL : https, « / » final, inchangée tant que la bascule n\'est pas faite', () => {
  assert.ok(isValidPublicUrl(PUBLIC_WEB_URL));
  // Bascule (docs/HOSTING.md) : même valeur des deux côtés. Tant que PUBLIC_URL
  // du web est vide, la coque garde l'adresse historique.
  const web = /PUBLIC_URL:\s*'([^']*)'/.exec(webConfig)[1];
  if (web === '') assert.equal(PUBLIC_WEB_URL, 'https://pierre-itsi.github.io/cine-light/');
  else assert.equal(PUBLIC_WEB_URL, web, 'PUBLIC_URL (web/js/01-config.js) et PUBLIC_WEB_URL (src/config.ts) identiques');
});

test('isValidPublicUrl : refuse http, fragment, requête, identifiants, sans « / » final', () => {
  for (const ok of ['https://set-remote.itsi-app.com/', 'https://pierre-itsi.github.io/cine-light/']) assert.ok(isValidPublicUrl(ok), ok);
  for (const bad of ['http://set-remote.itsi-app.com/', 'https://set-remote.itsi-app.com', 'https://h.fr/#p=x', 'https://h.fr/?a=1/',
    'https://u@h.fr/', "https://h.fr/'/", 'https:// h.fr/', '', null, 42]) {
    assert.equal(isValidPublicUrl(bad), false, String(bad));
  }
});

test('script injecté : window.SETREMOTE_NATIVE identique à l\'ancien littéral, valeurs en JSON', () => {
  const run = (src) => { const ctx = vm.createContext({ window: {} }); const r = vm.runInContext(src, ctx); return { r, n: JSON.parse(JSON.stringify(ctx.window.SETREMOTE_NATIVE)) }; };
  for (const platform of ['ios', 'android']) {
    const { r, n } = run(nativeBootstrapScript(platform));
    assert.equal(r, true, 'le script se termine par true (react-native-webview)');
    assert.deepEqual(n, { platform, bridge: 1, publicUrl: PUBLIC_WEB_URL });
  }
  assert.deepEqual(run(nativeBootstrapScript('ios', 'https://set-remote.itsi-app.com/')).n.publicUrl, 'https://set-remote.itsi-app.com/');
  assert.throws(() => nativeBootstrapScript('ios', "https://h.fr/'};alert(1);//"), /invalide/);
});

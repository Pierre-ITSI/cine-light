// Build web/ → index.html : à jour, déterministe, et interface (CSS + balisage)
// identique au commit de référence visuelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { build, listFragments, OUTPUT, ROOT_DIR, HEADER } from '../web/build.mjs';
import { bundleProtocol, bundleDmx } from '../web/bundle-protocol.mjs';

test('index.html correspond exactement à web/ (npm run build)', () => {
  const { html, cssFrags, jsFrags } = build();
  assert.equal(readFileSync(OUTPUT, 'utf8'), html);
  assert.equal(html.split('\n')[1], HEADER);
  assert.ok(cssFrags.length >= 10 && jsFrags.length >= 20);
  assert.equal(build().html, html, 'build déterministe');
});

test('fragments : préfixes NN- uniques, script classique (pas de module ES)', () => {
  for (const [sub, ext] of [['styles', '.css'], ['js', '.js']]) {
    const frags = listFragments(sub, ext);
    const prefixes = frags.map((f) => f.name.split('/')[1].slice(0, 2));
    assert.equal(new Set(prefixes).size, prefixes.length, 'préfixes uniques dans ' + sub);
    for (const f of frags) assert.ok(f.text.endsWith('\n'), f.name + ' se termine par un saut de ligne');
  }
  const html = readFileSync(OUTPUT, 'utf8');
  assert.equal((html.match(/<script>/g) || []).length, 1, 'un seul <script> inline');
  assert.doesNotMatch(html, /<script[^>]*type=["']module/);
  for (const f of listFragments('js', '.js')) {
    assert.doesNotMatch(f.text, /^\s*(import|export)\s[^(]/m, f.name + ' : pas d\'import/export');
  }
});

test('paquet protocole : IIFE classique en tête du <script>, même API que les modules ES', async () => {
  const { html, protocol } = build();
  assert.deepEqual(bundleProtocol(), protocol, 'assemblage déterministe');
  const script = html.slice(html.indexOf('<script>') + 8);
  assert.ok(script.startsWith('\n' + protocol.code) || script.startsWith(protocol.code), 'le paquet précède web/js');
  assert.match(protocol.code, /^var SRP = \(function \(\) \{$/m);
  assert.doesNotMatch(protocol.code, /^\s*(import|export)\s/m, 'plus aucun import/export');
  assert.deepEqual(protocol.modules.slice(-1), ['index.js']);
  // Évalué comme un script classique : mêmes exports que le point d'entrée ES
  const SRP = new Function(protocol.code + '\nreturn SRP;')();
  const esm = await import('../packages/protocol/index.js');
  assert.deepEqual(Object.keys(SRP).sort(), Object.keys(esm).sort());
  assert.ok(Object.isFrozen(SRP));
  // Interopérabilité : une trame scellée par l'IIFE s'ouvre avec les modules ES et inversement
  const pairing = SRP.createPairing();
  const remote = await SRP.createSecureChannel({ pairing, role: 'remote' });
  const screen = await esm.createSecureChannel({ pairing, role: 'screen', screenId: esm.createScreenId() });
  assert.deepEqual((await screen.receive(await remote.seal({ type: 'color', color: '#ff0000' }))).message, { type: 'color', color: '#ff0000' });
  assert.deepEqual((await remote.receive(await screen.seal({ type: 'screen:alive' }))).message, { type: 'screen:alive' });
  await assert.rejects(remote.receive('pas-une-trame'), (e) => e instanceof SRP.ProtocolError || e.name === 'ProtocolError');
});

test('passerelle DMX : IIFE classique SRDMX juste après SRP, mêmes exports que packages/dmx', async () => {
  const { html, protocol, dmx } = build();
  assert.deepEqual(bundleDmx(), dmx, 'assemblage déterministe');
  const script = html.slice(html.indexOf('<script>') + 8).replace(/^\n/, '');
  assert.ok(script.startsWith(protocol.code + dmx.code), 'SRP puis SRDMX, avant web/js');
  assert.match(dmx.code, /^var SRDMX = \(function \(\) \{$/m);
  assert.doesNotMatch(dmx.code, /^\s*(import|export)\s/m);
  const SRDMX = new Function(dmx.code + '\nreturn SRDMX;')();
  const esm = await import('../packages/dmx/index.js');
  assert.deepEqual(Object.keys(SRDMX).sort(), Object.keys(esm).sort());
  assert.ok(Object.isFrozen(SRDMX));
  // Même décodage que les modules ES
  const pkt = esm.buildSacnDataPacket({ cid: '5f1e7a52-3c4b-4d8e-9a10-2b3c4d5e6f70', universe: 7, data: [255, 255, 128, 0], sequence: 1 });
  assert.deepEqual(SRDMX.parseSacn(pkt).data, esm.parseSacn(pkt).data);
  assert.equal(SRDMX.decode('standard8', [255, 255, 128, 0, 0, 128, 0, 0]).color, esm.decode('standard8', [255, 255, 128, 0, 0, 128, 0, 0]).color);
});

test('interface inchangée : <style> et balisage identiques à la référence visuelle', (t) => {
  const meta = JSON.parse(readFileSync(path.join(ROOT_DIR, 'tests', 'screenshots', 'baseline.json'), 'utf8'));
  try {
    execFileSync('git', ['cat-file', '-e', meta.ref + ':index.html'], { cwd: ROOT_DIR, stdio: 'ignore' });
  } catch (_) {
    t.skip('commit de référence ' + meta.ref.slice(0, 7) + ' absent (clone superficiel)');
    return;
  }
  const r = spawnSync(process.execPath, [path.join(ROOT_DIR, 'web', 'check-equivalence.mjs'), '--ref', meta.ref, '--only', 'style,markup'],
    { cwd: ROOT_DIR, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

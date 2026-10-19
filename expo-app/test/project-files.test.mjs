// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Fichiers projet .setremote côté coque (src/lib/projectFiles.ts) : morceaux
// base64 page → fichier temporaire → feuille de partage ; sélecteur → morceaux
// renvoyés à la page ; refus (ordre, taille, indisponible) ; base64 maison.
//
//   cd expo-app && npm test        (Node ≥ 22.18 : TypeScript sans transpilation)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { randomBytes } from 'node:crypto';
import {
  createProjectBridge, parseSaveChunk, projectFileName, projectScript, bytesToBase64, base64ToBytes,
  PROJECT_CHUNK, PROJECT_CHUNK_BYTES, PROJECT_MAX_BYTES, PROJECT_ERROR_REASONS,
} from '../src/lib/projectFiles.ts';

function fakeWeb() {
  const received = [];
  const ctx = vm.createContext({ window: { SRNative: { receive: (m) => received.push(JSON.parse(JSON.stringify(m))) } } });
  return { received, inject: (script) => vm.runInContext(script, ctx) };
}
function fakeFs() {
  const files = new Map();
  return {
    files,
    createTemp: (name) => {
      files.set(name, Buffer.alloc(0));
      return {
        write: (b64, append) => { files.set(name, Buffer.concat([append ? files.get(name) : Buffer.alloc(0), Buffer.from(b64, 'base64')])); },
        get uri() { return 'file:///cache/projets/' + encodeURIComponent(name); },
        get size() { return files.get(name).length; },
        delete: () => files.delete(name),
      };
    },
  };
}
const flush = () => new Promise((r) => setImmediate(r));
const chunksOf = (buf, id, name) => {
  const n = Math.max(1, Math.ceil(buf.length / PROJECT_CHUNK_BYTES));
  return Array.from({ length: n }, (_, i) => ({ type: 'project:save', id, name, size: buf.length, i, n, data: buf.subarray(i * PROJECT_CHUNK_BYTES, (i + 1) * PROJECT_CHUNK_BYTES).toString('base64') }));
};

test('base64 maison = Buffer, toutes longueurs', () => {
  for (const n of [0, 1, 2, 3, 4, 5, 100, 1001]) {
    const b = randomBytes(n);
    assert.equal(bytesToBase64(b), b.toString('base64'), String(n));
    assert.deepEqual(Buffer.from(base64ToBytes(b.toString('base64'))), b);
  }
  assert.throws(() => base64ToBytes('abc'));
  assert.throws(() => base64ToBytes('ab$='));
  assert.equal(PROJECT_CHUNK % 4, 0);
  assert.equal(PROJECT_CHUNK_BYTES * 4 / 3, PROJECT_CHUNK);
});

test('nom de fichier : sans séparateur ni contrôle, .setremote', () => {
  assert.equal(projectFileName('Tournage/Nuit: 2'), 'Tournage Nuit 2.setremote');
  assert.equal(projectFileName('../../etc/passwd'), 'etc passwd.setremote');
  assert.equal(projectFileName(''), 'Projet.setremote');
  assert.equal(projectFileName(42), 'Projet.setremote');
  assert.equal(projectFileName('a\u0000b\nc.setremote'), 'a b c.setremote');
  assert.equal(projectFileName('x'.repeat(200)).length, 60 + '.setremote'.length);
});

test('morceaux : validation de forme', () => {
  assert.equal(parseSaveChunk({ type: 'pdf:preview' }), null);
  assert.equal(parseSaveChunk(null), null);
  const ok = { type: 'project:save', id: 'x1', name: 'A', size: 3, i: 0, n: 1, data: 'AAAA' };
  assert.equal(parseSaveChunk(ok).ok, true);
  for (const [o, reason] of [
    [{ id: '../x' }, 'bad-chunk'], [{ i: 1 }, 'bad-chunk'], [{ n: 0 }, 'bad-chunk'], [{ data: 'AAA' }, 'bad-chunk'],
    [{ data: 'A'.repeat(PROJECT_CHUNK + 4) }, 'bad-chunk'], [{ data: '<script>' }, 'bad-chunk'],
    [{ size: PROJECT_MAX_BYTES + 1 }, 'too-large'], [{ i: 0, n: 2, data: 'AA==' }, 'bad-chunk'],
  ]) assert.equal(parseSaveChunk({ ...ok, ...o }).reason, reason, JSON.stringify(o).slice(0, 40));
  assert.match(projectScript({ type: 'project:saved', id: 'x' }), /^window\.SRNative&&window\.SRNative\.receive\(.*\);true;$/);
});

test('enregistrement : morceaux assemblés dans le cache, feuille de partage, project:saved', async () => {
  const web = fakeWeb(), fs = fakeFs(), shared = [];
  const bridge = createProjectBridge({
    createTemp: fs.createTemp, loadShare: () => async (uri, o) => { shared.push([uri, o]); },
    pick: async () => null, inject: web.inject,
  });
  const buf = randomBytes(PROJECT_CHUNK_BYTES * 2 + 1000);
  for (const m of chunksOf(buf, 'a1', 'Nuit/Jour')) assert.equal(bridge.handle(m), true);
  await flush();
  assert.deepEqual(fs.files.get('Nuit Jour.setremote'), buf);
  assert.deepEqual(shared, [['file:///cache/projets/Nuit%20Jour.setremote', { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: 'SetRemote' }]]);
  assert.deepEqual(web.received, [{ type: 'project:saved', id: 'a1', ok: true, shared: true }]);
  // Hors d'ordre, taille finale fausse, partage absent ou en échec
  const c = chunksOf(buf, 'a2', 'B');
  bridge.handle(c[0]); bridge.handle(c[2]);
  const bad = { ...chunksOf(Buffer.from('abc'), 'a3', 'C')[0], size: 4 };
  bridge.handle(bad);
  const noShare = createProjectBridge({ createTemp: fs.createTemp, loadShare: () => null, pick: async () => null, inject: web.inject });
  noShare.handle(chunksOf(Buffer.from('abc'), 'a4', 'D')[0]);
  const failShare = createProjectBridge({ createTemp: fs.createTemp, loadShare: () => async () => { throw new Error('x'); }, pick: async () => null, inject: web.inject });
  failShare.handle(chunksOf(Buffer.from('abc'), 'a5', 'E')[0]);
  const noTemp = createProjectBridge({ createTemp: () => { throw new Error('disque'); }, loadShare: () => null, pick: async () => null, inject: web.inject });
  noTemp.handle(chunksOf(Buffer.from('abc'), 'a6', 'F')[0]);
  await flush();
  assert.deepEqual(web.received.slice(1).sort((a, b) => (a.id < b.id ? -1 : 1)), [
    { type: 'project:error', id: 'a2', reason: 'bad-chunk' }, { type: 'project:error', id: 'a3', reason: 'bad-chunk' },
    { type: 'project:error', id: 'a4', reason: 'unavailable' }, { type: 'project:error', id: 'a5', reason: 'share-failed' },
    { type: 'project:error', id: 'a6', reason: 'write-failed' },
  ]);
  for (const m of web.received) if (m.reason) assert.ok(PROJECT_ERROR_REASONS.includes(m.reason));
});

test('ouverture : sélecteur, fichier renvoyé par morceaux, annulation, trop gros, indisponible', async () => {
  const web = fakeWeb();
  const buf = randomBytes(PROJECT_CHUNK_BYTES + 77);
  let off = 0, closed = 0, next = () => ({ name: 'Tournage.setremote', size: buf.length, read: (n) => { const r = buf.subarray(off, off + n); off += n; return new Uint8Array(r); }, close: () => { closed++; } });
  const bridge = createProjectBridge({ createTemp: () => null, loadShare: () => null, pick: async () => next(), inject: web.inject, tick: async () => {} });
  assert.equal(bridge.handle({ type: 'project:open', id: 'o1' }), true);
  await flush(); await flush();
  assert.equal(web.received.length, 2);
  assert.deepEqual(web.received.map((m) => [m.type, m.id, m.name, m.size, m.i, m.n]), [['project:file', 'o1', 'Tournage.setremote', buf.length, 0, 2], ['project:file', 'o1', 'Tournage.setremote', buf.length, 1, 2]]);
  assert.deepEqual(Buffer.concat(web.received.map((m) => Buffer.from(m.data, 'base64'))), buf);
  assert.ok(web.received.every((m) => m.data.length <= PROJECT_CHUNK));
  assert.equal(closed, 1);
  web.received.length = 0;
  next = () => null;
  bridge.handle({ type: 'project:open', id: 'o2' }); await flush();
  next = () => ({ name: 'x', size: PROJECT_MAX_BYTES + 1, read: () => new Uint8Array(0), close: () => {} });
  bridge.handle({ type: 'project:open', id: 'o3' }); await flush();
  next = () => { throw new Error('pas de sélecteur'); };
  bridge.handle({ type: 'project:open', id: 'o4' }); await flush();
  assert.deepEqual(web.received, [
    { type: 'project:file', id: 'o2', cancelled: true }, { type: 'project:error', id: 'o3', reason: 'too-large' }, { type: 'project:error', id: 'o4', reason: 'unavailable' },
  ]);
  assert.equal(bridge.handle({ type: 'brightness', value: 1 }), false);
});

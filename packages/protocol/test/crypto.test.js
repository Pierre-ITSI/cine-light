// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveSession, seal, open, sealChunk, openChunk, peekFrame, createReplayState, splitIntoChunks,
  createChunkAssembler, newSenderTag, MAX_MESSAGE_BYTES, MAX_CHUNK_BYTES, MAX_CHUNKS, MAX_FRAME_CHARS,
  DEFAULT_MAX_SKEW_MS, FRAME_VERSION,
} from '../crypto.js';
import { createPairing } from '../pairing.js';
import { setCrypto, getCrypto } from '../lib/env.js';
import { b64uToBytes, bytesToB64u } from '../lib/encoding.js';

/** @param {string} code */
const isCode = code => (/** @type {any} */ e) => e && e.name === 'ProtocolError' && e.code === code;
const anyProtocolError = (/** @type {any} */ e) => e && e.name === 'ProtocolError';

const pairing = createPairing();
const session = await deriveSession(pairing);
const R = { sender: 'rAAAAAAAA' };

test('deriveSession : déterministe, topic opaque, clés distinctes par sens', async () => {
  const again = await deriveSession({ ...pairing });
  assert.equal(again.topic, session.topic);
  assert.equal(again.relayAuth, session.relayAuth);
  assert.match(session.topic, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(session.topic, pairing.channelId);
  assert.ok(!session.topic.includes(pairing.channelId.slice(0, 8)), 'le topic ne révèle pas le channelId');
  assert.ok(!session.relayAuth.includes(pairing.key.slice(0, 8)));
  // Même channelId, autre clé → autre topic (le topic dépend aussi du secret)
  const other = await deriveSession({ channelId: pairing.channelId, key: createPairing().key });
  assert.notEqual(other.topic, session.topic);
  // Une instance dérivée séparément déchiffre ce que l'autre chiffre
  const f = await seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: 1 });
  assert.deepEqual(await open(f, again.keys.r2s, createReplayState()), { type: 'hello' });
  // Clés non exportables
  assert.equal(session.keys.r2s.extractable, false);
  await assert.rejects(deriveSession(/** @type {any} */ ({ channelId: 'x', key: 'y' })), isCode('bad-pairing'));
});

test('aller-retour : message simple, Unicode, et proche du plafond', async () => {
  const rs = createReplayState();
  const msg = { type: 'call:start', kind: 'sms', name: 'Zoë 🎬', msg: 'Ligne 1\nLigne 2 — « ok » 👍🏽', lock: { time: '09:41', date: 'mar.' } };
  const f = await seal(msg, session.keys.r2s, { ...R, seq: 1 });
  assert.match(f, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(await open(f, session.keys.r2s, rs), msg);
  const big = { type: 'media-img-chunk', id: 'k3j9x1', i: 0, data: 'data:image/jpeg;base64,' + 'A'.repeat(MAX_MESSAGE_BYTES - 200) };
  const fb = await seal(big, session.keys.r2s, { ...R, seq: 2 });
  assert.ok(fb.length <= MAX_FRAME_CHARS);
  assert.deepEqual(await open(fb, session.keys.r2s, rs), big);
});

test('peekFrame lit l’en-tête sans déchiffrer (pas de type en clair)', async () => {
  const f = await seal({ type: 'color', color: '#ffffff' }, session.keys.r2s, { ...R, seq: 7, ts: 1_700_000_000_123 });
  assert.equal(FRAME_VERSION, 2);
  assert.deepEqual(peekFrame(f), { version: 2, kind: 1, sender: R.sender, seq: 7, ts: 1_700_000_000_123 });
});

test('détection de falsification : chaque octet de la trame est protégé', async () => {
  const f = await seal({ type: 'color', color: '#ff0000' }, session.keys.r2s, { ...R, seq: 3 });
  const bytes = b64uToBytes(f);
  for (let i = 0; i < bytes.length; i++) {
    for (const mask of [0x01, 0x80]) {
      const t = bytes.slice();
      t[i] ^= mask;
      await assert.rejects(open(bytesToB64u(t), session.keys.r2s, createReplayState({ maxSkewMs: Infinity })), anyProtocolError, `octet ${i}`);
    }
  }
  // Troncature, extension, et chaîne non base64url
  await assert.rejects(open(f.slice(0, -4), session.keys.r2s, null), anyProtocolError);
  await assert.rejects(open(f + 'AAAA', session.keys.r2s, null), isCode('auth'));
  await assert.rejects(open(f.replace(/.$/, '+'), session.keys.r2s, null), isCode('malformed'));
  await assert.rejects(open(/** @type {any} */ (42), session.keys.r2s, null), isCode('malformed'));
});

test('le type du message est chiffré : le relais ne le voit pas', async () => {
  const types = ['blackout', 'call:start', 'rtc-offer', 'color', 'dmx:look'];
  const frames = await Promise.all(types.map((type, i) => seal({ type }, session.keys.r2s, { ...R, seq: 40 + i, ts: 1_700_000_000_000 })));
  for (const [i, f] of frames.entries()) {
    const raw = Buffer.from(b64uToBytes(f));
    assert.equal(raw.indexOf(types[i]), -1, `type « ${types[i]} » absent des octets de la trame`);
    assert.ok(!f.includes(Buffer.from(types[i]).toString('base64url').slice(0, 6)));
    assert.equal(/** @type {any} */ (peekFrame(f)).type, undefined);
  }
  // Même en-tête (émetteur, seq, ts) : seule la taille du chiffré diffère selon le contenu
  const h0 = b64uToBytes(frames[0]).subarray(0, 3 + R.sender.length + 10);
  const h3 = b64uToBytes(frames[3]).subarray(0, 3 + R.sender.length + 10);
  assert.deepEqual(h0.subarray(0, 3 + R.sender.length), h3.subarray(0, 3 + R.sender.length));
  // Le type est authentifié comme le reste : un clair sans type est refusé
  await assert.rejects(seal(/** @type {any} */ ({ color: '#ffffff' }), session.keys.r2s, { ...R, seq: 50 }), isCode('bad-argument'));
});

test('tolérance d’horloge par défaut : 5 minutes', async () => {
  assert.equal(DEFAULT_MAX_SKEW_MS, 5 * 60 * 1000);
  let now = 1_800_000_000_000;
  const rs = createReplayState({ now: () => now });
  await open(await seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: 1, ts: now - 4 * 60_000 }), session.keys.r2s, rs);
  await assert.rejects(open(await seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: 2, ts: now - 6 * 60_000 }), session.keys.r2s, rs), isCode('stale'));
  await assert.rejects(open(await seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: 3, ts: now + 6 * 60_000 }), session.keys.r2s, rs), isCode('stale'));
});

test('mauvaise clé et mauvais sens sont rejetés', async () => {
  const f = await seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: 5 });
  const stranger = await deriveSession(createPairing());
  await assert.rejects(open(f, stranger.keys.r2s, null), isCode('auth'));
  // Une trame télécommande → écran ne peut pas être réfléchie vers la télécommande
  await assert.rejects(open(f, session.keys.s2r, null), isCode('auth'));
  const g = await seal({ type: 'media:cached', id: 'm1' }, session.keys.s2r, { sender: 'sBBBBBBBB', seq: 0 });
  await assert.rejects(open(g, session.keys.r2s, null), isCode('auth'));
  assert.deepEqual(await open(g, session.keys.s2r, null), { type: 'media:cached', id: 'm1' });
});

test('anti-rejeu : doublon, désordre dans la fenêtre, trop ancien, émetteurs distincts', async () => {
  const rs = createReplayState({ windowSize: 64 });
  const mk = (/** @type {number} */ seq, sender = R.sender) => seal({ type: 'hello' }, session.keys.r2s, { sender, seq });
  const f10 = await mk(10);
  await open(f10, session.keys.r2s, rs);
  await assert.rejects(open(f10, session.keys.r2s, rs), isCode('replay'));
  await open(await mk(8), session.keys.r2s, rs); // en retard mais dans la fenêtre
  await open(await mk(100), session.keys.r2s, rs);
  await assert.rejects(open(await mk(36), session.keys.r2s, rs), isCode('replay'), 'hors fenêtre (100 - 36 ≥ 64)');
  await open(await mk(37), session.keys.r2s, rs); // juste dans la fenêtre
  await assert.rejects(open(await mk(37), session.keys.r2s, rs), isCode('replay'));
  // Un autre émetteur a sa propre fenêtre : le même seq est accepté
  await open(await mk(10, 'sScreenA1'), session.keys.r2s, rs);
  await open(await mk(10, 'sScreenB2'), session.keys.r2s, rs);
  await assert.rejects(open(await mk(10, 'sScreenA1'), session.keys.r2s, rs), isCode('replay'));
});

test('anti-rejeu : un saut de séquence supérieur à la fenêtre réinitialise proprement', async () => {
  const rs = createReplayState({ windowSize: 32 });
  const mk = (/** @type {number} */ seq) => seal({ type: 'hello' }, session.keys.r2s, { ...R, seq });
  for (const s of [1, 2, 3]) await open(await mk(s), session.keys.r2s, rs);
  await open(await mk(1000), session.keys.r2s, rs);
  await open(await mk(999), session.keys.r2s, rs);
  await assert.rejects(open(await mk(3), session.keys.r2s, rs), isCode('replay'));
  await assert.rejects(open(await mk(1000), session.keys.r2s, rs), isCode('replay'));
});

test('horodatage hors tolérance : rejeu d’un enregistrement ancien après redémarrage', async () => {
  let now = 1_800_000_000_000;
  const rs = createReplayState({ now: () => now, maxSkewMs: 120_000 });
  const old = await seal({ type: 'blackout', on: true }, session.keys.r2s, { ...R, seq: 1, ts: now - 10 * 60_000 });
  await assert.rejects(open(old, session.keys.r2s, rs), isCode('stale'));
  const future = await seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: 2, ts: now + 10 * 60_000 });
  await assert.rejects(open(future, session.keys.r2s, rs), isCode('stale'));
  const fresh = await seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: 3, ts: now - 5_000 });
  await open(fresh, session.keys.r2s, rs);
  now += 121_000;
  await assert.rejects(open(fresh, session.keys.r2s, createReplayState({ now: () => now, maxSkewMs: 120_000 })), isCode('stale'));
  // Tolérance par défaut (5 min) : la même trame est encore acceptée par un récepteur neuf…
  await open(fresh, session.keys.r2s, createReplayState({ now: () => now }));
  // … puis refusée au-delà
  now += 180_000;
  await assert.rejects(open(fresh, session.keys.r2s, createReplayState({ now: () => now })), isCode('stale'));
});

test('une trame forgée (seq énorme, tag invalide) n’empoisonne pas la fenêtre', async () => {
  const rs = createReplayState({ windowSize: 64 });
  const legit = await seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: 5 });
  const forgedSrc = await seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: 0xffffffff });
  const forged = b64uToBytes(forgedSrc);
  forged[forged.length - 1] ^= 1; // tag invalide
  await assert.rejects(open(bytesToB64u(forged), session.keys.r2s, rs), isCode('auth'));
  assert.deepEqual(await open(legit, session.keys.r2s, rs), { type: 'hello' });
});

test('deux copies traitées en parallèle : une seule est acceptée', async () => {
  const rs = createReplayState();
  const f = await seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: 9 });
  const results = await Promise.allSettled([open(f, session.keys.r2s, rs), open(f, session.keys.r2s, rs), open(f, session.keys.r2s, rs)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});

test('LRU des émetteurs borné', async () => {
  const rs = createReplayState({ maxSenders: 2 });
  for (const s of ['sA0000000', 'sB0000000', 'sC0000000']) {
    await open(await seal({ type: 'hello' }, session.keys.r2s, { sender: s, seq: 1 }), session.keys.r2s, rs);
  }
  assert.equal(rs.senders.size, 2);
  assert.ok(!rs.senders.has('sA0000000'));
});

test('plafonds et arguments', async () => {
  const huge = { type: 'media-img-chunk', data: 'A'.repeat(MAX_MESSAGE_BYTES + 1) };
  await assert.rejects(seal(huge, session.keys.r2s, { ...R, seq: 1 }), isCode('too-large'));
  await assert.rejects(open('A'.repeat(MAX_FRAME_CHARS + 1), session.keys.r2s, null), isCode('too-large'));
  await assert.rejects(seal({ type: 'hello' }, session.keys.r2s, { sender: 'bad sender', seq: 1 }), isCode('bad-argument'));
  await assert.rejects(seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: -1 }), isCode('bad-argument'));
  await assert.rejects(seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: 2 ** 32 }), isCode('bad-argument'));
  await assert.rejects(seal({ type: 'Bad Type' }, session.keys.r2s, { ...R, seq: 1 }), isCode('bad-argument'));
  await assert.rejects(seal(/** @type {any} */ ({ type: 'x', n: 1n }), session.keys.r2s, { ...R, seq: 1 }), isCode('bad-argument'));
  const f = await seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: 1 });
  await assert.rejects(open(f, session.keys.r2s, /** @type {any} */ (undefined)), isCode('bad-argument'), 'replayState obligatoire');
  // Version inconnue, dont l'ancienne v1 (type en clair)
  for (const v of [1, 3]) {
    const other = b64uToBytes(f);
    other[0] = v;
    await assert.rejects(open(bytesToB64u(other), session.keys.r2s, null), isCode('version'));
  }
  assert.ok(MAX_MESSAGE_BYTES <= 40 * 1024, 'plafond abaissé (photo d’appel en fragments)');
  assert.ok(MAX_FRAME_CHARS <= 64 * 1024, `trame max ${MAX_FRAME_CHARS} caractères : un relais à 64 Kio suffit`);
});

test('clés de prototype dans le clair chiffré : rejetées à l’ouverture', async () => {
  const evil = JSON.parse('{"type":"color","color":"#ffffff","__proto__":{"polluted":true}}');
  const f = await seal(evil, session.keys.r2s, { ...R, seq: 1 });
  await assert.rejects(open(f, session.keys.r2s, null), isCode('malformed'));
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});

test('fragments : aller-retour, AAD (mediaId/index/total), plafonds', async () => {
  const data = new Uint8Array(MAX_CHUNK_BYTES).map((_, i) => i * 7);
  const meta = { mediaId: 'm-video-1', index: 2, total: 5 };
  const c = await sealChunk(data, session.keys.r2s, { ...R, seq: 1, ...meta });
  const rs = createReplayState();
  const opened = await openChunk(c, session.keys.r2s, rs);
  assert.deepEqual({ mediaId: opened.mediaId, index: opened.index, total: opened.total }, meta);
  assert.deepEqual(opened.data, data);
  await assert.rejects(openChunk(c, session.keys.r2s, rs), isCode('replay'));
  assert.equal(peekFrame(c).kind, 2);

  // Renumérotation / déplacement vers un autre média : détectés
  const bytes = b64uToBytes(c);
  const idAt = Buffer.from(bytes).indexOf('m-video-1');
  const moved = bytes.slice();
  moved.set(Buffer.from('m-video-2'), idAt);
  await assert.rejects(openChunk(bytesToB64u(moved), session.keys.r2s, null), isCode('auth'));
  const renum = bytes.slice();
  renum[idAt + 9 + 1] = 3; // index 2 → 3
  await assert.rejects(openChunk(bytesToB64u(renum), session.keys.r2s, null), isCode('auth'));
  const retot = bytes.slice();
  retot[idAt + 9 + 3] = 6; // total 5 → 6
  await assert.rejects(openChunk(bytesToB64u(retot), session.keys.r2s, null), isCode('auth'));

  // Confusion message ↔ fragment
  await assert.rejects(open(c, session.keys.r2s, null), isCode('kind'));
  const m = await seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: 2 });
  await assert.rejects(openChunk(m, session.keys.r2s, null), isCode('kind'));

  // Plafonds
  await assert.rejects(sealChunk(new Uint8Array(MAX_CHUNK_BYTES + 1), session.keys.r2s, { ...R, seq: 3, ...meta }), isCode('too-large'));
  await assert.rejects(sealChunk(data, session.keys.r2s, { ...R, seq: 3, mediaId: 'x', index: 0, total: MAX_CHUNKS + 1 }), isCode('too-large'));
  await assert.rejects(sealChunk(data, session.keys.r2s, { ...R, seq: 3, mediaId: 'x', index: 5, total: 5 }), isCode('bad-argument'));
  await assert.rejects(sealChunk(data, session.keys.r2s, { ...R, seq: 3, mediaId: '../x', index: 0, total: 1 }), isCode('bad-argument'));
  // total > MAX_CHUNKS forgé dans l'en-tête : refusé avant tout déchiffrement
  const forgedTotal = bytes.slice();
  forgedTotal[idAt + 9 + 2] = 0xff;
  forgedTotal[idAt + 9 + 3] = 0xff;
  await assert.rejects(openChunk(bytesToB64u(forgedTotal), session.keys.r2s, null), isCode('too-large'));
});

test('splitIntoChunks + assembleur borné', async () => {
  const file = new Uint8Array(40_000).map((_, i) => i & 255);
  const parts = splitIntoChunks(file);
  assert.equal(parts.length, 3);
  assert.equal(parts[0].length, MAX_CHUNK_BYTES);
  assert.throws(() => splitIntoChunks(new Uint8Array(MAX_CHUNKS + 1), 1), isCode('too-large'));
  assert.equal(splitIntoChunks(new Uint8Array(0)).length, 1);

  const asm = createChunkAssembler();
  // Non annoncé : ignoré (écran non visé en multi-écran)
  assert.equal(asm.add({ mediaId: 'v1', index: 0, total: 3, data: parts[0] }), null);
  assert.equal(asm.size, 0);
  asm.expect('v1', 3);
  assert.equal(asm.add({ mediaId: 'v1', index: 2, total: 3, data: parts[2] }), null);
  assert.equal(asm.add({ mediaId: 'v1', index: 2, total: 3, data: parts[2] }), null, 'doublon ignoré');
  assert.deepEqual(asm.missing('v1'), [0, 1]);
  assert.equal(asm.add({ mediaId: 'v1', index: 0, total: 99, data: parts[0] }), null, 'total incohérent ignoré');
  assert.equal(asm.add({ mediaId: 'v1', index: 0, total: 3, data: parts[0] }), null);
  const done = asm.add({ mediaId: 'v1', index: 1, total: 3, data: parts[1] });
  assert.deepEqual(done, file);
  assert.equal(asm.size, 0);

  const small = createChunkAssembler({ maxTotalBytes: 10, maxParallel: 1 });
  small.expect('a', 2);
  small.expect('b', 2);
  assert.equal(small.size, 1, 'maxParallel respecté');
  assert.throws(() => small.add({ mediaId: 'b', index: 0, total: 2, data: new Uint8Array(11) }), isCode('too-large'));
});

test('newSenderTag : préfixe de rôle + aléa', () => {
  const a = newSenderTag('r');
  const b = newSenderTag('r');
  assert.match(a, /^r[A-Za-z0-9_-]{8}$/);
  assert.notEqual(a, b);
  assert.throws(() => newSenderTag('bad prefix'), isCode('bad-argument'));
});

test('setCrypto : injection d’une implémentation WebCrypto (polyfill React Native)', async () => {
  const native = getCrypto();
  let calls = 0;
  const wrapped = {
    subtle: native.subtle,
    getRandomValues: (/** @type {any} */ a) => { calls++; return native.getRandomValues(a); },
  };
  setCrypto(wrapped);
  try {
    createPairing();
    await seal({ type: 'hello' }, session.keys.r2s, { ...R, seq: 1 });
    assert.ok(calls >= 3);
  } finally {
    setCrypto(null);
  }
  assert.throws(() => setCrypto(/** @type {any} */ ({})), isCode('no-crypto'));
  assert.equal(getCrypto(), native);
});

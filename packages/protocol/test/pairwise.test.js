// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRemoteId, createExchangeId, derivePairwiseSecret, pairwiseKeys, KEY_ID_RE, PAIRWISE_SECRET_RE,
} from '../pairwise.js';
import { createPairing, ecdhKeyPair } from '../pairing.js';
import { createScreenId, createSecureChannel } from '../channel.js';
import { deriveSession, open, openPairwise, peekFrame, seal, sealPairwise, FRAME_KIND } from '../crypto.js';
import { validate, explainInvalid } from '../schema.js';
import { b64uToBytes, bytesToB64u } from '../lib/encoding.js';

const isCode = (/** @type {string} */ code) => (/** @type {any} */ e) => e && e.name === 'ProtocolError' && e.code === code;

// Échange complet entre une télécommande et un écran (comme web/js/29-revoke.js)
async function exchange(o = {}) {
  const channelId = o.channelId || createPairing().channelId;
  const remoteId = o.remoteId || createRemoteId();
  const screenId = o.screenId || createScreenId();
  const exchangeId = o.exchangeId || createExchangeId();
  const R = await ecdhKeyPair();
  const E = await ecdhKeyPair();
  const t = { offerJwk: R.publicJwk, answerJwk: E.publicJwk, channelId, remoteId, screenId, exchangeId };
  const remote = await derivePairwiseSecret(R, t);
  const screen = await derivePairwiseSecret(E, t);
  return { remote, screen, t, R, E, remoteId, screenId };
}

test('échange ECDH : même secret et même kid des deux côtés, formats attendus', async () => {
  const { remote, screen } = await exchange();
  assert.equal(remote.secret, screen.secret);
  assert.equal(remote.kid, screen.kid);
  assert.match(remote.secret, PAIRWISE_SECRET_RE);
  assert.match(remote.kid, KEY_ID_RE);
  assert.match(createRemoteId(), /^[A-Za-z0-9_-]{16}$/);
  assert.match(createExchangeId(), /^[A-Za-z0-9_-]{16}$/);
});

test('liaison : chaque élément de la transcription change le secret ; clés différentes par écran', async () => {
  const base = await exchange();
  const { R, E, t } = base;
  for (const [field, value] of [['channelId', createPairing().channelId], ['remoteId', createRemoteId()], ['screenId', createScreenId()], ['exchangeId', createExchangeId()]]) {
    const other = await derivePairwiseSecret(R, { ...t, [field]: value });
    assert.notEqual(other.secret, base.remote.secret, field);
  }
  // Un autre écran (autre échange) : autre secret
  const B = await exchange({ remoteId: base.remoteId, channelId: t.channelId });
  assert.notEqual(B.remote.secret, base.remote.secret);
  // Le même secret attribué à un autre couple d'identifiants donne d'autres clés
  const k1 = await pairwiseKeys(base.remote.secret, { remoteId: base.remoteId, screenId: base.screenId });
  const k2 = await pairwiseKeys(base.remote.secret, { remoteId: base.remoteId, screenId: createScreenId() });
  assert.notEqual(k1.kid, k2.kid);
  const f = await sealPairwise({ type: 'key:ok', sid: base.screenId, xid: t.exchangeId }, k1.s2r, { sender: 'sA', seq: 1 });
  await assert.rejects(openPairwise(f, k2.s2r, null), isCode('auth'));
  assert.deepEqual(await openPairwise(f, k1.s2r, null), { type: 'key:ok', sid: base.screenId, xid: t.exchangeId });
  // Sens distincts : une trame r2s ne s'ouvre pas avec la clé s2r (pas de réflexion)
  const r = await sealPairwise({ type: 'key:confirm', sid: base.screenId, rid: base.remoteId, xid: t.exchangeId }, k1.r2s, { sender: 'rA', seq: 1 });
  await assert.rejects(openPairwise(r, k1.s2r, null), isCode('auth'));
  // Un écran tiers, qui ne détient pas la clé privée éphémère, ne peut pas la recalculer
  const intruder = await ecdhKeyPair();
  await assert.rejects(derivePairwiseSecret(intruder, t), isCode('bad-argument'));
  const spoof = await derivePairwiseSecret(intruder, { ...t, answerJwk: intruder.publicJwk });
  assert.notEqual(spoof.secret, base.remote.secret);
});

test('entrées refusées : clé réfléchie, identifiants mal formés, point hors courbe', async () => {
  const { R, t } = await exchange();
  await assert.rejects(derivePairwiseSecret(R, { ...t, answerJwk: t.offerJwk }), isCode('bad-key'));
  await assert.rejects(derivePairwiseSecret(R, { ...t, screenId: 'court' }), isCode('bad-argument'));
  await assert.rejects(derivePairwiseSecret(R, { ...t, screenId: t.remoteId }), isCode('bad-argument'));
  await assert.rejects(derivePairwiseSecret(R, { ...t, channelId: 'x' }), isCode('bad-argument'));
  await assert.rejects(derivePairwiseSecret(R, { ...t, exchangeId: '' }), isCode('bad-argument'));
  const offCurve = { ...t.answerJwk, y: bytesToB64u(new Uint8Array(32).fill(7)) };
  await assert.rejects(derivePairwiseSecret(R, { ...t, answerJwk: offCurve }), isCode('bad-key'));
  await assert.rejects(pairwiseKeys('trop-court', { remoteId: t.remoteId, screenId: t.screenId }), isCode('bad-argument'));
});

test('séparation : une trame pairwise ne s\'ouvre jamais avec la clé de session, et inversement', async () => {
  const pairing = createPairing();
  const session = await deriveSession(pairing);
  const { remote, remoteId, screenId } = await exchange({ channelId: pairing.channelId });
  const pk = await pairwiseKeys(remote.secret, { remoteId, screenId });
  const msg = { type: 'session:rekey', sid: screenId, rid: remoteId, channelId: 'C'.repeat(22), key: 'K'.repeat(43) };
  const pw = await sealPairwise(msg, pk.r2s, { sender: 'rA', seq: 1 });
  const ss = await seal({ type: 'color', color: '#ff0000' }, session.keys.r2s, { sender: 'rA', seq: 2 });
  assert.equal(peekFrame(pw).kind, FRAME_KIND.PAIRWISE);
  assert.equal(peekFrame(ss).kind, FRAME_KIND.MESSAGE);
  // Pairwise → open() (session) : refusée, quelle que soit la clé
  await assert.rejects(open(pw, session.keys.r2s, null), isCode('kind'));
  await assert.rejects(open(pw, pk.r2s, null), isCode('kind'));
  // Session → openPairwise() : refusée
  await assert.rejects(openPairwise(ss, pk.r2s, null), isCode('kind'));
  await assert.rejects(openPairwise(ss, session.keys.r2s, null), isCode('kind'));
  // Type de trame réécrit dans l'en-tête (authentifié) : l'authentification échoue
  const flip = (/** @type {string} */ f, /** @type {number} */ kind) => { const b = b64uToBytes(f); b[1] = kind; return bytesToB64u(b); };
  await assert.rejects(open(flip(pw, FRAME_KIND.MESSAGE), session.keys.r2s, null), isCode('auth'));
  await assert.rejects(open(flip(pw, FRAME_KIND.MESSAGE), pk.r2s, null), isCode('auth'));
  await assert.rejects(openPairwise(flip(ss, FRAME_KIND.PAIRWISE), pk.r2s, null), isCode('auth'));
  await assert.rejects(openPairwise(flip(ss, FRAME_KIND.PAIRWISE), session.keys.r2s, null), isCode('auth'));
  // Clé de session avec openPairwise sur une vraie trame pairwise : refusée
  await assert.rejects(openPairwise(pw, session.keys.r2s, null), isCode('auth'));
  assert.deepEqual(await openPairwise(pw, pk.r2s, null), msg);
});

test('schéma : messages pairwise seulement sur le canal pairwise, et inversement ; sens et champs stricts', () => {
  const sid = createScreenId(), rid = createRemoteId(), xid = createExchangeId();
  const rekey = { type: 'session:rekey', sid, rid, channelId: 'C'.repeat(22), key: 'K'.repeat(43) };
  assert.equal(validate(rekey, { direction: 'r2s', channel: 'pairwise' }), true);
  assert.match(String(explainInvalid(rekey, { direction: 'r2s' })), /pairwise/, 'forgée avec la clé de session : refusée');
  assert.equal(validate(rekey, { direction: 's2r', channel: 'pairwise' }), false, 'mauvais sens');
  assert.equal(validate({ ...rekey, key: 'K'.repeat(42) }, { channel: 'pairwise' }), false);
  assert.equal(validate({ ...rekey, target: { screens: [sid] } }, { channel: 'pairwise' }), false, 'pas de target');
  assert.equal(validate({ ...rekey, extra: 1 }, { channel: 'pairwise' }), false);
  assert.equal(validate({ type: 'color', color: '#ffffff' }, { channel: 'pairwise' }), false, 'commande de session refusée en pairwise');
  assert.equal(validate({ type: 'key:ok', sid, xid }, { direction: 's2r', channel: 'pairwise' }), true);
  assert.equal(validate({ type: 'key:ok', sid, xid }, { direction: 's2r' }), false);
  assert.equal(validate({ type: 'rekey:ok', sid, channelId: 'C'.repeat(22) }, { direction: 's2r', channel: 'pairwise' }), true);
  assert.equal(validate({ type: 'key:confirm', sid, rid, xid }, { direction: 'r2s', channel: 'pairwise' }), true);
  // Dans la session : offre adressée à UN écran, réponse sans target, retrait adressé à UN écran
  const jwk = { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'B'.repeat(43) };
  assert.equal(validate({ type: 'key:offer', rid, xid, jwk, target: { screens: [sid] } }, { direction: 'r2s' }), true);
  assert.equal(validate({ type: 'key:offer', rid, xid, jwk }, { direction: 'r2s' }), false, 'offre à tous : refusée');
  assert.equal(validate({ type: 'key:offer', rid, xid, jwk: { ...jwk, d: 'A'.repeat(43) }, target: { screens: [sid] } }), false, 'clé privée');
  assert.equal(validate({ type: 'key:answer', sid, rid, xid, jwk }, { direction: 's2r' }), true);
  assert.equal(validate({ type: 'key:answer', sid, rid, xid, jwk }, { direction: 'r2s' }), false);
  assert.equal(validate({ type: 'key:answer', sid, rid, xid, jwk }, { channel: 'pairwise' }), false);
  assert.equal(validate({ type: 'screen:revoked', target: { screens: [sid] } }, { direction: 'r2s' }), true);
  assert.equal(validate({ type: 'screen:revoked', reason: 'other', target: { screens: [sid] } }), false);
  assert.equal(validate({ type: 'screen:revoked', target: { group: 'g1' } }), false, 'un écran précis');
  assert.equal(validate({ type: 'screen:revoked', target: { screens: [sid] } }, { channel: 'pairwise' }), false);
  assert.equal(validate({ type: 'caps', torch: true, vibrate: true, kx: 2 }), false);
  assert.equal(validate({ type: 'caps', torch: true, vibrate: true, kid: 'court' }), false);
});

test('canal sécurisé : la télécommande scelle pour UN écran, les autres ignorent ; session:rekey forgée refusée', async () => {
  const pairing = createPairing();
  const rid = createRemoteId();
  const idA = createScreenId(), idB = createScreenId();
  const remote = await createSecureChannel({ pairing, role: 'remote' });
  const A = await createSecureChannel({ pairing, role: 'screen', screenId: idA });
  const B = await createSecureChannel({ pairing, role: 'screen', screenId: idB });
  const ex = async (sid) => {
    const R = await ecdhKeyPair(), E = await ecdhKeyPair();
    const t = { offerJwk: R.publicJwk, answerJwk: E.publicJwk, channelId: pairing.channelId, remoteId: rid, screenId: sid, exchangeId: createExchangeId() };
    const { secret } = await derivePairwiseSecret(R, t);
    return pairwiseKeys(secret, { remoteId: rid, screenId: sid });
  };
  const kA = await ex(idA), kB = await ex(idB);
  const rekey = { type: 'session:rekey', sid: idA, rid, ...(({ channelId, key }) => ({ channelId, key }))(createPairing()) };
  const frame = await remote.sealPairwise(rekey, kA);
  // A l'ouvre avec sa clé ; B (autre clé) ne peut pas ; sans résolveur : ignorée
  const ra = await A.receive(frame, { pairwise: () => [{ keys: kA, tag: 'actif' }] });
  assert.deepEqual([ra.kind, ra.message, ra.tag], ['pairwise', rekey, 'actif']);
  assert.equal(await B.receive(frame, { pairwise: () => [{ keys: kB }] }), null);
  assert.equal(await B.receive(frame), null);
  // Rejouée : ignorée (fenêtre anti-rejeu pairwise)
  assert.equal(await A.receive(frame, { pairwise: () => [{ keys: kA }] }), null);
  // Un détenteur de la session ne peut pas émettre une session:rekey de session
  await assert.rejects(remote.seal({ ...rekey }), isCode('invalid-message'));
  const session = await deriveSession(pairing);
  const forged = await seal(rekey, session.keys.r2s, { sender: 'rEvil1', seq: 1 });
  await assert.rejects(A.receive(forged, { pairwise: () => [{ keys: kA }] }), isCode('invalid-message'));
  // Et une commande de session n'est jamais acceptée scellée en pairwise
  await assert.rejects(remote.sealPairwise({ type: 'color', color: '#ffffff' }, kA), isCode('invalid-message'));
  // Réponse de l'écran (s2r) : la télécommande l'ouvre avec la clé de l'écran émetteur
  const ack = await A.sealPairwise({ type: 'rekey:ok', sid: idA, channelId: rekey.channelId }, kA);
  const rr = await remote.receive(ack, { pairwise: () => [{ keys: kA, tag: idA }] });
  assert.deepEqual([rr.kind, rr.message.type, rr.tag], ['pairwise', 'rekey:ok', idA]);
  assert.equal(await remote.receive(await A.sealPairwise({ type: 'rekey:ok', sid: idA, channelId: rekey.channelId }, kA), { pairwise: () => [{ keys: kB }] }), null);
});

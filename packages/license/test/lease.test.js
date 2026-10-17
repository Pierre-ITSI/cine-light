// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Baux signés : clés Ed25519 GÉNÉRÉES pour les tests (aucune clé dans le dépôt).
import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyLease, decodeLease, leasePayloadProblem, ed25519Support, setEd25519Verifier, resetEd25519Probe,
  toBase64Url, fromBase64Url, LEASE_PREFIX, LEASE_DEFAULTS,
} from '../lease.js';
import { signLease, randomId } from '../issue.js';

const DAY = 86400;
const T0 = 1_800_000_000; // s
let signer, otherSigner, pubB64, otherPubB64;
const SEAT = randomId();
const LID = randomId();

async function keyPair() {
  const k = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey));
  return { privateKey: k.privateKey, raw };
}

const payload = (over = {}) => ({ v: 1, kid: 'k2026a', lid: LID, seat: SEAT, iat: T0, exp: T0 + 7 * DAY, lexp: T0 + 180 * DAY, feat: ['official'], ...over });
const keys = () => ({ k2026a: pubB64, k2026b: otherPubB64 });
const at = (s) => s * 1000;

before(async () => {
  signer = await keyPair();
  otherSigner = await keyPair();
  pubB64 = toBase64Url(signer.raw);
  otherPubB64 = toBase64Url(otherSigner.raw);
});
afterEach(() => { setEd25519Verifier(null); resetEd25519Probe(); });

test('base64url : aller-retour, forme canonique stricte', () => {
  for (let n = 0; n < 40; n++) {
    const b = crypto.getRandomValues(new Uint8Array(n));
    const s = toBase64Url(b);
    assert.equal(s, Buffer.from(b).toString('base64url'));
    assert.deepEqual(fromBase64Url(s), b);
  }
  assert.equal(fromBase64Url('A'), null);
  assert.equal(fromBase64Url('AB+/'), null);
  assert.equal(fromBase64Url('AB='), null);
  assert.equal(fromBase64Url('AF'), null); // bits de remplissage non nuls
});

test('Ed25519 disponible dans Node 22 (WebCrypto), vecteur RFC 8032 vérifié', async () => {
  assert.equal(await ed25519Support(), 'webcrypto');
});

test('bail valide : statut, échéances, aucune donnée personnelle', async () => {
  const token = await signLease(payload(), signer.privateKey);
  assert.ok(token.startsWith(LEASE_PREFIX));
  assert.ok(token.length < 400, token.length);
  const r = await verifyLease(token, { keys: keys(), seat: SEAT, now: at(T0 + DAY) });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'valid');
  assert.equal(r.expiresAt, at(T0 + 7 * DAY));
  assert.equal(r.graceEndsAt, at(T0 + 7 * DAY + LEASE_DEFAULTS.graceSeconds));
  assert.equal(r.licenceExpiresAt, at(T0 + 180 * DAY));
  assert.deepEqual(Object.keys(decodeLease(token).payload).sort(), ['exp', 'feat', 'iat', 'kid', 'lexp', 'lid', 'seat', 'v']);
});

test('fin de bail : délai de grâce, puis expiré ; fin de licence sans grâce', async () => {
  const token = await signLease(payload(), signer.privateKey);
  const v = (s) => verifyLease(token, { keys: keys(), seat: SEAT, now: at(s) });
  assert.equal((await v(T0 + 7 * DAY)).status, 'valid');
  assert.equal((await v(T0 + 7 * DAY + 1)).status, 'grace');
  assert.equal((await v(T0 + 7 * DAY + 1)).ok, true);
  assert.equal((await v(T0 + 10 * DAY)).status, 'grace');
  const late = await v(T0 + 10 * DAY + 1);
  assert.deepEqual([late.ok, late.status], [false, 'expired']);
  // Bail qui se termine avec la licence : pas de grâce au-delà de lexp
  const last = await signLease(payload({ iat: T0 + 175 * DAY, exp: T0 + 180 * DAY }), signer.privateKey);
  const r = await verifyLease(last, { keys: keys(), seat: SEAT, now: at(T0 + 180 * DAY + 1) });
  assert.deepEqual([r.ok, r.status], [false, 'licence-expired']);
  // Grâce réglable
  const g = await verifyLease(token, { keys: keys(), seat: SEAT, now: at(T0 + 8 * DAY), graceSeconds: 0 });
  assert.equal(g.status, 'expired');
});

test('horloge : bail émis dans le futur refusé au-delà de la tolérance', async () => {
  const token = await signLease(payload(), signer.privateKey);
  assert.equal((await verifyLease(token, { keys: keys(), seat: SEAT, now: at(T0 - 60) })).status, 'valid');
  const r = await verifyLease(token, { keys: keys(), seat: SEAT, now: at(T0 - 3600) });
  assert.deepEqual([r.status, r.reason], ['invalid', 'not-yet-valid']);
});

test('siège : un bail ne vaut que pour la télécommande titulaire', async () => {
  const token = await signLease(payload(), signer.privateKey);
  const r = await verifyLease(token, { keys: keys(), seat: randomId(), now: at(T0 + 1) });
  assert.deepEqual([r.ok, r.reason], [false, 'seat']);
  assert.equal((await verifyLease(token, { keys: keys(), now: at(T0 + 1) })).reason, 'seat');
});

test('signature : altération, mauvaise clé, kid inconnu', async () => {
  const token = await signLease(payload(), signer.privateKey);
  const [, body, sig] = token.split('.');
  // Charge utile modifiée (bail prolongé), signature d'origine
  const forged = { ...payload(), exp: T0 + 30 * DAY };
  const forgedToken = LEASE_PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(forged))) + '.' + sig;
  assert.equal((await verifyLease(forgedToken, { keys: keys(), seat: SEAT, now: at(T0 + 1) })).reason, 'signature');
  // Signature altérée d'un bit
  const s = fromBase64Url(sig); s[10] ^= 1;
  assert.equal((await verifyLease(LEASE_PREFIX + body + '.' + toBase64Url(s), { keys: keys(), seat: SEAT, now: at(T0 + 1) })).reason, 'signature');
  // Signé par une autre clé que celle annoncée par kid
  const wrongKey = await signLease(payload(), otherSigner.privateKey);
  assert.equal((await verifyLease(wrongKey, { keys: keys(), seat: SEAT, now: at(T0 + 1) })).reason, 'signature');
  // Rotation : kid k2026b signé par la bonne clé
  const rotated = await signLease(payload({ kid: 'k2026b' }), otherSigner.privateKey);
  assert.equal((await verifyLease(rotated, { keys: keys(), seat: SEAT, now: at(T0 + 1) })).status, 'valid');
  // kid inconnu, ou clé publique retirée de l'app
  assert.equal((await verifyLease(rotated, { keys: { k2026a: pubB64 }, seat: SEAT, now: at(T0 + 1) })).reason, 'unknown-key');
  assert.equal((await verifyLease(rotated, { keys: { k2026b: 'court' }, seat: SEAT, now: at(T0 + 1) })).reason, 'unknown-key');
  assert.equal((await verifyLease(rotated, { keys: { k2026b: otherSigner.raw }, seat: SEAT, now: at(T0 + 1) })).status, 'valid');
  // Pas de kid hérité du prototype
  const proto = await signLease(payload({ kid: 'toString' }), signer.privateKey);
  assert.equal((await verifyLease(proto, { keys: keys(), seat: SEAT, now: at(T0 + 1) })).reason, 'unknown-key');
});

test('format : jetons malformés refusés sans exception', async () => {
  const token = await signLease(payload(), signer.privateKey);
  const o = { keys: keys(), seat: SEAT, now: at(T0 + 1) };
  for (const bad of [undefined, null, 42, '', 'SRL1.', 'SRL2.' + token.slice(5), token + '.x', token.replace('.', '..'),
    token.slice(0, -2), 'SRL1.' + 'A'.repeat(3000) + '.AAAA', LEASE_PREFIX + toBase64Url(new TextEncoder().encode('pas du json')) + '.' + token.split('.')[2]]) {
    const r = await verifyLease(bad, o);
    assert.equal(r.ok, false);
    assert.equal(r.status, 'invalid');
    assert.equal(r.reason, 'format', String(bad).slice(0, 40));
  }
});

test('charge utile : champs exacts, bornes, pas de champ supplémentaire (PII)', () => {
  assert.equal(leasePayloadProblem(payload()), null);
  assert.equal(leasePayloadProblem({ ...payload(), email: 'a@b.c' }), 'payload');
  const { feat, ...noFeat } = payload();
  assert.equal(leasePayloadProblem(noFeat), 'payload');
  assert.equal(leasePayloadProblem(payload({ v: 2 })), 'version');
  assert.equal(leasePayloadProblem(payload({ seat: 'pierre@itsi-app.com' })), 'payload');
  assert.equal(leasePayloadProblem(payload({ seat: 'court' })), 'payload');
  assert.equal(leasePayloadProblem(payload({ kid: '' })), 'payload');
  assert.equal(leasePayloadProblem(payload({ exp: T0 })), 'payload');
  assert.equal(leasePayloadProblem(payload({ exp: T0 + 200 * DAY })), 'payload'); // exp > lexp
  assert.equal(leasePayloadProblem(payload({ exp: T0 + 40 * DAY })), 'too-long');
  assert.equal(leasePayloadProblem(payload({ iat: 1.5 })), 'payload');
  assert.equal(leasePayloadProblem(payload({ feat: ['Official'] })), 'payload');
  assert.equal(leasePayloadProblem(payload({ feat: ['a', 'a'] })), 'payload');
  assert.equal(leasePayloadProblem(payload({ feat: [] })), null);
  assert.equal(leasePayloadProblem([]), 'payload');
  assert.equal(leasePayloadProblem(null), 'payload');
});

test('signLease refuse une charge utile invalide', async () => {
  await assert.rejects(signLease(payload({ exp: T0 + 60 * DAY }), signer.privateKey), /too-long/);
  await assert.rejects(signLease({ ...payload(), name: 'x' }, signer.privateKey), /payload/);
});

test('bail trop long refusé à la vérification même s\'il est signé', async () => {
  const token = await signLease(payload({ exp: T0 + 60 * DAY }), signer.privateKey, { maxLeaseSeconds: 90 * DAY });
  assert.equal((await verifyLease(token, { keys: keys(), seat: SEAT, now: at(T0 + 1) })).reason, 'too-long');
  assert.equal((await verifyLease(token, { keys: keys(), seat: SEAT, now: at(T0 + 1), maxLeaseSeconds: 90 * DAY })).status, 'valid');
});

test('repli : vérificateur injecté (WebView sans Ed25519)', async () => {
  const token = await signLease(payload(), signer.privateKey);
  const calls = [];
  // Vérificateur de remplacement (ici WebCrypto de Node, comme le serait un module natif)
  setEd25519Verifier(async (pub, sig, msg) => {
    calls.push(pub.length);
    const k = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'Ed25519' }, k, sig, msg);
  });
  assert.equal(await ed25519Support(), 'injected');
  assert.equal((await verifyLease(token, { keys: keys(), seat: SEAT, now: at(T0 + 1) })).status, 'valid');
  assert.ok(calls.length >= 1);
  // Vérificateur défaillant (accepte tout) : écarté par l'autotest RFC 8032
  setEd25519Verifier(async () => true);
  assert.equal(await ed25519Support(), 'none');
  assert.equal((await verifyLease(token, { keys: keys(), seat: SEAT, now: at(T0 + 1) })).reason, 'unsupported');
  assert.throws(() => setEd25519Verifier('non'), TypeError);
});

test('sans WebCrypto Ed25519 ni repli : « unsupported », jamais « valid »', async (t) => {
  const real = globalThis.crypto.subtle.importKey;
  t.after(() => { globalThis.crypto.subtle.importKey = real; resetEd25519Probe(); });
  const token = await signLease(payload(), signer.privateKey);
  resetEd25519Probe();
  globalThis.crypto.subtle.importKey = async (fmt, data, alg, ...rest) => {
    if (alg && alg.name === 'Ed25519') throw new DOMException('Unrecognized name', 'NotSupportedError');
    return real.call(globalThis.crypto.subtle, fmt, data, alg, ...rest);
  };
  assert.equal(await ed25519Support(), 'none');
  const r = await verifyLease(token, { keys: keys(), seat: SEAT, now: at(T0 + 1) });
  assert.deepEqual([r.ok, r.reason], [false, 'unsupported']);
});

test('randomId : 128 bits, base64url, accepté comme siège', () => {
  const ids = new Set(Array.from({ length: 500 }, randomId));
  assert.equal(ids.size, 500);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{22}$/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPairing, pairingUrl, parsePairingUrl, isValidPairing,
  createRendezvous, normalizeRendezvousCode, formatRendezvousCode, rendezvousTopic, RENDEZVOUS_ALPHABET,
  ecdhKeyPair, deriveSharedPairing, commitPublicKey, verifyCommitment, sanitizePublicJwk, formatSas,
  sealSessionForPeer, openSessionFromPeer, validateRendezvousMessage,
} from '../pairing.js';
import { b64uToBytes, bytesToB64u } from '../lib/encoding.js';

const isCode = (/** @type {string} */ code) => (/** @type {any} */ e) => e && e.name === 'ProtocolError' && e.code === code;

test('createPairing : 128 + 256 bits aléatoires en base64url', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = createPairing();
    assert.match(p.channelId, /^[A-Za-z0-9_-]{22}$/);
    assert.match(p.key, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(b64uToBytes(p.channelId).length, 16);
    assert.equal(b64uToBytes(p.key).length, 32);
    assert.ok(isValidPairing(p));
    seen.add(p.channelId).add(p.key);
  }
  assert.equal(seen.size, 400);
});

test('pairingUrl : le secret n’est QUE dans le fragment', () => {
  const p = createPairing();
  const u = pairingUrl('https://setremote.example/app/?lang=fr#ancien', p);
  const url = new URL(u);
  assert.equal(url.hash, `#p=v1.${p.channelId}.${p.key}`);
  assert.equal(url.search, '?lang=fr');
  assert.ok(!url.pathname.includes(p.key) && !url.search.includes(p.key) && !url.search.includes(p.channelId));
  // Ce qu'un serveur web reçoit (tout sauf le fragment) ne contient aucun secret
  const sentToServer = url.origin + url.pathname + url.search;
  assert.ok(!sentToServer.includes(p.key) && !sentToServer.includes(p.channelId));
  assert.throws(() => pairingUrl('https://x/', /** @type {any} */ ({ channelId: 'a', key: 'b' })), isCode('bad-pairing'));
});

test('parsePairingUrl : aller-retour et rejets', () => {
  const p = createPairing();
  const u = pairingUrl('https://setremote.example/', p);
  assert.deepEqual(parsePairingUrl(u), p);
  assert.deepEqual(parsePairingUrl(`#p=v1.${p.channelId}.${p.key}`), p);
  assert.deepEqual(parsePairingUrl(`p=v1.${p.channelId}.${p.key}`), p);
  assert.deepEqual(parsePairingUrl(`https://x/#foo=1&p=v1.${p.channelId}.${p.key}`), p);
  // Ancien code canal → null (l'app bascule en mode historique)
  assert.equal(parsePairingUrl('https://setremote.example/#set4271'), null);
  assert.equal(parsePairingUrl('https://setremote.example/'), null);
  assert.equal(parsePairingUrl(`#p=v2.${p.channelId}.${p.key}`), null);
  assert.equal(parsePairingUrl(`#p=v1.${p.channelId}.${p.key}x`), null);
  assert.equal(parsePairingUrl(`#p=v1.${p.channelId.slice(1)}.${p.key}`), null);
  assert.equal(parsePairingUrl(`#p=v1.${p.channelId}.${p.key.slice(0, 42)}+`), null);
  // Base64url non canonique (bits de bourrage non nuls) refusé
  const lastBits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = p.channelId[21];
  const tweaked = p.channelId.slice(0, 21) + lastBits[(lastBits.indexOf(last) & ~15) | 1];
  assert.equal(parsePairingUrl(`#p=v1.${tweaked}.${p.key}`), null);
  assert.equal(parsePairingUrl('#p=' + 'A'.repeat(5000)), null);
  assert.equal(parsePairingUrl(/** @type {any} */ (null)), null);
});

test('code de rendez-vous : 6 symboles non ambigus, normalisation, topic opaque', async () => {
  for (const ch of 'IL O01') assert.ok(!RENDEZVOUS_ALPHABET.includes(ch));
  const counts = new Map();
  for (let i = 0; i < 2000; i++) {
    const { code, expiresAt } = createRendezvous({ now: 1000 });
    assert.equal(expiresAt, 1000 + 120_000);
    assert.match(code, new RegExp(`^[${RENDEZVOUS_ALPHABET}]{6}$`));
    for (const c of code) counts.set(c, (counts.get(c) || 0) + 1);
  }
  assert.equal(counts.size, RENDEZVOUS_ALPHABET.length, 'tous les symboles apparaissent');
  assert.equal(normalizeRendezvousCode(' k7p-q4x '), 'K7PQ4X');
  assert.equal(normalizeRendezvousCode('K7P Q4X'), 'K7PQ4X');
  assert.equal(normalizeRendezvousCode('K7PQ4'), null);
  assert.equal(normalizeRendezvousCode('K7PQ40'), null, '0 ne fait pas partie de l’alphabet');
  assert.equal(formatRendezvousCode('k7pq4x'), 'K7P-Q4X');
  const t1 = await rendezvousTopic('K7P-Q4X');
  assert.equal(t1, await rendezvousTopic('k7pq4x'));
  assert.match(t1, /^[A-Za-z0-9_-]{22}$/);
  assert.ok(!t1.toUpperCase().includes('K7PQ4X'));
  assert.notEqual(t1, await rendezvousTopic('K7PQ4Y'));
  await assert.rejects(rendezvousTopic('nope'), isCode('bad-argument'));
});

test('ECDH : les deux côtés obtiennent le même appairage et la même SAS', async () => {
  const remote = await ecdhKeyPair();
  const screen = await ecdhKeyPair();
  assert.deepEqual(Object.keys(remote.publicJwk).sort(), ['crv', 'kty', 'x', 'y']);
  const a = await deriveSharedPairing(remote, screen.publicJwk, { code: 'K7P-Q4X' });
  const b = await deriveSharedPairing(screen, remote.publicJwk, { code: 'k7pq4x' });
  assert.deepEqual(a, b);
  assert.match(a.sas, /^\d{6}$/);
  assert.ok(isValidPairing(a.pairing));
  assert.match(formatSas(a.sas), /^\d{3} \d{3}$/);
  // La transcription compte : un autre code donne une autre SAS
  const c = await deriveSharedPairing(remote, screen.publicJwk, { code: 'K7PQ4Y' });
  assert.notEqual(c.sas, a.sas);
  assert.notEqual(c.pairing.key, a.pairing.key);
});

test('MITM par substitution de clé : SAS et secrets différents des deux côtés', async () => {
  let sasCollisions = 0;
  for (let i = 0; i < 5; i++) {
    const remote = await ecdhKeyPair();
    const screen = await ecdhKeyPair();
    const m1 = await ecdhKeyPair(); // Mallory face à la télécommande
    const m2 = await ecdhKeyPair(); // Mallory face à l'écran
    const code = 'ABCDEF';
    const remoteView = await deriveSharedPairing(remote, m1.publicJwk, { code });
    const screenView = await deriveSharedPairing(screen, m2.publicJwk, { code });
    assert.notEqual(remoteView.pairing.key, screenView.pairing.key);
    if (remoteView.sas === screenView.sas) sasCollisions++;
    // Mallory connaît chacun des deux secrets, mais pas un secret commun aux deux victimes
    const mallory1 = await deriveSharedPairing(m1, remote.publicJwk, { code });
    assert.equal(mallory1.sas, remoteView.sas);
    // Substitution d'une seule clé : la SAS de la victime diffère de la SAS honnête
    const honest = await deriveSharedPairing(screen, remote.publicJwk, { code });
    assert.notEqual(honest.sas, remoteView.sas);
  }
  assert.equal(sasCollisions, 0);
});

test('engagement : vérifie la clé révélée, refuse une clé substituée', async () => {
  const screen = await ecdhKeyPair();
  const mallory = await ecdhKeyPair();
  const commit = await commitPublicKey(screen.publicJwk);
  assert.match(commit, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await verifyCommitment(screen.publicJwk, commit), true);
  assert.equal(await verifyCommitment(mallory.publicJwk, commit), false);
  // Dernier caractère remplacé par un AUTRE caractère canonique (bits de bourrage nuls)
  const altered = commit.slice(0, 42) + (commit[42] === 'A' ? 'E' : 'A');
  assert.equal(await verifyCommitment(screen.publicJwk, altered), false);
  assert.equal(await verifyCommitment(/** @type {any} */ ({}), commit), false);
  assert.equal(await verifyCommitment(screen.publicJwk, /** @type {any} */ (null)), false);
});

test('clés publiques invalides rejetées (courbe, format, point hors courbe, réflexion)', async () => {
  const me = await ecdhKeyPair();
  const peer = await ecdhKeyPair();
  const bad = [
    { ...peer.publicJwk, crv: 'P-384' },
    { ...peer.publicJwk, kty: 'OKP' },
    { ...peer.publicJwk, x: peer.publicJwk.x.slice(0, 20) },
    { ...peer.publicJwk, d: 'AAAA' },
    { kty: 'EC', crv: 'P-256' },
    null,
  ];
  for (const jwk of bad) await assert.rejects(deriveSharedPairing(me, jwk), isCode('bad-key'));
  // Point hors courbe (attaque par courbe invalide)
  const y = b64uToBytes(peer.publicJwk.y);
  y[31] ^= 1;
  await assert.rejects(deriveSharedPairing(me, { ...peer.publicJwk, y: bytesToB64u(y) }), isCode('bad-key'));
  // Notre propre clé renvoyée
  await assert.rejects(deriveSharedPairing(me, me.publicJwk), isCode('bad-key'));
  assert.throws(() => sanitizePublicJwk({ ...peer.publicJwk, x: '!!' }), isCode('bad-key'));
  await assert.rejects(deriveSharedPairing(me, peer.publicJwk, { code: 'bad' }), isCode('bad-argument'));
});

/**
 * Simule le déroulé complet du code manuel pour UN écran, messages de
 * rendez-vous compris, et renvoie ce que chaque côté obtient.
 * @param {import('../pairing.js').Pairing} session
 */
async function manualPairing(session, { label = 'Plateau 4', attackerSwapsScreenKey = false } = {}) {
  const { code } = createRendezvous();
  const screen = await ecdhKeyPair();
  const remote = await ecdhKeyPair();
  const mallory = await ecdhKeyPair();
  const msgs = [];
  // 2. écran → commit
  const commitMsg = { type: 'pair:commit', v: 1, commit: await commitPublicKey(screen.publicJwk) };
  msgs.push(commitMsg);
  // 3. télécommande → sa clé
  const keyMsg = { type: 'pair:key', v: 1, jwk: remote.publicJwk };
  msgs.push(keyMsg);
  // 4. écran → révélation (éventuellement substituée par un attaquant)
  const revealMsg = { type: 'pair:reveal', v: 1, jwk: attackerSwapsScreenKey ? mallory.publicJwk : screen.publicJwk };
  msgs.push(revealMsg);
  for (const m of msgs) assert.ok(validateRendezvousMessage(m), m.type);
  // 5. vérification de l'engagement côté télécommande
  const commitOk = await verifyCommitment(revealMsg.jwk, commitMsg.commit);
  if (!commitOk) return { commitOk };
  // 6. dérivations + SAS
  const r = await deriveSharedPairing(remote, revealMsg.jwk, { code });
  const s = await deriveSharedPairing(screen, keyMsg.jwk, { code });
  // 7. remise du secret de session (après confirmation de la SAS)
  const frame = await sealSessionForPeer(session, r.pairing, { label });
  const sessionMsg = { type: 'pair:session', v: 1, frame };
  assert.ok(validateRendezvousMessage(sessionMsg));
  // 8. l'écran ouvre la remise
  const got = await openSessionFromPeer(sessionMsg.frame, s.pairing);
  return { commitOk, sasRemote: r.sas, sasScreen: s.sas, got, frame, temp: s.pairing };
}

test('multi-écran (code manuel) : chaque écran reçoit LE MÊME secret de session', async () => {
  const session = createPairing();
  const a = await manualPairing(session, { label: 'Plateau 4' });
  const b = await manualPairing(session, { label: 'Plateau 4' });
  assert.equal(a.sasRemote, a.sasScreen);
  assert.equal(b.sasRemote, b.sasScreen);
  assert.deepEqual(a.got?.pairing, session);
  assert.deepEqual(b.got?.pairing, session);
  assert.equal(a.got?.label, 'Plateau 4');
  // Les canaux temporaires diffèrent d'un écran à l'autre
  assert.notDeepEqual(a.temp, b.temp);
  // La remise d'un écran est illisible avec le canal temporaire d'un autre
  await assert.rejects(openSessionFromPeer(/** @type {string} */ (a.frame), /** @type {any} */ (b.temp)), isCode('auth'));
});

test('multi-écran : un attaquant qui substitue la clé de l’écran est détecté par l’engagement', async () => {
  const res = await manualPairing(createPairing(), { attackerSwapsScreenKey: true });
  assert.equal(res.commitOk, false);
});

test('remise de session : falsification et arguments', async () => {
  const session = createPairing();
  const temp = createPairing();
  const frame = await sealSessionForPeer(session, temp);
  assert.deepEqual(await openSessionFromPeer(frame, temp), { pairing: session, label: '' });
  const bytes = b64uToBytes(frame);
  bytes[bytes.length - 1] ^= 1;
  await assert.rejects(openSessionFromPeer(bytesToB64u(bytes), temp), isCode('auth'));
  await assert.rejects(sealSessionForPeer(temp, temp), isCode('bad-argument'));
  await assert.rejects(sealSessionForPeer(session, temp, { label: 'x'.repeat(41) }), isCode('bad-argument'));
  await assert.rejects(sealSessionForPeer(/** @type {any} */ ({}), temp), isCode('bad-pairing'));
});

test('validateRendezvousMessage : messages réels acceptés, déchets refusés', async () => {
  const kp = await ecdhKeyPair();
  assert.ok(validateRendezvousMessage({ type: 'pair:key', v: 1, jwk: { ...kp.publicJwk, ext: true, key_ops: [] } }));
  assert.ok(validateRendezvousMessage({ type: 'pair:abort', v: 1, reason: 'mismatch' }));
  assert.ok(validateRendezvousMessage({ type: 'pair:abort', v: 1 }));
  for (const m of [
    null,
    { type: 'pair:commit', v: 2, commit: 'A'.repeat(43) },
    { type: 'pair:commit', v: 1, commit: 'A'.repeat(42) },
    { type: 'pair:commit', v: 1, commit: 'A'.repeat(43), extra: 1 },
    { type: 'pair:key', v: 1, jwk: { ...kp.publicJwk, d: 'secret' } },
    { type: 'pair:key', v: 1, jwk: { ...kp.publicJwk, evil: 1 } },
    { type: 'pair:session', v: 1, frame: 'not base64url!' },
    { type: 'pair:session', v: 1, frame: 'A'.repeat(1025) },
    { type: 'pair:abort', v: 1, reason: 'boom' },
    { type: 'color', v: 1 },
  ]) assert.equal(validateRendezvousMessage(m), false, JSON.stringify(m));
});

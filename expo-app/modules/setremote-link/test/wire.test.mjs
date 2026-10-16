// Format sur le fil, version 1 (src/wire.ts, référence du natif) : messages,
// poignée de main, enregistrements Wi-Fi, fragmentation Bluetooth, limites et
// données hostiles (appareils étrangers sur le réseau ou à portée).
//
//   cd expo-app && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import {
  Handshake, LanReader, Reassembler, fragment, lanRecord, encodeHello, decodeHello, authMac, encodeAuth, encodeData,
  encodePing, truncateUtf8, sanitizeName,
  KIND_HELLO, KIND_AUTH, KIND_DATA, KIND_PING, ROLE_REMOTE, ROLE_SCREEN, HELLO_FIXED_BYTES, HELLO_MAX_BYTES, AUTH_BYTES,
  PREAUTH_MAX_MESSAGE, PREAUTH_MAX_BYTES, LAN_MAX_MESSAGE, BLE_MAX_MESSAGE, FRAG_HEADER_BYTES, MAX_FRAGMENTS, MAX_PARTIALS,
  REASSEMBLY_TIMEOUT_MS, MAX_ATT_VALUE, BLE_SERVICE_UUID, BLE_RX_UUID, BLE_TX_UUID, SERVICE_TYPE, MAC_CONTEXT,
} from '../src/wire.ts';
import { roomTag, authKey, MAX_FRAME_BYTES } from '../src/bridge.ts';
import { fromHex, toHex } from '../src/sha256.ts';

const ROOM = 'AbCdEfGhIjKlMnOpQrStUv';
const TAG = fromHex(roomTag(ROOM));
const KEY = fromHex(authKey(ROOM));
const bytes = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

function pair({ remoteKey = KEY, screenKey = KEY, remoteTag = TAG, screenTag = TAG } = {}) {
  const remote = new Handshake({ role: 'remote', roomTag: remoteTag, authKey: remoteKey, nonce: randomBytes(16), name: 'Télécommande' });
  const screen = new Handshake({ role: 'screen', roomTag: screenTag, authKey: screenKey, nonce: randomBytes(16), name: 'Écran 1' });
  return { remote, screen };
}

// ───────────────────────────── constantes ─────────────────────────────

test('constantes du format : tailles, types, identifiants de découverte', () => {
  assert.deepEqual([KIND_HELLO, KIND_AUTH, KIND_DATA, KIND_PING], [1, 2, 3, 4]);
  assert.deepEqual([ROLE_REMOTE, ROLE_SCREEN], [0x52, 0x53]);
  assert.equal(HELLO_FIXED_BYTES, 28);
  assert.equal(HELLO_MAX_BYTES, 156);
  assert.ok(PREAUTH_MAX_MESSAGE >= HELLO_MAX_BYTES && PREAUTH_MAX_MESSAGE >= AUTH_BYTES);
  assert.ok(PREAUTH_MAX_BYTES >= 2 * 4 + HELLO_MAX_BYTES + AUTH_BYTES + 4 + 1);
  assert.equal(LAN_MAX_MESSAGE, 1 + MAX_FRAME_BYTES.lan);
  assert.equal(BLE_MAX_MESSAGE, 1 + MAX_FRAME_BYTES.ble);
  assert.ok(Math.ceil(BLE_MAX_MESSAGE / (20 - FRAG_HEADER_BYTES)) <= MAX_FRAGMENTS, 'un message maximal passe au MTU minimal (23)');
  assert.equal(SERVICE_TYPE, '_setremote._tcp');
  for (const u of [BLE_SERVICE_UUID, BLE_RX_UUID, BLE_TX_UUID]) assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(MAC_CONTEXT, 'SRL1');
});

// ───────────────────────────── messages ─────────────────────────────

test('HELLO : aller-retour, nom tronqué à 128 octets sans couper un caractère, décodage strict', () => {
  const nonce = bytes(16, 7);
  const m = encodeHello({ role: 'screen', roomTag: TAG, nonce, name: 'Écran 2' });
  assert.equal(m.length, HELLO_FIXED_BYTES + Buffer.byteLength('Écran 2'));
  assert.deepEqual([...m.subarray(0, 3)], [KIND_HELLO, 1, ROLE_SCREEN]);
  const h = decodeHello(m);
  assert.deepEqual({ ...h, roomTag: toHex(h.roomTag), nonce: toHex(h.nonce) }, { role: 'screen', roomTag: toHex(TAG), nonce: toHex(nonce), name: 'Écran 2' });
  const long = encodeHello({ role: 'remote', roomTag: TAG, nonce, name: 'é'.repeat(100) });
  assert.equal(long.length, HELLO_MAX_BYTES);
  assert.equal(decodeHello(long).name, 'é'.repeat(64));
  assert.deepEqual([...truncateUtf8(Buffer.from('aé'), 2)], [0x61], 'pas de demi-caractère');
  // Hostile : version, rôle, longueurs incohérentes
  const bad = (f) => { const c = m.slice(); f(c); return decodeHello(c); };
  assert.equal(bad((c) => { c[1] = 2; }), null, 'version inconnue');
  assert.equal(bad((c) => { c[2] = 0x58; }), null, 'rôle inconnu');
  assert.equal(bad((c) => { c[27] = 200; }), null, 'longueur de nom > 128');
  assert.equal(bad((c) => { c[27] = c[27] + 1; }), null, 'longueur de nom incohérente');
  assert.equal(decodeHello(m.subarray(0, 20)), null);
  assert.equal(decodeHello(new Uint8Array(0)), null);
  // Nom hostile : contrôles retirés, UTF-8 invalide remplacé, 64 caractères
  assert.equal(sanitizeName(Buffer.from('a\u0000b\nc\u2028d')), 'abcd');
  assert.equal(sanitizeName(Uint8Array.of(0x61, 0xff, 0x62)), 'a�b');
});

test('AUTH : HMAC-SHA256(authKey, "SRL1" ‖ rôle émetteur ‖ nonce destinataire ‖ nonce émetteur)', () => {
  const rn = bytes(16, 3), sn = bytes(16, 9);
  const expected = createHmac('sha256', Buffer.from(KEY)).update(Buffer.concat([Buffer.from('SRL1'), Buffer.of(ROLE_SCREEN), rn, sn])).digest();
  assert.deepEqual(Buffer.from(authMac(KEY, 'screen', rn, sn)), expected);
  assert.notDeepEqual(Buffer.from(authMac(KEY, 'remote', rn, sn)), expected, 'le rôle entre dans le MAC');
  assert.equal(encodeAuth(expected).length, AUTH_BYTES);
  assert.deepEqual([...encodeData('é')], [KIND_DATA, 0xc3, 0xa9]);
  assert.deepEqual([...encodePing()], [KIND_PING]);
});

// ───────────────────────────── poignée de main ─────────────────────────────

/** Échange complet entre deux machines d'état ; renvoie les événements reçus de chaque côté. */
function run(a, b) {
  const got = { a: [], b: [] };
  const queue = [['b', a.hello()], ['a', b.hello()]];
  while (queue.length) {
    const [to, msg] = queue.shift();
    const ev = (to === 'a' ? a : b).receive(msg);
    got[to].push(ev);
    for (const s of ev.send ?? []) queue.push([to === 'a' ? 'b' : 'a', s]);
  }
  return got;
}

test('poignée de main : les deux côtés s\'admettent mutuellement et échangent leurs noms', () => {
  const { remote, screen } = pair();
  const got = run(remote, screen);
  assert.equal(remote.admitted, true);
  assert.equal(screen.admitted, true);
  assert.deepEqual(got.a.find((e) => e.admitted), { admitted: { name: 'Écran 1' } });
  assert.deepEqual(got.b.find((e) => e.admitted), { admitted: { name: 'Télécommande' } });
  assert.deepEqual(screen.receive(encodeData('trame chiffrée')), { data: 'trame chiffrée' });
  assert.deepEqual(screen.receive(encodePing()), {});
  assert.deepEqual(screen.receive(Uint8Array.of(0x7f, 1, 2)), {}, 'type inconnu après admission : ignoré');
  assert.deepEqual(screen.receive(remote.hello()), { error: 'protocol' }, 'second HELLO');
});

test('poignée de main : appareils étrangers refusés (autre topic, autre clé, même rôle, données trop tôt)', () => {
  const otherTag = fromHex(roomTag('ZZZZZZZZZZZZZZZZZZZZZZ'));
  const otherKey = fromHex(authKey('ZZZZZZZZZZZZZZZZZZZZZZ'));
  // Étiquette différente : refus dès le HELLO
  let p = pair({ screenTag: otherTag });
  assert.deepEqual(p.remote.receive(p.screen.hello()), { error: 'room' });
  // Étiquette copiée depuis le TXT Bonjour, mais clé inconnue : refus à l'AUTH
  p = pair({ screenKey: otherKey });
  const got = run(p.remote, p.screen);
  assert.equal(p.remote.admitted, false);
  assert.equal(p.screen.admitted, false);
  assert.ok(got.a.some((e) => e.error === 'auth') && got.b.some((e) => e.error === 'auth'));
  // Même rôle des deux côtés
  const r2 = new Handshake({ role: 'remote', roomTag: TAG, authKey: KEY, nonce: bytes(16), name: '' });
  assert.deepEqual(pair().remote.receive(r2.hello()), { error: 'role' });
  // Données avant admission, AUTH avant HELLO, AUTH rejoué d'une autre session
  assert.deepEqual(pair().screen.receive(encodeData('x')), { error: 'unauthenticated' });
  assert.deepEqual(pair().screen.receive(encodeAuth(bytes(32))), { error: 'hello' });
  const first = pair();
  const replay = run(first.remote, first.screen); // AUTH de la télécommande capturé sur le réseau
  assert.ok(first.screen.admitted && replay);
  const victim = pair();
  victim.screen.receive(first.remote.hello());
  const capturedAuth = encodeAuth(authMac(KEY, 'remote', bytes(16, 99), bytes(16, 98)));
  assert.deepEqual(victim.screen.receive(capturedAuth), { error: 'auth' }, 'nonce frais par connexion');
  // Réflexion : renvoyer à la télécommande son propre AUTH ne marche pas (rôle dans le MAC)
  const target = pair();
  const evil = new Handshake({ role: 'screen', roomTag: TAG, authKey: bytes(32), nonce: bytes(16, 5), name: '' });
  const authFromRemote = target.remote.receive(evil.hello()).send[0];
  assert.deepEqual(target.remote.receive(authFromRemote), { error: 'auth' });
  // Après une erreur, plus rien n'est accepté
  assert.deepEqual(target.remote.receive(encodeData('x')), { error: 'protocol' });
});

// ───────────────────────────── Wi-Fi : enregistrements ─────────────────────────────

test('enregistrements Wi-Fi : longueur 32 bits gros-boutiste, lecture par morceaux quelconques', () => {
  const msgs = [encodeHello({ role: 'screen', roomTag: TAG, nonce: bytes(16), name: 'É' }), encodeAuth(bytes(32)), encodePing()];
  const stream = Buffer.concat(msgs.map((m) => lanRecord(m)));
  assert.deepEqual([...lanRecord(Uint8Array.of(9))], [0, 0, 0, 1, 9]);
  for (const step of [1, 3, 7, stream.length]) {
    const r = new LanReader();
    const out = [];
    for (let i = 0; i < stream.length; i += step) {
      r.push(stream.subarray(i, i + step));
      for (let x = r.next(); x; x = r.next()) out.push(x.message);
    }
    assert.deepEqual(out.map((m) => toHex(m)), msgs.map((m) => toHex(m)), `pas de ${step}`);
  }
});

test('enregistrements Wi-Fi hostiles : en-tête géant, longueur nulle, déluge avant admission', () => {
  const huge = new LanReader();
  huge.push(Uint8Array.of(0xff, 0xff, 0xff, 0xff));
  assert.deepEqual(huge.next(), { error: 'too-large' }, 'refusé avant d\'attendre 4 Go');
  const zero = new LanReader();
  zero.push(Uint8Array.of(0, 0, 0, 0));
  assert.deepEqual(zero.next(), { error: 'empty' });
  const pre = new LanReader();
  pre.push(lanRecord(bytes(PREAUTH_MAX_MESSAGE + 1)));
  assert.deepEqual(pre.next(), { error: 'too-large' }, 'avant admission : 160 octets au plus');
  const flood = new LanReader();
  for (let i = 0; i < 100; i++) flood.push(lanRecord(encodePing()));
  assert.deepEqual(flood.next(), { error: 'preauth-overflow' }, 'avant admission : 256 octets au plus en tout');
  const ok = new LanReader();
  ok.admitted = true;
  ok.push(lanRecord(bytes(LAN_MAX_MESSAGE)));
  assert.equal(ok.next().message.length, LAN_MAX_MESSAGE);
  ok.push(Uint8Array.of(0, 1, 0, 2));
  assert.deepEqual(ok.next(), { error: 'too-large' }, 'après admission : 65 537 octets au plus');
});

// ───────────────────────────── Bluetooth : fragmentation ─────────────────────────────

test('fragmentation : en-tête [id][index u16][count u16], valeurs ≤ MTU − 3 (≤ 512), aller-retour', () => {
  for (const [len, maxValue] of [[1, 20], [15, 20], [16, 20], [4097, 20], [4097, 182], [4097, 244], [4097, 509], [4097, 600], [65537, 512]]) {
    const msg = bytes(len, len);
    const frags = fragment(msg, 258, maxValue);
    const chunk = Math.min(maxValue, MAX_ATT_VALUE) - FRAG_HEADER_BYTES;
    assert.equal(frags.length, Math.ceil(len / chunk), `${len}/${maxValue}`);
    for (const [i, f] of frags.entries()) {
      assert.ok(f.length <= Math.min(maxValue, MAX_ATT_VALUE));
      assert.deepEqual([...f.subarray(0, 5)], [2, i >> 8, i & 255, frags.length >> 8, frags.length & 255], 'id sur 8 bits');
    }
    const r = new Reassembler(Math.max(len, BLE_MAX_MESSAGE));
    let out = null;
    for (const f of frags) out = r.push(f, 0) ?? out;
    assert.deepEqual(toHex(out.message), toHex(msg));
    assert.equal(r.pending, 0);
  }
  assert.throws(() => fragment(new Uint8Array(0), 0, 20));
  assert.throws(() => fragment(bytes(10), 0, FRAG_HEADER_BYTES));
  assert.throws(() => fragment(bytes(MAX_FRAGMENTS * 15 + 1), 0, 20), 'au-delà de 512 fragments');
});

test('réassemblage : désordre, doublons, messages entrelacés, id réutilisé', () => {
  const a = bytes(100, 1), b = bytes(70, 2);
  const fa = fragment(a, 1, 25), fb = fragment(b, 2, 25);
  const r = new Reassembler(BLE_MAX_MESSAGE);
  const got = [];
  const order = [fa[3], fb[0], fa[0], fa[0], fb[2], fa[4], fa[1], fb[1], fb[3], fa[2]];
  for (const f of order) { const x = r.push(f, 0); if (x?.message) got.push(toHex(x.message)); }
  assert.deepEqual(got.sort(), [toHex(a), toHex(b)].sort());
  assert.equal(r.pending, 0);
  // Doublon tardif (message déjà rendu) : un incomplet orphelin, jeté au délai
  assert.equal(r.push(fb[1], 0), null);
  assert.equal(r.pending, 1);
  r.sweep(REASSEMBLY_TIMEOUT_MS + 1);
  assert.equal(r.pending, 0);
  // Même id, autre nombre de fragments : l'incomplet est remplacé
  const r2 = new Reassembler(BLE_MAX_MESSAGE);
  r2.push(fragment(bytes(60), 5, 25)[0], 0);
  const fresh = fragment(bytes(30, 4), 5, 25);
  let done;
  for (const f of fresh) done = r2.push(f, 0) ?? done;
  assert.deepEqual(toHex(done.message), toHex(bytes(30, 4)));
  assert.equal(r2.dropped, 1);
});

test('réassemblage hostile : en-têtes absurdes, message trop long, délai, plafond de messages incomplets', () => {
  const r = new Reassembler(BLE_MAX_MESSAGE);
  assert.deepEqual(r.push(Uint8Array.of(1, 0, 0, 0), 0), { error: 'short' });
  assert.deepEqual(r.push(Uint8Array.of(1, 0, 0, 0, 0, 9), 0), { error: 'header' }, 'count = 0');
  assert.deepEqual(r.push(Uint8Array.of(1, 0, 3, 0, 3, 9), 0), { error: 'header' }, 'index ≥ count');
  assert.deepEqual(r.push(Uint8Array.of(1, 0, 0, 0x02, 0x01, 9), 0), { error: 'header' }, 'count = 513');
  // Un fragment unique trop long, puis un message qui dépasse en cours de route
  const pre = new Reassembler(PREAUTH_MAX_MESSAGE);
  assert.deepEqual(pre.push(fragment(bytes(PREAUTH_MAX_MESSAGE + 1), 0, 512)[0], 0), { error: 'too-large' });
  const parts = fragment(bytes(400), 3, 100);
  assert.equal(pre.push(parts[0], 0), null);
  assert.deepEqual(pre.push(parts[1], 0), { error: 'too-large' }, 'cumul > 160 octets avant admission');
  assert.equal(pre.pending, 0);
  // Délai : un message incomplet depuis plus de 5 s est jeté
  const slow = new Reassembler(BLE_MAX_MESSAGE);
  const s = fragment(bytes(50), 7, 25);
  slow.push(s[0], 0);
  slow.push(s[1], REASSEMBLY_TIMEOUT_MS + 1);
  assert.equal(slow.dropped, 1, 'le premier fragment a expiré');
  for (const f of s.slice(2)) assert.equal(slow.push(f, REASSEMBLY_TIMEOUT_MS + 2), null, 'message incomplet : rien');
  // Plafond : au plus 4 messages incomplets, le plus ancien est jeté
  const many = new Reassembler(BLE_MAX_MESSAGE);
  for (let id = 0; id < 10; id++) many.push(fragment(bytes(50, id), id, 25)[0], id);
  assert.equal(many.pending, MAX_PARTIALS);
  assert.equal(many.dropped, 10 - MAX_PARTIALS);
  // Déluge aléatoire : jamais d'exception, mémoire bornée
  const fuzz = new Reassembler(BLE_MAX_MESSAGE);
  for (let i = 0; i < 5000; i++) fuzz.push(randomBytes(1 + (i % 40)), i);
  assert.ok(fuzz.pending <= MAX_PARTIALS);
});

test('poignée de main puis données à travers la fragmentation Bluetooth (MTU 23)', () => {
  const { remote, screen } = pair();
  const ids = { r: 0, s: 0 };
  const inbox = { r: new Reassembler(PREAUTH_MAX_MESSAGE), s: new Reassembler(PREAUTH_MAX_MESSAGE) };
  const received = [];
  const deliver = (to, msg) => {
    const hs = to === 's' ? screen : remote;
    for (const f of fragment(msg, ids[to === 's' ? 'r' : 's']++, 20)) {
      const x = inbox[to].push(f, 0);
      if (!x?.message) continue;
      const ev = hs.receive(x.message);
      assert.equal(ev.error, undefined);
      if (ev.admitted) inbox[to].maxMessage = BLE_MAX_MESSAGE;
      if (ev.data) received.push(ev.data);
      for (const m of ev.send ?? []) deliver(to === 's' ? 'r' : 's', m);
    }
  };
  // Seule la télécommande a ouvert le canal : l'écran envoie son HELLO avant son AUTH
  deliver('s', remote.hello());
  assert.ok(remote.admitted && screen.admitted);
  const big = 'A'.repeat(MAX_FRAME_BYTES.ble);
  deliver('s', encodeData(big));
  assert.deepEqual(received, [big]);
});

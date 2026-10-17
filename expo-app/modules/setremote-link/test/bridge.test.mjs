// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Pont des liaisons hors ligne (src/bridge.ts) : validation des messages de la
// page, dérivations du topic (roomTag, authKey), SHA-256 / HMAC en TS pur,
// plafonds de taille, relevé par lots, relais des événements natifs.
//
//   cd expo-app && npm test        (Node ≥ 22.18 : TypeScript sans transpilation)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import vm from 'node:vm';
import {
  parseCommand, isBridgeCommand, parseName, roomTag, authKey, nativeScript, cleanPeers, cleanState, cleanFrames,
  createLinkBridge, ERROR_REASONS, MAX_FRAME_BYTES, MAX_SEND_FRAMES, MAX_TO_PEERS, FLUSH_MS, MAX_BATCH_FRAMES,
  MAX_BATCH_BYTES, AUTH_KEY_CONTEXT, UNAVAILABLE_STATE,
} from '../src/bridge.ts';
import { sha256, hmacSha256, utf8Encode, utf8Length, toHex, fromHex } from '../src/sha256.ts';

const ROOM = 'AbCdEfGhIjKlMnOpQrStUv'; // 22 caractères base64url (128 bits)
const room = () => randomBytes(16).toString('base64url');

// ───────────────────────────── SHA-256, HMAC, UTF-8 ─────────────────────────────

test('sha256 et hmacSha256 : identiques à node:crypto (vecteurs FIPS et tailles aléatoires)', () => {
  assert.equal(toHex(sha256(new Uint8Array(0))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(toHex(sha256(utf8Encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, 4097]) {
    const data = randomBytes(n);
    assert.equal(toHex(sha256(data)), createHash('sha256').update(data).digest('hex'), `sha256 ${n} octets`);
  }
  for (const [k, d] of [[32, 0], [32, 70], [64, 33], [65, 10], [200, 500]]) {
    const key = randomBytes(k), data = randomBytes(d);
    assert.equal(toHex(hmacSha256(key, data)), createHmac('sha256', key).update(data).digest('hex'), `hmac clé ${k}`);
  }
});

test('utf8Encode / utf8Length : identiques à Buffer, paires de substitution, arrêt anticipé', () => {
  for (const s of ['', 'abc', 'Écran 3 — plateau', '🎬 caméra', 'a\u{1F600}b', 'x'.repeat(1000)]) {
    assert.deepEqual(Buffer.from(utf8Encode(s)), Buffer.from(s, 'utf8'), s);
    assert.equal(utf8Length(s), Buffer.byteLength(s, 'utf8'), s);
  }
  // Moitié de paire isolée : U+FFFD (3 octets), comme le natif
  assert.equal(utf8Length('\ud800'), 3);
  assert.deepEqual([...utf8Encode('\ud800')], [0xef, 0xbf, 0xbd]);
  assert.equal(utf8Length('é'.repeat(100), 50), 51, 's\'arrête au-delà de la limite');
  assert.equal(utf8Length('a'.repeat(100), 50), 51, 'longueur UTF-16 déjà trop grande');
  assert.deepEqual(fromHex('00ff10'), Uint8Array.of(0, 255, 16));
});

// ───────────────────────────── roomTag, authKey ─────────────────────────────

test('roomTag = 8 premiers octets de SHA-256(room) en hexadécimal ; authKey séparée par un contexte', () => {
  for (const r of [ROOM, room(), room()]) {
    const full = createHash('sha256').update(r, 'utf8').digest('hex');
    assert.equal(roomTag(r), full.slice(0, 16));
    assert.match(roomTag(r), /^[0-9a-f]{16}$/);
    assert.equal(authKey(r), createHash('sha256').update(AUTH_KEY_CONTEXT + r, 'utf8').digest('hex'));
    assert.match(authKey(r), /^[0-9a-f]{64}$/);
    assert.ok(!full.startsWith(authKey(r).slice(0, 16)), 'clé et étiquette indépendantes');
  }
  assert.equal(AUTH_KEY_CONTEXT, 'setremote-link/v1/auth:');
  // Vecteur figé (repris dans docs/OFFLINE-NATIVE.md et par le Kotlin)
  assert.equal(roomTag(ROOM), createHash('sha256').update(ROOM).digest('hex').slice(0, 16));
});

// ───────────────────────────── validation ─────────────────────────────

test('messages étrangers au pont : null (DMX, luminosité, valeurs quelconques)', () => {
  for (const m of [null, undefined, 42, 'link:start', [], {}, { type: 'dmx:listen' }, { type: 'brightness', value: 1 },
    { type: 'LINK:START' }, { type: 'link:frames' }, { type: 'link:peers' }, { type: 'link:state' }, { type: 'link:error' }]) {
    assert.equal(parseCommand(m), null, JSON.stringify(m));
    assert.equal(isBridgeCommand(m), false);
  }
});

test('link:start : normalisé (modes sans doublon, nom rogné), champs validés', () => {
  assert.deepEqual(parseCommand({ type: 'link:start', modes: ['lan', 'ble', 'lan'], role: 'remote', room: ROOM, name: '  Écran 2 ' }),
    { ok: true, command: { type: 'link:start', modes: ['lan', 'ble'], role: 'remote', room: ROOM, name: 'Écran 2' } });
  assert.deepEqual(parseCommand({ type: 'link:start', modes: ['ble'], role: 'screen', room: ROOM }).command.name, '');
  const bad = (m) => parseCommand({ type: 'link:start', modes: ['lan'], role: 'remote', room: ROOM, ...m });
  for (const modes of [undefined, [], ['wifi'], 'lan', [null], ['lan', 'bt'], {}]) {
    assert.deepEqual(bad({ modes }), { ok: false, reason: 'invalid-modes' }, JSON.stringify(modes));
  }
  for (const role of [undefined, 'Remote', 'central', 1]) assert.deepEqual(bad({ role }), { ok: false, reason: 'invalid-role' });
  for (const r of [undefined, '', ROOM.slice(1), ROOM + 'x', ROOM.replace('A', '+'), ROOM.replace('A', '='), 42, `${ROOM.slice(0, 21)}/`]) {
    assert.deepEqual(bad({ room: r }), { ok: false, reason: 'invalid-room' }, String(r));
  }
  for (const name of [42, {}, 'x'.repeat(65), 'a\nb', 'tab\there', '\u0085', 'a\u2028b', '😀'.repeat(33)]) {
    assert.deepEqual(bad({ name }), { ok: false, reason: 'invalid-name' }, JSON.stringify(name));
  }
  assert.equal(bad({ name: 'x'.repeat(64) }).ok, true);
  assert.equal(bad({ name: 'é'.repeat(64) }).ok, true, '128 octets');
  assert.equal(bad({ name: null }).ok, true);
  assert.equal(parseName('😀'.repeat(32)), '😀'.repeat(32), '32 émojis = 64 unités UTF-16 = 128 octets');
});

test('link:stop : modes facultatifs (absents = tous), validés sinon', () => {
  assert.deepEqual(parseCommand({ type: 'link:stop' }), { ok: true, command: { type: 'link:stop', modes: ['lan', 'ble'] } });
  assert.deepEqual(parseCommand({ type: 'link:stop', modes: ['ble'] }), { ok: true, command: { type: 'link:stop', modes: ['ble'] } });
  assert.deepEqual(parseCommand({ type: 'link:stop', modes: [] }), { ok: false, reason: 'invalid-modes' });
  assert.deepEqual(parseCommand({ type: 'link:stop', modes: ['usb'] }), { ok: false, reason: 'invalid-modes' });
});

test('link:send : 1 à 256 chaînes non vides, `to` : 1 à 64 identifiants de pair', () => {
  assert.deepEqual(parseCommand({ type: 'link:send', frames: ['a', 'b'] }),
    { ok: true, command: { type: 'link:send', frames: ['a', 'b'], to: null } });
  assert.deepEqual(parseCommand({ type: 'link:send', frames: ['a'], to: ['l-0a1b2c3d4e5f', 'l-0a1b2c3d4e5f', 'b-x'] }).command.to,
    ['l-0a1b2c3d4e5f', 'b-x']);
  const bad = (m) => parseCommand({ type: 'link:send', frames: ['f'], ...m });
  for (const frames of [undefined, [], 'f', [''], [42], [null], ['ok', {}], Array(MAX_SEND_FRAMES + 1).fill('f')]) {
    assert.deepEqual(bad({ frames }), { ok: false, reason: 'invalid-frames' }, String(frames).slice(0, 30));
  }
  assert.equal(bad({ frames: Array(MAX_SEND_FRAMES).fill('f') }).ok, true);
  for (const to of [[], 'l-1', [''], ['a b'], ['x'.repeat(65)], [7], Array(MAX_TO_PEERS + 1).fill(0).map((_, i) => `p${i}`)]) {
    assert.deepEqual(bad({ to }), { ok: false, reason: 'invalid-peers' }, JSON.stringify(to).slice(0, 30));
  }
  assert.equal(bad({ to: null }).ok, true);
  assert.equal(MAX_SEND_FRAMES, 256);
  assert.equal(MAX_TO_PEERS, 64);
});

test('plafonds : 64 Kio par trame en Wi-Fi, 4 Kio en Bluetooth', () => {
  assert.equal(MAX_FRAME_BYTES.lan, 65536);
  assert.equal(MAX_FRAME_BYTES.ble, 4096);
  assert.equal(FLUSH_MS, 20);
  assert.equal(MAX_BATCH_FRAMES, 256);
  assert.equal(MAX_BATCH_BYTES, 1 << 20);
});

// ───────────────────────────── script injecté ─────────────────────────────

function runInPage(scripts, { withReceiver = true } = {}) {
  const received = [];
  const window = withReceiver ? { SRNative: { receive: (m) => received.push(JSON.parse(JSON.stringify(m))) } } : {};
  for (const s of scripts) assert.equal(vm.runInNewContext(s, { window }), true, 'le script se termine par true');
  return received;
}

test('nativeScript : forme du contrat, U+2028/2029 échappés, page sans SRNative sans effet', () => {
  const msg = { type: 'link:error', mode: 'ble', reason: 'powered-off' };
  assert.equal(nativeScript(msg), 'window.SRNative&&window.SRNative.receive({"type":"link:error","mode":"ble","reason":"powered-off"});true;');
  const odd = { type: 'link:frames', frames: [{ peer: 'l-1', mode: 'lan', data: `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}"</script>` }] };
  const s = nativeScript(odd);
  assert.ok(!s.includes(String.fromCharCode(0x2028)) && !s.includes(String.fromCharCode(0x2029)));
  assert.deepEqual(runInPage([s]), [odd]);
  assert.deepEqual(runInPage([s], { withReceiver: false }), []);
});

test('nettoyage de ce qui vient du natif : pairs, état, trames', () => {
  assert.deepEqual(cleanPeers([
    { peer: 'l-1', mode: 'lan', name: ' Écran 1\n' },
    { peer: 'l-1', mode: 'lan' }, // doublon
    { peer: 'b-2', mode: 'ble', name: '' },
    { peer: 'bad id', mode: 'lan' },
    { peer: 'x', mode: 'wifi' },
    null,
  ]), [{ peer: 'l-1', mode: 'lan', name: 'Écran 1' }, { peer: 'b-2', mode: 'ble' }]);
  assert.deepEqual(cleanPeers('x'), []);
  assert.deepEqual(cleanState({ lan: { available: true, active: 1, error: 'no-network' }, ble: { available: false, active: false, error: 'Bad Reason!' } }),
    { lan: { available: true, active: false, error: 'no-network' }, ble: { available: false, active: false } });
  assert.deepEqual(cleanState(null), { lan: { available: false, active: false }, ble: { available: false, active: false } });
  assert.deepEqual(cleanFrames([{ peer: 'l-1', mode: 'lan', data: 'x' }, { peer: 'l-1', mode: 'lan', data: '' }, { peer: 1, mode: 'lan', data: 'x' }, 'z']),
    [{ peer: 'l-1', mode: 'lan', data: 'x' }]);
});

// ───────────────────────────── le pont ─────────────────────────────

const EVENTS = ['onSetRemoteLinkPeers', 'onSetRemoteLinkState', 'onSetRemoteLinkError'];

function fakeNative({ state } = {}) {
  const calls = [];
  const listeners = Object.fromEntries(EVENTS.map((e) => [e, new Set()]));
  let queue = [];
  return {
    calls,
    listeners,
    enqueue: (...frames) => { queue.push(...frames); },
    emit: (event, payload) => { for (const fn of listeners[event]) fn(payload); },
    start(...args) { calls.push(['start', ...args]); if (this.throwOnStart) throw new Error('boom'); },
    stop(modes) { calls.push(['stop', modes]); },
    send(frames, to) { calls.push(['send', frames, to]); },
    // Comme le natif : au plus maxFrames / maxBytes, dans l'ordre ; le reste attend.
    drain(maxFrames, maxBytes) {
      calls.push(['drain', maxFrames, maxBytes]);
      const out = [];
      let bytes = 0;
      while (queue.length && out.length < maxFrames && (out.length === 0 || bytes + queue[0].data.length <= maxBytes)) {
        bytes += queue[0].data.length;
        out.push(queue.shift());
      }
      return out;
    },
    getState() { calls.push(['getState']); return state ?? { lan: { available: true, active: true }, ble: { available: false, active: false, error: 'powered-off' } }; },
    addListener(event, fn) {
      listeners[event].add(fn);
      return { remove: () => listeners[event].delete(fn) };
    },
  };
}

function fakeTimers() {
  const timers = new Map();
  let next = 0;
  return {
    timers,
    setInterval: (fn, ms) => { timers.set(++next, { fn, ms }); return next; },
    clearInterval: (id) => { timers.delete(id); },
    tick() { for (const t of [...timers.values()]) t.fn(); },
  };
}

function setup(opts = {}) {
  const native = 'native' in opts ? opts.native : fakeNative(opts);
  const clock = fakeTimers();
  const scripts = [];
  const bridge = createLinkBridge({
    native, inject: (s) => scripts.push(s), setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    ...(opts.maxBatchFrames ? { maxBatchFrames: opts.maxBatchFrames } : {}),
    ...(opts.maxBatchBytes ? { maxBatchBytes: opts.maxBatchBytes } : {}),
  });
  const page = () => runInPage(scripts.splice(0));
  return { native, clock, bridge, page };
}

const start = (extra = {}) => ({ type: 'link:start', modes: ['lan', 'ble'], role: 'remote', room: ROOM, name: 'Télécommande', ...extra });
const frame = (i, peer = 'l-1', mode = 'lan') => ({ peer, mode, data: `frame-${i}` });

test('handle : false pour ce qui ne relève pas du pont, rien vers le natif', () => {
  const { bridge, native, page } = setup();
  assert.equal(bridge.handle({ type: 'dmx:listen', protocol: 'sacn' }), false);
  assert.equal(bridge.handle(null), false);
  assert.deepEqual(native.calls, []);
  assert.deepEqual(page(), []);
});

test('link:start : seuls roomTag et authKey partent au natif (jamais le topic), relevé toutes les 20 ms', () => {
  const { bridge, native, clock, page } = setup();
  assert.equal(bridge.handle(start()), true);
  assert.deepEqual(native.calls, [['start', ['lan', 'ble'], 'remote', roomTag(ROOM), authKey(ROOM), 'Télécommande']]);
  assert.ok(!JSON.stringify(native.calls).includes(ROOM), 'le topic ne quitte pas le pont');
  assert.deepEqual(bridge.activeModes, ['lan', 'ble']);
  assert.equal(bridge.pumping, true);
  assert.deepEqual([...clock.timers.values()].map((t) => t.ms), [FLUSH_MS]);
  clock.tick();
  assert.deepEqual(page(), [], 'file vide : pas de link:frames');
  native.enqueue(frame(0), frame(1, 'b-2', 'ble'));
  clock.tick();
  assert.deepEqual(page(), [{ type: 'link:frames', frames: [frame(0), frame(1, 'b-2', 'ble')] }]);
  assert.deepEqual(native.calls.filter((c) => c[0] === 'drain')[0], ['drain', MAX_BATCH_FRAMES, MAX_BATCH_BYTES]);
  // Un second link:start remplace sans doubler le minuteur
  bridge.handle(start({ modes: ['ble'], role: 'screen' }));
  assert.equal(clock.timers.size, 1);
  assert.deepEqual(bridge.activeModes, ['ble']);
});

test('lots bornés en nombre et en octets ; le reste attend le relevé suivant (rien n\'est perdu ici)', () => {
  const { bridge, native, clock, page } = setup({ maxBatchFrames: 3, maxBatchBytes: 1000 });
  bridge.handle(start());
  native.enqueue(...Array.from({ length: 5 }, (_, i) => frame(i)));
  clock.tick();
  assert.deepEqual(page()[0].frames.map((f) => f.data), ['frame-0', 'frame-1', 'frame-2']);
  clock.tick();
  assert.deepEqual(page()[0].frames.map((f) => f.data), ['frame-3', 'frame-4']);
  // Garde-fou si le natif rendait plus que demandé : les plus récentes
  native.drain = () => Array.from({ length: 6 }, (_, i) => frame(i));
  bridge.flush();
  assert.deepEqual(page()[0].frames.map((f) => f.data), ['frame-3', 'frame-4', 'frame-5']);
});

test('link:send : transmis tel quel ; `to` absent = tous les pairs ([] côté natif)', () => {
  const { bridge, native, page } = setup();
  bridge.handle(start());
  bridge.handle({ type: 'link:send', frames: ['a', 'b'] });
  bridge.handle({ type: 'link:send', frames: ['c'], to: ['lan-0a1b2c3d4e5f'] });
  assert.deepEqual(native.calls.slice(1), [['send', ['a', 'b'], []], ['send', ['c'], ['lan-0a1b2c3d4e5f']]]);
  assert.deepEqual(page(), []);
});

test('écran : `to` honoré aussi (trame réservée au Wi-Fi local), même routage que la télécommande', () => {
  const { bridge, native } = setup();
  bridge.handle(start({ role: 'screen', name: undefined }));
  const caps = 'c'.repeat(MAX_FRAME_BYTES.ble + 500); // trop grand pour le Bluetooth
  bridge.handle({ type: 'link:send', frames: [caps], to: ['lan-7e57c0ffee00'] });
  bridge.handle({ type: 'link:send', frames: ['vie'] });
  assert.deepEqual(native.calls[0].slice(0, 3), ['start', ['lan', 'ble'], 'screen']);
  assert.deepEqual(native.calls.slice(1), [['send', [caps], ['lan-7e57c0ffee00']], ['send', ['vie'], []]]);
});

test('link:send : trame de plus de 64 Kio refusée ici (too-large pour chaque liaison active), les autres partent', () => {
  const { bridge, native, page } = setup();
  bridge.handle(start());
  const max = 'x'.repeat(MAX_FRAME_BYTES.lan);
  const over = 'x'.repeat(MAX_FRAME_BYTES.lan + 1);
  const overUtf8 = 'é'.repeat(MAX_FRAME_BYTES.lan / 2 + 1); // 32 769 caractères, 65 538 octets
  bridge.handle({ type: 'link:send', frames: [max, over, 'ok', overUtf8] });
  assert.deepEqual(native.calls.slice(1).map((c) => [c[0], c[1].map((f) => f.length)]), [['send', [MAX_FRAME_BYTES.lan, 2]]]);
  assert.deepEqual(page(), [
    { type: 'link:error', mode: 'lan', reason: 'too-large' },
    { type: 'link:error', mode: 'ble', reason: 'too-large' },
  ]);
  // Entre 4 et 64 Kio : c'est le natif qui refuse, pour les seuls pairs Bluetooth
  bridge.handle({ type: 'link:send', frames: ['y'.repeat(MAX_FRAME_BYTES.ble + 1)] });
  assert.equal(native.calls.at(-1)[1][0].length, MAX_FRAME_BYTES.ble + 1);
  // Tout refusé : rien n'est envoyé au natif
  const before = native.calls.length;
  bridge.handle({ type: 'link:send', frames: [over] });
  assert.equal(native.calls.length, before);
});

test('link:send sans liaison démarrée : not-started ; message invalide : link:error, rien vers le natif', () => {
  const { bridge, native, page } = setup();
  bridge.handle({ type: 'link:send', frames: ['a'] });
  bridge.handle({ type: 'link:start', modes: ['lan'], role: 'remote', room: 'short' });
  bridge.handle({ type: 'link:send', frames: [] });
  assert.deepEqual(native.calls, []);
  assert.deepEqual(page(), [
    { type: 'link:error', mode: null, reason: 'not-started' },
    { type: 'link:error', mode: null, reason: 'invalid-room' },
    { type: 'link:error', mode: null, reason: 'invalid-frames' },
  ]);
});

test('événements natifs : link:peers (trames en attente d\'abord), link:state, link:error', () => {
  const { bridge, native, page } = setup();
  bridge.handle(start());
  native.enqueue(frame(0));
  native.emit('onSetRemoteLinkPeers', { peers: [{ peer: 'l-1', mode: 'lan', name: 'Écran 1' }] });
  native.emit('onSetRemoteLinkState', { lan: { available: true, active: true }, ble: { available: true, active: false, error: 'unauthorized' } });
  native.emit('onSetRemoteLinkError', { mode: 'ble', reason: 'unauthorized' });
  native.emit('onSetRemoteLinkError', { mode: 'usb', reason: 'Bizarre <b>' });
  assert.deepEqual(page(), [
    { type: 'link:frames', frames: [frame(0)] },
    { type: 'link:peers', peers: [{ peer: 'l-1', mode: 'lan', name: 'Écran 1' }] },
    { type: 'link:state', lan: { available: true, active: true }, ble: { available: true, active: false, error: 'unauthorized' } },
    { type: 'link:error', mode: 'ble', reason: 'unauthorized' },
    { type: 'link:error', mode: null, reason: 'link-failed' },
  ]);
});

test('link:state? : état courant du natif', () => {
  const { bridge, page } = setup();
  bridge.handle({ type: 'link:state?' });
  assert.deepEqual(page(), [{ type: 'link:state', lan: { available: true, active: true }, ble: { available: false, active: false, error: 'powered-off' } }]);
});

test('link:stop : partiel puis total ; le relevé s\'arrête quand plus rien n\'est demandé', () => {
  const { bridge, native } = setup();
  bridge.handle(start());
  bridge.handle({ type: 'link:stop', modes: ['ble'] });
  assert.equal(bridge.pumping, true);
  assert.deepEqual(bridge.activeModes, ['lan']);
  bridge.handle({ type: 'link:stop' });
  assert.equal(bridge.pumping, false);
  assert.deepEqual(native.calls.filter((c) => c[0] === 'stop'), [['stop', ['ble']], ['stop', ['lan', 'ble']]]);
});

test('reset (nouvelle page) : arrête les liaisons en cours, ne fait rien sinon', () => {
  const idle = setup();
  idle.bridge.reset();
  assert.deepEqual(idle.native.calls, []);
  const busy = setup();
  busy.bridge.handle(start());
  busy.bridge.reset();
  assert.deepEqual(busy.native.calls.map((c) => c[0]), ['start', 'stop']);
  assert.deepEqual(busy.native.calls[1], ['stop', ['lan', 'ble']]);
  assert.equal(busy.bridge.pumping, false);
  assert.deepEqual(busy.bridge.activeModes, []);
});

test('échec inattendu du natif au démarrage : start-failed par liaison, relevé arrêté', () => {
  const native = fakeNative();
  native.throwOnStart = true;
  const { bridge, page } = setup({ native });
  bridge.handle(start({ modes: ['lan'] }));
  assert.equal(bridge.pumping, false);
  assert.deepEqual(page(), [
    { type: 'link:error', mode: 'lan', reason: 'start-failed' },
    { type: 'link:peers', peers: [] },
  ]);
});

test('binaire sans module natif : native-unavailable, état indisponible', () => {
  const { bridge, page } = setup({ native: null });
  assert.equal(bridge.handle(start()), true);
  assert.equal(bridge.handle({ type: 'link:send', frames: ['a'] }), true);
  assert.equal(bridge.handle({ type: 'link:state?' }), true);
  assert.equal(bridge.handle({ type: 'link:stop' }), true);
  assert.equal(bridge.pumping, false);
  assert.deepEqual(page(), [
    { type: 'link:error', mode: 'lan', reason: 'native-unavailable' },
    { type: 'link:error', mode: 'ble', reason: 'native-unavailable' },
    { type: 'link:state', ...UNAVAILABLE_STATE },
    { type: 'link:peers', peers: [] },
    { type: 'link:error', mode: null, reason: 'native-unavailable' },
    { type: 'link:state', ...UNAVAILABLE_STATE },
  ]);
});

test('dispose : liaisons arrêtées, abonnements retirés, plus rien vers la page', () => {
  const { bridge, native, page } = setup();
  bridge.handle(start());
  bridge.dispose();
  for (const e of EVENTS) assert.equal(native.listeners[e].size, 0, e);
  assert.equal(bridge.handle({ type: 'link:state?' }), true);
  assert.deepEqual(native.calls.map((c) => c[0]), ['start', 'stop']);
  assert.deepEqual(page(), []);
});

test('raisons d\'erreur : liste documentée, sans doublon, au format [a-z0-9-]', () => {
  assert.equal(new Set(ERROR_REASONS).size, ERROR_REASONS.length);
  for (const r of ERROR_REASONS) assert.match(r, /^[a-z0-9-]{1,40}$/);
});

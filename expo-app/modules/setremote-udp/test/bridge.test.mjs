// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Pont DMX WebView ↔ natif (src/bridge.ts) : validation des messages de la
// page, regroupement des datagrammes, format des scripts injectés, et
// cohérence des noms et limites entre TypeScript, Swift et Kotlin.
//
//   cd expo-app && npm test        (Node ≥ 22.18 : TypeScript sans transpilation)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  parseCommand, isBridgeCommand, isIPv4, base64DecodedLength, sacnMulticastGroup, nativeScript,
  cleanInterfaces, createDmxBridge, ERROR_REASONS, FATAL_REASONS,
  MAX_BATCH, MAX_DATAGRAM, MAX_UNIVERSES, FLUSH_MS,
} from '../src/bridge.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const moduleDir = path.join(here, '..');
const read = (p) => readFileSync(path.join(moduleDir, p), 'utf8');
const b64 = (n) => Buffer.alloc(n, 0xab).toString('base64');

// ───────────────────────────── validation ─────────────────────────────

test('messages étrangers au pont : null (luminosité, valeurs quelconques)', () => {
  for (const m of [null, undefined, 42, 'dmx:listen', [], {}, { type: 'brightness', value: 0.5 },
    { type: 'brightness-restore' }, { type: 'dmx:look' }, { type: 'DMX:LISTEN' }]) {
    assert.equal(parseCommand(m), null, JSON.stringify(m));
    assert.equal(isBridgeCommand(m), false);
  }
});

test('dmx:listen sACN : normalisé, doublons retirés, multicast strictement booléen', () => {
  assert.deepEqual(parseCommand({ type: 'dmx:listen', protocol: 'sacn', universes: [1, 2, 1, 64214], multicast: true }),
    { ok: true, command: { type: 'dmx:listen', protocol: 'sacn', universes: [1, 2, 64214], multicast: true } });
  assert.deepEqual(parseCommand({ type: 'dmx:listen', protocol: 'sacn', universes: [7], multicast: 'yes' }).command.multicast, false);
  assert.deepEqual(parseCommand({ type: 'dmx:listen', protocol: 'artnet' }),
    { ok: true, command: { type: 'dmx:listen', protocol: 'artnet', universes: [], multicast: false } });
});

test('dmx:listen : protocole et univers validés (au plus 64, plages sACN / Art-Net)', () => {
  const bad = (m) => parseCommand({ type: 'dmx:listen', multicast: false, ...m });
  assert.deepEqual(bad({ protocol: 'kinet', universes: [1] }), { ok: false, reason: 'invalid-protocol' });
  assert.deepEqual(bad({ universes: [1] }), { ok: false, reason: 'invalid-protocol' });
  for (const universes of [[0], [64000], [63999.5], ['1'], [null], [-1], 'all', { 0: 1 }]) {
    assert.deepEqual(bad({ protocol: 'sacn', universes }), { ok: false, reason: 'invalid-universes' }, JSON.stringify(universes));
  }
  assert.equal(bad({ protocol: 'sacn', universes: [1, 63999, 64214] }).ok, true);
  assert.equal(bad({ protocol: 'artnet', universes: [0, 32767] }).ok, true);
  assert.deepEqual(bad({ protocol: 'artnet', universes: [32768] }), { ok: false, reason: 'invalid-universes' });
  const many = Array.from({ length: MAX_UNIVERSES }, (_, i) => i + 1);
  assert.equal(MAX_UNIVERSES, 64);
  assert.equal(bad({ protocol: 'sacn', universes: many }).ok, true);
  assert.deepEqual(bad({ protocol: 'sacn', universes: [...many, 65] }), { ok: false, reason: 'invalid-universes' });
});

test('udp:send : IPv4 littérale, port 1–65535, données base64 de 1 à 1500 octets', () => {
  const send = (m) => parseCommand({ type: 'udp:send', host: '10.0.0.5', port: 6454, data: b64(239), ...m });
  assert.deepEqual(send({}), { ok: true, command: { type: 'udp:send', host: '10.0.0.5', port: 6454, data: b64(239) } });
  for (const host of ['localhost', 'console.local', '10.0.0', '10.0.0.5.1', '256.1.1.1', '01.2.3.4', '0.0.0.0', ' 10.0.0.5', '::1', 10]) {
    assert.deepEqual(send({ host }), { ok: false, reason: 'invalid-host' }, String(host));
  }
  assert.equal(send({ host: '255.255.255.255' }).ok, true, 'broadcast admis (natif : entitlement iOS)');
  for (const port of [0, 65536, 6454.5, '6454', -1, null]) {
    assert.deepEqual(send({ port }), { ok: false, reason: 'invalid-port' }, String(port));
  }
  assert.equal(send({ port: 1 }).ok, true);
  assert.equal(send({ port: 65535 }).ok, true);
  for (const data of ['', 'abc', 'ab!=', '====', 'QQ', b64(MAX_DATAGRAM + 1), 12, null]) {
    assert.deepEqual(send({ data }), { ok: false, reason: 'invalid-data' }, String(data).slice(0, 20));
  }
  assert.equal(send({ data: b64(1) }).ok, true);
  assert.equal(send({ data: b64(MAX_DATAGRAM) }).ok, true);
});

test('outils : IPv4, taille base64, groupes multicast sACN', () => {
  assert.equal(isIPv4('192.168.1.20'), true);
  assert.equal(isIPv4('192.168.001.20'), false);
  assert.equal(base64DecodedLength(b64(1)), 1);
  assert.equal(base64DecodedLength(b64(2)), 2);
  assert.equal(base64DecodedLength(b64(3)), 3);
  assert.equal(base64DecodedLength(b64(1500)), 1500);
  assert.equal(base64DecodedLength('QUJD'), 3);
  assert.equal(base64DecodedLength('QUJD\n'), -1);
  assert.equal(sacnMulticastGroup(1), '239.255.0.1');
  assert.equal(sacnMulticastGroup(256), '239.255.1.0');
  assert.equal(sacnMulticastGroup(63999), '239.255.249.255');
  assert.equal(sacnMulticastGroup(64214), '239.255.250.214', 'univers de découverte E1.31');
});

test('cleanInterfaces : IPv4 bien formées, type ramené à ethernet | wifi | other', () => {
  assert.deepEqual(cleanInterfaces([
    { name: 'en0', kind: 'wifi', ip: '192.168.1.20', mask: '255.255.255.0' },
    { name: 'en5', kind: 'ethernet', ip: '2.0.0.10', mask: '255.0.0.0' },
    { name: 'pdp_ip0', kind: 'cellular', ip: '10.1.2.3', mask: '255.255.255.255' },
    { name: 'bad', kind: 'wifi', ip: 'fe80::1', mask: '' },
    null,
  ]), [
    { name: 'en0', kind: 'wifi', ip: '192.168.1.20', mask: '255.255.255.0' },
    { name: 'en5', kind: 'ethernet', ip: '2.0.0.10', mask: '255.0.0.0' },
    { name: 'pdp_ip0', kind: 'other', ip: '10.1.2.3', mask: '255.255.255.255' },
  ]);
  assert.deepEqual(cleanInterfaces('x'), []);
});

// ───────────────────────────── script injecté ─────────────────────────────

/** Exécute les scripts injectés comme le ferait la page, avec ou sans SRNative. */
function runInPage(scripts, { withReceiver = true } = {}) {
  const received = [];
  // JSON aller-retour : objets du contexte vm → objets de ce contexte (comparables)
  const window = withReceiver ? { SRNative: { receive: (m) => received.push(JSON.parse(JSON.stringify(m))) } } : {};
  for (const s of scripts) assert.equal(vm.runInNewContext(s, { window }), true, 'le script se termine par true');
  return received;
}

test('nativeScript : forme du contrat, JSON intact, U+2028/2029 échappés', () => {
  const msg = { type: 'dmx:error', reason: 'bind-failed' };
  assert.equal(nativeScript(msg), 'window.SRNative&&window.SRNative.receive({"type":"dmx:error","reason":"bind-failed"});true;');
  const odd = { type: 'net:info', interfaces: [{ name: `a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}`, kind: 'other', ip: '1.2.3.4', mask: '255.0.0.0' }] };
  const s = nativeScript(odd);
  assert.ok(!s.includes(String.fromCharCode(0x2028)) && !s.includes(String.fromCharCode(0x2029)));
  assert.deepEqual(runInPage([s]), [odd]);
  assert.deepEqual(runInPage([s], { withReceiver: false }), [], 'page sans SRNative : sans effet, sans erreur');
});

// ───────────────────────────── le pont ─────────────────────────────

function fakeNative({ interfaces = [] } = {}) {
  const calls = [];
  const listeners = { onSetRemoteUdpError: new Set(), onSetRemoteUdpNetwork: new Set() };
  let queue = [];
  return {
    calls,
    listeners,
    enqueue: (...packets) => { queue.push(...packets); },
    emit: (event, payload) => { for (const fn of listeners[event]) fn(payload); },
    listenResult: Promise.resolve(),
    listen(...args) { calls.push(['listen', ...args]); return this.listenResult; },
    stop: async () => { calls.push(['stop']); },
    send: async (...args) => { calls.push(['send', ...args]); },
    // Comme le natif : au plus `max`, les plus récents.
    drain(max) {
      calls.push(['drain', max]);
      const out = queue.slice(-max);
      queue = [];
      return out;
    },
    getNetworkInfo: async () => interfaces,
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
  const bridge = createDmxBridge({
    native, inject: (s) => scripts.push(s), setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    ...(opts.maxBatch ? { maxBatch: opts.maxBatch } : {}),
  });
  const page = () => runInPage(scripts.splice(0));
  return { native, clock, bridge, page };
}

const settle = () => new Promise((r) => setImmediate(r));
const pkt = (i) => ({ src: '10.0.0.1', port: 5568, data: b64(10 + (i % 5)) });

test('handle : false pour les messages qui ne relèvent pas du pont', () => {
  const { bridge, native, page } = setup();
  assert.equal(bridge.handle({ type: 'brightness', value: 1 }), false);
  assert.equal(bridge.handle(null), false);
  assert.deepEqual(native.calls, []);
  assert.deepEqual(page(), []);
});

test('message invalide : dmx:error à la page, rien vers le natif', () => {
  const { bridge, native, page } = setup();
  assert.equal(bridge.handle({ type: 'udp:send', host: 'console.local', port: 6454, data: b64(10) }), true);
  assert.equal(bridge.handle({ type: 'dmx:listen', protocol: 'sacn', universes: [70000], multicast: false }), true);
  assert.deepEqual(native.calls, []);
  assert.deepEqual(page(), [{ type: 'dmx:error', reason: 'invalid-host' }, { type: 'dmx:error', reason: 'invalid-universes' }]);
});

test('dmx:listen : natif appelé, file relevée toutes les 20 ms, aucun lot vide', () => {
  const { bridge, native, clock, page } = setup();
  bridge.handle({ type: 'dmx:listen', protocol: 'sacn', universes: [1, 2], multicast: true });
  assert.deepEqual(native.calls, [['listen', 'sacn', [1, 2], true]]);
  assert.equal(bridge.pumping, true);
  assert.deepEqual([...clock.timers.values()].map((t) => t.ms), [FLUSH_MS]);
  assert.equal(FLUSH_MS, 20);
  clock.tick();
  clock.tick();
  assert.deepEqual(page(), [], 'file vide : pas de dmx:packets');
  native.enqueue(pkt(0), pkt(1));
  clock.tick();
  assert.deepEqual(page(), [{ type: 'dmx:packets', packets: [pkt(0), pkt(1)] }]);
  assert.deepEqual(native.calls.filter((c) => c[0] === 'drain').map((c) => c[1]), [MAX_BATCH, MAX_BATCH, MAX_BATCH]);
  // Un second dmx:listen remplace l'écoute sans doubler le minuteur
  bridge.handle({ type: 'dmx:listen', protocol: 'artnet', universes: [0], multicast: false });
  assert.equal(clock.timers.size, 1);
});

test('JS en retard : lot plafonné, les paquets les plus anciens sont jetés', () => {
  const { bridge, native, clock, page } = setup({ maxBatch: 4 });
  bridge.handle({ type: 'dmx:listen', protocol: 'sacn', universes: [1], multicast: false });
  const burst = Array.from({ length: 10 }, (_, i) => ({ src: '10.0.0.1', port: 5568, data: b64(i + 1) }));
  native.enqueue(...burst);
  clock.tick();
  assert.deepEqual(page(), [{ type: 'dmx:packets', packets: burst.slice(-4) }]);
  // Garde-fou si le natif rendait plus que demandé
  native.drain = () => burst;
  bridge.flush();
  assert.deepEqual(page()[0].packets, burst.slice(-4));
  assert.equal(MAX_BATCH, 128);
});

test('erreurs natives relayées ; après une erreur fatale, la file n\'est plus relevée', () => {
  const { bridge, native, page } = setup();
  bridge.handle({ type: 'dmx:listen', protocol: 'sacn', universes: [1], multicast: true });
  native.emit('onSetRemoteUdpError', { reason: 'multicast-not-permitted' });
  assert.equal(bridge.pumping, true, 'non fatale : l\'unicast continue');
  native.emit('onSetRemoteUdpError', { reason: 'bind-failed' });
  assert.equal(bridge.pumping, false);
  assert.deepEqual(page(), [
    { type: 'dmx:error', reason: 'multicast-not-permitted' },
    { type: 'dmx:error', reason: 'bind-failed' },
  ]);
  for (const r of FATAL_REASONS) assert.ok(ERROR_REASONS.includes(r), r);
});

test('net:info : sur demande et à chaque changement de réseau', async () => {
  const wifi = { name: 'en0', kind: 'wifi', ip: '192.168.1.20', mask: '255.255.255.0' };
  const eth = { name: 'eth0', kind: 'ethernet', ip: '2.0.0.10', mask: '255.0.0.0' };
  const { bridge, native, page } = setup({ interfaces: [wifi] });
  assert.equal(bridge.handle({ type: 'net:info' }), true);
  await settle();
  assert.deepEqual(page(), [{ type: 'net:info', interfaces: [wifi] }]);
  native.emit('onSetRemoteUdpNetwork', { interfaces: [wifi, eth] });
  assert.deepEqual(page(), [{ type: 'net:info', interfaces: [wifi, eth] }]);
});

test('udp:send et dmx:stop transmis au natif', () => {
  const { bridge, native, page } = setup();
  bridge.handle({ type: 'dmx:listen', protocol: 'artnet', universes: [], multicast: true });
  bridge.handle({ type: 'udp:send', host: '2.0.0.1', port: 6454, data: b64(239) });
  bridge.handle({ type: 'dmx:stop' });
  assert.deepEqual(native.calls, [
    ['listen', 'artnet', [], true],
    ['send', '2.0.0.1', 6454, b64(239)],
    ['stop'],
  ]);
  assert.equal(bridge.pumping, false);
  assert.deepEqual(page(), []);
});

test('reset (nouvelle page) : arrête une écoute en cours, ne fait rien sinon', () => {
  const idle = setup();
  idle.bridge.reset();
  assert.deepEqual(idle.native.calls, []);
  const busy = setup();
  busy.bridge.handle({ type: 'dmx:listen', protocol: 'sacn', universes: [1], multicast: false });
  busy.bridge.reset();
  assert.deepEqual(busy.native.calls.map((c) => c[0]), ['listen', 'stop']);
  assert.equal(busy.bridge.pumping, false);
});

test('échec inattendu de listen() : listen-failed et arrêt du relevé', async () => {
  const native = fakeNative();
  native.listenResult = Promise.reject(new Error('boom'));
  const { bridge, page } = setup({ native });
  bridge.handle({ type: 'dmx:listen', protocol: 'sacn', universes: [1], multicast: false });
  await settle();
  assert.equal(bridge.pumping, false);
  assert.deepEqual(page(), [{ type: 'dmx:error', reason: 'listen-failed' }]);
});

test('binaire sans module natif : native-unavailable, net:info vide', async () => {
  const { bridge, page } = setup({ native: null });
  assert.equal(bridge.handle({ type: 'dmx:listen', protocol: 'sacn', universes: [1], multicast: false }), true);
  assert.equal(bridge.handle({ type: 'udp:send', host: '2.0.0.1', port: 6454, data: b64(10) }), true);
  assert.equal(bridge.handle({ type: 'dmx:stop' }), true);
  assert.equal(bridge.handle({ type: 'net:info' }), true);
  assert.equal(bridge.pumping, false);
  assert.deepEqual(page(), [
    { type: 'dmx:error', reason: 'native-unavailable' },
    { type: 'dmx:error', reason: 'native-unavailable' },
    { type: 'net:info', interfaces: [] },
  ]);
});

test('dispose : écoute arrêtée, abonnements retirés, plus rien vers la page', () => {
  const { bridge, native, page } = setup();
  bridge.handle({ type: 'dmx:listen', protocol: 'sacn', universes: [1], multicast: false });
  bridge.dispose();
  assert.equal(native.listeners.onSetRemoteUdpError.size, 0);
  assert.equal(native.listeners.onSetRemoteUdpNetwork.size, 0);
  assert.equal(bridge.handle({ type: 'net:info' }), true);
  assert.deepEqual(native.calls.map((c) => c[0]), ['listen', 'stop']);
  assert.deepEqual(page(), []);
});

// ───────────────── cohérence TypeScript / Swift / Kotlin / plugin ─────────────────

test('module local : noms, événements et limites identiques sur les trois plateformes', () => {
  const config = JSON.parse(read('expo-module.config.json'));
  assert.deepEqual(config.platforms, ['apple', 'android']);
  assert.deepEqual(config.apple.modules, ['SetRemoteUdpModule']);
  assert.deepEqual(config.android.modules, ['expo.modules.setremoteudp.SetRemoteUdpModule']);
  const swift = read('ios/SetRemoteUdpModule.swift');
  const swiftGateway = read('ios/UdpGateway.swift');
  const kotlin = read('android/src/main/java/expo/modules/setremoteudp/SetRemoteUdpModule.kt');
  const kotlinGateway = read('android/src/main/java/expo/modules/setremoteudp/UdpGateway.kt');
  const ts = read('src/SetRemoteUdpModule.ts');
  assert.match(swift, /public class SetRemoteUdpModule: Module/);
  assert.match(kotlin, /^package expo\.modules\.setremoteudp$/m);
  assert.match(kotlin, /class SetRemoteUdpModule : Module\(\)/);
  for (const src of [swift, kotlin]) assert.match(src, /Name\("SetRemoteUdp"\)/);
  assert.match(ts, /requireOptionalNativeModule<SetRemoteUdpModule>\('SetRemoteUdp'\)/);
  for (const fn of ['listen', 'stop', 'send', 'getNetworkInfo']) {
    assert.match(swift, new RegExp(`AsyncFunction\\("${fn}"\\)`), `Swift ${fn}`);
    assert.match(kotlin, new RegExp(`AsyncFunction\\("${fn}"\\)`), `Kotlin ${fn}`);
  }
  for (const src of [swift, kotlin]) assert.match(src, /Function\("drain"\)/);
  for (const ev of ['onSetRemoteUdpError', 'onSetRemoteUdpNetwork']) {
    assert.ok(swift.includes(`"${ev}"`), `Swift ${ev}`);
    assert.ok(kotlin.includes(`"${ev}"`), `Kotlin ${ev}`);
  }
  // Limites : 64 univers, 1500 octets, lot natif ≥ lot JS
  assert.match(swiftGateway, /maxUniverses = 64\b/);
  assert.match(swiftGateway, /maxDatagram = 1500\b/);
  assert.match(kotlinGateway, /MAX_UNIVERSES = 64\b/);
  assert.match(kotlinGateway, /MAX_DATAGRAM = 1500\b/);
  const swiftBatch = Number(/maxBatch = (\d+)/.exec(swiftGateway)[1]);
  const kotlinBatch = Number(/MAX_BATCH = (\d+)/.exec(kotlinGateway)[1]);
  assert.ok(swiftBatch >= MAX_BATCH && kotlinBatch >= MAX_BATCH);
  // Ports et plages d'univers
  assert.match(swiftGateway, /self == \.sacn \? 5568 : 6454/);
  assert.match(kotlinGateway, /SACN\("sacn", 5568\)/);
  assert.match(kotlinGateway, /ARTNET\("artnet", 6454\)/);
  for (const src of [swiftGateway, kotlinGateway]) {
    assert.match(src, /1\.\.\.?63999/);
    assert.match(src, /0\.\.\.?32767/);
    assert.match(src, /64214/);
  }
  // Aucune trace du contenu des paquets
  for (const src of [swift, swiftGateway, kotlin, kotlinGateway]) {
    assert.doesNotMatch(src, /\b(print|NSLog|os_log|Log\.[dviwe]|println)\(/);
  }
});

test('config plugin : entitlement multicast désactivé par défaut, activé par la variable', () => {
  const require = createRequire(import.meta.url);
  const plugin = require('../app.plugin.js');
  assert.equal(plugin.ENV_FLAG, 'SETREMOTE_MULTICAST_ENTITLEMENT');
  assert.equal(plugin.multicastEnabled({}, {}), false);
  for (const v of ['0', 'false', 'no', '', 'maybe']) assert.equal(plugin.multicastEnabled({}, { SETREMOTE_MULTICAST_ENTITLEMENT: v }), false, v);
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' 1 ']) assert.equal(plugin.multicastEnabled({}, { SETREMOTE_MULTICAST_ENTITLEMENT: v }), true, v);
  assert.equal(plugin.multicastEnabled({ multicastEntitlement: true }, {}), true, 'option explicite du plugin');
  const app = JSON.parse(readFileSync(path.join(moduleDir, '..', '..', 'app.json'), 'utf8')).expo;
  assert.ok(app.plugins.includes('./modules/setremote-udp/app.plugin.js'));
  assert.ok(!JSON.stringify(app.ios).includes('networking.multicast'), 'jamais en dur dans app.json');
});

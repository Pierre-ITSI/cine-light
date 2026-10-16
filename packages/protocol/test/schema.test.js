import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MESSAGE_TYPES, LIMITS, RING_ID_RE, validate, explainInvalid, isAddressedTo } from '../schema.js';
import { MAX_MESSAGE_BYTES } from '../crypto.js';
import { RENDEZVOUS_MESSAGE_TYPES } from '../pairing.js';
import { utf8Encode } from '../lib/encoding.js';
import { REAL_MESSAGES, ATTACKS } from './fixtures.js';

test('accepte tous les messages réels (avec et sans contrôle du sens)', () => {
  for (const { direction, where, msg } of REAL_MESSAGES) {
    assert.equal(explainInvalid(msg), null, `${where} : ${explainInvalid(msg)}`);
    assert.equal(validate(msg, { direction }), true, `${where} (sens ${direction}) : ${explainInvalid(msg, { direction })}`);
  }
});

test('chaque type documenté a au moins un exemple réel valide', () => {
  const covered = new Set(REAL_MESSAGES.map(f => f.msg.type));
  for (const type of Object.keys(MESSAGE_TYPES)) assert.ok(covered.has(type), `pas d’exemple pour ${type}`);
});

test('rejette les charges d’attaque de la revue et leurs variantes', () => {
  for (const { why, msg } of ATTACKS) {
    assert.equal(validate(msg), false, `devrait être rejeté : ${why}`);
  }
  // Les quatre charges exactes de la revue de sécurité
  assert.equal(validate({ type: 'call:start', photo: 'x)"><img src=x onerror=alert(1)>' }), false);
  assert.equal(validate({ type: 'effect', params: { count: 1e8 } }), false);
  assert.equal(validate({ type: 'strobe', active: true, freq: 0 }), false);
  assert.equal(validate({ type: 'media-img-start', total: 1e9 }), false);
});

test('rejette le mauvais sens', () => {
  assert.equal(validate({ type: 'caps', torch: true, vibrate: true }, { direction: 'r2s' }), false);
  assert.equal(validate({ type: 'color', color: '#ffffff' }, { direction: 's2r' }), false);
  const ice = { type: 'rtc-ice', from: 'remote', candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 1 typ host' } };
  assert.equal(validate(ice, { direction: 'r2s' }), true);
  assert.equal(validate(ice, { direction: 's2r' }), false, 'un écran ne peut pas se faire passer pour la télécommande');
  assert.equal(validate({ type: 'color', color: '#ffffff' }, { direction: /** @type {any} */ ('x') }), false);
});

test('plafonds strobe : ≤ 30 Hz et flash ≥ 15 ms (alignés sur PROTO de l’app)', () => {
  assert.deepEqual(LIMITS.strobeFreqHz, [0.1, 30]);
  assert.deepEqual(LIMITS.strobeFlashMs, [15, 2000]);
  const s = (/** @type {object} */ o) => validate({ type: 'strobe', active: true, freq: 10, dur: 50, ...o });
  assert.equal(s({ freq: 30 }), true);
  assert.equal(s({ freq: 30.01 }), false);
  assert.equal(s({ dur: 15 }), true);
  assert.equal(s({ dur: 14.9 }), false);
  assert.equal(s({ dur: 2000 }), true);
  assert.equal(s({ dur: 2001 }), false);
  assert.equal(s({ freq: 0.1 }), true);
  assert.equal(s({ freq: 0.09 }), false);
  assert.equal(s({ random: true, freqMin: 1, freqMax: 31, durMin: 15, durMax: 20 }), false);
});

test('call:start : son intégré, son importé (ringId) et volume, champs facultatifs et stricts', () => {
  const c = (/** @type {object} */ o) => validate({ type: 'call:start', kind: 'call', ...o }, { direction: 'r2s' });
  assert.equal(c({}), true, 'sans champ de son : son intégré classique à 100 % (comportement d’avant)');
  for (const ring of ['classic', 'digital', 'soft', 'silent']) assert.equal(c({ ring }), true, ring);
  assert.equal(c({ ring: 'classic', ringId: '__ring_0123456789abcdef', ringVolume: 1 }), true);
  assert.equal(c({ ringVolume: 0 }), true, 'volume 0 accepté (muet)');
  assert.equal(c({ ringVolume: 1.0000001 }), false);
  assert.equal(c({ ringVolume: null }), false, 'pas de null : champ absent = 100 %');
  assert.equal(c({ ringId: null }), false, 'pas de null : champ absent = son intégré');
  assert.equal(c({ ringId: '' }), false);
  assert.equal(validate({ type: 'call:start', kind: 'sms', ring: 'soft', ringId: '__ring_ffffffffffffffff', ringVolume: 0.35 }), true, 'SMS : son de notification');
  assert.ok(RING_ID_RE.test('__ring_0123456789abcdef'));
  for (const bad of ['__ring_0123456789abcde', '__ring_0123456789abcdeg', '__RING_0123456789abcdef', 'x__ring_0123456789abcdef', '__ring_0123456789abcdef\n']) {
    assert.equal(RING_ID_RE.test(bad), false, bad);
    assert.equal(c({ ringId: bad }), false, bad);
  }
  // L'id d'un son importé est un id de média valide (cache, media:need, media:evict)
  assert.equal(validate({ type: 'media:need', id: '__ring_0123456789abcdef' }, { direction: 's2r' }), true);
  assert.equal(MESSAGE_TYPES['call:start'].fields.ringId.required, false);
  assert.equal(MESSAGE_TYPES['call:start'].fields.ringVolume.required, false);
});

test('dmx:look (passerelle DMX) : sens r2s, look strict, target facultatif', () => {
  const look = { color: '#ff8800', strobe: { freq: 0.5, dur: 50 }, effect: { name: 'fire', speed: 3, intensity: 40 }, media: { index: 3, playback: 'pause' } };
  const ok = { type: 'dmx:look', seq: 42, live: true, look };
  assert.equal(explainInvalid(ok, { direction: 'r2s' }), null);
  assert.equal(validate({ ...ok, target: { screens: ['AbCdEfGh12345678'] } }, { direction: 'r2s' }), true);
  assert.equal(validate({ ...ok, target: { group: 'plateau' } }), true);
  assert.equal(validate(ok, { direction: 's2r' }), false, 'un écran n’émet pas de dmx:look');
  assert.equal(MESSAGE_TYPES['dmx:look'].direction, 'r2s');
  assert.equal(LIMITS.dmxMediaSlots, 25);
  const bad = (/** @type {object} */ l) => validate({ type: 'dmx:look', seq: 1, live: true, look: { color: '#ffffff', ...l } });
  assert.equal(bad({}), true);
  assert.equal(bad({ blackout: true }), true);
  assert.equal(bad({ strobe: { freq: 30.5, dur: 20 } }), false, 'plafond 30 Hz');
  assert.equal(bad({ strobe: { freq: 10, dur: 14 } }), false, 'flash ≥ 15 ms');
  assert.equal(bad({ strobe: { freq: 10 } }), false, 'strobe incomplet');
  assert.equal(bad({ effect: { name: 'eval', speed: 1, intensity: 10 } }), false, 'effet inconnu');
  assert.equal(bad({ effect: { name: 'tv', speed: 1, intensity: 101 } }), false);
  assert.equal(bad({ media: { index: 0, playback: 'play' } }), false, 'index 0 = média masqué : champ absent');
  assert.equal(bad({ media: { index: 2, playback: 'stop' } }), false);
  assert.equal(bad({ color: 'red' }), false);
  assert.equal(validate({ type: 'dmx:look', seq: -1, live: true, look: { color: '#ffffff' } }), false);
  assert.equal(validate({ type: 'dmx:look', seq: 1, live: 1, look: { color: '#ffffff' } }), false);
  assert.equal(validate({ type: 'dmx:look', seq: 1, live: true, look: { color: '#ffffff' }, fade: 1000 }), false, 'champ inconnu');
});

test('tout message valide pour le schéma tient dans MAX_MESSAGE_BYTES (pires cas)', () => {
  const pad = (/** @type {string} */ base, /** @type {number} */ i, /** @type {number} */ len) => (base.repeat(len) + String(i)).slice(-len);
  const id64 = (/** @type {number} */ i) => pad('A', i, 64);
  const ids = Array.from({ length: LIMITS.poolSize }, (_, i) => id64(i));
  const target = { screens: Array.from({ length: LIMITS.targetScreens }, (_, i) => pad('S', i, 32)) };
  const groups = Array.from({ length: LIMITS.screenGroups }, (_, i) => pad('g', i, 32));
  const lone = (/** @type {number} */ n) => '\ud800'.repeat(n); // échappé en \ud800 par JSON : 6 octets par caractère
  const esc = (/** @type {number} */ n) => '"\\'.repeat(n / 2); // « " » et « \ » : 2 octets chacun en JSON
  const worst = [
    { type: 'media:order', ids, target },
    { type: 'caps', torch: false, vibrate: false, videoMode: 'none', media: false, cached: ids, active: id64(0), blackout: false, screenId: pad('S', 0, 32), name: lone(LIMITS.screenNameChars), groups },
    { type: 'rtc-offer', kind: 'file', sdp: { type: 'offer', sdp: esc(LIMITS.sdpChars) }, target },
    { type: 'rtc-answer', sdp: { type: 'answer', sdp: esc(LIMITS.sdpChars) } },
    { type: 'rtc-ice', from: 'remote', candidate: { candidate: esc(LIMITS.iceCandidateChars), sdpMid: lone(64), sdpMLineIndex: 255, usernameFragment: lone(256) }, target },
    { type: 'media-img-chunk', id: id64(1), i: LIMITS.imgChunks - 1, data: 'A'.repeat(LIMITS.imgChunkChars), target },
    { type: 'media:chunk', mediaId: id64(2), index: LIMITS.uploadChunks - 1, data: 'A'.repeat(LIMITS.uploadChunkChars), target },
    { type: 'media:need-chunks', mediaId: id64(3), missing: Array(LIMITS.missingChunks).fill(LIMITS.uploadChunks - 1) },
    { type: 'screen:config', name: lone(LIMITS.screenNameChars), groups, target },
    {
      type: 'dmx:look', seq: 0xffff, live: true, target,
      look: { color: '#ffffff', strobe: { freq: 30, dur: 2000 }, effect: { name: 'paparazzi', speed: 240, intensity: 100 }, media: { index: LIMITS.dmxMediaSlots, playback: 'rewind' }, blackout: true },
    },
    {
      type: 'call:start', kind: 'whatsapp', style: 'generic', name: lone(40), label: lone(40), msg: lone(200), appName: lone(24), appColor: '#ffffff',
      hasPhoto: true, ring: 'classic', ringId: '__ring_ffffffffffffffff', ringVolume: 0.123456789012345, present: 'banner', photoMode: 'avatar', hasAudio: false, autoAnswer: 60, lock: { time: lone(8), date: lone(30) }, target,
    },
  ];
  for (const m of worst) {
    assert.equal(explainInvalid(m), null, `${m.type} : ${explainInvalid(m)}`);
    const bytes = utf8Encode(JSON.stringify(m)).length;
    assert.ok(bytes <= MAX_MESSAGE_BYTES, `${m.type} : ${bytes} octets > ${MAX_MESSAGE_BYTES}`);
  }
});

test('valeurs non JSON et prototypes piégés', () => {
  assert.equal(validate(null), false);
  assert.equal(validate('color'), false);
  assert.equal(validate(Object.create({ type: 'hello' })), false, 'type hérité ignoré');
  class Fake { constructor() { this.type = 'hello'; } }
  assert.equal(validate(new Fake()), false, 'seuls les objets « simples » sont acceptés');
  const polluted = JSON.parse('{"type":"effect","name":"tv","active":true,"params":{"__proto__":{"x":1}}}');
  assert.equal(validate(polluted), false);
  const proto = JSON.parse('{"type":"color","color":"#ffffff","__proto__":{"x":1}}');
  assert.equal(validate(proto), false);
  const getter = { type: 'color', get color() { throw new Error('boom'); } };
  assert.equal(validate(getter), false);
  assert.equal(validate({ type: 'media:need-chunks', mediaId: 'x', missing: [1.5] }), false);
  assert.equal(validate({ type: 'media:advance', dir: 2 }), false);
});

test('MESSAGE_TYPES documente sens, sources et champs, et est figé', () => {
  for (const [type, d] of Object.entries(MESSAGE_TYPES)) {
    assert.ok(['r2s', 's2r', 'both'].includes(d.direction), type);
    assert.ok(d.description.length > 5, type);
    for (const f of Object.values(d.fields)) assert.equal(typeof f.required, 'boolean');
  }
  assert.ok(Object.isFrozen(MESSAGE_TYPES));
  assert.equal(MESSAGE_TYPES.color.direction, 'r2s');
  assert.equal(MESSAGE_TYPES.caps.direction, 's2r');
  assert.equal(MESSAGE_TYPES['rtc-ice'].direction, 'both');
  assert.equal(MESSAGE_TYPES.caps.fields.screenId.required, false);
});

test('isAddressedTo : tous, liste d’écrans, groupe', () => {
  const me = { screenId: 'AbCdEfGh12345678', groups: ['cuisine'] };
  assert.equal(isAddressedTo({ type: 'color' }, me), true);
  assert.equal(isAddressedTo({ target: { screens: ['AbCdEfGh12345678', 'ZZZZZZZZZZZZZZZZ'] } }, me), true);
  assert.equal(isAddressedTo({ target: { screens: ['ZZZZZZZZZZZZZZZZ'] } }, me), false);
  assert.equal(isAddressedTo({ target: { group: 'cuisine' } }, me), true);
  assert.equal(isAddressedTo({ target: { group: 'salon' } }, me), false);
  assert.equal(isAddressedTo({ target: { group: 'cuisine' } }, { screenId: me.screenId }), false);
  assert.equal(isAddressedTo({ target: /** @type {any} */ ({ weird: 1 }) }, me), false);
});

// ── Détection de dérive : tout type émis/attendu par les apps doit être au schéma ──

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
/** Types qui ne passent PAS par le relais (ponts locaux), documentés dans schema.js. */
const NON_RELAY = new Set(['brightness', 'brightness-restore',
  // pont natif de la passerelle DMX (docs/DMX-NATIVE.md)
  'dmx:listen', 'dmx:stop', 'udp:send', 'net:info', 'dmx:packets', 'dmx:error',
  // aperçu PDF de la table des canaux (expo-print dans la coque)
  'pdf:preview', 'pdf:error']);

/** @param {string} src */
function extractTypes(src) {
  const found = new Set();
  for (const re of [
    /(?:sendMsg|send)\(\s*\{\s*type\s*:\s*['"]([a-zA-Z0-9:_-]+)['"]/g,
    /\btype\s*:\s*['"]([a-zA-Z0-9:_-]+)['"]/g,
    /\.type\s*===?\s*['"]([a-zA-Z0-9:_-]+)['"]/g,
  ]) {
    for (const m of src.matchAll(re)) found.add(m[1]);
  }
  return found;
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?)$/.test(name) ? [p] : [];
  });
}

/** Sources de la PWA : web/js/*.js (+ gabarit) si présents, sinon index.html (généré). */
function webSources() {
  const jsDir = join(repoRoot, 'web', 'js');
  if (existsSync(jsDir)) {
    const files = readdirSync(jsDir).filter(n => n.endsWith('.js')).map(n => join(jsDir, n));
    const tpl = join(repoRoot, 'web', 'index.template.html');
    if (existsSync(tpl)) files.push(tpl);
    return files.map(f => readFileSync(f, 'utf8')).join('\n');
  }
  const html = join(repoRoot, 'index.html');
  return existsSync(html) ? readFileSync(html, 'utf8') : null;
}
const WEB = webSources();
const HTML_INPUT_TYPES = /^(text|range|number|checkbox|color|file|button|submit|module|date|time|radio|hidden)$/;

test('dérive : la PWA n’utilise que des types connus', { skip: WEB === null }, () => {
  // Les messages de rendez-vous (appairage par code) ont leur propre validateur
  const types = [...extractTypes(/** @type {string} */ (WEB))]
    .filter(t => !NON_RELAY.has(t) && !HTML_INPUT_TYPES.test(t) && !(t in RENDEZVOUS_MESSAGE_TYPES));
  assert.ok(types.length > 30, `extraction suspecte (${types.length} types)`);
  const unknown = types.filter(t => !(t in MESSAGE_TYPES));
  assert.deepEqual(unknown, [], `types absents du schéma : ${unknown.join(', ')}`);
});

test('dérive : chaque route de MSG_ROUTES (web/js/22-protocol.js) est au schéma, dans le bon sens',
  { skip: !existsSync(join(repoRoot, 'web', 'js', '22-protocol.js')) }, () => {
    const src = readFileSync(join(repoRoot, 'web', 'js', '22-protocol.js'), 'utf8');
    const block = src.slice(src.indexOf('const MSG_ROUTES'), src.indexOf('function dispatchMessage'));
    const routes = [...block.matchAll(/^\s{2}'([a-z][a-z0-9:_-]*)':\s*\{\s*roles:\s*\[([^\]]*)\]/gm)];
    assert.ok(routes.length > 30, `extraction suspecte (${routes.length} routes)`);
    for (const [, type, rolesSrc] of routes) {
      assert.ok(type in MESSAGE_TYPES, `route ${type} absente du schéma`);
      const roles = [...rolesSrc.matchAll(/'(screen|remote)'/g)].map(m => m[1]).sort().join(',');
      const expected = { r2s: 'screen', s2r: 'remote', both: 'remote,screen' }[MESSAGE_TYPES[type].direction];
      assert.equal(roles, expected, `sens de ${type}`);
    }
  });

test('dérive : expo-app n’utilise que des types connus', { skip: !existsSync(join(repoRoot, 'expo-app', 'app')) }, () => {
  const files = [...walk(join(repoRoot, 'expo-app', 'app')), ...walk(join(repoRoot, 'expo-app', 'src'))];
  const unknown = new Set();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:send|transport\.send)\(\s*\{\s*type\s*:\s*['"]([a-zA-Z0-9:_-]+)['"]/g)) {
      if (!(m[1] in MESSAGE_TYPES) && !NON_RELAY.has(m[1])) unknown.add(`${m[1]} (${f})`);
    }
    for (const m of src.matchAll(/msg\.type\s*===?\s*['"]([a-zA-Z0-9:_-]+)['"]/g)) {
      if (!(m[1] in MESSAGE_TYPES) && !NON_RELAY.has(m[1])) unknown.add(`${m[1]} (${f})`);
    }
  }
  assert.deepEqual([...unknown], []);
});

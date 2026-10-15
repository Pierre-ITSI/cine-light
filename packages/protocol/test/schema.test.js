import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MESSAGE_TYPES, LIMITS, validate, explainInvalid, isAddressedTo } from '../schema.js';
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

test('plafonds strobe : ≤ 30 Hz et flash ≥ 15 ms', () => {
  assert.deepEqual(LIMITS.strobeFreqHz, [0.5, 30]);
  assert.deepEqual(LIMITS.strobeFlashMs, [15, 1000]);
  const s = (/** @type {object} */ o) => validate({ type: 'strobe', active: true, freq: 10, dur: 50, ...o });
  assert.equal(s({ freq: 30 }), true);
  assert.equal(s({ freq: 30.01 }), false);
  assert.equal(s({ dur: 15 }), true);
  assert.equal(s({ dur: 14.9 }), false);
  assert.equal(s({ random: true, freqMin: 1, freqMax: 31, durMin: 15, durMax: 20 }), false);
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
const NON_RELAY = new Set(['brightness', 'brightness-restore', 'setUniverse', 'dmx', 'code_changed', 'error']);

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

test('dérive : index.html n’utilise que des types connus', { skip: !existsSync(join(repoRoot, 'index.html')) }, () => {
  const html = readFileSync(join(repoRoot, 'index.html'), 'utf8');
  // Seuls les blocs JS comptent ; on ignore les attributs type="range" etc. grâce aux motifs JS ci-dessus.
  const types = [...extractTypes(html)].filter(t => !NON_RELAY.has(t));
  assert.ok(types.length > 30, `extraction suspecte (${types.length} types)`);
  const unknown = types.filter(t => !(t in MESSAGE_TYPES) && !/^(text|range|number|checkbox|color|file|button|submit|module)$/.test(t));
  assert.deepEqual(unknown, [], `types absents du schéma : ${unknown.join(', ')}`);
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

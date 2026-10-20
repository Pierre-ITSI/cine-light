// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MESSAGE_TYPES, LIMITS, RING_ID_RE, CALL_PHOTO_ID_RE, CALL_AUDIO_ID_RE, PHONE_NOTIF_ID_RE, PHONE_GESTURES, validate, explainInvalid, isAddressedTo } from '../schema.js';
import { MAX_MESSAGE_BYTES } from '../crypto.js';
import { RENDEZVOUS_MESSAGE_TYPES } from '../pairing.js';
import { utf8Encode } from '../lib/encoding.js';
import { REAL_MESSAGES, ATTACKS } from './fixtures.js';

test('accepte tous les messages réels (avec et sans contrôle du sens)', () => {
  for (const { direction, channel, where, msg } of REAL_MESSAGES) {
    assert.equal(explainInvalid(msg, { channel }), null, `${where} : ${explainInvalid(msg, { channel })}`);
    assert.equal(validate(msg, { direction, channel }), true, `${where} (sens ${direction}) : ${explainInvalid(msg, { direction, channel })}`);
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
  assert.equal(validate({ type: 'tel:state', tel: null }, { direction: 'r2s' }), false);
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

test('préparation hors ligne : photo / bande son préparées (photoId, audioId), vidéo mise en cache sans affichage', () => {
  const c = (/** @type {object} */ o) => validate({ type: 'call:start', kind: 'call', hasPhoto: true, hasAudio: true, ...o }, { direction: 'r2s' });
  const ph = '__ph_' + '0123456789abcdef'.repeat(2) + '01234567', au = '__au_' + 'f'.repeat(40);
  assert.equal(ph.length, 45);
  assert.equal(c({ photoId: ph, audioId: au }), true);
  assert.ok(CALL_PHOTO_ID_RE.test(ph) && CALL_AUDIO_ID_RE.test(au));
  for (const bad of [au, '__callphoto', '__ph_' + 'a'.repeat(39), '__ph_' + 'A'.repeat(40), '__ph_' + 'a'.repeat(41), null, '']) {
    assert.equal(c({ photoId: bad }), false, String(bad));
  }
  assert.equal(c({ audioId: ph }), false, 'une photo n’est pas une bande son');
  // Plus de 40 caractères : un écran d'une version antérieure ne l'accepte pas en cache (ids ≤ 40)
  assert.ok(ph.length > 40 && validate({ type: 'media-img-start', id: 'x1', total: 3, mediaId: ph, show: false }, { direction: 'r2s' }));
  assert.equal(validate({ type: 'media:cached', id: au }, { direction: 's2r' }), true);
  // Vidéo : offre « cache » et envoi base64 sans affichage
  const sdp = { type: 'offer', sdp: 'v=0\r\n' };
  assert.equal(validate({ type: 'rtc-offer', sdp, kind: 'cache', target: { screens: ['ScreenOne0000001'] } }, { direction: 'r2s' }), true);
  assert.equal(validate({ type: 'rtc-offer', sdp, kind: 'show' }, { direction: 'r2s' }), false);
  const up = { type: 'media:upload', mediaId: 'q8w7e6', kind: 'video', mime: 'video/mp4', totalChunks: 4, poolId: 'm4' };
  assert.equal(validate({ ...up, show: false }, { direction: 'r2s' }), true);
  assert.equal(validate({ ...up, show: 0 }, { direction: 'r2s' }), false);
  assert.equal(MESSAGE_TYPES['call:start'].fields.photoId.required, false);
  assert.equal(MESSAGE_TYPES['media:upload'].fields.show.required, false);
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
    { type: 'tel:state', tel: { kind: 'notif', state: 'notif', name: lone(40) } },
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
    { type: 'call:start', kind: 'notif', style: 'glass', name: lone(40), msg: lone(200), appName: lone(24), hasPhoto: true, ring: 'classic', ringId: '__ring_ffffffffffffffff', ringVolume: 0.5, present: 'lock', photoId: '__ph_' + 'f'.repeat(40), phone: { date: '2026-12-31', time: '23:59' }, received: { mode: 'at', date: '2026-12-31', time: '23:59' }, target },
    { type: 'chat:msg', id: 'A'.repeat(12), from: 'contact', text: lone(LIMITS.chatTextChars), target },
    { type: 'chat:open', name: lone(LIMITS.chatNameChars), style: 'tonal', hasAvatar: true, ids: Array.from({ length: LIMITS.chatMessages }, (_, i) => pad('c', i, 12)), sent: Array.from({ length: LIMITS.chatMessages }, (_, i) => pad('c', i, 12)), typed: LIMITS.chatTextChars, target },
    { type: 'chat:open', name: lone(LIMITS.chatNameChars), style: 'tonal', hasAvatar: true, ids: Array.from({ length: LIMITS.chatMessages }, (_, i) => pad('c', i, 12)), sent: Array.from({ length: LIMITS.chatMessages }, (_, i) => pad('c', i, 12)), typed: 0, history: true, target },
    { type: 'chat:rewind', id: 'A'.repeat(12), drop: true, target },
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

test('ciblage PWA : tout message r2s accepte target.screens (1 à 64 écrans), jamais un message s2r', () => {
  // La télécommande adresse chaque ordre à la cible choisie (tous = sans
  // target ; groupe résolu en liste d’écrans ; un écran) : tous les messages
  // réels r2s doivent rester valides une fois adressés.
  const ids = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => ('S' + String(i).padStart(3, '0')).padEnd(16, 'x'));
  for (const { direction, channel, where, msg } of REAL_MESSAGES) {
    if (channel === 'pairwise') continue; // adressés par leur clé (pairwise.test.js)
    if (direction !== 'r2s') {
      assert.equal(validate({ ...msg, target: { screens: ids(1) } }), false, `${where} : target interdit en s2r`);
      continue;
    }
    // Échange de clés et retrait : UN seul écran, jamais plusieurs
    const one = ['key:offer', 'screen:revoked'].includes(msg.type);
    if (one) assert.equal(validate({ ...msg, target: { screens: ids(2) } }), false, `${where} : un seul écran`);
    for (const n of one ? [1] : [1, 2, LIMITS.targetScreens]) {
      const m = { ...msg, target: { screens: ids(n) } };
      assert.equal(explainInvalid(m, { direction: 'r2s' }), null, `${where} adressé à ${n} écran(s)`);
    }
    assert.equal(validate({ ...msg, target: { screens: ids(LIMITS.targetScreens + 1) } }), false, `${where} : 65 écrans refusés`);
  }
  assert.equal(LIMITS.targetScreens, 64);
  // screen:config : émis par la PWA (nom vide = nom par défaut), toujours vers des écrans précis
  assert.deepEqual(MESSAGE_TYPES['screen:config'].sources, ['web']);
  assert.equal(validate({ type: 'screen:config', target: { screens: ids(1) }, name: '', groups: [] }, { direction: 'r2s' }), true);
  assert.equal(validate({ type: 'screen:config', target: { screens: ids(1) }, name: 'TV salon', groups: ['gabc123'] }, { direction: 'r2s' }), true);
  assert.equal(validate({ type: 'screen:config', target: { screens: ids(1) }, name: 'x'.repeat(LIMITS.screenNameChars + 1) }), false, 'nom > 40');
  assert.equal(validate({ type: 'screen:config', target: { screens: ids(1) }, name: 'TV\nsalon' }), false, 'une seule ligne');
  assert.equal(validate({ type: 'screen:config', target: { screens: ids(1) }, groups: Array(LIMITS.screenGroups + 1).fill('g') }), false, '> 16 groupes');
  // caps : l’écran annonce le nom et les groupes reçus
  assert.equal(validate({ type: 'caps', torch: true, vibrate: true, screenId: ids(1)[0], name: 'TV salon', groups: ['gabc123'] }, { direction: 's2r' }), true);
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
  // vibreur de l'écran de jeu dans la coque (« vibrate » du pont a la forme du message relayé)
  'vibrate:stop',
  // pont natif de la passerelle DMX (docs/DMX-NATIVE.md)
  'dmx:listen', 'dmx:stop', 'udp:send', 'net:info', 'dmx:packets', 'dmx:error',
  // aperçu PDF de la table des canaux (expo-print dans la coque)
  'pdf:preview', 'pdf:error',
  // liaisons locales Wi-Fi / Bluetooth : le pont porte des trames déjà scellées (docs/OFFLINE.md)
  'link:start', 'link:stop', 'link:send', 'link:state', 'link:frames', 'link:peers', 'link:error',
  // fichiers projet .rem par morceaux (feuille de partage, sélecteur de la coque, docs/PROJECTS.md)
  'project:save', 'project:open', 'project:saved', 'project:file', 'project:error']);

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

test('Séquence (phone:*) : sens, pile de notifications, déverrouillage sans code transmis, gestes', () => {
  // Sens : l'état part de la télécommande, les gestes de l'écran ; jamais l'inverse
  assert.equal(MESSAGE_TYPES['phone:state'].direction, 'r2s');
  assert.equal(MESSAGE_TYPES['phone:gesture'].direction, 's2r');
  const state = { type: 'phone:state', mode: 'locked', style: 'glass', notifs: [{ id: 'n1', kind: 'sms', app: 'SMS', name: 'Maman', ago: 0 }] };
  assert.equal(validate(state, { direction: 'r2s' }), true);
  assert.equal(validate(state, { direction: 's2r' }), false, 'un écran ne décrit pas le téléphone');
  assert.equal(validate({ type: 'phone:gesture', g: 'touch' }, { direction: 's2r' }), true);
  assert.equal(validate({ type: 'phone:gesture', g: 'touch' }, { direction: 'r2s' }), false, 'la télécommande ne joue pas le comédien');
  assert.equal(validate({ type: 'phone:gesture', g: 'touch', target: { screens: ['AbCdEfGh12345678'] } }), false, 'pas de target s2r');
  assert.equal(validate({ ...state, target: { group: 'g1' } }), true, 'adressable comme tout ordre');
  // Pile : 8 notifications au plus, ids courts et uniques, âge en secondes (7 jours au plus)
  const pile = (/** @type {number} */ k) => ({ ...state, notifs: Array.from({ length: k }, (_, i) => ({ id: 'n' + i, kind: 'sms', app: 'SMS', name: 'A', ago: LIMITS.phoneAgoSeconds })) });
  assert.equal(LIMITS.phoneNotifs, 8);
  assert.equal(validate(pile(LIMITS.phoneNotifs)), true);
  assert.equal(validate(pile(LIMITS.phoneNotifs + 1)), false);
  assert.ok(PHONE_NOTIF_ID_RE.test('a'.repeat(12)) && !PHONE_NOTIF_ID_RE.test('a'.repeat(13)) && !PHONE_NOTIF_ID_RE.test(''));
  assert.equal(validate({ ...state, notifs: [{ id: 'n', kind: 'sms', app: 'SMS', name: 'A', msg: 'x'.repeat(201), ago: 0 }] }), false);
  // Déverrouillage : 4 ou 6 chiffres ou glisser (0) ; aucun code ni touche ne voyage
  for (const code of [0, 4, 6]) assert.equal(validate({ ...state, unlock: { code, then: 'app' } }), true, 'code ' + code);
  assert.equal(validate({ ...state, mode: 'code', unlock: { code: 6, then: 'home' } }), true);
  assert.equal(validate({ ...state, mode: 'code', unlock: { code: 0, then: 'home' } }), false, 'pavé : un code est attendu');
  assert.deepEqual(Object.keys(MESSAGE_TYPES['phone:state'].fields).sort(), ['alert', 'bar', 'chime', 'home', 'homeWall', 'mode', 'notifs', 'power', 'sleep', 'style', 'unlock', 'wall', 'watch']);
  assert.deepEqual(Object.keys(MESSAGE_TYPES['phone:gesture'].fields).sort(), ['g', 'n']);
  // Gestes : liste fermée ; « unlock » et « dismiss » toujours rapportés, donc jamais « attendus »
  assert.deepEqual([...PHONE_GESTURES], ['touch', 'notif', 'hangup', 'answer', 'unlock', 'home', 'dismiss']);
  for (const g of PHONE_GESTURES) assert.equal(validate({ type: 'phone:gesture', g }), true, g);
  assert.equal(validate({ type: 'phone:gesture', g: 'notif', n: 'n1' }), true);
  assert.equal(validate({ type: 'phone:gesture', g: 'dismiss', n: 'n1' }), false, 'n : geste notif seulement');
  assert.equal(validate({ ...state, watch: PHONE_GESTURES.filter((g) => g !== 'unlock' && g !== 'dismiss') }), true);
  assert.equal(validate({ ...state, watch: ['unlock'] }), false);
  // État complet chargé : bien en deçà du plafond d'un message
  const big = { ...state, notifs: Array.from({ length: 8 }, (_, i) => ({ id: 'n' + i, kind: 'notif', app: 'a'.repeat(24), name: 'b'.repeat(40), msg: 'c'.repeat(200), color: '#ffffff', ago: 604800 })), unlock: { code: 6, then: 'home' }, home: true, watch: ['touch'] };
  assert.equal(validate(big), true);
  assert.ok(utf8Encode(JSON.stringify(big)).length < MAX_MESSAGE_BYTES);
});

test('barre d’état, veille, batterie, extinction, réseau (28b, 29b, 33, 34) : sens, horloge, bornes', () => {
  const bar = { clock: { mode: 'run', date: '2026-10-17', time: '23:47', el: 0 }, net: { bars: 0, type: '4G', plane: false, wifi: false }, bat: { level: 5, charging: false, pct: true } };
  const state = { type: 'phone:state', mode: 'locked', style: 'glass', notifs: [], bar };
  // Sens : la télécommande décrit le téléphone ; un écran ne l’impose jamais
  assert.equal(MESSAGE_TYPES['media:bar'].direction, 'r2s');
  assert.equal(validate(state, { direction: 'r2s' }), true);
  assert.equal(validate(state, { direction: 's2r' }), false);
  assert.equal(validate({ type: 'media:bar', bar }, { direction: 's2r' }), false, 'un écran ne règle pas la barre');
  assert.equal(validate({ type: 'media:bar', bar, target: { group: 'g1' } }, { direction: 'r2s' }), true, 'ciblée comme les ordres média');
  // Horloge : run (el), frozen (date et heure, sans el), real (rien)
  const clock = (/** @type {object} */ c) => validate({ ...state, bar: { ...bar, clock: c } });
  assert.equal(clock({ mode: 'run', date: '2026-10-17', time: '23:47' }), true, 'el facultatif');
  assert.equal(clock({ mode: 'run', date: '2026-10-17', time: '23:47', el: LIMITS.phoneClockSeconds }), true);
  assert.equal(clock({ mode: 'run', date: '2026-10-17', time: '23:47', el: LIMITS.phoneClockSeconds + 1 }), false);
  assert.equal(clock({ mode: 'run', date: '2026-10-17', time: '23:47', el: -1 }), false);
  assert.equal(clock({ mode: 'frozen', date: '2026-10-17', time: '23:47' }), true);
  assert.equal(clock({ mode: 'frozen', time: '23:47' }), false);
  assert.equal(clock({ mode: 'real' }), true);
  assert.equal(clock({ mode: 'real', el: 3 }), false);
  assert.equal(clock({ mode: 'later' }), false);
  // Réseau 0 à 4 barres, 3G / 4G / 5G ; batterie 1 à 100 %
  for (const bars of [0, 1, 2, 3, 4]) assert.equal(validate({ ...state, bar: { ...bar, net: { ...bar.net, bars } } }), true, 'barres ' + bars);
  for (const type of ['3G', '4G', '5G']) assert.equal(validate({ ...state, bar: { ...bar, net: { ...bar.net, type } } }), true, type);
  assert.equal(validate({ ...state, bar: { ...bar, bat: { ...bar.bat, level: 101 } } }), false);
  assert.equal(validate({ ...state, bar: { ...bar, bat: { ...bar.bat, level: 50.5 } } }), false);
  // Veille : écran verrouillé (ou pavé) seulement, 1 à 120 s
  const sleep = { notif: true, touch: false, after: 8 };
  assert.equal(validate({ ...state, sleep }), true);
  assert.equal(validate({ ...state, mode: 'code', unlock: { code: 4, then: 'app' }, sleep }), true);
  for (const mode of ['off', 'unlocked', 'home']) assert.equal(validate({ ...state, mode, sleep }), false, 'veille ' + mode);
  assert.equal(validate({ ...state, sleep: { ...sleep, after: LIMITS.phoneSleepSeconds[1] } }), true);
  assert.equal(validate({ ...state, sleep: { ...sleep, after: LIMITS.phoneSleepSeconds[1] + 1 } }), false);
  // Batterie faible, extinction
  assert.equal(validate({ ...state, alert: { id: 'a1', level: 5 } }), true);
  assert.equal(validate({ ...state, power: 'off' }), true);
  assert.equal(validate({ ...state, power: 'on', watch: ['touch'] }), true);
  // Discussion : timings, frappe automatique, non distribué
  assert.equal(MESSAGE_TYPES['chat:type'].direction, 'r2s');
  assert.equal(validate({ type: 'chat:type', id: 'a', dur: 4, send: true }, { direction: 's2r' }), false, 'un écran ne déclenche pas la lecture auto');
  assert.equal(validate({ type: 'chat:type', id: 'a', dur: LIMITS.chatWriteSeconds[1], send: false }), true);
  assert.equal(validate({ type: 'chat:post', id: 'a', typing: true, dur: LIMITS.chatWriteSeconds[1] }), true);
  assert.equal(validate({ type: 'chat:sent', id: 'a', undelivered: true }, { direction: 's2r' }), true);
  assert.equal(validate({ type: 'chat:sent', id: 'a', undelivered: true }, { direction: 'r2s' }), false);
  // État complet le plus chargé : toujours sous le plafond d’un message
  const big = {
    ...state, notifs: Array.from({ length: 8 }, (_, i) => ({ id: 'n' + i, kind: 'notif', app: 'a'.repeat(24), name: 'b'.repeat(40), msg: 'c'.repeat(200), color: '#ffffff', ago: 604800 })),
    unlock: { code: 6, then: 'home' }, home: true, watch: ['touch'], sleep, alert: { id: 'a'.repeat(12), level: 100 },
    bar: { clock: { mode: 'run', date: '2026-10-17', time: '23:47', el: 604800 }, net: { bars: 4, type: '5G', plane: true, wifi: true }, bat: { level: 100, charging: true, pct: true } },
  };
  assert.equal(validate(big), true);
  assert.ok(utf8Encode(JSON.stringify(big)).length < MAX_MESSAGE_BYTES);
});

test('notification (kind notif) et discussion (chat:*) : sens, champs propres, bornes', () => {
  const n = (/** @type {object} */ o) => validate({ type: 'call:start', kind: 'notif', ...o });
  assert.equal(n({ present: 'banner', received: { mode: 'now' } }), true);
  assert.equal(n({ present: 'lock', phone: { time: '00:00' }, received: { mode: 'ago', min: 0 } }), true);
  assert.equal(n({ received: { mode: 'ago', min: LIMITS.notifAgoMinutes } }), true);
  assert.equal(n({ received: { mode: 'ago', min: LIMITS.notifAgoMinutes + 1 } }), false);
  assert.equal(n({ received: { mode: 'ago', min: 1.5 } }), false);
  assert.equal(n({ received: { mode: 'now', min: 3 } }), false, 'min hors mode ago');
  assert.equal(n({ received: { mode: 'ago', min: 3, date: '2025-01-01' } }), false);
  assert.equal(n({ phone: { date: '2025-13-01' } }), false);
  assert.equal(n({ phone: { date: '2025-02-31x' } }), false);
  assert.equal(n({ phone: { time: '9:05' } }), false, 'HH:MM sur deux chiffres');
  assert.equal(validate({ type: 'call:start', kind: 'chat', name: 'ancienne messagerie' }), true, 'anciennes télécommandes acceptées');
  // Sens : la télécommande parle à l'écran, l'écran ne renvoie que la progression et l'envoi
  for (const type of ['chat:open', 'chat:msg', 'chat:post', 'chat:close', 'chat:rewind']) assert.equal(MESSAGE_TYPES[type].direction, 'r2s', type);
  for (const type of ['chat:progress', 'chat:sent']) assert.equal(MESSAGE_TYPES[type].direction, 's2r', type);
  assert.equal(validate({ type: 'chat:post', id: 'a' }, { direction: 's2r' }), false, 'un écran ne poste pas pour le contact');
  assert.equal(validate({ type: 'chat:sent', id: 'a' }, { direction: 'r2s' }), false, 'la télécommande ne tape pas pour le comédien');
  assert.equal(validate({ type: 'chat:progress', id: 'a', typed: 1, total: 2, target: { screens: ['AbCdEfGh12345678'] } }), false, 'pas de target s2r');
  assert.equal(validate({ type: 'chat:progress', id: 'a', typed: 2, total: 2 }), true);
  assert.equal(validate({ type: 'chat:msg', id: 'a', from: 'actor', text: 'x'.repeat(LIMITS.chatTextChars) }), true);
  assert.equal(validate({ type: 'chat:open', name: 'M', style: 'minimal', ids: ['a', 'b'], sent: ['b'], typed: 301 }), false);
  assert.equal(validate({ type: 'chat:rewind', id: 'a' }, { direction: 's2r' }), false, 'un écran ne revient pas en arrière');
  // Reprise : l'historique est exactement le début du fil (jusqu'au point de reprise), sans lettre tapée
  const h = (/** @type {object} */ o) => validate({ type: 'chat:open', name: 'M', style: 'glass', ids: ['a', 'b', 'c'], history: true, ...o });
  assert.equal(h({ sent: [] }), true, 'reprise au n° 1');
  assert.equal(h({ sent: ['a', 'b'] }), true, 'reprise au n° 3');
  assert.equal(h({ sent: ['a', 'b', 'c'] }), true, 'tout en historique');
  assert.equal(h({ sent: ['b', 'a'] }), false, 'ordre du fil imposé');
  assert.equal(h({ sent: ['a'], typed: 0 }), true);
  assert.equal(h({ sent: ['a'], typed: 1 }), false);
  assert.equal(h({ sent: ['b', 'a'], history: false }), true, 'sans reprise : ordre de publication libre');
  assert.deepEqual([LIMITS.chatMessages, LIMITS.chatTextChars, LIMITS.chatNameChars], [40, 300, 40]);
});

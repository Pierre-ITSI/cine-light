// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Pont audio de l'appel décroché WebView ↔ natif (src/bridge.ts) : validation des messages de la page,
// assemblage de la bande son en fichier temporaire, ordre call-start / play / route / call-end, événements du
// natif remis à la page, et cohérence des noms entre TypeScript, Swift, Kotlin et la page web.
//
//   cd expo-app && npm test        (Node ≥ 22.18 : TypeScript sans transpilation)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  parseCommand, isAudioCommand, audioScript, audioExtension, audioFileName, cleanState, cleanReason, createAudioBridge,
  AUDIO_CHUNK, AUDIO_MAX_CHARS, AUDIO_MAX_CHUNKS, AUDIO_MAX_DELAY, AUDIO_KEEP_FILES, AUDIO_ERROR_REASONS,
} from '../src/bridge.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const moduleDir = path.join(here, '..');
const root = path.join(moduleDir, '..', '..', '..');
const read = (p) => readFileSync(path.join(moduleDir, p), 'utf8');
const b64 = (n) => 'A'.repeat(n);

const load = (o = {}) => ({ type: 'audio:load', id: 'a1b2c3d4-1x', mime: 'audio/mpeg', size: 12, i: 0, n: 1, data: 'QUJDREVGRw==', ...o });

// ───────────────────────────── validation ─────────────────────────────

test('messages étrangers au pont : null (luminosité, DMX, valeurs quelconques)', () => {
  for (const m of [null, undefined, 42, 'audio:play', [], {}, { type: 'brightness', value: 0.5 }, { type: 'dmx:listen' }, { type: 'AUDIO:PLAY' }, { type: 'audio:state' }, { type: 'audio:loaded' }]) {
    assert.equal(parseCommand(m), null, JSON.stringify(m));
    assert.equal(isAudioCommand(m), false);
  }
});

test('audio:call-start : sortie obligatoire (ear | speaker), proximité strictement booléenne', () => {
  assert.deepEqual(parseCommand({ type: 'audio:call-start', route: 'ear', proximity: true }), { ok: true, command: { type: 'audio:call-start', route: 'ear', proximity: true } });
  assert.deepEqual(parseCommand({ type: 'audio:call-start', route: 'speaker', proximity: 'oui' }).command.proximity, false);
  assert.deepEqual(parseCommand({ type: 'audio:call-start', route: 'speaker' }).command.proximity, false);
  for (const route of ['bluetooth', 'EAR', '', null, 1, undefined]) assert.deepEqual(parseCommand({ type: 'audio:call-start', route, proximity: true }), { ok: false, reason: 'route-failed', id: null }, String(route));
});

test('audio:route et audio:call-end', () => {
  assert.deepEqual(parseCommand({ type: 'audio:route', route: 'speaker' }), { ok: true, command: { type: 'audio:route', route: 'speaker' } });
  assert.deepEqual(parseCommand({ type: 'audio:route', route: 'x' }), { ok: false, reason: 'route-failed', id: null });
  assert.deepEqual(parseCommand({ type: 'audio:call-end', extra: 1 }), { ok: true, command: { type: 'audio:call-end' } });
});

test('audio:play : id sûr, délai borné de 0 à 15 s (NaN et non-nombres : 0)', () => {
  const p = (o) => parseCommand({ type: 'audio:play', id: 'a1-2', ...o });
  assert.deepEqual(p({ delay: 2 }).command, { type: 'audio:play', id: 'a1-2', delay: 2 });
  assert.equal(p({ delay: 99 }).command.delay, AUDIO_MAX_DELAY);
  assert.equal(AUDIO_MAX_DELAY, 15);
  assert.equal(p({ delay: -3 }).command.delay, 0);
  assert.equal(p({ delay: 1.5 }).command.delay, 1.5);
  for (const delay of [NaN, Infinity, '2', null, undefined]) assert.equal(p({ delay }).command.delay, 0, String(delay));
  for (const id of ['', 'a/b', '../x', 'a'.repeat(41), 'é', null, 5, undefined]) assert.deepEqual(p({ id, delay: 0 }), { ok: false, reason: 'not-loaded', id: null }, String(id));
});

test('audio:load : morceaux validés (forme, taille, ordre de grandeur, base64), type MIME audio seulement', () => {
  const r = parseCommand(load());
  assert.deepEqual(r, { ok: true, command: { type: 'audio:load', id: 'a1b2c3d4-1x', mime: 'audio/mpeg', size: 12, i: 0, n: 1, data: 'QUJDREVGRw==' } });
  assert.equal(parseCommand(load({ mime: 'text/html' })).command.mime, '', 'type non audio ignoré');
  assert.equal(parseCommand(load({ mime: undefined })).command.mime, '');
  const bad = (o) => parseCommand(load(o));
  const reason = (o) => { const r = bad(o); return r.ok ? 'ok' : r.reason; };
  for (const o of [{ id: 'a b' }, { id: undefined }, { i: -1 }, { i: 1 }, { i: 0.5 }, { n: 0 }, { n: AUDIO_MAX_CHUNKS + 1 }, { size: -1 }, { size: AUDIO_MAX_CHARS + 1 },
    { data: 12 }, { data: 'QUJD*' }, { data: 'QUJDRA=' }, { data: b64(AUDIO_CHUNK + 4) }, { size: '8' }, { n: 2 }]) assert.equal(reason(o), 'bad-chunk', JSON.stringify(o).slice(0, 60) + ' → ' + reason(o));
  // Morceau non final : exactement AUDIO_CHUNK caractères, sans bourrage
  assert.equal(reason({ size: AUDIO_CHUNK + 4, n: 2, i: 0, data: b64(AUDIO_CHUNK) }), 'ok');
  assert.equal(reason({ size: AUDIO_CHUNK + 4, n: 2, i: 0, data: b64(AUDIO_CHUNK - 4) }), 'bad-chunk');
  assert.equal(reason({ size: AUDIO_CHUNK + 4, n: 2, i: 1, data: b64(4) }), 'ok');
  // Le dernier morceau porte exactement le reste annoncé par `size` (ni tronqué, ni trop long)
  assert.equal(reason({ size: AUDIO_CHUNK + 4, n: 2, i: 1, data: b64(8) }), 'bad-chunk');
  assert.equal(reason({ size: AUDIO_CHUNK + 8, n: 2, i: 1, data: b64(4) }), 'bad-chunk');
  assert.equal(reason({ size: AUDIO_MAX_CHARS, n: AUDIO_MAX_CHUNKS, i: AUDIO_MAX_CHUNKS - 1, data: b64(AUDIO_CHUNK) }), 'ok');
  assert.equal(reason({ size: AUDIO_MAX_CHARS, n: AUDIO_MAX_CHUNKS, i: AUDIO_MAX_CHUNKS - 1, data: b64(4) }), 'bad-chunk');
});

test('extensions et noms de fichiers temporaires', () => {
  assert.deepEqual(['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/x-caf', '', 'audio/xyz'].map(audioExtension),
    ['mp3', 'm4a', 'm4a', 'm4a', 'wav', 'wav', 'ogg', 'caf', 'm4a', 'm4a']);
  assert.equal(audioFileName('a1-2', 'audio/mpeg'), 'voix-a1-2.mp3');
  assert.equal(audioFileName('a1-2', undefined), 'voix-a1-2.m4a');
});

test('scripts injectés : message remis à window.SRNative.receive, séparateurs de ligne échappés', () => {
  const sent = [];
  const ctx = vm.createContext({ window: { SRNative: { receive: (m) => sent.push(m) } } });
  for (const m of [{ type: 'audio:state', route: 'speaker', proximityNear: true }, { type: 'audio:loaded', id: 'x y z' }, { type: 'audio:error', reason: 'play-failed' }]) {
    const s = audioScript(m);
    assert.ok(!s.includes(' ') && !s.includes(' '));
    vm.runInContext(s, ctx);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ type: 'audio:state', route: 'speaker', proximityNear: true }, { type: 'audio:loaded', id: 'x y z' }, { type: 'audio:error', reason: 'play-failed' }]);
  // Sans SRNative (page pas prête) : aucune erreur
  assert.doesNotThrow(() => vm.runInContext(audioScript({ type: 'audio:loaded', id: 'x' }), vm.createContext({ window: {} })));
});

test('événements du natif nettoyés avant la page', () => {
  assert.deepEqual(cleanState({ route: 'ear', proximityNear: false, proximityAvailable: true, extra: 1 }), { type: 'audio:state', route: 'ear', proximityNear: false, proximityAvailable: true });
  assert.deepEqual(cleanState({ route: 'bluetooth', proximityNear: 'x' }), { type: 'audio:state' });
  assert.deepEqual(cleanState(null), { type: 'audio:state' });
  assert.equal(cleanReason('session-failed'), 'session-failed');
  assert.equal(cleanReason('<script>'), 'play-failed');
  assert.equal(cleanReason(undefined), 'play-failed');
});

// ───────────────────────────── le pont ─────────────────────────────

function rig({ native = true, tempFails = false, nativeFails = null } = {}) {
  const posts = [], files = [], calls = [], listeners = {};
  const fakeNative = native ? {
    startCall: (...a) => { calls.push(['startCall', ...a]); return nativeFails === 'startCall' ? Promise.reject(new Error('x')) : Promise.resolve(); },
    play: (...a) => { calls.push(['play', ...a]); return nativeFails === 'play' ? Promise.reject(new Error('x')) : Promise.resolve(); },
    setRoute: (...a) => { calls.push(['setRoute', ...a]); return nativeFails === 'setRoute' ? Promise.reject(new Error('x')) : Promise.resolve(); },
    endCall: () => { calls.push(['endCall']); return Promise.resolve(); },
    addListener: (name, fn) => { listeners[name] = fn; return { remove: () => { calls.push(['remove', name]); delete listeners[name]; } }; },
  } : null;
  const bridge = createAudioBridge({
    native: fakeNative,
    createTemp: (name) => {
      if (tempFails) return null;
      const f = { name, chunks: [], deleted: false, uri: 'file:///cache/' + name, write(d, append) { if (!append) this.chunks = []; this.chunks.push(d); }, delete() { this.deleted = true; } };
      files.push(f);
      return f;
    },
    inject: (s) => posts.push(JSON.parse(JSON.stringify(vm.runInNewContext('(function(){var r;var window={SRNative:{receive:function(m){r=m}}};' + s + ';return r})()')))),
  });
  const flush = () => new Promise((r) => setImmediate(r));
  return { bridge, posts, files, calls, listeners, flush };
}
const tick = () => new Promise((r) => setImmediate(r));

test('bande son : morceaux dans l\'ordre → fichier temporaire (nom d\'après le type) → audio:loaded', () => {
  const r = rig();
  const total = AUDIO_CHUNK + 8;
  assert.equal(r.bridge.handle({ type: 'audio:load', id: 'v1', mime: 'audio/mpeg', size: total, i: 0, n: 2, data: b64(AUDIO_CHUNK) }), true);
  assert.deepEqual(r.posts, []);
  assert.equal(r.files.length, 1);
  assert.equal(r.files[0].name, 'voix-v1.mp3');
  r.bridge.handle({ type: 'audio:load', id: 'v1', mime: 'audio/mpeg', size: total, i: 1, n: 2, data: 'QUJDREU=' });
  assert.deepEqual(r.posts, [{ type: 'audio:loaded', id: 'v1' }]);
  assert.equal(r.files[0].chunks.length, 2);
});

test('bande son : morceau hors d\'ordre, écriture impossible, fichier trop gros → audio:error, et la reprise est possible', () => {
  let r = rig();
  r.bridge.handle({ type: 'audio:load', id: 'v1', mime: '', size: AUDIO_CHUNK + 8, i: 1, n: 2, data: 'QUJDREU=' });
  assert.deepEqual(r.posts, [{ type: 'audio:error', reason: 'bad-chunk' }], 'le premier morceau manque');
  r = rig();
  r.bridge.handle({ type: 'audio:load', id: 'v1', mime: '', size: AUDIO_CHUNK + 8, i: 0, n: 2, data: b64(AUDIO_CHUNK) });
  r.bridge.handle({ type: 'audio:load', id: 'v2', mime: '', size: 12, i: 0, n: 1, data: 'QUJDREVGRw==' });
  assert.deepEqual(r.posts.map((p) => p.type), ['audio:loaded'], 'un nouveau fichier remplace le transfert en cours');
  r.bridge.handle({ type: 'audio:load', id: 'v1', mime: '', size: AUDIO_CHUNK + 8, i: 1, n: 2, data: 'QUJDREU=' });
  assert.deepEqual(r.posts.slice(1), [{ type: 'audio:error', reason: 'bad-chunk' }]);
  r = rig({ tempFails: true });
  r.bridge.handle(load());
  assert.deepEqual(r.posts, [{ type: 'audio:error', reason: 'write-failed' }]);
  r = rig();
  r.bridge.handle(load({ size: AUDIO_MAX_CHARS + 4 }));
  assert.deepEqual(r.posts, [{ type: 'audio:error', reason: 'bad-chunk' }]);
  assert.equal(r.files.length, 0, 'rien n\'est écrit');
});

test('appel : call-start, play (délai, fichier du module), route, call-end — dans cet ordre, une seule fin', async () => {
  const r = rig();
  r.bridge.handle(load({ id: 'v1' }));
  r.bridge.handle({ type: 'audio:call-start', route: 'ear', proximity: true });
  assert.equal(r.bridge.inCall, true);
  r.bridge.handle({ type: 'audio:play', id: 'v1', delay: 2 });
  r.bridge.handle({ type: 'audio:route', route: 'speaker' });
  r.bridge.handle({ type: 'audio:route', route: 'ear' });
  r.bridge.handle({ type: 'audio:call-end' });
  r.bridge.handle({ type: 'audio:call-end' }); // deuxième fin : sans effet
  await tick();
  assert.deepEqual(r.calls, [['startCall', 'ear', true], ['play', 'file:///cache/voix-v1.mp3', 2], ['setRoute', 'speaker'], ['setRoute', 'ear'], ['endCall']]);
  assert.equal(r.bridge.inCall, false);
  assert.deepEqual(r.posts.map((p) => p.type), ['audio:loaded']);
});

test('erreurs : play d\'une bande son absente, refus du natif, module absent (Expo Go)', async () => {
  let r = rig();
  r.bridge.handle({ type: 'audio:play', id: 'inconnu', delay: 0 });
  assert.deepEqual(r.posts, [{ type: 'audio:error', reason: 'not-loaded' }]);
  assert.deepEqual(r.calls, []);
  r = rig({ nativeFails: 'startCall' });
  r.bridge.handle({ type: 'audio:call-start', route: 'ear', proximity: false });
  await tick();
  assert.deepEqual(r.posts, [{ type: 'audio:error', reason: 'session-failed' }]);
  r = rig({ nativeFails: 'play' });
  r.bridge.handle(load({ id: 'v1' }));
  r.bridge.handle({ type: 'audio:play', id: 'v1', delay: 0 });
  await tick();
  assert.deepEqual(r.posts.map((p) => p.reason || p.type), ['audio:loaded', 'play-failed']);
  r = rig({ nativeFails: 'setRoute' });
  r.bridge.handle({ type: 'audio:route', route: 'speaker' });
  await tick();
  assert.deepEqual(r.posts, [{ type: 'audio:error', reason: 'route-failed' }]);
  // Module absent : tout est refusé proprement, rien ne plante, les messages sont tout de même traités
  r = rig({ native: false });
  assert.equal(r.bridge.handle({ type: 'audio:call-start', route: 'ear', proximity: true }), true);
  r.bridge.handle({ type: 'audio:play', id: 'v1', delay: 0 });
  r.bridge.handle({ type: 'audio:route', route: 'speaker' });
  r.bridge.handle({ type: 'audio:call-end' });
  assert.deepEqual(r.posts.map((p) => p.reason), ['unavailable', 'unavailable', 'unavailable']);
  assert.equal(r.bridge.inCall, false);
  // Message invalide : refus, jamais d'appel natif
  r = rig();
  assert.equal(r.bridge.handle({ type: 'audio:call-start', route: 'bluetooth' }), true);
  assert.deepEqual(r.posts, [{ type: 'audio:error', reason: 'route-failed' }]);
  assert.deepEqual(r.calls, []);
});

test('événements du natif (sortie, proximité, erreur) remis à la page, nettoyés', () => {
  const r = rig();
  assert.deepEqual(Object.keys(r.listeners).sort(), ['onSetRemoteAudioError', 'onSetRemoteAudioState']);
  r.listeners.onSetRemoteAudioState({ route: 'speaker', proximityNear: true, junk: 1 });
  r.listeners.onSetRemoteAudioState({ proximityAvailable: false });
  r.listeners.onSetRemoteAudioError({ reason: 'session-failed' });
  r.listeners.onSetRemoteAudioError({ reason: 'n\'importe quoi' });
  r.listeners.onSetRemoteAudioError(undefined);
  assert.deepEqual(r.posts, [
    { type: 'audio:state', route: 'speaker', proximityNear: true },
    { type: 'audio:state', proximityAvailable: false },
    { type: 'audio:error', reason: 'session-failed' },
    { type: 'audio:error', reason: 'play-failed' },
    { type: 'audio:error', reason: 'play-failed' },
  ]);
});

test('fichiers temporaires : les plus anciens effacés (jamais celui qui joue), reset et dispose', async () => {
  const r = rig();
  for (const id of ['v1', 'v2', 'v3']) r.bridge.handle(load({ id }));
  r.bridge.handle({ type: 'audio:call-start', route: 'ear', proximity: false });
  r.bridge.handle({ type: 'audio:play', id: 'v1', delay: 0 });
  r.bridge.handle(load({ id: 'v4' }));
  assert.equal(AUDIO_KEEP_FILES, 3);
  assert.deepEqual(r.files.map((f) => [f.name, f.deleted]), [['voix-v1.mp3', false], ['voix-v2.mp3', true], ['voix-v3.mp3', false], ['voix-v4.mp3', false]], 'v1 joue : v2 part');
  // Même contenu retransmis : le fichier est remplacé, pas dupliqué
  r.bridge.handle(load({ id: 'v3' }));
  assert.deepEqual(r.files.filter((f) => f.name === 'voix-v3.mp3').map((f) => f.deleted), [true, false]);
  // La page change : appel terminé côté natif, fichiers effacés ; play d'un ancien id refusé
  r.bridge.reset();
  await tick();
  assert.equal(r.calls.at(-1)[0], 'endCall');
  assert.ok(r.files.every((f) => f.deleted));
  r.bridge.handle({ type: 'audio:play', id: 'v1', delay: 0 });
  assert.equal(r.posts.at(-1).reason, 'not-loaded');
  // dispose : désabonnement, plus rien n'est injecté
  r.bridge.dispose();
  assert.deepEqual(r.calls.filter((c) => c[0] === 'remove').map((c) => c[1]).sort(), ['onSetRemoteAudioError', 'onSetRemoteAudioState']);
  const n = r.posts.length;
  r.bridge.handle({ type: 'audio:play', id: 'v1', delay: 0 });
  assert.equal(r.posts.length, n);
});

// ───────────────────────────── cohérence des noms ─────────────────────────────

test('noms d\'événements et de fonctions identiques en TypeScript, Swift et Kotlin', () => {
  const ts = read('src/SetRemoteAudioModule.ts') + read('src/bridge.ts');
  const swift = read('ios/SetRemoteAudioModule.swift');
  const kt = read('android/src/main/java/expo/modules/setremoteaudio/SetRemoteAudioModule.kt');
  for (const ev of ['onSetRemoteAudioState', 'onSetRemoteAudioError']) {
    assert.ok(ts.includes(ev), 'ts ' + ev);
    assert.ok(swift.includes('"' + ev + '"'), 'swift ' + ev);
    assert.ok(kt.includes('"' + ev + '"'), 'kt ' + ev);
  }
  for (const fn of ['startCall', 'play', 'setRoute', 'endCall']) {
    assert.ok(new RegExp('\\b' + fn + '\\(').test(ts), 'ts ' + fn);
    assert.ok(swift.includes('AsyncFunction("' + fn + '")'), 'swift ' + fn);
    assert.ok(kt.includes('AsyncFunction("' + fn + '")'), 'kt ' + fn);
  }
  assert.ok(swift.includes('Name("SetRemoteAudio")') && kt.includes('Name("SetRemoteAudio")') && ts.includes("requireOptionalNativeModule<SetRemoteAudioModule>('SetRemoteAudio')"));
  const cfg = JSON.parse(read('expo-module.config.json'));
  assert.deepEqual(cfg.apple.modules, ['SetRemoteAudioModule']);
  assert.deepEqual(cfg.android.modules, ['expo.modules.setremoteaudio.SetRemoteAudioModule']);
  assert.ok(kt.startsWith('// SPDX') && kt.includes('package expo.modules.setremoteaudio'));
  // Raisons d'erreur émises par le natif : toutes connues du pont
  const native = swift + read('ios/CallAudio.swift') + kt + read('android/src/main/java/expo/modules/setremoteaudio/CallAudio.kt');
  const emitted = new Set([...native.matchAll(/(?:onError\??\.?\(?|onError\(|"reason" to )"([a-z-]+)"/g)].map((m) => m[1]));
  assert.ok(emitted.size >= 3, [...emitted].join());
  for (const reason of emitted) assert.ok(AUDIO_ERROR_REASONS.includes(reason), reason);
});

test('natif : session et sorties documentées (iOS playAndRecord / voiceChat / override ; Android MODE_IN_COMMUNICATION / USAGE_VOICE_COMMUNICATION / proximité)', () => {
  const ios = read('ios/CallAudio.swift');
  for (const k of ['.playAndRecord', '.voiceChat', 'overrideOutputAudioPort', 'isProximityMonitoringEnabled', 'proximityStateDidChangeNotification', 'routeChangeNotification', 'interruptionNotification', 'play(atTime:', 'notifyOthersOnDeactivation']) assert.ok(ios.includes(k), 'ios ' + k);
  // Aucune entrée n'est ouverte : pas d'AVAudioEngine ni de demande de permission micro
  assert.ok(!/AVAudioEngine|requestRecordPermission|AVAudioRecorder|inputNode/.test(ios));
  const and = read('android/src/main/java/expo/modules/setremoteaudio/CallAudio.kt');
  for (const k of ['MODE_IN_COMMUNICATION', 'USAGE_VOICE_COMMUNICATION', 'CONTENT_TYPE_SPEECH', 'setCommunicationDevice', 'clearCommunicationDevice', 'isSpeakerphoneOn', 'PROXIMITY_SCREEN_OFF_WAKE_LOCK', 'isWakeLockLevelSupported', 'AUDIOFOCUS_GAIN_TRANSIENT', 'TYPE_BUILTIN_EARPIECE', 'TYPE_BUILTIN_SPEAKER']) assert.ok(and.includes(k), 'android ' + k);
  assert.ok(!/RECORD_AUDIO|AudioRecord|MediaRecorder/.test(and));
  const manifest = read('android/src/main/AndroidManifest.xml');
  assert.deepEqual([...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map((m) => m[1]), ['android.permission.MODIFY_AUDIO_SETTINGS', 'android.permission.WAKE_LOCK']);
});

test('page web : le pont documenté (00-native-bridge.js) et les messages émis par 80-call-simulator.js correspondent au contrat', () => {
  const web = readFileSync(path.join(root, 'web', 'js', '80-call-simulator.js'), 'utf8');
  const bridge = readFileSync(path.join(root, 'web', 'js', '00-native-bridge.js'), 'utf8');
  const sent = new Set([...web.matchAll(/nativePost\(\{ type: '(audio:[a-z-]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...sent].sort(), ['audio:call-end', 'audio:call-start', 'audio:load', 'audio:play', 'audio:route']);
  for (const t of sent) assert.ok(isAudioCommand({ type: t }), t);
  for (const t of [...sent, 'audio:state', 'audio:loaded', 'audio:error']) assert.ok(bridge.includes(t), 'documenté : ' + t);
  // Même taille de morceau des deux côtés
  assert.equal(Number(/const AUDIO_CHUNK = (\d+) \* (\d+)/.exec(web).slice(1).reduce((a, b) => a * b, 1)), AUDIO_CHUNK);
});

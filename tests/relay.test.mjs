// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Relais WebSocket privé (relay/server.js) avec la VRAIE app : une instance du
// relais tourne dans ce processus (port aléatoire, preuve relayAuth exigée) et
// les pages s'y connectent (RELAY_URL fourni par window.SETREMOTE_CONFIG).
// Appairage par QR et par code, commandes, vidéo (signalisation WebRTC via le
// relais), redémarrage du relais → reconnexion + resynchronisation, repli MQTT
// seulement s'il est autorisé, et RELAY_URL vide = comportement historique.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, pairingHash } from './helpers/harness.mjs';
import { createRelay } from '../relay/server.js';

const BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';
const LOCAL_STUN = ['stun:127.0.0.1:3478'];
let browser, relay, port;
async function startRelay(p = 0) {
  relay = createRelay({ requireAuth: true, memLimitMb: 1 << 16 });
  port = (await relay.listen(p, '127.0.0.1')).port;
}
before(async () => { browser = await launchBrowser(); await startRelay(); });
after(async () => { await relay?.close(200); await browser?.close(); });

// Configuration injectée avant l'app (comme le ferait une coque native)
const config = (cfg) => ({ fn: (c) => { window.SETREMOTE_CONFIG = c; }, arg: cfg });
const viaRelay = (extra = {}) => config({ RELAY_URL: `ws://127.0.0.1:${port}`, STUN_URLS: LOCAL_STUN, ...extra });
const connected = (page, timeout = 8000) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout });
const pill = (page) => page.evaluate(() => document.getElementById('linkPillLabel').textContent);
const verifyShown = (page) => waitFor(page, () => document.getElementById('pair-verify').style.display === 'block', null, { timeout: 8000 });

async function startRemote(seed) {
  const r = await openPage(browser, { seed, init: viaRelay() });
  await r.page.evaluate(() => startMode('remote'));
  await connected(r.page);
  return r;
}

test('relais : QR — télécommande et deux écrans via le relais réel, commandes, preuve relayAuth', async () => {
  const remote = await startRemote(201);
  const rp = remote.page;
  const t = await rp.evaluate(() => ({
    cls: mqttClient.constructor.name, url: mqttClient.url, protocols: mqttClient.protocols, fakeMqtt: window.__mqttClients.length,
    topic: _sec.topic, relayAuth: _sec.relayAuth,
  }));
  assert.equal(t.cls, 'RelayClient');
  assert.equal(t.url, `ws://127.0.0.1:${port}/v2/s/${t.topic}`, 'topic opaque dans le chemin, rien d\'autre');
  assert.deepEqual(t.protocols, ['setremote.v2', 'auth.' + t.relayAuth], 'preuve dans Sec-WebSocket-Protocol');
  assert.equal(t.fakeMqtt, 0, 'aucun client MQTT créé');
  const hash = await pairingHash(rp);
  const A = await openPage(browser, { seed: 202, hash, init: viaRelay() });
  const B = await openPage(browser, { seed: 203, hash, init: viaRelay() });
  await connected(A.page); await connected(B.page);
  await waitFor(rp, () => _pairedScreens.size === 2);
  assert.equal(await pill(rp), 'Internet', 'libellé inchangé');
  await rp.evaluate(() => { setKelvin(2700); toggleBlackout(); });
  const color = await rp.evaluate(() => currentColor);
  for (const s of [A, B]) await waitFor(s.page, (c) => screenBaseColor === c && screenBlackoutOn === true, color);
  await rp.evaluate(() => toggleBlackout());
  for (const s of [A, B]) await waitFor(s.page, () => screenBlackoutOn === false);
  const st = relay.stats();
  assert.deepEqual([st.rooms, st.sockets, st.tofu_entries], [1, 3, 1]);
  assert.ok(st.counters.frames_in > 5 && st.counters.closed_charset === 0 && st.counters.closed_size === 0);
  for (const p of [remote, A, B]) assert.deepEqual(p.errors, []);
  await A.close(); await B.close(); await remote.close();
});

test('relais : appairage par code (rendez-vous), session commune, vidéo pair-à-pair signalée via le relais', async () => {
  const remote = await startRemote(211);
  const rp = remote.page;
  // STUN_URLS configuré : utilisé par les deux pairs WebRTC
  await rp.evaluate(() => {
    const R = window.RTCPeerConnection;
    window.RTCPeerConnection = function (cfg) { window.__ice = cfg.iceServers; return new R(cfg); };
    switchTab('qr');
  });
  await waitFor(rp, () => _rdv && _rdv.client && _rdv.client.connected);
  assert.match(await rp.evaluate(() => _rdv.client.url), new RegExp(`^ws://127\\.0\\.0\\.1:${port}/v2/rdv/[A-Za-z0-9_-]{22}$`));
  const code = await rp.evaluate(() => document.getElementById('pairCode').textContent);
  const screen = await openPage(browser, { seed: 212, init: viaRelay() });
  const sp = screen.page;
  await sp.evaluate(() => startMode('screen'));
  await sp.fill('#pairCodeInput', code.replace('·', '-'));
  await sp.click('#screen-connect .screen-go-btn');
  await verifyShown(sp); await verifyShown(rp);
  assert.equal(relay.stats().rdv_rooms, 1);
  const sas = await rp.evaluate(() => document.getElementById('pvSas').textContent);
  assert.equal(await sp.evaluate(() => document.getElementById('pvSas').textContent), sas);
  await sp.click('#pvOk');
  await rp.click('#pvOk');
  await connected(sp);
  assert.deepEqual(await sp.evaluate(() => _session), await rp.evaluate(() => _session));
  await waitFor(rp, () => _pairedScreens.size === 1);
  await rp.evaluate(() => setKelvin(3200));
  await waitFor(sp, (c) => screenBaseColor === c, await rp.evaluate(() => currentColor));
  // Vidéo : offre / réponse / ICE scellées passent par le relais, le fichier par le canal de données
  await sp.evaluate(() => {
    const R = window.RTCPeerConnection;
    window.RTCPeerConnection = function (cfg) { window.__ice = cfg.iceServers; return new R(cfg); };
  });
  await rp.evaluate(() => {
    const bytes = new Uint8Array(120000).map((_, i) => (i * 5) & 255);
    broadcastVideo(new File([bytes], 'plan.mp4', { type: 'video/mp4' }), 'v1');
  });
  await waitFor(sp, () => _mediaCache.has('v1') && _mediaCache.get('v1').kind === 'vid', null, { timeout: 20000 });
  assert.deepEqual(await rp.evaluate(() => [_rtcTransferDone, _rtcBroken]), [true, false]);
  for (const p of [rp, sp]) assert.deepEqual(await p.evaluate(() => window.__ice), [{ urls: ['stun:127.0.0.1:3478'] }]);
  await waitFor(rp, () => !_rdvBackground.size, null, { timeout: 25000 }); // remise du secret terminée
  // Le relais libère la salle à la fin de la fermeture WebSocket (asynchrone) :
  // seule reste celle du code suivant
  for (let i = 0; i < 100 && relay.stats().rdv_rooms > 1; i++) await sleep(20);
  assert.equal(relay.stats().rdv_rooms <= 1, true);
  assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remote.close();
});

test('relais : redémarrage → reconnexion automatique, TOFU réarmé, resynchronisation de l\'écran', async () => {
  const remote = await startRemote(221);
  const rp = remote.page;
  const screen = await openPage(browser, { seed: 222, hash: await pairingHash(rp), init: viaRelay() });
  const sp = screen.page;
  await connected(sp);
  await waitFor(rp, () => _pairedScreens.size === 1);
  await rp.evaluate(() => setKelvin(2700));
  await waitFor(sp, (c) => screenBaseColor === c, await rp.evaluate(() => currentColor));
  // Arrêt du relais (déploiement, redémarrage du VPS…)
  await relay.close(500);
  await waitFor(rp, () => !mqttClient.connected);
  await waitFor(rp, () => document.getElementById('linkPillLabel').textContent === 'Reconnexion…');
  // Pendant la coupure, la télécommande change d'état (rien ne part)
  await rp.evaluate(() => { setKelvin(9000); toggleBlackout(); });
  const color = await rp.evaluate(() => currentColor);
  assert.notEqual(await sp.evaluate(() => screenBaseColor), color);
  await sleep(300);
  await startRelay(port); // même adresse, mémoire vide : la 1re preuve présentée fait foi
  await connected(rp, 20000); await connected(sp, 20000);
  // L'écran retrouve l'état exact de la télécommande (hello → caps → resynchronisation)
  await waitFor(sp, (c) => screenBaseColor === c && screenBlackoutOn === true, color, { timeout: 10000 });
  await waitFor(rp, () => document.getElementById('linkPillLabel').textContent === 'Internet');
  assert.equal(relay.stats().tofu_entries, 1);
  assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remote.close();
});

test('relais injoignable : repli sur le broker public SEULEMENT si RELAY_FALLBACK_MQTT', async () => {
  const dead = createRelay();
  const deadPort = (await dead.listen(0, '127.0.0.1')).port;
  await dead.close(0); // port libéré : connexion refusée
  const cfg = (fallback) => config({ RELAY_URL: `ws://127.0.0.1:${deadPort}`, RELAY_FALLBACK_MQTT: fallback });
  const [strict, lenient] = await Promise.all([false, true].map((f) => openPage(browser, { autoConnect: true, init: cfg(f) })));
  await Promise.all([strict, lenient].map((p) => p.page.evaluate(() => startMode('remote'))));
  // Avec repli : après 3 échecs, le broker public prend le relais (trames toujours scellées)
  await connected(lenient.page, 15000);
  assert.deepEqual(await lenient.page.evaluate(() => [mqttClient.constructor.name, mqttClient._inner.url, window.__mqttClients.length]),
    ['RelayClient', BROKER_URL, 1]);
  // Sans repli (défaut) : jamais de broker public, la liaison reste « Connexion… »
  await waitFor(strict.page, () => mqttClient._fails >= 4, null, { timeout: 20000 });
  assert.deepEqual(await strict.page.evaluate(() => [mqttClient.connected, window.__mqttClients.length, !!mqttClient._inner]), [false, 0, false]);
  assert.equal(await pill(strict.page), 'Connexion…');
  for (const p of [strict, lenient]) { assert.deepEqual(p.errors, []); await p.close(); }
});

test('RELAY_URL vide (défaut) : broker public et STUN Google comme avant ; configuration invalide ignorée', async () => {
  const before = relay.stats().counters.accepted;
  const page = (await openPage(browser, { autoConnect: true })).page;
  await page.evaluate(() => startMode('remote'));
  await connected(page);
  assert.deepEqual(await page.evaluate(() => [RELAY_URL, RELAY_FALLBACK_MQTT, [...STUN_URLS], mqttClient.url, Array.isArray(mqttClient.published)]),
    ['', false, ['stun:stun.l.google.com:19302'], BROKER_URL, true]);
  await page.evaluate(() => switchTab('qr'));
  await waitFor(page, () => _rdv && _rdv.client);
  assert.equal(await page.evaluate(() => _rdv.client.url), BROKER_URL, 'rendez-vous aussi sur le broker public');
  assert.equal(relay.stats().counters.accepted, before, 'aucune connexion au relais');
  // Valeurs invalides : défauts (http://, wss:// avec requête, STUN non conforme, booléen en texte)
  for (const [cfg, expected] of [
    [{ RELAY_URL: 'http://relais.example', STUN_URLS: 'stun:x', RELAY_FALLBACK_MQTT: 'yes' }, ['', false, ['stun:stun.l.google.com:19302']]],
    [{ RELAY_URL: 'wss://relais.example/?k=1', STUN_URLS: ['turn:x:3478'] }, ['', false, ['stun:stun.l.google.com:19302']]],
    [{ RELAY_URL: 'ws://relais.example' }, ['', false, ['stun:stun.l.google.com:19302']]],
    [{ RELAY_URL: 'wss://relais.example/', STUN_URLS: ['stun:relais.example:3478'], RELAY_FALLBACK_MQTT: true }, ['wss://relais.example', true, ['stun:relais.example:3478']]],
  ]) {
    const p = await openPage(browser, { init: config(cfg) });
    assert.deepEqual(await p.page.evaluate(() => [RELAY_URL, RELAY_FALLBACK_MQTT, [...STUN_URLS]]), expected, JSON.stringify(cfg));
    await p.close();
  }
});

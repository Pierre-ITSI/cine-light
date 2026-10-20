// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Tourner sans réseau (maquette 10, docs/OFFLINE.md) : liaisons locales
// Wi-Fi local / Bluetooth par le pont natif (faux pont FakeLinkHub qui relie
// les pages entre elles), trames sur toutes les liaisons et doublons écartés,
// Bluetooth réservé aux commandes (plafond 4 Kio), choix de liaison (Auto,
// bascule, persistance), préparation des écrans, repli navigateur, retrait
// d'un écran en Wi-Fi local, premier appairage par QR sans Internet.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, SRP, pairingHash, fakePeer } from './helpers/harness.mjs';
import { FakeLinkHub, BLE_MAX } from './helpers/links.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const NATIVE = FakeLinkHub.init();
const base = (s) => s.page.evaluate(() => screenBaseColor);
const pill = (page) => page.evaluate(() => [document.getElementById('linkPill').className.replace('link-pill ', ''), document.getElementById('linkPillLabel').textContent]);
const noErrors = (r) => { for (const p of [r.remote, ...r.screens]) assert.deepEqual(p.errors, []); };
// Internet coupé / rétabli pour une page (faux client MQTT courant)
const cutInternet = (page) => page.evaluate(() => { window.__fakeAutoConnect = false; if (mqttClient && mqttClient.connected) mqttClient._drop(); });
const restoreInternet = (page) => page.evaluate(() => { if (mqttClient && !mqttClient.connected) mqttClient._connect(); });

// Télécommande + n écrans dans l'app (pont simulé), appairés par le lien (QR)
async function rig(n, seed, { available, keys = false } = {}) {
  const broker = new FakeBroker(), hub = new FakeLinkHub();
  const remote = await openPage(browser, { broker: hub.with(broker, { available }), seed, autoConnect: true, init: NATIVE });
  const rp = remote.page;
  await rp.evaluate(() => startMode('remote'));
  await waitFor(rp, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
  const hash = await pairingHash(rp);
  const screens = [];
  for (let i = 0; i < n; i++) {
    const s = await openPage(browser, { broker: hub.with(broker, { available }), seed: seed * 10 + i, autoConnect: true, hash, init: NATIVE });
    await waitFor(s.page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
    s.id = await s.page.evaluate(() => screenId());
    screens.push(s);
  }
  await waitFor(rp, (k) => _screenOfSender.size === k && scrList().length === k, n, { timeout: 8000 });
  const r = { broker, hub, remote, rp, screens };
  if (keys) {
    for (const s of screens) {
      await waitFor(s.page, () => !!_pw, null, { timeout: 8000 });
      const kid = await s.page.evaluate(() => _pw.kid);
      await waitFor(rp, ([id, kid]) => { const e = _scrReg.screens.get(id); return !!e && !!e.pk && e.pk.ok && e.pk.kid === kid; }, [s.id, kid], { timeout: 8000 });
    }
  }
  await waitFor(rp, () => _resyncTimer === null);
  await sleep(300);
  await hub.flush(); await broker.flush();
  r.close = async () => { for (const s of screens) await s.close(); await remote.close(); };
  return r;
}
// Toutes les pages ont leurs pairs locaux
const localPeers = (r, mode, k) => Promise.all([
  waitFor(r.rp, ([m, k]) => linkPeerCount(m) === k, [mode, k ?? r.screens.length], { timeout: 8000 }),
  ...r.screens.map((s) => waitFor(s.page, (m) => linkPeerCount(m) === 1, mode, { timeout: 8000 })),
]);

test('Internet coupé, Wi-Fi local actif : commandes et médias continuent, pastille « Wi-Fi local »', async () => {
  const r = await rig(2, 61);
  const [A, B] = r.screens;
  const { rp, hub } = r;
  await localPeers(r, 'lan');
  await localPeers(r, 'ble');
  // Coque : link:start avec la salle = topic de la session, rôles
  const start = hub.posted(rp, 'link:start').at(-1);
  assert.deepEqual(start, { type: 'link:start', modes: ['lan', 'ble'], role: 'remote', room: await rp.evaluate(() => _sec.topic) });
  assert.equal(start.room.length, 22);
  assert.deepEqual(hub.posted(A.page, 'link:start').at(-1).role, 'screen');
  assert.deepEqual(await pill(rp), ['online', 'Internet']);
  // Internet coupé partout
  for (const p of [rp, A.page, B.page]) await cutInternet(p);
  await waitFor(rp, () => document.getElementById('linkPillLabel').textContent === 'Wi-Fi local');
  assert.deepEqual(await pill(rp), ['lan', 'Wi-Fi local']);
  hub.clear();
  await rp.evaluate(() => setKelvin(2700));
  const warm = await rp.evaluate(() => currentColor);
  for (const s of [A, B]) await waitFor(s.page, (c) => screenBaseColor === c, warm);
  // Liaison de chaque écran (maquette 5)
  await rp.evaluate(() => openScreensView());
  assert.deepEqual(await rp.$$eval('#svList .sv-link', (els) => els.map((e) => [e.className, e.textContent])), [['sv-link lan', 'Wi-Fi local'], ['sv-link lan', 'Wi-Fi local']]);
  await rp.evaluate(() => closeScreensView());
  // Image du pool : transférée en Wi-Fi local, affichée
  await rp.evaluate(() => new Promise((res) => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 40;
    c.getContext('2d').fillStyle = '#22aa44'; c.getContext('2d').fillRect(0, 0, 64, 40);
    c.toBlob((b) => { onAddImages([new File([b], 'vert.png', { type: 'image/png' })]); res(); }, 'image/png');
  }));
  for (const s of [A, B]) await waitFor(s.page, () => _mediaCache.has('m1') && screenMediaVisible(), null, { timeout: 10000 });
  await hub.flush();
  const viaLan = await hub.sent(rp, { mode: 'lan' });
  assert.ok(viaLan.some((m) => m.type === 'media-img-chunk'), 'fragments en Wi-Fi local');
  assert.deepEqual((await hub.sent(rp, { mode: 'ble' })).filter((m) => /^media-img|^rtc-|^media:(upload|chunk)/.test(m.type)), [], 'aucun média en Bluetooth');
  assert.deepEqual(hub.violations, []);
  // Les écrans restent en ligne (signes de vie en Wi-Fi local)
  assert.deepEqual(await rp.evaluate(() => [_offlineScreens(Date.now()).length, sessionLinkUp(), mediaLinkUp()]), [0, true, true]);
  noErrors(r);
  await r.close();
});

const addImage = (page, name, color) => page.evaluate(([name, color]) => new Promise((res) => {
  const c = document.createElement('canvas'); c.width = 32; c.height = 32;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 32, 32);
  c.toBlob((b) => { onAddImages([new File([b], name, { type: 'image/png' })]); res(); }, 'image/png');
}), [name, color]);

test('Bluetooth seul : les commandes passent, aucun média ; trame trop grande refusée avant l\'envoi', async () => {
  const r = await rig(2, 62);
  const [A, B] = r.screens;
  const { rp, hub } = r;
  // Une image déjà en cache sur les écrans (envoyée par Internet)
  await addImage(rp, 'noir.png', '#000000');
  for (const s of [A, B]) await waitFor(s.page, () => _mediaCache.has('m1'), null, { timeout: 10000 });
  await waitFor(rp, () => _screenCached.has('m1'));
  await rp.evaluate(() => stopMediaBroadcast());
  for (const s of [A, B]) await waitFor(s.page, () => !screenMediaVisible());
  await localPeers(r, 'ble');
  // Plus d'Internet ni de Wi-Fi local : Bluetooth seul
  hub.setUp('lan', false);
  for (const p of [rp, A.page, B.page]) await cutInternet(p);
  await waitFor(rp, () => linkBleOnly() && document.getElementById('linkPillLabel').textContent === 'Bluetooth');
  assert.deepEqual(await pill(rp), ['ble', 'Bluetooth']);
  await rp.evaluate(() => switchTab('qr'));
  assert.deepEqual(await rp.$$eval('#pairScreensList .ps-link', (els) => els.map((e) => e.textContent)), ['Bluetooth', 'Bluetooth']);
  hub.clear();
  // Commandes : couleur, média déjà en cache
  await rp.evaluate(() => setKelvin(9000));
  const cold = await rp.evaluate(() => currentColor);
  for (const s of [A, B]) await waitFor(s.page, (c) => screenBaseColor === c, cold);
  await rp.evaluate(() => { switchTab('media'); selectMedia('m1'); });
  for (const s of [A, B]) await waitFor(s.page, () => screenMediaVisible() && _screenActiveId === 'm1');
  // Nouvelle image : rien ne part, l'interface le dit
  await addImage(rp, 'rouge.png', '#ff0000');
  await rp.evaluate(() => selectMedia('m2'));
  assert.equal(await rp.textContent('#mediaStatus'), 'Bluetooth : « rouge.png » n\'est pas préparé sur 2 écrans — il faut Internet ou le Wi-Fi local');
  await sleep(600); await hub.flush();
  const viaBle = await hub.sent(rp, { mode: 'ble' });
  assert.ok(viaBle.some((m) => m.type === 'color') && viaBle.some((m) => m.type === 'media:show'));
  assert.deepEqual(viaBle.filter((m) => /^media-img|^rtc-|^media:(upload|chunk|play)/.test(m.type)), [], 'aucun média en Bluetooth');
  for (const s of [A, B]) assert.equal(await s.page.evaluate(() => _mediaCache.has('m2')), false);
  assert.ok(hub.log.every((e) => e.mode === 'ble' && e.frame.length <= BLE_MAX));
  assert.deepEqual(hub.violations, []);
  // Plafond : refusé AVANT l'envoi (rien n'est remis à la coque)
  const before = hub.posted(rp, 'link:send').length;
  const res = await rp.evaluate((max) => [
    linkTransmit('A'.repeat(max + 1), 'color', null),
    linkTransmit('A'.repeat(200), 'media-img-chunk', null),
    linkTransmit('A'.repeat(200), 'rtc-offer', null),
    linkTransmit('A'.repeat(max), 'color', null),
  ], BLE_MAX);
  await hub.flush();
  assert.deepEqual(res, [false, false, false, true]);
  assert.equal(hub.posted(rp, 'link:send').length, before + 1, 'seule la trame de 4 Kio est partie');
  // Écrans toujours en ligne (signes de vie en Bluetooth)
  assert.equal(await rp.evaluate(() => _offlineScreens(Date.now()).length), 0);
  noErrors(r);
  await r.close();
});

test('doublons : la même trame par Internet et en local n\'est appliquée qu\'une fois ; l\'ordre entre liaisons est gardé', async () => {
  const r = await rig(1, 63);
  const [A] = r.screens;
  const { rp, hub, broker } = r;
  await localPeers(r, 'lan'); await localPeers(r, 'ble');
  await A.page.evaluate(() => { window.__colors = 0; const o = window.receiveColor; window.receiveColor = function (...a) { window.__colors++; return o.apply(this, a); }; });
  const st0 = await A.page.evaluate(() => ({ ...secStats }));
  broker.clear(); hub.clear();
  await rp.evaluate(() => sendMsg({ type: 'color', color: '#123456' }));
  await waitFor(A.page, () => screenBaseColor === '#123456');
  await sleep(300); await hub.flush(); await broker.flush();
  // La MÊME trame est partie par Internet, en Wi-Fi local et en Bluetooth
  const viaInternet = broker.log.filter((e) => e.from === rp).map((e) => e.payload);
  const local = hub.log.filter((e) => e.to === 1).map((e) => e.frame);
  const frame = viaInternet.find((f) => local.includes(f));
  assert.ok(frame, 'trame identique sur Internet et en local');
  assert.deepEqual(hub.log.filter((e) => e.frame === frame).map((e) => e.mode).sort(), ['ble', 'lan']);
  await waitFor(A.page, (n) => secStats.duplicates - n >= 2, st0.duplicates);
  const st = await A.page.evaluate(() => ({ ...secStats, colors: window.__colors }));
  assert.equal(st.colors, 1, 'couleur appliquée une seule fois');
  assert.equal(st.received - st0.received, 1);
  assert.equal(st.duplicates - st0.duplicates, 2, 'deux doublons écartés par l\'anti-rejeu');
  // Télécommande : les doublons des écrans authentifient chaque liaison ; Internet affiché
  await waitFor(rp, (id) => Object.keys(_pairedScreens.get(id).via || {}).length === 3, A.id, { timeout: 20000 });
  await rp.evaluate(() => openScreensView());
  assert.equal(await rp.textContent('#svList .sv-link'), 'Internet');
  // Ordre : une trame plus ancienne arrivée après une plus récente (autre liaison) ne revient pas en arrière
  const pairing = await rp.evaluate(() => _session);
  const peer = await fakePeer(pairing, 'remote');
  const older = await peer.seal({ type: 'color', color: '#aa0000' });
  const newer = await peer.seal({ type: 'color', color: '#00aa00' });
  await A.page.evaluate((f) => { window.SRNative.receive({ type: 'link:frames', frames: [{ peer: 'lan-0', mode: 'lan', data: f }] }); return _rxChain; }, newer);
  await A.page.evaluate((f) => { mqttClient._deliver(_sec.mqttTopic, f); return _rxChain; }, older);
  assert.deepEqual(await A.page.evaluate(() => [screenBaseColor, secStats.lastError]), ['#00aa00', 'order']);
  // Trame locale au-delà du plafond de sa liaison : ignorée avant tout déchiffrement
  const big = await peer.seal({ type: 'color', color: '#0000aa' });
  await A.page.evaluate((f) => { window.SRNative.receive({ type: 'link:frames', frames: [{ peer: 'ble-0', mode: 'ble', data: f + 'A'.repeat(5000) }] }); return _rxChain; }, big);
  assert.equal(await base(A), '#00aa00');
  noErrors(r);
  await r.close();
});

// Son WAV réel (sinusoïde), importé par le chemin de l'app
function wavB64(sec, freq, rate = 8000) {
  const n = Math.round(sec * rate), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * freq * i / rate)), 44 + i * 2);
  return b.toString('base64');
}
const offRows = (page) => page.$$eval('#offPrepRows .off-row', (els) => els.map((e) => [e.className.replace('off-row ', ''), e.querySelector('.off-name').textContent, e.querySelector('.off-state').textContent, e.querySelector('.off-detail').textContent]));

test('préparation : chaque écran ne reçoit que ce qui lui manque, avec progression ; puis en Bluetooth, l\'appel n° 1 sonne avec sa photo et sa bande son', async () => {
  const r = await rig(2, 65);
  const [A, B] = r.screens;
  const { rp, hub, broker } = r;
  await rp.evaluate(([a, b]) => { scrRenameScreen(a, 'Téléphone de Julie'); scrRenameScreen(b, 'TV salon'); }, [A.id, B.id]);
  // Pool : une image (préchargée d'office par Internet) et une vidéo (jamais préchargée)
  await addImage(rp, 'decor.png', '#336699');
  for (const s of [A, B]) await waitFor(s.page, () => _mediaCache.has('m1'), null, { timeout: 10000 });
  await rp.evaluate(() => stopMediaBroadcast());
  await rp.evaluate(() => onAddVideos([new File([new Uint8Array(200000).map((_, i) => (i * 7) & 255)], 'plan-large.mp4', { type: 'video/mp4' })]));
  // Sonnerie importée, choisie pendant que la cible est A seul : seul A l'a
  await rp.evaluate(async ([a, wav]) => {
    scrSetTarget({ k: 'screen', id: a });
    switchTab('call');
    await onRingImport([new File([Uint8Array.from(atob(wav), (c) => c.charCodeAt(0))], 'sonnerie-prod.wav', { type: 'audio/wav' })]);
  }, [A.id, wavB64(1, 440)]);
  const ring = await rp.evaluate(() => ringLib[0].id);
  await waitFor(A.page, (id) => _mediaCache.has(id), ring, { timeout: 10000 });
  // Appel n° 1 enregistré avec photo et bande son ; fond verrouillé (rien d'envoyé)
  const ids = await rp.evaluate(async (wav) => {
    scrSetTarget({ k: 'all' });
    const k = document.createElement('canvas'); k.width = k.height = 16;
    const g = k.getContext('2d'); g.fillStyle = '#c08060'; g.fillRect(0, 0, 16, 16);
    _callPhoto = k.toDataURL('image/jpeg', 0.7);
    _callAudioData = 'data:audio/wav;base64,' + wav;
    document.getElementById('callName').value = 'Maman';
    await saveCurrentCall();
    _callPhoto = null; _callAudioData = null;
    const w = document.createElement('canvas'); w.width = 20; w.height = 36; w.getContext('2d').fillRect(0, 0, 20, 36);
    _lockWallData = w.toDataURL('image/jpeg', 0.7);
    return callEntryPrepIds(callList.call[0]);
  }, wavB64(0.5, 330));
  assert.match(ids.photo, /^__ph_[0-9a-f]{40}$/);
  assert.match(ids.audio, /^__au_[0-9a-f]{40}$/);
  // A a déjà la photo de l'appel n° 1
  await rp.evaluate(async ([a, id]) => sendImageChunks((await callEntryAssets(callList.call[0])).photo, { mediaId: id, show: false, screens: [a] }), [A.id, ids.photo]);
  await waitFor(rp, ([a, id]) => scrState(a).cached.has(id), [A.id, ids.photo], { timeout: 10000 });
  await sleep(300); await broker.flush(); await hub.flush();
  // Vue « Tourner sans réseau » (onglet QR) : ce qui manque à chaque écran
  await rp.evaluate(() => switchTab('qr'));
  await rp.click('#offEntryBtn');
  await waitFor(rp, () => document.querySelectorAll('#offPrepRows .off-row').length === 2 && _prepItems.length === 6);
  assert.deepEqual(await offRows(rp), [
    ['idle', 'Téléphone de Julie', 'Incomplet', '1/2 médias · manque fond d\'écran, bande son'],
    ['idle', 'TV salon', 'Incomplet', '1/2 médias · manque sonnerie, fond d\'écran, bande son, photo d\'appel'],
  ]);
  assert.equal(await rp.textContent('#offPrepBtn'), 'Tout préparer maintenant');
  // États montrés pendant la préparation
  await rp.evaluate(() => {
    window.__seen = new Set();
    const o = window.renderOfflineView;
    window.renderOfflineView = function () { o(); for (const e of document.querySelectorAll('.off-row')) window.__seen.add(e.className.replace('off-row ', '') + ':' + e.querySelector('.off-state').textContent); window.__seen.add('btn:' + document.getElementById('offPrepBtn').textContent); };
  });
  for (const s of [A, B]) await s.page.evaluate(() => { window.__shown = 0; const o = window.showScreenMedia; window.showScreenMedia = function (...a) { window.__shown++; return o.apply(this, a); }; });
  broker.clear(); hub.clear();
  await rp.click('#offPrepBtn');
  await waitFor(rp, () => document.getElementById('offPrepBtn').textContent === 'Tout est prêt', null, { timeout: 60000 });
  const ready = '2/2 médias · sonnerie · fond d\'écran · bande son · photo d\'appel';
  assert.deepEqual(await offRows(rp), [['ready', 'Téléphone de Julie', 'Prêt', ready], ['ready', 'TV salon', 'Prêt', ready]]);
  assert.equal(await rp.evaluate(() => document.getElementById('offPrepBtn').disabled), true);
  const seen = await rp.evaluate(() => [...window.__seen]);
  assert.ok(seen.includes('btn:Préparation en cours…'), seen.join());
  assert.ok(seen.some((s) => /^busy:\d+ %$/.test(s)), 'progression en % : ' + seen.join());
  // Seul ce qui manquait est parti, à chaque écran
  await broker.flush();
  const sent = await broker.sent(rp);
  const imgs = sent.filter((m) => m.type === 'media-img-start').map((m) => [m.mediaId, m.target.screens.slice().sort(), m.show]);
  const both = [A.id, B.id].sort();
  assert.deepEqual(imgs.sort(), [
    ['__lockwall', both, false], [ids.audio, both, false], [ids.photo, [B.id], false], [ring, [B.id], false],
  ].sort());
  const vids = sent.filter((m) => m.type === 'rtc-offer' || m.type === 'media:upload');
  assert.deepEqual(vids.map((m) => m.target.screens[0]).sort(), both, 'vidéo vers chaque écran');
  assert.ok(vids.every((m) => (m.type === 'rtc-offer' ? m.kind === 'cache' : m.show === false)), 'vidéo mise en cache seulement');
  // Rien ne s'est affiché sur les écrans
  for (const s of [A, B]) {
    assert.deepEqual(await s.page.evaluate(() => [window.__shown, screenMediaVisible(), _mediaCache.has('m2'), document.getElementById('screen-media-video').getAttribute('src')]), [0, false, true, null]);
  }
  // Sur le plateau : Bluetooth seul
  hub.setUp('lan', false);
  for (const p of [rp, A.page, B.page]) await cutInternet(p);
  await waitFor(rp, () => linkBleOnly());
  hub.clear();
  await rp.evaluate(() => { switchTab('call'); setCallListKind('call'); return triggerSelectedCallEntry(); });
  const photo = await rp.evaluate(() => callAssetGet(callList.call[0].id + ':photo'));
  for (const s of [A, B]) {
    await waitFor(s.page, () => _callState === 'ringing');
    assert.deepEqual(await s.page.evaluate(() => [_callCfg.photo !== null, _callCfg.audioId, _callCfg.ringId]), [true, ids.audio, ring]);
    assert.equal(await s.page.evaluate(() => _callCfg.photo), photo, 'photo préparée de l\'appel n° 1');
  }
  // Vidéo préparée : affichée depuis le cache, par une simple commande
  await rp.evaluate(() => { switchTab('media'); selectMedia('m2'); });
  for (const s of [A, B]) await waitFor(s.page, () => _screenActiveId === 'm2' && /^blob:/.test(document.getElementById('screen-media-video').getAttribute('src') || ''));
  await hub.flush();
  const viaBle = await hub.sent(rp, { mode: 'ble' });
  assert.deepEqual(viaBle.filter((m) => m.type === 'call:start').map((m) => [m.photoId, m.audioId, m.hasPhoto, m.hasAudio]), [[ids.photo, ids.audio, true, true]]);
  assert.ok(viaBle.some((m) => m.type === 'media:show' && m.id === 'm2'));
  assert.deepEqual(viaBle.filter((m) => /^media-img|^rtc-|^media:(upload|chunk|play)/.test(m.type)), []);
  assert.deepEqual(hub.violations, []);
  noErrors(r);
  await r.close();
});

test('Auto : Internet, puis Wi-Fi local, puis Bluetooth, puis retour d\'Internet ; liaison forcée, Internet seul', async () => {
  const r = await rig(1, 64);
  const [A] = r.screens;
  const { rp, hub } = r;
  await localPeers(r, 'lan'); await localPeers(r, 'ble');
  const color = async (k) => {
    await rp.evaluate((k) => setKelvin(k), k);
    const c = await rp.evaluate(() => currentColor);
    await waitFor(A.page, (c) => screenBaseColor === c, c);
  };
  assert.deepEqual(await pill(rp), ['online', 'Internet']);
  await color(3200);
  for (const p of [rp, A.page]) await cutInternet(p);
  await waitFor(rp, () => document.getElementById('linkPillLabel').textContent === 'Wi-Fi local');
  await color(4300);
  hub.setUp('lan', false);
  await waitFor(rp, () => document.getElementById('linkPillLabel').textContent === 'Bluetooth');
  await color(5600);
  hub.setUp('lan', true);
  for (const p of [rp, A.page]) await restoreInternet(p);
  await waitFor(rp, () => document.getElementById('linkPillLabel').textContent === 'Internet');
  await color(6500);
  // Forcé « Wi-Fi local » : Internet fermé, Bluetooth fermé (vue « Tourner sans réseau »)
  hub.clear();
  await rp.evaluate(() => openOfflineView());
  await rp.click('#offLink-lan');
  assert.deepEqual(hub.posted(rp, 'link:start').at(-1).modes, ['lan']);
  assert.deepEqual(await rp.evaluate(() => [mqttClient, JSON.parse(localStorage.getItem('setremote-link-v1')).mode, document.querySelector('.off-seg-btn.active').id]), [null, 'lan', 'offLink-lan']);
  await waitFor(rp, () => linkPeerCount('ble') === 0 && linkPeerCount('lan') === 1);
  await color(2700);
  assert.equal(await rp.textContent('#offLinkDesc'), 'Wi-Fi local seul : appareils sur le même routeur ou partage de connexion, sans Internet. Médias compris.');
  // Internet seul : liaisons locales fermées, Internet rouvert
  await rp.click('#offLink-internet');
  assert.deepEqual(hub.posted(rp).at(-1), { type: 'link:stop' });
  await rp.evaluate(() => { for (const c of window.__mqttClients) if (!c.connected && !c.disconnecting) c._connect(); });
  await waitFor(rp, () => !!mqttClient && mqttClient.connected && linkPeerCount() === 0);
  await color(9000);
  // Retour à Auto : les deux liaisons locales rouvertes, en plus d'Internet
  await rp.click('#offLink-auto');
  assert.deepEqual(hub.posted(rp, 'link:start').at(-1).modes, ['lan', 'ble']);
  await waitFor(rp, () => linkPeerCount('lan') === 1 && linkPeerCount('ble') === 1 && mqttClient.connected);
  noErrors(r);
  await r.close();
});

test('navigateur seul : Wi-Fi local et Bluetooth désactivés (« Nécessite l\'app SetRemote »), préparation par Internet', async () => {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed: 66, autoConnect: true });
  const rp = remote.page;
  await rp.evaluate(() => startMode('remote'));
  await waitFor(rp, () => !!mqttClient && mqttClient.connected);
  const screen = await openPage(browser, { broker, seed: 661, autoConnect: true, hash: await pairingHash(rp) });
  await waitFor(rp, () => scrList().length === 1 && _resyncTimer === null, null, { timeout: 8000 });
  await rp.evaluate(() => { _lockWallData = (() => { const w = document.createElement('canvas'); w.width = 20; w.height = 36; return w.toDataURL('image/jpeg', 0.7); })(); openSettings(); });
  assert.equal(await rp.textContent('#stLinkVal'), 'Auto');
  await rp.click('#stLink');
  const v = await rp.evaluate(() => ({
    open: getComputedStyle(document.getElementById('offline-view')).display,
    notice: getComputedStyle(document.getElementById('offNeedsApp')).display,
    noticeTitle: document.querySelector('#offNeedsApp strong').textContent.trim(),
    seg: [...document.querySelectorAll('.off-seg-btn')].map((b) => [b.textContent, b.disabled, b.classList.contains('active')]),
    desc: document.getElementById('offLinkDesc').textContent,
    pref: setLinkPref('lan'), stored: localStorage.getItem('setremote-link-v1'),
    bridge: typeof window.ReactNativeWebView, modes: linkModesWanted(), peers: linkPeerCount(),
  }));
  assert.deepEqual(v, {
    open: 'flex', notice: 'block', noticeTitle: 'Nécessite l\'app SetRemote',
    seg: [['Auto', false, true], ['Internet', false, false], ['Wi-Fi local', true, false], ['Bluetooth', true, false]],
    desc: 'Auto : Internet si disponible, sinon Wi-Fi local, sinon Bluetooth (commandes uniquement).',
    pref: false, stored: null, bridge: 'undefined', modes: [], peers: 0,
  });
  // Préparation : par Internet
  await waitFor(rp, () => !document.getElementById('offPrepBtn').disabled);
  await rp.click('#offPrepBtn');
  await waitFor(rp, () => document.getElementById('offPrepBtn').textContent === 'Tout est prêt', null, { timeout: 15000 });
  assert.deepEqual(await offRows(rp), [['ready', 'Écran 1', 'Prêt', 'fond d\'écran']]);
  assert.equal(await screen.page.evaluate(() => _mediaCache.has('__lockwall')), true);
  // Fermer la vue ramène aux Réglages
  await rp.click('#offline-view .sv-back');
  assert.deepEqual(await rp.evaluate(() => [getComputedStyle(document.getElementById('offline-view')).display, getComputedStyle(document.getElementById('settings-view')).display]), ['none', 'flex']);
  assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remote.close();
});

test('Réglages : la ligne « Liaison par défaut » reflète le choix, persistant après relance (et la coque l\'applique)', async () => {
  const hub = new FakeLinkHub();
  const p = await openPage(browser, { broker: hub.with(null), seed: 67, init: NATIVE });
  const { page } = p;
  await page.evaluate(() => startMode('remote'));
  await page.click('#settingsBtn');
  const row = () => page.evaluate(() => [...document.getElementById('stLink').querySelectorAll('span')].slice(1).map((e) => e.textContent));
  assert.deepEqual(await row(), ['Liaison par défaut', 'Internet, Wi-Fi local, Bluetooth', 'Auto']);
  await page.click('#stLink');
  await page.click('#offLink-lan');
  await page.click('#offline-view .sv-back');
  assert.deepEqual(await row(), ['Liaison par défaut', 'Internet, Wi-Fi local, Bluetooth', 'Wi-Fi local']);
  // Relance : choix retrouvé, appliqué (Wi-Fi local seul, sans Internet)
  await page.reload();
  hub.clear();
  await page.evaluate(() => startMode('remote'));
  await waitFor(page, () => !!_sec);
  await hub.flush();
  assert.deepEqual(hub.posted(page, 'link:start').map((m) => m.modes), [['lan']]);
  assert.equal(await page.evaluate(() => mqttClient), null, 'Internet non ouvert');
  await page.click('#settingsBtn');
  assert.deepEqual((await row()).at(-1), 'Wi-Fi local');
  await page.click('#stLink');
  assert.equal(await page.evaluate(() => document.querySelector('.off-seg-btn.active').id), 'offLink-lan');
  // Bluetooth indisponible sur l'appareil : bouton désactivé, raison affichée en Auto
  hub.setAvailable(page, 'ble', false);
  await page.click('#offLink-auto');
  await waitFor(page, () => document.getElementById('offLink-ble').disabled && getComputedStyle(document.getElementById('offLinkWarn')).display === 'block');
  assert.equal(await page.textContent('#offLinkWarn'), 'Bluetooth indisponible sur cet appareil (activez-le et autorisez SetRemote dans les réglages du système).');
  assert.deepEqual(hub.posted(page, 'link:start').at(-1).modes, ['lan']);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('coque sans liaisons locales (jamais de link:state) : un choix « Wi-Fi local » mémorisé garde Internet ouvert', async () => {
  const broker = new FakeBroker();
  const p = await openPage(browser, {
    broker, seed: 70, autoConnect: true,
    init: { fn: () => {
      window.SETREMOTE_NATIVE = { platform: 'ios', bridge: 1 };
      window.__posted = [];
      window.ReactNativeWebView = { postMessage: (s) => window.__posted.push(JSON.parse(s)) };
      localStorage.setItem('setremote-link-v1', JSON.stringify({ v: 1, mode: 'lan' }));
    } },
  });
  const { page } = p;
  await page.evaluate(() => startMode('remote'));
  await waitFor(page, () => !!mqttClient && mqttClient.connected, null, { timeout: 8000 });
  await page.evaluate(() => openOfflineView());
  assert.deepEqual(await page.evaluate(() => ({
    posted: window.__posted.map((m) => m.type + (m.modes ? ':' + m.modes.join() : '')),
    seg: [...document.querySelectorAll('.off-seg-btn')].map((b) => [b.id, b.disabled, b.classList.contains('active')]),
    pill: document.getElementById('linkPillLabel').textContent, select: setLinkPref('ble'),
  })), {
    posted: ['link:state?', 'link:start:lan', 'link:state?'],
    seg: [['offLink-auto', false, false], ['offLink-internet', false, false], ['offLink-lan', true, true], ['offLink-ble', true, false]],
    pill: 'Internet', select: false,
  });
  // La coque répond enfin : Wi-Fi local disponible, Internet fermé comme demandé
  await page.evaluate(() => window.SRNative.receive({ type: 'link:state', lan: { available: true, active: true }, ble: { available: false, active: false } }));
  assert.deepEqual(await page.evaluate(() => [mqttClient, document.getElementById('offLink-lan').disabled]), [null, false]);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('retrait d\'un écran en Wi-Fi local (sans Internet) : nouvelle session annoncée à la coque, les autres écrans suivent', async () => {
  const r = await rig(3, 68, { keys: true });
  const [A, B, C] = r.screens;
  const { rp, hub } = r;
  await localPeers(r, 'lan');
  for (const p of [rp, A.page, B.page, C.page]) await cutInternet(p);
  await waitFor(rp, () => document.getElementById('linkPillLabel').textContent === 'Wi-Fi local');
  const old = await rp.evaluate(() => ({ ch: _session.channelId, room: _sec.topic }));
  hub.clear();
  await rp.evaluate((a) => scrRevoke(a), A.id);
  await waitFor(A.page, () => getComputedStyle(document.getElementById('screen-revoked')).display === 'flex', null, { timeout: 8000 });
  const next = await rp.evaluate(() => ({ ch: _session.channelId, room: _sec.topic }));
  assert.notEqual(next.ch, old.ch);
  for (const s of [B, C]) await waitFor(s.page, (ch) => _session.channelId === ch, next.ch, { timeout: 8000 });
  // La coque reçoit la salle de la nouvelle session (télécommande et écrans qui suivent)
  for (const p of [rp, B.page, C.page]) assert.equal(hub.posted(p, 'link:start').at(-1).room, next.room);
  assert.deepEqual(hub.posted(A.page, 'link:stop'), [{ type: 'link:stop' }], 'écran retiré : liaisons fermées');
  assert.equal(hub.posted(A.page, 'link:start').length, 0, 'et jamais rouvertes');
  await waitFor(rp, () => _screenOfSender.size === 2 && linkPeerCount('lan') === 2, null, { timeout: 8000 });
  await rp.evaluate(() => setKelvin(2900));
  const c = await rp.evaluate(() => currentColor);
  for (const s of [B, C]) await waitFor(s.page, (c) => screenBaseColor === c, c);
  assert.equal(await A.page.evaluate(() => mode), null);
  assert.deepEqual(await rp.evaluate((a) => [scrKnown(a), scrList().length, mqttClient && mqttClient.connected], A.id), [false, 2, false]);
  assert.deepEqual(hub.violations, []);
  for (const p of [r.remote, B, C]) assert.deepEqual(p.errors, []);
  await r.close();
});

test('premier appairage sans Internet : QR scanné dans l\'app, l\'écran rejoint la télécommande en Wi-Fi local', async () => {
  const broker = new FakeBroker(), hub = new FakeLinkHub();
  const remote = await openPage(browser, { broker: hub.with(broker), seed: 69, init: NATIVE });
  const rp = remote.page;
  await rp.evaluate(() => startMode('remote'));
  await waitFor(rp, () => !!_sec);
  const hash = await pairingHash(rp);
  // L'écran lit le secret dans le QR (aucun échange réseau) et ouvre la même salle
  const screen = await openPage(browser, { broker: hub.with(broker), seed: 691, hash, init: NATIVE });
  const sp = screen.page;
  await waitFor(rp, () => scrList().length === 1, null, { timeout: 8000 });
  await waitFor(sp, () => !!_pw, null, { timeout: 8000 }); // clé par écran établie en Wi-Fi local
  assert.deepEqual(await rp.evaluate(() => [mqttClient.connected, linkPeerCount('lan'), document.getElementById('linkPillLabel').textContent]), [false, 1, 'Wi-Fi local']);
  await rp.evaluate(() => setKelvin(3400));
  const c = await rp.evaluate(() => currentColor);
  await waitFor(sp, (c) => screenBaseColor === c, c);
  assert.equal(broker.log.length, 0, 'rien n\'est passé par Internet');
  assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remote.close();
});

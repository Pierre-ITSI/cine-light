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
  assert.deepEqual(await pill(rp), ['online', 'Internet · chiffré']);
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
  assert.equal(await rp.textContent('#mediaStatus'), '⚠ Bluetooth : « rouge.png » n\'est pas préparé sur 2 écrans — il faut Internet ou le Wi-Fi local');
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
  assert.deepEqual(await pill(rp), ['online', 'Internet · chiffré']);
  await color(3200);
  for (const p of [rp, A.page]) await cutInternet(p);
  await waitFor(rp, () => document.getElementById('linkPillLabel').textContent === 'Wi-Fi local');
  await color(4300);
  hub.setUp('lan', false);
  await waitFor(rp, () => document.getElementById('linkPillLabel').textContent === 'Bluetooth');
  await color(5600);
  hub.setUp('lan', true);
  for (const p of [rp, A.page]) await restoreInternet(p);
  await waitFor(rp, () => document.getElementById('linkPillLabel').textContent === 'Internet · chiffré');
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

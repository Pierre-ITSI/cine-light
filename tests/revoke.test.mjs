// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Retrait d'un écran (maquettes 5b et 5c) : clé par écran établie dans la
// session, nouvelle session remise aux AUTRES écrans avec leur clé, écran
// retiré qui affiche « Écran retiré » et ne peut plus rien déchiffrer (même en
// rejouant l'ancien QR), écran absent remis à niveau à son retour, retrait
// d'un écran absent, persistance après rechargement de la télécommande,
// retraits successifs, dernier écran, appel / vidéo en cours, patch DMX.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, SRP, pairingHash, decodeFrames } from './helpers/harness.mjs';
import { buildSacnDataPacket } from '../packages/dmx/index.js';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
const base = (s) => s.page.evaluate(() => screenBaseColor);
const session = (page) => page.evaluate(() => _session && { channelId: _session.channelId, key: _session.key });

// Télécommande + n écrans appairés par le lien (QR), clés par écran établies
async function rig(n, seed, init = null) {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed, autoConnect: true, init });
  const rp = remote.page;
  await rp.evaluate(() => startMode('remote'));
  await connected(rp);
  const hash = await pairingHash(rp);
  const screens = [];
  for (let i = 0; i < n; i++) {
    const s = await openPage(browser, { broker, seed: seed * 10 + i, autoConnect: true, hash });
    await connected(s.page);
    s.id = await s.page.evaluate(() => screenId());
    screens.push(s);
  }
  await waitFor(rp, (k) => _screenOfSender.size === k && scrList().length === k, n);
  const r = { broker, remote, rp, screens, hash };
  await keyed(r);
  r.close = async () => { for (const s of screens) await s.close(); await remote.close(); };
  return r;
}
// Clés par écran : établies et confirmées des deux côtés (même kid)
async function keyed(r, list = r.screens) {
  for (const s of list) {
    await waitFor(s.page, () => !!_pw, null, { timeout: 8000 });
    const kid = await s.page.evaluate(() => _pw.kid);
    await waitFor(r.rp, ([id, kid]) => { const e = _scrReg.screens.get(id); return !!e && !!e.pk && e.pk.ok && e.pk.kid === kid; }, [s.id, kid], { timeout: 8000 });
  }
  await waitFor(r.rp, () => _resyncTimer === null);
  await sleep(250);
  await r.broker.flush();
}
const pngFile = (page, color, name) => page.evaluate(([color, name]) => new Promise((res) => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 40;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 64, 40);
  c.toBlob((b) => { window.__files = window.__files || {}; window.__files[name] = new File([b], name, { type: 'image/png' }); res(true); }, 'image/png');
}), [color, name]);
const spy = (page, names) => page.evaluate((names) => {
  window.__n = {};
  for (const n of names) { const o = window[n]; window.__n[n] = 0; window[n] = function (...a) { window.__n[n]++; return o.apply(this, a); }; }
}, names);
const spied = (page) => page.evaluate(() => ({ ...window.__n }));
const revoked = (s) => s.page.evaluate(() => ({
  view: getComputedStyle(document.getElementById('screen-revoked')).display,
  text: document.getElementById('srvText').textContent,
  stored: [localStorage.getItem('setremote-screen-session-v1'), localStorage.getItem('setremote-screen-pairwise-v1'), localStorage.getItem('setremote-screen-config-v1')],
  mode, client: !!mqttClient,
}));
// Écran parti (réseau coupé), puis revenu
const drop = (s) => s.page.evaluate(() => { stopScreenAlive(); mqttClient._drop(); });
const back = (s) => s.page.evaluate(() => mqttClient._connect());

test('3 écrans, un retiré : il affiche « Écran retiré », les deux autres continuent sans réappairage, sans interruption, sans renvoi de médias', async () => {
  const r = await rig(3, 21);
  const [A, B, C] = r.screens;
  const { rp } = r;
  // Une image diffusée à tous (en cache partout), une couleur
  await pngFile(rp, '#22aa44', 'vert.png');
  await rp.evaluate(() => { onAddImages([window.__files['vert.png']]); setKelvin(3200); scrRenameScreen(_scrReg.screens.keys().next().value, 'Tablette cuisine'); });
  for (const s of r.screens) await waitFor(s.page, () => _mediaCache.has('m1') && screenMediaVisible());
  await waitFor(rp, () => _screenCached.has('m1'));
  const warm = await rp.evaluate(() => currentColor);
  for (const s of r.screens) await waitFor(s.page, (c) => screenBaseColor === c, warm);
  await r.broker.flush();
  const old = await session(rp);
  const oldLink = await rp.evaluate(() => pairingLink(_session) || SRP.pairingUrl('https://x/', _session));
  await rp.evaluate(() => switchTab('qr'));
  await waitFor(rp, () => _rdv && _rdv.client && _rdv.client.connected);
  const oldCode = await rp.evaluate(() => document.getElementById('pairCode').textContent);
  for (const s of [B, C]) await spy(s.page, ['hideScreenMedia', 'mediaImgStart', 'screenHandleOffer', 'screenVidUploadStart', 'flashScreenNotice', 'setBlackout', 'goBackToSplash']);
  const recvA = await A.page.evaluate(() => secStats.received);
  r.broker.clear();
  // 5b : « Retirer l'écran » sur la carte de A, puis confirmation
  await rp.evaluate(() => openScreensView());
  await rp.click(`.sv-card[data-id="${A.id}"] .sv-revoke`);
  assert.equal(await rp.textContent('#rvTitle'), 'Retirer « Tablette cuisine » ?');
  assert.equal(await rp.evaluate(() => getComputedStyle(document.getElementById('rvLost')).display), 'none', 'tous les autres écrans peuvent suivre');
  await rp.click('#rvOk');
  // 5c sur A : session, clé et nom effacés, plus aucune connexion
  await waitFor(A.page, () => getComputedStyle(document.getElementById('screen-revoked')).display === 'flex');
  assert.deepEqual(await revoked(A), {
    view: 'flex', text: 'La télécommande a retiré cet écran de la session. Il ne reçoit plus aucune commande.',
    stored: [null, null, null], mode: null, client: false,
  });
  // B et C : sur la nouvelle session, sans réappairage
  await waitFor(rp, (o) => _session.channelId !== o, old.channelId, { timeout: 8000 });
  const next = await session(rp);
  for (const s of [B, C]) await waitFor(s.page, (ch) => _session.channelId === ch && !!mqttClient && mqttClient.connected, next.channelId, { timeout: 8000 });
  await waitFor(rp, () => _screenOfSender.size === 2, null, { timeout: 8000 });
  await waitFor(rp, () => _resyncTimer === null);
  await sleep(400);
  // La télécommande continue de piloter B et C
  await rp.evaluate(() => setKelvin(9000));
  const cold = await rp.evaluate(() => currentColor);
  for (const s of [B, C]) await waitFor(s.page, (c) => screenBaseColor === c, cold);
  await sleep(300); await r.broker.flush();
  // Sans interruption visible : média toujours affiché, rien de rechargé ni d'effacé
  for (const s of [B, C]) {
    assert.deepEqual(await s.page.evaluate(() => [screenMediaVisible(), _screenActiveId, _mediaCache.has('m1')]), [true, 'm1', true]);
    assert.deepEqual(await spied(s.page), { hideScreenMedia: 0, mediaImgStart: 0, screenHandleOffer: 0, screenVidUploadStart: 0, flashScreenNotice: 0, setBlackout: 0, goBackToSplash: 0 });
    assert.equal(await s.page.evaluate(() => JSON.parse(localStorage.getItem('setremote-screen-session-v1')).channelId), next.channelId, 'nouvelle session retenue');
  }
  // Aucun média renvoyé sur la nouvelle session
  const sentNew = await decodeFrames(next, r.broker.log.filter((e) => e.from === rp).map((e) => e.payload));
  assert.ok(sentNew.some((m) => m.type === 'color'), 'resynchronisation faite');
  assert.deepEqual(sentNew.filter((m) => /^media-img|^media:(upload|chunk|show)|^rtc-/.test(m.type)).map((m) => m.type), []);
  // Télécommande : écran oublié (nom, groupes, clé), nouveau QR et nouveau code
  assert.deepEqual(await rp.evaluate((a) => [scrKnown(a), scrList().length, _pairedScreens.has(a)], A.id), [false, 2, false]);
  const store = await rp.evaluate(() => JSON.parse(localStorage.getItem('setremote-screens-v1')).sessions);
  assert.deepEqual(Object.keys(store), [next.channelId], 'registre de l\'ancienne session effacé');
  assert.ok(!JSON.stringify(store).includes(A.id) && !JSON.stringify(store).includes('Tablette cuisine'));
  assert.deepEqual(await rp.evaluate(() => JSON.parse(localStorage.getItem('setremote-session-v1'))), next);
  assert.notEqual(await rp.evaluate(() => pairingLink(_session) || SRP.pairingUrl('https://x/', _session)), oldLink);
  await waitFor(rp, (c) => { const t = document.getElementById('pairCode').textContent; return t !== c && /·/.test(t); }, oldCode);
  // A ne reçoit plus rien
  assert.equal(await A.page.evaluate(() => secStats.received), recvA + 1, 'seul screen:revoked lui est parvenu');
  for (const p of [r.remote, ...r.screens]) assert.deepEqual(p.errors, []);
  await r.close();
});

test('l\'écran retiré ne peut rien déchiffrer de la nouvelle session, même en rejouant l\'ancien QR', async () => {
  const r = await rig(3, 22);
  const [A, B, C] = r.screens;
  const { rp } = r;
  const old = await session(rp);
  const aSecret = await A.page.evaluate(() => JSON.parse(localStorage.getItem('setremote-screen-pairwise-v1')));
  const rid = await rp.evaluate(() => remoteId());
  assert.equal(aSecret.rid, rid);
  r.broker.clear();
  await rp.evaluate((a) => scrRevoke(a), A.id);
  const next = await session(rp);
  assert.notEqual(next.channelId, old.channelId);
  for (const s of [B, C]) await waitFor(s.page, (ch) => _session.channelId === ch && mqttClient.connected, next.channelId, { timeout: 8000 });
  await rp.evaluate(() => { setKelvin(2700); triggerCall(); });
  await waitFor(B.page, () => _callState === 'ringing');
  // Appareil retiré qui rejoue l'ancien lien d'appairage : renvoyé sur 5c par l'écoute de l'ancien topic
  const replay = await openPage(browser, { broker: r.broker, seed: 229, autoConnect: true, hash: SRP.pairingUrl('https://x/', old).split('#')[1] });
  await waitFor(replay.page, () => getComputedStyle(document.getElementById('screen-revoked')).display === 'flex', null, { timeout: 8000 });
  assert.deepEqual((await revoked(replay)).stored, [null, null, null]);
  await r.broker.flush();
  // Côté relais : rien de la nouvelle session ne s'ouvre avec l'ancien secret ni avec la clé de A
  const oldKeys = (await SRP.deriveSession(old)).keys;
  const newTopic = SRP.SESSION_TOPIC_PREFIX + (await SRP.deriveSession(next)).topic;
  const onNew = r.broker.log.filter((e) => e.topic === newTopic).map((e) => e.payload);
  assert.ok(onNew.length > 5);
  assert.equal((await decodeFrames(old, onNew)).length, 0, 'ancienne clé de session : rien');
  for (const f of onNew) for (const k of [oldKeys.r2s, oldKeys.s2r]) await assert.rejects(SRP.open(f, k, null));
  assert.ok((await decodeFrames(next, onNew)).some((m) => m.type === 'call:start'), 'trafic bien présent');
  const aKeys = await SRP.pairwiseKeys(aSecret.s, { remoteId: rid, screenId: A.id });
  const pairwiseFrames = r.broker.log.map((e) => e.payload).filter((f) => { try { return SRP.peekFrame(f).kind === SRP.FRAME_KIND.PAIRWISE; } catch (_) { return false; } });
  assert.ok(pairwiseFrames.length >= 2, 'session:rekey pour B et C');
  for (const f of pairwiseFrames) for (const k of [aKeys.r2s, aKeys.s2r]) await assert.rejects(SRP.openPairwise(f, k, null), 'clé de A : aucune trame');
  // Le secret de la nouvelle session n'apparaît dans aucune trame ouvrable avec l'ancien secret
  const oldReadable = await decodeFrames(old, r.broker.log.map((e) => e.payload));
  assert.ok(!JSON.stringify(oldReadable).includes(next.key));
  for (const p of [r.remote, B, C]) assert.deepEqual(p.errors, []);
  await replay.close();
  await r.close();
});

test('écran absent pendant le retrait : à son retour, la session en cours lui est remise (ancien topic écouté)', async () => {
  const r = await rig(3, 23);
  const [A, B, C] = r.screens;
  const { rp } = r;
  await drop(C);
  await rp.evaluate((a) => scrRevoke(a), A.id);
  const next = await session(rp);
  await waitFor(B.page, (ch) => _session.channelId === ch, next.channelId, { timeout: 8000 });
  assert.deepEqual(await rp.evaluate(() => JSON.parse(localStorage.getItem('setremote-rekey-v1')).records.map((x) => x.pending)), [[await C.page.evaluate(() => screenId())]]);
  // C revient (toujours sur l'ancien topic) : remis à niveau, sans réappairage
  await back(C);
  await waitFor(C.page, (ch) => _session.channelId === ch && mqttClient.connected, next.channelId, { timeout: 10000 });
  await rp.evaluate(() => setKelvin(5000));
  const c = await rp.evaluate(() => currentColor);
  await waitFor(C.page, (c) => screenBaseColor === c, c);
  await waitFor(rp, () => JSON.parse(localStorage.getItem('setremote-rekey-v1')).records[0].pending.length === 0);
  assert.equal(await A.page.evaluate(() => getComputedStyle(document.getElementById('screen-revoked')).display), 'flex');
  for (const p of [r.remote, B, C]) assert.deepEqual(p.errors, []);
  await r.close();
});

test('confirmation de clé perdue : l\'écran adopte sa clé à la réception de la nouvelle session', async () => {
  const r = await rig(2, 27);
  const [A, B] = r.screens;
  const { rp } = r;
  // key:confirm jamais reçu par B : sa clé est restée « en cours »
  await B.page.evaluate(() => { _pwPending = { ..._pw, xid: 'x'.repeat(16) }; _pw = null; screenSavePairwise(null); });
  await rp.evaluate((a) => scrRevoke(a), A.id);
  const next = await session(rp);
  await waitFor(B.page, (ch) => _session.channelId === ch && mqttClient.connected, next.channelId, { timeout: 8000 });
  assert.equal(await B.page.evaluate(() => JSON.parse(localStorage.getItem('setremote-screen-pairwise-v1')).ch), next.channelId, 'clé adoptée et suivie');
  for (const p of [r.remote, B]) assert.deepEqual(p.errors, []);
  await r.close();
});

test('retirer un écran absent : les autres suivent ; s\'il revient pendant l\'écoute, il affiche « Écran retiré »', async () => {
  const r = await rig(3, 24);
  const [A, B, C] = r.screens;
  const { rp } = r;
  await drop(B);
  await rp.evaluate((b) => scrRevoke(b), B.id);
  const next = await session(rp);
  for (const s of [A, C]) await waitFor(s.page, (ch) => _session.channelId === ch, next.channelId, { timeout: 8000 });
  assert.equal(await B.page.evaluate(() => getComputedStyle(document.getElementById('screen-revoked')).display), 'none', 'absent : il n\'a rien reçu');
  await back(B);
  await waitFor(B.page, () => getComputedStyle(document.getElementById('screen-revoked')).display === 'flex', null, { timeout: 10000 });
  assert.deepEqual((await revoked(B)).stored, [null, null, null]);
  await rp.evaluate(() => setKelvin(4300));
  const c = await rp.evaluate(() => currentColor);
  for (const s of [A, C]) await waitFor(s.page, (c) => screenBaseColor === c, c);
  for (const p of [r.remote, A, C]) assert.deepEqual(p.errors, []);
  await r.close();
});

test('persistance : télécommande rechargée après un retrait (nouvelle session, clés, écoute) ; deux retraits de suite', async () => {
  const r = await rig(3, 25);
  const [A, B, C] = r.screens;
  const { rp } = r;
  await rp.evaluate((b) => scrRenameScreen(b, 'TV salon'), B.id);
  await waitFor(B.page, () => _screenCfg.name === 'TV salon');
  await drop(C);
  await rp.evaluate((a) => scrRevoke(a), A.id);
  const next = await session(rp);
  await waitFor(B.page, (ch) => _session.channelId === ch, next.channelId, { timeout: 8000 });
  // Télécommande rechargée : nouvelle session, registre (noms, clés), écoute de l'ancien topic
  await rp.reload();
  await rp.evaluate(() => startMode('remote'));
  await connected(rp);
  assert.deepEqual(await session(rp), next);
  await waitFor(rp, () => _screenOfSender.size === 1);
  assert.deepEqual(await rp.evaluate(([a, b, c]) => [scrKnown(a), scrName(b), !!pkOf(b), !!pkOf(c), _rkListeners.size], [A.id, B.id, C.id]), [false, 'TV salon', true, true, 1]);
  // C, absent pendant le retrait, revient : remis à niveau par la télécommande rechargée
  await back(C);
  await waitFor(C.page, (ch) => _session.channelId === ch && mqttClient.connected, next.channelId, { timeout: 10000 });
  await waitFor(rp, () => _screenOfSender.size === 2, null, { timeout: 8000 });
  // Second retrait de suite (B) : C passe sur une troisième session
  await rp.evaluate((b) => scrRevoke(b), B.id);
  const third = await session(rp);
  assert.notEqual(third.channelId, next.channelId);
  await waitFor(C.page, (ch) => _session.channelId === ch && mqttClient.connected, third.channelId, { timeout: 8000 });
  await waitFor(B.page, () => getComputedStyle(document.getElementById('screen-revoked')).display === 'flex');
  await rp.evaluate(() => setKelvin(6500));
  const c = await rp.evaluate(() => currentColor);
  await waitFor(C.page, (c) => screenBaseColor === c, c);
  assert.equal(await rp.evaluate(() => JSON.parse(localStorage.getItem('setremote-rekey-v1')).records.length), 2, 'deux anciens topics écoutés');
  assert.deepEqual(await rp.evaluate(() => [scrList().length, Object.keys(JSON.parse(localStorage.getItem('setremote-screens-v1')).sessions)]), [1, [third.channelId]]);
  for (const p of [r.remote, C]) assert.deepEqual(p.errors, []);
  await r.close();
});

// ── Cas limites : appel et vidéo en cours, patch DMX, dernier écran ──
const NATIVE = { fn: () => { window.SETREMOTE_NATIVE = { platform: 'android', bridge: 1 }; window.ReactNativeWebView = { postMessage: () => {} }; } };
let _seq = 0;
const sacn = (page, slots) => page.evaluate((p) => window.SRNative.receive({ type: 'dmx:packets', packets: p }), [{
  src: '10.0.0.10', port: 5568,
  data: Buffer.from(buildSacnDataPacket({ cid: '5f1e7a52-3c4b-4d8e-9a10-2b3c4d5e6f70', universe: 1, data: slots, sequence: (++_seq) & 0xff, sourceName: 'Console' })).toString('base64'),
}]);

test('cas limites : appel et vidéo en cours vers l\'écran retiré, patch DMX, dernier écran', async () => {
  const r = await rig(2, 26, NATIVE);
  const [A, B] = r.screens;
  const { rp } = r;
  await rp.evaluate(([a, b]) => {
    openDmxGateway();
    gwPatchSet(a, { universe: 1, address: 1, personality: 'standard8' });
    gwPatchSet(b, { universe: 1, address: 9, personality: 'standard8' });
    closeDmxGateway();
  }, [A.id, B.id]);
  await sacn(rp, [255, 255, 0, 0, 0, 128, 0, 0, 255, 0, 255, 0, 0, 128, 0, 0]);
  await waitFor(B.page, () => screenBaseColor === '#00ff00' && screenDmxLive());
  // Appel sur A, et un gros transfert vidéo vers A en cours (repli base64)
  await rp.evaluate(async (a) => {
    scrSetTarget({ k: 'screen', id: a });
    setCallRing('silent');
    await triggerCall();
    scrState(a).rtcBroken = true;
    broadcastVideo(new File([new Uint8Array(3_000_000).map((_, i) => i & 255)], 'long.mp4', { type: 'video/mp4' }), 'vbig');
  }, A.id);
  await waitFor(A.page, () => _callState === 'ringing' && !!_vidUp);
  r.broker.clear();
  await rp.evaluate((a) => scrRevoke(a), A.id);
  await waitFor(A.page, () => getComputedStyle(document.getElementById('screen-revoked')).display === 'flex');
  const next = await session(rp);
  await waitFor(B.page, (ch) => _session.channelId === ch, next.channelId, { timeout: 8000 });
  assert.deepEqual(await A.page.evaluate(() => [_callState, document.getElementById('screen-call').style.display]), ['idle', 'none'], 'appel coupé');
  assert.equal(await rp.evaluate((a) => _vidJobs.has(a), A.id), false, 'transfert arrêté');
  // Patch DMX : l'écran retiré n'y est plus, celui de B passe sur la nouvelle session
  assert.deepEqual(await rp.evaluate(([a, b]) => [gwState.patch.has(a), gwState.patch.has(b), gwState.patchSession === _session.channelId], [A.id, B.id]), [false, true, true]);
  const stored = await rp.evaluate(() => JSON.parse(localStorage.getItem('setremote-dmx-v1')).patches);
  assert.deepEqual(Object.keys(stored), [next.channelId]);
  assert.deepEqual(Object.keys(stored[next.channelId].patch.screens), [B.id]);
  // La console pilote toujours B, sur la nouvelle session
  await sacn(rp, [255, 255, 0, 0, 0, 128, 0, 0, 255, 0, 0, 255, 0, 128, 0, 0]);
  await waitFor(B.page, () => screenBaseColor === '#0000ff' && screenDmxLive());
  // Dernier écran retiré : aucune clé à remettre, bascule immédiate, nouveau QR
  const t0 = Date.now();
  await rp.evaluate((b) => scrRevoke(b), B.id);
  assert.ok(Date.now() - t0 < 2500, 'pas d\'attente sans écran à remettre à niveau');
  await waitFor(B.page, () => getComputedStyle(document.getElementById('screen-revoked')).display === 'flex');
  assert.deepEqual(await rp.evaluate(() => [scrList().length, _scrReg.screens.size, scrTarget()]), [0, 0, { k: 'all' }]);
  assert.notEqual((await session(rp)).channelId, next.channelId);
  await rp.evaluate(() => gwStop());
  for (const p of [r.remote]) assert.deepEqual(p.errors, []);
  await r.close();
});

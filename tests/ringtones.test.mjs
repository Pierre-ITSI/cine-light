// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Sonneries et sons de notification importés (onglet Appel, maquette 12) :
// import (taille, type, décodage WebAudio, IndexedDB), choix et volume par
// type (appel, SMS, notification), envoi aux écrans en fragments chiffrés et
// mise en cache, sonnerie en boucle coupée au décroché, notification jouée
// une fois, repli sur le son intégré (media:need), resynchronisation, entrées
// de la liste et déclenchement par la passerelle DMX.
// WebAudio de l'écran espionné : lectures (AudioBufferSourceNode) et sons
// synthétisés (OscillatorNode).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';
import { buildSacnDataPacket } from '../packages/dmx/index.js';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const RING_RE = /^__ring_[0-9a-f]{16}$/;
const MB5 = 5 * 1024 * 1024;

// WAV PCM 16 bits mono (sinusoïde) : un vrai son, décodable par WebAudio
function wav(sec, freq = 440, rate = 8000) {
  const n = Math.round(sec * rate), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * freq * i / rate)), 44 + i * 2);
  return b;
}
const tone = (name, sec, freq) => ({ name, mimeType: 'audio/wav', buffer: wav(sec, freq) });

// Espion WebAudio (écran)
const AUDIO_SPY = {
  fn: () => {
    window.__audio = [];
    const S = AudioBufferSourceNode.prototype, O = OscillatorNode.prototype;
    const start = S.start, stop = S.stop, osc = O.start;
    S.start = function (...a) {
      window.__audio.push({ ev: 'start', loop: this.loop, dur: this.buffer ? Math.round(this.buffer.duration * 10) / 10 : null });
      return start.apply(this, a);
    };
    S.stop = function (...a) { window.__audio.push({ ev: 'stop' }); return stop.apply(this, a); };
    O.start = function (...a) { window.__audio.push({ ev: 'osc' }); return osc.apply(this, a); };
  },
};
const audioLog = (sp) => sp.evaluate(() => window.__audio.slice());
const clearAudio = (sp) => sp.evaluate(() => { window.__audio.length = 0; });
const starts = (log) => log.filter((e) => e.ev === 'start');

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
const status = (page) => page.evaluate(() => document.getElementById('ringStatus').textContent);
// Import par le vrai champ fichier ; renvoie le message affiché
async function importFile(page, file) {
  await page.evaluate(() => _ringSetStatus(''));
  await page.setInputFiles('#ringImportInput', file);
  await waitFor(page, () => { const t = document.getElementById('ringStatus').textContent; return !!t && !t.startsWith('⏳'); }, null, { timeout: 15000 });
  return status(page);
}
const rows = (page) => page.evaluate(() => [...document.querySelectorAll('#ringLibRows .rt-row')].map((r) => ({
  name: r.querySelector('.rt-name').textContent, meta: r.querySelector('.rt-meta').textContent, sel: r.classList.contains('selected'),
})));
const activeChips = (page) => page.evaluate(() => [...document.querySelectorAll('#callRingPanel .chip.active')].map((c) => c.id));
const setVolume = (page, pct) => page.evaluate((v) => { document.getElementById('ringVolSlider').value = String(v); onRingVolume(); }, pct);
const shown = (page, id) => page.evaluate((id) => getComputedStyle(document.getElementById(id)).display !== 'none', id);
// Sons choisis dans la vue « Style et sonnerie » (maquette 36b) : ouverte le temps du geste
async function inView(page, fn) {
  await page.evaluate(() => openTelStyle());
  try { await fn(); } finally { await page.evaluate(() => closeTelStyle()); }
}

test('import : bon fichier (nom, durée, IndexedDB), 5 Mo au plus, pas un son, illisible, doublon ; suppression', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('call'); });
  assert.equal(await shown(page, 'ringLibLabel'), false, 'bibliothèque vide : pas de titre « Vos sonneries »');
  assert.deepEqual(await activeChips(page), ['callring-classic'], 'par défaut : Classique');
  // Bon fichier : importé, sélectionné pour l'appel, nom et durée affichés
  assert.match(await importFile(page, tone('sonnerie-prod.wav', 2, 440)), /^✓ « sonnerie-prod\.wav » importée/);
  const [t] = await page.evaluate(() => ringLib);
  assert.match(t.id, RING_RE, 'id dérivé du contenu');
  assert.deepEqual([t.name, t.dur, t.mime], ['sonnerie-prod.wav', 2, 'audio/wav']);
  assert.deepEqual(await rows(page), [{ name: 'sonnerie-prod.wav', meta: '0:02 · sélectionnée', sel: true }]);
  assert.equal(await shown(page, 'ringLibLabel'), true);
  assert.deepEqual(await activeChips(page), [], 'son importé choisi : aucun son intégré actif');
  assert.equal(await page.evaluate(() => ringSettings.call.sound), t.id);
  // Trop lourd (5 Mo + 1 octet) : refusé avant toute lecture
  assert.match(await importFile(page, { name: 'long.wav', mimeType: 'audio/wav', buffer: Buffer.alloc(MB5 + 1) }), /dépasse 5 Mo/);
  // Pas un son (type)
  assert.match(await importFile(page, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('bonjour') }), /n'est pas un fichier son/);
  assert.match(await importFile(page, { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('89504e47', 'hex') }), /n'est pas un fichier son/);
  // Annoncé comme son mais illisible (WebAudio ne le décode pas)
  assert.match(await importFile(page, { name: 'faux.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('pas un mp3 '.repeat(200)) }), /illisible/);
  // Même contenu sous un autre nom : même id, pas de doublon
  assert.match(await importFile(page, tone('copie.wav', 2, 440)), /déjà dans vos sonneries/);
  assert.equal(await page.evaluate(() => ringLib.length), 1);
  // Exactement 5 Mo : accepté
  const big = wav((MB5 - 44) / 2 / 48000, 300, 48000);
  assert.equal(big.length, MB5);
  assert.match(await importFile(page, { name: 'cinq-mo.wav', mimeType: 'audio/wav', buffer: big }), /importée/);
  assert.equal(await page.evaluate(() => ringLib.length), 2);
  // Rechargement : bibliothèque (IndexedDB) et choix (localStorage) retrouvés, aucun son en localStorage
  await page.reload();
  await page.evaluate(() => { startMode('remote'); switchTab('call'); });
  await waitFor(page, () => _ringLibLoaded && ringLib.length === 2);
  assert.deepEqual((await rows(page)).map((r) => [r.name, r.sel]), [['sonnerie-prod.wav', false], ['cinq-mo.wav', true]]);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some((k) => /base64|data:audio/.test(localStorage.getItem(k)))), false);
  assert.ok(await page.evaluate(() => localStorage.getItem('setremote-ring-v1').length < 400), 'réglages seulement');
  assert.equal(await page.evaluate(async () => (await ringLibData(ringLib[0].id)).slice(0, 22)), 'data:audio/wav;base64,');
  // Supprimer le son choisi : l'appel revient à Classique
  page.once('dialog', (d) => d.accept());
  await inView(page, () => page.locator('#ringLibRows .rt-row').nth(1).locator('.rt-del').click());
  await waitFor(page, () => ringLib.length === 1);
  assert.equal(await page.evaluate(() => ringSettings.call.sound), 'classic');
  assert.deepEqual(await activeChips(page), ['callring-classic']);
  page.once('dialog', (d) => d.dismiss()); // annuler : rien ne change
  await inView(page, () => page.locator('#ringLibRows .rt-del').click());
  assert.equal(await page.evaluate(() => ringLib.length), 1);
  page.once('dialog', (d) => d.accept());
  await inView(page, () => page.locator('#ringLibRows .rt-del').click());
  await waitFor(page, () => ringLib.length === 0);
  assert.equal(await shown(page, 'ringLibLabel'), false);
  // La suppression IndexedDB se termine après la mise à jour de l'interface :
  // attendre qu'elle soit écrite avant de recharger (sinon test instable en CI)
  await page.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      const m = await _ringTx('readonly', (s) => s.getAll());
      if (!m || !m.length) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  });
  await page.reload();
  await page.evaluate(() => { startMode('remote'); switchTab('call'); });
  await waitFor(page, () => _ringLibLoaded);
  assert.equal(await page.evaluate(() => ringLib.length), 0, 'supprimés de IndexedDB');
  assert.deepEqual(errors, []);
  await close();
});

test('choix par type : libellés, décroché, volume ; mémorisés au rechargement', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('call'); });
  const label = () => page.evaluate(() => [document.getElementById('ringPanelLabel').textContent, document.getElementById('ringVolLabel').textContent]);
  await importFile(page, tone('appel.wav', 1, 440));
  await setVolume(page, 80);
  const A = await page.evaluate(() => ringSettings.call.sound);
  assert.deepEqual(await label(page), ['Sonnerie', 'Volume de la sonnerie']);
  assert.equal(await shown(page, 'callAnswerBlock'), true, 'appel : bande son au décroché');
  // SMS : son de notification, sans décroché ; son par défaut tant qu'on n'a rien choisi
  await page.evaluate(() => setCallKind('sms'));
  assert.deepEqual(await label(page), ['Son de notification', 'Volume de la notification']);
  assert.equal(await shown(page, 'callAnswerBlock'), false);
  assert.equal(await shown(page, 'callRingPanel'), true);
  assert.deepEqual(await activeChips(page).then((c) => c.filter((x) => x.startsWith('callring'))), ['callring-classic']);
  assert.equal(await page.evaluate(() => document.getElementById('ringVolVal').textContent), '100 %');
  await importFile(page, tone('sms.wav', 1, 880));
  const B = await page.evaluate(() => ringSettings.sms.sound);
  assert.notEqual(A, B);
  await setVolume(page, 60);
  // La sonnerie de l'appel n'a pas bougé ; l'appel est sélectionnable depuis la ligne
  assert.deepEqual(await page.evaluate(() => ringSettings.call), { sound: A, vol: 0.8, vib: false });
  // Notification : Silencieux (panneau du son sous la tuile « Son »)
  await page.evaluate(() => { setCallKind('notif'); });
  await inView(page, () => page.click('#callring-silent'));
  assert.equal(await shown(page, 'callAnswerBlock'), false);
  // Champs envoyés selon le type
  const fields = await page.evaluate(() => ['call', 'sms', 'notif'].map((k) => { setCallKind(k); const f = callFormFields(); return [f.ring, f.ringId, f.ringVolume]; }));
  assert.deepEqual(fields, [['classic', A, 0.8], ['classic', B, 0.6], ['silent', undefined, undefined]]);
  // Rechargement : chaque type retrouve son choix
  await page.reload();
  await page.evaluate(() => { startMode('remote'); switchTab('call'); });
  await waitFor(page, () => _ringLibLoaded && ringLib.length === 2);
  assert.deepEqual(await page.evaluate(() => ringSettings), {
    call: { sound: A, vol: 0.8, vib: false }, sms: { sound: B, vol: 0.6, vib: false }, notif: { sound: 'silent', vol: 1, vib: false },
    discussion: { sound: 'silent', vol: 1, vib: false },
  });
  assert.deepEqual((await rows(page)).map((r) => [r.name, r.sel]), [['appel.wav', true], ['sms.wav', false]]);
  assert.equal(await page.evaluate(() => document.getElementById('ringVolVal').textContent), '80 %');
  await page.evaluate(() => setCallKind('sms'));
  assert.deepEqual((await rows(page)).map((r) => [r.meta, r.sel]), [['0:01', false], ['0:01 · sélectionnée', true]]);
  assert.equal(await page.evaluate(() => document.getElementById('ringVolSlider').value), '60');
  await page.evaluate(() => { setCallKind('notif'); });
  assert.deepEqual(await activeChips(page).then((c) => c.filter((x) => x.startsWith('callring'))), ['callring-silent']);
  // Toucher une ligne choisit ce son pour le type affiché
  await inView(page, () => page.locator('#ringLibRows .rt-row').nth(0).click());
  assert.equal(await page.evaluate(() => ringSettings.notif.sound), A);
  assert.deepEqual(errors, []);
  await close();
});

test('liste : l\'entrée garde le son et le volume de son type ; ancien SMS et son supprimé → Classique', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('call'); });
  await importFile(page, tone('prod.wav', 1, 440));
  const A = await page.evaluate(() => ringSettings.call.sound);
  await setVolume(page, 60);
  await page.evaluate(async () => { document.getElementById('callName').value = 'Maman'; await saveCurrentCall(); });
  await page.evaluate(async () => {
    setCallKind('sms'); setCallRing('digital');
    document.getElementById('ringVolSlider').value = '40'; onRingVolume();
    document.getElementById('callName').value = 'Léa'; await saveCurrentCall();
    // Le formulaire change ensuite : les entrées n'en dépendent plus
    setCallRing('soft'); setCallKind('call'); setCallRing('silent');
  });
  const entries = await page.evaluate(() => [callList.call[0], callList.sms[0]].map((e) => [e.ring, e.ringId, e.ringVolume]));
  assert.deepEqual(entries, [['classic', A, 0.6], ['digital', undefined, 0.4]]);
  const msgs = await page.evaluate(() => [callEntryMessage(callList.call[0], {}), callEntryMessage(callList.sms[0], {})].map((m) => [m.ring, m.ringId, m.ringVolume]));
  assert.deepEqual(msgs, [['classic', A, 0.6], ['digital', undefined, 0.4]]);
  await page.evaluate(() => setCallListKind('call'));
  assert.match(await page.textContent('#callListRows .cl-meta'), /♪ prod\.wav/);
  // Toucher l'entrée : le formulaire reprend son son et son volume
  await page.locator('#callListRows .cl-row').nth(0).click();
  await waitFor(page, () => ringSettings.call.sound !== 'silent');
  assert.deepEqual(await page.evaluate(() => ringSettings.call), { sound: A, vol: 0.6, vib: false });
  // Rechargement : entrées intactes ; un SMS enregistré par une version
  // précédente (sonnerie de l'appel, sans volume) garde son son d'origine
  await page.evaluate(() => {
    const o = JSON.parse(localStorage.getItem('setremote-call-list-v1'));
    o.sms.push({ id: 'old1', kind: 'sms', style: 'glass', name: 'Ancien', ring: 'silent', msg: 'x' });
    localStorage.setItem('setremote-call-list-v1', JSON.stringify(o));
  });
  await page.reload();
  await page.evaluate(() => { startMode('remote'); switchTab('call'); });
  await waitFor(page, () => _ringLibLoaded && ringLib.length === 1);
  assert.deepEqual(await page.evaluate(() => [callList.call[0], ...callList.sms].map((e) => [e.ring, e.ringId, e.ringVolume])),
    [['classic', A, 0.6], ['digital', undefined, 0.4], ['classic', undefined, undefined]]);
  // Son supprimé de la bibliothèque : l'entrée sonne en Classique (volume gardé)
  page.once('dialog', (d) => d.accept());
  await inView(page, () => page.locator('#ringLibRows .rt-del').click());
  await waitFor(page, () => ringLib.length === 0);
  const after = await page.evaluate(() => callEntryMessage(callList.call[0], {}));
  assert.deepEqual([after.ring, 'ringId' in after, after.ringVolume], ['classic', false, 0.6]);
  assert.doesNotMatch(await page.textContent('#callListRows .cl-meta'), /♪/);
  assert.deepEqual(errors, []);
  await close();
});

describe('télécommande et écran reliés', () => {
  let broker, remote, screen, rp, sp, A;
  before(async () => {
    broker = new FakeBroker();
    remote = await openPage(browser, { broker, seed: 51, autoConnect: true });
    rp = remote.page;
    await rp.evaluate(() => { startMode('remote'); switchTab('call'); });
    await connected(rp);
    screen = await openPage(browser, { broker, seed: 52, autoConnect: true, hash: await pairingHash(rp), init: AUDIO_SPY });
    sp = screen.page;
    await connected(sp);
    await waitFor(rp, () => _pairedScreens.size === 1);
    await waitFor(rp, () => _resyncTimer === null);
    await sleep(150);
    await broker.flush();
  });
  after(async () => {
    assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
    await screen?.close(); await remote?.close();
  });
  const imgStarts = async (id) => (await broker.sent(rp, 'media-img-start')).filter((m) => m.mediaId === id);
  const ringing = () => waitFor(sp, () => _callState === 'ringing');

  test('envoi : le son part en fragments chiffrés et reste en cache sur l\'écran', async () => {
    broker.clear();
    await importFile(rp, tone('sonnerie-prod.wav', 3, 440));
    A = await rp.evaluate(() => ringSettings.call.sound);
    await waitFor(sp, (id) => { const c = _mediaCache.get(id); return !!c && c.kind === 'audio' && !!c._buf; }, A);
    assert.equal(await sp.evaluate((id) => _mediaCache.get(id).data.slice(0, 22), A), 'data:audio/wav;base64,');
    await waitFor(rp, (id) => _screenCached.has(id), A);
    await waitFor(rp, () => /sur l'écran/.test(document.getElementById('ringStatus').textContent));
    await broker.flush();
    assert.deepEqual((await imgStarts(A)).map((m) => m.show), [false], 'un seul envoi, sans affichage');
    assert.ok(broker.log.every((e) => !e.payload.includes('data:audio') && !e.payload.includes('UklGR')), 'fragments chiffrés : aucun son en clair sur le relais');
  });

  test('appel : sonnerie importée en boucle au volume choisi, coupée au décroché, au refus et à la fin', async () => {
    await setVolume(rp, 80);
    broker.clear();
    await clearAudio(sp);
    await rp.click('#callTriggerBtn');
    await ringing();
    await waitFor(sp, () => !!_ringPlayer);
    const p = await sp.evaluate(() => ({ id: _ringPlayer.id, loop: _ringPlayer.src.loop, gain: _ringPlayer.gain.gain.value, timer: !!_callRingTimer }));
    assert.deepEqual([p.id, p.loop, p.timer], [A, true, false]);
    assert.ok(Math.abs(p.gain - 0.8) < 1e-6, 'volume 80 %');
    assert.deepEqual(starts(await audioLog(sp)), [{ ev: 'start', loop: true, dur: 3 }]);
    assert.equal((await audioLog(sp)).filter((e) => e.ev === 'osc').length, 0, 'aucun son intégré');
    await broker.flush();
    const [start] = await broker.sent(rp, 'call:start');
    assert.deepEqual([start.ring, start.ringId, start.ringVolume], ['classic', A, 0.8]);
    assert.deepEqual(await imgStarts(A), [], 'déjà sur l\'écran : rien à renvoyer');
    // Décroché : la sonnerie s'arrête
    await sp.locator('#screen-call .sc-ok').first().click();
    assert.deepEqual(await sp.evaluate(() => [_callState, _ringPlayer]), ['incall', null]);
    assert.equal((await audioLog(sp)).at(-1).ev, 'stop');
    await sp.locator('#screen-call .sc-no').first().click();
    // Refus
    await clearAudio(sp);
    await rp.click('#callTriggerBtn');
    await ringing();
    await waitFor(sp, () => !!_ringPlayer);
    await sp.locator('#screen-call .sc-no').first().click();
    assert.deepEqual(await sp.evaluate(() => [_callState, _ringPlayer]), ['idle', null]);
    assert.deepEqual((await audioLog(sp)).map((e) => e.ev), ['start', 'stop']);
    // « Terminer » depuis la télécommande pendant la sonnerie
    await sleep(400);
    await clearAudio(sp);
    await rp.click('#callTriggerBtn');
    await ringing();
    await waitFor(sp, () => !!_ringPlayer);
    await rp.evaluate(() => sendMsg({ type: 'call:end' }));
    await waitFor(sp, () => _callState === 'idle' && !_ringPlayer);
    assert.deepEqual((await audioLog(sp)).map((e) => e.ev), ['start', 'stop']);
    await sleep(400);
  });

  test('SMS et notification : son importé joué une fois (bannière et écran verrouillé), son intégré sinon', async () => {
    await rp.evaluate(() => { setCallKind('sms'); document.getElementById('lockToggle').checked = false; });
    await inView(rp, () => rp.locator('#ringLibRows .rt-row').nth(0).click()); // même son, choisi aussi pour les SMS
    assert.equal(await rp.evaluate(() => ringSettings.sms.sound), A);
    await clearAudio(sp);
    await rp.click('#callTriggerBtn');
    await waitFor(sp, () => _callState === 'notif');
    await waitFor(sp, () => window.__audio.some((e) => e.ev === 'start'));
    await sleep(700);
    let log = await audioLog(sp);
    assert.deepEqual(starts(log), [{ ev: 'start', loop: false, dur: 3 }], 'une seule lecture, sans boucle');
    assert.equal(log.filter((e) => e.ev === 'osc').length, 0);
    assert.equal(await sp.evaluate(() => _callRingTimer), null);
    await sp.evaluate(() => screenCallEnd());
    await sleep(400);
    // Notification sur faux écran verrouillé
    await rp.evaluate(() => { setCallKind('notif'); setNotifPresent('lock'); });
    await inView(rp, () => rp.locator('#ringLibRows .rt-row').nth(0).click());
    await clearAudio(sp);
    await rp.click('#ntSendBtn');
    await waitFor(sp, () => _callState === 'notif' && !!document.querySelector('#screen-call .sc-lock'));
    await waitFor(sp, () => window.__audio.some((e) => e.ev === 'start'));
    await sleep(500);
    assert.deepEqual(starts(await audioLog(sp)), [{ ev: 'start', loop: false, dur: 3 }]);
    await sp.evaluate(() => screenCallEnd());
    await sleep(500);
    // SMS avec un son intégré (Digitale) : synthétisé, aucune lecture de fichier
    await rp.evaluate(() => { setCallKind('sms'); setCallRing('digital'); });
    await clearAudio(sp);
    await rp.click('#callTriggerBtn');
    await waitFor(sp, () => _callState === 'notif');
    await sleep(300);
    log = await audioLog(sp);
    assert.equal(starts(log).length, 0);
    assert.equal(log.filter((e) => e.ev === 'osc').length, 2, 'Digitale : deux bips');
    await sp.evaluate(() => screenCallEnd());
    await rp.evaluate(() => { setCallKind('notif'); setNotifPresent('banner'); setCallKind('call'); });
    await sleep(400);
  });

  test('son absent de l\'écran : son intégré tout de suite, l\'écran le redemande (media:need) et le retrouve', async () => {
    // L'écran a perdu le son sans que la télécommande le sache
    await sp.evaluate((id) => { _mediaCache.delete(id); screenRingForget(id); }, A);
    await rp.evaluate((id) => { _ringSentAt.set(id, 0); }, A);
    assert.equal(await rp.evaluate((id) => _ringOnScreens.has(id), A), true);
    broker.clear();
    await clearAudio(sp);
    await rp.click('#callTriggerBtn');
    await ringing();
    assert.deepEqual(await sp.evaluate(() => [!!_callRingTimer, _ringPlayer]), [true, null], 'son intégré (Classique) en attendant');
    assert.ok((await audioLog(sp)).some((e) => e.ev === 'osc'));
    await broker.flush();
    assert.deepEqual((await broker.sent(sp, 'media:need')).map((m) => m.id), [A]);
    // La télécommande renvoie le son ; l'écran le remet en cache
    await waitFor(sp, (id) => _mediaCache.has(id), A);
    await broker.flush();
    assert.equal((await imgStarts(A)).length, 1);
    await rp.evaluate(() => sendMsg({ type: 'call:end' }));
    await waitFor(sp, () => _callState === 'idle');
    await sleep(400);
    // Appel suivant : de nouveau le son importé
    await clearAudio(sp);
    await rp.click('#callTriggerBtn');
    await ringing();
    await waitFor(sp, (id) => !!_ringPlayer && _ringPlayer.id === id, A);
    assert.equal(await sp.evaluate(() => _callRingTimer), null);
    await rp.evaluate(() => sendMsg({ type: 'call:end' }));
    await waitFor(sp, () => _callState === 'idle');
    await sleep(400);
  });

  test('resynchronisation : le son n\'est renvoyé que si l\'écran ne l\'a pas', async () => {
    const resync = async (fn) => {
      broker.clear();
      await fn();
      // La resynchronisation commence par la couleur, puis renvoie ce qui manque
      for (let i = 0; i < 100 && !(await broker.sent(rp, 'color')).length; i++) await sleep(50);
      await waitFor(rp, () => _resyncTimer === null);
      await sleep(300);
      await broker.flush();
    };
    // L'écran a le son : rien n'est renvoyé
    await resync(() => rp.evaluate(() => sendMsg({ type: 'hello' })));
    assert.ok((await broker.sent(rp, 'color')).length >= 1, 'resynchronisation faite');
    assert.deepEqual(await imgStarts(A), []);
    // L'écran l'a perdu (rechargement) : renvoyé, de nouveau en cache
    await resync(() => sp.evaluate((id) => { _mediaCache.delete(id); screenRingForget(id); sendCaps(); }, A));
    assert.equal((await imgStarts(A)).length, 1);
    await waitFor(sp, (id) => _mediaCache.has(id), A);
    // Un son importé qui ne sert plus à aucun type n'est pas renvoyé
    await rp.evaluate(() => { for (const k of ['call', 'sms', 'notif']) { setCallKind(k); setCallRing('classic'); } setCallKind('call'); });
    await resync(() => sp.evaluate((id) => { _mediaCache.delete(id); screenRingForget(id); sendCaps(); }, A));
    assert.deepEqual(await imgStarts(A), []);
    assert.equal(await rp.evaluate((id) => _ringOnScreens.has(id), A), false, 'renverra au prochain choix');
    // Choisi de nouveau : renvoyé aussitôt
    await inView(rp, () => rp.locator('#ringLibRows .rt-row').nth(0).click());
    await waitFor(sp, (id) => _mediaCache.has(id), A);
  });

  test('liste : « Appeler n° 1 » sonne avec le son et le volume de l\'entrée', async () => {
    await importFile(rp, tone('entree.wav', 2, 660));
    const B = await rp.evaluate(() => ringSettings.call.sound);
    await setVolume(rp, 45);
    await rp.evaluate(async () => { document.getElementById('callName').value = 'Régie'; await saveCurrentCall(); });
    // Le formulaire passe à autre chose
    await rp.evaluate(() => { setCallRing('silent'); document.getElementById('ringVolSlider').value = '100'; onRingVolume(); setCallListKind('call'); });
    await clearAudio(sp);
    broker.clear();
    await rp.click('#callListGo');
    await ringing();
    await waitFor(sp, () => !!_ringPlayer);
    const p = await sp.evaluate(() => ({ id: _ringPlayer.id, loop: _ringPlayer.src.loop, gain: _ringPlayer.gain.gain.value }));
    assert.deepEqual([p.id, p.loop], [B, true]);
    assert.ok(Math.abs(p.gain - 0.45) < 1e-6);
    await broker.flush();
    const [start] = await broker.sent(rp, 'call:start');
    assert.deepEqual([start.name, start.ringId, start.ringVolume], ['Régie', B, 0.45]);
    await rp.evaluate(() => sendMsg({ type: 'call:end' }));
    await waitFor(sp, () => _callState === 'idle');
  });
});

// ── Passerelle DMX (app native simulée) ──
const NATIVE = {
  fn: () => {
    window.SETREMOTE_NATIVE = { platform: 'android', bridge: 1 };
    window.__posted = [];
    window.ReactNativeWebView = { postMessage: (m) => window.__posted.push(JSON.parse(m)) };
  },
};
const CID = '5f1e7a52-3c4b-4d8e-9a10-2b3c4d5e6f70';
let _sacnSeq = 0;
const sacn = (page, slots) => page.evaluate((p) => window.SRNative.receive({ type: 'dmx:packets', packets: p }), [{
  src: '10.0.0.10', port: 5568,
  data: Buffer.from(buildSacnDataPacket({ cid: CID, universe: 1, data: slots, sequence: (++_sacnSeq) & 0xff, sourceName: 'Console' })).toString('base64'),
}]);
const E16 = (o = {}) => { const s = [255, 255, 255, 0, 0, 54, 128, 0, 0, 0, 128, 0, 0, 0, 0, 0]; for (const [k, v] of Object.entries(o)) s[k - 1] = v; return s; };

test('passerelle DMX : sons des entrées 1–20 sur l\'écran dès le démarrage ; appel et SMS de la console avec le son de l\'entrée', async () => {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed: 61, autoConnect: true, init: NATIVE });
  const rp = remote.page;
  await rp.evaluate(() => { startMode('remote'); switchTab('call'); });
  await connected(rp);
  // Avant l'écran : appel n° 1 avec le son A (70 %), SMS n° 1 avec le son B ;
  // le formulaire revient ensuite aux sons intégrés (A et B ne servent qu'à la liste)
  await importFile(rp, tone('alarme.wav', 2, 520));
  await setVolume(rp, 70);
  await rp.evaluate(async () => { document.getElementById('callName').value = 'Régie'; await saveCurrentCall(); setCallRing('classic'); });
  await rp.evaluate(() => setCallKind('sms'));
  await importFile(rp, tone('bip.wav', 1, 990));
  await rp.evaluate(async () => {
    document.getElementById('callName').value = 'Léa'; document.getElementById('callMsgText').value = 'Moteur !';
    await saveCurrentCall(); setCallRing('classic'); setCallKind('call');
  });
  const [A, B] = await rp.evaluate(() => [callList.call[0].ringId, callList.sms[0].ringId]);
  assert.ok(RING_RE.test(A) && RING_RE.test(B) && A !== B);
  const screen = await openPage(browser, { broker, seed: 62, autoConnect: true, hash: await pairingHash(rp), init: AUDIO_SPY });
  const sp = screen.page;
  await connected(sp);
  const sid = await sp.evaluate(() => screenId());
  await waitFor(rp, () => _screenOfSender.size === 1);
  await waitFor(rp, () => _resyncTimer === null);
  await sleep(300);
  assert.deepEqual(await sp.evaluate(([a, b]) => [_mediaCache.has(a), _mediaCache.has(b)], [A, B]), [false, false], 'passerelle arrêtée : rien d\'avance');
  // Démarrage de la passerelle : les deux sons partent vers l'écran
  await rp.evaluate(() => openDmxGateway());
  await waitFor(sp, ([a, b]) => _mediaCache.has(a) && _mediaCache.has(b), [A, B]);
  await rp.evaluate((id) => gwPatchSet(id, { universe: 1, address: 1, personality: 'extended16' }), sid);
  await sacn(rp, E16());
  await waitFor(sp, () => screenDmxLive());
  await broker.flush();
  broker.clear();
  await clearAudio(sp);
  // Appel n° 1 (10–19) : sonne aussitôt avec A, sans nouveau transfert
  await sacn(rp, E16({ 14: 12 }));
  await waitFor(sp, () => _callState === 'ringing' && !!_ringPlayer);
  const p = await sp.evaluate(() => ({ id: _ringPlayer.id, loop: _ringPlayer.src.loop, gain: _ringPlayer.gain.gain.value }));
  assert.deepEqual([p.id, p.loop], [A, true]);
  assert.ok(Math.abs(p.gain - 0.7) < 1e-6);
  await broker.flush();
  const sent = await broker.sent(rp);
  assert.deepEqual(sent.filter((m) => m.type === 'media-img-start'), [], 'aucun transfert au déclenchement');
  const start = sent.find((m) => m.type === 'call:start');
  assert.deepEqual([start.name, start.ringId, start.ringVolume, start.target], ['Régie', A, 0.7, { screens: [sid] }]);
  // 0 : raccrocher ; SMS n° 1 : son B joué une fois
  await sacn(rp, E16({ 14: 0 }));
  await waitFor(sp, () => _callState === 'idle' && !_ringPlayer);
  await sleep(400);
  await clearAudio(sp);
  await sacn(rp, E16({ 15: 10 }));
  await waitFor(sp, () => _callState === 'notif' && window.__audio.some((e) => e.ev === 'start'));
  assert.deepEqual(starts(await audioLog(sp)), [{ ev: 'start', loop: false, dur: 1 }], 'son B (1 s), une fois');
  await broker.flush();
  assert.equal((await broker.sent(rp, 'call:start')).at(-1).ringId, B);
  assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remote.close();
});

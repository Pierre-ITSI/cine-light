// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Lot 6 : (A) appel Verre sur téléphone VERROUILLÉ (piste « faire glisser pour répondre »),
// (B) les séquences prennent toujours le dessus (premier GO, envois suspendus, Reprendre
// la main, cible partielle, actions toujours permises), (C) « Retirer de l'écran » et
// « le dernier envoi gagne » (couches Tel retirées avant une lumière ou un média).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const SESSION = { channelId: 'A'.repeat(22), key: 'A'.repeat(43) };
const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });

// ───────────────────────── A · appel Verre verrouillé ─────────────────────────
async function screenOnly() {
  const o = await openPage(browser, {});
  await o.page.evaluate((s) => screenJoinSession(s), SESSION);
  // Gestes rapportés (phoneGesture, 94-sequence-phone.js) : relevés au lieu d'être envoyés
  await o.page.evaluate(() => { window.__g = []; window.phoneGesture = (g) => { window.__g.push(g); }; });
  return o;
}
const ring = (page, m) => page.evaluate((m) => screenCallStart(Object.assign({ kind: 'call', style: 'glass', name: 'Maman', label: 'mobile', ring: 'silent' }, m)), m);
const LOCK = { time: '', date: '' };
const callState = (page) => page.evaluate(() => _callState);
async function drag(page, ratio) {
  const h = await page.locator('.pc-slide-h').boundingBox(), tr = await page.locator('.pc-slide').boundingBox();
  const span = tr.width - h.width - 8;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + span * ratio, h.y + h.height / 2, { steps: 8 });
  return async () => { await page.mouse.up(); };
}

describe('A · appel Verre verrouillé', () => {
  test('rendu : lock + Verre = piste ; déverrouillé, Tonal, Épuré et bandeau inchangés', async () => {
    const { page, errors, close } = await screenOnly();
    await ring(page, { lock: LOCK });
    const locked = await page.evaluate(() => ({
      locked: !!document.querySelector('.pc.pc-locked'), slide: !!document.querySelector('.pc-slide .pc-slide-h'),
      label: document.querySelector('.pc-slide-label').textContent,
      minis: [...document.querySelectorAll('.pc-extra .pc-col')].map((c) => c.textContent.trim()),
      decline: !!document.querySelector('.pc-extra .pc-btn.mini.no[data-act=decline]'),
      main: !!document.querySelector('.pc-main'), name: document.querySelector('.pc-name').textContent,
      avatar: !!document.querySelector('.pc-avatar'),
    }));
    assert.deepEqual(locked, { locked: true, slide: true, label: 'faire glisser pour répondre', minis: ['Me le rappeler', 'Refuser', 'Message'], decline: true, main: false, name: 'Maman', avatar: false });
    // Refuser est rouge (la couleur « refus », pas le verre)
    assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('.pc-extra .pc-btn.mini.no')).backgroundColor), /rgb\(217, 58, 48\)/);
    await page.evaluate(() => screenCallEnd());
    await sleep(600);
    // Déverrouillé : plein écran actuel (Refuser / Accepter)
    await ring(page, {});
    assert.deepEqual(await page.evaluate(() => ({ locked: !!document.querySelector('.pc-locked'), slide: !!document.querySelector('.pc-slide'), main: [...document.querySelectorAll('.pc-main .pc-col')].map((c) => c.textContent.trim()) })),
      { locked: false, slide: false, main: ['Refuser', 'Accepter'] });
    // Tonal et Épuré : rendu inchangé même avec lock
    for (const style of ['tonal', 'minimal']) {
      await page.evaluate(() => screenCallEnd()); await sleep(500);
      await ring(page, { style, lock: LOCK });
      assert.equal(await page.evaluate(() => !!document.querySelector('.pc-slide, .pc-locked')), false, style);
    }
    // Bandeau : inchangé
    await page.evaluate(() => screenCallEnd()); await sleep(500);
    await ring(page, { present: 'banner', lock: LOCK });
    assert.equal(await page.evaluate(() => !!document.querySelector('.pbc') && !document.querySelector('.pc-slide')), true);
    assert.deepEqual(errors, []);
    await close();
  });

  test('glisser : relâché avant 85 % la piste revient ; jusqu\'au bout = répondre, geste rapporté une seule fois', async () => {
    const { page, errors, close } = await screenOnly();
    await ring(page, { lock: LOCK });
    const up = await drag(page, 0.55);
    assert.equal(await page.evaluate(() => document.querySelector('.pc-slide-h').style.transform !== ''), true, 'le rond suit le doigt');
    assert.equal(await page.evaluate(() => parseFloat(document.querySelector('.pc-slide').style.getPropertyValue('--p')) > 0.4), true, 'le libellé s\'estompe');
    await up();
    assert.equal(await page.evaluate(() => document.querySelector('.pc-slide-h').style.transform), '', 'retour au départ');
    assert.equal(await callState(page), 'ringing');
    assert.deepEqual(await page.evaluate(() => window.__g), []);
    await sleep(450); // retour élastique terminé
    const end = await drag(page, 1);
    await end();
    await waitFor(page, () => _callState === 'incall');
    await sleep(150); // le clic qui suit le glissement ne compte pas pour un second toucher
    assert.deepEqual(await page.evaluate(() => window.__g), ['answer']);
    assert.deepEqual(errors, []);
    await close();
  });

  test('repli accessible : toucher, Entrée et Espace sur le rond répondent ; Refuser raccroche', async () => {
    const { page, errors, close } = await screenOnly();
    for (const how of ['click', 'Enter', 'Space']) {
      await ring(page, { lock: LOCK });
      assert.equal(await page.evaluate(() => document.querySelector('.pc-slide-h').tagName), 'BUTTON');
      if (how === 'click') await page.click('.pc-slide-h');
      else { await page.focus('.pc-slide-h'); await page.keyboard.press(how); }
      await waitFor(page, () => _callState === 'incall');
      await page.evaluate(() => { screenCallEnd(); }); await sleep(500);
    }
    assert.deepEqual(await page.evaluate(() => window.__g), ['answer', 'answer', 'answer']);
    await ring(page, { lock: LOCK });
    await page.click('.pc-extra .pc-btn.mini.no');
    await waitFor(page, () => _callState === 'idle');
    assert.deepEqual(errors, []);
    await close();
  });

  test('mouvement réduit : le libellé ne scintille plus', async () => {
    const o = await openPage(browser, {});
    await o.page.emulateMedia({ reducedMotion: 'reduce' });
    await o.page.evaluate((s) => screenJoinSession(s), SESSION);
    await ring(o.page, { lock: LOCK });
    assert.equal(await o.page.evaluate(() => getComputedStyle(document.querySelector('.pc-slide-label')).animationName), 'none');
    await o.close();
  });

  test('Tel : « Verrouillé » envoie lock avec present full ; enregistré, il revient ; hors Verre, pas de lock', async () => {
    const { page, errors, close } = await openPage(browser, {});
    await page.evaluate(() => { startMode('remote'); switchTab('call'); setCallKind('call'); });
    await page.evaluate(() => setCallPresent('lock'));
    assert.deepEqual(await page.evaluate(() => { const f = callFormFields(); return [f.present, f.lock]; }), ['full', { time: '', date: '' }]);
    assert.match(await page.evaluate(() => telRowSummary('call').look), /verrouillé/);
    await page.evaluate(() => setCallStyle('tonal'));
    assert.deepEqual(await page.evaluate(() => { const f = callFormFields(); return [f.present, f.lock]; }), ['full', null], 'Tonal : pas de téléphone verrouillé');
    await page.evaluate(() => { setCallStyle('glass'); });
    const e = await page.evaluate(() => _clFormEntry().e);
    assert.deepEqual(e.lock, { time: '', date: '' });
    await page.evaluate(() => setCallPresent('banner'));
    assert.equal(await page.evaluate(() => callFormFields().lock), null);
    // Entrée chargée : la présentation « Verrouillé » revient
    await page.evaluate(async () => { callList.call = [Object.assign({ id: 'z1', kind: 'call', style: 'glass', name: 'Maman', label: 'mobile', ring: 'silent', ringVolume: 1, present: 'full', photoMode: 'avatar', autoAnswer: 0, hasPhoto: false, hasAudio: false }, { lock: { time: '', date: '' } })]; persistCallList(); await selectCallEntry('z1'); });
    assert.equal(await page.evaluate(() => callPresent), 'lock');
    assert.deepEqual(errors, []);
    await close();
  });
});

// ───────────────────────── Télécommande + écrans ─────────────────────────
async function rig(n, seed) {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed, autoConnect: true });
  const rp = remote.page;
  await rp.evaluate(() => { startMode('remote'); SEQ_GO_GUARD_MS = 0; });
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
  await waitFor(rp, () => _resyncTimer === null);
  await sleep(200);
  await broker.flush();
  return { broker, remote, rp, screens, close: async () => { for (const s of screens) await s.close(); await remote.close(); } };
}
const noErrors = (r) => { for (const p of [r.remote, ...r.screens]) assert.deepEqual(p.errors, []); };
const setSteps = (rp, steps) => rp.evaluate((steps) => { _seq.steps = seqSanitizeSteps(steps); _seq.target = seqResolveTarget(null, _seq.steps); seqSave(); renderSeq(); }, steps);
const st = (id, kind, ref, trig, target, opt) => ({ id, kind, ref, trig: trig || { k: 'go' }, target, opt: opt || {} });
const fixtures = (rp) => rp.evaluate(() => {
  callList.call = [{ id: 'c1', kind: 'call', style: 'glass', name: 'Maman', label: 'mobile', ring: 'silent', ringVolume: 1, present: 'full', photoMode: 'avatar', autoAnswer: 0, hasPhoto: false, hasAudio: false }];
  callList.sms = [{ id: 's1', kind: 'sms', style: 'glass', name: 'Maman', msg: 'Tu es où ?', appName: 'SMS', appColor: '#2f8cf0', ring: 'silent', ringVolume: 1, lock: { time: '', date: '' }, hasPhoto: false, hasAudio: false }];
  persistCallList();
  colorMemories = [{ id: 'k1', name: 'ambiance nuit', spec: { kelvin: 3200, tint: 0, dimmer: 40, wheelHex: '#ffffff', crossfade: 0 }, strobe: { active: false, random: false, freq: 2, dur: 50, freqMax: 8, durMax: 200, torch: false } }];
  persistColorMemories();
});
const phoneMode = (page) => page.evaluate(() => (typeof _scPhone !== 'undefined' && _scPhone ? _scPhone.mode : 'off'));
const chatShown = (page) => page.evaluate(() => getComputedStyle(document.getElementById('screen-chat')).display !== 'none');
const callShown = (page) => page.evaluate(() => getComputedStyle(document.getElementById('screen-call')).display !== 'none' && _callState !== 'idle');
const baseColor = (page) => page.evaluate(() => screenBaseColor);
const confirmOpen = (rp) => rp.evaluate(() => appConfirmShown());
const confirmOk = async (rp) => { await rp.click('#acOk'); };
const confirmCancel = async (rp) => { await rp.click('#acCancel'); };

describe('A · séquence : appel sur un téléphone verrouillé', () => {
  let r, rp, sp, sid;
  before(async () => { r = await rig(1, 61); rp = r.rp; sp = r.screens[0].page; sid = r.screens[0].id; await fixtures(rp); await rp.evaluate(() => { switchTab('seq'); setSeqMode('play'); }); });
  after(async () => { noErrors(r); await r?.close(); });

  test('téléphone verrouillé : l\'appel arrive avec lock (piste) ; déverrouillé : tel qu\'enregistré', async () => {
    const T = { k: 'screen', id: sid };
    await setSteps(rp, [st('a1', 'sms', 's1', { k: 'go' }, T), st('a2', 'call', 'c1', { k: 'go' }, T), st('a3', 'sms', 's1', { k: 'gesture', g: 'answer' }, T)]);
    await rp.click('#seqGoBtn');
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 1);
    assert.equal(await phoneMode(sp), 'locked');
    await rp.click('#seqGoBtn');
    await waitFor(sp, () => _callState === 'ringing');
    assert.equal(await sp.evaluate(() => !!document.querySelector('#screen-call .pc-slide-h') && !document.querySelector('#screen-call .pc-main')), true);
    // Le geste « répondre » glissé est rapporté à la séquence (phone:gesture)
    r.broker.clear();
    const h = await sp.locator('.pc-slide-h').boundingBox(), tr = await sp.locator('.pc-slide').boundingBox();
    await sp.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await sp.mouse.down();
    await sp.mouse.move(h.x + h.width / 2 + tr.width, h.y + h.height / 2, { steps: 8 }); await sp.mouse.up();
    await waitFor(sp, () => _callState === 'incall');
    await waitFor(rp, () => seqPos() === 2); // l'étape qui attend « répond » est lancée
    await r.broker.flush();
    assert.ok((await r.broker.sent(sp, 'phone:gesture')).some((m) => m.g === 'answer'), 'geste « répondre » rapporté à la séquence');
    // Recommencer, téléphone déverrouillé : l'entrée part telle quelle (plein écran, Refuser / Accepter)
    await rp.evaluate(async () => { seqRestart(); await _seqChain; });
    await waitFor(sp, () => _callState === 'idle');
    await setSteps(rp, [st('b1', 'call', 'c1', { k: 'go' }, T)]);
    await rp.evaluate((id) => { _seqPhone(id, 'glass').mode = 'unlocked'; }, sid);
    await rp.click('#seqGoBtn');
    await waitFor(sp, () => _callState === 'ringing');
    assert.equal(await sp.evaluate(() => !document.querySelector('#screen-call .pc-slide') && !!document.querySelector('#screen-call .pc-main')), true);
  });
});

// ───────────────────────── B · séquences prioritaires ─────────────────────────
describe('B · premier GO : le reste est coupé', () => {
  let r, rp, A, B;
  before(async () => { r = await rig(2, 62); rp = r.rp; [A, B] = r.screens; await fixtures(rp); await rp.evaluate(() => { switchTab('seq'); setSeqMode('play'); }); });
  after(async () => { noErrors(r); await r?.close(); });

  test('rien d\'actif : pas de boîte, couleur noire posée avant l\'étape', async () => {
    await setSteps(rp, [st('p1', 'sms', 's1', { k: 'go' }, { k: 'screen', id: A.id })]);
    await rp.click('#seqGoBtn');
    assert.equal(await confirmOpen(rp), false);
    await waitFor(rp, () => _seqRun.state === 'ended' || _seqRun.state === 'running');
    await waitFor(A.page, () => document.querySelectorAll('#screen-phone .pn').length === 1);
    assert.equal(await baseColor(A.page), '#000000');
    await rp.evaluate(async () => { seqRestart(); await _seqChain; });
  });

  test('lumière, effet, appel et discussion déjà là : boîte « Couper et lancer » ; Annuler ne coupe rien', async () => {
    const T = { k: 'screen', id: A.id };
    await setSteps(rp, [st('q1', 'sms', 's1', { k: 'go' }, T)]);
    await rp.evaluate((id) => {
      scrSetTarget({ k: 'screen', id });
      sendMsg({ type: 'color', color: '#E02020' });
      sendMsg({ type: 'effect', name: 'police', active: true, params: {} });
      setCallKind('discussion'); openChatOnTarget(); sendNextChatMessage();
    }, A.id);
    await waitFor(A.page, () => _screenFxR.current() === 'police');
    await waitFor(A.page, () => !!document.querySelector('#screen-chat .pt-b'));
    await rp.click('#seqGoBtn');
    await waitFor(rp, () => appConfirmShown());
    const txt = await rp.textContent('#acText');
    assert.match(txt, /Les autres envois seront coupés sur Écran 1/);
    assert.match(txt, /lumière #E02020 et effet « Police »/);
    assert.match(txt, /discussion « .* » ouverte/);
    assert.equal(await rp.textContent('#acOk'), 'Couper et lancer');
    await confirmCancel(rp);
    assert.equal(await rp.evaluate(() => _seqRun.state), 'idle');
    await sleep(200);
    assert.equal((await baseColor(A.page)).toLowerCase(), '#e02020');
    assert.equal(await A.page.evaluate(() => _screenFxR.current()), 'police');
    assert.equal(await chatShown(A.page), true);
    // Couper et lancer : tout est retiré, la séquence démarre
    await rp.click('#seqGoBtn');
    await waitFor(rp, () => appConfirmShown());
    await confirmOk(rp);
    await waitFor(A.page, () => document.querySelectorAll('#screen-phone .pn').length === 1);
    assert.equal(await A.page.evaluate(() => _screenFxR.current()), null);
    assert.equal(await chatShown(A.page), false);
    assert.equal(await rp.evaluate(() => _chat.open), false);
    assert.equal(await baseColor(A.page), '#000000', 'couleur noire, pas « Noir » (le faux téléphone reste visible)');
    assert.equal(await A.page.evaluate(() => getComputedStyle(document.getElementById('screen-blackout')).display), 'none');
    assert.equal(await rp.evaluate((id) => scrState(id).effect, A.id), null);
    await rp.evaluate(async () => { seqRestart(); await _seqChain; });
  });

  test('après Recommencer, ce que la séquence a posé elle-même ne redemande rien', async () => {
    await setSteps(rp, [st('r1', 'color', 'k1', { k: 'go' }, { k: 'screen', id: A.id })]);
    await rp.click('#seqGoBtn');
    await waitFor(rp, () => _seqRun.state === 'ended');
    await rp.evaluate(async () => { seqRestart(); await _seqChain; });
    await rp.click('#seqGoBtn');
    assert.equal(await confirmOpen(rp), false);
    await rp.evaluate(async () => { seqRestart(); await _seqChain; });
  });
});

describe('B · envois suspendus, Reprendre la main, cible partielle, actions permises', () => {
  let r, rp, A, B, C;
  before(async () => {
    r = await rig(3, 63); rp = r.rp; [A, B, C] = r.screens;
    await fixtures(rp);
    await rp.evaluate(([a, b, c]) => { scrCreateGroup('Salon', [a, b]); switchTab('seq'); setSeqMode('play'); }, [A.id, B.id, C.id]);
    await setSteps(rp, [st('h1', 'sms', 's1', { k: 'go' }, { k: 'screen', id: A.id }), st('h2', 'color', 'k1', { k: 'go' }, { k: 'screen', id: A.id })]);
    await rp.click('#seqGoBtn');
    await waitFor(A.page, () => document.querySelectorAll('#screen-phone .pn').length === 1);
  });
  after(async () => { noErrors(r); await r?.close(); });
  const look = (page) => page.evaluate(() => [screenBaseColor, _screenFxR.current()]);

  test('cible = l\'écran tenu : lumière et effet suspendus, bandeau, voile, Média et Tel aussi', async () => {
    await rp.evaluate((id) => { scrSetTarget({ k: 'screen', id }); switchTab('light'); }, A.id);
    const before = await baseColor(A.page);
    assert.equal(await rp.evaluate(() => scrAddress({ type: 'color', color: '#123456' })), null);
    assert.equal(await rp.evaluate(() => scrAddress({ type: 'effect', name: 'police', active: true, params: {} })), null);
    await rp.evaluate(() => { sendMsg({ type: 'color', color: '#123456' }); });
    await sleep(300);
    assert.equal(await baseColor(A.page), before);
    const ui = await rp.evaluate(() => ({
      banner: document.getElementById('tabHold') && document.getElementById('tabHold').textContent, soft: document.getElementById('tabHold').classList.contains('soft'),
      veil: !!document.querySelector('#content-light > .tg-veil'), take: !!document.getElementById('tabHoldTake'),
    }));
    assert.match(ui.banner, /Séquence en cours · étape 1 \/ 2/);
    assert.match(ui.banner, /Écran 1 : vos envois sont suspendus/);
    assert.equal(ui.soft, false); assert.equal(ui.veil, true); assert.equal(ui.take, true);
    for (const tab of ['effects', 'media']) {
      await rp.evaluate((t) => switchTab(t), tab);
      assert.equal(await rp.evaluate((t) => !!document.querySelector('#content-' + t + ' > .tg-veil') && !!document.getElementById('tabHold'), tab), true, tab);
    }
    await rp.evaluate(() => switchTab('call'));
    assert.equal(await rp.evaluate(() => !!document.querySelector('#content-call > .tg-veil') && !!document.getElementById('tabHold')), true, 'Tel');
    // L'onglet Séquence n'est pas concerné
    await rp.evaluate(() => switchTab('seq'));
    assert.equal(await rp.evaluate(() => !document.getElementById('tabHold')), true);
  });

  test('toujours permis : Noir, arrêts, Identifier, transport média ; entrées Média et Tel suspendues', async () => {
    await rp.evaluate((id) => { scrSetTarget({ k: 'screen', id }); }, A.id);
    const same = (m) => rp.evaluate((m) => { const o = scrAddress(m); return !!o && o.type === m.type; }, m);
    for (const m of [{ type: 'blackout', on: true }, { type: 'strobe', active: false }, { type: 'effect', name: null, active: false }, { type: 'media-stop' }, { type: 'torch-onoff', on: false },
      { type: 'torch-effect', effect: 'stop' }, { type: 'call:end' }, { type: 'chat:close' }, { type: 'media-ctrl', action: 'pause' }, { type: 'screen:identify' }]) {
      assert.equal(await same(m), true, m.type);
    }
    // Noir arrive vraiment sur l'écran tenu, puis se lève
    await rp.evaluate(() => setRemoteBlackout(true));
    await waitFor(A.page, () => getComputedStyle(document.getElementById('screen-blackout')).display !== 'none');
    await rp.evaluate(() => setRemoteBlackout(false));
    await waitFor(A.page, () => getComputedStyle(document.getElementById('screen-blackout')).display === 'none');
    // Média : refusé, statut explicite ; Tel : rien ne part, la confirmation s'ouvre
    await rp.evaluate(() => { _mediaPool = [{ id: 'mm1', kind: 'img', name: 'plage', file: null, thumb: null }]; mediaShowOn(_mediaPool[0], scrTargetIds(), true); });
    assert.equal(await rp.evaluate((id) => scrState(id).media, A.id), null);
    assert.equal(await rp.evaluate(() => appConfirmShown()), true, 'une seule confirmation');
    await confirmCancel(rp);
    await sleep(1300);
    await rp.evaluate(() => { setCallKind('sms'); triggerCall(); });
    await sleep(200);
    assert.equal(await callShown(A.page), false);
    assert.equal(await rp.evaluate(() => _telCall.phase), 'idle');
    await confirmCancel(rp);
  });

  test('Reprendre la main : confirmation, puis Pause auto et envois libérés jusqu\'au prochain GO', async () => {
    await sleep(1300);
    await rp.evaluate((id) => { scrSetTarget({ k: 'screen', id }); switchTab('light'); }, A.id);
    await rp.click('#tabHoldTake');
    assert.match(await rp.textContent('#acText'), /Une séquence est en cours sur Écran 1\. Reprendre la main la met en pause auto/);
    await confirmCancel(rp);
    assert.equal(await rp.evaluate(() => _seqRun.state), 'running', 'Annuler : rien ne change');
    await sleep(1300);
    await rp.click('.tg-veil'); // toucher le voile = même confirmation
    await waitFor(rp, () => appConfirmShown());
    await confirmOk(rp);
    assert.deepEqual(await rp.evaluate(() => [_seqRun.state, _seqRun.released, _seqRun.timer]), ['stopped', true, null], 'Pause auto, plus de minuterie');
    assert.equal(await rp.evaluate(() => !document.getElementById('tabHold') && !document.querySelector('.tg-veil')), true);
    await rp.evaluate(() => sendMsg({ type: 'color', color: '#123456' }));
    await waitFor(A.page, () => screenBaseColor.toLowerCase() === '#123456');
    // GO : la séquence reprend, les écrans sont de nouveau tenus
    await rp.evaluate(() => switchTab('seq'));
    await rp.click('#seqGoBtn');
    await waitFor(rp, () => _seqRun.state === 'ended' || _seqRun.state === 'running');
    assert.equal(await rp.evaluate(() => _seqRun.released), false);
    await rp.evaluate(() => switchTab('light'));
    assert.equal(await rp.evaluate(() => !!document.getElementById('tabHold')), true);
  });

  test('cible partielle (groupe dont un écran est tenu) : bandeau discret, envoi aux écrans libres seulement', async () => {
    await rp.evaluate(() => { scrSetTarget({ k: 'group', id: _scrReg.groups[0].id }); switchTab('light'); });
    const ui = await rp.evaluate(() => ({ t: document.getElementById('tabHold').textContent, soft: document.getElementById('tabHold').classList.contains('soft'), veil: !!document.querySelector('.tg-veil'), take: !!document.getElementById('tabHoldTake') }));
    assert.match(ui.t, /Écran 1 est tenu par la séquence\. Vos envois iront seulement à Écran 2\./);
    assert.deepEqual([ui.soft, ui.veil, ui.take], [true, false, false]);
    const a0 = await baseColor(A.page), c0 = await baseColor(C.page);
    await rp.evaluate(() => sendMsg({ type: 'color', color: '#00aa55' }));
    await waitFor(B.page, () => screenBaseColor.toLowerCase() === '#00aa55');
    await sleep(300);
    assert.equal(await baseColor(A.page), a0, 'l\'écran tenu ne reçoit rien');
    assert.equal(await baseColor(C.page), c0, 'hors groupe : rien');
    assert.deepEqual(await rp.evaluate(() => scrAddress({ type: 'color', color: '#00aa55' }).target), { screens: [B.id] });
  });
});

// ───────────────────────── C · Retirer de l'écran, dernier envoi gagne ─────────────────────────
describe('C · Retirer de l\'écran', () => {
  let r, rp, sp, sid;
  before(async () => { r = await rig(1, 64); rp = r.rp; sp = r.screens[0].page; sid = r.screens[0].id; await fixtures(rp); await rp.evaluate((id) => { scrSetTarget({ k: 'screen', id }); switchTab('call'); }, sid); });
  after(async () => { noErrors(r); await r?.close(); });
  // Lignes de la barre : « Type « nom » · affiché sur … · [Retirer de l'écran] »
  const line = (page) => page.evaluate(() => {
    const e = document.getElementById('telOn');
    if (!e || e.style.display === 'none') return null;
    const rows = [...e.querySelectorAll('.on-row')].map((r) => [r.querySelector('b').textContent, r.querySelector('.on-t span').textContent, r.querySelector('.on-x') ? r.querySelector('.on-x').textContent : null]);
    return { t: rows.map((x) => x.filter(Boolean).join(' · ')).join(' | '), btn: !!e.querySelector('.on-x') };
  });

  for (const [kind, label] of [['sms', 'SMS'], ['notif', 'Notification']]) {
    test(label + ' : une ligne « ' + label + ' « … » affiché sur … » et Retirer de l\'écran', async () => {
      assert.equal(await line(rp), null);
      await rp.evaluate((k) => { setCallKind(k); triggerCall(); }, kind);
      await waitFor(sp, () => _callState === 'notif');
      await waitFor(rp, () => { const e = document.getElementById('telOn'); return e && e.style.display !== 'none'; });
      const l = await line(rp);
      assert.match(l.t, new RegExp('^' + label + ' « .+ » · affiché sur Écran 1 · Retirer de l\'écran$'));
      assert.equal(l.btn, true);
      await rp.click('#telOn .on-x');
      await waitFor(sp, () => _callState === 'idle');
      await waitFor(rp, () => document.getElementById('telOn').style.display === 'none');
    });
  }

  test('appel : la ligne indique l\'écran, sans bouton (Raccrocher reste l\'action)', async () => {
    await rp.evaluate(() => { setCallKind('call'); triggerCall(); });
    await waitFor(sp, () => _callState === 'ringing');
    await waitFor(rp, () => document.getElementById('telOn').style.display !== 'none');
    const l = await line(rp);
    assert.match(l.t, /^Appel « .+ » · affiché sur Écran 1$/);
    assert.equal(l.btn, false);
    assert.equal(await rp.evaluate(() => getComputedStyle(document.getElementById('callHangBtn')).display !== 'none'), true);
    await rp.click('#callHangBtn');
    await waitFor(sp, () => _callState === 'idle');
  });

  test('discussion : la ligne et Retirer de l\'écran ferment le fil sur l\'écran', async () => {
    await rp.evaluate(() => { setCallKind('discussion'); openChatOnTarget(); sendNextChatMessage(); });
    await waitFor(sp, () => !!document.querySelector('#screen-chat .pt-b'));
    await waitFor(rp, () => document.getElementById('telOn').style.display !== 'none');
    const l = await line(rp);
    assert.match(l.t, /^Discussion « .+ » · affiché sur Écran 1 · Retirer de l'écran$/);
    await rp.click('#telOn .on-x');
    await waitFor(sp, () => document.getElementById('screen-chat').style.display === 'none');
    assert.equal(await rp.evaluate(() => _chat.open), false);
    await waitFor(rp, () => document.getElementById('telOn').style.display === 'none');
  });
});

describe('C · le dernier envoi gagne', () => {
  let r, rp, A, B;
  before(async () => { r = await rig(2, 65); rp = r.rp; [A, B] = r.screens; await fixtures(rp); await rp.evaluate((id) => { scrSetTarget({ k: 'screen', id }); setCallKind('discussion'); }, A.id); });
  after(async () => { noErrors(r); await r?.close(); });
  const topLayer = (page) => page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return el ? (el.closest('#screen-chat') ? 'chat' : el.closest('#screen-call') ? 'call' : el.closest('#screen-phone') ? 'phone' : 'autre') : null;
  });

  test('une couleur après une discussion ouverte : le fil est retiré (Annuler le rouvre), la couleur se voit', async () => {
    await rp.evaluate(() => { openChatOnTarget(); sendNextChatMessage(); });
    await waitFor(A.page, () => !!document.querySelector('#screen-chat .pt-b'));
    assert.equal(await topLayer(A.page), 'chat');
    await rp.evaluate(() => sendMsg({ type: 'color', color: '#E02020' }));
    await waitFor(A.page, () => screenBaseColor.toLowerCase() === '#e02020' && document.getElementById('screen-chat').style.display === 'none');
    assert.equal(await topLayer(A.page), 'autre', 'plus aucune couche Tel au-dessus');
    assert.equal(await rp.evaluate(() => _chat.open), false);
    assert.match(await rp.textContent('#usText'), /^Discussion « .+ » retirée de l'écran$/);
    assert.equal(await rp.evaluate(() => getComputedStyle(document.getElementById('undo-snack')).display !== 'none'), true);
    // Annuler : la discussion revient (le fil et son avancement étaient gardés)
    await rp.click('#usUndo');
    await waitFor(A.page, () => document.getElementById('screen-chat').style.display !== 'none');
    assert.equal(await rp.evaluate(() => _chat.open), true);
    // Un curseur de couleur (rafale) : un seul retrait
    r.broker.clear();
    await rp.evaluate(() => { for (let i = 0; i < 10; i++) sendMsg({ type: 'color', color: '#10' + (20 + i) + '30' }); });
    await sleep(300); await r.broker.flush();
    assert.equal((await r.broker.sent(rp, 'chat:close')).length, 1);
  });

  test('un SMS en bandeau, un appel : effet, stroboscope et média les retirent aussi', async () => {
    const send = (type) => rp.evaluate((type) => { setCallKind('sms'); triggerCall(); }, type);
    await send('sms');
    await waitFor(A.page, () => _callState === 'notif');
    await rp.evaluate(() => sendMsg({ type: 'effect', name: 'police', active: true, params: {} }));
    await waitFor(A.page, () => _callState === 'idle' && _screenFxR.current() === 'police');
    await rp.evaluate(() => sendMsg({ type: 'effect', name: null, active: false }));
    await rp.evaluate(() => { setCallKind('call'); triggerCall(); });
    await waitFor(A.page, () => _callState === 'ringing');
    await rp.evaluate(() => { _mediaPool = [{ id: 'mx1', kind: 'img', name: 'plage', file: null, thumb: null }]; mediaShowOn(_mediaPool[0], [scrTargetIds()[0]], true); });
    await waitFor(A.page, () => _callState === 'idle');
  });

  test('les écrans tenus par une séquence ne sont pas touchés (elle prime) ; les autres, si', async () => {
    await rp.evaluate(async ([a, b]) => {
      for (const id of [a, b]) sendMsg({ type: 'call:start', kind: 'sms', style: 'glass', name: 'Léa', msg: 'Salut', ring: 'silent', present: 'full', target: { screens: [id] } });
      scrCreateGroup('Duo', [a, b]); scrSetTarget({ k: 'group', id: _scrReg.groups[0].id });
    }, [A.id, B.id]);
    await waitFor(A.page, () => _callState === 'notif'); await waitFor(B.page, () => _callState === 'notif');
    // Séquence en cours sur A seulement
    await rp.evaluate((a) => { _seq.steps = seqSanitizeSteps([{ id: 'z1', kind: 'sms', ref: 's1', trig: { k: 'go' }, target: { k: 'screen', id: a }, opt: {} }]); _seqRun.state = 'running'; _seqRun.released = false; _seqRun.curId = 'z1'; }, A.id);
    await rp.evaluate(() => sendMsg({ type: 'color', color: '#336699' }));
    await waitFor(B.page, () => screenBaseColor.toLowerCase() === '#336699' && _callState === 'idle');
    await sleep(200);
    assert.equal(await A.page.evaluate(() => _callState), 'notif', 'écran tenu : sa couche reste');
    assert.notEqual((await baseColor(A.page)).toLowerCase(), '#336699');
  });
});

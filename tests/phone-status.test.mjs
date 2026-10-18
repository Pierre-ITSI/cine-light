// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Faux téléphone d'une Séquence, maquettes 28b (« Téléphone au départ » :
// barre d'état), 29b (étape « Veille »), 33 (batterie faible puis
// extinction) et 34 (pas de réseau) ; barre d'état de l'onglet Média hors
// séquence et priorité de la séquence. Couvre la barre partout (écran
// verrouillé, déverrouillé, appel, discussion, au-dessus d'un média), les
// trois horloges, veille / réveil / rendormissement, batterie faible →
// extinction → ↶, appel impossible et message non distribué puis distribué
// au retour du réseau, la resynchronisation d'un écran rechargé en pleine
// séquence et les séquences enregistrées qui gardent leurs réglages.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
async function rig(n, seed) {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed, autoConnect: true });
  const rp = remote.page;
  await rp.evaluate(() => { startMode('remote'); switchTab('seq'); });
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
const fixtures = (rp) => rp.evaluate(() => {
  callList.call = [{ id: 'c1', kind: 'call', style: 'glass', name: 'Maman', label: 'mobile', ring: 'silent', ringVolume: 1, present: 'full', photoMode: 'avatar', autoAnswer: 0, hasPhoto: false, hasAudio: false }];
  callList.sms = [{ id: 's1', kind: 'sms', style: 'glass', name: 'Maman', msg: 'Tu es où ?', appName: 'SMS', appColor: '#2f8cf0', ring: 'silent', ringVolume: 1, lock: { time: '', date: '' }, hasPhoto: false, hasAudio: false }];
  persistCallList();
  chatSaved = [{ id: 'cm', name: 'Séq. 12 — Maman', contact: 'Maman', actor: 'Julie', style: 'minimal',
    msgs: [{ id: 'd1', from: 'contact', text: 'Rappelle-moi stp' }, { id: 'd2', from: 'actor', text: 'ok' }], hasPhoto: false, photoSig: null }];
  _chsvPersist();
  colorMemories = [{ id: 'k1', name: 'nuit', spec: { kelvin: 3200, tint: 0, dimmer: 40, wheelHex: '#ffffff', crossfade: 0 }, strobe: { active: false, random: false, freq: 2, dur: 50, freqMax: 8, durMax: 200, torch: false } }];
  persistColorMemories();
});
const PHONE = { clock: { mode: 'frozen', date: '2026-10-17', time: '23:47' }, net: { bars: 2, type: '4G', plane: false, wifi: false }, bat: { level: 18, charging: false, pct: true } };
const setSeq = (rp, steps, phone = PHONE) => rp.evaluate(([steps, phone]) => { _seq.steps = seqSanitizeSteps(steps); _seq.phone = phone; seqSave(); renderSeq(); }, [steps, phone]);
const st = (id, kind, ref, target, opt, trig) => ({ id, kind, ref, trig: trig || { k: 'go' }, target, opt: opt || {} });
const go = (rp) => rp.evaluate(async () => { seqGo(); await _seqChain; });
const back = (rp) => rp.evaluate(async () => { seqBack(); await _seqChain; });
// Barre d'état affichée sur l'écran : null si aucune
const bar = (page) => page.evaluate(() => {
  const el = document.getElementById('screen-sbar');
  if (!el || getComputedStyle(el).display === 'none') return null;
  const t = (s) => { const e = el.querySelector(s); return e ? e.textContent : null; };
  return {
    time: t('.pb-time'), net: t('.pb-net'), nosvc: t('.pb-nosvc'), pct: t('.pb-pct'), wifi: !!el.querySelector('.pb-wifi'),
    bars: el.querySelectorAll('.pb-sig i.on').length, low: !!el.querySelector('.pb-bat.low'), band: el.classList.contains('pb-band'), dark: el.classList.contains('pb-dark'),
  };
});
const showMedia = (page) => page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 20; c.height = 20; c.getContext('2d').fillRect(0, 0, 20, 20);
  _mediaCache.set('mx', { kind: 'img', data: c.toDataURL('image/png') });
  screenShowCached('mx');
});
const dark = (page) => page.evaluate(() => _spDark());

describe('barre d\'état de la séquence (28b) : partout sur l\'écran visé, rien hors séquence', () => {
  let r, rp, sp, T;
  before(async () => {
    r = await rig(1, 61);
    rp = r.rp; sp = r.screens[0].page; T = { k: 'screen', id: r.screens[0].id };
    await fixtures(rp);
    await setSeq(rp, [
      st('p1', 'sms', 's1', T), st('p2', 'unlock', null, T, { code: 0, then: 'app' }), st('p3', 'call', 'c1', T), st('p4', 'chat', 'cm', T),
    ]);
  });
  after(async () => { noErrors(r); await r?.close(); });

  test('avant le premier GO : aucune barre', async () => {
    assert.equal(await bar(sp), null);
    assert.equal(await rp.textContent('#seqPhoneSum'), '23:47 figée · 4G · 18 %');
  });
  test('écran verrouillé : barre et horloge de la séquence (figée)', async () => {
    await go(rp);
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .sp-card').length === 1);
    assert.deepEqual(await bar(sp), { time: '23:47', net: '4G', nosvc: null, pct: '18 %', wifi: false, bars: 2, low: false, band: false, dark: false });
    assert.equal(await sp.textContent('#screen-phone .sp-time'), '23:47');
    assert.equal(await sp.textContent('#screen-phone .sp-date'), 'samedi 17 octobre');
  });
  test('déverrouillé : la barre reste', async () => {
    await go(rp);
    await waitFor(sp, () => _scPhone && !!_scPhone.unlock);
    await sp.locator('#screen-phone .sp-lock').click();
    await waitFor(sp, () => _scPhone.mode === 'unlocked');
    assert.equal((await bar(sp)).time, '23:47');
  });
  test('appel : la barre au-dessus de l\'écran d\'appel', async () => {
    await go(rp);
    await waitFor(sp, () => _callState === 'ringing');
    const z = await sp.evaluate(() => [getComputedStyle(document.getElementById('screen-sbar')).zIndex, getComputedStyle(document.getElementById('screen-call')).zIndex].map(Number));
    assert.ok(z[0] > z[1], 'au-dessus de l\'appel');
    assert.equal((await bar(sp)).time, '23:47');
    await sp.locator('#screen-call .sc-no').click();
    await waitFor(sp, () => _callState === 'idle');
  });
  test('discussion (Épuré, fond clair) : barre en texte sombre', async () => {
    await go(rp);
    await waitFor(sp, () => !!document.querySelector('#screen-chat .scc'));
    assert.equal((await bar(sp)).dark, true);
  });
  test('au-dessus d\'un média : bandeau ; Recommencer : plus aucune barre', async () => {
    await rp.evaluate(async () => { seqRestart(); await _seqChain; });
    await waitFor(sp, () => document.getElementById('screen-sbar').style.display === 'none');
    await showMedia(sp);
    await sleep(100);
    assert.equal(await bar(sp), null, 'hors séquence : rien ne change');
    await setSeq(rp, [st('q1', 'color', 'k1', T)]);
    await go(rp);
    await waitFor(sp, () => document.getElementById('screen-sbar').style.display === 'flex');
    assert.equal((await bar(sp)).band, true);
    await rp.evaluate(async () => { seqRestart(); await _seqChain; });
    await waitFor(sp, () => document.getElementById('screen-sbar').style.display === 'none');
  });
});

test('horloges (28b) : l\'heure avance, figée, heure réelle ; heures relatives selon la séquence', async () => {
  const { page, errors, close } = await openPage(browser, { clock: true });
  await page.evaluate(() => { startMode('screen'); });
  const state = (clock) => page.evaluate((clock) => screenPhoneState({
    mode: 'locked', style: 'glass', notifs: [{ id: 'n1', kind: 'sms', app: 'SMS', name: 'Maman', msg: 'Tu es où ?', ago: 125 }], unlock: null, home: false, watch: [], chime: null,
    bar: { clock, net: { bars: 4, type: '5G', plane: false, wifi: true }, bat: { level: 60, charging: true, pct: false } }, sleep: null, alert: null, power: 'on',
  }), clock);
  const read = () => page.evaluate(() => [document.querySelector('#screen-sbar .pb-time').textContent, document.querySelector('#screen-phone .sp-time').textContent, document.querySelector('#screen-phone .sp-when').textContent]);
  // L'heure avance : 23:47 et 50 s écoulées → 23:48 dans 10 s
  await state({ mode: 'run', date: '2026-10-17', time: '23:47', el: 50 });
  assert.deepEqual(await read(), ['23:47', '23:47', 'il y a 2 min']);
  await page.clock.runFor(16000);
  assert.deepEqual(await read(), ['23:48', '23:48', 'il y a 2 min']);
  // Figée : l'heure ne bouge pas, les notifications restent « maintenant »
  await state({ mode: 'frozen', date: '2026-10-17', time: '08:05' });
  await page.clock.runFor(120000);
  assert.deepEqual(await read(), ['08:05', '08:05', 'maintenant']);
  // Heure réelle : celle de l'écran (00:10 à Paris, horloge des tests)
  await state({ mode: 'real' });
  assert.deepEqual((await read()).slice(0, 2), ['00:12', '00:12']);
  assert.equal(await page.evaluate(() => !!document.querySelector('#screen-sbar .pb-bat.chg') && !!document.querySelector('#screen-sbar .pb-bolt')), true, 'en charge');
  assert.deepEqual(errors, []);
  await close();
});

describe('veille (29b), batterie faible puis extinction (33)', () => {
  let r, rp, sp, T;
  before(async () => {
    r = await rig(1, 67);
    rp = r.rp; sp = r.screens[0].page; T = { k: 'screen', id: r.screens[0].id };
    await fixtures(rp);
  });
  after(async () => { noErrors(r); await r?.close(); });

  test('veille : écran noir ; réveil au toucher, à la notification, à l\'appel ; se rendort ; le déverrouillage réveille pour de bon', async () => {
    await setSeq(rp, [
      st('v1', 'sleep', null, T, { notif: true, touch: true, after: 1 }), st('v2', 'sms', 's1', T), st('v3', 'call', 'c1', T),
      st('v4', 'unlock', null, T, { code: 0, then: 'app' }),
    ]);
    await go(rp);
    await waitFor(sp, () => _spDark() && document.getElementById('screen-ppower').classList.contains('on'));
    assert.equal(await sp.evaluate(() => _scPhone.mode), 'locked');
    // Toucher : réveillé (le toucher ne déverrouille rien), puis rendormi après 1 s
    await sp.locator('#screen-ppower').click();
    assert.equal(await dark(sp), false);
    assert.equal(await sp.evaluate(() => _scPhone.mode), 'locked');
    await waitFor(sp, () => _spDark(), null, { timeout: 3000 });
    // Notification : réveil
    await go(rp);
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .sp-card').length === 1);
    assert.equal(await dark(sp), false);
    await waitFor(sp, () => _spDark(), null, { timeout: 3000 });
    // Appel : allumé tant qu'il sonne, rendormi après la fin
    await go(rp);
    await waitFor(sp, () => _callState === 'ringing');
    await sleep(1400);
    assert.equal(await dark(sp), false, 'pendant l\'appel');
    await sp.locator('#screen-call .sc-no').click();
    await waitFor(sp, () => _spDark(), null, { timeout: 3000 });
    // Déverrouillage (glisser seul) : réveillé pour de bon
    await go(rp);
    await waitFor(sp, () => _scPhone.unlock);
    await sp.locator('#screen-ppower').click();
    await sp.locator('#screen-phone .sp-lock').click();
    await waitFor(sp, () => _scPhone.mode === 'unlocked');
    await sleep(1600);
    assert.equal(await dark(sp), false);
    await waitFor(rp, () => !_seqPhones.values().next().value.sleep);
    await rp.evaluate(async () => { seqRestart(); await _seqChain; });
  });

  test('veille sans réveil au toucher : les touchers sont ignorés', async () => {
    await setSeq(rp, [st('w1', 'sleep', null, T, { notif: false, touch: false, after: 5 })]);
    await go(rp);
    await waitFor(sp, () => _spDark());
    await sp.locator('#screen-ppower').click();
    assert.equal(await dark(sp), true);
    await rp.evaluate(async () => { seqRestart(); await _seqChain; });
    await waitFor(sp, () => !_spDark() && document.getElementById('screen-ppower').style.display === 'none', null, { timeout: 3000 });
  });

  test('batterie faible → extinction → ↶ : alerte, icône rouge, plus d\'appel ; rallumé avec ses valeurs d\'avant', async () => {
    await setSeq(rp, [st('b1', 'battery', null, T, { level: 5 }), st('b2', 'off', null, T), st('b3', 'call', 'c1', T)]);
    await go(rp);
    await waitFor(sp, () => document.getElementById('screen-palert').style.display === 'flex');
    assert.equal(await sp.textContent('#screen-palert .pa-title'), 'Batterie faible');
    assert.equal(await sp.textContent('#screen-palert .pa-msg'), 'Il reste 5 % de batterie.');
    assert.deepEqual(await bar(sp).then((b) => [b.pct, b.low]), ['5 %', true]);
    // « Fermer » : la télécommande l'apprend, l'alerte ne revient pas
    await sp.locator('#screen-palert .pa-close').click();
    await waitFor(rp, () => !_seqPhones.values().next().value.alert);
    // Extinction : fondu, logo neutre, noir ; ne répond plus
    await go(rp);
    await waitFor(sp, () => _scPhone.power === 'off');
    await waitFor(sp, () => document.getElementById('screen-ppower').classList.contains('logo'), null, { timeout: 2000 });
    assert.equal(await sp.evaluate(() => !!document.querySelector('#screen-ppower .pp-logo')), true);
    await waitFor(sp, () => !document.getElementById('screen-ppower').classList.contains('logo'), null, { timeout: 3000 });
    assert.equal(await bar(sp), null, 'écran noir : pas de barre');
    assert.equal(await sp.evaluate(() => phoneGesture('touch')), false);
    await go(rp); // appel : n'arrive pas
    await sleep(400);
    assert.equal(await sp.evaluate(() => _callState), 'idle');
    // ↶ (appel), ↶ (extinction) : rallumé (logo puis écran verrouillé), batterie toujours faible
    await back(rp);
    await back(rp);
    await waitFor(sp, () => _scPhone.power === 'on');
    await waitFor(sp, () => document.getElementById('screen-ppower').style.display === 'none', null, { timeout: 4000 });
    assert.equal(await sp.evaluate(() => _scPhone.mode), 'locked');
    assert.equal((await bar(sp)).pct, '5 %');
    // ↶ (batterie) : valeurs de départ
    await back(rp);
    await waitFor(sp, () => !_sb.seq);
    await rp.evaluate(async () => { seqRestart(); await _seqChain; });
  });
});

describe('pas de réseau (34) et resynchronisation en pleine séquence', () => {
  let r, rp, sp, T;
  before(async () => {
    r = await rig(1, 71);
    rp = r.rp; sp = r.screens[0].page; T = { k: 'screen', id: r.screens[0].id };
    await fixtures(rp);
  });
  after(async () => { noErrors(r); await r?.close(); });

  test('réseau perdu : « Pas de service », appel impossible, message non distribué ; rétabli : distribué', async () => {
    await setSeq(rp, [
      st('n1', 'sms', 's1', T), st('n2', 'net', null, T, { lost: true }), st('n3', 'call', 'c1', T), st('n4', 'chat', 'cm', T),
      st('n5', 'net', null, T, { lost: false, bars: 3, type: '5G', wifi: true }),
    ], Object.assign({}, PHONE, { net: { bars: 4, type: '4G', plane: false, wifi: true } }));
    await go(rp);
    await go(rp);
    await waitFor(sp, () => !!document.querySelector('#screen-sbar .pb-nosvc'));
    assert.equal((await bar(sp)).nosvc, 'Pas de service');
    await go(rp); // appel : impossible
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .sp-card').length === 2);
    assert.equal(await sp.evaluate(() => _callState), 'idle', 'ne sonne pas');
    assert.deepEqual(await sp.evaluate(() => [...document.querySelector('#screen-phone .sp-card').querySelectorAll('.sp-app, .sp-name, .sp-msg')].map((e) => e.textContent)),
      ['Téléphone', 'Appel impossible', 'Aucun réseau disponible.']);
    await go(rp); // discussion : le comédien répond sans réseau
    await waitFor(sp, () => !!document.querySelector('#screen-chat .scc'));
    await sp.keyboard.type('ok');
    await sp.keyboard.press('Enter');
    await waitFor(sp, () => !!document.querySelector('#screen-chat .scc-und'));
    assert.equal(await sp.textContent('#screen-chat .scc-und'), 'Non distribué');
    await waitFor(rp, () => _chat.pend.includes('d2'));
    await waitFor(sp, () => _scPhone.notifs.some((n) => n.name === 'Message non envoyé'));
    assert.equal(await sp.evaluate(() => _scPhone.notifs.find((n) => n.name === 'Message non envoyé').msg), '« ok » — Toucher pour réessayer');
    // Écran rechargé : toujours sans réseau, toujours non distribué
    await sp.reload();
    await sp.evaluate(() => { if (mode !== 'screen') startMode('screen'); });
    await connected(sp);
    await waitFor(sp, () => !!document.querySelector('#screen-chat .scc-und') && !!document.querySelector('#screen-sbar .pb-nosvc'), null, { timeout: 8000 });
    // Réseau rétabli : distribué, notification retirée
    await go(rp);
    await waitFor(sp, () => !document.querySelector('#screen-chat .scc-und'));
    assert.deepEqual(await rp.evaluate(() => _chat.pend), []);
    await waitFor(sp, () => !_scPhone.notifs.some((n) => n.name === 'Message non envoyé'));
    assert.deepEqual(await bar(sp).then((b) => [b.net, b.bars, b.wifi]), ['5G', 3, true]);
    await rp.evaluate(async () => { seqRestart(); await _seqChain; });
  });

  test('écran rechargé en pleine séquence : barre, veille, alerte, extinction retrouvées', async () => {
    await setSeq(rp, [st('r1', 'sleep', null, T, { notif: true, touch: true, after: 30 }), st('r2', 'battery', null, T, { level: 7 }), st('r3', 'off', null, T)]);
    await go(rp);
    await go(rp);
    await waitFor(sp, () => document.getElementById('screen-palert').style.display === 'flex');
    await sp.reload();
    await sp.evaluate(() => { if (mode !== 'screen') startMode('screen'); });
    await connected(sp);
    await waitFor(sp, () => !!_scPhone && !!_sb.seq, null, { timeout: 8000 });
    assert.equal(await sp.evaluate(() => [_scPhone.mode, !!_scPhone.sleep, _scPhone.alert && _scPhone.alert.level].join()), 'locked,true,7');
    assert.equal(await dark(sp), true, 'rechargé : endormi');
    assert.equal(await sp.evaluate(() => _sb.seq.bat.level), 7);
    await go(rp);
    await waitFor(sp, () => _scPhone.power === 'off');
    await sp.reload();
    await sp.evaluate(() => { if (mode !== 'screen') startMode('screen'); });
    await connected(sp);
    await waitFor(sp, () => !!_scPhone && _scPhone.power === 'off', null, { timeout: 8000 });
    assert.equal(await sp.evaluate(() => document.getElementById('screen-ppower').className), 'on instant', 'déjà éteint : sans animation');
    await rp.evaluate(async () => { seqRestart(); await _seqChain; });
  });
});

describe('onglet Média : barre d\'état hors séquence, priorité de la séquence', () => {
  test('bandeau au-dessus du média seul, gardé à la resynchronisation ; la séquence prime, puis la barre du Média revient', async () => {
    const r = await rig(1, 73);
    const { rp } = r, sp = r.screens[0].page, sid = r.screens[0].id;
    await fixtures(rp);
    await rp.evaluate((id) => { scrSetTarget({ k: 'screen', id }); switchTab('media'); }, sid);
    assert.equal(await rp.isChecked('#mediaBarToggle'), false);
    // Réglages (même éditeur que 28b) : batterie 76 %, affichée
    await rp.click('#mediaBarEdit');
    assert.equal(await rp.textContent('#ppTitle'), 'Barre d\'état du téléphone');
    await rp.locator('#ppBat .ss-opt', { hasText: 'Afficher le %' }).click();
    await rp.evaluate(() => { const i = document.getElementById('ppLevel'); i.value = '76'; i.dispatchEvent(new Event('input')); });
    await sleep(350);
    await rp.click('#ppBack');
    assert.equal(await rp.textContent('#mediaBarSum'), 'Heure réelle · 4G · 76 %');
    await rp.click('#mediaBarRow .mbar-toggle > span');
    assert.equal(await rp.isChecked('#mediaBarToggle'), true);
    await waitFor(sp, () => !!_sb.media);
    assert.equal(await bar(sp), null, 'sans média : rien');
    await showMedia(sp);
    await waitFor(sp, () => document.getElementById('screen-sbar').style.display === 'flex');
    assert.deepEqual(await bar(sp).then((b) => [b.pct, b.band]), ['76 %', true]);
    // Resynchronisation : écran rechargé, la barre revient
    await sp.reload();
    await sp.evaluate(() => { if (mode !== 'screen') startMode('screen'); });
    await connected(sp);
    await waitFor(sp, () => !!_sb.media, null, { timeout: 8000 });
    await showMedia(sp);
    await waitFor(sp, () => document.getElementById('screen-sbar').style.display === 'flex');
    // Séquence en cours sur cet écran : ses réglages priment (18 %)
    await setSeq(rp, [st('m1', 'color', 'k1', { k: 'screen', id: sid })]);
    await go(rp);
    await waitFor(sp, () => !!_sb.seq);
    await waitFor(sp, () => document.querySelector('#screen-sbar .pb-pct').textContent === '18 %');
    // Arrêtée (STOP) : la séquence garde la main jusqu'à « Recommencer »
    await rp.evaluate(async () => { seqStop(); await _seqChain; });
    assert.equal(await sp.textContent('#screen-sbar .pb-pct'), '18 %');
    await rp.evaluate(async () => { seqRestart(); await _seqChain; });
    await waitFor(sp, () => !_sb.seq && document.querySelector('#screen-sbar .pb-pct') && document.querySelector('#screen-sbar .pb-pct').textContent === '76 %');
    // Réglages gardés pour la session sur la télécommande ; désactivée : retirée
    const stored = await rp.evaluate(() => JSON.parse(localStorage.getItem('setremote-mediabar-v1')));
    assert.equal(stored.s, await rp.evaluate(() => _session.channelId));
    assert.deepEqual([stored.cfg.bat.level, stored.screens], [76, [sid]]);
    await rp.click('#mediaBarRow .mbar-toggle > span');
    await waitFor(sp, () => !_sb.media && document.getElementById('screen-sbar').style.display === 'none');
    noErrors(r);
    await r.close();
  });
});

test('séquences enregistrées : « Téléphone au départ » réglé dans l\'éditeur, gardé, rechargé ; anciennes séquences : valeurs par défaut', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('seq'); });
  page.on('dialog', (d) => d.accept());
  assert.equal(await page.textContent('#seqPhoneSum'), 'Heure réelle · 4G · 80 %');
  await page.click('#seqPhoneBtn');
  assert.equal(await page.textContent('#ppTitle'), 'Téléphone au départ');
  assert.equal(await page.textContent('#ppCap'), 'Aperçu de la barre d\'état du téléphone de jeu');
  await page.locator('#ppClock .ss-opt', { hasText: 'Figée' }).click();
  await page.evaluate(() => { ppSetDate('2026-10-17'); ppSetTime('23:47'); });
  assert.equal(await page.textContent('#ppClock .pp-date span'), 'sam. 17 oct. 2026');
  await page.locator('#ppNet .ss-opt[aria-label="1 barre(s) sur 4"]').click();
  await page.locator('#ppNet .ss-opt', { hasText: '5G' }).click();
  await page.locator('#ppNet .pp-wifi .ss-opt', { hasText: 'Non' }).click();
  await page.locator('#ppBat .ss-opt', { hasText: 'En charge' }).click();
  // Aperçu en direct
  assert.deepEqual(await page.evaluate(() => [document.querySelector('#ppPreview .pb-time').textContent, document.querySelector('#ppPreview .pb-net').textContent,
    document.querySelectorAll('#ppPreview .pb-sig i.on').length, !!document.querySelector('#ppPreview .pb-wifi'), !!document.querySelector('#ppPreview .pb-bat.chg')]), ['23:47', '5G', 1, false, true]);
  await page.click('#ppBack');
  assert.equal(await page.textContent('#seqPhoneSum'), '23:47 figée · 5G · 80 %');
  // Enregistrer, modifier, recharger la séquence enregistrée
  await page.evaluate(() => { _seq.steps = seqSanitizeSteps([{ id: 'x1', kind: 'sleep', target: { k: 'all' }, trig: { k: 'go' }, opt: {} }]); seqSave(); });
  await page.click('#seqTab-saved');
  await page.click('#seqSaveBtn');
  await page.fill('#srName', 'Séq. 33');
  await page.click('#sr-sheet .sr-ok');
  await page.evaluate(() => { _seq.phone.net.type = '3G'; seqSave(); });
  assert.equal(await page.evaluate(() => seqHasUnsavedChanges()), true, 'réglage modifié : non enregistré');
  await page.locator('#seqSavedRows .dc-saved-row').nth(0).click();
  assert.equal(await page.evaluate(() => _seq.phone.net.type), '5G');
  await page.reload();
  await page.evaluate(() => { startMode('remote'); switchTab('seq'); });
  assert.equal(await page.textContent('#seqPhoneSum'), '23:47 figée · 5G · 80 %');
  assert.deepEqual(await page.evaluate(() => seqSaved[0].phone), { clock: { mode: 'frozen', date: '2026-10-17', time: '23:47' }, net: { bars: 1, type: '5G', plane: false, wifi: false }, bat: { level: 80, charging: true, pct: false } });
  assert.deepEqual(await page.evaluate(() => seqSaved[0].steps[0].opt), { notif: true, touch: true, after: 8 });
  // Séquence enregistrée avant 28b : réglages par défaut (heure réelle)
  await page.evaluate(() => localStorage.setItem('setremote-seq-saved-v1', JSON.stringify({ v: 1, list: [{ id: 'old', name: 'Ancienne', steps: [] }] })));
  await page.reload();
  await page.evaluate(() => { startMode('remote'); switchTab('seq'); });
  assert.deepEqual(await page.evaluate(() => seqSaved[0].phone), await page.evaluate(() => phoneBarDefaults()));
  assert.deepEqual(errors, []);
  await close();
});

test('éditeur d\'étape : veille (29b), batterie, extinction, réseau ; libellés de la liste', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('seq'); });
  await page.click('#seqAddBtn');
  await page.locator('#ssKinds .ss-opt', { hasText: 'Veille' }).click();
  assert.match(await page.textContent('#ssRefCard'), /Écran noir, verrouillé\. Rien ne s'affiche tant que rien n'arrive\./);
  assert.equal(await page.textContent('#ssOptVal'), '8 s');
  await page.locator('#ssRefCard .ss-opt', { hasText: 'au toucher' }).click();
  await page.locator('#ssRefCard .ss-step-btn', { hasText: '+' }).click();
  await page.click('#ssSave');
  await page.click('#seqAddBtn');
  await page.locator('#ssKinds .ss-opt', { hasText: 'Batterie' }).click();
  await page.locator('#ssRefCard .ss-step-btn', { hasText: '+' }).click();
  await page.click('#ssSave');
  await page.click('#seqAddBtn');
  await page.locator('#ssKinds .ss-opt', { hasText: 'Extinction' }).click();
  await page.click('#ssSave');
  await page.click('#seqAddBtn');
  await page.locator('#ssKinds .ss-opt', { hasText: 'Réseau' }).click();
  await page.locator('#ssRefCard .ss-opt', { hasText: 'Rétabli' }).click();
  await page.locator('#ssRefCard .ss-opt[aria-label="2 / 4"]').click();
  await page.locator('#ssRefCard .ss-opt', { hasText: '3G' }).click();
  await page.click('#ssSave');
  assert.deepEqual(await page.$$eval('#seqRows .sq-label', (l) => l.map((x) => x.textContent)),
    ['Veille (écran noir)', 'Batterie faible 6 %', 'Extinction du téléphone', 'Réseau rétabli (▂▄ 3G)']);
  assert.deepEqual(await page.evaluate(() => _seq.steps.map((s) => s.opt)), [
    { notif: true, touch: false, after: 9 }, { level: 6 }, {}, { lost: false, bars: 2, type: '3G', wifi: true }]);
  assert.deepEqual(errors, []);
  await close();
});

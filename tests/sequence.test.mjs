// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Onglet Séquence (maquettes 28 à 32) : étapes qui RÉFÉRENCENT les états
// enregistrés des autres onglets et le faux téléphone de l'écran. Couvre
// l'exemple du propriétaire de bout en bout (notification SMS → appel → appel
// manqué → SMS → toucher l'écran verrouillé → code → discussion → réponse du
// comédien), chaque départ (GO, après N s, geste, délai de secours), GO qui
// passe outre, ↶, Pause auto, la cible, un élément supprimé, les séquences
// enregistrées, la resynchronisation d'un écran rechargé en pleine séquence et
// l'avertissement stroboscope.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });

// Télécommande + n écrans appairés par le lien (QR), onglet Séquence ouvert
async function rig(n, seed) {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed, autoConnect: true });
  const rp = remote.page;
  // Les tests enchaînent les GO plus vite qu'un doigt : anti-rebond levé ici
  // (il a son propre test, « GO : anti-rebond… »)
  await rp.evaluate(() => { startMode('remote'); switchTab('seq'); setSeqMode('play'); SEQ_GO_GUARD_MS = 0; });
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
const shownEl = (page, id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; }, id);
const noErrors = (r) => { for (const p of [r.remote, ...r.screens]) assert.deepEqual(p.errors, []); };

// Éléments enregistrés des autres onglets (mêmes formes que leurs onglets)
const fixtures = (rp) => rp.evaluate(() => {
  callList.call = [{ id: 'c1', kind: 'call', style: 'glass', name: 'Maman', label: 'mobile', ring: 'silent', ringVolume: 1, present: 'full', photoMode: 'avatar', autoAnswer: 0, hasPhoto: false, hasAudio: false }];
  callList.sms = [
    { id: 's1', kind: 'sms', style: 'glass', name: 'Maman', msg: 'Tu es où ?', appName: 'SMS', appColor: '#2f8cf0', ring: 'silent', ringVolume: 1, lock: { time: '', date: '' }, hasPhoto: false, hasAudio: false },
    { id: 's2', kind: 'sms', style: 'glass', name: 'Maman', msg: 'Rappelle-moi stp', appName: 'SMS', appColor: '#2f8cf0', ring: 'silent', ringVolume: 1, lock: null, hasPhoto: false, hasAudio: false },
  ];
  callList.notif = [{ id: 'n1', kind: 'notif', style: 'glass', name: 'Virement reçu', msg: '2 400,00 €', appName: 'Banque Atlas', ring: 'silent', ringVolume: 1, present: 'lock', hasPhoto: false, phone: {}, received: { mode: 'now' } }];
  persistCallList();
  chatSaved = [{ id: 'cm', name: 'Séq. 12 — Maman', contact: 'Maman', actor: 'Julie', style: 'glass',
    msgs: [{ id: 'd1', from: 'contact', text: 'Rappelle-moi stp' }, { id: 'd2', from: 'actor', text: 'ok' }, { id: 'd3', from: 'contact', text: 'Merci' }], hasPhoto: false, photoSig: null }];
  _chsvPersist();
  colorMemories = [{ id: 'k1', name: 'ambiance nuit', spec: { kelvin: 3200, tint: 0, dimmer: 40, wheelHex: '#ffffff', crossfade: 0 }, strobe: { active: false, random: false, freq: 2, dur: 50, freqMax: 8, durMax: 200, torch: false } }];
  persistColorMemories();
  fxMemories = [{ id: 'f1', name: 'Bougie 1', effect: 'candle', dir: 'h', params: { speed: 1, intensity: 80, chaos: 30, drift: 0 } }];
  persistFxMemories();
});
// Séquence en cours : étapes (cible par défaut : le premier écran)
const setSteps = (rp, steps) => rp.evaluate((steps) => {
  _seq.steps = seqSanitizeSteps(steps); seqSave(); renderSeq();
}, steps);
const st = (id, kind, ref, trig, target, opt) => ({ id, kind, ref, trig: trig || { k: 'go' }, target, opt: opt || {} });
// Faux téléphone affiché sur l'écran
const phone = (page) => page.evaluate(() => {
  const el = document.getElementById('screen-phone');
  const vis = el.style.display !== 'none' && el.offsetHeight > 0;
  return {
    mode: vis ? (_scPhone && _scPhone.mode) : 'off',
    cards: [...el.querySelectorAll('.pn')].map((c) => [c.querySelector('.pn-app').textContent, c.querySelector('.pn-title').textContent, (c.querySelector('.pn-text') || {}).textContent || '', c.querySelector('.pn-when').textContent]),
    dots: [...el.querySelectorAll('.pk-dot')].map((d) => (d.classList.contains('on') ? '●' : '○')).join(''),
  };
});
const callShown = (page) => page.evaluate(() => getComputedStyle(document.getElementById('screen-call')).display !== 'none' && _callState);
const rows = (rp) => rp.evaluate(() => [...document.querySelectorAll('#seqRows .sq-row')].map((r) => [
  r.querySelector('.sq-num').textContent, r.querySelector('.sq-label b').textContent, r.querySelector('.sq-badge').textContent,
  ['done', 'cur', 'next', 'missing'].filter((c) => r.classList.contains(c)).join(' '),
]));
const pos = (rp) => rp.evaluate(() => seqPos() + 1);
// « Recommencer » : appui long (un simple toucher n'affiche que l'indication)
const holdRestart = async (page) => {
  const b = await page.locator('#seqRestartBtn').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
};

describe('exemple du propriétaire, de bout en bout', () => {
  let r, rp, sp, sid;
  before(async () => {
    r = await rig(1, 31);
    rp = r.rp; sp = r.screens[0].page; sid = r.screens[0].id;
    await fixtures(rp);
    const T = { k: 'screen', id: sid };
    await setSteps(rp, [
      st('a1', 'color', 'k1', { k: 'go' }, T),
      st('a2', 'sms', 's1', { k: 'go' }, T),
      st('a3', 'call', 'c1', { k: 'after', s: 1 }, T),
      st('a4', 'missed', 'c1', { k: 'gesture', g: 'hangup', t: 12 }, T),
      st('a5', 'sms', 's2', { k: 'after', s: 1 }, T),
      st('a6', 'unlock', null, { k: 'gesture', g: 'touch' }, T, { code: 4, then: 'app' }),
      st('a7', 'chat', 'cm', { k: 'gesture', g: 'unlock' }, T),
      st('a8', 'effect', 'f1', { k: 'gesture', g: 'chat' }, T),
    ]);
  });
  after(async () => { noErrors(r); await r?.close(); });

  test('liste (maquette 28) : libellés, départs, cible', async () => {
    assert.deepEqual(await rows(rp), [
      ['1', 'Couleur 3200 K · 40 % (ambiance nuit)', 'GO', 'next'],
      ['2', 'Notif SMS « Maman » (verrouillé)', 'GO', ''],
      ['3', 'Appel entrant « Maman · mobile »', 'après 1 s', ''],
      ['4', 'Notif « Appel manqué »', 'refuse / 12 s', ''],
      ['5', 'SMS « Rappelle-moi stp »', 'après 1 s', ''],
      ['6', 'Déverrouillage code 4 chiffres', 'touche l\'écran', ''],
      ['7', 'Discussion « Maman » → réponse', 'déverrouillé', ''],
      ['8', 'Effet Bougie 1', 'répond', ''],
    ]);
    assert.equal(await rp.textContent('#seqTarget'), 'Cible : Écran 1');
    assert.match(await rp.textContent('#seqNow'), /^PrêtGO lance l'étape 1$|^Prêt.*GO lance l'étape 1$/);
    assert.match(await rp.textContent('#seqNext'), /^Ensuite · 1Couleur 3200 K · 40 % \(ambiance nuit\)au GO$/);
    assert.equal(await rp.evaluate(() => [document.getElementById('seqBackBtn').disabled, document.getElementById('seqStopBtn').disabled].join()), 'true,true');
  });

  test('GO : couleur, puis notification SMS sur l\'écran verrouillé', async () => {
    await rp.click('#seqGoBtn');
    // Le premier GO coupe d'abord le reste (couleur noire), puis l'étape pose sa couleur
    const swatch = await rp.evaluate(() => memorySwatch(colorMemories[0].spec));
    await waitFor(sp, (c) => screenBaseColor === c, swatch);
    assert.equal(await sp.evaluate(() => screenBaseColor), swatch);
    await rp.click('#seqGoBtn');
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 1);
    assert.deepEqual(await phone(sp), { mode: 'locked', cards: [['SMS', 'Maman', 'Tu es où ?', 'maintenant']], dots: '' });
    assert.equal(await sp.evaluate(() => document.querySelector('#screen-phone .pl-hint').textContent), 'Touchez pour déverrouiller');
  });

  test('après 1 s : l\'appel sonne ; le comédien refuse → appel manqué empilé (la plus récente en haut)', async () => {
    await waitFor(sp, () => _callState === 'ringing', null, { timeout: 3000 });
    assert.equal(await pos(rp), 3);
    await waitFor(rp, () => /Sonne depuis \d+ s/.test(document.getElementById('seqNow').textContent));
    assert.match(await rp.textContent('#seqNow'), /^En cours · 3.*Appel entrant « Maman · mobile ».*Sonne depuis \d+ s · Écran 1$/);
    assert.match(await rp.textContent('#seqNext'), /^Ensuite · 4Notif « Appel manqué »si le comédien refusesinon dans 12 s/);
    assert.deepEqual((await rows(rp)).map((x) => x[3]), ['done', 'done', 'cur', 'next', '', '', '', '']);
    await sp.locator('#screen-call [data-act=decline], #screen-call [data-act=hangup]').first().click();
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 2);
    assert.equal(await callShown(sp), false);
    assert.deepEqual((await phone(sp)).cards, [['Téléphone', 'Appel manqué', 'Maman', 'maintenant'], ['SMS', 'Maman', 'Tu es où ?', 'maintenant']]);
    assert.equal(await pos(rp), 4);
  });

  test('après 1 s : SMS empilé ; toucher l\'écran verrouillé → pavé du code, chaque touche remplit un point', async () => {
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 3, null, { timeout: 3000 });
    assert.deepEqual((await phone(sp)).cards.map((c) => c[2]), ['Rappelle-moi stp', 'Maman', 'Tu es où ?']);
    await sp.locator('#screen-phone .pl-time').click();
    await waitFor(sp, () => _scPhone.mode === 'code');
    assert.equal(await sp.evaluate(() => document.querySelector('#screen-phone .pk-title').textContent), 'Saisir le code');
    assert.equal((await phone(sp)).dots, '○○○○');
    await waitFor(rp, () => seqPos() === 5); // geste « touche l'écran » : étape 6 lancée
    await sp.locator('#screen-phone .pk-key', { hasText: '7' }).click();
    await sp.locator('#screen-phone .pk-key', { hasText: '7' }).click();
    assert.equal((await phone(sp)).dots, '●●○○');
    await sp.keyboard.press('1');
    assert.equal((await phone(sp)).dots, '●●●○');
  });

  test('dernier chiffre : déverrouillé, la discussion s\'ouvre ; la réponse du comédien lance l\'étape suivante', async () => {
    await sp.locator('#screen-phone .pk-key', { hasText: '0' }).click();
    await waitFor(sp, () => !!document.querySelector('#screen-chat .pt'));
    await waitFor(rp, () => seqPos() === 6);
    assert.equal((await phone(sp)).mode, 'unlocked');
    assert.deepEqual(await sp.evaluate(() => [...document.querySelectorAll('#screen-chat .pt-b')].map((b) => b.textContent)), ['Rappelle-moi stp'], 'message du contact déjà reçu');
    assert.equal(await sp.evaluate(() => document.querySelector('#screen-chat .pt-name').textContent), 'Maman');
    await sp.keyboard.type('xx');
    await sp.keyboard.press('Enter');
    await waitFor(rp, () => seqPos() === 7);
    await waitFor(sp, () => _screenFxR.current() === 'candle');
    assert.equal(await rp.textContent('#seqNext').then((t) => t.includes('Séquence terminée')), true);
    assert.equal(await rp.evaluate(() => document.getElementById('seqGoBtn').disabled), true);
    // Aucun contenu de touche n'a voyagé ; le geste est rapporté sans le code
    await r.broker.flush();
    const g = await r.broker.sent(sp, 'phone:gesture');
    assert.deepEqual(g.map((m) => m.g), ['hangup', 'touch', 'unlock']);
  });

  test('↶ : défait l\'étape (discussion fermée, téléphone reverrouillé, notification retirée) ; Recommencer', async () => {
    await rp.click('#seqBackBtn'); // effet : l'écran revient à la couleur
    await waitFor(sp, () => !_screenFxR.current());
    await rp.click('#seqBackBtn'); // discussion
    await waitFor(sp, () => document.getElementById('screen-chat').style.display === 'none');
    await rp.click('#seqBackBtn'); // déverrouillage
    await waitFor(sp, () => _scPhone && _scPhone.mode === 'locked');
    await rp.click('#seqBackBtn'); // SMS n° 2
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 2);
    assert.equal(await pos(rp), 4);
    // Sans minuterie après ↶ : GO relance l'étape 5
    await sleep(1300);
    assert.equal(await pos(rp), 4);
    await rp.click('#seqGoBtn');
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 3);
    await rp.click('#seqStopBtn');
    assert.equal((await rp.textContent('#seqRestartBtn')).trim(), 'Recommencer');
    await holdRestart(rp);
    await waitFor(sp, () => document.getElementById('screen-phone').style.display === 'none');
    assert.equal(await pos(rp), 0);
  });
});

describe('départs : après N s, geste, délai de secours, GO qui passe outre, Pause auto', () => {
  let r, rp, sp, sid, T;
  before(async () => {
    r = await rig(1, 37);
    rp = r.rp; sp = r.screens[0].page; sid = r.screens[0].id;
    T = { k: 'screen', id: sid };
    await fixtures(rp);
  });
  after(async () => { noErrors(r); await r?.close(); });
  const restart = () => rp.evaluate(() => { seqRestart(); return _seqChain; });
  beforeEach(() => restart());

  test('« Après N s » : compté depuis le départ de l\'étape précédente', async () => {
    await setSteps(rp, [st('b1', 'sms', 's1', { k: 'go' }, T), st('b2', 'sms', 's2', { k: 'after', s: 2 }, T)]);
    await rp.click('#seqGoBtn');
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 1);
    const t0 = Date.now();
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 2, null, { timeout: 5000 });
    const dt = Date.now() - t0;
    assert.ok(dt > 1500 && dt < 3500, dt + ' ms');
    await restart();
    await waitFor(sp, () => !_scPhone || _scPhone.mode === 'off');
  });

  test('geste avec délai de secours : sans refus, l\'appel cesse de sonner et l\'appel manqué arrive après N s', async () => {
    await setSteps(rp, [st('c1', 'call', 'c1', { k: 'go' }, T), st('c2', 'missed', 'c1', { k: 'gesture', g: 'hangup', t: 2 }, T)]);
    await rp.click('#seqGoBtn');
    await waitFor(sp, () => _callState === 'ringing');
    await sleep(1000);
    assert.equal(await sp.evaluate(() => _callState), 'ringing', 'toujours en train de sonner à 1 s');
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 1, null, { timeout: 4000 });
    assert.equal(await sp.evaluate(() => _callState), 'idle');
    assert.deepEqual((await phone(sp)).cards[0].slice(0, 3), ['Téléphone', 'Appel manqué', 'Maman']);
    await restart();
  });

  test('geste « décroche » sur le téléphone, étape suivante d\'un autre type ; gestes non attendus jamais rapportés', async () => {
    await setSteps(rp, [st('d1', 'call', 'c1', { k: 'go' }, T), st('d2', 'color', 'k1', { k: 'gesture', g: 'answer' }, T)]);
    r.broker.clear();
    await rp.click('#seqGoBtn');
    await waitFor(sp, () => _callState === 'ringing');
    await waitFor(sp, () => _scPhone && _scPhone.watch.has('answer'));
    await sp.locator('#screen-call [data-act=answer]').click();
    const night = await rp.evaluate(() => memorySwatch(colorMemories[0].spec));
    await waitFor(sp, (c) => screenBaseColor === c, night);
    assert.equal(await sp.evaluate(() => _callState), 'incall');
    await sp.locator('#screen-call [data-act=decline], #screen-call [data-act=hangup]').first().click(); // raccroche : plus rien n'est attendu
    await r.broker.flush();
    assert.deepEqual((await r.broker.sent(sp, 'phone:gesture')).map((m) => m.g), ['answer']);
    await restart();
  });

  test('GO passe outre un geste attendu ; Pause auto arrête les minuteries et l\'écoute, GO relance', async () => {
    await setSteps(rp, [
      st('e1', 'sms', 's1', { k: 'go' }, T),
      st('e2', 'notif', 'n1', { k: 'gesture', g: 'touch' }, T),
      st('e3', 'sms', 's2', { k: 'after', s: 1 }, T),
    ]);
    await rp.click('#seqGoBtn');
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 1);
    await rp.click('#seqGoBtn'); // sans attendre le toucher
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 2);
    assert.deepEqual((await phone(sp)).cards[0].slice(0, 3), ['Banque Atlas', 'Virement reçu', '2 400,00 €']);
    await rp.click('#seqStopBtn');
    assert.equal(await rp.evaluate(() => _seqRun.state), 'stopped');
    assert.equal((await rp.textContent('#seqStopBtn')).trim(), 'Pause auto');
    assert.match(await rp.textContent('#seqNow'), /En pause auto : GO relance\./);
    await sleep(1500);
    assert.equal((await phone(sp)).cards.length, 2, 'minuterie arrêtée');
    assert.equal(await sp.evaluate(() => getComputedStyle(document.getElementById('screen-blackout')).display), 'none', 'rien n\'est éteint');
    await rp.click('#seqGoBtn');
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 3);
    await restart();
  });

  test('glisser seul, puis écran d\'accueil (image) : toucher l\'image lance l\'étape suivante', async () => {
    const sig = await rp.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 40; c.height = 80;
      const g = c.getContext('2d'); g.fillStyle = '#3d5a80'; g.fillRect(0, 0, 40, 80);
      const data = c.toDataURL('image/jpeg', 0.8);
      const sig = seqImageSig(data);
      await callAssetPut(seqHomeKey(sig), data);
      return sig;
    });
    await setSteps(rp, [
      st('f1', 'sms', 's1', { k: 'go' }, T),
      st('f2', 'unlock', null, { k: 'gesture', g: 'notif' }, T, { code: 0, then: 'home', img: sig, imgName: 'accueil.jpg' }),
      st('f3', 'color', 'k1', { k: 'gesture', g: 'home' }, T),
    ]);
    r.broker.clear();
    await rp.click('#seqGoBtn');
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 1 && _mediaCache.has('__seqhome'));
    await sp.locator('#screen-phone .pn').click(); // touche la notification : glisser seul → déverrouillé
    await waitFor(sp, () => _scPhone.mode === 'home' && !!document.querySelector('#screen-phone .ph-homeimg'));
    await waitFor(rp, () => seqPos() === 1 && _seqPhones.get(_seq.steps[0].target.id).mode === 'home');
    const night = await rp.evaluate(() => memorySwatch(colorMemories[0].spec));
    await sp.locator('#screen-phone .ph-homeimg').click();
    await waitFor(sp, (c) => screenBaseColor === c, night);
    await r.broker.flush();
    assert.deepEqual((await r.broker.sent(sp, 'phone:gesture')).map((m) => m.g), ['notif', 'unlock', 'home']);
    await restart();
  });

  test('gestes limités : des touchers en rafale ne partent pas tous', async () => {
    await setSteps(rp, [st('g1', 'sms', 's1', { k: 'go' }, T), st('g2', 'sms', 's2', { k: 'gesture', g: 'touch' }, T)]);
    await rp.click('#seqGoBtn');
    await waitFor(sp, () => _scPhone && _scPhone.watch.has('touch'));
    r.broker.clear();
    await sp.evaluate(() => { for (let i = 0; i < 20; i++) phoneGesture('touch'); });
    await sleep(300);
    await r.broker.flush();
    assert.equal((await r.broker.sent(sp, 'phone:gesture')).length, 1);
    await restart();
  });
});

describe('plusieurs écrans : cible de chaque étape, resynchronisation d\'un écran rechargé', () => {
  let r, rp, A, B;
  before(async () => {
    r = await rig(2, 43);
    rp = r.rp; [A, B] = r.screens;
    await fixtures(rp);
    await rp.evaluate((id) => scrSetTarget({ k: 'screen', id }), A.id); // cible de l'interface : A
  });
  after(async () => { noErrors(r); await r?.close(); });

  test('chaque étape va à SA cible, pas à celle de l\'interface', async () => {
    await setSteps(rp, [
      st('h1', 'sms', 's1', { k: 'go' }, { k: 'screen', id: B.id }),
      st('h2', 'color', 'k1', { k: 'go' }, { k: 'screen', id: B.id }),
      st('h3', 'call', 'c1', { k: 'go' }, { k: 'all' }),
    ]);
    r.broker.clear();
    await rp.click('#seqGoBtn');
    await waitFor(B.page, () => document.querySelectorAll('#screen-phone .pn').length === 1);
    const night = await rp.evaluate(() => memorySwatch(colorMemories[0].spec));
    await rp.click('#seqGoBtn');
    await waitFor(B.page, (c) => screenBaseColor === c, night);
    await sleep(300);
    assert.equal((await phone(A.page)).mode, 'off');
    assert.notEqual(await A.page.evaluate(() => screenBaseColor), night);
    await r.broker.flush();
    const sent = await r.broker.sent(rp);
    // (le premier GO coupe le reste sur TOUS les écrans de la séquence : couleur noire, hors de ce contrôle)
    for (const m of sent.filter((m) => m.type === 'phone:state' || (m.type === 'color' && m.color !== '#000000'))) assert.deepEqual(m.target, { screens: [B.id] }, m.type);
    await rp.click('#seqGoBtn'); // « Tous » : les deux écrans sonnent
    await waitFor(A.page, () => _callState === 'ringing');
    await waitFor(B.page, () => _callState === 'ringing');
    assert.equal(await rp.textContent('#seqTarget'), 'Cible : Écran 2');
    assert.match((await rows(rp))[2][1], /^Appel entrant « Maman · mobile » \(Tous les écrans\)$/);
  });

  test('écran rechargé en pleine séquence : écran verrouillé, notifications et déverrouillage attendu retrouvés', async () => {
    await rp.evaluate(() => { seqRestart(); return _seqChain; });
    const TB = { k: 'screen', id: B.id };
    await setSteps(rp, [
      st('i1', 'sms', 's1', { k: 'go' }, TB),
      st('i2', 'missed', 'c1', { k: 'go' }, TB),
      st('i3', 'unlock', null, { k: 'gesture', g: 'touch' }, TB, { code: 6, then: 'app' }),
      st('i4', 'chat', 'cm', { k: 'gesture', g: 'unlock' }, TB),
    ]);
    await rp.click('#seqGoBtn');
    await rp.click('#seqGoBtn');
    await waitFor(B.page, () => document.querySelectorAll('#screen-phone .pn').length === 2);
    const before = await phone(B.page);
    await B.page.reload();
    await B.page.evaluate(() => { if (mode !== 'screen') startMode('screen'); });
    await connected(B.page);
    await waitFor(B.page, () => document.querySelectorAll('#screen-phone .pn').length === 2, null, { timeout: 8000 });
    assert.deepEqual(await phone(B.page), before);
    // Le comédien reprend : toucher, 6 chiffres, la discussion s'ouvre
    await B.page.locator('#screen-phone .ph-lock').click();
    await waitFor(B.page, () => _scPhone.mode === 'code' && document.querySelectorAll('.pk-dot').length === 6);
    for (let i = 0; i < 6; i++) await B.page.keyboard.press(String(i));
    await waitFor(B.page, () => !!document.querySelector('#screen-chat .pt'));
    assert.equal((await phone(A.page)).mode, 'off');
  });
});

describe('éléments, séquences enregistrées, éditeur, avertissement stroboscope', () => {
  test('élément supprimé : « élément introuvable », sauté avec un avertissement', async () => {
    const r = await rig(1, 47);
    const { rp } = r, sp = r.screens[0].page, T = { k: 'screen', id: r.screens[0].id };
    await fixtures(rp);
    await setSteps(rp, [st('j1', 'color', 'k1', { k: 'go' }, T), st('j2', 'sms', 's1', { k: 'go' }, T)]);
    await rp.evaluate(() => { deleteColorMemory('k1'); switchTab('color'); switchTab('seq'); });
    assert.deepEqual((await rows(rp))[0], ['1', 'Couleur — élément introuvable', 'GO', 'next missing']);
    await rp.click('#seqGoBtn');
    assert.equal(await rp.textContent('#seqWarn'), 'Étape 1 sautée : élément introuvable.');
    assert.equal(await pos(rp), 1);
    await rp.click('#seqGoBtn');
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 1);
    assert.equal(await rp.evaluate(() => getComputedStyle(document.getElementById('seqWarn')).display), 'none');
    // L'éditeur le signale aussi (plus aucune mémoire : la liste vide est expliquée) — en Préparer
    await rp.evaluate(() => setSeqMode('prep'));
    await rp.locator('#seqRows .sq-row').nth(0).click();
    assert.match(await rp.textContent('#ssRefCard'), /Aucune mémoire de couleur/);
    await rp.click('.ss-back');
    noErrors(r);
    await r.close();
  });

  test('éditeur en quatre questions (maquette 4h) : ajouter, régler, enregistrer, supprimer (bandeau « Annuler ») une étape', async () => {
    const { page, errors, close } = await openPage(browser);
    await page.evaluate(() => { startMode('remote'); switchTab('seq'); });
    await fixtures(page);
    let dialogs = 0;
    page.on('dialog', (d) => { dialogs++; d.accept(); });
    await page.click('#seqAddBtn');
    assert.equal(await page.textContent('#ssTitle'), 'Nouvelle étape');
    // Quatre questions, dans l'ordre
    assert.deepEqual(await page.$$eval('#seq-step-view .ss-q > h2', (h) => h.map((x) => x.textContent.replace(/\s+/g, ' ').trim())), ['1 Quoi ?', '2 Lequel ?', '3 Quand ?', '4 Sur quel écran ?']);
    assert.deepEqual(await page.$$eval('#ssKinds .ss-opt', (b) => b.map((x) => x.textContent)), ['Couleur', 'Effet', 'Média', 'Appel', 'SMS', 'Notif', 'Veille', 'Manqué', 'Déverrouil.', 'Discussion', 'Batterie', 'Extinction', 'Réseau']);
    await page.locator('#ssKinds .ss-opt', { hasText: 'SMS' }).click();
    assert.equal(await shownEl(page, 'ssKinds'), false, 'la grille des 13 types se referme après le choix');
    assert.match(await page.textContent('#ssKindBtn'), /^SMSChanger$/);
    // 2. Lequel ? : les éléments enregistrés, avec leurs réglages en petit, et « + Nouveau SMS ici »
    assert.deepEqual(await page.$$eval('#ssRefs .ss-opt', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim())).then((l) => l.map((x) => x.slice(0, 5))), ['Maman', 'Maman', 'Nouve']);
    await page.locator('#ssRefs .ss-opt').nth(1).click();
    // 3. Quand ? : Au GO / Après un délai / Geste du comédien
    assert.deepEqual(await page.$$eval('#ssTrigCard .ss-when .ss-opt', (b) => b.map((x) => x.textContent)), ['Au GO', 'Après un délai', 'Geste du comédien']);
    await page.locator('#ssTrigCard .ss-opt', { hasText: 'Après un délai' }).click();
    await page.locator('#ssTrigCard .ss-step-btn[aria-label="Augmenter"]').click();
    assert.equal(await page.textContent('#ssDelayVal'), '5 s');
    // Phrase de synthèse en tête
    assert.equal(await page.textContent('#ssSummary'), '« 5 s après le départ, chaque écran reçoit un SMS de « Maman ». »');
    // 4. Sur quel écran ? : rangée → feuille Tous / groupes / écrans
    assert.match(await page.textContent('#ssTargetBtn'), /^Tous les écrans/);
    await page.click('#ssTargetBtn');
    assert.equal(await page.textContent('#srSheetTitle'), 'Sur quel écran ?');
    assert.deepEqual(await page.$$eval('#ssTargets .dc-menu-btn', (b) => b.map((x) => x.textContent)), ['Tous les écrans']);
    await page.click('#sr-sheet .sr-cancel');
    await page.click('#ssSave');
    assert.deepEqual(await rows(page), [['1', 'SMS « Rappelle-moi stp »', 'après 5 s', 'next']]);
    // Déverrouillage, geste et délai de secours
    await page.click('#seqAddBtn');
    await page.locator('#ssKinds .ss-opt', { hasText: 'Déverrouil.' }).click();
    assert.equal(await page.textContent('#ssQ2label'), 'Réglages', 'sans liste d\'éléments : « Réglages »');
    await page.locator('#ssRefCard .ss-opt', { hasText: 'Code 6 chiffres' }).click();
    await page.locator('#ssTrigCard .ss-opt', { hasText: 'Geste du comédien' }).click();
    await page.locator('#ssTrigCard .ss-opt', { hasText: 'raccroche' }).click();
    for (let i = 0; i < 3; i++) await page.locator('#ssTrigCard .ss-step-btn[aria-label="Augmenter"]').click();
    assert.equal(await page.textContent('#ssSummary'), '« Dès que le comédien refuse, ou après 3 s, chaque écran se déverrouille (code 6 chiffres). »');
    await page.click('#ssSave');
    assert.deepEqual((await rows(page))[1], ['2', 'Déverrouillage code 6 chiffres', 'refuse / 3 s', '']);
    // Modifier puis supprimer : menu ⋯, aucune boîte du navigateur, bandeau « Annuler » qui remet l'étape à son rang
    await page.locator('#seqRows .sq-row').nth(0).click();
    assert.equal(await page.textContent('#ssTitle'), 'Étape 1 sur 2');
    assert.equal(await page.textContent('#ssSummary'), '« 5 s après le départ, chaque écran reçoit un SMS de « Maman ». »');
    await page.click('#ssMore');
    assert.deepEqual(await page.$$eval('#srSheetBody .dc-menu-btn', (b) => b.map((x) => x.textContent)), ['Dupliquer', 'Monter d\'un rang', 'Descendre d\'un rang', 'Supprimer']);
    await page.click('#ssMenuDel');
    assert.equal(dialogs, 0, 'plus de confirm()');
    assert.deepEqual((await rows(page)).map((x) => x[1]), ['Déverrouillage code 6 chiffres']);
    assert.equal(await page.textContent('#usText'), 'Étape 1 supprimée');
    await page.click('#usUndo');
    assert.deepEqual((await rows(page)).map((x) => x[1]), ['SMS « Rappelle-moi stp »', 'Déverrouillage code 6 chiffres'], 'remise à son rang');
    await page.locator('#seqRows .sq-row').nth(0).click();
    await page.click('#ssMore');
    await page.click('#ssMenuDel');
    await page.evaluate(() => _usFlush());
    assert.deepEqual((await rows(page)).map((x) => x[1]), ['Déverrouillage code 6 chiffres']);
    // Une étape sans élément ne s'enregistre pas
    await page.evaluate(() => { callList.call = []; });
    await page.click('#seqAddBtn');
    await page.locator('#ssKinds .ss-opt', { hasText: 'Appel' }).first().click();
    await page.click('#ssSave');
    assert.equal(await page.textContent('#ssErr'), 'Choisissez l\'élément à jouer.');
    assert.equal(await page.textContent('#ssCancel'), 'Annuler', 'nouvelle étape : Annuler');
    assert.equal(await shownEl(page, 'ssMore'), false, 'nouvelle étape : rien à supprimer ni à déplacer');
    await page.click('#ssCancel');
    await page.click('#acOk'); // brouillon modifié : abandon confirmé
    assert.equal((await rows(page)).length, 1);
    assert.equal(dialogs, 0);
    assert.deepEqual(errors, []);
    await close();
  });

  test('« + Nouvel appel ici » : crée l\'appel dans la liste de Tel (n° suivant) et le choisit dans l\'étape, sans quitter l\'éditeur', async () => {
    const { page, errors, close } = await openPage(browser);
    await page.evaluate(() => { startMode('remote'); switchTab('seq'); setCallRing('silent'); });
    await fixtures(page);
    await page.click('#seqAddBtn');
    await page.locator('#ssKinds .ss-opt', { hasText: 'Appel' }).first().click();
    assert.equal(await page.textContent('#ssNewHere'), 'Nouvel appel ici');
    await page.click('#ssNewHere');
    assert.equal(await page.textContent('#srSheetTitle'), 'Nouvel appel');
    assert.match(await page.textContent('#srSheetBody .sr-sheet-note'), /Il rejoint la liste de l'onglet Tel \(n° 2\) et se sélectionne ici\./);
    // Mêmes champs et mêmes rangées que le composeur Tel
    assert.deepEqual(await page.$$eval('#srSheetBody .tl-row .tl-k b', (b) => b.map((x) => x.textContent)), ['Apparence', 'Sonnerie', 'Au décroché']);
    await page.fill('#nwName', 'Hôpital');
    await page.fill('#nwLabel', 'urgences');
    await page.fill('#nwList', 'Hôpital — annonce');
    // Une rangée ouvre sa vue habituelle par-dessus la feuille, qui garde sa saisie
    await page.click('#nwRow-style');
    assert.equal(await shownEl(page, 'tel-style-view'), true);
    await page.click('#callstyle-tonal');
    await page.click('#tsBack');
    assert.equal(await page.inputValue('#nwName'), 'Hôpital');
    assert.match(await page.textContent('#nwRow-style .tl-v'), /^Tonal/);
    await page.click('#nwCreate');
    await waitFor(page, () => callList.call.length === 2);
    assert.deepEqual(await page.evaluate(() => callList.call[1] && [callList.call[1].name, callList.call[1].label, callList.call[1].title, callList.call[1].style]), ['Hôpital', 'urgences', 'Hôpital — annonce', 'tonal']);
    // Créé et sélectionné dans l'étape ; l'éditeur est toujours ouvert
    assert.equal(await shownEl(page, 'seq-step-view'), true);
    assert.equal(await page.evaluate(() => _seqEdit.step.ref === callList.call[1].id), true);
    assert.equal(await page.locator('#ssRefs .ss-opt.on').first().textContent().then((x) => x.replace(/\s+/g, ' ').trim().slice(0, 17)), 'Hôpital — annonce');
    assert.match(await page.textContent('#ssSummary'), /reçoit un appel de « Hôpital »\. »$/);
    await page.click('#ssSave');
    assert.equal((await rows(page))[0][1], 'Appel entrant « Hôpital — annonce »');
    // L'appel est bien dans la liste de l'onglet Tel, au n° 2
    await page.evaluate(() => { switchTab('call'); setCallKind('call'); });
    assert.deepEqual((await page.$$eval('#callListRows .cl-row .cl-name', (n) => n.map((x) => x.textContent))), ['Maman · mobile', 'Hôpital — annonce']);
    // Aperçu sans licence : pas de création (l'éditeur n'est de toute façon pas ouvrable)
    assert.deepEqual(errors, []);
    await close();
  });

  test('séquences enregistrées : enregistrer, renommer, dupliquer, supprimer (bandeau), charger ; gardées au rechargement', async () => {
    const { page, errors, close } = await openPage(browser);
    await page.evaluate(() => { startMode('remote'); switchTab('seq'); });
    await fixtures(page);
    await setSteps(page, [st('k1', 'sms', 's1', { k: 'go' }, { k: 'all' }), st('k2', 'call', 'c1', { k: 'after', s: 3 }, { k: 'all' })]);
    let confirms = 0;
    page.on('dialog', (d) => { confirms++; d.accept(); });
    await page.click('#seqSavedBtn');
    assert.equal(await page.textContent('#seqSavedEmpty'), 'Aucune séquence enregistrée pour l\'instant.');
    await page.click('#seqSaveBtn');
    await page.fill('#srName', 'Séq. 12 — « Le message »');
    await page.click('#sr-sheet .sr-ok');
    const saved = () => page.$$eval('#seqSavedRows .dc-saved-row', (rs) => rs.map((x) => [x.querySelector('.dc-saved-name').textContent, x.querySelector('.dc-saved-meta').textContent, x.classList.contains('selected')]));
    assert.deepEqual(await saved(), [['Séq. 12 — « Le message »', '2 étapes · Tous les écrans', true]]);
    assert.equal(await page.textContent('#seqSavedTitle'), 'Séquences enregistrées · 1');
    assert.equal(await page.textContent('#seqSavedCount'), '1');
    assert.equal(await page.textContent('#seqName'), 'Séq. 12 — « Le message »');
    // Dupliquer, renommer, supprimer (menu « ⋯ »)
    await page.locator('#seqSavedRows .dc-saved-more').nth(0).click();
    await page.locator('#srSheetBody .dc-menu-btn', { hasText: 'Dupliquer' }).click();
    assert.deepEqual((await saved()).map((x) => x[0]), ['Séq. 12 — « Le message »', 'Séq. 12 — « Le message » (copie)']);
    await page.locator('#seqSavedRows .dc-saved-more').nth(1).click();
    await page.locator('#srSheetBody .dc-menu-btn', { hasText: 'Renommer' }).click();
    await page.fill('#srName', 'Séq. 14 — Rupture');
    await page.click('#sr-sheet .sr-ok');
    assert.deepEqual((await saved()).map((x) => x[0]), ['Séq. 12 — « Le message »', 'Séq. 14 — Rupture']);
    // Charger la copie après avoir modifié la séquence en cours : confirmation de l'app (plus de boîte du navigateur)
    await page.evaluate(() => { _seq.steps.pop(); seqSave(); });
    await page.locator('#seqSavedRows .dc-saved-row').nth(1).locator('.cl-play').click();
    assert.equal(await page.textContent('#acTitle'), 'Charger « Séq. 14 — Rupture » ?');
    await page.click('#acCancel');
    assert.equal(await page.evaluate(() => _seq.steps.length), 1, 'refusé : rien ne change');
    await page.locator('#seqSavedRows .dc-saved-row').nth(1).click();
    await page.click('#acOk');
    assert.equal(confirms, 0);
    assert.equal(await page.textContent('#seqName'), 'Séq. 14 — Rupture');
    assert.equal((await rows(page)).length, 2);
    await page.click('#seqSavedBtn');
    await page.locator('#seqSavedRows .dc-saved-more').nth(0).click();
    await page.locator('#srSheetBody .dc-menu-btn', { hasText: 'Supprimer' }).click();
    assert.deepEqual((await saved()).map((x) => x[0]), ['Séq. 14 — Rupture']);
    assert.equal(await page.textContent('#usText'), '« Séq. 12 — « Le message » » supprimée');
    await page.click('#usUndo');
    assert.deepEqual((await saved()).map((x) => x[0]), ['Séq. 12 — « Le message »', 'Séq. 14 — Rupture'], 'remise à son rang');
    await page.locator('#seqSavedRows .dc-saved-more').nth(0).click();
    await page.locator('#srSheetBody .dc-menu-btn', { hasText: 'Supprimer' }).click();
    await page.evaluate(() => _usFlush());
    assert.equal(confirms, 0, 'aucune confirmation()');
    // Rechargement : séquence en cours et séquences enregistrées retrouvées (références, pas de copies)
    await page.reload();
    await page.evaluate(() => { startMode('remote'); switchTab('seq'); setSeqView('saved'); });
    assert.deepEqual(await saved(), [['Séq. 14 — Rupture', '2 étapes · Tous les écrans', true]]);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('setremote-seq-saved-v1')).list[0].steps.map((s) => [s.kind, s.ref]));
    assert.deepEqual(stored, [['sms', 's1'], ['call', 'c1']]);
    // Élément modifié dans son onglet : la séquence joue le nouveau (libellé suivi)
    await page.evaluate(() => { callList.sms[0].name = 'Papa'; persistCallList(); setSeqView('cur'); });
    assert.equal((await rows(page))[0][1], 'Notif SMS « Papa » (verrouillé)');
    assert.deepEqual(errors, []);
    await close();
  });

  test('fond d\'écran (maquette 42) : choisi dans « Téléphone au départ », sur l\'écran verrouillé et le pavé, renvoyé à l\'écran rechargé, gardé par les séquences enregistrées', async () => {
    const r = await rig(1, 59);
    const { rp } = r, S = r.screens[0], T = { k: 'screen', id: S.id };
    await fixtures(rp);
    await setSteps(rp, [st('w1', 'sms', 's1', { k: 'go' }, T), st('w2', 'unlock', null, { k: 'gesture', g: 'touch' }, T, { code: 4, then: 'app' })]);
    // Onglet Média : pas de fond (barre d'état seulement)
    await rp.evaluate(() => openPhoneParams('media'));
    assert.equal(await rp.textContent('#ppWall'), '');
    await rp.evaluate(() => { closePhoneParams(); openPhoneParams('seq'); });
    assert.match(await rp.textContent('#ppWall'), /Fond d'écran.*Aucun fond : dégradé sombre.*Écran verrouillé et code du téléphone, pendant toute la séquence\.Choisir…$/);
    // Image importée (comme l'image d'accueil) : réduite, gardée hors localStorage
    await rp.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 1600; c.height = 3200;
      const g = c.getContext('2d'); g.fillStyle = '#c9a27a'; g.fillRect(0, 0, 1600, 3200);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      onPhoneWallImage([new File([blob], 'plage-julie.png', { type: 'image/png' })]);
    });
    await waitFor(rp, () => !!_seq.wall && !!document.querySelector('#ppWallThumb.has-img'));
    assert.deepEqual(await rp.$$eval('#ppWall .pp-wall-btn', (b) => b.map((x) => x.textContent)), ['Changer…', 'Retirer']);
    assert.equal(await rp.textContent('#ppWall .pp-wall-name'), 'plage-julie.png');
    const stored = await rp.evaluate(() => localStorage.getItem('setremote-seq-v1'));
    assert.match(stored, /"wall":\{"img":"[0-9a-f]{8}-\d+","name":"plage-julie.png"\}/);
    assert.doesNotMatch(stored, /data:image/);
    const wall = await rp.evaluate(() => _seqHomeData(_seq.wall.img));
    assert.equal(await rp.evaluate((d) => new Promise((res) => { const i = new Image(); i.onload = () => res([i.width, i.height]); i.src = d; }), wall).then((s) => s.join('×')), '640×1280');
    await rp.evaluate(() => closePhoneParams());
    // Déroulé : écran verrouillé puis pavé du code sur le fond (préchargé sous __seqwall)
    await rp.click('#seqGoBtn');
    await waitFor(S.page, () => !!document.querySelector('#screen-phone .ph-lock.has-wall'));
    assert.equal(await S.page.evaluate(() => _mediaCache.get('__seqwall').data), wall);
    await rp.click('#seqGoBtn'); // déverrouillage par code : le pavé s'affiche
    await waitFor(S.page, () => !!document.querySelector('#screen-phone .ph-code.has-wall'));
    // Écran rechargé : le fond revient avec l'état
    await S.page.reload();
    await S.page.evaluate(() => { if (mode !== 'screen') startMode('screen'); });
    await connected(S.page);
    await waitFor(S.page, () => !!document.querySelector('#screen-phone .ph-lock.has-wall, #screen-phone .ph-code.has-wall'), null, { timeout: 8000 });
    // Séquence enregistrée : garde son fond ; chargée, elle le rend ; fond retiré : dégradé
    await rp.evaluate(() => saveCurrentSeq('Avec fond'));
    assert.equal(await rp.evaluate(() => JSON.parse(localStorage.getItem('setremote-seq-saved-v1')).list[0].wall.name), 'plage-julie.png');
    await rp.evaluate(() => { openPhoneParams('seq'); ppRemoveWall(); });
    await waitFor(S.page, () => !!document.querySelector('#screen-phone .ph-lock, #screen-phone .ph-code') && !document.querySelector('#screen-phone .has-wall'));
    assert.equal(await rp.evaluate(() => _seq.wall), null);
    assert.ok(await rp.evaluate((d) => callAssetGet(seqHomeKey(seqImageSig(d))), wall), 'encore utilisé par la séquence enregistrée');
    await rp.evaluate(() => { closePhoneParams(); loadSavedSeq(seqSaved[0].id); });
    await rp.click('#acOk'); // séquence modifiée (fond retiré) : confirmation de l'app
    assert.equal(await rp.evaluate(() => _seq.wall && _seq.wall.name), 'plage-julie.png');
    // Plus rien ne s'en sert : l'image est effacée
    await rp.evaluate(() => { deleteSavedSeq(seqSaved[0].id); openPhoneParams('seq'); ppRemoveWall(); closePhoneParams(); _usFlush(); });
    await waitFor(rp, (d) => callAssetGet(seqHomeKey(seqImageSig(d))).then((v) => v === null), wall);
    // Ancienne séquence (sans fond) : relue sans fond
    assert.equal(await rp.evaluate(() => { localStorage.setItem('setremote-seq-v1', JSON.stringify({ v: 1, name: 'x', steps: [] })); seqLoad(); return _seq.wall; }), null);
    noErrors(r);
    await r.close();
  });

  test('avertissement stroboscope : au premier GO d\'une séquence qui allume le strobe ; « Annuler » ne lance rien', async () => {
    const r = await rig(1, 53);
    const { rp } = r, sp = r.screens[0].page, T = { k: 'screen', id: r.screens[0].id };
    await fixtures(rp);
    await rp.evaluate(() => {
      colorMemories.push({ id: 'k2', name: 'éclairs', spec: { kelvin: 5600, tint: 0, dimmer: 100, wheelHex: '#ffffff', crossfade: 0 }, strobe: { active: true, random: false, freq: 8, dur: 30, freqMax: 8, durMax: 30, torch: false } });
      fxMemories.push({ id: 'f2', name: 'Police 1', effect: 'police', dir: 'h', params: { speed: 3, intensity: 100, chaos: 0, drift: 0 } });
    });
    await setSteps(rp, [st('l1', 'sms', 's1', { k: 'go' }, T), st('l2', 'color', 'k2', { k: 'go' }, T), st('l3', 'effect', 'f2', { k: 'go' }, T)]);
    const shown = () => rp.evaluate(() => getComputedStyle(document.getElementById('strobe-warn')).display === 'block');
    await rp.click('#seqGoBtn');
    assert.equal(await shown(), true, 'avant même l\'étape à risque');
    await rp.click('#swCancel');
    assert.equal(await pos(rp), 0, 'rien n\'est lancé');
    await rp.click('#seqGoBtn');
    await rp.click('#swOk');
    await waitFor(sp, () => document.querySelectorAll('#screen-phone .pn').length === 1);
    await rp.click('#seqGoBtn');
    assert.equal(await shown(), false, 'une fois par déroulé');
    await waitFor(sp, () => !!screenStrobeTimer);
    await rp.click('#seqGoBtn');
    await waitFor(sp, () => _screenEffect === 'police'); // suspendu derrière le strobe, qui prime
    // « Ne plus demander pour ce projet » (session) : plus d'avertissement
    await rp.evaluate(() => { seqRestart(); setFlashWarningSkipped(true); });
    await rp.click('#seqGoBtn');
    assert.equal(await shown(), false);
    noErrors(r);
    await r.close();
  });
});

describe('garde-fous du plateau : GO, éditeur d\'étape', () => {
  test('GO : anti-rebond de 600 ms (un double toucher ne saute pas d\'étape), vibration courte, 12 px au moins avec Revenir / Pause auto / Recommencer', async () => {
    const { page, errors, close } = await openPage(browser);
    await page.evaluate(() => {
      startMode('remote'); switchTab('seq'); setSeqMode('play');
      window.__vib = [];
      navigator.vibrate = (p) => { window.__vib.push(p); return true; };
    });
    await fixtures(page);
    await setSteps(page, [st('v1', 'sms', 's1', { k: 'go' }, { k: 'all' }), st('v2', 'sms', 's2', { k: 'go' }, { k: 'all' }), st('v3', 'call', 'c1', { k: 'go' }, { k: 'all' })]);
    assert.equal(await page.evaluate(() => SEQ_GO_GUARD_MS), 600);
    await page.click('#seqGoBtn');
    await page.click('#seqGoBtn'); // double toucher
    assert.equal(await pos(page), 1, 'le second GO est ignoré');
    assert.deepEqual(await page.evaluate(() => window.__vib), [[20]]);
    await sleep(650);
    await page.click('#seqGoBtn');
    assert.equal(await pos(page), 2);
    assert.deepEqual(await page.evaluate(() => window.__vib), [[20], [20]]);
    // seqGo (minuterie, console) n'est pas freiné
    await page.evaluate(() => seqGo());
    assert.equal(await pos(page), 3);
    const gap = await page.evaluate(() => document.getElementById('seqBackBtn').getBoundingClientRect().top - document.getElementById('seqGoBtn').getBoundingClientRect().bottom);
    assert.ok(gap >= 12, 'écart GO / commandes : ' + gap);
    assert.deepEqual(errors, []);
    await close();
  });

  test('éditeur d\'étape : ANNULER pour une nouvelle étape ; quitter avec des modifications demande confirmation', async () => {
    const { page, errors, close } = await openPage(browser);
    await page.evaluate(() => { startMode('remote'); switchTab('seq'); });
    await fixtures(page);
    await setSteps(page, [st('w1', 'sms', 's1', { k: 'go' }, { k: 'all' })]);
    const editor = () => page.evaluate(() => getComputedStyle(document.getElementById('seq-step-view')).display !== 'none');
    const confirmShown = () => page.evaluate(() => getComputedStyle(document.getElementById('app-confirm')).display === 'block');
    // Nouvelle étape intacte : ANNULER (neutre) ferme sans question
    await page.click('#seqAddBtn');
    assert.equal(await page.textContent('#ssCancel'), 'Annuler');
    await page.click('#ssCancel');
    assert.deepEqual([await editor(), await confirmShown()], [false, false]);
    // Nouvelle étape modifiée : « ← Séquence » demande confirmation ; Continuer garde le brouillon
    await page.click('#seqAddBtn');
    await page.locator('#ssKinds .ss-opt', { hasText: 'SMS' }).click();
    await page.click('.ss-back');
    assert.equal(await confirmShown(), true);
    assert.equal(await page.textContent('#acTitle'), 'Abandonner cette étape ?');
    assert.deepEqual([await page.textContent('#acCancel'), await page.textContent('#acOk')], ['Continuer', 'Abandonner']);
    await page.click('#acCancel');
    assert.deepEqual([await editor(), await confirmShown()], [true, false]);
    assert.equal(await page.evaluate(() => _seqEdit.step.kind), 'sms', 'brouillon gardé');
    await page.click('.ss-back');
    await page.click('#acOk');
    assert.equal(await editor(), false);
    assert.equal((await rows(page)).length, 1, 'rien d\'ajouté');
    // Étape existante : SUPPRIMER ; intacte, « ← Séquence » ferme directement ; modifiée, confirmation
    await page.locator('#seqRows .sq-row').nth(0).click();
    assert.equal(await shownEl(page, 'ssMore'), true, 'étape existante : ⋯ (supprimer, dupliquer, déplacer)');
    await page.click('.ss-back');
    assert.deepEqual([await editor(), await confirmShown()], [false, false]);
    await page.locator('#seqRows .sq-row').nth(0).click();
    await page.locator('#ssTrigCard .ss-opt', { hasText: 'Après un délai' }).click();
    await page.click('.ss-back');
    assert.equal(await page.textContent('#acTitle'), 'Abandonner les modifications ?');
    await page.click('#acOk');
    assert.equal(await editor(), false);
    assert.deepEqual((await rows(page))[0].slice(0, 3), ['1', 'Notif SMS « Maman » (verrouillé)', 'GO'], 'étape inchangée');
    assert.deepEqual(errors, []);
    await close();
  });
});

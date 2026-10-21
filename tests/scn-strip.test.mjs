// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Bandeau Scénario (#scnStrip, 31-nav-status.js) : visible seulement quand le Scénario a posé
// quelque chose sur un écran (appel, SMS, notification, discussion, séquence) ; complet sur
// l'onglet Scénario, compact ailleurs ; empilé sous le bandeau lumière ; « Tout arrêter » du
// Scénario (confirmation et pause de la séquence, ou arrêt immédiat avec « Annuler ») sans
// jamais toucher à la lumière, et la lumière ne touche jamais au Scénario.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });

// Télécommande et n écrans joints (faux broker), comme seq-target.test.mjs
async function rig(n, seed) {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed, autoConnect: true });
  const rp = remote.page;
  await rp.evaluate(() => { startMode('remote'); switchTab('seq'); SEQ_GO_GUARD_MS = 0; });
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

// État du bandeau tel que l'écran le montre
const strip = (p) => p.evaluate(() => {
  const e = document.getElementById('scnStrip'), l = document.getElementById('nvStrip');
  const r = e.getBoundingClientRect(), lr = l.getBoundingClientRect();
  return {
    shown: e.style.display !== 'none', cmp: e.classList.contains('cmp'),
    title: document.getElementById('scnTitle').textContent,
    sub: document.getElementById('scnSub').style.display === 'none' ? '' : document.getElementById('scnSub').textContent,
    h: Math.round(r.height), stop: Math.round(document.getElementById('scnStopAll').getBoundingClientRect().height),
    light: l.style.display !== 'none', lightCmp: l.classList.contains('cmp'), gap: Math.round(r.top - lr.bottom), lightBottom: Math.round(lr.bottom),
    lightTop: Math.round(lr.top),
  };
});
// Stroboscope allumé depuis l'onglet Lumière (à passer à page.evaluate)
const lightOn = () => {
  setFlashWarningSkipped(true);
  document.getElementById('strobeToggle').checked = true; onStrobeToggle();
};
const settle = (p) => sleep(250); // scrChanged : rendu différé de 120 ms

// Appel d'un écran : entrée d'appel envoyée comme le fait l'onglet Tel
const CALL = { id: 'c1', kind: 'call', name: 'Maman', label: 'mobile', style: 'glass', ring: 'classic', ringVolume: 1, present: 'full', photoMode: 'avatar', autoAnswer: 0, lock: null, hasPhoto: false, hasAudio: false };
const SMS = { id: 's1', kind: 'sms', name: 'Léa', label: '', msg: 'Tu viens ?', appName: 'Messages', style: 'glass', ring: 'digital', ringVolume: 1, autoAnswer: 0, lock: null, hasPhoto: false, hasAudio: false };
const sendTo = (p, e, id) => p.evaluate(([e, id]) => sendCallEntry(e, [{ screens: [id] }]), [e, id]);
const st = (id, target, extra) => Object.assign({ id, kind: 'color', ref: 'k1', trig: { k: 'go' }, target, opt: {} }, extra || {});
const colors = () => { colorMemories = [{ id: 'k1', name: 'ambiance nuit', spec: { kelvin: 3200, tint: 0, dimmer: 40, wheelHex: '#ffffff', crossfade: 0 }, strobe: { active: false, random: false, freq: 2, dur: 50, freqMax: 8, durMax: 200, torch: false } }]; persistColorMemories(); };
const load = (p, steps, target) => p.evaluate(([steps, target]) => {
  _seq = _seqEmpty(); _seq.steps = seqSanitizeSteps(steps); _seq.target = target; seqSave(); renderSeq();
}, [steps, target]);

describe('bandeau Scénario : visibilité et format', () => {
  let r, rp, A, B;
  before(async () => {
    r = await rig(2, 81);
    rp = r.rp; [A, B] = r.screens.map((s) => s.id);
    await rp.evaluate(colors);
    await rp.evaluate(([a, b]) => { scrRenameScreen(a, 'Salon'); scrRenameScreen(b, 'Cuisine'); }, [A, B]);
    await rp.evaluate(() => switchTab('call'));
    await settle(rp);
  });
  after(async () => { for (const p of [r.remote, ...r.screens]) assert.deepEqual(p.errors, []); await r?.close(); });

  test('rien de posé par le Scénario : bandeau caché', async () => {
    assert.equal((await strip(rp)).shown, false);
  });

  test('appel qui sonne puis en ligne, en format complet sur l\'onglet Scénario', async () => {
    await sendTo(rp, CALL, A);
    await settle(rp);
    let s = await strip(rp);
    assert.equal(s.shown, true);
    assert.equal(s.title, 'Appel « Maman » · sonne');
    assert.equal(s.sub, 'sur Salon');
    assert.equal(s.cmp, false, 'onglet Scénario : version complète');
    assert.ok(s.h >= 52, 'deux lignes : ' + s.h);
    await rp.evaluate((id) => { scrState(id).call.state = 'incall'; renderScnStrip(); }, A);
    assert.equal((await strip(rp)).title, 'Appel « Maman » · en ligne');
    await rp.evaluate(() => { for (const id of scrList()) scrState(id).call = null; renderScnStrip(); });
    assert.equal((await strip(rp)).shown, false);
  });

  test('SMS affiché, puis notification : texte propre à chaque type', async () => {
    await sendTo(rp, SMS, B);
    await settle(rp);
    assert.equal((await strip(rp)).title, 'SMS « Léa » affiché');
    await rp.evaluate((id) => { scrState(id).call.kind = 'notif'; renderScnStrip(); }, B);
    assert.equal((await strip(rp)).title, 'Notification « Léa » affichée');
    await rp.evaluate(() => { for (const id of scrList()) scrState(id).call = null; renderScnStrip(); });
  });

  test('discussion ouverte : texte et cible', async () => {
    await rp.evaluate((a) => { _chat.name = 'Maman'; openChatOnTarget(true, [a]); }, A);
    await settle(rp);
    const s = await strip(rp);
    assert.equal(s.title, 'Discussion « Maman » en cours');
    assert.equal(s.sub, 'sur Salon');
    await rp.evaluate(() => closeChat());
    await settle(rp);
    assert.equal((await strip(rp)).shown, false);
  });

  test('séquence en cours : « Séquence n / total » et prochaine étape ; compacte hors du Scénario', async () => {
    await load(rp, [st('a1', null), st('a2', null)], { k: 'screen', id: A });
    await rp.evaluate(() => { seqGo(true, true); });
    await settle(rp);
    let s = await strip(rp);
    assert.equal(s.title, 'Séquence 1 / 2 en cours');
    assert.match(s.sub, /^Salon · prochaine : /);
    await rp.evaluate(() => switchTab('color'));
    await settle(rp);
    s = await strip(rp);
    assert.equal(s.cmp, true, 'hors Scénario : compact');
    assert.equal(s.title, 'Séquence 1 / 2 en cours · Salon');
    assert.equal(s.sub, '', 'une seule ligne');
    assert.equal(s.h, 40, '40 px');
    assert.equal(s.stop, 34, 'bouton 34 px');
    assert.ok(await rp.evaluate(() => document.getElementById('scnStopAll').getBoundingClientRect().height + 10 >= 44), 'zone de toucher ≥ 44 px');
    await rp.evaluate(() => document.getElementById('scnTxt').click());
    await settle(rp);
    assert.equal(await rp.evaluate(() => navCurrentTab()), 'scenario', 'toucher le texte ouvre le Scénario');
    assert.equal(await rp.evaluate(() => navCurrentSub()), 'seq', 'sur la séquence qui tourne');
    assert.equal((await strip(rp)).cmp, false);
    await rp.evaluate(() => seqRestart()); // Recommencer : écrans rendus à l'utilisateur
    await settle(rp);
  });

  test('deux bandeaux : lumière et Scénario empilés, tous deux compacts', async () => {
    // La lumière d'abord : son envoi retire les couches Tel (« le dernier envoi gagne », 27-tab-gate.js)
    await rp.evaluate(() => switchTab('light'));
    await rp.evaluate(lightOn);
    await settle(rp);
    await rp.evaluate((a) => { _chat.name = 'Maman'; openChatOnTarget(true, [a]); }, A);
    await settle(rp);
    const s = await strip(rp);
    assert.equal(s.light, true);
    assert.equal(s.lightCmp, true, 'bandeau lumière compact');
    assert.equal(s.cmp, true, 'bandeau Scénario compact');
    assert.ok(s.gap >= 0 && s.gap <= 16, 'empilés, espacement de l\'en-tête seulement : ' + s.gap);
    assert.equal(s.h, 40, 'bandeau Scénario : 40 px');
    assert.equal(s.lightBottom - s.lightTop, 40, 'bandeau lumière : 40 px');
    await rp.evaluate(() => { stopEverything(); closeChat(); });
    await settle(rp);
    const after = await strip(rp);
    assert.equal(after.light, false);
    assert.equal(after.shown, false);
  });

  test('lumière seule sur l\'onglet Scénario : bandeau lumière en format normal (le Scénario n\'y touche pas)', async () => {
    await rp.evaluate(() => switchTab('call'));
    await rp.evaluate(lightOn);
    await settle(rp);
    const s = await strip(rp);
    assert.equal(s.light, true);
    assert.equal(s.lightCmp, false, 'sans bandeau Scénario : format normal');
    await rp.evaluate(() => stopEverything());
    await settle(rp);
  });
});

describe('« Tout arrêter » du Scénario', () => {
  let r, rp, A, B;
  before(async () => {
    r = await rig(2, 83);
    rp = r.rp; [A, B] = r.screens.map((s) => s.id);
    await rp.evaluate(colors);
    await rp.evaluate(([a, b]) => { scrRenameScreen(a, 'Salon'); scrRenameScreen(b, 'Cuisine'); }, [A, B]);
    await rp.evaluate(() => switchTab('call'));
  });
  after(async () => { for (const p of [r.remote, ...r.screens]) assert.deepEqual(p.errors, []); await r?.close(); });
  const snack = (p) => p.evaluate(() => getComputedStyle(document.getElementById('undo-snack')).display !== 'none');
  const confirmOpen = (p) => p.evaluate(() => document.getElementById('app-confirm').classList.contains('open'));

  test('sans séquence : immédiat, discussion, SMS et appel retirés ; Annuler rouvre discussion et SMS, pas l\'appel', async () => {
    await sendTo(rp, SMS, A);
    await sendTo(rp, CALL, B);
    await rp.evaluate((a) => { _chat.name = 'Maman'; openChatOnTarget(true, [a]); }, A);
    await settle(rp);
    assert.equal((await strip(rp)).shown, true);
    await rp.evaluate(() => scnStopAll());
    assert.equal(await confirmOpen(rp), false, 'pas de confirmation sans séquence');
    assert.equal(await rp.evaluate(() => _chat.open), false, 'discussion fermée');
    assert.deepEqual(await rp.evaluate(([a, b]) => [scrState(a).call, scrState(b).call], [A, B]), [null, null]);
    await settle(rp);
    assert.equal((await strip(rp)).shown, false);
    assert.equal(await snack(rp), true, 'annulation proposée six secondes');
    assert.equal(await rp.evaluate(() => document.getElementById('usText').textContent), 'Scénario arrêté');
    await rp.click('#usUndo');
    await settle(rp);
    assert.equal(await rp.evaluate(() => _chat.open), true, 'discussion rouverte');
    await waitFor(rp, (a) => !!scrState(a).call, A, { timeout: 4000 });
    assert.equal(await rp.evaluate((a) => scrState(a).call && scrState(a).call.kind, A), 'sms', 'SMS rendu');
    assert.equal(await rp.evaluate((b) => scrState(b).call, B), null, 'l\'appel raccroché ne se rappelle pas');
    await rp.evaluate(() => closeChat());
    await rp.evaluate(() => { for (const id of scrList()) { if (scrState(id).call) sendMsg({ type: 'call:end', target: { screens: [id] } }); } });
    await settle(rp);
  });

  test('la lumière n\'est jamais touchée : stroboscope et couleur restent, le Scénario seul s\'arrête', async () => {
    await rp.evaluate(lightOn);
    await sendTo(rp, CALL, A);
    await settle(rp);
    await rp.evaluate(() => scnStopAll());
    await settle(rp);
    assert.equal(await rp.evaluate(() => strobeActive), true, 'stroboscope allumé');
    assert.equal(await rp.evaluate((a) => scrState(a).call, A), null, 'appel raccroché');
    await rp.evaluate(() => stopEverything());
    await settle(rp);
  });

  test('le « Tout arrêter » de la lumière ne touche jamais au Scénario', async () => {
    await rp.evaluate(lightOn);
    await sendTo(rp, SMS, A);
    await rp.evaluate((a) => { _chat.name = 'Maman'; openChatOnTarget(true, [a]); }, A);
    await settle(rp);
    await rp.evaluate(() => stopEverything());
    await settle(rp);
    assert.equal(await rp.evaluate(() => strobeActive), false, 'lumière coupée');
    assert.equal(await rp.evaluate(() => _chat.open), true, 'discussion intacte');
    assert.equal(await rp.evaluate((a) => !!scrState(a).call, A), true, 'SMS intact');
    assert.equal((await strip(rp)).shown, true, 'bandeau Scénario toujours là');
    await rp.evaluate(() => scnStopAll());
    await settle(rp);
    await rp.evaluate(() => { closeChat(); _usFlush(); }); // six secondes passées : l'annulation n'est plus proposée
  });

  test('séquence en cours : confirmation, Continuer ne fait rien ; Tout arrêter met en pause, garde la position, libère les écrans', async () => {
    await load(rp, [st('a1', { screens: [A] }), st('a2', { screens: [A] }, { trig: { k: 'go' } })], { k: 'screen', id: A });
    await rp.evaluate(() => seqGo(true, true));
    await settle(rp);
    assert.equal(await rp.evaluate(() => _seqRun.state), 'running');
    await rp.evaluate(() => scnStopAll());
    assert.equal(await confirmOpen(rp), true, 'confirmation');
    assert.match(await rp.textContent('#acText'), /étape 1 \/ 2/);
    await rp.click('#acCancel');
    assert.equal(await rp.evaluate(() => _seqRun.state), 'running', 'Continuer : rien n\'est arrêté');
    await rp.evaluate(() => scnStopAll());
    await rp.click('#acOk');
    await settle(rp);
    assert.equal(await rp.evaluate(() => _seqRun.state), 'stopped', 'séquence en pause');
    assert.equal(await rp.evaluate(() => seqPos()), 0, 'position gardée (étape 1)');
    assert.equal(await rp.evaluate(() => _seqRun.released), true, 'écrans libérés');
    assert.equal(await rp.evaluate(() => seqOwnedIds().size), 0);
    assert.equal(await rp.evaluate((a) => _seqPhones.get(a).mode, A), 'off', 'téléphone remis à vide');
    assert.equal(await snack(rp), false, 'pas d\'annulation : la séquence reste en pause');
    assert.equal((await strip(rp)).shown, false);
    // L'écran reçoit le vide, sans plus rien de la séquence
    await sleep(200);
    assert.equal(await r.screens[0].page.evaluate(() => _scPhone && _scPhone.mode), 'off');
    // GO reprend à l'étape suivante, la position a été gardée
    await rp.evaluate(() => seqGo(true, true));
    await settle(rp);
    assert.equal(await rp.evaluate(() => seqPos()), 1, 'reprise à l\'étape 2');
    assert.equal(await rp.evaluate(() => _seqRun.state), 'ended');
    await rp.evaluate(() => seqRestart());
  });
});

// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Habillage du loader d'extinction (étape « Extinction », 91-sequence.js) : puces Auto | Verre |
// Tonal | Épuré avec aperçu du loader, opt.style assaini et conservé (enregistrer, charger, projet),
// envoyé à l'écran dans phone:state.offStyle seulement avec power off, appliqué par l'écran
// (94-sequence-phone.js) et accepté par le protocole (22-protocol.js). Auto = style du téléphone.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });

// Télécommande et un écran joints (faux broker)
async function rig(seed) {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed, autoConnect: true });
  const rp = remote.page;
  await rp.evaluate(() => { startMode('remote'); switchTab('seq'); SEQ_GO_GUARD_MS = 0; });
  await connected(rp);
  const hash = await pairingHash(rp);
  const s = await openPage(browser, { broker, seed: seed * 10, autoConnect: true, hash });
  await connected(s.page);
  const id = await s.page.evaluate(() => screenId());
  await waitFor(rp, (k) => _screenOfSender.size === k && scrList().length === k, 1);
  await waitFor(rp, () => _resyncTimer === null);
  await sleep(200);
  await broker.flush();
  return { broker, remote, rp, screen: s, id, close: async () => { await s.close(); await remote.close(); } };
}

// Étape Extinction (cible : celle de la séquence)
const off = (id, style) => ({ id, kind: 'off', target: null, trig: { k: 'go' }, opt: style === undefined ? {} : { style } });
const previewCls = (p) => p.evaluate(() => document.querySelector('#seq-step-view .ss-off-box .pp-off').className);
const load = (p, steps, target) => p.evaluate(([steps, target]) => {
  _seq = _seqEmpty(); _seq.steps = seqSanitizeSteps(steps); _seq.target = target; seqSave(); renderSeq();
}, [steps, target]);

describe('étape Extinction : puces et aperçu de l\'éditeur', () => {
  let r, rp, A;
  before(async () => {
    r = await rig(91);
    rp = r.rp; A = r.id;
    await rp.evaluate((a) => scrRenameScreen(a, 'Salon'), A);
  });
  after(async () => { for (const p of [r.remote, r.screen]) assert.deepEqual(p.errors, []); await r?.close(); });

  test('Auto par défaut : quatre puces, aperçu du style du téléphone (Verre) et légende', async () => {
    await load(rp, [off('o1')], { k: 'screen', id: A });
    await rp.evaluate(() => openSeqStep('o1'));
    const chips = await rp.$$eval('#seq-step-view .ss-offst .ss-opt', (b) => b.map((x) => x.textContent.trim()));
    assert.deepEqual(chips, ['Auto', 'Verre', 'Tonal', 'Épuré']);
    assert.equal(await rp.$eval('#seq-step-view .ss-offst .ss-opt.on', (b) => b.textContent.trim()), 'Auto');
    assert.equal(await previewCls(rp), 'pp-off ph-glass');
    assert.match(await rp.textContent('#seq-step-view .ss-off-prev p'), /Auto : style du téléphone \(Verre\)/);
  });

  test('Tonal : l\'aperçu change aussitôt, la légende aussi', async () => {
    await rp.click('#seq-step-view .ss-opt:text-is("Tonal")');
    assert.equal(await previewCls(rp), 'pp-off ph-tonal');
    assert.equal(await rp.$eval('#seq-step-view .ss-offst .ss-opt.on', (b) => b.textContent.trim()), 'Tonal');
    assert.match(await rp.textContent('#seq-step-view .ss-off-prev p'), /Remplace le style du téléphone pour cette étape seulement/);
  });

  test('enregistrer : opt.style gardé, relu après sauvegarde, valeur inconnue ramenée à Auto', async () => {
    await rp.click('#ssSave');
    await sleep(100);
    assert.equal(await rp.evaluate(() => _seq.steps[0].opt.style), 'tonal');
    assert.equal(await rp.evaluate(() => { seqSave(); seqLoad(); return _seq.steps[0].opt.style; }), 'tonal', 'aller-retour du stockage');
    assert.match(await rp.evaluate(() => seqStepSummaryText(_seq.steps[0], 0)), /s'éteint \(habillage Tonal\)/);
    // Sanitisation : inconnu ou absent (anciennes séquences) = Auto ; valeurs prévues gardées
    assert.deepEqual(await rp.evaluate(() => [seqSanitizeStep({ id: 'a', kind: 'off', opt: { style: 'wifi' } }).opt, seqSanitizeStep({ id: 'b', kind: 'off', opt: {} }).opt, seqSanitizeStep({ id: 'c', kind: 'off' }).opt, seqSanitizeStep({ id: 'd', kind: 'off', opt: { style: 'minimal' } }).opt]),
      [{ style: 'auto' }, { style: 'auto' }, { style: 'auto' }, { style: 'minimal' }]);
  });
});

describe('étape Extinction : envoi à l\'écran et application', () => {
  let r, rp, S;
  before(async () => {
    r = await rig(92);
    rp = r.rp; S = r.id;
    await rp.evaluate((a) => scrRenameScreen(a, 'Salon'), S);
  });
  after(async () => { for (const p of [r.remote, r.screen]) assert.deepEqual(p.errors, []); await r?.close(); });

  // Téléphone déjà allumé (veille, écran verrouillé) puis extinction : le loader part d'un état connu
  const runOff = async (style) => {
    await load(rp, [{ id: 'v0', kind: 'sleep', target: null, trig: { k: 'go' }, opt: {} }, off('o1', style)], { k: 'screen', id: S });
    await rp.evaluate(() => seqGo(true, true));
    await sleep(300);
    await rp.evaluate(() => seqGo(true, true));
    await sleep(500);
  };
  const screenState = () => r.screen.page.evaluate(() => ({ off: _scPhone && _scPhone.power, offStyle: _scPhone && _scPhone.offStyle, style: _scPhone && _scPhone.style, cls: document.querySelector('#screen-ppower .pp-off') && document.querySelector('#screen-ppower .pp-off').className }));

  test('Tonal : l\'écran reçoit offStyle avec l\'extinction et son loader prend le style Tonal', async () => {
    await runOff('tonal');
    const s = await screenState();
    assert.equal(s.off, 'off');
    assert.equal(s.offStyle, 'tonal');
    assert.equal(s.cls, 'pp-off ph-tonal');
  });

  test('Auto (absent) : pas d\'offStyle, le loader garde le style du téléphone', async () => {
    await rp.evaluate(() => seqRestart());
    await sleep(300);
    await runOff(undefined);
    const s = await screenState();
    assert.equal(s.off, 'off');
    assert.equal(s.offStyle, null, 'auto : rien d\'envoyé');
    assert.equal(s.cls, 'pp-off ph-' + s.style);
  });

  test('rallumé (étape Veille) : l\'écran ne reçoit plus d\'habillage d\'extinction', async () => {
    await load(rp, [off('o1', 'tonal'), { id: 'v1', kind: 'sleep', target: null, trig: { k: 'go' }, opt: {} }], { k: 'screen', id: S });
    await rp.evaluate(() => seqRestart());
    await sleep(300);
    await rp.evaluate(() => seqGo(true, true));
    await sleep(300);
    assert.equal((await screenState()).offStyle, 'tonal');
    await rp.evaluate(() => seqGo(true, true));
    await sleep(500);
    const s = await screenState();
    assert.equal(s.off, 'on', 'rallumé');
    assert.equal(s.offStyle, null);
  });

  test('protocole : offStyle accepté seulement en extinction, valeur connue seulement', async () => {
    const v = (m) => rp.evaluate((m) => { const x = Object.assign({ type: 'phone:state', mode: 'off', style: 'glass', notifs: [] }, m); return [_validPhoneState(x), x.offStyle]; }, m);
    assert.deepEqual(await v({ power: 'off', offStyle: 'tonal' }), [true, 'tonal']);
    assert.deepEqual(await v({ power: 'off', offStyle: 'minimal' }), [true, 'minimal']);
    assert.deepEqual(await v({ power: 'off', offStyle: 'wifi' }), [true, null], 'inconnu : ignoré');
    assert.deepEqual(await v({ power: 'off', offStyle: 'auto' }), [true, null], 'auto n\'est pas transmis');
    assert.deepEqual(await v({ power: 'on', offStyle: 'tonal' }), [true, null], 'allumé : rien');
    assert.deepEqual(await v({ offStyle: 'tonal' }), [true, null], 'absent du power off');
  });
});

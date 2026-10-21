// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Son de la notification d'une étape « Appel manqué » (91-sequence.js) : rangée sous la question 2,
// feuille (puces des sons, volume, vibreur, OK), réglages gardés dans s.opt (ring, vol, vib),
// son envoyé à l'écran (phone:state, chime), anciennes étapes sans son → Métallophone Do.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
const IMPORTED = '__ring_0123456789abcdef';

describe('étape « Appel manqué » : son de la notification', () => {
  let broker, remote, rp, screen, sid;
  before(async () => {
    broker = new FakeBroker();
    remote = await openPage(browser, { broker, seed: 81, autoConnect: true });
    rp = remote.page;
    await rp.evaluate(() => { startMode('remote'); switchTab('seq'); setSeqMode('play'); SEQ_GO_GUARD_MS = 0; });
    await connected(rp);
    const hash = await pairingHash(rp);
    screen = await openPage(browser, { broker, seed: 810, autoConnect: true, hash });
    await connected(screen.page);
    sid = await screen.page.evaluate(() => screenId());
    await waitFor(rp, () => _screenOfSender.size === 1 && scrList().length === 1);
    await waitFor(rp, () => _resyncTimer === null);
    await sleep(200);
    await rp.evaluate(() => {
      callList.call = [
        { id: 'c1', kind: 'call', style: 'glass', name: 'Maman', label: 'mobile', ring: 'silent', ringVolume: 1, vib: true, present: 'full', photoMode: 'avatar', autoAnswer: 0, hasPhoto: false, hasAudio: false },
        { id: 'c2', kind: 'call', style: 'glass', name: 'Léa', label: '', ring: 'silent', ringVolume: 1, present: 'full', photoMode: 'avatar', autoAnswer: 0, hasPhoto: false, hasAudio: false },
      ];
      persistCallList();
      ringLib = [{ id: '__ring_0123456789abcdef', name: 'sonnerie-regie.mp3', mime: 'audio/mpeg', size: 10, dur: 4, at: 1 }];
    });
  });
  after(async () => { assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []); await screen.close(); await remote.close(); });

  const setStep = (opt, ref = 'c1') => rp.evaluate(([opt, ref, sid]) => {
    _seq = _seqEmpty();
    _seq.target = { k: 'screen', id: sid };
    _seq.steps = seqSanitizeSteps([{ id: 'm1', kind: 'missed', ref, target: null, trig: { k: 'go' }, opt }]);
    seqSave(); renderSeq();
  }, [opt, ref, sid]);
  // Chime du dernier phone:state envoyé à l'écran
  async function playChime() {
    await rp.evaluate(() => seqRestart());
    broker.clear();
    await rp.evaluate(() => seqGo());
    await waitFor(rp, () => seqPos() === 0);
    await sleep(300);
    await broker.flush();
    const states = (await broker.sent(rp)).filter((m) => m.type === 'phone:state' && m.chime);
    return states.at(-1) && states.at(-1).chime;
  }

  test('relecture : son absent ou invalide → Métallophone Do, volume borné, vibreur gardé seulement s\'il est réglé', async () => {
    const got = await rp.evaluate(() => [
      seqSanitizeStep({ id: 'x', kind: 'missed', ref: 'c1' }).opt,
      seqSanitizeStep({ id: 'x', kind: 'missed', ref: 'c1', opt: { ring: 'nope', vol: 7, vib: 'oui' } }).opt,
      seqSanitizeStep({ id: 'x', kind: 'missed', ref: 'c1', opt: { ring: 'metal-sol', vol: 0.5, vib: false } }).opt,
      seqSanitizeStep({ id: 'x', kind: 'missed', ref: 'c1', opt: { ring: '__ring_0123456789abcdef', vol: -2, vib: true } }).opt,
      seqSanitizeStep({ id: 'x', kind: 'missed', ref: 'c1', opt: { ring: 'metal-sol', vol: 0.5 } }).opt,
    ]);
    assert.deepEqual(got, [
      { ring: 'metal-do', vol: 1 }, { ring: 'metal-do', vol: 1 }, { ring: 'metal-sol', vol: 0.5, vib: false },
      { ring: IMPORTED, vol: 0, vib: true }, { ring: 'metal-sol', vol: 0.5 },
    ]);
  });

  test('nouvelle étape : Métallophone Do, vibreur oui ; rangée « Son de la notification » sous la question 2', async () => {
    await rp.evaluate(() => { _seq = _seqEmpty(); renderSeq(); openSeqStep(null); seqEditKind('missed'); });
    assert.deepEqual(await rp.evaluate(() => _seqEdit.step.opt), { ring: 'metal-do', vol: 1, vib: true });
    assert.equal(await rp.evaluate(() => document.getElementById('ssSoundBtn').previousElementSibling && true), true);
    assert.equal((await rp.textContent('#ssSoundBtn')).replace(/\s+/g, ' ').trim(), 'Son de la notificationMétallophone Do · vibreur oui');
    // Autres types : pas de rangée
    await rp.evaluate(() => seqEditKind('sms'));
    assert.equal(await rp.$('#ssSoundBtn'), null);
    await rp.evaluate(() => closeSeqStep());
  });

  test('feuille : puces (intégrés + importés), volume, vibreur, OK ; la rangée suit ; enregistrer garde les réglages', async () => {
    await setStep({});
    await rp.evaluate(() => openSeqStep('m1'));
    // Étape déjà enregistrée sans son : Métallophone Do ; vibreur de l'appel lié (oui)
    assert.equal((await rp.textContent('#ssSoundBtn')).replace(/\s+/g, ' ').trim(), 'Son de la notificationMétallophone Do · vibreur oui');
    await rp.click('#ssSoundBtn');
    assert.equal(await rp.textContent('#srSheetTitle'), 'Son de la notification');
    assert.deepEqual(await rp.$$eval('#ssSoundChips .chip', (b) => b.map((x) => x.textContent)), ['Métallophone Do', 'Métallophone Sol', 'Envoi', 'Classique', 'Digitale', 'Douce', 'Silencieux']);
    assert.equal(await rp.textContent('#ssSoundChips .chip.active'), 'Métallophone Do');
    assert.deepEqual(await rp.$$eval('#ssSoundLib .rt-name', (b) => b.map((x) => x.textContent)), ['sonnerie-regie.mp3']);
    await rp.locator('#ssSoundChips .chip', { hasText: 'Métallophone Sol' }).click();
    assert.equal(await rp.textContent('#ssSoundChips .chip.active'), 'Métallophone Sol');
    await rp.locator('#ssSoundVol').fill('50');
    assert.equal((await rp.textContent('#ssSoundVolVal')).replace(/\s+/g, ''), '50%');
    await rp.uncheck('#ssSoundVib', { force: true }).catch(() => rp.evaluate(() => seqSoundVib(false)));
    assert.deepEqual(await rp.evaluate(() => _seqEdit.step.opt), { ring: 'metal-sol', vol: 0.5, vib: false });
    await rp.click('#ssSoundOk');
    assert.equal((await rp.textContent('#ssSoundBtn')).replace(/\s+/g, ' ').trim(), 'Son de la notificationMétallophone Sol · vibreur non');
    await rp.click('#ssSave');
    assert.deepEqual(await rp.evaluate(() => _seq.steps[0].opt), { ring: 'metal-sol', vol: 0.5, vib: false });
    // Son importé et Silencieux restent proposés
    await rp.evaluate(() => openSeqStep('m1'));
    await rp.click('#ssSoundBtn');
    await rp.locator('#ssSoundLib .rt-row').click();
    assert.equal(await rp.evaluate(() => _seqEdit.step.opt.ring), IMPORTED);
    assert.match(await rp.textContent('#ssSoundLib .rt-row.selected'), /sonnerie-regie/);
    await rp.locator('#ssSoundChips .chip', { hasText: 'Silencieux' }).click();
    assert.equal(await rp.evaluate(() => _seqEdit.step.opt.ring), 'silent');
    await rp.click('#ssSoundOk');
    await rp.evaluate(() => closeSeqStep());
  });

  test('lecture : le son de l\'étape part à l\'écran (phone:state, chime) avec volume et vibreur', async () => {
    await setStep({ ring: 'metal-sol', vol: 0.5, vib: false });
    const m = await playChime();
    assert.deepEqual([m.ring, m.vol, m.vib], ['metal-sol', 0.5, undefined]);
    await setStep({ ring: 'sent', vol: 1, vib: true });
    const c = await playChime();
    assert.deepEqual([c.ring, c.vol, c.vib], ['sent', undefined, true]);
    await setStep({ ring: 'silent', vol: 1, vib: true });
    assert.deepEqual((await playChime()).ring, 'silent');
    // Son importé : ringId (l'écran retombe sur le son intégré s'il lui manque)
    await setStep({ ring: IMPORTED, vol: 1, vib: false });
    const imp = await playChime();
    assert.deepEqual([imp.ringId, imp.vib], [IMPORTED, undefined]);
  });

  test('anciennes étapes (sans son) : Métallophone Do ; vibreur de l\'appel lié', async () => {
    await setStep({}, 'c1');
    let c = await playChime();
    assert.deepEqual([c.ring, c.vib], ['metal-do', true]);
    await setStep({}, 'c2');
    c = await playChime();
    assert.deepEqual([c.ring, c.vib], ['metal-do', undefined]);
    // Après le chime l'écran a reçu l'état (le son joué côté écran est celui de l'étape)
    assert.equal(await screen.page.evaluate(() => _scPhone && _scPhone.notifs.length > 0), true);
  });
});

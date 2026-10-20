// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Discussion : timings et lecture automatique (maquette validée 26d). Pause
// avant, écriture (« … écrit » du contact ; le comédien tape ou le texte
// s'écrit tout seul), envoi automatique ou au bouton ; « ▶ Lecture auto »,
// « ⏸ Pause », « ↶ », avancée ; fil entièrement automatique, fil mixte qui
// attend le comédien puis repart ; reprise d'un écran rechargé en pleine
// frappe automatique ; timings enregistrés avec les discussions et migration
// des anciennes ; étape « Discussion » d'une Séquence en lecture auto.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
async function rig(seed) {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed, autoConnect: true });
  const rp = remote.page;
  await rp.evaluate(() => { startMode('remote'); switchTab('call'); setCallKind('discussion'); });
  await connected(rp);
  const s = await openPage(browser, { broker, seed: seed * 10, autoConnect: true, hash: await pairingHash(rp) });
  await connected(s.page);
  s.id = await s.page.evaluate(() => screenId());
  await waitFor(rp, () => _screenOfSender.size === 1 && scrList().length === 1);
  await waitFor(rp, () => _resyncTimer === null);
  await sleep(200);
  await broker.flush();
  await rp.evaluate((id) => scrSetTarget({ k: 'screen', id }), s.id);
  return { broker, rp, sp: s.page, sid: s.id, errs: [remote.errors, s.errors], close: async () => { await s.close(); await remote.close(); } };
}
const bubbles = (page) => page.evaluate(() => [...document.querySelectorAll('#screen-chat .pt-b:not(.pt-typing)')].map((b) => (b.classList.contains('out') ? '> ' : '< ') + b.textContent));
const typing = (page) => page.evaluate(() => !!document.querySelector('#screen-chat .pt-typing'));
const setThread = (rp, msgs) => rp.evaluate((msgs) => {
  _chat.msgs = msgs.map(([id, from, text, pause, write, auto, send]) => ({ id, from, text, pause, write, auto, send }));
  _chat.sent = []; _chat.pend = []; chatSave(); renderChatPanel();
}, msgs);

test('lecture auto entièrement automatique : pauses, « … écrit », texte qui s\'écrit tout seul ; écran rechargé en pleine frappe', async () => {
  const r = await rig(81);
  const { rp, sp } = r;
  await setThread(rp, [
    ['d1', 'contact', 'Tu es où ?', 0, 1, false, 'auto'],
    ['d2', 'actor', 'je suis chez Léa, j\'arrive', 1, 3, true, 'auto'],
    ['d3', 'contact', 'Je t\'ai vue avec lui.', 0, 0, false, 'auto'],
  ]);
  // Pastilles « pause · écriture » (maquette 26d)
  assert.deepEqual(await rp.$$eval('#dcRows .dc-pill', (p) => p.map((x) => x.textContent)), ['0 s · 1 s', '1 s · auto 3 s', '0 s · 0 s']);
  assert.equal(await rp.textContent('#dcAutoState'), 'prête · 0 / 3');
  r.broker.clear();
  await rp.click('#dcAutoPlay');
  assert.equal(await rp.evaluate(() => _chat.open), true, 'la lecture ouvre la discussion sur la cible');
  await waitFor(sp, () => !!document.querySelector('#screen-chat .pt-typing'));
  assert.match(await rp.textContent('#dcAutoState'), /^● en cours · 1 \/ 3$/);
  await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b.in:not(.pt-typing)').length === 1, null, { timeout: 3000 });
  // Pause avant (1 s), puis le texte du comédien s'écrit tout seul : rechargé au milieu, il reprend
  await waitFor(sp, () => document.querySelector('#screen-chat .pt-typed').textContent.length > 4, null, { timeout: 4000 });
  await sp.reload();
  await sp.evaluate(() => { if (mode !== 'screen') startMode('screen'); });
  await connected(sp);
  await waitFor(sp, () => !!document.querySelector('#screen-chat .pt'), null, { timeout: 8000 });
  await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b.in:not(.pt-typing)').length === 2, null, { timeout: 8000 });
  assert.deepEqual(await bubbles(sp), ['< Tu es où ?', '> je suis chez Léa, j\'arrive', '< Je t\'ai vue avec lui.']);
  await waitFor(rp, () => _chat.sent.length === 3 && !_chatAuto.on);
  assert.equal(await rp.textContent('#dcAutoState'), 'terminée · 3 / 3');
  await r.broker.flush();
  const sent = await r.broker.sent(rp);
  assert.deepEqual(sent.filter((m) => m.type === 'chat:post').map((m) => [m.id, m.typing, m.dur]), [['d1', true, 1], ['d3', false, undefined]]);
  assert.deepEqual(sent.filter((m) => m.type === 'chat:type').map((m) => [m.id, m.dur, m.send]), [['d2', 3, true]]);
  assert.ok(sent.some((m) => m.type === 'chat:open' && m.auto && m.auto.id === 'd2'), 'reprise de la frappe automatique');
  for (const e of r.errs) assert.deepEqual(e, []);
  await r.close();
});

test('fil mixte : automatique jusqu\'au message tapé par le comédien, attente, puis reprise ; pause, ▶ et ↶', async () => {
  const r = await rig(83);
  const { rp, sp } = r;
  await setThread(rp, [
    ['d1', 'contact', 'Tu es où ?', 0, 0, false, 'auto'],
    ['d2', 'actor', 'ok', 0, 3, false, 'button'],
    ['d3', 'contact', 'Rentre vite.', 1, 0, false, 'auto'],
    ['d4', 'contact', 'Je t\'attends.', 2, 0, false, 'auto'],
  ]);
  assert.deepEqual((await rp.$$eval('#dcRows .dc-pill', (p) => p.map((x) => x.textContent)))[1], '0 s · tape');
  await rp.click('#dcAutoPlay');
  await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b').length === 1);
  await waitFor(rp, () => /attend Julie/.test(document.getElementById('dcAutoState').textContent));
  assert.equal(await rp.textContent('#dcAutoState'), '● attend Julie · 2 / 4');
  await sleep(1200);
  assert.equal((await bubbles(sp)).length, 1, 'attend le comédien');
  await sp.keyboard.type('ok');
  await sp.keyboard.press('Enter');
  await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b').length === 3, null, { timeout: 3000 });
  // Pause pendant la « pause avant » du n° 4 : rien ne part ; ▶ repart
  await rp.click('#dcAutoPause');
  assert.equal(await rp.textContent('#dcAutoState'), 'en pause · 4 / 4');
  await sleep(2400);
  assert.equal((await bubbles(sp)).length, 3);
  await rp.click('#dcAutoPlay');
  await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b').length === 4, null, { timeout: 4000 });
  await waitFor(rp, () => /terminée/.test(document.getElementById('dcAutoState').textContent));
  // ↶ : pause et dernier message retiré
  await rp.click('#dcAutoBack');
  await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b').length === 3);
  assert.equal(await rp.evaluate(() => _chatAuto.on), false);
  assert.equal(await rp.textContent('#dcAutoState'), 'prête · 3 / 4');
  for (const e of r.errs) assert.deepEqual(e, []);
  await r.close();
});

test('envoi « au bouton » du contact : la lecture attend « Envoyer n° X », avec la durée d\'écriture du message', async () => {
  const r = await rig(87);
  const { rp, sp } = r;
  await setThread(rp, [['d1', 'contact', 'Allô ?', 0, 2, false, 'button'], ['d2', 'contact', 'Réponds.', 0, 0, false, 'auto']]);
  await rp.click('#dcAutoPlay');
  await waitFor(rp, () => /attend « Envoyer »/.test(document.getElementById('dcAutoState').textContent));
  await sleep(600);
  assert.equal(await typing(sp), false);
  await rp.click('#dcGo');
  await waitFor(sp, () => !!document.querySelector('#screen-chat .pt-typing'));
  await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b:not(.pt-typing)').length === 2, null, { timeout: 4000 });
  assert.deepEqual(await bubbles(sp), ['< Allô ?', '< Réponds.']);
  for (const e of r.errs) assert.deepEqual(e, []);
  await r.close();
});

test('timings réglés dans le fil, enregistrés avec la discussion ; anciennes discussions et ancien fil : valeurs par défaut, comportement inchangé', async () => {
  const { page, errors, close } = await openPage(browser);
  // Ancien fil en cours et ancienne discussion enregistrée (sans timings)
  await page.evaluate(() => {
    localStorage.setItem('setremote-chat-v1', JSON.stringify({ v: 1, name: 'Maman', actor: 'Julie', style: 'glass', typing: true, msgs: [{ id: 'd1', from: 'contact', text: 'Tu es où ?' }, { id: 'd2', from: 'actor', text: 'ici' }], sent: [] }));
    localStorage.setItem('setremote-chat-saved-v1', JSON.stringify({ v: 1, list: [{ id: 'old', name: 'Ancienne', contact: 'Papa', actor: 'Léo', style: 'tonal', msgs: [{ id: 'm1', from: 'actor', text: 'salut' }] }] }));
  });
  await page.reload();
  await page.evaluate(() => { startMode('remote'); switchTab('call'); setCallKind('discussion'); });
  assert.deepEqual(await page.evaluate(() => _chat.msgs), [
    { id: 'd1', from: 'contact', text: 'Tu es où ?', pause: 0, write: 2, auto: false, send: 'button' },
    { id: 'd2', from: 'actor', text: 'ici', pause: 0, write: 3, auto: false, send: 'button' }]);
  assert.deepEqual(await page.evaluate(() => chatSaved[0].msgs[0]), { id: 'm1', from: 'actor', text: 'salut', pause: 0, write: 3, auto: false, send: 'button' });
  assert.equal(await page.evaluate(() => chatHasUnsavedChanges()), true);
  // Régler les timings du n° 2 (maquette 26d) : pause 1 s, automatique en 4 s, envoi automatique
  await page.locator('#dcRows .dc-row').nth(1).click();
  await page.locator('#dcRows .dc-edit .dc-edit-ok').click();
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('dcTimingPanel')).display), 'block', 'carte des timings du message touché');
  assert.equal(await page.textContent('#dcTimingPanel .dc-tlabel'), 'Message 2 · Julie');
  await page.locator('#dcTimingPanel .dc-tbtn[aria-label="Pause avant +"]').click();
  await page.locator('#dcTimingPanel .ss-opt', { hasText: 'Automatique' }).first().click();
  await page.locator('#dcTimingPanel .dc-tbtn[aria-label="Durée d\'écriture +"]').click();
  await page.locator('#dcTimingPanel .ss-opt', { hasText: 'Automatique' }).nth(1).click();
  assert.match(await page.textContent('#dcTimingPanel'), /Contact : « … écrit » pendant la durée d'écriture\. Comédien : le texte s'écrit tout seul lettre par lettre\./);
  assert.equal(await page.locator('#dcRows .dc-pill').nth(1).textContent(), '1 s · auto 4 s');
  // Enregistrer, recharger : timings gardés
  await page.click('#dcTab-saved');
  await page.click('#dcSaveBtn');
  await page.fill('#srName', 'Avec timings');
  await page.click('#sr-sheet .sr-ok');
  await page.reload();
  await page.evaluate(() => { startMode('remote'); switchTab('call'); setCallKind('discussion'); });
  assert.deepEqual(await page.evaluate(() => chatSaved[1].msgs[1]), { id: 'd2', from: 'actor', text: 'ici', pause: 1, write: 4, auto: true, send: 'auto' });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('setremote-chat-saved-v1')).v), 2);
  // L'ancienne, chargée : « Envoyer n° X » comme avant (indicateur 2 s du réglage du fil, sans durée)
  page.on('dialog', (d) => d.accept());
  await page.click('#dcTab-saved');
  await page.locator('#dcSavedRows .dc-saved-row').nth(0).click();
  assert.deepEqual(await page.evaluate(() => _chat.msgs.map((m) => [m.pause, m.send])), [[0, 'button']]);
  assert.deepEqual(errors, []);
  await close();
});

test('Séquence : étape « Discussion » avec « ▶ Auto · le comédien tape »', async () => {
  const r = await rig(89);
  const { rp, sp, sid } = r;
  await rp.evaluate((id) => {
    chatSaved = [{ id: 'ca', name: 'Auto', contact: 'Maman', actor: 'Julie', style: 'glass', hasPhoto: false, photoSig: null,
      msgs: [{ id: 'd1', from: 'contact', text: 'Tu es où ?', pause: 1, write: 1, send: 'auto' }, { id: 'd2', from: 'contact', text: 'Réponds.', pause: 0, write: 0, send: 'auto' }] }];
    _chsvPersist();
    switchTab('seq');
  }, sid);
  await rp.click('#seqAddBtn');
  await rp.locator('#ssKinds .ss-opt', { hasText: 'Discussion' }).click();
  assert.match(await rp.textContent('#ssRefCard'), /Lecture/);
  await rp.locator('#ssRefCard .ss-opt', { hasText: 'Auto · le comédien tape' }).click();
  await rp.locator('#ssTrigCard .ss-opt', { hasText: 'Téléphone' }).or(rp.locator('#ssTrigCard .ss-opt').last()).first().click();
  await rp.click('#ssSave');
  assert.equal(await rp.textContent('#seqRows .sq-label'), 'Discussion « Maman » · auto (comédien tape)');
  await rp.evaluate(async () => { seqGo(); await _seqChain; });
  await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b:not(.pt-typing)').length === 2, null, { timeout: 6000 });
  assert.deepEqual(await bubbles(sp), ['< Tu es où ?', '< Réponds.']);
  for (const e of r.errs) assert.deepEqual(e, []);
  await r.close();
});

test('Séquence, « ▶ Auto · le comédien tape » : messages du contact « au bouton » partis avec leurs durées, état sous l\'étape (maquette 40)', async () => {
  const r = await rig(91);
  const { rp, sp } = r;
  await rp.evaluate(() => {
    chatSaved = [{ id: 'cb', name: 'Bouton', contact: 'Maman', actor: 'Julie', style: 'glass', hasPhoto: false, photoSig: null,
      msgs: [{ id: 'd1', from: 'contact', text: 'Tu es où ?', pause: 0, write: 1, send: 'button' }, { id: 'd2', from: 'contact', text: 'Réponds.', pause: 1, write: 0, send: 'button' },
        { id: 'd3', from: 'actor', text: 'ici', pause: 0, write: 3, send: 'button' }] }];
    _chsvPersist();
    switchTab('seq');
  });
  await rp.click('#seqAddBtn');
  await rp.locator('#ssKinds .ss-opt', { hasText: 'Discussion' }).click();
  await rp.locator('#ssRefCard .ss-opt', { hasText: 'Auto · le comédien tape' }).click();
  await rp.click('#ssSave');
  await rp.evaluate(async () => { seqGo(); await _seqChain; });
  await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b:not(.pt-typing)').length === 2, null, { timeout: 6000 });
  assert.deepEqual(await bubbles(sp), ['< Tu es où ?', '< Réponds.']);
  await waitFor(rp, () => /attend Julie · 3 \/ 3/.test(document.getElementById('seqChatStatus').textContent));
  assert.match(await rp.textContent('#seqChatStatus'), /Prochain : Julie « ici »/);
  for (const e of r.errs) assert.deepEqual(e, []);
  await r.close();
});

test('Séquence, « ▶ Auto · tout automatique » (maquette 41) : les réponses du comédien s\'écrivent et partent toutes seules ; anciennes étapes relues', async () => {
  const r = await rig(93);
  const { rp, sp, broker } = r;
  await rp.evaluate(() => {
    chatSaved = [{ id: 'cf', name: 'Tout auto', contact: 'Maman', actor: 'Julie', style: 'glass', hasPhoto: false, photoSig: null,
      msgs: [{ id: 'd1', from: 'contact', text: 'Tu es où ?', pause: 0, write: 1, send: 'button' },
        { id: 'd2', from: 'actor', text: 'ici', pause: 0, write: 0, send: 'button' },
        { id: 'd3', from: 'contact', text: 'Rentre.', pause: 0, write: 0, send: 'button' }] }];
    _chsvPersist();
    switchTab('seq');
  });
  await rp.click('#seqAddBtn');
  await rp.locator('#ssKinds .ss-opt', { hasText: 'Discussion' }).click();
  assert.deepEqual(await rp.$$eval('#ssRefCard .ss-play .ss-opt', (b) => b.map((x) => [x.textContent, x.classList.contains('on')])),
    [['Manuelle', true], ['Auto · le comédien tape', false], ['Auto · tout automatique', false]]);
  assert.equal(await rp.textContent('#ssRefCard .ss-play-note'), 'Tout automatique : les réponses de Julie s\'écrivent aussi toutes seules, avec leurs durées enregistrées. « Le comédien tape » : le fil attend que Julie tape sur l\'écran.');
  await rp.locator('#ssRefCard .ss-opt', { hasText: 'Auto · tout automatique' }).click();
  assert.deepEqual(await rp.evaluate(() => _seqEdit.step.opt), { auto: true, full: true });
  await rp.click('#ssSave');
  assert.equal(await rp.textContent('#seqRows .sq-label'), 'Discussion « Maman » → réponse · auto complète');
  broker.clear();
  await rp.evaluate(async () => { seqGo(); await _seqChain; });
  // Personne ne tape : la réponse « au bouton », tapée par le comédien d'habitude, s'écrit (1 s au moins) et part
  await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b:not(.pt-typing)').length === 3, null, { timeout: 8000 });
  assert.deepEqual(await bubbles(sp), ['< Tu es où ?', '> ici', '< Rentre.']);
  await broker.flush();
  const type = (await broker.sent(rp)).find((m) => m.type === 'chat:type');
  assert.deepEqual([type.id, type.dur, type.send], ['d2', 1, true]);
  await waitFor(rp, () => /terminée · 3 \/ 3/.test(document.getElementById('seqChatStatus').textContent));
  // Données : « auto » seul (ancienne étape) = le comédien tape ; « full » sans « auto » ignoré ; aller-retour enregistré
  assert.deepEqual(await rp.evaluate(() => [
    seqSanitizeStep({ id: 'x', kind: 'chat', ref: 'cf', opt: { auto: true } }).opt,
    seqSanitizeStep({ id: 'x', kind: 'chat', ref: 'cf', opt: { full: true } }).opt,
    seqSanitizeStep({ id: 'x', kind: 'chat', ref: 'cf' }).opt,
  ]), [{ auto: true, full: false }, { auto: false, full: false }, { auto: false, full: false }]);
  assert.deepEqual(await rp.evaluate(() => { seqLoad(); return _seq.steps[0].opt; }), { auto: true, full: true });
  for (const e of r.errs) assert.deepEqual(e, []);
  await r.close();
});

// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Discussion fictive, maquette validée 26b : « ↶ » (retirer le dernier message
// affiché, remis en attente ; un message du comédien se retape ; un message
// improvisé disparaît), « Reprendre ici » (historique affiché d'un coup, sans
// « … écrit » ni animation, repère orange dans le fil), « Repartir de zéro »,
// et reprise après rechargement de l'écran dans chaque cas.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
const state = (page) => page.evaluate(() => [...document.querySelectorAll('#dcRows .dc-row')].map((r) => (r.classList.contains('sent') ? 'posté' : r.classList.contains('cur') ? 'en cours' : '')));
const texts = (page) => page.evaluate(() => [...document.querySelectorAll('#dcRows .dc-row .dc-text')].map((t) => t.textContent));
const bubbles = (page) => page.evaluate(() => [...document.querySelectorAll('#screen-chat .scc-b:not(.scc-typing)')].map((b) => (b.classList.contains('out') ? '> ' : '< ') + b.textContent));
const compose = (page) => page.evaluate(() => {
  const el = document.getElementById('screen-chat');
  return { typed: el.querySelector('.scc-typed').textContent, ready: el.querySelector('.scc-field').classList.contains('ready'), send: !el.querySelector('.scc-send').disabled };
});
const nBubbles = (k) => document.querySelectorAll('#screen-chat .scc-b:not(.scc-typing)').length === k;
const JULIE = 'je suis chez Léa, j\'arrive';

test('télécommande seule : bouton « ↶ », « Repartir de zéro », repère de reprise gardé au rechargement', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('call'); setCallKind('discussion'); });
  // Entre « Envoyer n°X » et « Écrire… » ; inactif tant que rien n'est affiché
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#dcSendPanel .dc-send-row button')].map((b) => b.id)), ['dcGo', 'dcBackBtn', 'dcWriteBtn']);
  assert.equal(await page.getAttribute('#dcBackBtn use', 'href'), '#i-undo-2');
  assert.equal(await page.getAttribute('#dcBackBtn', 'aria-label'), 'Revenir d\'un message');
  assert.equal(await page.isDisabled('#dcBackBtn'), true);
  assert.equal(await page.textContent('#dcRestartBtn'), 'Repartir de zéro');
  assert.match(await page.textContent('#dcAdd'), /toucher un message : « Reprendre ici »$/);
  // « Reprendre ici » depuis l'éditeur d'un message
  await page.locator('#dcRows .dc-row').nth(3).click();
  assert.equal(await page.textContent('#dcRows .dc-edit .dc-edit-resume'), 'Reprendre ici');
  await page.click('#dcRows .dc-edit .dc-edit-resume');
  assert.deepEqual(await state(page), ['posté', 'posté', 'posté', '', '']);
  assert.equal(await page.textContent('#dcResume'), 'Reprise ici · 1 à 3 affichés comme historique');
  assert.equal(await page.evaluate(() => document.getElementById('dcResume').previousElementSibling.dataset.id), 'd4', 'sous le message de reprise');
  assert.equal(await page.textContent('#dcGo'), 'Envoyer n°4 (Maman)');
  assert.equal(await page.isDisabled('#dcBackBtn'), false);
  // Gardé au rechargement de la télécommande
  await page.reload();
  await page.evaluate(() => { startMode('remote'); switchTab('call'); setCallKind('discussion'); });
  assert.equal(await page.textContent('#dcResume'), 'Reprise ici · 1 à 3 affichés comme historique');
  // « ↶ » dans l'historique : le repère disparaît
  await page.click('#dcBackBtn');
  assert.deepEqual(await state(page), ['posté', 'posté', 'en cours', '', '']);
  assert.equal(await page.evaluate(() => document.getElementById('dcResume')), null);
  // Reprise au n° 2 : « 1 affiché comme historique » ; au n° 1 : aucun repère
  await page.locator('#dcRows .dc-row').nth(1).click();
  await page.click('#dcRows .dc-edit .dc-edit-resume');
  assert.equal(await page.textContent('#dcResume'), 'Reprise ici · 1 affiché comme historique');
  await page.click('#dcRestartBtn');
  assert.deepEqual(await state(page), ['', '', '', '', '']);
  assert.equal(await page.evaluate(() => [document.getElementById('dcResume'), _chat.resumeAt].join()), ',');
  assert.equal(await page.isDisabled('#dcBackBtn'), true);
  assert.deepEqual(errors, []);
  await close();
});

describe('télécommande et écran reliés', () => {
  let broker, remote, screen, rp, sp, sid;
  before(async () => {
    broker = new FakeBroker();
    remote = await openPage(browser, { broker, seed: 81, autoConnect: true });
    rp = remote.page;
    await rp.evaluate(() => { startMode('remote'); switchTab('call'); setCallKind('discussion'); });
    await connected(rp);
    screen = await openPage(browser, { broker, seed: 82, autoConnect: true, hash: await pairingHash(rp) });
    sp = screen.page;
    await connected(sp);
    await waitFor(rp, () => _pairedScreens.size === 1);
    await waitFor(rp, () => _resyncTimer === null);
    sid = await sp.evaluate(() => screenId());
    await rp.evaluate((sid) => scrSetTarget({ k: 'screen', id: sid }), sid);
    await sleep(150);
    await broker.flush();
  });
  after(async () => {
    assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
    await screen?.close(); await remote?.close();
  });
  const reloadScreen = async () => {
    await sp.reload();
    await sp.evaluate(() => { if (mode !== 'screen') startMode('screen'); });
    await connected(sp);
  };

  test('« ↶ » sur les messages du contact : une fois, plusieurs fois, pendant « … écrit »', async () => {
    await rp.click('#dcGo');
    await rp.click('#dcGo');
    await waitFor(sp, nBubbles, 2);
    broker.clear();
    await rp.click('#dcBackBtn');
    await waitFor(sp, nBubbles, 1);
    assert.deepEqual(await bubbles(sp), ['< Tu es où ?']);
    assert.deepEqual(await state(rp), ['posté', '', '', '', '']);
    assert.equal(await rp.textContent('#dcGo'), 'Envoyer n°2 (Maman)', 'remis en attente');
    await broker.flush();
    assert.deepEqual((await broker.sent(rp)).filter((m) => m.type.startsWith('chat:')), [{ type: 'chat:rewind', id: 'd2', target: { screens: [sid] } }]);
    // Encore : plus rien d'affiché, bouton inactif
    await rp.click('#dcBackBtn');
    await waitFor(sp, nBubbles, 0);
    assert.equal(await rp.isDisabled('#dcBackBtn'), true);
    assert.equal(await rp.textContent('#dcGo'), 'Envoyer n°1 (Maman)');
    // Pendant « … écrit » : l'indicateur disparaît, la bulle n'arrive jamais
    await rp.click('#dcGo');
    await rp.check('#dcTypingToggle');
    await rp.click('#dcGo');
    await waitFor(sp, () => !!document.querySelector('#screen-chat .scc-typing'));
    await rp.click('#dcBackBtn');
    await waitFor(sp, () => !document.querySelector('#screen-chat .scc-typing'));
    await sleep(2300);
    assert.deepEqual(await bubbles(sp), ['< Tu es où ?']);
    assert.equal(await sp.evaluate(() => document.querySelector('#screen-chat .scc-typing')), null);
    // Renvoyé : de nouveau avec « … écrit », puis la bulle
    await rp.click('#dcGo');
    await waitFor(sp, () => !!document.querySelector('#screen-chat .scc-typing'));
    await waitFor(sp, nBubbles, 2, { timeout: 4000 });
    await rp.uncheck('#dcTypingToggle');
    assert.deepEqual(await state(rp), ['posté', 'posté', 'en cours', '', '']);
  });

  test('« ↶ » sur un message du comédien : il se retape lettre à lettre ; pendant la frappe ; plusieurs fois', async () => {
    await sp.keyboard.type('x'.repeat(30));
    await sp.keyboard.press('Enter');
    await waitFor(rp, () => _chat.sent.includes('d3'));
    assert.deepEqual(await bubbles(sp), ['< Tu es où ?', '< Ton père t\'attend depuis une heure', '> ' + JULIE]);
    // Retiré : de nouveau en cours, à retaper depuis le début
    await rp.click('#dcBackBtn');
    await waitFor(sp, nBubbles, 2);
    assert.deepEqual(await compose(sp), { typed: '', ready: true, send: false });
    assert.deepEqual(await state(rp), ['posté', 'posté', 'en cours', '', '']);
    assert.equal(await rp.textContent('#dcProgress'), 'En frappe sur l\'écran · 0 / 26 lettres');
    await sp.keyboard.type('abcde');
    assert.equal((await compose(sp)).typed, 'je su');
    await waitFor(rp, () => /5 \/ 26 lettres/.test(document.getElementById('dcProgress').textContent));
    // Pendant la frappe : le message du contact d'avant part, la frappe est oubliée
    await rp.click('#dcBackBtn');
    await waitFor(sp, nBubbles, 1);
    assert.deepEqual(await compose(sp), { typed: '', ready: false, send: false });
    assert.equal(await rp.evaluate(() => [_chat.progress, document.getElementById('dcProgress')].join()), ',');
    await sp.keyboard.type('abc');
    assert.equal((await compose(sp)).typed, '', 'pas de frappe tant que le contact n\'a pas réécrit');
    // Renvoyé : le message du comédien repart de zéro
    await rp.click('#dcGo');
    await waitFor(sp, nBubbles, 2);
    assert.deepEqual(await compose(sp), { typed: '', ready: true, send: false });
    await sp.keyboard.type('abc');
    assert.equal((await compose(sp)).typed, 'je ');
    // Plusieurs fois de suite, jusqu'au bout
    await rp.click('#dcBackBtn'); await rp.click('#dcBackBtn');
    await waitFor(sp, nBubbles, 0);
    assert.deepEqual(await state(rp), ['', '', '', '', '']);
    assert.equal(await rp.isDisabled('#dcBackBtn'), true);
  });

  test('« ↶ » sur un message improvisé : retiré de l\'écran et du fil ; écran rechargé ensuite', async () => {
    await rp.click('#dcGo');
    await waitFor(sp, nBubbles, 1);
    await rp.click('#dcWriteBtn');
    await rp.fill('#dcWriteText', 'Allô ?');
    await rp.click('.dc-write-send');
    await waitFor(sp, nBubbles, 2);
    assert.equal((await texts(rp))[1], 'Allô ?');
    const impro = await rp.evaluate(() => _chat.msgs[1].id);
    broker.clear();
    await rp.click('#dcBackBtn');
    await waitFor(sp, nBubbles, 1);
    assert.deepEqual(await texts(rp), ['Tu es où ?', 'Ton père t\'attend depuis une heure', JULIE, 'Je t\'ai vue avec lui. On en parlera ce soir.', 'pardon maman']);
    await broker.flush();
    assert.deepEqual((await broker.sent(rp)).filter((m) => m.type.startsWith('chat:')), [{ type: 'chat:rewind', id: impro, drop: true, target: { screens: [sid] } }]);
    assert.equal(await sp.evaluate((id) => _scChat.ids.includes(id) || _scChatMsgs.has(id), impro), false, 'oublié par l\'écran');
    // Le fil continue normalement
    await rp.click('#dcGo');
    await waitFor(sp, nBubbles, 2);
    await sp.keyboard.type('abcd');
    await waitFor(rp, () => _chat.progress && _chat.progress.typed === 4);
    // « ↶ » sur le comédien (retapé : 0 lettre) puis rechargement : l'écran retrouve exactement l'état affiché
    await sp.keyboard.type('x'.repeat(22));
    await sp.keyboard.press('Enter');
    await waitFor(rp, () => _chat.sent.includes('d3'));
    await rp.click('#dcBackBtn');
    await waitFor(sp, nBubbles, 2);
    await sp.keyboard.type('abcdef');
    await waitFor(rp, () => _chat.progress && _chat.progress.typed === 6);
    await reloadScreen();
    await waitFor(sp, () => document.querySelectorAll('#screen-chat .scc-b').length === 2, null, { timeout: 8000 });
    assert.deepEqual(await bubbles(sp), ['< Tu es où ?', '< Ton père t\'attend depuis une heure']);
    assert.deepEqual(await compose(sp), { typed: 'je sui', ready: true, send: false });
  });

  test('« Reprendre ici » : historique affiché d\'un coup (sans « … écrit », sans animation), frappe oubliée ; repère ; écran rechargé', async () => {
    await rp.check('#dcTypingToggle'); // l'indicateur ne s'applique pas à l'historique
    // Reprise au n° 5 (comédien) : 1 à 4 affichés, y compris la réponse de Julie
    await rp.locator('#dcRows .dc-row').nth(4).click();
    broker.clear();
    await rp.click('#dcRows .dc-edit .dc-edit-resume');
    await waitFor(sp, nBubbles, 4, { timeout: 2000 });
    const look = await sp.evaluate(() => ({
      typing: !!document.querySelector('#screen-chat .scc-typing'),
      anim: document.querySelectorAll('#screen-chat .scc-new').length,
      instant: document.querySelector('#screen-chat .scc').classList.contains('scc-instant'),
    }));
    assert.deepEqual(look, { typing: false, anim: 0, instant: true });
    assert.deepEqual(await bubbles(sp), ['< Tu es où ?', '< Ton père t\'attend depuis une heure', '> ' + JULIE, '< Je t\'ai vue avec lui. On en parlera ce soir.']);
    assert.deepEqual(await compose(sp), { typed: '', ready: true, send: false }, 'frappe du n° 3 oubliée');
    await broker.flush();
    const open = (await broker.sent(rp)).filter((m) => m.type.startsWith('chat:'));
    assert.deepEqual(open.map((m) => [m.type, m.history, m.sent && m.sent.join()]), [['chat:open', true, 'd1,d2,d3,d4']]);
    assert.equal(await rp.textContent('#dcResume'), 'Reprise ici · 1 à 4 affichés comme historique');
    assert.deepEqual(await state(rp), ['posté', 'posté', 'posté', 'posté', 'en cours']);
    // Reprise au n° 3 alors que Julie tape le n° 5 : retour en arrière d'un coup, frappe oubliée
    await sp.keyboard.type('pa');
    await waitFor(rp, () => _chat.progress && _chat.progress.typed === 2);
    await rp.locator('#dcRows .dc-row').nth(2).click();
    await rp.click('#dcRows .dc-edit .dc-edit-resume');
    await waitFor(sp, nBubbles, 2);
    assert.deepEqual(await compose(sp), { typed: '', ready: true, send: false });
    assert.equal(await rp.textContent('#dcResume'), 'Reprise ici · 1 et 2 affichés comme historique');
    assert.equal(await rp.textContent('#dcProgress'), 'En frappe sur l\'écran · 0 / 26 lettres');
    await sp.keyboard.type('je s');
    await waitFor(rp, () => _chat.progress && _chat.progress.typed === 4);
    // Écran rechargé : historique et lettres tapées retrouvés
    await reloadScreen();
    await waitFor(sp, () => document.querySelectorAll('#screen-chat .scc-b').length === 2, null, { timeout: 8000 });
    assert.deepEqual(await bubbles(sp), ['< Tu es où ?', '< Ton père t\'attend depuis une heure']);
    assert.deepEqual(await compose(sp), { typed: 'je s', ready: true, send: false });
    // Reprise sur le message même en cours de frappe : il repart de zéro (télécommande comprise)
    await rp.locator('#dcRows .dc-row').nth(2).click();
    await rp.click('#dcRows .dc-edit .dc-edit-resume');
    await waitFor(sp, () => document.querySelector('#screen-chat .scc-typed').textContent === '');
    await sleep(400);
    assert.equal(await rp.evaluate(() => (_chat.progress ? _chat.progress.typed : 0)), 0);
    assert.deepEqual(await bubbles(sp), ['< Tu es où ?', '< Ton père t\'attend depuis une heure']);
    // La scène reprend : Julie envoie, la suite part normalement (avec « … écrit »)
    await sp.keyboard.type('x'.repeat(30));
    await sp.keyboard.press('Enter');
    await waitFor(rp, () => _chat.sent.includes('d3'));
    await rp.click('#dcGo');
    await waitFor(sp, () => !!document.querySelector('#screen-chat .scc-typing'));
    await waitFor(sp, nBubbles, 4, { timeout: 4000 });
    await rp.uncheck('#dcTypingToggle');
    assert.equal(await rp.textContent('#dcResume'), 'Reprise ici · 1 et 2 affichés comme historique', 'le repère reste');
  });

  test('« Reprendre ici » discussion fermée : ouverte sur la cible avec l\'historique ; « Repartir de zéro »', async () => {
    await rp.click('#dcCloseBtn');
    await waitFor(sp, () => document.getElementById('screen-chat').style.display === 'none');
    await rp.locator('#dcRows .dc-row').nth(3).click();
    await rp.click('#dcRows .dc-edit .dc-edit-resume');
    await waitFor(sp, nBubbles, 3);
    assert.equal(await sp.evaluate(() => document.querySelectorAll('#screen-chat .scc-new').length), 0);
    assert.match(await rp.textContent('#dcState'), /^Discussion ouverte sur « /);
    assert.equal(await rp.textContent('#dcGo'), 'Envoyer n°4 (Maman)');
    // Écran rechargé : même historique
    await reloadScreen();
    await waitFor(sp, () => document.querySelectorAll('#screen-chat .scc-b').length === 3, null, { timeout: 8000 });
    assert.deepEqual(await bubbles(sp), ['< Tu es où ?', '< Ton père t\'attend depuis une heure', '> ' + JULIE]);
    // « Repartir de zéro »
    await rp.click('#dcRestartBtn');
    await waitFor(sp, nBubbles, 0);
    assert.equal(await rp.evaluate(() => document.getElementById('dcResume')), null);
    assert.equal(await rp.textContent('#dcGo'), 'Envoyer n°1 (Maman)');
  });
});

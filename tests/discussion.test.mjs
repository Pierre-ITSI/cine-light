// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Discussion fictive (onglet Tel, maquettes 26 et 27) : fil préparé sur la
// télécommande (ajout, modification, glisser, suppression), messages du
// contact envoyés avec l'indicateur « … écrit », messages du comédien révélés
// lettre à lettre par les touches du clavier de l'écran (envoi actif une fois
// le texte complet), progression renvoyée à la télécommande (débit limité),
// reprise après rechargement de l'écran, « Écrire… », ciblage, sécurité.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash, fakePeer, deliverFrame, connectFakeClients, chatGo, chatThreadMenu, chatTyping } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
const rows = (page) => page.evaluate(() => [...document.querySelectorAll('#dcRows .dc-row')].map((r) => [
  r.querySelector('.dc-num').textContent, r.querySelector('.dc-who').textContent, r.querySelector('.dc-text').textContent,
  r.classList.contains('sent') ? 'posté' : r.classList.contains('cur') ? 'en cours' : '',
]));
const bubbles = (page) => page.evaluate(() => [...document.querySelectorAll('#screen-chat .pt-b:not(.pt-typing)')].map((b) => (b.classList.contains('out') ? '> ' : '< ') + b.textContent));
const compose = (page) => page.evaluate(() => {
  const el = document.getElementById('screen-chat');
  return { typed: el.querySelector('.pt-typed').textContent, send: !el.querySelector('.pt-send').disabled };
});

test('fil préparé : ajouter, modifier (texte, côté), glisser, supprimer ; gardé au rechargement', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('call'); setCallKind('discussion'); });
  for (const id of ['dcContactPanel', 'dcThreadPanel', 'dcSendPanel', 'dcSavedPanel']) assert.notEqual(await page.evaluate((id) => getComputedStyle(document.getElementById(id)).display, id), 'none', id);
  for (const id of ['callWhoPanel', 'callListPanel', 'telCallRows']) assert.equal(await page.evaluate((id) => getComputedStyle(document.getElementById(id)).display, id), 'none', id);
  // Fil par défaut (maquette 26)
  assert.deepEqual(await rows(page), [
    ['1', 'Maman ›', 'Tu es où ?', ''], ['2', 'Maman ›', 'Ton père t\'attend depuis une heure', ''],
    ['3', 'Julie ›', 'je suis chez Léa, j\'arrive', ''], ['4', 'Maman ›', 'Je t\'ai vue avec lui. On en parlera ce soir.', ''], ['5', 'Julie ›', 'pardon maman', ''],
  ]);
  assert.equal(await page.textContent('#dcGoLbl'), 'ENVOYER N°1');
  assert.equal(await page.textContent('#dcState'), 'Discussion fermée');
  // Noms
  await page.fill('#dcName', 'Papa');
  await page.fill('#dcActor', 'Léo');
  assert.equal(await page.textContent('#dcActorLabel'), 'Messages de Léo');
  assert.equal(await page.textContent('#dcTypingLabel'), 'Indicateur « … écrit » 2 s avant chaque message de Papa');
  // Ajouter : côté opposé au dernier, éditeur ouvert
  await page.click('#dcAdd');
  assert.equal(await page.evaluate(() => _chat.msgs.at(-1).from), 'contact');
  await page.fill('#dcRows .dc-edit textarea', 'Rentre vite.');
  await page.locator('#dcRows .dc-edit .gw-seg-btn').nth(1).click(); // côté comédien
  await page.locator('#dcRows .dc-edit .dc-edit-ok').click();
  assert.deepEqual((await rows(page))[5], ['6', 'Léo ›', 'Rentre vite.', '']);
  // Modifier une ligne existante
  await page.locator('#dcRows .dc-row').nth(0).click();
  await page.fill('#dcRows .dc-edit textarea', 'T\'es où ??');
  await page.locator('#dcRows .dc-edit .dc-edit-ok').click();
  assert.equal((await rows(page))[0][2], 'T\'es où ??');
  // Un message laissé vide disparaît
  await page.click('#dcAdd');
  await page.locator('#dcRows .dc-edit .dc-edit-ok').click();
  assert.equal((await rows(page)).length, 6);
  // Glisser (appui maintenu) : la ligne 5 passe en tête
  await page.evaluate(() => document.getElementById('dcRows').scrollIntoView({ block: 'center' }));
  const r5 = await page.locator('#dcRows .dc-row').nth(4).boundingBox();
  const r1 = await page.locator('#dcRows .dc-row').nth(0).boundingBox();
  await page.mouse.move(r5.x + 40, r5.y + r5.height / 2);
  await page.mouse.down();
  await sleep(350);
  await page.mouse.move(r5.x + 40, r1.y + 2, { steps: 8 });
  await page.mouse.up();
  assert.deepEqual((await rows(page)).map((r) => r[2]).slice(0, 2), ['pardon maman', 'T\'es où ??']);
  // Supprimer (après le glisser, le clic résiduel est ignoré 350 ms)
  await sleep(400);
  await page.locator('#dcRows .dc-row').nth(0).click();
  await page.locator('#dcRows .dc-edit .cl-del').click();
  assert.deepEqual((await rows(page)).map((r) => r[2]), ['T\'es où ??', 'Ton père t\'attend depuis une heure', 'je suis chez Léa, j\'arrive', 'Je t\'ai vue avec lui. On en parlera ce soir.', 'Rentre vite.']);
  // Rechargement : fil et noms retrouvés
  await page.reload();
  await page.evaluate(() => { startMode('remote'); switchTab('call'); setCallKind('discussion'); });
  assert.equal((await rows(page)).length, 5);
  assert.deepEqual(await page.evaluate(() => [_chat.name, _chat.actor, document.getElementById('dcName').value]), ['Papa', 'Léo', 'Papa']);
  // Style propre à la discussion (l'appel garde le sien), dans la vue « Style et son » (maquette 36d)
  assert.equal(await page.textContent('#telStyleSum2'), 'Épuré · Silencieux');
  await page.click('#telStyleRow');
  assert.deepEqual(await page.evaluate(() => [document.getElementById('tsTitle').textContent, document.getElementById('ringPanelLabel').textContent]), ['Style et son', 'Son des messages']);
  await page.click('#callstyle-glass');
  await page.click('#tsBack');
  assert.equal(await page.textContent('#telStyleSum2'), 'Verre · Silencieux');
  assert.equal(await page.evaluate(() => [_chat.style, callStyle].join()), 'glass,glass');
  await page.evaluate(() => { setCallKind('call'); setCallStyle('tonal'); setCallKind('discussion'); });
  assert.equal(await page.evaluate(() => [_chat.style, callStyle].join()), 'glass,tonal');
  assert.deepEqual(errors, []);
  await close();
});

test('écran : réception validée, textes jamais interprétés, style inconnu refusé', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => screenJoinSession(SRP.createPairing()));
  await connectFakeClients(page);
  await waitFor(page, () => mqttClient.connected);
  const remote = await fakePeer(await page.evaluate(() => _session), 'remote');
  await deliverFrame(page, await remote.seal({ type: 'chat:msg', id: 'a', from: 'contact', text: '<img src=x onerror=window.__p=1>' }));
  await deliverFrame(page, await remote.seal({ type: 'chat:msg', id: 'b', from: 'actor', text: '<b>ok</b>' }));
  await deliverFrame(page, await remote.seal({ type: 'chat:open', name: '<svg onload=window.__p=2>', style: 'glass', ids: ['a', 'b'], sent: ['a'] }));
  assert.deepEqual(await bubbles(page), ['< <img src=x onerror=window.__p=1>']);
  assert.equal(await page.evaluate(() => [window.__p, document.querySelectorAll('#screen-chat img, #screen-chat b, #screen-chat svg:not(.li)').length].join()), ',0');
  assert.equal(await page.evaluate(() => document.querySelector('#screen-chat .pt-name').textContent), '<svg onload=window.__p=2>');
  // Forgés : rejetés par le schéma
  for (const bad of [
    { type: 'chat:open', name: 'M', style: 'ios', ids: ['a'], sent: [] },
    { type: 'chat:msg', id: 'a', from: 'contact', text: 'x'.repeat(301) },
    { type: 'chat:post', id: '../a' },
  ]) {
    await deliverFrame(page, await remote.forge(bad));
    assert.equal(await page.evaluate(() => secStats.lastError), 'invalid-message', JSON.stringify(bad));
  }
  // Message de comédien posté par la « télécommande » : refusé (seul le contact se poste d'ici)
  await deliverFrame(page, await remote.seal({ type: 'chat:post', id: 'b' }));
  assert.deepEqual(await bubbles(page), ['< <img src=x onerror=window.__p=1>']);
  await deliverFrame(page, await remote.seal({ type: 'chat:close' }));
  assert.equal(await page.evaluate(() => document.getElementById('screen-chat').style.display), 'none');
  assert.deepEqual(errors, []);
  await close();
});

describe('télécommande et écran reliés', () => {
  let broker, remote, screen, rp, sp, sid;
  before(async () => {
    broker = new FakeBroker();
    remote = await openPage(browser, { broker, seed: 71, autoConnect: true });
    rp = remote.page;
    await rp.evaluate(() => { startMode('remote'); switchTab('call'); setCallKind('discussion'); });
    await connected(rp);
    screen = await openPage(browser, { broker, seed: 72, autoConnect: true, hash: await pairingHash(rp) });
    sp = screen.page;
    await connected(sp);
    await waitFor(rp, () => _pairedScreens.size === 1);
    await waitFor(rp, () => _resyncTimer === null);
    sid = await sp.evaluate(() => screenId());
    await sleep(150);
    await broker.flush();
  });
  after(async () => {
    assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
    await screen?.close(); await remote?.close();
  });

  test('messages du contact : ouverture sur la cible, indicateur « … écrit » 2 s avant la bulle', async () => {
    await rp.evaluate((sid) => scrSetTarget({ k: 'screen', id: sid }), sid);
    broker.clear();
    await chatGo(rp); // « Ouvrir sur l'écran » puis « Envoyer n° 1 » (sans indicateur)
    await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b').length === 1);
    assert.deepEqual(await bubbles(sp), ['< Tu es où ?']);
    assert.match(await rp.textContent('#dcState'), /^Discussion ouverte sur « /);
    await broker.flush();
    const sent = await broker.sent(rp);
    assert.deepEqual(sent.filter((m) => m.type.startsWith('chat:')).map((m) => m.type), ['chat:msg', 'chat:msg', 'chat:msg', 'chat:msg', 'chat:msg', 'chat:open', 'chat:open', 'chat:post']);
    assert.ok(sent.filter((m) => m.type.startsWith('chat:')).every((m) => JSON.stringify(m.target) === JSON.stringify({ screens: [sid] })), 'ciblés sur l\'écran choisi');
    assert.equal(await sp.evaluate(() => document.querySelector('#screen-chat .pt-name').textContent), 'Maman');
    // Avec l'indicateur
    await chatTyping(rp, true);
    assert.equal(await rp.textContent('#dcGoLbl'), 'ENVOYER N°2');
    await chatGo(rp);
    await waitFor(sp, () => !!document.querySelector('#screen-chat .pt-typing'));
    assert.deepEqual(await bubbles(sp), ['< Tu es où ?'], 'pas encore de bulle');
    await sleep(1500);
    assert.ok(await sp.evaluate(() => !!document.querySelector('#screen-chat .pt-typing')), 'toujours « … écrit » à 1,5 s');
    await waitFor(sp, () => !document.querySelector('#screen-chat .pt-typing'), null, { timeout: 3000 });
    assert.deepEqual(await bubbles(sp), ['< Tu es où ?', '< Ton père t\'attend depuis une heure']);
    assert.deepEqual((await rows(rp)).map((r) => r[3]), ['posté', 'posté', 'en cours', '', '']);
    assert.equal(await rp.textContent('#dcGoLbl'), 'ENVOYER N°4');
  });

  test('message du comédien : chaque touche révèle la lettre suivante, envoi actif seulement une fois complet, progression sur la télécommande', async () => {
    const text = 'je suis chez Léa, j\'arrive';
    assert.deepEqual(await compose(sp), { typed: '', send: false });
    broker.clear();
    // N'importe quelles touches : le texte prévu apparaît
    await sp.keyboard.type('qqqqqqqqqqqqqq');
    assert.deepEqual(await compose(sp), { typed: text.slice(0, 14), send: false });
    await waitFor(rp, () => /14 \/ 26 lettres/.test(document.getElementById('dcProgress').textContent));
    assert.equal(await rp.textContent('#dcProgress'), 'En frappe sur l\'écran · 14 / 26 lettres');
    // Effacement : une lettre de moins
    await sp.keyboard.press('Backspace');
    assert.equal((await compose(sp)).typed, text.slice(0, 13));
    // Entrée avant la fin : rien
    await sp.keyboard.press('Enter');
    assert.deepEqual(await bubbles(sp), ['< Tu es où ?', '< Ton père t\'attend depuis une heure']);
    await sp.locator('#screen-chat .pt-send').click({ force: true });
    assert.equal((await bubbles(sp)).length, 2, 'bouton inactif');
    // Jusqu'au bout, puis des touches en trop ne dépassent pas le texte
    await sp.keyboard.type('x'.repeat(20));
    assert.deepEqual(await compose(sp), { typed: text, send: true });
    await waitFor(rp, () => /^Prêt à envoyer sur l'écran · 26 \/ 26 lettres$/.test(document.getElementById('dcProgress').textContent));
    // Débit limité : bien moins de messages que de touches
    await broker.flush();
    const prog = await broker.sent(sp, 'chat:progress');
    assert.ok(prog.length >= 2 && prog.length <= 12, prog.length + ' chat:progress pour 35 touches');
    assert.deepEqual(prog.at(-1), { type: 'chat:progress', id: 'd3', typed: 26, total: 26 });
    assert.ok(broker.log.every((e) => !e.payload.includes('qqqq')), 'les touches tapées ne partent pas');
    // Envoyer : bulle postée, le fil avance
    await sp.locator('#screen-chat .pt-send').click();
    assert.deepEqual(await bubbles(sp), ['< Tu es où ?', '< Ton père t\'attend depuis une heure', '> ' + text]);
    assert.deepEqual(await compose(sp), { typed: '', send: false });
    await waitFor(rp, () => _chat.sent.includes('d3'));
    assert.deepEqual((await rows(rp)).map((r) => r[3]), ['posté', 'posté', 'posté', '', '']);
    assert.equal(await rp.evaluate(() => document.getElementById('dcProgress')), null, 'plus de message du comédien en cours');
    // Touches sans message prêt (le contact doit d'abord écrire) : ignorées
    await sp.keyboard.type('abc');
    assert.deepEqual(await compose(sp), { typed: '', send: false });
    await chatTyping(rp, false);
    await chatGo(rp);
    await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b').length === 4);
    await sp.keyboard.type('pardo');
    assert.equal((await compose(sp)).typed, 'pardo');
  });

  test('reprise : l\'écran rechargé retrouve le fil, les bulles et les lettres déjà tapées', async () => {
    await waitFor(rp, () => _chat.progress && _chat.progress.typed === 5);
    await sp.reload();
    await sp.evaluate(() => { if (mode !== 'screen') startMode('screen'); }); // « Écran projecteur » : dernière session
    await connected(sp);
    await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b').length === 4, null, { timeout: 8000 });
    assert.deepEqual(await bubbles(sp), ['< Tu es où ?', '< Ton père t\'attend depuis une heure', '> je suis chez Léa, j\'arrive', '< Je t\'ai vue avec lui. On en parlera ce soir.']);
    assert.deepEqual(await compose(sp), { typed: 'pardo', send: false });
    await sp.keyboard.type('n maman');
    await sp.keyboard.press('Enter');
    await waitFor(rp, () => _chat.sent.includes('d5'));
    assert.equal(await rp.textContent('#dcGoLbl'), 'Plus de message');
  });

  test('« Écrire… » : message improvisé du contact, inséré dans le fil ; modifications suivies ; Repartir de zéro, Fermer', async () => {
    await rp.click('#dcWriteBtn');
    await rp.fill('#dcWriteText', 'Tu m\'entends ?');
    await rp.click('.dc-write-send');
    await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b').length === 6);
    assert.equal((await bubbles(sp)).at(-1), '< Tu m\'entends ?');
    assert.deepEqual((await rows(rp)).at(-1), ['6', 'Maman ›', 'Tu m\'entends ?', 'posté']);
    // Modification d'un message posté : suivie sur l'écran
    await rp.locator('#dcRows .dc-row').nth(0).click();
    await rp.fill('#dcRows .dc-edit textarea', 'T\'es où ?');
    await waitFor(sp, () => document.querySelector('#screen-chat .pt-b').textContent === 'T\'es où ?');
    await rp.locator('#dcRows .dc-edit .dc-edit-ok').click();
    // « Repartir de zéro » : plus rien de posté
    await chatThreadMenu(rp, 'Repartir de zéro');
    await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b').length === 0);
    assert.equal(await rp.textContent('#dcGoLbl'), 'ENVOYER N°1');
    // Fermer
    await chatThreadMenu(rp, 'Fermer sur l\'écran');
    await waitFor(sp, () => document.getElementById('screen-chat').style.display === 'none');
    assert.equal(await rp.textContent('#dcState'), 'Discussion fermée');
  });
});

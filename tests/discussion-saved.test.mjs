// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Discussions enregistrées (onglet Tel, maquettes 26c puis 4d) : liste sous le fil
// (▶ charge), enregistrer par le signet de la barre (nom demandé),
// charger (confirmation de l'app si le fil a des modifications non
// enregistrées), renommer, dupliquer, supprimer (bandeau « Annuler ») ; photo du
// contact gardée (IndexedDB) ; persistance au rechargement, validation au
// chargement, plafond ; point de reprise non enregistré ; jamais sur la console DMX.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash, chatGo } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const disc = (page) => page.evaluate(() => { startMode('remote'); switchTab('call'); setCallKind('discussion'); });
const shown = (page, id) => page.evaluate((id) => getComputedStyle(document.getElementById(id)).display !== 'none', id);
const savedRows = (page) => page.evaluate(() => [...document.querySelectorAll('#dcSavedRows .dc-saved-row')].map((r) => [
  r.querySelector('.dc-saved-name').textContent, r.querySelector('.dc-saved-meta').textContent, r.classList.contains('selected') ? 'chargée' : '',
]));
const threadTexts = (page) => page.evaluate(() => _chat.msgs.map((m) => m.text));
const avatar = (page) => page.evaluate(() => _chatAvatar);
async function pngFile(page, color) {
  const b64 = await page.evaluate((c) => { const k = document.createElement('canvas'); k.width = 300; k.height = 200; const g = k.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 300, 200); return k.toDataURL('image/png').split(',')[1]; }, color);
  return { name: 'contact.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') };
}
// Feuille de nom : saisie puis « Enregistrer »
async function nameSheet(page, title, name) {
  await waitFor(page, () => document.getElementById('sr-sheet').classList.contains('open'));
  assert.equal(await page.textContent('#srSheetTitle'), title);
  await page.fill('#srName', name);
  await page.click('#srSheetBody .sr-ok');
  await waitFor(page, () => !document.getElementById('sr-sheet').classList.contains('open'));
}
async function menu(page, i, action) {
  await page.locator('#dcSavedRows .dc-saved-row .dc-saved-more').nth(i).click();
  await waitFor(page, () => document.getElementById('sr-sheet').classList.contains('open'));
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#srSheetBody .dc-menu-btn')].map((b) => b.textContent)), ['Renommer', 'Dupliquer', 'Supprimer']);
  await page.locator('#srSheetBody .dc-menu-btn', { hasText: action }).click();
}
const idbPhoto = (page, id) => page.evaluate((id) => { _clAssetMem.clear(); return callAssetGet('chat-' + id + ':photo'); }, id);

test('enregistrer, charger, renommer, dupliquer, supprimer ; photo gardée ; confirmation ; rechargement', async () => {
  const { page, errors, close } = await openPage(browser);
  await disc(page);
  // Plus de sous-onglets : le fil à jouer, puis la liste (vide) des discussions enregistrées
  assert.equal(await page.evaluate(() => !!document.getElementById('dcTabs') || !!document.getElementById('dcSaveBtn')), false);
  for (const id of ['dcContactPanel', 'dcThreadPanel', 'dcSavedPanel', 'telStyleRow']) assert.equal(await shown(page, id), true, id);
  assert.equal(await shown(page, 'dcSavedEmpty'), true);
  assert.equal(await page.textContent('#dcSavedTitle'), 'Discussions enregistrées · 0');
  // 1. Fil d'exemple, sans photo
  const unexpected = [];
  const noDialog = (d) => { unexpected.push(d.message()); d.dismiss(); };
  page.on('dialog', noDialog);
  await page.click('#dcMemSave');
  await nameSheet(page, 'Enregistrer le fil en cours', 'Séq. 12 — Maman inquiète');
  assert.deepEqual(await savedRows(page), [['Séq. 12 — Maman inquiète', 'Maman ‹› Julie · 5 messages · Épuré', 'chargée']]);
  assert.equal(await page.textContent('#dcSavedTitle'), 'Discussions enregistrées · 1');
  assert.equal(await shown(page, 'dcSavedEmpty'), false);
  // 2. Autre contact, photo, style, un message de plus, une reprise (non enregistrée)
  await page.setInputFiles('#dcAvatarInput', await pngFile(page, '#2a7ad5'));
  await waitFor(page, () => !!_chatAvatar);
  const photo = await avatar(page);
  await page.fill('#dcName', 'Thomas');
  // Style dans la vue « Style et son » (maquette 36d)
  await page.click('#telStyleRow');
  await page.click('#callstyle-glass');
  await page.click('#tsBack');
  await page.click('#dcAdd');
  await page.fill('#dcRows .dc-edit textarea', 'C\'est fini.');
  await page.locator('#dcRows .dc-edit .dc-edit-ok').click();
  await page.evaluate(() => resumeChatAt('d3'));
  assert.equal(await page.evaluate(() => chatHasUnsavedChanges()), true);
  await page.click('#dcMemSave');
  assert.equal(await page.getAttribute('#srName', 'placeholder'), 'Thomas ‹› Julie');
  await nameSheet(page, 'Enregistrer le fil en cours', 'Séq. 14 — Rupture');
  assert.deepEqual(await savedRows(page), [['Séq. 12 — Maman inquiète', 'Maman ‹› Julie · 5 messages · Épuré', ''], ['Séq. 14 — Rupture', 'Thomas ‹› Julie · 6 messages · Verre', 'chargée']]);
  const [idA, idB] = await page.evaluate(() => chatSaved.map((e) => e.id));
  assert.equal(await idbPhoto(page, idB), photo, 'photo rangée dans IndexedDB');
  assert.deepEqual(await page.evaluate(() => Object.keys(chatSaved[1]).sort()), ['actor', 'contact', 'hasPhoto', 'id', 'msgs', 'name', 'photoSig', 'style'], 'ni point de reprise ni messages postés');
  // Charger la 1re (fil enregistré, pas de confirmation) : contact, style, messages ; plus de photo
  await page.locator('#dcSavedRows .dc-saved-row').nth(0).click();
  await waitFor(page, () => _chat.savedId === chatSaved[0].id);
  assert.equal(await shown(page, 'dcThreadPanel'), true, 'retour au fil en cours');
  assert.deepEqual(await page.evaluate(() => [_chat.name, _chat.actor, _chat.style, document.getElementById('dcName').value, _chat.sent.length, _chat.resumeAt]), ['Maman', 'Julie', 'minimal', 'Maman', 0, null]);
  assert.equal((await threadTexts(page)).length, 5);
  assert.equal(await avatar(page), null);
  assert.equal(await page.evaluate(() => document.getElementById('dcAvatar').textContent), 'M');
  // Charger la 2e (▶) : photo retrouvée, point de reprise NON restauré
  await page.locator('#dcSavedRows .dc-saved-row').nth(1).locator('.cl-play').click();
  await waitFor(page, () => _chat.savedId === chatSaved[1].id);
  assert.equal(await avatar(page), photo);
  assert.match(await page.evaluate(() => document.getElementById('dcAvatar').style.backgroundImage), /^url\("data:image\/jpeg;base64,/);
  assert.deepEqual(await page.evaluate(() => [_chat.name, _chat.style, _chat.msgs.length, _chat.sent.length, document.getElementById('dcResume')]), ['Thomas', 'glass', 6, 0, null]);
  // Modification non enregistrée : confirmation avant de charger une autre discussion
  await page.fill('#dcActor', 'Léo');
  assert.deepEqual(unexpected, [], 'aucune boîte du navigateur : la confirmation est celle de l\'app');
  await page.locator('#dcSavedRows .dc-saved-row').nth(0).click();
  assert.equal(await page.textContent('#acTitle'), 'Charger « Séq. 12 — Maman inquiète » ?');
  assert.equal(await page.textContent('#acText'), 'Le fil en cours a des modifications non enregistrées : elles seront perdues.');
  await page.click('#acCancel');
  await sleep(100);
  assert.deepEqual(await page.evaluate(() => [_chat.name, _chat.actor, _chat.savedId === chatSaved[1].id]), ['Thomas', 'Léo', true], 'refusé : rien ne change');
  await page.locator('#dcSavedRows .dc-saved-row').nth(0).locator('.cl-play').click();
  await page.click('#acOk');
  await waitFor(page, () => _chat.savedId === chatSaved[0].id);
  assert.deepEqual(unexpected, []);
  assert.deepEqual(await page.evaluate(() => [_chat.name, _chat.actor]), ['Maman', 'Julie']);
  // Renommer
  await menu(page, 1, 'Renommer');
  assert.equal(await page.inputValue('#srName'), 'Séq. 14 — Rupture');
  await nameSheet(page, 'Renommer la discussion', 'Séq. 14 — Rupture (v2)');
  assert.equal((await savedRows(page))[1][0], 'Séq. 14 — Rupture (v2)');
  // Dupliquer : copie juste après, photo comprise
  await menu(page, 0, 'Dupliquer');
  await waitFor(page, () => chatSaved.length === 3);
  await menu(page, 2, 'Dupliquer');
  await waitFor(page, () => chatSaved.length === 4);
  assert.deepEqual((await savedRows(page)).map((r) => r[0]), ['Séq. 12 — Maman inquiète', 'Séq. 12 — Maman inquiète (copie)', 'Séq. 14 — Rupture (v2)', 'Séq. 14 — Rupture (v2) (copie)']);
  const idD = await page.evaluate(() => chatSaved[3].id);
  assert.equal(await idbPhoto(page, idD), photo, 'photo copiée');
  // Supprimer : aucune confirmation, bandeau « Annuler » ; photo gardée tant que l'annulation est possible
  await menu(page, 3, 'Supprimer');
  assert.equal(await page.evaluate(() => chatSaved.length), 3);
  assert.equal(await page.textContent('#usText'), '« Séq. 14 — Rupture (v2) (copie) » supprimée');
  assert.equal(await idbPhoto(page, idD), photo, 'photo gardée pendant le bandeau');
  await page.click('#usUndo');
  assert.deepEqual((await savedRows(page)).map((r) => r[0]).slice(2), ['Séq. 14 — Rupture (v2)', 'Séq. 14 — Rupture (v2) (copie)'], 'remise à son rang');
  await menu(page, 3, 'Supprimer');
  await page.evaluate(() => _usFlush());
  assert.equal(await page.evaluate(() => chatSaved.length), 3);
  assert.equal(await idbPhoto(page, idD), null, 'photo supprimée à l\'échéance');
  assert.deepEqual(unexpected, [], 'plus de confirm()');
  // Rechargement de la télécommande : liste, entrée chargée et photo (relue d'IndexedDB) retrouvées
  await page.reload();
  await disc(page);
  assert.deepEqual(await savedRows(page), [
    ['Séq. 12 — Maman inquiète', 'Maman ‹› Julie · 5 messages · Épuré', 'chargée'], ['Séq. 12 — Maman inquiète (copie)', 'Maman ‹› Julie · 5 messages · Épuré', ''],
    ['Séq. 14 — Rupture (v2)', 'Thomas ‹› Julie · 6 messages · Verre', ''],
  ]);
  assert.equal(await page.textContent('#dcSavedTitle'), 'Discussions enregistrées · 3');
  await page.locator('#dcSavedRows .dc-saved-row').nth(2).click();
  await waitFor(page, () => !!_chatAvatar);
  assert.equal(await avatar(page), photo);
  assert.deepEqual(await page.evaluate((ids) => chatSaved.map((e) => e.id).filter((x) => ids.includes(x)).length, [idA, idB]), 2);
  // Déjà chargée, sans modification : retour au fil sans rien recharger (la scène en cours est gardée)
  await page.evaluate(() => sendNextChatMessage());
  await page.locator('#dcSavedRows .dc-saved-row').nth(2).click();
  assert.deepEqual(await page.evaluate(() => [_chatView, _chat.sent.length]), ['thread', 1]);
  // La console DMX n'en voit aucune (les canaux Appel / SMS ne visent que la liste des appels)
  assert.deepEqual(await page.evaluate(() => [callList.call.length, callList.sms.length, callList.notif.length]), [0, 0, 0]);
  assert.deepEqual(errors, []);
  await close();
});

test('chargement : entrées revalidées, textes jamais interprétés, plafond de 100', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => {
    const ok = (i) => ({ id: 'c' + i, name: 'Séq. ' + i, contact: 'Maman', actor: 'Julie', style: 'tonal', msgs: [{ id: 'd1', from: 'contact', text: 'Tu es où ?' }], hasPhoto: false });
    const list = [
      { id: '<img src=x onerror=window.__p=1>', name: 'x', msgs: [] },
      { id: 'bad1', name: 'pas de messages' },
      { id: 'xss', name: '<b onclick=window.__p=2>Nom</b>', contact: '<i>C</i>', actor: 7, style: 'ios', hasPhoto: true, photoSig: '../../x',
        msgs: [{ id: 'd1', from: 'contact', text: 'a' }, { id: 'd1', from: 'actor', text: 'doublon' }, { id: '../x', from: 'contact', text: 'b' },
          { id: 'd2', from: 'screen', text: 'c' }, { id: 'd3', from: 'actor', text: '   ' }, { id: 'd4', from: 'actor', text: 'y'.repeat(400) }, 'zz', null] },
      { id: 'xss', name: 'id en double', msgs: [] },
    ];
    for (let i = 0; i < 150; i++) list.push(ok(i));
    localStorage.setItem('setremote-chat-saved-v1', JSON.stringify({ v: 1, list }));
  });
  await page.reload();
  await disc(page);
  const r = await page.evaluate(() => ({ n: chatSaved.length, first: chatSaved[0], last: chatSaved.at(-1).id }));
  assert.equal(r.n, 100, 'plafond');
  assert.deepEqual(r.first, {
    id: 'xss', name: '<b onclick=window.__p=2>Nom</b>', contact: '<i>C</i>', actor: '', style: 'minimal', hasPhoto: false, photoSig: null,
    // Enregistrée avant les timings (maquette 26d) : valeurs par défaut, comportement inchangé
    msgs: [{ id: 'd1', from: 'contact', text: 'a', pause: 0, write: 2, auto: false, send: 'button' },
      { id: 'd4', from: 'actor', text: 'y'.repeat(300), pause: 0, write: 3, auto: false, send: 'button' }],
  });
  assert.equal(r.last, 'c98');
  assert.equal(await page.evaluate(() => [window.__p, document.querySelectorAll('#dcSavedRows b, #dcSavedRows i, #dcSavedRows img').length].join()), ',0');
  assert.equal((await savedRows(page))[0][0], '<b onclick=window.__p=2>Nom</b>');
  assert.equal(await page.textContent('#dcSavedTitle'), 'Discussions enregistrées · 100');
  // Liste pleine : enregistrement et duplication indisponibles
  assert.equal(await page.evaluate(() => { openSaveChatSheet(); return !!_sheet; }), false, 'feuille d\'enregistrement refusée');
  assert.equal(await page.evaluate(async () => [await saveCurrentChat('x'), await duplicateSavedChat('c0'), chatSaved.length].join()), ',,100');
  // Le menu « ⋯ » ne propose plus « Dupliquer »
  await page.locator('#dcSavedRows .dc-saved-row .dc-saved-more').nth(0).click();
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#srSheetBody .dc-menu-btn')].map((b) => b.textContent)), ['Renommer', 'Supprimer']);
  // Stockage illisible : liste vide, sans erreur
  await page.evaluate(() => localStorage.setItem('setremote-chat-saved-v1', '{pas du json'));
  await page.reload();
  await disc(page);
  assert.equal(await page.evaluate(() => chatSaved.length), 0);
  assert.deepEqual(errors, []);
  await close();
});

describe('discussion ouverte sur un écran', () => {
  let broker, remote, screen, rp, sp;
  before(async () => {
    broker = new FakeBroker();
    remote = await openPage(browser, { broker, seed: 91, autoConnect: true });
    rp = remote.page;
    await disc(rp);
    await waitFor(rp, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
    screen = await openPage(browser, { broker, seed: 92, autoConnect: true, hash: await pairingHash(rp) });
    sp = screen.page;
    await waitFor(sp, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
    await waitFor(rp, () => _pairedScreens.size === 1);
    await waitFor(rp, () => _resyncTimer === null);
    await sleep(150);
    await broker.flush();
  });
  after(async () => {
    assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
    await screen?.close(); await remote?.close();
  });

  test('charger une discussion : l\'écran repart de zéro avec le nouveau contact, sa photo et son style', async () => {
    // Discussion en cours (2 messages affichés, reprise au n° 3)
    await rp.evaluate(() => resumeChatAt('d3'));
    await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b').length === 2);
    // Discussion enregistrée avec une photo, chargée par la liste
    await rp.evaluate(async () => {
      const k = document.createElement('canvas'); k.width = k.height = 160;
      const g = k.getContext('2d'); g.fillStyle = '#aa3300'; g.fillRect(0, 0, 160, 160);
      const photo = k.toDataURL('image/jpeg', 0.8);
      chatSaved.push({ id: 'cSeq21', name: 'Séq. 21 — Agence', contact: 'Agence Riviera', actor: 'Marc', style: 'tonal', hasPhoto: true, photoSig: _chsvPhotoSig(photo),
        msgs: [{ id: 'a1', from: 'contact', text: 'Votre dossier est prêt.' }, { id: 'a2', from: 'actor', text: 'Merci' }] });
      _chsvPersist();
      await callAssetPut('chat-cSeq21:photo', photo);
      setChatView('saved');
    });
    assert.equal(await rp.evaluate(() => chatHasUnsavedChanges()), false, 'fil d\'exemple : rien à perdre');
    await rp.locator('#dcSavedRows .dc-saved-row').nth(0).click();
    await waitFor(sp, () => !!_scChat && _scChat.name === 'Agence Riviera' && _scChat.hasAvatar);
    await waitFor(sp, () => !!document.querySelector('#screen-chat .pt-av').style.backgroundImage);
    assert.deepEqual(await sp.evaluate(() => [document.querySelectorAll('#screen-chat .pt-b').length, document.querySelector('#screen-chat .pt').className, document.querySelector('#screen-chat .pt-name').textContent]),
      [0, 'ph ph-tonal pt pt-instant', 'Agence Riviera']);
    assert.equal(await rp.textContent('#dcGoLbl'), 'ENVOYER N°1');
    await chatGo(rp);
    await waitFor(sp, () => document.querySelectorAll('#screen-chat .pt-b').length === 1);
    await sp.keyboard.type('Merci');
    await sp.keyboard.press('Enter');
    await waitFor(rp, () => _chat.sent.includes('a2'));
    assert.deepEqual(await sp.evaluate(() => [...document.querySelectorAll('#screen-chat .pt-b')].map((b) => b.textContent)), ['Votre dossier est prêt.', 'Merci']);
  });
});

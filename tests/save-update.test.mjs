// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// « + Enregistrer » / « ↻ Mettre à jour » (même composant que les Effets) au-dessus des listes enregistrées de
// Tel (Appels, SMS, Notifications), des Discussions et des Séquences : états des boutons, mise à jour directe
// sans feuille, bandeau « « nom » mis à jour · Annuler » qui restitue l'entrée d'avant (photo et bande son
// comprises) ; plus de signet dans la barre d'action ; plus de note sous la liste des discussions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const remote = async (tab = 'call') => {
  const p = await openPage(browser);
  await p.page.evaluate((tab) => { startMode('remote'); switchTab(tab); setCallRing('silent'); }, tab);
  return p;
};
const state = (page, ids) => page.evaluate((ids) => ids.map((id) => { const b = document.getElementById(id); return b ? [b.disabled, getComputedStyle(b).display !== 'none'] : null; }), ids);
const snack = (page) => page.evaluate(() => { const b = document.getElementById('undo-snack'); return getComputedStyle(b).display === 'none' ? null : document.getElementById('usText').textContent; });
const png = (page, color) => page.evaluate((c) => { const cv = document.createElement('canvas'); cv.width = cv.height = 8; const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 8, 8); return cv.toDataURL('image/png'); }, color);

// Composant : le même que les Effets
test('rangées « + Enregistrer / ↻ Mettre à jour » : composant des Effets, au-dessus de chaque liste, bouton de mise à jour grisé par défaut', async () => {
  const { page, errors, close } = await remote();
  const fx = await page.evaluate(() => { const a = document.querySelector('#content-effects .memory-actions, #content-light .memory-actions') || document.querySelector('.memory-actions'); return [...a.children].map((b) => b.className); });
  assert.deepEqual(fx, ['memory-save-btn', 'memory-update-btn']);
  for (const [box, save, upd] of [['clMemActions', 'clMemSave', 'clMemUpdate'], ['dcMemActions', 'dcMemSave', 'dcMemUpdate'], ['seqMemActions', 'seqMemSave', 'seqMemUpdate']]) {
    assert.deepEqual(await page.evaluate((box) => [...document.getElementById(box).children].map((b) => b.className), box), ['memory-save-btn', 'memory-update-btn'], box);
    assert.equal(await page.evaluate((box) => document.getElementById(box).className, box), 'memory-actions');
    assert.deepEqual(await page.evaluate(([s, u]) => [document.getElementById(s).textContent.trim(), document.getElementById(u).textContent.trim(), document.querySelector('#' + s + ' use').getAttribute('href'), document.querySelector('#' + u + ' use').getAttribute('href')], [save, upd]),
      ['Enregistrer', 'Mettre à jour', '#i-plus', '#i-refresh-cw'], box);
  }
  // Au-dessus de la liste (entre le titre et la carte) : appels, discussions
  assert.equal(await page.evaluate(() => { const t = document.querySelector('#callListPanel .tl-h'); return t.nextElementSibling.id; }), 'clMemActions');
  assert.equal(await page.evaluate(() => { const t = document.querySelector('#dcSavedPanel .tl-h'); return t.nextElementSibling.id; }), 'dcMemActions');
  // Séquence : sous la carte de la séquence, au-dessus de « Nouvelle séquence »
  assert.equal(await page.evaluate(() => document.getElementById('seqMemActions').nextElementSibling.id), 'seqNewBtn');
  // Tous grisés au départ (rien de chargé)
  assert.deepEqual((await state(page, ['clMemUpdate', 'dcMemUpdate', 'seqMemUpdate'])).map((s) => s[0]), [true, true, true]);
  // Plus de signet dans la barre d'action, quel que soit le type
  for (const k of ['call', 'sms', 'notif', 'discussion']) {
    await page.evaluate((k) => setCallKind(k), k);
    assert.equal(await page.evaluate(() => !!document.getElementById('telSaveBtn') || !!document.querySelector('#tel-bar use[href="#i-bookmark"]')), false, k);
    assert.equal(await page.evaluate(() => typeof telBarSave), 'undefined');
  }
  assert.deepEqual(errors, []);
  await close();
});

// Tel : Appels, SMS, Notifications
const KINDS = {
  call: { field: 'callName', make: (v) => `document.getElementById('callName').value = ${JSON.stringify(v)}; renderCallerState();`, read: (e) => e.name },
  sms: { field: 'callMsgText', make: (v) => `document.getElementById('callMsgText').value = ${JSON.stringify(v)};`, read: (e) => e.msg },
  notif: { field: 'ntTitle', make: (v) => `document.getElementById('ntTitle').value = ${JSON.stringify(v)}; renderNotifForm();`, read: (e) => e.name },
};
for (const [kind, K] of Object.entries(KINDS)) {
  test(`Tel › ${kind} : « Enregistrer » ouvre la feuille du nom ; « Mettre à jour » grisé sans entrée chargée, direct avec bandeau « Annuler » quand elle l'est`, async () => {
    const { page, errors, close } = await remote();
    await page.evaluate((k) => setCallKind(k), kind);
    const set = (v) => page.evaluate(`(() => { ${K.make(v)} })()`);
    const row = () => page.evaluate((k) => callList[k].map((e) => [e.id, e.title || '', e.name, e.msg, e.hasPhoto, e.hasAudio]), kind);
    // Enregistrer : feuille du nom
    await set('Premier');
    assert.equal(await page.evaluate(() => document.getElementById('clMemSave').disabled), false);
    await page.click('#clMemSave');
    assert.equal(await page.evaluate(() => !!_sheet && _sheet.kind), 'callName');
    await page.fill('#srName', 'Mon enregistrement');
    await page.click('#sr-sheet .sr-ok');
    await waitFor(page, (k) => callList[k].length === 1, kind);
    // Enregistrée comme nouvelle : rien de chargé, mise à jour grisée
    assert.equal(await page.evaluate(() => document.getElementById('clMemUpdate').disabled), true);
    assert.equal(await page.evaluate(() => !!_sheet), false);
    // Deuxième entrée, puis toucher la première : chargée → « Mettre à jour » actif
    await set('Second');
    await page.click('#clMemSave');
    await page.click('#sr-sheet .sr-ok');
    await waitFor(page, (k) => callList[k].length === 2, kind);
    const [id1, id2] = (await row()).map((r) => r[0]);
    await page.evaluate((id) => selectCallEntry(id), id1);
    await waitFor(page, () => !document.getElementById('clMemUpdate').disabled);
    // Mise à jour : sans feuille, même id, même nom propre, même rang ; bandeau
    await set('Premier modifié');
    await page.click('#clMemUpdate');
    assert.equal(await page.evaluate(() => !!_sheet), false, 'aucune feuille');
    assert.equal(await snack(page), '« Mon enregistrement » mis à jour');
    const after = await row();
    assert.deepEqual(after.map((r) => r[0]), [id1, id2], 'même ordre');
    assert.equal(after[0][1], 'Mon enregistrement', 'nom propre gardé');
    assert.equal(await page.evaluate(([k, id]) => callList[k].find((e) => e.id === id) && 1, [kind, id1]), 1);
    assert.equal(K.read(await page.evaluate(([k, id]) => callList[k].find((e) => e.id === id), [kind, id1])), 'Premier modifié');
    assert.equal(K.read(await page.evaluate(([k, id]) => callList[k].find((e) => e.id === id), [kind, id2])), 'Second', 'les autres entrées ne bougent pas');
    // Toujours chargée : on peut remettre à jour
    assert.equal(await page.evaluate(() => document.getElementById('clMemUpdate').disabled), false);
    // Annuler : l'entrée d'avant revient
    await page.click('#usUndo');
    assert.equal(K.read(await page.evaluate(([k, id]) => callList[k].find((e) => e.id === id), [kind, id1])), 'Premier');
    assert.equal(await snack(page), null);
    assert.deepEqual(errors, []);
    await close();
  });
}

test('Tel › appel : l\'annulation restitue aussi la photo et la bande son d\'avant ; la mise à jour range celles du formulaire', async () => {
  const { page, errors, close } = await remote();
  const red = await png(page, '#ff0000'), blue = await png(page, '#0000ff');
  const wavA = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=', wavB = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAACJWAAABAAgAZGF0YQAAAAA=';
  await page.evaluate(([red, wavA]) => { _callPhoto = red; _callAudioData = wavA; _callAudioName = 'A.wav'; document.getElementById('callName').value = 'Maman'; }, [red, wavA]);
  const id = await page.evaluate(() => saveCurrentCall('Avec médias'));
  await page.evaluate((id) => selectCallEntry(id), id);
  await waitFor(page, ([id, red]) => callAssetGet(id + ':photo').then((v) => v === red), [id, red]);
  await waitFor(page, () => !document.getElementById('clMemUpdate').disabled);
  await page.evaluate(([blue, wavB]) => { _callPhoto = blue; _callAudioData = wavB; _callAudioName = 'B.wav'; }, [blue, wavB]);
  await page.click('#clMemUpdate');
  await waitFor(page, ([id, blue]) => callAssetGet(id + ':photo').then((v) => v === blue), [id, blue]);
  assert.equal(await page.evaluate((id) => callAssetGet(id + ':audio'), id), wavB);
  await page.click('#usUndo');
  await waitFor(page, ([id, red]) => callAssetGet(id + ':photo').then((v) => v === red), [id, red]);
  assert.equal(await page.evaluate((id) => callAssetGet(id + ':audio'), id), wavA);
  // Mise à jour qui retire la photo, annulée : la photo revient
  await page.evaluate(() => { _callPhoto = null; });
  await page.click('#clMemUpdate');
  await waitFor(page, (id) => callAssetGet(id + ':photo').then((v) => !v), id);
  await page.click('#usUndo');
  await waitFor(page, ([id, red]) => callAssetGet(id + ':photo').then((v) => v === red), [id, red]);
  assert.equal(await page.evaluate((id) => callList.call[0].hasPhoto && callList.call[0].hasAudio, id), true);
  assert.deepEqual(errors, []);
  await close();
});

// Discussions
test('Discussions : « Mettre à jour » grisé hors entrée, direct avec bandeau « Annuler » (contact, photo, style, messages) ; note sous la liste retirée', async () => {
  const { page, errors, close } = await remote();
  await page.evaluate(() => setCallKind('discussion'));
  // La note explicative sous la liste n'existe plus
  assert.equal(await page.evaluate(() => !!document.getElementById('dcSavedNote') || !!document.querySelector('#dcSavedPanel .cl-note')), false);
  assert.equal(await page.evaluate(() => /point de reprise/.test(document.getElementById('dcSavedPanel').textContent)), false);
  assert.equal(await page.evaluate(() => document.getElementById('dcMemUpdate').disabled), true);
  const red = await png(page, '#ff0000'), blue = await png(page, '#0000ff');
  await page.evaluate((red) => { _chatAvatar = red; chatSave(); }, red);
  // Enregistrer : feuille du nom
  await page.click('#dcMemSave');
  assert.equal(await page.evaluate(() => _sheet.kind), 'chatName');
  await page.fill('#srName', 'Séq. 12');
  await page.click('#sr-sheet .sr-ok');
  await waitFor(page, () => chatSaved.length === 1);
  const id = await page.evaluate(() => chatSaved[0].id);
  // Entrée enregistrée = fil chargé : mise à jour possible
  assert.equal(await page.evaluate(() => document.getElementById('dcMemUpdate').disabled), false);
  const before = await page.evaluate(() => JSON.stringify(chatSaved[0]));
  // Modifier le fil : autre contact, un message de plus, autre photo, autre style
  await page.evaluate((blue) => { _chat.name = 'Thomas'; _chat.style = 'glass'; _chat.msgs.push({ id: 'dz9', from: 'contact', text: 'Nouveau message' }); _chatAvatar = blue; chatSave(); renderSavedChats(); }, blue);
  await page.click('#dcMemUpdate');
  assert.equal(await page.evaluate(() => !!_sheet), false, 'aucune feuille');
  assert.equal(await snack(page), '« Séq. 12 » mis à jour');
  const e = await page.evaluate(() => chatSaved[0]);
  assert.deepEqual([e.id, e.name, e.contact, e.style, e.msgs.some((m) => m.id === 'dz9'), e.hasPhoto], [id, 'Séq. 12', 'Thomas', 'glass', true, true]);
  assert.equal(await page.evaluate((id) => callAssetGet('chat-' + id + ':photo'), id), blue);
  assert.equal(await page.evaluate(() => chatSaved.length), 1);
  // Annuler : tout revient (entrée et photo)
  await page.click('#usUndo');
  await waitFor(page, ([id, red]) => callAssetGet('chat-' + id + ':photo').then((v) => v === red), [id, red]);
  assert.equal(await page.evaluate(() => JSON.stringify(chatSaved[0])), before);
  // Nouvelle discussion : plus d'entrée liée → grisé
  await page.evaluate(() => chatNew({ discard: true }));
  await waitFor(page, () => document.getElementById('dcMemUpdate').disabled);
  assert.deepEqual(errors, []);
  await close();
});

// Séquences
const step = (id, kind, ref) => ({ id, kind, ref, target: { k: 'all' }, trig: { k: 'go' }, opt: {} });
test('Séquences : « Mettre à jour » grisé hors entrée, direct avec bandeau « Annuler » (étapes, téléphone au départ)', async () => {
  const { page, errors, close } = await remote('seq');
  assert.equal(await page.evaluate(() => document.getElementById('seqMemUpdate').disabled), true);
  await page.evaluate((s) => { _seq.steps = [s]; seqSave(); renderSeq(); }, step('s1', 'color', 'col1'));
  assert.equal(await page.evaluate(() => document.getElementById('seqMemUpdate').disabled), true, 'séquence en cours non enregistrée');
  await page.click('#seqMemSave');
  assert.equal(await page.evaluate(() => _sheet.kind), 'seqName');
  await page.fill('#srName', 'Scène 12');
  await page.click('#sr-sheet .sr-ok');
  await waitFor(page, () => seqSaved.length === 1);
  assert.equal(await page.evaluate(() => document.getElementById('seqMemUpdate').disabled), false);
  const before = await page.evaluate(() => JSON.stringify(seqSaved[0]));
  const id = await page.evaluate(() => seqSaved[0].id);
  await page.evaluate((s) => { _seq.steps.push(s); const p = seqPhoneCfg(); _seq.phone = Object.assign({}, _seq.phone, { net: { kind: 'wifi' } }); seqSave(); renderSeq(); void p; }, step('s2', 'sms', 'eS1'));
  assert.equal(await page.evaluate(() => seqHasUnsavedChanges()), true);
  await page.click('#seqMemUpdate');
  assert.equal(await page.evaluate(() => !!_sheet), false, 'aucune feuille');
  assert.equal(await snack(page), '« Scène 12 » mis à jour');
  assert.deepEqual(await page.evaluate(() => [seqSaved.length, seqSaved[0].id, seqSaved[0].name, seqSaved[0].steps.map((s) => s.id)]), [1, id, 'Scène 12', ['s1', 's2']]);
  assert.equal(await page.evaluate(() => seqHasUnsavedChanges()), false, 'plus de modification en attente');
  // Annuler : l'entrée d'avant
  await page.click('#usUndo');
  assert.equal(await page.evaluate(() => JSON.stringify(seqSaved[0])), before);
  assert.equal(await page.evaluate(() => _seq.steps.length), 2, 'la séquence en cours n\'est pas touchée');
  // Nouvelle séquence : plus d'entrée liée → grisé
  await page.evaluate(() => seqNew({ discard: true }));
  await waitFor(page, () => document.getElementById('seqMemUpdate').disabled);
  assert.deepEqual(errors, []);
  await close();
});

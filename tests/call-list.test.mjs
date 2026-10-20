// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Onglet Appel : appels et SMS enregistrés, numérotés (maquette 18). Les 20
// premiers de chaque liste sont les cibles des canaux Appel / SMS de la
// passerelle DMX.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, FakeBroker, pairingHash } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
const rows = (page) => page.evaluate(() => [...document.querySelectorAll('#callListRows .cl-row')].map((r) => ({
  n: r.querySelector('.cl-num').textContent, name: r.querySelector('.cl-name').textContent,
  meta: r.querySelector('.cl-meta').textContent, dmx: r.querySelector('.cl-dmx').textContent, sel: r.classList.contains('selected'),
})));
// Réglages du formulaire puis « + Enregistrer l'appel actuel »
const save = (page, f) => page.evaluate(async (f) => {
  if (f.kind) setCallKind(f.kind);
  if (f.style) setCallStyle(f.style);
  document.getElementById('callName').value = f.name;
  document.getElementById('callLabel').value = f.label || '';
  if (f.msg != null) document.getElementById('callMsgText').value = f.msg;
  document.getElementById('callAutoSlider').value = String(f.auto || 0); onCallAutoChange();
  if (f.lock != null) document.getElementById('lockToggle').checked = f.lock;
  if (f.photo) {
    const c = document.createElement('canvas'); c.width = 8; c.height = 8;
    const g = c.getContext('2d'); g.fillStyle = f.photo; g.fillRect(0, 0, 8, 8);
    _callPhoto = c.toDataURL('image/jpeg', 0.7);
  } else _callPhoto = null;
  return saveCurrentCall();
}, f);

test('enregistrer, numéroter (plages DMX), recharger dans le formulaire, persister (photos en IndexedDB)', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('call'); setCallRing('silent'); });
  assert.equal(await page.textContent('#callListGo'), 'Appeler n°1');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('callListActions')).display), 'none', 'liste vide : rien à appeler');
  await save(page, { name: 'Maman', style: 'glass', photo: '#ff0000' });
  await save(page, { name: 'Agence immobilière', style: 'tonal', auto: 8 });
  await save(page, { name: 'Numéro masqué', style: 'minimal' });
  for (let i = 4; i <= 21; i++) await save(page, { name: 'Appel ' + i, style: 'glass' });
  await save(page, { kind: 'sms', name: 'Léa', msg: 'Tu es où ??', lock: true });
  assert.equal(await page.textContent('#clKind-call'), 'Appels (21)');
  assert.equal(await page.textContent('#clKind-sms'), 'SMS (1)');
  assert.equal(await page.textContent('#callListWho'), 'Expéditeur', 'onglet SMS après un enregistrement de SMS');
  assert.deepEqual((await rows(page))[0], { n: '1', name: 'Léa', meta: 'Verre · écran verrouillé', dmx: '10–19', sel: true });
  assert.equal(await page.textContent('#callListGo'), 'Envoyer le SMS n°1');
  await page.evaluate(() => setCallListKind('call'));
  const r = await rows(page);
  assert.deepEqual(r.slice(0, 3), [
    { n: '1', name: 'Maman', meta: 'Verre · photo', dmx: '10–19', sel: false },
    { n: '2', name: 'Agence immobilière', meta: 'Tonal · décroché auto 8 s', dmx: '20–29', sel: false },
    { n: '3', name: 'Numéro masqué', meta: 'Épuré', dmx: '30–39', sel: false },
  ]);
  assert.deepEqual([r[19].dmx, r[20].dmx], ['200–209', '—'], 'au-delà de 20 : hors console');
  // Toucher une entrée : sélection + formulaire rechargé (photo comprise)
  await page.locator('#callListRows .cl-row').nth(1).click();
  await waitFor(page, () => document.getElementById('callName').value === 'Agence immobilière');
  assert.deepEqual(await page.evaluate(() => [callKind, callStyle, document.getElementById('callAutoSlider').value, _callPhoto]), ['call', 'tonal', '8', null]);
  assert.equal(await page.textContent('#callListGo'), 'Appeler n°2');
  await page.locator('#callListRows .cl-row').nth(0).click();
  await waitFor(page, () => document.getElementById('callName').value === 'Maman' && !!_callPhoto);
  const photo = await page.evaluate(() => _callPhoto);
  assert.match(photo, /^data:image\/jpeg;base64,/);
  // Rechargement de l'app : listes et photo (IndexedDB) retrouvées
  await page.reload();
  await page.evaluate(() => { startMode('remote'); switchTab('call'); });
  assert.equal(await page.textContent('#clKind-call'), 'Appels (21)');
  assert.equal(await page.evaluate(() => localStorage.getItem('setremote-call-list-v1').includes('data:image')), false, 'pas de photo en localStorage');
  await page.locator('#callListRows .cl-row').nth(0).click();
  await waitFor(page, () => !!_callPhoto);
  assert.equal(await page.evaluate(() => _callPhoto), photo);
  // Supprimer : les numéros suivants avancent
  page.once('dialog', (d) => d.accept());
  await page.click('#callListDel');
  assert.equal((await rows(page))[0].name, 'Agence immobilière');
  assert.deepEqual(errors, []);
  await close();
});

test('glisser-déposer : nouvel ordre, nouvelles plages DMX, mémorisé', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('call'); });
  for (const name of ['Un', 'Deux', 'Trois']) await save(page, { name });
  await page.evaluate(() => document.getElementById('callListPanel').scrollIntoView({ block: 'center' }));
  const grip = page.locator('#callListRows .cl-row').nth(2).locator('.cl-grip');
  const first = await page.locator('#callListRows .cl-row').nth(0).boundingBox();
  const g = await grip.boundingBox();
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x + g.width / 2, first.y + 10, { steps: 8 });
  await page.mouse.up();
  assert.deepEqual((await rows(page)).map((x) => [x.n, x.name, x.dmx]), [['1', 'Trois', '10–19'], ['2', 'Un', '20–29'], ['3', 'Deux', '30–39']]);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('setremote-call-list-v1')).call.map((e) => e.name)), ['Trois', 'Un', 'Deux']);
  assert.equal(await page.evaluate(() => document.querySelectorAll('.cl-ghost').length), 0);
  assert.deepEqual(errors, []);
  await close();
});

test('« Appeler n° X » : la photo de l\'entrée part avant l\'appel, l\'écran sonne avec ses réglages', async () => {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed: 31, autoConnect: true });
  const rp = remote.page;
  await rp.evaluate(() => { startMode('remote'); switchTab('call'); setCallRing('silent'); });
  await connected(rp);
  const screen = await openPage(browser, { broker, seed: 32, autoConnect: true, hash: await pairingHash(rp) });
  const sp = screen.page;
  await connected(sp);
  await waitFor(rp, () => _pairedScreens.size === 1);
  await waitFor(rp, () => _resyncTimer === null); // resynchronisation après le « caps » de l'écran
  await save(rp, { name: 'Maman', style: 'glass', photo: '#00ff00' });
  await save(rp, { name: 'Julien', style: 'tonal', photo: '#0000ff' });
  // Formulaire réglé sur autre chose : « Appeler n°1 » envoie l'entrée n° 1
  await rp.evaluate(() => { document.getElementById('callName').value = 'Formulaire'; setCallListKind('call'); });
  await rp.locator('#callListRows .cl-row').nth(1).click();
  await waitFor(rp, () => document.getElementById('callName').value === 'Julien');
  await rp.evaluate(() => { _callListSel.call = callList.call[0].id; renderCallList(); });
  assert.equal(await rp.textContent('#callListGo'), 'Appeler n°1');
  await rp.click('#callListGo');
  await waitFor(sp, () => _callState === 'ringing');
  const html = await sp.evaluate(() => document.getElementById('screen-call').innerHTML);
  assert.match(html, /Maman/);
  assert.match(html, /sc-call glass/);
  assert.equal(await rp.evaluate(() => callList.call[0].hasPhoto), true);
  // L'appel affiche la photo de l'entrée n° 1 (et non celle du formulaire, Julien)
  const entryPhoto = await rp.evaluate(() => callAssetGet(callList.call[0].id + ':photo'));
  assert.match(entryPhoto, /^data:image\/jpeg;base64,/);
  assert.equal(await sp.evaluate(() => _callCfg.photo), entryPhoto, 'photo de l\'entrée n° 1 dans l\'appel');
  await broker.flush();
  const msgs = await broker.sent(rp);
  const start = msgs.findIndex((m) => m.type === 'call:start');
  assert.deepEqual([msgs[start].name, msgs[start].hasPhoto], ['Maman', true]);
  assert.ok(msgs.slice(0, start).some((m) => m.type === 'media-img-start' && m.mediaId === '__callphoto'), 'photo envoyée avant l\'appel');
  assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remote.close();
});

// Maquettes 43, 43b, 43c : nom de l'enregistrement, « Mettre à jour » l'entrée chargée, menu « ⋯ »
const photoOf = (page, color) => page.evaluate((c) => {
  const k = document.createElement('canvas'); k.width = 8; k.height = 8;
  const g = k.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 8, 8);
  return k.toDataURL('image/jpeg', 0.7);
}, color);
const shown = (page, id) => page.evaluate((id) => getComputedStyle(document.getElementById(id)).display !== 'none', id);
const menu = (page) => page.$$eval('#srSheetBody button', (b) => b.map((x) => x.textContent));

test('nom de l\'enregistrement (feuille), entrée chargée : mettre à jour / enregistrer comme nouveau ; menu « ⋯ » ; anciennes entrées', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('call'); setCallRing('silent'); });
  let confirms = 0;
  page.on('dialog', (d) => { confirms++; d.accept(); });
  // « + Enregistrer l'appel actuel » : feuille du nom, proposition préremplie
  await page.evaluate(() => { document.getElementById('callName').value = 'Maman'; document.getElementById('callLabel').value = 'mobile'; });
  await page.click('#callListSave');
  assert.equal(await page.textContent('#srSheetTitle'), 'Enregistrer l\'appel');
  assert.equal(await page.inputValue('#srName'), 'Maman · mobile');
  assert.equal(await page.textContent('#srSheetBody .sr-sheet-note'), 'Vide : « Maman · mobile ». Le nom sert dans la liste, la Séquence et la console (n° 1, DMX 10–19).');
  await page.fill('#srName', 'Maman — scène 12');
  await page.click('#sr-sheet .sr-ok');
  await waitFor(page, () => callList.call.length === 1);
  // Vidé : nom par défaut (rien d'enregistré comme nom)
  await page.evaluate(() => { document.getElementById('callName').value = 'Agence'; document.getElementById('callLabel').value = ''; });
  await page.click('#callListSave');
  await page.fill('#srName', '');
  await page.click('#sr-sheet .sr-ok');
  await waitFor(page, () => callList.call.length === 2);
  assert.deepEqual((await rows(page)).map((x) => x.name), ['Maman — scène 12', 'Agence']);
  assert.deepEqual(await page.evaluate(() => callList.call.map((e) => e.title)), ['Maman — scène 12', undefined]);
  assert.equal(await page.evaluate(() => _seqRefList('call').map((x) => x.label).join(' | ')), '1 · Maman — scène 12 | 2 · Agence');
  assert.equal(await shown(page, 'callListSave'), true, 'rien de chargé : un seul bouton');
  assert.equal(await shown(page, 'callListUpd'), false);
  // Toucher l'entrée n° 1 : chargée → « Mettre à jour » et « Enregistrer comme nouveau »
  await page.locator('#callListRows .cl-row').nth(0).click();
  await waitFor(page, () => document.getElementById('callName').value === 'Maman');
  assert.equal(await shown(page, 'callListSave'), false);
  assert.deepEqual(await page.$$eval('#callListUpd button', (b) => b.map((x) => x.textContent)), ['Mettre à jour « Maman — scène 12 »', 'Enregistrer comme nouveau']);
  // Mettre à jour : même id, même numéro, même nom ; une photo là où il n'y en avait pas
  const id1 = await page.evaluate(() => callList.call[0].id);
  const red = await photoOf(page, '#ff0000');
  await page.evaluate((p) => { document.getElementById('callName').value = 'Mère'; setCallStyle('tonal'); _callPhoto = p; }, red);
  await page.click('#callListUpdate');
  await waitFor(page, (id) => callAssetGet(id + ':photo').then((v) => !!v), id1);
  assert.deepEqual(await page.evaluate(() => [callList.call[0].id, callList.call[0].name, callList.call[0].style, callList.call[0].title, callList.call[0].hasPhoto, callList.call.length]),
    [id1, 'Mère', 'tonal', 'Maman — scène 12', true, 2]);
  assert.deepEqual((await rows(page))[0], { n: '1', name: 'Maman — scène 12', meta: 'Tonal · photo', dmx: '10–19', sel: true });
  // Photo retirée puis mise à jour : l'ancienne photo est effacée (rien ne reste)
  await page.evaluate(async () => { _callPhoto = null; await updateLoadedCallEntry(); });
  assert.deepEqual(await page.evaluate((id) => Promise.all([callAssetGet(id + ':photo'), callList.call[0].hasPhoto]), id1), [null, false]);
  // Changer de type : l'entrée n'est plus chargée, même en revenant
  await page.evaluate(() => { setCallKind('sms'); setCallKind('call'); });
  assert.equal(await shown(page, 'callListSave'), true);
  assert.equal(await shown(page, 'callListUpd'), false);
  // « Enregistrer comme nouveau » : feuille, nouvelle entrée ; plus d'entrée chargée
  await page.locator('#callListRows .cl-row').nth(1).click();
  await waitFor(page, () => document.getElementById('callName').value === 'Agence');
  await page.click('#callListSaveNew');
  assert.equal(await page.textContent('#srSheetBody .sr-sheet-note'), 'Vide : « Agence ». Le nom sert dans la liste, la Séquence et la console (n° 3, DMX 30–39).');
  await page.fill('#srName', 'Agence — rappel');
  await page.click('#sr-sheet .sr-ok');
  await waitFor(page, () => callList.call.length === 3);
  assert.equal(await shown(page, 'callListSave'), true);
  // Menu « ⋯ » (la poignée reste) : renommer, dupliquer (photo copiée, en fin de liste), supprimer
  assert.equal(await page.locator('#callListRows .cl-row').nth(0).locator('.cl-grip').count(), 1);
  const blue = await photoOf(page, '#0000ff');
  await page.evaluate(async (p) => { _callPhoto = p; document.getElementById('callName').value = 'Julien'; document.getElementById('callLabel').value = 'mobile'; await updateCallEntry(callList.call[1].id); }, blue);
  await page.locator('#callListRows .cl-row').nth(1).locator('.cl-more').click();
  assert.equal(await page.textContent('#srSheetTitle'), '« Julien · mobile »');
  assert.deepEqual(await menu(page), ['Charger dans l\'onglet', 'Renommer', 'Mettre à jour avec les réglages actuels', 'Dupliquer', 'Supprimer', 'Fermer']);
  await page.locator('#srSheetBody .dc-menu-btn', { hasText: 'Renommer' }).click();
  assert.equal(await page.textContent('#srSheetTitle'), 'Renommer l\'enregistrement');
  assert.equal(await page.inputValue('#srName'), 'Julien · mobile', 'sans nom : le nom par défaut');
  await page.fill('#srName', 'Julien — rappel');
  await page.click('#sr-sheet .sr-ok');
  assert.equal((await rows(page))[1].name, 'Julien — rappel');
  await page.locator('#callListRows .cl-row').nth(1).locator('.cl-more').click();
  await page.locator('#srSheetBody .dc-menu-btn', { hasText: 'Dupliquer' }).click();
  await waitFor(page, () => callList.call.length === 4);
  assert.deepEqual((await rows(page)).map((x) => [x.n, x.name, x.dmx]).slice(1),
    [['2', 'Julien — rappel', '20–29'], ['3', 'Agence — rappel', '30–39'], ['4', 'Julien — rappel (copie)', '40–49']]);
  assert.equal(await page.evaluate(() => callAssetGet(callList.call[3].id + ':photo')), blue, 'photo copiée');
  // Supprimer depuis le menu : confirmation, photo effacée, l'original garde la sienne
  const dupId = await page.evaluate(() => callList.call[3].id);
  await page.locator('#callListRows .cl-row').nth(3).locator('.cl-more').click();
  await page.locator('#srSheetBody .dc-menu-btn', { hasText: 'Supprimer' }).click();
  assert.equal(confirms, 1);
  assert.equal(await page.evaluate(() => callList.call.length), 3);
  assert.equal(await page.evaluate((id) => callAssetGet(id + ':photo'), dupId), null);
  assert.equal(await page.evaluate(() => callAssetGet(callList.call[1].id + ':photo')), blue);
  // « Charger dans l'onglet » : comme toucher la ligne ; « Mettre à jour » absent si le formulaire est d'un autre type
  // (le formulaire passé en SMS emmène la liste sur « SMS » : on revient sur « Appels »)
  await page.evaluate(() => { setCallKind('sms'); setCallListKind('call'); });
  await page.locator('#callListRows .cl-row').nth(2).locator('.cl-more').click();
  assert.deepEqual(await menu(page), ['Charger dans l\'onglet', 'Renommer', 'Dupliquer', 'Supprimer', 'Fermer']);
  await page.locator('#srSheetBody .dc-menu-btn', { hasText: 'Charger dans l\'onglet' }).click();
  await waitFor(page, () => callKind === 'call' && document.getElementById('callName').value === 'Agence');
  assert.equal(await page.textContent('#callListUpdate'), 'Mettre à jour « Agence — rappel »');
  // Changer d'onglet de liste : fin de l'entrée chargée
  await page.evaluate(() => { setCallListKind('sms'); setCallListKind('call'); });
  assert.equal(await shown(page, 'callListUpd'), false);
  // Supprimer l'entrée chargée : fin aussi
  await page.locator('#callListRows .cl-row').nth(0).click();
  await waitFor(page, () => document.getElementById('callName').value === 'Mère');
  await page.click('#callListDel');
  assert.equal(confirms, 2);
  assert.equal(await shown(page, 'callListUpd'), false);
  // Rechargement : noms gardés ; anciennes entrées (sans nom) relues telles quelles
  await page.evaluate(() => {
    const o = JSON.parse(localStorage.getItem('setremote-call-list-v1'));
    o.call.push({ id: 'old1', kind: 'call', style: 'glass', name: 'Ancien', label: 'bureau', ring: 'classic' });
    o.notif = [{ id: 'old2', kind: 'notif', style: 'glass', name: '', appName: 'Banque', ring: 'classic' }];
    localStorage.setItem('setremote-call-list-v1', JSON.stringify(o));
  });
  await page.reload();
  await page.evaluate(() => { startMode('remote'); switchTab('call'); });
  assert.deepEqual((await rows(page)).map((x) => x.name), ['Julien — rappel', 'Agence — rappel', 'Ancien · bureau']);
  await page.evaluate(() => setCallListKind('notif'));
  assert.deepEqual((await rows(page)).map((x) => x.name), ['Banque']);
  assert.deepEqual(errors, []);
  await close();
});

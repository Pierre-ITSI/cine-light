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
  const photo = await rp.evaluate(() => callList.call[0]);
  assert.equal(photo.hasPhoto, true);
  assert.equal(await sp.evaluate(() => _cachedCallPhoto()), await rp.evaluate(() => _callPhotoOnScreens), 'photo de l\'entrée n° 1 sur l\'écran');
  await broker.flush();
  const types = (await broker.sent(rp)).map((m) => m.type);
  const start = types.lastIndexOf('call:start');
  assert.ok(types.lastIndexOf('media-img-chunk') < start, 'photo envoyée avant l\'appel');
  assert.deepEqual(remote.errors, []); assert.deepEqual(screen.errors, []);
  await screen.close(); await remote.close();
});

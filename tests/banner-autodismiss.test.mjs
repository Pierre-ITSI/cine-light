// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Bandeaux de SMS / notification d'application : ils repartent seuls au bout de 5 s (comme sur un
// vrai téléphone), le doigt posé dessus met le compte à rebours en pause, un toucher garde son
// geste ; l'écran verrouillé et le bandeau d'appel entrant ne sont pas touchés ; la télécommande
// perd sa ligne « Retirer de l'écran » après le départ automatique.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const SMS = { kind: 'sms', style: 'glass', name: 'Maman', msg: 'Tu es où ?', ring: 'silent', present: 'banner' };
const NOTIF = { kind: 'notif', style: 'glass', name: 'Virement', appName: 'Banque', msg: '2 400 €', ring: 'silent', present: 'banner' };
const start = (page, m) => page.evaluate((x) => screenCallStart(x), m);
const st = (page) => page.evaluate(() => ({ state: _callState, shown: document.getElementById('screen-call').style.display, html: document.getElementById('screen-call').innerHTML.length }));
async function bannerPage() {
  const o = await openPage(browser, { clock: true });
  await o.page.evaluate(() => { screenJoinSession(SRP.createPairing()); window.__g = []; phoneGesture = (g) => { window.__g.push(g); return true; }; });
  return o;
}

for (const [nom, msg] of [['SMS', SMS], ['notification', NOTIF]]) {
  test(`bandeau ${nom} : repart seul après 5 s, couche vidée`, async () => {
    const { page, errors, close } = await bannerPage();
    await start(page, msg);
    assert.equal((await st(page)).state, 'notif');
    await page.clock.runFor(4800);
    assert.equal((await st(page)).state, 'notif', 'toujours là avant 5 s');
    await page.clock.runFor(300);
    assert.equal(await page.evaluate(() => document.querySelector('#screen-call .pb-wrap').classList.contains('pb-out')), true, 'sortie animée');
    await page.clock.runFor(500);
    assert.deepEqual(await st(page), { state: 'idle', shown: 'none', html: 0 });
    assert.deepEqual(errors, []);
    await close();
  });
}

test('doigt posé sur le bandeau : pause, reprise au relâchement', async () => {
  const { page, errors, close } = await bannerPage();
  await start(page, SMS);
  await page.clock.runFor(2000);
  const box = await page.locator('#screen-call .pb-wrap').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.clock.runFor(20000);
  assert.equal((await st(page)).state, 'notif', 'tenu : ne part pas');
  // Relâché hors du bandeau (pas de clic) : le reste (3 s) reprend
  await page.mouse.move(5, 600);
  await page.mouse.up();
  await page.clock.runFor(2800);
  assert.equal((await st(page)).state, 'notif');
  await page.clock.runFor(400);
  assert.equal((await st(page)).state, 'idle');
  assert.deepEqual(errors, []);
  await close();
});

test('un nouveau bandeau relance le compte à rebours', async () => {
  const { page, close } = await bannerPage();
  await start(page, SMS);
  await page.clock.runFor(4000);
  await start(page, NOTIF);
  await page.clock.runFor(4000);
  assert.equal((await st(page)).state, 'notif', '4 s après le second : encore là');
  await page.clock.runFor(1800);
  assert.equal((await st(page)).state, 'idle');
  await close();
});

test('toucher le bandeau : geste « notif » rapporté, couche retirée, plus de départ différé', async () => {
  const { page, close } = await bannerPage();
  await start(page, SMS);
  await page.clock.runFor(1000);
  await page.locator('#screen-call .pb-wrap').click();
  assert.deepEqual(await page.evaluate(() => window.__g), ['notif']);
  await page.clock.runFor(600);
  assert.equal((await st(page)).state, 'idle');
  assert.equal(await page.evaluate(() => _scBannerTimer), null);
  await close();
});

test('écran verrouillé : la notification reste (veille à 10 s inchangée)', async () => {
  const { page, close } = await bannerPage();
  await start(page, { ...SMS, present: 'full', lock: { time: '', date: '' } });
  await page.clock.runFor(9000);
  assert.equal((await st(page)).state, 'notif', 'toujours là à 9 s');
  await page.clock.runFor(2000);
  assert.equal((await st(page)).state, 'idle', 'se rendort à 10 s');
  await close();
});

test('bandeau d\'appel entrant : sonne jusqu\'au décroché', async () => {
  const { page, close } = await bannerPage();
  await start(page, { kind: 'call', style: 'glass', name: 'Maman', label: 'mobile', ring: 'silent', present: 'banner' });
  await page.clock.runFor(30000);
  assert.equal((await st(page)).state, 'ringing');
  assert.ok(await page.evaluate(() => !!document.querySelector('#screen-call .pb-wrap')));
  await close();
});

test('autre couche / fin d\'appel : le compte à rebours est nettoyé', async () => {
  const { page, close } = await bannerPage();
  await start(page, SMS);
  await page.evaluate(() => screenCallEnd());
  assert.equal(await page.evaluate(() => _scBannerTimer), null);
  await start(page, SMS);
  await page.evaluate(() => screenCallHide());
  assert.equal(await page.evaluate(() => _scBannerTimer), null);
  await close();
});

test('télécommande : la ligne « Retirer de l\'écran » disparaît après le départ automatique', async () => {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed: 97, autoConnect: true });
  const rp = remote.page;
  await rp.evaluate(() => { startMode('remote'); switchTab('call'); SEQ_GO_GUARD_MS = 0; });
  const connected = (p) => waitFor(p, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
  await connected(rp);
  const s = await openPage(browser, { broker, seed: 970, autoConnect: true, hash: await pairingHash(rp) });
  const sp = s.page;
  await connected(sp);
  const sid = await sp.evaluate(() => screenId());
  await waitFor(rp, () => _screenOfSender.size === 1 && scrList().length === 1);
  await waitFor(rp, () => _resyncTimer === null);
  await sleep(200);
  await broker.flush();
  await rp.evaluate((id) => scrSetTarget({ k: 'screen', id }), sid);
  await rp.evaluate((m) => sendMsg(Object.assign({ type: 'call:start' }, m)), SMS);
  await waitFor(sp, () => _callState === 'notif');
  await waitFor(rp, (id) => !!scrState(id).call, sid);
  await waitFor(rp, () => document.getElementById('telOn').style.display !== 'none');
  await sleep(5600);
  await waitFor(sp, () => _callState === 'idle');
  await waitFor(rp, (id) => scrState(id).call === null, sid);
  await waitFor(rp, () => document.getElementById('telOn').style.display === 'none');
  assert.deepEqual(remote.errors, []); assert.deepEqual(s.errors, []);
  await s.close(); await remote.close();
});

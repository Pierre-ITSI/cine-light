// Chargement, navigation, onglets, sortie de session écran.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

test('chargement : aucune erreur de page, splash affiché', async () => {
  const { page, errors, close } = await openPage(browser);
  await sleep(300);
  const st = await page.evaluate(() => ({
    splash: getComputedStyle(document.getElementById('splash')).display,
    mode: mode, client: mqttClient,
    cards: document.querySelectorAll('.effect-card').length, fxCount: Object.keys(EFFECT_CONFIG).length,
    sliders: document.querySelectorAll('.slider-row').length,
    ranges: document.querySelectorAll('input[type=range]').length,
    header: document.documentElement.previousSibling && document.documentElement.previousSibling.nodeValue,
    compat: document.compatMode,
  }));
  assert.deepEqual(errors, []);
  assert.equal(st.splash, 'flex');
  assert.equal(st.mode, null);
  assert.equal(st.client, null);
  assert.equal(st.cards, st.fxCount, 'une carte par effet');
  assert.equal(st.fxCount, 14);
  assert.equal(st.sliders, st.ranges, 'chaque slider reçoit ses boutons −/+');
  assert.equal(st.compat, 'CSS1Compat', 'pas de mode quirks (en-tête après le doctype)');
  assert.match(String(st.header), /GÉNÉRÉ par web\/build\.mjs/);
  await close();
});

test("télécommande : startMode('remote') puis chaque onglet", async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => startMode('remote'));
  const base = await page.evaluate(() => ({
    mode, client: mqttClient,
    remote: getComputedStyle(document.getElementById('remote-mode')).display,
    splash: getComputedStyle(document.getElementById('splash')).display,
    channel: document.getElementById('channelInput').value,
  }));
  assert.equal(base.mode, 'remote');
  assert.equal(base.client, null, 'aucune connexion tant que « Connecter » n\'est pas pressé');
  assert.equal(base.remote, 'block');
  assert.equal(base.splash, 'none');
  assert.match(base.channel, /^set\d{4}$/);
  for (const t of ['color', 'effects', 'flash', 'media', 'call', 'qr', 'color']) {
    await page.click('#tab-' + t);
    const r = await page.evaluate((t) => {
      const c = document.getElementById('content-' + t);
      return {
        active: document.querySelectorAll('.tab-content.active').length,
        mine: c.classList.contains('active'),
        visible: c.offsetHeight > 0,
        btn: document.getElementById('tab-' + t).classList.contains('active'),
        others: [...document.querySelectorAll('.tab-content')].filter((x) => x !== c && x.offsetHeight > 0).length,
      };
    }, t);
    assert.deepEqual(r, { active: 1, mine: true, visible: true, btn: true, others: 0 }, 'onglet ' + t);
  }
  const qr = await page.evaluate(() => document.getElementById('qrUrl').textContent);
  assert.match(qr, /Connectez-vous/);
  // Retour à l'accueil
  await page.evaluate(() => goBack());
  const back = await page.evaluate(() => ({ mode, splash: getComputedStyle(document.getElementById('splash')).display }));
  assert.deepEqual(back, { mode: null, splash: 'flex' });
  assert.deepEqual(errors, []);
  await close();
});

test('goBackToSplash termine réellement la session écran', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => enterScreenMode('Plateau 7!'));
  const on = await page.evaluate(() => ({
    mode, channel, hasClient: !!mqttClient,
    screen: getComputedStyle(document.getElementById('screen-mode')).display,
  }));
  assert.deepEqual(on, { mode: 'screen', channel: 'plateau7', hasClient: true, screen: 'flex' });
  // Session active : appel qui sonne, strobe, effet, média, blackout
  await page.evaluate(() => {
    screenCallStart({ kind: 'call', style: 'glass', name: 'Maman', ring: 'silent' });
    receiveStrobe({ active: true, freq: 2, dur: 50 });
    receiveStrobe({ active: false });
    receiveEffect({ name: 'police', active: true, params: { speed: 3, intensity: 100 } });
    setBlackout(true);
  });
  assert.equal(await page.evaluate(() => _callState), 'ringing');
  await page.evaluate(() => { window.__client = mqttClient; goBackToSplash(); });
  const off = await page.evaluate(() => ({
    mode, client: mqttClient, ended: window.__client.disconnecting,
    bc: window._bc, call: _callState, callShown: document.getElementById('screen-call').style.display,
    strobe: screenStrobeTimer, fx: _screenEffect, blackout: screenBlackoutOn,
    screen: getComputedStyle(document.getElementById('screen-mode')).display,
    splash: getComputedStyle(document.getElementById('splash')).display,
    hash: location.hash,
  }));
  assert.deepEqual(off, {
    mode: null, client: null, ended: true, bc: null, call: 'idle', callShown: 'none',
    strobe: null, fx: null, blackout: false, screen: 'none', splash: 'flex', hash: '',
  });
  assert.deepEqual(errors, []);
  await close();
});

test("écran : ouverture directe par #canal et menu", async () => {
  const { page, errors, close } = await openPage(browser, { hash: 'set1234' });
  const st = await page.evaluate(() => ({ mode, channel, splash: getComputedStyle(document.getElementById('splash')).display }));
  assert.deepEqual(st, { mode: 'screen', channel: 'set1234', splash: 'none' });
  await page.evaluate(() => openScreenMenu());
  assert.equal(await page.evaluate(() => document.getElementById('screenMenuChannel').textContent), 'Canal : set1234');
  await page.evaluate(() => closeScreenMenu());
  await page.evaluate(() => suspendScreen());
  const sus = await page.evaluate(() => ({
    client: mqttClient, connect: getComputedStyle(document.getElementById('screen-connect')).display,
    input: document.getElementById('screenChannelInput').value,
  }));
  assert.deepEqual(sus, { client: null, connect: 'flex', input: 'set1234' });
  await waitFor(page, () => document.activeElement && document.activeElement.id === 'screenChannelInput');
  assert.deepEqual(errors, []);
  await close();
});

// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Chargement, navigation, onglets, sortie de session écran.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, SRP, nativeShell } from './helpers/harness.mjs';

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
  const { page, errors, close } = await openPage(browser, { init: nativeShell('https://setremote.test/') });
  await page.evaluate(() => startMode('remote'));
  // Session chiffrée créée et connexion lancée d'office (plus de code canal)
  await waitFor(page, () => !!mqttClient);
  const base = await page.evaluate(() => ({
    mode, session: _session, stored: JSON.parse(localStorage.getItem('setremote-session-v1')),
    topic: mqttClient.subscriptions.length ? mqttClient.subscriptions : _sec.mqttTopic,
    remote: getComputedStyle(document.getElementById('remote-mode')).display,
    splash: getComputedStyle(document.getElementById('splash')).display,
    pill: document.getElementById('linkPillLabel').textContent,
    oldInput: !!document.getElementById('channelInput'),
  }));
  assert.equal(base.mode, 'remote');
  assert.ok(SRP.isValidPairing(base.session), 'secret de session 128 + 256 bits');
  assert.deepEqual(base.stored, base.session, 'persisté jusqu\'à « Nouvelle session »');
  assert.match(String(base.topic), /^setremote\/v2\/s\/[A-Za-z0-9_-]{22}$/, 'topic opaque dérivé');
  assert.ok(!String(base.topic).includes(base.session.channelId));
  assert.equal(base.remote, 'block');
  assert.equal(base.splash, 'none');
  assert.equal(base.pill, 'Connexion…');
  assert.equal(base.oldInput, false, 'plus de saisie de code canal');
  for (const t of ['color', 'effects', 'flash', 'media', 'call', 'seq', 'qr', 'color']) {
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
  // Onglet d'appairage : QR local et code de rendez-vous
  await page.click('#tab-qr');
  const pair = await page.evaluate(() => ({
    svg: !!document.querySelector('#pairQr svg path'), code: document.getElementById('pairCode').textContent,
    rdv: _rdv && _rdv.role, text: document.getElementById('content-qr').textContent,
  }));
  assert.ok(pair.svg, 'QR dessiné localement');
  assert.match(pair.code, /^[A-HJKMNP-Z2-9]{3}·[A-HJKMNP-Z2-9]{3}$/);
  assert.equal(pair.rdv, 'remote');
  assert.doesNotMatch(pair.text, /#p=|v1\./, 'le lien secret n\'est pas affiché en clair');
  // Même session au rechargement de la télécommande
  const again = await page.evaluate(() => { const s = _session; goBack(); startMode('remote'); return [s, _session]; });
  assert.deepEqual(again[0], again[1]);
  // Retour à l'accueil
  await page.evaluate(() => goBack());
  const back = await page.evaluate(() => ({ mode, splash: getComputedStyle(document.getElementById('splash')).display, rdv: _rdv, client: mqttClient }));
  assert.deepEqual(back, { mode: null, splash: 'flex', rdv: null, client: null });
  assert.deepEqual(errors, []);
  await close();
});

test('goBackToSplash termine réellement la session écran', async () => {
  const { page, errors, close } = await openPage(browser);
  const pairing = SRP.createPairing();
  await page.evaluate((p) => screenJoinSession(p), pairing);
  await waitFor(page, () => !!mqttClient);
  const on = await page.evaluate(() => ({
    mode, session: _session, hasClient: !!mqttClient, bc: !!window._bc,
    screen: getComputedStyle(document.getElementById('screen-mode')).display,
  }));
  assert.deepEqual(on, { mode: 'screen', session: pairing, hasClient: true, bc: true, screen: 'flex' });
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

test('écran : un ancien lien #set1234 mène à l\'écran d\'appairage, sans connexion', async () => {
  const { page, errors, close } = await openPage(browser, { hash: 'set1234' });
  await sleep(100);
  const st = await page.evaluate(() => ({
    mode, client: mqttClient, hash: location.hash,
    splash: getComputedStyle(document.getElementById('splash')).display,
    join: getComputedStyle(document.getElementById('screen-connect')).display,
    title: document.querySelector('#screen-connect h2').textContent,
  }));
  assert.deepEqual(st, { mode: null, client: null, hash: '', splash: 'none', join: 'flex', title: 'Écran projecteur' });
  assert.deepEqual(errors, []);
  await close();
});

test('écran : lien d\'appairage #p=v1.… → rejoint la session, fragment effacé ; menu et suspension', async () => {
  const pairing = SRP.createPairing();
  const { page, errors, close } = await openPage(browser, { hash: SRP.pairingUrl('x', pairing).split('#')[1] });
  await waitFor(page, () => !!mqttClient);
  const st = await page.evaluate(() => ({
    mode, session: _session, hash: location.hash, href: location.href,
    stored: JSON.parse(localStorage.getItem('setremote-screen-session-v1')),
    splash: getComputedStyle(document.getElementById('splash')).display,
    topic: _sec.mqttTopic,
  }));
  assert.equal(st.mode, 'screen');
  assert.deepEqual(st.session, pairing);
  assert.equal(st.hash, '', 'secret effacé de la barre d\'adresse');
  assert.ok(!st.href.includes(pairing.key));
  assert.deepEqual(st.stored, pairing, 'session retenue pour « Écran projecteur »');
  assert.equal(st.splash, 'none');
  await page.evaluate(() => openScreenMenu());
  assert.equal(await page.evaluate(() => document.getElementById('screenMenuInfo').textContent), 'Liaison chiffrée de bout en bout');
  await page.evaluate(() => closeScreenMenu());
  await page.evaluate(() => suspendScreen());
  const sus = await page.evaluate(() => ({
    client: mqttClient, connect: getComputedStyle(document.getElementById('screen-connect')).display,
  }));
  assert.deepEqual(sus, { client: null, connect: 'flex' });
  // Retour à l'accueil puis « Écran projecteur » : la session retenue est rejointe
  await page.evaluate(() => { goBackToSplash(); startMode('screen'); });
  await waitFor(page, () => !!mqttClient);
  assert.deepEqual(await page.evaluate(() => [mode, _session]), ['screen', pairing]);
  assert.deepEqual(errors, []);
  await close();
});

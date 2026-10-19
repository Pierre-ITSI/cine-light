// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Installer l'application (maquettes 35) : bouton toujours visible dans un
// navigateur ; fenêtre native du navigateur quand elle existe, sinon feuille
// du bas avec la marche à suivre du navigateur détecté.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, sleep } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  ipadSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
};

test('détection du navigateur', async () => {
  const { page, errors, close } = await openPage(browser);
  const got = await page.evaluate((UA) => ({
    iphoneSafari: pwaBrowser(UA.iphoneSafari, 5),
    iphoneChrome: pwaBrowser(UA.iphoneChrome, 5),
    iphoneFirefox: pwaBrowser(UA.iphoneFirefox, 5),
    ipadSafari: pwaBrowser(UA.ipadSafari, 5),
    androidFirefox: pwaBrowser(UA.androidFirefox, 5),
    androidChrome: pwaBrowser(UA.androidChrome, 5),
    macSafari: pwaBrowser(UA.macSafari, 0),
    macChrome: pwaBrowser(UA.macChrome, 0),
    winFirefox: pwaBrowser(UA.winFirefox, 0),
    winEdge: pwaBrowser(UA.winEdge, 0),
  }), UA);
  assert.deepEqual(errors, []);
  assert.deepEqual(got, {
    iphoneSafari: 'ios-safari', iphoneChrome: 'ios-other', iphoneFirefox: 'ios-other', ipadSafari: 'ios-safari',
    androidFirefox: 'android-firefox', androidChrome: 'other',
    macSafari: 'mac-safari', macChrome: 'other', winFirefox: 'desktop-firefox', winEdge: 'other',
  });
  await close();
});

test('navigateur : bouton visible ; sans fenêtre native, la feuille explique la marche à suivre', async () => {
  const { page, errors, close } = await openPage(browser);
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.getElementById('installBtn')).display), 'none');
  assert.equal(await page.evaluate(() => document.getElementById('iosInstallHint')), null);
  await page.click('#installBtn');
  const st = await page.evaluate(() => ({
    open: document.getElementById('sr-sheet').classList.contains('open'),
    title: document.getElementById('srSheetTitle').textContent,
    steps: document.querySelectorAll('#srSheetBody .pwa-steps li').length,
    sub: document.querySelector('#srSheetBody .pwa-sub').textContent,
  }));
  assert.deepEqual(st, { open: true, title: 'Installer SetRemote', steps: 3, sub: 'Gratuit, sans passer par un store.' });
  await page.click('#srSheetBody .sr-cancel');
  assert.equal(await page.evaluate(() => document.getElementById('sr-sheet').classList.contains('open')), false);
  assert.deepEqual(errors, []);
  await close();
});

test('Firefox ordinateur : pas d\'étapes, invitation à ouvrir Chrome ou Edge', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate((ua) => { Object.defineProperty(navigator, 'userAgent', { get: () => ua }); installPWA(); }, UA.winFirefox);
  const st = await page.evaluate(() => ({
    steps: document.querySelectorAll('#srSheetBody .pwa-steps li').length,
    warn: document.querySelector('#srSheetBody .pwa-warn').textContent,
  }));
  assert.equal(st.steps, 0);
  assert.match(st.warn, /Chrome.*Edge/);
  assert.deepEqual(errors, []);
  await close();
});

test('fenêtre native disponible : elle est utilisée, pas la feuille ; acceptée → bouton masqué', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await page.click('#installBtn');
  await sleep(50);
  const st = await page.evaluate(() => ({
    prompted: window.__prompted,
    sheet: document.getElementById('sr-sheet').classList.contains('open'),
    btn: getComputedStyle(document.getElementById('installBtn')).display,
  }));
  assert.deepEqual(st, { prompted: 1, sheet: false, btn: 'none' });
  assert.deepEqual(errors, []);
  await close();
});

test('app déjà installée (affichage autonome) : pas de bouton', async () => {
  const { page, errors, close } = await openPage(browser, {
    init: () => {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (q === '(display-mode: standalone)' ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q));
    },
  });
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('installBtn')).display), 'none');
  assert.deepEqual(errors, []);
  await close();
});

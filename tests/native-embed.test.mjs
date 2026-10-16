// Interface embarquée dans l'app native (expo-app/scripts/embed-web.mjs) :
// paquet complet, autonome (aucune requête réseau au chargement), contexte
// sécurisé en file://, et reconnaissance de la coque même quand l'injection
// « avant chargement » arrive trop tard (cas Android).
//
// Chromium sert ici de substitut à la WebView Android (même moteur) ; le
// comportement de WKWebView (iOS) reste à vérifier sur appareil
// (expo-app/TESTFLIGHT.md).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchBrowser, openPage, fileUrl, sleep, waitFor } from './helpers/harness.mjs';
import { assertIndexUpToDate, embedWeb, checkEmbed, FILES, PAGES } from '../expo-app/scripts/embed-web.mjs';

let browser, dir;
before(async () => {
  browser = await launchBrowser();
  dir = mkdtempSync(path.join(tmpdir(), 'setremote-embed-'));
  await assertIndexUpToDate();
  embedWeb(dir);
});
after(async () => {
  await browser?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// Page embarquée ; « bridge » simule le pont de react-native-webview présent
// dès le début de la page, SANS window.SETREMOTE_NATIVE (injection tardive).
async function openEmbedded(file, { bridge = false } = {}) {
  const p = await openPage(browser, { file: path.join(dir, file), waitLoad: false });
  const requests = [];
  p.context.on('request', (r) => requests.push(r.url()));
  if (bridge) {
    await p.context.addInitScript(() => {
      window.__posted = [];
      window.ReactNativeWebView = { postMessage: (m) => window.__posted.push(JSON.parse(m)) };
    });
  }
  await p.page.goto(fileUrl(path.join(dir, file)));
  return { ...p, requests };
}

test('paquet complet : toute ressource relative citée est embarquée', () => {
  const r = checkEmbed(dir);
  assert.deepEqual(r.problems, []);
  for (const f of FILES) assert.ok(r.files.includes(f), f);
  assert.ok(r.files.includes('vendor/mqtt-5.16.1.min.js'));
  assert.equal(r.files.filter((f) => /^vendor\/fonts\/.+\.woff2$/.test(f)).length, 10);
  assert.ok(r.files.includes('vendor/fonts/dm-mono-OFL.txt') && r.files.includes('vendor/fonts/lato-OFL.txt'));
  assert.ok(!r.files.includes('sw.js'), 'pas de service worker dans l\'app');
  assert.ok(!r.files.some((f) => f.startsWith('splash-')), 'pas d\'écrans de lancement PWA');
  assert.ok(!r.files.includes('screen.html') && !r.local.includes('screen.html'), 'ancien mode DMX retiré : plus de screen.html');
  // Politique de confidentialité embarquée (Apple 5.1.1, Google Play) : ses
  // références sont vérifiées comme celles de l'app
  for (const f of ['confidentialite.html', 'privacy.html']) {
    assert.ok(FILES.includes(f) && PAGES.includes(f) && r.files.includes(f), f);
  }
  assert.ok(r.local.includes('confidentialite.html') && r.local.includes('privacy.html'), 'liens vers la politique (FR ↔ EN, Réglages) présents dans le paquet');
});

test('politique de confidentialité embarquée : pages en file://, polices du paquet, sans réseau', async () => {
  for (const file of ['confidentialite.html', 'privacy.html']) {
    const { page, errors, requests, close } = await openEmbedded(file);
    await page.evaluate(() => document.fonts.ready);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:')), [], file + ' : aucune requête hors du paquet');
    assert.ok(requests.some((u) => /\/vendor\/fonts\/lato-latin-400-normal\.woff2$/.test(u)), file + ' : polices du paquet');
    await close();
  }
});

test('coque : Réglages › Politique de confidentialité ouvre la page du paquet, sans réseau', async () => {
  const { page, errors, requests, close } = await openEmbedded('index.html', { bridge: true });
  await page.evaluate(() => { startMode('remote'); openSettings(); openPrivacyPolicy(); });
  await waitFor(page, () => document.getElementById('policyFrame').getAttribute('src') === 'confidentialite.html');
  let frame = null;
  for (let i = 0; i < 200 && !frame; i++) { frame = page.frames().find((f) => f.url().endsWith('/confidentialite.html')); if (!frame) await sleep(25); }
  assert.ok(frame, 'cadre de la politique chargé');
  await frame.waitForLoadState('load');
  const st = await frame.evaluate(() => ({ url: location.href, h1: document.querySelector('h1').textContent, theme: document.documentElement.getAttribute('data-theme') }));
  assert.ok(st.url.startsWith(fileUrl(dir) + '/'), 'page du paquet : ' + st.url);
  assert.equal(st.h1, 'Politique de confidentialité');
  assert.equal(st.theme, 'dark', 'couleurs de l\'app dans la coque');
  assert.deepEqual(requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:')), [], 'aucune requête hors du paquet');
  assert.deepEqual(errors, []);
  await close();
});

test('chargement en file:// : aucune requête réseau, polices locales, contexte sécurisé', async () => {
  const { page, errors, requests, close } = await openEmbedded('index.html');
  await page.evaluate(() => document.fonts.ready);
  const st = await page.evaluate(async () => {
    for (const f of ['300 1em "DM Mono"', '400 1em "DM Mono"', '500 1em "DM Mono"', '400 1em Lato', '700 1em Lato']) await document.fonts.load(f);
    return {
      fonts: [...document.fonts].filter((x) => x.status === 'loaded').map((x) => x.family.replace(/"/g, '') + ' ' + x.weight).sort(),
      secure: window.isSecureContext, subtle: !!(window.crypto && crypto.subtle && crypto.subtle.generateKey),
      ls: (() => { try { localStorage.setItem('__t', '1'); return localStorage.getItem('__t') === '1'; } catch (_) { return false; } })(),
      inApp: IN_NATIVE_APP,
      splash: getComputedStyle(document.getElementById('splash')).display,
    };
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:')), [], 'aucune requête hors du paquet');
  assert.ok(requests.some((u) => u.endsWith('/vendor/mqtt-5.16.1.min.js')));
  assert.deepEqual(st.fonts, ['DM Mono 300', 'DM Mono 400', 'DM Mono 500', 'Lato 400', 'Lato 700']);
  assert.equal(st.secure, true, 'file:// = contexte sécurisé (getUserMedia, WebCrypto)');
  assert.equal(st.subtle, true, 'crypto.subtle disponible');
  assert.equal(st.ls, true, 'localStorage disponible');
  assert.equal(st.inApp, false, 'sans pont natif : navigateur ordinaire');
  assert.equal(st.splash, 'flex');
  await close();
});

test('coque reconnue sans SETREMOTE_NATIVE (injection Android tardive) : luminosité native', async () => {
  const { page, errors, close } = await openEmbedded('index.html', { bridge: true });
  await sleep(100);
  const st = await page.evaluate(() => {
    setScreenDim(0.4);
    return {
      inApp: IN_NATIVE_APP, cls: document.documentElement.classList.contains('in-app'),
      native: window.SETREMOTE_NATIVE, posted: window.__posted,
      dim: getComputedStyle(document.getElementById('screen-dim')).display,
      install: getComputedStyle(document.getElementById('installBtn')).display,
    };
  });
  assert.deepEqual(errors, []);
  assert.equal(st.inApp, true);
  assert.equal(st.cls, true);
  assert.deepEqual(st.native, { platform: 'ios', bridge: 1 });
  assert.deepEqual(st.posted, [{ type: 'brightness', value: 0.4 }], 'luminosité déléguée au natif');
  assert.equal(st.dim, 'none', 'pas de voile noir simulé dans l\'app');
  assert.equal(st.install, 'none');
  await close();
});

test('ancien mode DMX retiré : accueil sans « Mode DMX », aucune trace dans la page', async () => {
  for (const bridge of [true, false]) {
    const { page, errors, close } = await openEmbedded('index.html', { bridge });
    const st = await page.evaluate(() => {
      const r = {
        buttons: [...document.querySelectorAll('#splash .splash-btn')].map((b) => b.textContent.trim()),
        config: document.getElementById('screen-sacn-config'),
        links: [...document.querySelectorAll('[onclick]')].filter((e) => /screen\.html/.test(e.getAttribute('onclick'))).length,
        legacy: ['enterScreenSACN', 'stopScreenSACN', 'screenApplyDmx', 'sacnConnect'].filter((f) => typeof window[f] !== 'undefined'),
      };
      // Retour à l'accueil depuis l'écran projecteur : plus d'appel à l'ancien mode
      startMode('screen');
      goBackToSplash();
      r.splash = getComputedStyle(document.getElementById('splash')).display;
      return r;
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(st, { buttons: ['Télécommande', 'Écran projecteur'], config: null, links: 0, legacy: [], splash: 'flex' }, bridge ? 'app native' : 'navigateur');
    await close();
  }
});

// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Réglages (maquette 13), ouverts par l'engrenage de l'en-tête (maquette 1) :
// lignes reprises quand la fonction existe, langue mémorisée (note « English
// coming soon »), « Oublier tous les écrans appairés » (= Nouvelle session,
// confirmée), retour à l'accueil, politique de confidentialité embarquée (sans
// requête externe), version alignée sur expo-app/app.json.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, openPage, waitFor, sleep, ROOT, INDEX_PATH, fileUrl } from './helpers/harness.mjs';

const APP_JSON_VERSION = JSON.parse(readFileSync(path.join(ROOT, 'expo-app', 'app.json'), 'utf8')).expo.version;

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

// Cadre de la politique (pages file:// : origines distinctes, lues par Playwright)
async function policyFrame(page, file) {
  const t0 = Date.now();
  for (;;) {
    const f = page.frames().find((fr) => fr.url().endsWith('/' + file));
    if (f) { await f.waitForLoadState('load'); return f; }
    if (Date.now() - t0 > 5000) throw new Error('cadre absent : ' + file);
    await sleep(25);
  }
}
const visible = (page, id) => page.evaluate((id) => getComputedStyle(document.getElementById(id)).display !== 'none', id);
async function remote(opts) {
  const p = await openPage(browser, opts);
  await p.page.evaluate(() => startMode('remote'));
  return p;
}

test('en-tête : engrenage « Réglages » à la place de « ← Retour » ; vue Réglages de la maquette', async () => {
  const { page, errors, close } = await remote();
  const head = await page.evaluate(() => {
    const end = document.querySelector('.remote-header-end');
    const gear = document.getElementById('settingsBtn');
    const r = gear.getBoundingClientRect();
    return {
      children: [...end.children].map((e) => e.id || e.className),
      gear: [gear.getAttribute('aria-label'), Math.round(r.width), Math.round(r.height), !!gear.querySelector('svg')],
      back: document.querySelectorAll('.remote-header .back-btn').length,
      retour: document.querySelector('.remote-header').textContent.includes('Retour'),
    };
  });
  // L'engrenage ferme l'en-tête (d'autres pastilles peuvent le précéder)
  assert.equal(head.children.at(-1), 'settingsBtn');
  assert.ok(head.children.includes('linkPill'));
  assert.deepEqual({ ...head, children: undefined }, { children: undefined, gear: ['Réglages', 44, 44, true], back: 0, retour: false });
  assert.equal(await visible(page, 'settings-view'), false);
  await page.click('#settingsBtn');
  assert.equal(await visible(page, 'settings-view'), true);
  await page.evaluate(() => projectUiIdle()); // carte « Projet » : rendu asynchrone (74-project-ui.js)
  const view = await page.evaluate(() => {
    const t = (e) => e.textContent.replace(/\s+/g, ' ').trim();
    return {
      title: t(document.getElementById('stTitle')),
      lang: [...document.querySelectorAll('.st-seg-btn')].map((b) => [t(b), b.classList.contains('active'), b.getAttribute('aria-pressed')]),
      note: getComputedStyle(document.getElementById('stLangNote')).display,
      rows: [...document.querySelectorAll('.st-row')].map((r) => [t(r.querySelector('.st-row-label')), t(r.querySelector('.st-row-sub')), t(r.querySelector('.st-row-val'))]),
      buttons: [...document.querySelectorAll('#settings-view .st-btn')].map(t),
      foot: [...document.querySelector('.st-foot').children].map(t),
      policyHref: document.querySelector('.st-policy').getAttribute('href'),
    };
  });
  assert.deepEqual(view, {
    title: 'Réglages',
    lang: [['Français', true, 'true'], ['English', false, 'false']],
    note: 'none',
    rows: [
      // Projet (maquette 45, tests/project-ui.test.mjs) : premier usage, « Mon projet »
      ['Mon projet', 'Projet ouvert · 0 séquences · 0 discussions · 0 appels et SMS', 'Projets ›'],
      ['Exporter le projet…', 'Fichier .rem à envoyer ou à archiver', '›'],
      ['Importer un projet…', 'Ajouter, remplacer, ou ouvrir comme nouveau projet', '›'],
      ['Chiffrement de bout en bout', 'Clés générées sur vos appareils', 'Actif'],
      ['Avertissement stroboscope', 'Avant chaque activation', 'Activé'],
      ['Fréquence max du strobo', 'Sécurité photosensibilité', '30 Hz'],
      ['Liaison par défaut', 'Internet, Wi-Fi local, Bluetooth', 'Auto'], // tests/offline.test.mjs
    ],
    buttons: ['Oublier tous les écrans appairés', 'Retour à l\'accueil'],
    foot: ['Politique de confidentialité', 'Aucun compte · aucune publicité · aucun suivi', `SetRemote ${APP_JSON_VERSION} · by Pikoo`],
    policyHref: 'confidentialite.html',
  });
  // Lignes de la maquette sans fonction réelle : absentes (pas de valeur inventée)
  const text = await page.evaluate(() => document.getElementById('settings-view').textContent);
  for (const absent of ['Relais', 'eu-west', 'Purger', '24 h']) assert.ok(!text.includes(absent), absent);
  // « ← Retour » : retour à la télécommande, session intacte
  const before = await page.evaluate(() => _session.channelId);
  await page.click('#settings-view .st-back');
  assert.equal(await visible(page, 'settings-view'), false);
  assert.deepEqual(await page.evaluate(() => [mode, _session.channelId, getComputedStyle(document.getElementById('remote-mode')).display]), ['remote', before, 'block']);
  assert.deepEqual(errors, []);
  await close();
});

test('langue : choix mémorisé ; en anglais, note « bientôt » et politique en anglais', async () => {
  const { page, errors, close } = await remote();
  await page.click('#settingsBtn');
  await page.click('#stLang-en');
  const en = await page.evaluate(() => ({
    stored: localStorage.getItem('setremote-lang-v1'), lang: appLanguage(),
    active: document.querySelector('.st-seg-btn.active').id,
    note: getComputedStyle(document.getElementById('stLangNote')).display,
    noteText: document.getElementById('stLangNote').textContent,
    htmlLang: document.documentElement.lang,
  }));
  assert.deepEqual(en, {
    stored: 'en', lang: 'en', active: 'stLang-en', note: 'block',
    noteText: 'The English version is coming soon. Until then, SetRemote stays in French.',
    htmlLang: 'fr', // interface encore en français : traduction à venir
  });
  // Persisté : relance de la télécommande, toujours en anglais
  await page.evaluate(() => { closeSettings(); goBack(); startMode('remote'); });
  await page.click('#settingsBtn');
  assert.equal(await page.evaluate(() => document.querySelector('.st-seg-btn.active').id), 'stLang-en');
  await page.click('.st-policy');
  const enFrame = await policyFrame(page, 'privacy.html');
  assert.deepEqual(await enFrame.evaluate(() => [document.documentElement.lang, document.querySelector('h1').textContent]), ['en', 'Privacy policy']);
  await page.click('#policy-view .st-back');
  // Retour au français
  await page.click('#stLang-fr');
  assert.deepEqual(await page.evaluate(() => [localStorage.getItem('setremote-lang-v1'), getComputedStyle(document.getElementById('stLangNote')).display]), ['fr', 'none']);
  assert.deepEqual(errors, []);
  await close();
});

test('« Avertissement stroboscope » : reflète « Ne plus demander », la ligne le réactive (et inversement)', async () => {
  const { page, errors, close } = await remote();
  const toggle = () => page.locator('label.toggle-switch:has(#strobeToggle)').click();
  const shown = () => page.evaluate(() => getComputedStyle(document.getElementById('strobe-warn')).display === 'block');
  const row = () => page.evaluate(() => [document.getElementById('stStrobeWarnVal').textContent, document.getElementById('stStrobeWarnVal').className, document.getElementById('stStrobeWarn').getAttribute('aria-checked')]);
  // « Ne plus demander » coché dans la boîte
  await toggle();
  await page.check('#swSkip');
  await page.click('#swOk');
  await toggle();
  await page.click('#settingsBtn');
  assert.deepEqual(await row(), ['Désactivé', 'st-row-val off', 'false']);
  // Toucher la ligne : avertissement réactivé, persisté
  await page.click('#stStrobeWarn');
  assert.deepEqual(await row(), ['Activé', 'st-row-val on', 'true']);
  assert.equal(await page.evaluate(() => localStorage.getItem('setremote-strobe-warning-v1')), null);
  await page.click('#settings-view .st-back');
  await toggle();
  assert.equal(await shown(), true, 'réactivé');
  await page.click('#swCancel');
  // Et inversement : désactivé depuis les Réglages, pour cette session
  await page.click('#settingsBtn');
  await page.click('#stStrobeWarn');
  assert.deepEqual(await row(), ['Désactivé', 'st-row-val off', 'false']);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('setremote-strobe-warning-v1')).skip === _session.channelId), true);
  await page.click('#settings-view .st-back');
  await toggle();
  assert.equal(await shown(), false);
  assert.equal(await page.evaluate(() => strobeActive), true);
  assert.deepEqual(errors, []);
  await close();
});

test('« Oublier tous les écrans appairés » : confirmation, puis nouvelle session et nouveau QR', async () => {
  const { page, errors, close } = await remote();
  await page.evaluate(() => { remoteNoteScreen('sAAAAAAAA', { type: 'caps', screenId: 'ScreenOne0000001' }); });
  const before = await page.evaluate(() => ({ id: _session.channelId, screens: _pairedScreens.size }));
  assert.equal(before.screens, 1);
  await page.click('#settingsBtn');
  // Refus : rien ne change
  const msgs = [];
  page.once('dialog', (d) => { msgs.push(d.message()); d.dismiss(); });
  await page.click('#settings-view .st-danger');
  await sleep(50);
  assert.deepEqual(await page.evaluate(() => [_session.channelId, _pairedScreens.size, getComputedStyle(document.getElementById('settings-view')).display]), [before.id, 1, 'flex']);
  // Acceptation : nouveau secret (stocké), écrans oubliés, onglet QR affiché
  page.once('dialog', (d) => { msgs.push(d.message()); d.accept(); });
  await page.click('#settings-view .st-danger');
  await sleep(50);
  const after = await page.evaluate(() => ({
    id: _session.channelId, stored: JSON.parse(localStorage.getItem('setremote-session-v1')).channelId, screens: _pairedScreens.size,
    settings: getComputedStyle(document.getElementById('settings-view')).display,
    tab: document.querySelector('.tab-content.active').id, qr: !!document.querySelector('#pairQr svg') || document.getElementById('pairCode').textContent,
  }));
  assert.match(msgs[0], /^Oublier tous les écrans appairés : ils seront déconnectés et devront scanner le nouveau QR\. Continuer \?$/);
  assert.equal(msgs.length, 2);
  assert.notEqual(after.id, before.id);
  assert.equal(after.stored, after.id);
  assert.equal(after.screens, 0);
  assert.equal(after.settings, 'none');
  assert.equal(after.tab, 'content-qr');
  assert.ok(after.qr);
  assert.deepEqual(errors, []);
  await close();
});

test('« Retour à l\'accueil » : confirmé, puis fin de la télécommande, accueil affiché', async () => {
  const { page, errors, close } = await remote();
  await page.click('#settingsBtn');
  await page.click('#settings-view .st-btn:not(.st-danger)');
  await page.click('#acOk'); // confirmation (30-navigation.js)
  const st = await page.evaluate(() => ({
    mode, client: mqttClient, splash: getComputedStyle(document.getElementById('splash')).display,
    remote: getComputedStyle(document.getElementById('remote-mode')).display,
    settings: getComputedStyle(document.getElementById('settings-view')).display,
  }));
  assert.deepEqual(st, { mode: null, client: null, splash: 'flex', remote: 'none', settings: 'none' });
  assert.deepEqual(errors, []);
  await close();
});

test('politique de confidentialité : ouverte dans l\'app, page locale, aucune requête externe', async () => {
  const p = await openPage(browser, { waitLoad: false });
  const requests = [];
  p.context.on('request', (r) => requests.push(r.url()));
  await p.page.goto(fileUrl(INDEX_PATH));
  const { page, errors } = p;
  await page.evaluate(() => startMode('remote'));
  await page.click('#settingsBtn');
  await page.click('.st-policy');
  assert.equal(await visible(page, 'policy-view'), true);
  const fr = await policyFrame(page, 'confidentialite.html');
  await fr.evaluate(() => document.fonts.ready);
  const frame = {
    ...await page.evaluate(() => {
      const f = document.getElementById('policyFrame');
      return { src: f.getAttribute('src'), title: document.getElementById('policyTitle').textContent, height: f.getBoundingClientRect().height };
    }),
    ...await fr.evaluate(() => ({ h1: document.querySelector('h1').textContent, lang: document.documentElement.lang, theme: document.documentElement.getAttribute('data-theme') })),
  };
  assert.deepEqual({ ...frame, height: frame.height > 600 }, {
    src: 'confidentialite.html', h1: 'Politique de confidentialité', lang: 'fr', theme: 'dark', title: 'Confidentialité', height: true,
  });
  assert.deepEqual(requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:')), [], 'aucune requête hors des fichiers locaux');
  assert.ok(requests.some((u) => u.endsWith('/confidentialite.html')));
  // « ← Retour » : retour aux Réglages
  await page.click('#policy-view .st-back');
  assert.deepEqual([await visible(page, 'policy-view'), await visible(page, 'settings-view')], [false, true]);
  assert.deepEqual(errors, []);
  await p.close();
});

test('version : « SetRemote <version> » = expo-app/app.json (et package.json)', async () => {
  const appJson = APP_JSON_VERSION;
  const pkgs = ['package.json', 'expo-app/package.json'].map((f) => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8')).version);
  const { page, errors, close } = await remote();
  await page.click('#settingsBtn');
  const v = await page.evaluate(() => [APP_VERSION, document.getElementById('stVersion').textContent]);
  assert.equal(v[0], appJson, 'APP_VERSION (web/js/92-settings.js) = expo.version de expo-app/app.json');
  assert.equal(v[1], `SetRemote ${appJson} · by Pikoo`);
  assert.deepEqual(pkgs, [appJson, appJson], 'versions des package.json alignées');
  assert.deepEqual(errors, []);
  await close();
});

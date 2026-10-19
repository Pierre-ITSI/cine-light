// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Faux téléphone sur l'écran de jeu : le fondu ne joue qu'à l'apparition de
// l'écran verrouillé ; une nouvelle notification glisse seule, sans refaire le
// fondu de tout l'écran (sinon la couleur de fond, souvent blanche, flashe).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const SESSION = { channelId: 'A'.repeat(22), key: 'A'.repeat(43) };
const N = (id, msg) => ({ id, kind: 'sms', app: 'SMS', name: 'Maman', msg, ago: 0 });

test('séquence : fondu à l\'apparition seulement, seule la nouvelle notification glisse', async () => {
  const { page, errors, close } = await openPage(browser);
  const state = (notifs) => page.evaluate((n) => screenPhoneState({ style: 'glass', mode: 'locked', notifs: n, unlock: null, home: false, watch: [], chime: null }), notifs);
  const look = () => page.evaluate(() => ({
    enter: document.querySelector('#screen-phone .sp-lock').classList.contains('sp-enter'),
    fresh: [...document.querySelectorAll('#screen-phone .sp-card')].map((c) => c.dataset.n + (c.classList.contains('sp-new') ? '+' : '')),
  }));
  await page.evaluate((s) => screenJoinSession(s), SESSION);
  await state([N('n1', 'Tu es où ?')]);
  assert.deepEqual(await look(), { enter: true, fresh: ['n1+'] });
  await state([N('n1', 'Tu es où ?'), N('n2', 'Rappelle-moi')]);
  assert.deepEqual(await look(), { enter: false, fresh: ['n2+', 'n1'] });
  await state([N('n1', 'Tu es où ?'), N('n2', 'Rappelle-moi')]);
  assert.deepEqual(await look(), { enter: false, fresh: ['n2', 'n1'] });
  // Caché puis réaffiché : nouveau fondu
  await page.evaluate(() => screenPhoneHide());
  await state([N('n1', 'Tu es où ?')]);
  assert.deepEqual(await look(), { enter: true, fresh: ['n1+'] });
  assert.deepEqual(errors, []);
  await close();
});

test('onglet Tel : deuxième notification sur écran verrouillé, sans nouveau fondu', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate((s) => screenJoinSession(s), SESSION);
  const send = (msg) => page.evaluate((msg) => screenCallStart({ kind: 'sms', name: 'Maman', msg, style: 'glass', ring: 'silent', lock: { time: '', date: '' } }), msg);
  await send('Tu es où ?');
  assert.equal(await page.evaluate(() => document.querySelector('#screen-call .sc-lock').classList.contains('sc-still')), false);
  await send('Rappelle-moi');
  assert.equal(await page.evaluate(() => document.querySelector('#screen-call .sc-lock').classList.contains('sc-still')), true);
  assert.deepEqual(errors, []);
  await close();
});

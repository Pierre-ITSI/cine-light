// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Extinction du faux téléphone : clavier de la discussion rabaissé d'abord (sans refocus),
// puis fondu au noir, loader « batterie vide » (3 habillages), puis noir. Horloge Playwright.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const SESSION = { channelId: 'A'.repeat(22), key: 'A'.repeat(43) };
const state = (power, mode = 'locked', style = 'glass') => ({ mode, style, notifs: [], unlock: null, home: false, watch: [], chime: null, bar: null, sleep: null, alert: null, power });

async function chatPage(opts = {}, style = 'glass') {
  const o = await openPage(browser, { clock: true });
  if (opts.reduced) await o.page.emulateMedia({ reducedMotion: 'reduce' });
  await o.page.evaluate((s) => screenJoinSession(s), SESSION);
  await o.page.evaluate((style) => {
    screenChatMsg({ id: 'd1', from: 'contact', text: 'Tu es où ?' });
    screenChatOpen({ name: 'Maman', style, ids: ['d1'], sent: [], typed: 0 });
  }, style);
  await o.page.evaluate((s) => screenPhoneState(s), state('on', 'locked', style)); // état précédent connu (sinon : écran rechargé)
  await o.page.clock.runFor(600);
  return o;
}
const cls = (page) => page.evaluate(() => document.getElementById('screen-ppower').className);
const focused = (page) => page.evaluate(() => document.activeElement && document.activeElement.id === 'sccKeys');

test('extinction depuis la discussion : champ quitté, pas de refocus, puis fondu, loader, noir', async () => {
  const { page, errors, close } = await chatPage();
  assert.equal(await focused(page), true, 'le champ a le focus au départ');
  await page.evaluate((s) => screenPhoneState(s), state('off'));
  assert.equal(await focused(page), false, 'blur immédiat');
  assert.equal(await cls(page), '', 'clavier d\'abord : pas encore de fondu');
  // Un nouveau rendu de la discussion ne remonte pas le clavier
  await page.evaluate(() => { screenChatMsg({ id: 'd2', from: 'contact', text: 'Allô ?' }); _sccRender(); _sccFocus(); });
  assert.equal(await focused(page), false, 'verrou anti-refocus');
  await page.clock.runFor(400); // clavier rabaissé (350 ms)
  assert.match(await cls(page), /\bon\b.*\boffing\b/);
  assert.equal(await page.evaluate(() => !!document.querySelector('#screen-ppower .pp-off')), true);
  await page.clock.runFor(400); // fondu fini : loader
  assert.match(await cls(page), /off-loader/);
  await page.clock.runFor(2000); // loader fini
  assert.equal(await cls(page), 'on offing');
  await page.clock.runFor(400);
  assert.equal(await cls(page), 'on');
  assert.equal(await page.evaluate(() => document.getElementById('screen-ppower').textContent), '');
  assert.equal(await focused(page), false);
  assert.deepEqual(errors, []);
  await close();
});

test('extinction : repli à 600 ms au plus quand le clavier tarde à se rabaisser', async () => {
  const { page, close } = await chatPage();
  await page.evaluate(() => { // visualViewport qui bouge sans fin
    const vv = window.visualViewport;
    window.__t = setInterval(() => vv.dispatchEvent(new Event('resize')), 50);
  });
  await page.evaluate((s) => screenPhoneState(s), state('off'));
  await page.clock.runFor(550);
  assert.equal(await cls(page), '');
  await page.clock.runFor(100);
  assert.match(await cls(page), /offing/);
  await close();
});

test('habillages du loader : Verre, Tonal, Épuré', async () => {
  for (const style of ['glass', 'tonal', 'minimal']) {
    const { page, close } = await chatPage({}, style);
    await page.evaluate((s) => screenPhoneState(s), state('off', 'locked', style));
    await page.clock.runFor(1300);
    assert.equal(await page.evaluate(() => document.querySelector('#screen-ppower .pp-off').className), 'pp-off ph-' + style);
    assert.equal(await page.evaluate(() => !!document.querySelector('#screen-ppower .pp-offbat .sliver') && !!document.querySelector('#screen-ppower .pp-spin')), true);
    assert.match(await cls(page), /off-loader/);
    await close();
  }
});

test('mouvement réduit : liseré et indicateur sans animation', async () => {
  const { page, close } = await chatPage({ reduced: true });
  await page.evaluate((s) => screenPhoneState(s), state('off'));
  await page.clock.runFor(1300);
  const a = await page.evaluate(() => [getComputedStyle(document.querySelector('.pp-offbat .sliver')).animationName, getComputedStyle(document.querySelector('.pp-spin')).animationName]);
  assert.deepEqual(a, ['none', 'none']);
  await close();
});

test('courant allumé pendant le loader : annulé proprement, verrou levé, aucune minuterie résiduelle', async () => {
  const { page, errors, close } = await chatPage();
  await page.evaluate((s) => screenPhoneState(s), state('off'));
  await page.clock.runFor(1000); // loader affiché
  assert.match(await cls(page), /off-loader/);
  await page.evaluate((s) => screenPhoneState(s), state('on')); // ↶ / Recommencer
  assert.match(await cls(page), /logo/);
  assert.equal(await page.evaluate(() => _sccOffLock), false, 'verrou levé');
  await page.clock.runFor(2200);
  assert.equal(await page.evaluate(() => document.getElementById('screen-ppower').style.display), 'none');
  await page.clock.runFor(3000);
  assert.equal(await page.evaluate(() => document.getElementById('screen-ppower').style.display), 'none', 'le loader périmé ne revient pas');
  // Retour pendant l'attente du clavier : le fondu ne part jamais
  await page.evaluate((s) => screenPhoneState(s), state('off'));
  await page.clock.runFor(100);
  await page.evaluate((s) => screenPhoneState(s), state('on'));
  await page.clock.runFor(3000);
  assert.equal(await page.evaluate(() => document.getElementById('screen-ppower').style.display), 'none');
  assert.deepEqual(errors, []);
  await close();
});

test('extinction depuis l\'écran verrouillé : loader sans attente de clavier', async () => {
  const { page, close } = await openPage(browser, { clock: true });
  await page.evaluate((s) => screenJoinSession(s), SESSION);
  await page.evaluate((s) => screenPhoneState(s), state('on'));
  await page.clock.runFor(600);
  await page.evaluate((s) => screenPhoneState(s), state('off'));
  assert.match(await cls(page), /offing/, 'fondu tout de suite');
  await page.clock.runFor(400);
  assert.match(await cls(page), /off-loader/);
  await page.clock.runFor(2400);
  assert.equal(await cls(page), 'on');
  await close();
});

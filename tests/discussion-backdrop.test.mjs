// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Fond derrière le clavier du système : pendant une discussion, html/body, la couleur de thème et
// le color-scheme suivent le fond de messagerie du style (Verre, Tonal, Épuré) ; valeurs d'origine
// rendues à la fermeture et à l'extinction du téléphone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const SESSION = { channelId: 'A'.repeat(22), key: 'A'.repeat(43) };
const state = (power, style) => ({ mode: 'locked', style, notifs: [], unlock: null, home: false, watch: [], chime: null, bar: null, sleep: null, alert: null, power });
const snap = (page) => page.evaluate(() => {
  const m = document.querySelector('meta[name="theme-color"]');
  const root = document.querySelector('#screen-chat .pt');
  const k = document.getElementById('sccKeys');
  return {
    html: getComputedStyle(document.documentElement).backgroundColor, body: getComputedStyle(document.body).backgroundColor,
    meta: m.getAttribute('content'), scheme: document.documentElement.style.colorScheme, keys: k ? k.style.colorScheme : '',
    chat: getComputedStyle(document.getElementById('screen-chat')).backgroundColor,
    kb: root ? getComputedStyle(root).getPropertyValue('--pt-kb').trim() : '',
  };
});
const orig = (x) => [x.html, x.body, x.meta, x.scheme];
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };

for (const [style, col, scheme] of [['glass', '#0d121c', 'dark'], ['tonal', '#15171b', 'dark'], ['minimal', '#ffffff', 'light']]) {
  test('fond derrière le clavier : ' + style, async () => {
    const { page, errors, close } = await openPage(browser, { clock: true });
    await page.evaluate((s) => screenJoinSession(s), SESSION);
    const avant = await snap(page);
    await page.evaluate((style) => {
      screenChatMsg({ id: 'd1', from: 'contact', text: 'Tu es où ?' });
      screenChatOpen({ name: 'Maman', style, ids: ['d1'], sent: [], typed: 0 });
    }, style);
    await page.evaluate((s) => screenPhoneState(s), state('on', style));
    await page.clock.runFor(600);
    const s = await snap(page);
    assert.equal(s.html, rgb(col)); assert.equal(s.body, rgb(col)); assert.equal(s.chat, rgb(col));
    assert.equal(s.meta, s.kb); assert.equal(rgb(s.kb.length === 4 ? '#' + [...s.kb.slice(1)].map((c) => c + c).join('') : s.kb), rgb(col));
    assert.equal(s.scheme, scheme); assert.equal(s.keys, scheme);
    // Extinction : valeurs d'origine (une fois le clavier rabaissé)
    await page.evaluate((s) => screenPhoneState(s), state('off', style));
    await page.clock.runFor(700);
    assert.deepEqual(orig(await snap(page)), orig(avant), 'restauré à l\'extinction');
    // Rallumage : le fond de la discussion revient
    await page.evaluate((s) => screenPhoneState(s), state('on', style));
    await page.clock.runFor(4000);
    assert.equal((await snap(page)).body, rgb(col), 'rallumé');
    // Fermeture
    await page.evaluate(() => screenChatHide());
    assert.deepEqual(orig(await snap(page)), orig(avant), 'restauré à la fermeture');
    assert.deepEqual(errors, []);
    await close();
  });
}

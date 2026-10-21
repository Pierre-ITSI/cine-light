// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Veille automatique et discussion : jamais de veille pendant une discussion ouverte, ré-armée
// seulement par une notification sur écran verrouillé ; fond de la discussion sous le clavier.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const SESSION = { channelId: 'A'.repeat(22), key: 'A'.repeat(43) };
const SLEEP = { notif: true, touch: true, after: 5 };
const notif = (id) => ({ id, kind: 'sms', app: 'Messages', name: 'Paul', msg: 'Salut', color: null, who: '', img: null, ago: 0 });
const state = (o = {}) => Object.assign({ mode: 'locked', style: 'glass', notifs: [], unlock: null, home: false, watch: [], chime: null, bar: null, sleep: SLEEP, alert: null, power: 'on' }, o);
const dark = (page) => page.evaluate(() => _spDark());
const openChat = (page) => page.evaluate(() => {
  screenChatMsg({ id: 'd1', from: 'contact', text: 'Tu es où ?' });
  screenChatOpen({ name: 'Maman', style: 'glass', ids: ['d1'], sent: [], typed: 0 });
});

async function setup() {
  const o = await openPage(browser, { clock: true });
  await o.page.evaluate((s) => screenJoinSession(s), SESSION);
  return o;
}

test('discussion ouverte : aucune veille, même longtemps, même après une notification', async () => {
  const { page, errors, close } = await setup();
  await page.evaluate((s) => screenPhoneState(s), state());
  await page.clock.runFor(1000);
  assert.equal(await dark(page), true, 'veille explicite appliquée tout de suite');
  await openChat(page);
  assert.equal(await dark(page), false, 'la discussion rallume l\'écran');
  await page.clock.runFor(600000);
  assert.equal(await dark(page), false, 'pas de veille spontanée en discussion');
  // Une notification pendant la discussion ne ré-arme rien
  await page.evaluate((s) => screenPhoneState(s), state({ notifs: [notif('n1')] }));
  await page.clock.runFor(600000);
  assert.equal(await dark(page), false);
  assert.deepEqual(errors, []);
  await close();
});

test('notification sur écran verrouillé : veille ré-armée puis déclenchée ; rien après la discussion', async () => {
  const { page, errors, close } = await setup();
  await page.evaluate((s) => screenPhoneState(s), state());
  await openChat(page);
  await page.clock.runFor(60000);
  await page.evaluate(() => screenChatHide());
  await page.clock.runFor(600000);
  assert.equal(await dark(page), false, 'fermée : pas de veille spontanée');
  await page.evaluate((s) => screenPhoneState(s), state({ notifs: [notif('n2')] }));
  await page.clock.runFor(1000);
  assert.equal(await dark(page), false, 'notif : écran allumé');
  await page.clock.runFor(5000);
  assert.equal(await dark(page), true, 'notif sur écran verrouillé : veille après le délai');
  assert.deepEqual(errors, []);
  await close();
});

test('discussion ouverte pendant l\'éveil d\'une notification : minuterie annulée', async () => {
  const { page, errors, close } = await setup();
  await page.evaluate((s) => screenPhoneState(s), state());
  await page.evaluate((s) => screenPhoneState(s), state({ notifs: [notif('n3')] }));
  await page.clock.runFor(2000);
  await openChat(page);
  await page.clock.runFor(60000);
  assert.equal(await dark(page), false);
  await page.evaluate(() => screenChatHide());
  await page.clock.runFor(60000);
  assert.equal(await dark(page), false);
  assert.deepEqual(errors, []);
  await close();
});

for (const style of ['glass', 'tonal', 'minimal']) {
  test('sous le clavier : fond de la discussion, pas le fond d\'écran (' + style + ')', async () => {
    const { page, errors, close } = await setup();
    await page.evaluate((s) => screenPhoneState(s), state({ style, sleep: null }));
    await page.evaluate((style) => {
      const ph = document.getElementById('screen-phone');
      const w = document.createElement('div');
      w.id = 'fakeWall'; w.style.cssText = 'position:absolute;inset:0;background:rgb(255,0,0)';
      ph.appendChild(w);
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: { height: 400, offsetTop: 0, addEventListener() {} } });
      screenChatMsg({ id: 'd1', from: 'contact', text: 'Tu es où ?' });
      screenChatOpen({ name: 'Maman', style, ids: ['d1'], sent: [], typed: 0 });
    }, style);
    await page.clock.runFor(600);
    const r = await page.evaluate(() => {
      const el = document.elementFromPoint(100, innerHeight - 20);
      const chat = document.getElementById('screen-chat');
      return { inChat: !!el && chat.contains(el), id: el && el.id, bg: getComputedStyle(el).backgroundColor, h: document.querySelector('#screen-chat .pt').style.height };
    });
    assert.equal(r.h, '400px');
    assert.equal(r.inChat, true, 'zone sous le clavier = discussion (pas ' + r.id + ')');
    assert.notEqual(r.bg, 'rgb(255, 0, 0)');
    const want = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    assert.equal(r.bg, want, 'même couleur que le fond de la discussion');
    assert.deepEqual(errors, []);
    await close();
  });
}

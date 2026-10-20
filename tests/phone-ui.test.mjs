// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Faux téléphone de l'écran de jeu, phase 5 : UN SEUL rendu (73-phone-ui.js,
// 79-phone-ui.css) pour l'onglet Tel et la Séquence : écran verrouillé et carte
// de notification communs, barre d'état sur toutes les vues quand elle est
// demandée (et seulement alors), voile sur fond clair (texte ≥ 4,5:1), date
// unique, actions d'appel visibles en paysage, accueil générique, image seule
// ou en fond d'écran.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor } from './helpers/harness.mjs';
import { decodePng } from './helpers/png.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const SESSION = { channelId: 'A'.repeat(22), key: 'A'.repeat(43) };
const BAR = { clock: { mode: 'frozen', date: '2026-07-17', time: '00:10' }, net: { bars: 4, type: '5G', plane: false, wifi: true }, bat: { level: 76, charging: false, pct: false } };
const LANDSCAPE = { width: 844, height: 390 };
const settle = (page) => page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch (_) {} }));
const ready = (page) => waitFor(page, () => PhoneUI.pending() === 0);
// Image de test : aplat de la couleur donnée (dessiné dans la page)
const flat = (page, key, color) => page.evaluate(([key, color]) => {
  const c = document.createElement('canvas'); c.width = 390; c.height = 844;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 390, 844);
  _mediaCache.set(key, { kind: 'img', data: c.toDataURL('image/png') });
}, [key, color]);
const NOTIFS = [
  { id: 'n1', kind: 'sms', app: 'SMS', name: 'Maman', msg: 'Tu es où ?', ago: 125 },
  { id: 'n2', kind: 'missed', app: 'Téléphone', name: 'Appel manqué', msg: 'Maman', who: 'Maman', ago: 65 },
  { id: 'n4', kind: 'notif', app: 'Banque Atlas', name: 'Virement reçu', msg: 'Vous avez reçu 2 400,00 €.', ago: 0 },
];
const phoneState = (page, m) => page.evaluate((m) => screenPhoneState(Object.assign({ unlock: { code: 4, then: 'home' }, home: false, watch: [], chime: null }, m)), m);
const open = async (opts) => { const o = await openPage(browser, { clock: true, ...opts }); await o.page.evaluate((s) => screenJoinSession(s), SESSION); return o; };

test('un seul écran verrouillé et une seule carte : mêmes classes pour l\'onglet Tel et la Séquence', async () => {
  const { page, errors, close } = await open();
  await phoneState(page, { mode: 'locked', style: 'tonal', notifs: [NOTIFS[0]] });
  const skel = (sel) => page.evaluate((sel) => {
    const root = document.querySelector(sel);
    return [...root.querySelectorAll('*')].map((e) => e.tagName.toLowerCase() + '.' + [...e.classList].filter((c) => !/^(pn-new|pn-k-)/.test(c)).sort().join('.')).filter((x) => !/^(span|div)\.(pn-when|psb)/.test(x));
  }, sel);
  const seq = await skel('#screen-phone .ph-lock');
  await page.evaluate(() => screenPhoneHide());
  await page.evaluate(() => screenCallStart({ kind: 'sms', style: 'tonal', name: 'Maman', msg: 'Tu es où ?', ring: 'silent', lock: { time: '', date: '' } }));
  const tel = await skel('#screen-call .ph-lock');
  assert.deepEqual(seq, tel);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#screen-call .pn').length), 1);
  assert.deepEqual(errors, []);
  await close();
});

test('date unique « vendredi 17 juillet », horloge sans empattement (pas de Georgia)', async () => {
  const { page, errors, close } = await open();
  await phoneState(page, { mode: 'locked', style: 'glass', notifs: [] });
  const seq = await page.evaluate(() => [document.querySelector('#screen-phone .pl-date').textContent, getComputedStyle(document.querySelector('#screen-phone .pl-time')).fontFamily]);
  assert.equal(seq[0], 'vendredi 17 juillet');
  assert.doesNotMatch(seq[1], /Georgia|Times/i);
  await page.evaluate(() => screenPhoneHide());
  for (const style of ['glass', 'tonal', 'minimal']) {
    await page.evaluate((style) => screenCallStart({ kind: 'sms', style, name: 'Léa', msg: 'Salut', ring: 'silent', lock: { time: '', date: '' } }), style);
    assert.equal(await page.evaluate(() => document.querySelector('#screen-call .pl-date').textContent), 'vendredi 17 juillet', style);
    assert.doesNotMatch(await page.evaluate(() => getComputedStyle(document.querySelector('#screen-call .pl-time')).fontFamily), /Georgia|Times/i);
    await page.evaluate(() => screenCallHide());
    await page.clock.runFor(500);
  }
  assert.deepEqual(errors, []);
  await close();
});

test('barre d\'état : sur toutes les vues quand elle est demandée, jamais sinon', async () => {
  const { page, errors, close } = await open();
  const shown = () => page.evaluate(() => { const e = document.getElementById('screen-sbar'); return getComputedStyle(e).display !== 'none' && !!e.querySelector('.psb-r .psb-bat'); });
  const views = {
    verrouillé: () => phoneState(page, { mode: 'locked', style: 'glass', notifs: NOTIFS }),
    code: async () => { await phoneState(page, { mode: 'code', style: 'glass', notifs: [] }); },
    accueil: () => phoneState(page, { mode: 'home', style: 'glass', notifs: [] }),
    déverrouillé: () => phoneState(page, { mode: 'unlocked', style: 'tonal', notifs: [], unlock: null }),
    alerte: () => phoneState(page, { mode: 'locked', style: 'minimal', notifs: [], alert: { id: 'b1', level: 5 } }),
    appel: () => page.evaluate(() => screenCallStart({ kind: 'call', style: 'tonal', name: 'Maman', ring: 'silent' })),
    'en cours': () => page.evaluate(() => { screenCallStart({ kind: 'call', style: 'glass', name: 'Maman', ring: 'silent' }); screenCallAnswer(); }),
    bandeau: () => page.evaluate(() => screenCallStart({ kind: 'sms', style: 'minimal', name: 'Léa', msg: 'Salut', ring: 'silent' })),
    discussion: () => page.evaluate(() => { screenChatMsg({ id: 'd1', from: 'contact', text: 'Salut' }); screenChatOpen({ name: 'Maman', style: 'glass', ids: ['d1'], sent: ['d1'], typed: 0 }); }),
  };
  for (const withBar of [true, false]) {
    for (const [name, go] of Object.entries(views)) {
      await page.evaluate(() => { screenPhoneHide(); screenCallHide(); screenChatHide(); });
      await page.clock.runFor(500);
      await go();
      // La barre vient de l'état de la Séquence (phone:state.bar) ; hors téléphone, de screenSeqBar
      await page.evaluate(([bar, on]) => screenSeqBar(on ? bar : null), [BAR, withBar]);
      if (name !== 'verrouillé' && name !== 'code' && name !== 'accueil' && name !== 'déverrouillé' && name !== 'alerte') await page.evaluate(() => _sbRefresh());
      assert.equal(await shown(), withBar, `${name} · barre ${withBar ? 'demandée' : 'absente'}`);
    }
  }
  // Au-dessus de l'alerte, sous l'extinction
  const z = await page.evaluate(() => ['screen-palert', 'screen-sbar', 'screen-ppower'].map((id) => Number(getComputedStyle(document.getElementById(id)).zIndex)));
  assert.ok(z[0] < z[1] && z[1] < z[2], z.join());
  assert.deepEqual(errors, []);
  await close();
});

test('barre d\'état : heure absente sur l\'écran verrouillé (déjà en grand), présente ailleurs', async () => {
  const { page, errors, close } = await open();
  await phoneState(page, { mode: 'locked', style: 'glass', notifs: [], bar: BAR });
  assert.equal(await page.evaluate(() => document.querySelector('#screen-sbar .psb-time').textContent), '');
  await phoneState(page, { mode: 'code', style: 'glass', notifs: [], bar: BAR });
  assert.equal(await page.evaluate(() => document.querySelector('#screen-sbar .psb-time').textContent), '00:10');
  assert.deepEqual(errors, []);
  await close();
});

// Contraste du texte blanc sur le fond réellement rendu (texte masqué, pixel le plus clair du cadre)
const lum = (r, g, b) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
async function worstContrast(page, sel) {
  await page.addStyleTag({ content: `${sel}{color:transparent!important;text-shadow:none!important}` });
  const r = await page.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: Math.floor(b.left), y: Math.floor(b.top), w: Math.ceil(b.width), h: Math.ceil(b.height) }; }, sel);
  const png = decodePng(await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h }, animations: 'disabled' }));
  let max = 0;
  for (let i = 0; i < png.data.length; i += 4) max = Math.max(max, lum(png.data[i], png.data[i + 1], png.data[i + 2]));
  return 1.05 / (max + 0.05); // texte blanc
}
test('fond d\'écran clair : voile posé (data-wall=light), date, heure et cartes ≥ 4,5:1 ; fond sombre : pas de voile renforcé', async () => {
  const { page, errors, close } = await open();
  await flat(page, '__seqwall', '#f4f1e6');
  await phoneState(page, { mode: 'locked', style: 'glass', notifs: NOTIFS, wall: true });
  await ready(page); await settle(page);
  assert.equal(await page.evaluate(() => document.querySelector('#screen-phone .ph-lock').dataset.wall), 'light');
  for (const sel of ['#screen-phone .pl-date', '#screen-phone .pl-time', '#screen-phone .pn-title', '#screen-phone .pn-text', '#screen-phone .pn-app']) {
    const c = await worstContrast(page, sel);
    assert.ok(c >= 4.5, `${sel} : ${c.toFixed(2)}:1`);
  }
  assert.equal((await page.evaluate(() => document.querySelectorAll('#screen-phone .pn').length)), 3);
  await flat(page, '__seqwall', '#10131c');
  await phoneState(page, { mode: 'code', style: 'glass', notifs: [], wall: true });
  await page.evaluate(() => screenPhoneOnWallCached());
  await ready(page);
  assert.equal(await page.evaluate(() => document.querySelector('#screen-phone .ph-code').dataset.wall), 'dark');
  assert.deepEqual(errors, []);
  await close();
});

test('paysage : identité à gauche, actions à droite (appel) ; verrouillage compact avec cartes qui défilent', async () => {
  const { page, errors, close } = await open({ viewport: LANDSCAPE });
  await page.evaluate(() => screenCallStart({ kind: 'call', style: 'glass', name: 'Maman', label: 'mobile', ring: 'silent' }));
  await page.clock.runFor(800); await settle(page);
  const r = await page.evaluate(() => {
    const q = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    return { name: q('#screen-call .pc-name'), ok: q('#screen-call [data-act=answer]'), no: q('#screen-call [data-act=decline]'), w: innerWidth, h: innerHeight };
  });
  assert.ok(r.name.r < r.ok.l && r.name.r < r.no.l, 'nom à gauche des boutons');
  for (const b of [r.ok, r.no]) assert.ok(b.l >= 0 && b.r <= r.w && b.t >= 0 && b.b <= r.h, 'bouton entier dans l\'écran');
  assert.deepEqual(errors, []);
  await close();
});

test('accueil : image seule par défaut, fond d\'écran sous les icônes génériques en option, générique sans image', async () => {
  const { page, errors, close } = await open();
  await flat(page, '__seqhome', '#336699');
  const home = (m) => phoneState(page, Object.assign({ mode: 'home', style: 'glass', notifs: [], unlock: null, home: true, watch: ['home'] }, m));
  const state = () => page.evaluate(() => ({
    img: !!document.querySelector('#screen-phone .ph-img'), icons: document.querySelectorAll('#screen-phone .pha-i').length,
    wall: document.querySelector('#screen-phone .ph').classList.contains('has-wall'), cls: document.querySelector('#screen-phone .ph').className,
  }));
  await home({});
  let s = await state();
  assert.deepEqual([s.img, s.icons], [true, 0], 'image seule, plein écran');
  await home({ homeWall: true });
  await ready(page);
  s = await state();
  assert.deepEqual([s.img, s.icons, s.wall], [false, 16, true], 'image en fond d\'écran sous les icônes');
  await page.evaluate(() => _mediaCache.delete('__seqhome'));
  await home({ home: false });
  s = await state();
  assert.deepEqual([s.img, s.icons, s.wall], [false, 16, false], 'accueil générique');
  // Libellés génériques en français, aucune marque
  const labels = await page.evaluate(() => [...document.querySelectorAll('#screen-phone .pha-i')].map((e) => e.textContent.trim()));
  assert.deepEqual(labels, ['Photos', 'Agenda', 'Horloge', 'Météo', 'Notes', 'Calculatrice', 'Cartes', 'Musique', 'Courrier', 'Dossiers', 'Réglages', 'Vidéo', 'Téléphone', 'Messages', 'Caméra', 'Contacts']);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#screen-phone .pha-ic svg').length), 16);
  assert.deepEqual(errors, []);
  await close();
});

test('protocole : homeWall accepté (booléen), absent = image seule', async () => {
  const { page, errors, close } = await open();
  const r = await page.evaluate(() => {
    const m = { type: 'phone:state', mode: 'home', style: 'glass', notifs: [], home: true, homeWall: true };
    return [_validPhoneState(m), m.homeWall, (() => { const n = { type: 'phone:state', mode: 'home', style: 'glass', notifs: [] }; _validPhoneState(n); return n.homeWall; })()];
  });
  assert.deepEqual(r, [true, true, false]);
  assert.deepEqual(errors, []);
  await close();
});

test('pile de notifications : aucun rognage de l\'ombre des cartes (bande claire sous la dernière carte)', async () => {
  const { page, errors, close } = await open();
  await phoneState(page, { mode: 'locked', style: 'glass', notifs: NOTIFS });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#screen-phone .pn-stack')).overflowY), 'visible');
  assert.deepEqual(errors, []);
  await close();
});

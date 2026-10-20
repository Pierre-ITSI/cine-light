// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Système visuel de la télécommande (phase 2) : plancher typographique de 12 px,
// aucun débordement horizontal à 375 et 390 px, anneau de focus visible, cibles
// tactiles d'au moins 44 px pour les commandes principales de chaque onglet,
// jetons et casse de phrase, aucun !important hors mouvement réduit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { launchBrowser, openPage } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const TABS = ['color', 'effects', 'flash', 'media', 'call', 'seq', 'qr'];
async function remote(viewport) {
  const p = await openPage(browser, viewport ? { viewport } : {});
  await p.page.evaluate(() => startMode('remote'));
  return p;
}

// Éléments visibles de la télécommande portant du texte, hors aperçus du faux téléphone
const textNodes = () => {
  const out = [];
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  for (const e of document.querySelectorAll('#remote-mode *')) {
    if (e.closest('.ts-prev,.sp-card,.pp-prev,svg,script,style,canvas') || !vis(e)) continue;
    if (![...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) continue;
    out.push({ el: (e.id ? '#' + e.id : '') + '.' + String(e.className).trim().split(/\s+/)[0] + '<' + e.tagName + '>', px: parseFloat(getComputedStyle(e).fontSize), text: e.textContent.trim().slice(0, 30) });
  }
  return out;
};

test('plancher typographique : aucun texte de la télécommande sous 12 px (7 onglets, Réglages)', async () => {
  const { page, errors, close } = await remote();
  const small = [];
  for (const tab of TABS) {
    await page.evaluate((t) => switchTab(t), tab);
    for (const n of await page.evaluate(textNodes)) if (n.px < 12) small.push(tab + ' ' + n.el + ' ' + n.px + 'px « ' + n.text + ' »');
  }
  await page.evaluate(() => openSettings());
  const st = await page.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll('#settings-view *')) {
      const r = e.getBoundingClientRect();
      if (r.width && r.height && [...e.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())) out.push([e.className, parseFloat(getComputedStyle(e).fontSize)]);
    }
    return out;
  });
  for (const [c, px] of st) if (px < 12) small.push('réglages ' + c + ' ' + px + 'px');
  assert.deepEqual(small, []);
  assert.deepEqual(errors, []);
  await close();
});

test('polices : Lato pour le texte, DM Mono réservé aux valeurs ; casse de phrase (aucun text-transform)', async () => {
  const { page, errors, close } = await remote();
  const r = await page.evaluate(() => {
    const ff = (s) => getComputedStyle(document.querySelector(s)).fontFamily.split(',')[0].replace(/["']/g, '');
    const tt = new Set([...document.querySelectorAll('#remote-mode *')].filter((e) => !e.closest('.ts-prev,.sp-card,.pp-prev')).map((e) => getComputedStyle(e).textTransform));
    return { label: ff('.panel-label'), tab: ff('.tab-btn'), btn: ff('.screen-toggle-btn'), hex: ff('#previewHex'), val: ff('#dimmerVal'), transforms: [...tt] };
  });
  assert.deepEqual(r, { label: 'Lato', tab: 'Lato', btn: 'Lato', hex: 'DM Mono', val: 'DM Mono', transforms: ['none'] });
  assert.deepEqual(errors, []);
  await close();
});

for (const width of [375, 390]) {
  test(`aucun débordement horizontal à ${width} px (7 onglets, Réglages, Projets, Écrans)`, async () => {
    const { page, errors, close } = await remote({ width, height: 844 });
    const wide = [];
    const check = (name) => page.evaluate((name) => {
      const out = [];
      for (const id of ['remote-mode', 'settings-view', 'project-view', 'screens-view']) {
        const e = document.getElementById(id);
        if (e && getComputedStyle(e).display !== 'none' && e.scrollWidth > e.clientWidth + 1) out.push(name + ' ' + id + ' ' + e.scrollWidth + '>' + e.clientWidth);
      }
      if (document.documentElement.scrollWidth > innerWidth) out.push(name + ' document ' + document.documentElement.scrollWidth);
      return out;
    }, name);
    for (const tab of TABS) { await page.evaluate((t) => switchTab(t), tab); wide.push(...await check(tab)); }
    await page.evaluate(() => openSettings()); wide.push(...await check('réglages'));
    await page.evaluate(() => { closeSettings(); openProjectsView(); });
    wide.push(...await check('projets'));
    assert.deepEqual(wide, []);
    assert.deepEqual(errors, []);
    await close();
  });
}

test('focus clavier : anneau visible (fond + accent) sur boutons, puces, onglets, champs', async () => {
  const { page, errors, close } = await remote();
  await page.addStyleTag({ content: '*{transition:none!important}' }); // l'anneau est lu sans attendre ses 200 ms de transition
  await page.keyboard.press('Tab'); // active la modalité clavier (:focus-visible)
  const rings = await page.evaluate(() => {
    const out = {};
    for (const [k, sel] of [['onglet', '#tab-effects'], ['réglages', '#settingsBtn'], ['commande', '#blackoutBtn'], ['puce', '#chip-hue'], ['curseur', '#dimmerSlider']]) {
      const e = document.querySelector(sel); e.focus();
      const cs = getComputedStyle(e);
      out[k] = cs.boxShadow !== 'none' && cs.boxShadow.includes('255, 107, 44') ? 'anneau' : cs.boxShadow + ' / ' + cs.outlineStyle;
    }
    // Curseur : l'anneau est porté par le pouce (pseudo-élément, voir 02-base.css)
    const rg = document.querySelector('#dimmerSlider'); rg.focus();
    out['curseur'] = rg.matches(':focus-visible') ? 'anneau' : 'absent';
    return out;
  });
  assert.deepEqual(rings, { onglet: 'anneau', réglages: 'anneau', commande: 'anneau', puce: 'anneau', curseur: 'anneau' });
  // Interrupteur : l'anneau est sur la piste
  const tog = await page.evaluate(() => {
    switchTab('color'); document.getElementById('strobeToggle').focus();
    return getComputedStyle(document.getElementById('strobeToggle').parentElement.querySelector('.toggle-track')).boxShadow;
  });
  assert.match(tog, /255, 107, 44/);
  assert.deepEqual(errors, []);
  await close();
});

// Commandes principales de chaque onglet : cibles ≥ 44 px dans les deux dimensions
const PRIMARY = {
  color: ['.tab-btn', '.hdr-gear', '.screen-toggle-btn', '#content-color .slider-btn', '#content-color input[type=range]', '#chip-wheel'],
  effects: ['#content-effects .effect-card', '#content-effects .slider-btn', '#content-effects input[type=range]', '.fx-dice-btn'],
  flash: ['.torch-onoff-btn', '#content-flash .effect-btn', '#content-flash .slider-btn'],
  media: ['#content-media .media-btn', '#content-media .slider-btn', '#content-media input[type=range]'],
  call: ['#content-call .gw-seg-btn', '#content-call .tel-sum', '#content-call .media-btn', '#content-call .tel-save'],
  seq: ['#content-seq .sq-add', '#content-seq .prj-newbtn', '#content-seq .sq-ctl button'],
  qr: ['#content-qr .media-btn', '#content-qr .pair-refresh', '#content-qr .pair-manage'],
};
test('cibles tactiles : commandes principales d\'au moins 44 px dans chaque onglet', async () => {
  const { page, errors, close } = await remote();
  const small = [];
  for (const tab of TABS) {
    await page.evaluate((t) => switchTab(t), tab);
    for (const sel of PRIMARY[tab]) {
      const r = await page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => {
        const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden';
      }).map((e) => { const b = e.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }), sel);
      for (const [w, h] of r) if (w < 44 || h < 44) small.push(`${tab} ${sel} ${w}×${h}`);
    }
  }
  assert.deepEqual(small, []);
  assert.deepEqual(errors, []);
  await close();
});

test('jetons : couleurs, rayons, !important absents hors mouvement réduit, anciennes feuilles en @layer legacy', async () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.match(style, /@layer legacy\{/);
  const important = style.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => l.includes('!important'));
  assert.equal(important.length, 1, 'reste : la seule règle de mouvement réduit (02-base.css)\n' + important.join('\n'));
  assert.ok(important.every((l) => /animation-duration|transition-duration/.test(l) || /scroll-behavior/.test(l)));
  const { page, errors, close } = await remote();
  const t = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return ['--bg', '--surface-1', '--border-strong', '--text', '--text-2', '--accent', '--tap'].map((k) => cs.getPropertyValue(k).trim());
  });
  assert.deepEqual(t, ['#0B0B0D', '#161619', '#6A6A74', '#F5F2EC', '#B9B9C0', '#FF6B2C', '44px']);
  assert.deepEqual(errors, []);
  await close();
  // Les 5 !important historiques ont disparu des feuilles d'origine
  for (const f of readdirSync(new URL('../web/styles/', import.meta.url)).filter((f) => /^(?!0[1-4]-|99-)/.test(f))) {
    assert.doesNotMatch(readFileSync(new URL('../web/styles/' + f, import.meta.url), 'utf8'), /!important/, f);
  }
});

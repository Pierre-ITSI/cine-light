// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Icônes Lucide (sprite inline) : toute icône citée par l'interface existe dans
// le sprite, le sprite n'embarque rien d'inutile, aucun emoji d'interface ne
// subsiste dans le modèle ni dans l'interface rendue de la télécommande.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launchBrowser, openPage, INDEX_PATH } from './helpers/harness.mjs';
import { usedIcons } from '../scripts/build-icons.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

test('sprite : chaque icône citée existe, aucune icône inutilisée', () => {
  const html = readFileSync(INDEX_PATH, 'utf8');
  const sprite = html.slice(html.indexOf('<svg xmlns="http://www.w3.org/2000/svg" style="display:none">'), html.indexOf('</svg>') + 6);
  const inSprite = [...sprite.matchAll(/<symbol id="i-([a-z0-9-]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(inSprite, usedIcons(), 'relancez scripts/build-icons.mjs (voir son en-tête)');
  assert.equal((html.match(/<svg xmlns="http:\/\/www.w3.org\/2000\/svg" style="display:none">/g) || []).length, 1, 'un seul sprite');
  assert.match(html, /Lucide icons, lucide-static 1\.50\.0 — ISC License/);
});

// Emoji et pictogrammes colorés (hors flèches et ponctuation typographique)
const EMOJI = /[\u{1F000}-\u{1FFFF}✅✨⚠⚡⚫⬛⏩-⏺⭐❌️]/u;

test('modèle : aucun emoji dans l\'interface de la télécommande (le faux téléphone garde les siens)', () => {
  const tpl = readFileSync(new URL('../web/index.template.html', import.meta.url), 'utf8');
  // Barre masquée de l'écran de jeu (#screen-bar) : hors interface de pilotage
  const noBar = tpl.replace(/<div id="screen-bar">[\s\S]*?<\/div>/, '').replace(/<!--[\s\S]*?-->/g, '');
  const hits = noBar.split('\n').filter((l) => EMOJI.test(l));
  assert.deepEqual(hits, []);
});

test('rendu : aucun emoji visible dans les 5 onglets (et leurs vues), les Réglages et les écrans de rejoindre', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => startMode('remote'));
  const seen = [];
  for (const tab of ['color', 'effects', 'flash', 'media', 'call', 'seq', 'qr']) {
    await page.evaluate((t) => switchTab(t), tab);
    seen.push([tab, await page.evaluate(() => document.getElementById('remote-mode').innerText)]);
  }
  await page.evaluate(() => openSettings());
  seen.push(['settings', await page.evaluate(() => document.getElementById('settings-view').innerText)]);
  for (const [name, text] of seen) assert.doesNotMatch(text, EMOJI, name);
  // Onglets : une icône du sprite chacun
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#nv-tabs [role=tab]')].map((b) => b.querySelector('svg use').getAttribute('href')));
  assert.deepEqual(tabs, ['#i-lightbulb', '#i-sparkles', '#i-film', '#i-clapperboard', '#i-monitor-smartphone']);
  assert.deepEqual(errors, []);
  await close();
});

test('iconizeText : glyphe de tête → icône, « › » final → chevron, reste échappé', async () => {
  const { page, errors, close } = await openPage(browser);
  const out = await page.evaluate(() => [
    iconizeText('⚠ Image <illisible>'), iconizeText('Régler ›'), iconizeText('Texte & simple'), iconizeText('🟢 En ligne'), iconizeText('← Retour'), iconizeText('+ Étape'),
  ]);
  assert.match(out[0], /^<span class="ic-wrap"><svg class="ic" aria-hidden="true"><use href="#i-triangle-alert"><\/use><\/svg><span class="ic-txt">Image &lt;illisible&gt;<\/span><\/span>$/);
  assert.match(out[1], /<span class="ic-txt">Régler<\/span><svg class="ic ic-trail"[^>]*><use href="#i-chevron-right">/);
  assert.equal(out[2], 'Texte &amp; simple');
  assert.match(out[3], /st-dot ok/);
  assert.match(out[4], /#i-chevron-left/);
  assert.match(out[5], /#i-plus/);
  assert.deepEqual(errors, []);
  await close();
});

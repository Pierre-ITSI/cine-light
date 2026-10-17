// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Politique de confidentialité (confidentialite.html, privacy.html) : pages
// statiques à la racine (GitHub Pages) et embarquées dans l'app. Aucune
// requête externe, lisibles en clair comme en sombre, fidèles à la production
// (relais = broker public tant que RELAY_URL est vide, STUN de Google) et
// rédigées pour que le passage au relais auto-hébergé ne change qu'un
// paragraphe, balisé par un commentaire HTML.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, openPage, fileUrl, ROOT } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const PAGES = { fr: 'confidentialite.html', en: 'privacy.html' };
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const between = (s, a, b) => s.slice(s.indexOf(a), s.indexOf(b) + b.length);

async function open(file, colorScheme) {
  const p = await openPage(browser, { waitLoad: false });
  const requests = [];
  p.context.on('request', (r) => requests.push(r.url()));
  await p.page.emulateMedia({ colorScheme });
  await p.page.goto(fileUrl(path.join(ROOT, file)));
  await p.page.evaluate(() => document.fonts.ready);
  return { ...p, requests };
}

// Contraste WCAG entre deux couleurs CSS calculées (rgb/rgba opaques)
function contrastIn() {
  const lum = (c) => {
    const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => {
      const s = +v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
  const bg = css('body', 'backgroundColor'), card = css('.card', 'backgroundColor');
  const pairs = { text: css('main > p:not(.meta)', 'color'), link: css('main a', 'color'), muted: css('.meta', 'color'), lang: css('.lang', 'color') };
  const out = {};
  for (const [k, c] of Object.entries(pairs)) out[k] = Math.min(ratio(c, bg), ratio(c, card));
  return { out, bg, theme: document.documentElement.getAttribute('data-theme') };
}

for (const [lang, file] of Object.entries(PAGES)) {
  test(`${file} : aucune requête externe, polices locales, lisible en sombre et en clair`, async () => {
    for (const scheme of ['dark', 'light']) {
      const { page, errors, requests, close } = await open(file, scheme);
      const st = await page.evaluate(() => ({
        lang: document.documentElement.lang, h1: document.querySelector('h1').textContent,
        fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '') + ' ' + f.weight).sort(),
        scripts: [...document.scripts].filter((s) => s.src).length,
        sheets: [...document.querySelectorAll('link[rel=stylesheet]')].length,
      }));
      const c = await page.evaluate(contrastIn);
      assert.deepEqual(errors, [], scheme);
      assert.deepEqual(requests.filter((u) => !u.startsWith('file:') && !u.startsWith('data:')), [], `${scheme} : aucune requête hors des fichiers locaux`);
      assert.equal(st.lang, lang);
      assert.equal(st.h1, lang === 'fr' ? 'Politique de confidentialité' : 'Privacy policy');
      assert.deepEqual(st.fonts, ['DM Mono 400', 'Lato 400', 'Lato 700'], 'polices auto-hébergées (vendor/fonts)');
      assert.deepEqual([st.scripts, st.sheets], [0, 0], 'ni script ni feuille de style externes');
      assert.equal(c.theme, null, 'hors de l\'app : thème du système');
      for (const [k, v] of Object.entries(c.out)) assert.ok(v >= 4.5, `${scheme} · ${k} : contraste ${v.toFixed(2)} < 4,5`);
      assert.equal(c.bg, scheme === 'dark' ? 'rgb(26, 42, 58)' : 'rgb(245, 242, 236)', 'couleurs de l\'app');
      await close();
    }
  });
}

test('pages jumelles : même feuille de style, liens croisés, mêmes sections', () => {
  const fr = read(PAGES.fr), en = read(PAGES.en);
  const style = (h) => between(h, '\n<style>\n', '</style>');
  assert.equal(style(fr), style(en), 'le <style> est identique dans les deux langues');
  assert.match(fr, /<a class="lang" href="privacy\.html" hreflang="en"/);
  assert.match(en, /<a class="lang" href="confidentialite\.html" hreflang="fr"/);
  const outline = (h) => [...h.matchAll(/<h([23])[^>]*>\s*(\d+(?:\.\d+)?)?/g)].map((m) => m[1] + ':' + (m[2] || '-'));
  assert.deepEqual(outline(fr), outline(en), 'mêmes titres numérotés');
  assert.equal(outline(fr).filter((x) => x.startsWith('2:') && x !== '2:-').length, 14);
  // Liens externes : nouvel onglet, sans référent ; aucune ressource externe
  for (const h of [fr, en]) {
    for (const [tag] of h.matchAll(/<[a-z][^>]*\s(?:src|href)=["']https?:[^>]*>/gi)) {
      assert.match(tag, /^<a\s/, 'seuls des liens <a> pointent vers l\'extérieur : ' + tag);
      assert.match(tag, /target="_blank"/); assert.match(tag, /rel="noopener noreferrer"/);
    }
    assert.doesNotMatch(h, /fonts\.(googleapis|gstatic)\.com|api\.qrserver\.com/);
  }
});

test('identité de l\'éditeur : seuls les crochets attendus restent à remplir', () => {
  for (const f of Object.values(PAGES)) {
    const tokens = new Set([...read(f).matchAll(/\[([A-ZÀ-Ü][A-ZÀ-Ü' -]+)\]/g)].map((m) => m[1]));
    for (const t of tokens) assert.ok(['RAISON SOCIALE', 'ADRESSE POSTALE', 'E-MAIL DE CONTACT'].includes(t), `${f} : crochet inattendu [${t}]`);
  }
});

test('relais : un seul paragraphe balisé à changer ; fidèle à la configuration de production', () => {
  const cfg = read('web/js/01-config.js'), mqtt = read('web/js/20-mqtt.js');
  // Production actuelle : RELAY_URL vide → broker MQTT public ; STUN de Google
  const relayUrl = /RELAY_URL:\s*'([^']*)'/.exec(cfg)[1];
  const broker = /const BROKER = '([^']+)'/.exec(mqtt)[1];
  const stun = /STUN_URLS:\s*Object\.freeze\(\['stun:([^:']+)/.exec(cfg)[1];
  const marks = { fr: ['<!-- RELAIS : DÉBUT', '<!-- RELAIS : FIN -->'], en: ['<!-- RELAY: START', '<!-- RELAY: END -->'] };
  for (const [lang, file] of Object.entries(PAGES)) {
    const html = read(file);
    const [a, b] = marks[lang];
    assert.equal(html.split(a).length, 2, `${file} : un seul début de paragraphe relais`);
    assert.equal(html.split(b).length, 2, `${file} : une seule fin`);
    const block = between(html, a, b);
    assert.equal((block.match(/<p[\s>]/g) || []).length, 1, `${file} : un seul paragraphe entre les repères`);
    // Le service n'est nommé que dans ce paragraphe : le reste de la page y renvoie
    const rest = html.replace(block, '');
    assert.doesNotMatch(rest, /hivemq/i, `${file} : HiveMQ nommé hors du paragraphe balisé`);
    if (relayUrl === '') {
      assert.ok(block.includes(new URL(broker.replace(/^wss:/, 'https:')).hostname), `${file} : le broker de production (${broker}) est nommé`);
    }
    assert.ok(html.includes(stun), `${file} : serveur STUN de production (${stun}) nommé`);
    assert.match(html, /GitHub Pages/);
  }
});

// Passage de la version web sur set-remote.itsi-app.com (docs/HOSTING.md,
// étape 5) : texte de remplacement prêt en commentaire, NON appliqué.
const HOSTING = { fr: ['HÉBERGEMENT', ' : DÉBUT', ' : FIN'], en: ['HOSTING', ': START', ': END'] };
function hostingBlocks(html, [word, start, end]) {
  const out = [];
  for (const m of html.matchAll(new RegExp(`<!-- ${word} § ([\\d.]+)${start}\\.`, 'g'))) {
    const endMark = `<!-- ${word} § ${m[1]}${end} -->`;
    const from = html.lastIndexOf('\n', m.index) + 1;
    const to = html.indexOf(endMark, m.index) + endMark.length;
    const lines = html.slice(from, to).split('\n');
    const close = lines.findIndex((l) => l.trim() === '-->');
    assert.ok(close > 0 && lines.length === close + 3, `${word} § ${m[1]} : commentaire, ligne actuelle, repère de fin`);
    out.push({ all: html.slice(from, to), sec: m[1], next: lines[close - 1], current: lines[close + 1] });
  }
  return out;
}
test('hébergement : trois passages balisés (§ 3.6, 6, 7), remplacement prêt et non appliqué', () => {
  for (const [lang, file] of Object.entries(PAGES)) {
    const html = read(file);
    const blocks = hostingBlocks(html, HOSTING[lang]);
    assert.deepEqual(blocks.map((b) => b.sec), ['3.6', '6', '7'], file);
    assert.equal(html.split(`<!-- ${HOSTING[lang][0]} §`).length - 1, 6, `${file} : repères début/fin appariés`);
    let applied = html;
    for (const b of blocks) {
      // Production actuelle : GitHub ; texte prêt : OVH, en France
      assert.match(b.current, /GitHub/, `${file} § ${b.sec} : texte actuel`);
      if (b.sec !== '7') assert.match(b.next, /OVH/, `${file} § ${b.sec} : remplacement`);
      assert.match(b.next, /France/, `${file} § ${b.sec} : remplacement`);
      assert.match(b.current.trim(), /^<(p|li)>.*<\/\1>$/);
      assert.equal(b.next.trim().slice(0, 4), b.current.trim().slice(0, 4), 'même balise');
      assert.equal(b.next.match(/^ */)[0], b.current.match(/^ */)[0], 'même retrait');
      applied = applied.replace(b.all, b.next);
    }
    // Une fois appliqué : même plan, plus de « hébergée par GitHub Pages » ;
    // GitHub reste cité pour la seule redirection de l'ancienne adresse
    const outline = (h) => [...h.matchAll(/<h([23])[^>]*>\s*(\d+(?:\.\d+)?)?/g)].map((m) => m[1] + ':' + (m[2] || '-'));
    assert.deepEqual(outline(applied), outline(html));
    assert.doesNotMatch(applied, /(hébergée par|hosted by) <strong>GitHub Pages/);
    assert.match(applied, /pierre-itsi\.github\.io\/cine-light/);
    assert.doesNotMatch(applied, new RegExp(HOSTING[lang][0] + ' §'));
  }
});

// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Redirection de l'ancienne adresse GitHub Pages (web/pages-redirect.mjs) :
// deux vrais serveurs HTTP locaux (ancienne origine 127.0.0.1, nouvelle
// origine localhost). La vraie PWA est d'abord installée sur l'ancienne
// origine (service worker + caches), puis le site de redirection la remplace :
// le nouveau sw.js vide les caches et se désinstalle, l'app ouverte se
// recharge sur la page de redirection, qui renvoie vers la nouvelle adresse
// en gardant le fragment (secret d'appairage) ; une PWA installée explique le
// déménagement au lieu de rediriger.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchBrowser, ROOT, waitFor } from './helpers/harness.mjs';
import { writeRedirectSite, redirectPage, PAGES } from '../web/pages-redirect.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2' };
let browser, oldSrv, newSrv, OLD, NEW, siteDir, redirectDir, newDir;

// Ancienne origine : /cine-light/* servi depuis siteDir (racine du dépôt, puis
// le site de redirection) ; fichier absent → 404.html s'il existe (comme GitHub Pages).
function serve(getDir, prefix) {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/probe') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>probe</title>'); }
    if (!u.pathname.startsWith(prefix)) { res.writeHead(404); return res.end(); }
    let rel = decodeURIComponent(u.pathname.slice(prefix.length)) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const dir = getDir();
    const file = path.join(dir, rel);
    const ok = file.startsWith(dir) && existsSync(file) && statSync(file).isFile();
    const send = ok ? file : path.join(dir, '404.html');
    if (!ok && !existsSync(send)) { res.writeHead(404); return res.end(); }
    res.writeHead(ok ? 200 : 404, { 'content-type': TYPES[path.extname(send)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(readFileSync(send));
  });
}
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));

before(async () => {
  browser = await launchBrowser();
  redirectDir = mkdtempSync(path.join(tmpdir(), 'setremote-pages-'));
  siteDir = ROOT;
  // Nouvelle origine : pages témoins (l'app réelle effacerait le fragment)
  newDir = mkdtempSync(path.join(tmpdir(), 'setremote-new-'));
  for (const f of ['index.html', ...PAGES]) writeFileSync(path.join(newDir, f), '<!doctype html><title>nouvelle adresse</title>');
  oldSrv = serve(() => siteDir, '/cine-light/');
  newSrv = serve(() => newDir, '/');
  OLD = `http://127.0.0.1:${await listen(oldSrv)}`;
  NEW = `http://localhost:${await listen(newSrv)}/`;
  writeRedirectSite(redirectDir, { target: NEW });
});
after(async () => {
  await browser?.close();
  oldSrv?.close(); newSrv?.close();
  for (const d of [redirectDir, newDir]) if (d) rmSync(d, { recursive: true, force: true });
});

async function context({ installed = false } = {}) {
  const ctx = await browser.newContext();
  // Hermétique : seules les deux origines locales
  await ctx.route('**/*', (r) => (r.request().url().startsWith(OLD) || r.request().url().startsWith(NEW) ? r.continue() : r.abort()));
  if (installed) {
    await ctx.addInitScript(() => {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/display-mode: (standalone|fullscreen)/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
    });
  }
  return ctx;
}

test('site de redirection : pages, service worker de désinstallation, adresse cible validée', () => {
  const html = redirectPage('https://set-remote.itsi-app.com/');
  assert.match(html, /location\.replace\(dest\)/);
  assert.match(html, /location\.search \+ location\.hash/, 'fragment conservé (secret d\'appairage)');
  assert.doesNotMatch(html.replace(/<noscript>[\s\S]*?<\/noscript>/, ''), /http-equiv="refresh"/, 'meta refresh seulement sans JavaScript');
  assert.doesNotMatch(html, /<(script|link|img)[^>]+(src|href)="https?:\/\/(?!set-remote\.itsi-app\.com)/, 'aucune ressource externe');
  for (const bad of ['http://set-remote.itsi-app.com/', 'https://set-remote.itsi-app.com', 'javascript:alert(1)//', "https://x.fr/'/"]) {
    assert.throws(() => redirectPage(bad), /cible invalide/, bad);
  }
  assert.deepEqual(PAGES, ['confidentialite.html', 'privacy.html']);
  const sw = readFileSync(path.join(redirectDir, 'sw.js'), 'utf8');
  assert.match(sw, /registration\.unregister\(\)/);
  assert.doesNotMatch(sw, /addEventListener\('fetch'/, 'aucune interception : tout vient du réseau');
});

test('PWA installée sur l\'ancienne origine : mise à jour → caches vidés, service worker retiré, redirection', async () => {
  siteDir = ROOT;
  const ctx = await context();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(OLD + '/cine-light/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await waitFor(page, () => !!navigator.serviceWorker.controller, null, { timeout: 10000 });
  assert.match(await page.evaluate(() => caches.keys().then((k) => k.join())), /^setremote-v\d+$/);
  // Déménagement : l'ancienne adresse sert désormais le site de redirection
  siteDir = redirectDir;
  const moved = page.waitForURL(NEW, { timeout: 15000 });
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
  await moved; // controllerchange → rechargement (accueil, hors session) → redirection
  assert.equal(page.url(), NEW);
  const probe = await ctx.newPage();
  await probe.goto(OLD + '/probe');
  assert.deepEqual(await probe.evaluate(async () => [
    (await navigator.serviceWorker.getRegistrations()).length, (await caches.keys()).length,
  ]), [0, 0], 'ancienne origine : plus de service worker ni de cache');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('liens : fragment et requête conservés, pages de la politique, adresses inconnues → accueil', async () => {
  siteDir = redirectDir;
  const ctx = await context();
  const page = await ctx.newPage();
  const cases = [
    ['/cine-light/#p=v1.AbC_d-e.Fg', NEW + '#p=v1.AbC_d-e.Fg'],
    ['/cine-light/index.html?source=pwa#p=v1.x.y', NEW + '?source=pwa#p=v1.x.y'],
    ['/cine-light/confidentialite.html', NEW + 'confidentialite.html'],
    ['/cine-light/privacy.html#contact', NEW + 'privacy.html#contact'],
    ['/cine-light/vendor/mqtt-5.16.1.min.js', NEW], // 404.html
    ['/cine-light/nimporte/quoi#p=v1.q.r', NEW + '#p=v1.q.r'],
  ];
  for (const [from, to] of cases) {
    await page.goto(OLD + from);
    await page.waitForURL(to, { timeout: 5000 });
    assert.equal(page.url(), to, from);
  }
  await ctx.close();
});

test('PWA installée ouverte sans lien : message de déménagement, pas de redirection ; avec un lien d\'appairage : redirection', async () => {
  siteDir = redirectDir;
  const ctx = await context({ installed: true });
  const page = await ctx.newPage();
  await page.goto(OLD + '/cine-light/');
  await page.waitForTimeout(1200);
  assert.equal(page.url(), OLD + '/cine-light/');
  const st = await page.evaluate(() => ({
    moved: !document.getElementById('moved').hidden, wait: !document.getElementById('wait').hidden,
    href: document.getElementById('go').href, text: document.body.innerText,
  }));
  assert.deepEqual([st.moved, st.wait, st.href], [true, false, NEW]);
  assert.match(st.text, /ne sont pas transférés/);
  // QR scanné alors que la PWA installée capture les liens : nouvelle fenêtre
  const linked = await ctx.newPage();
  await linked.goto(OLD + '/cine-light/#p=v1.s.t');
  await linked.waitForURL(NEW + '#p=v1.s.t', { timeout: 5000 });
  await ctx.close();
});

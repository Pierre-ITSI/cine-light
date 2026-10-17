#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ════════════════════════════════════════════════════════════════════════════
// SetRemote — site de REDIRECTION pour l'ancienne adresse GitHub Pages
// (https://pierre-itsi.github.io/cine-light/), à publier le jour où la PWA
// déménage sur https://set-remote.itsi-app.com/ (docs/HOSTING.md, étape 4).
// N'est PAS publié tant que personne ne lance le workflow
// .github/workflows/pages-redirect.yml.
//
//   node web/pages-redirect.mjs --out _site [--target https://…/] [--base /cine-light/]
//
// Produit :
//   index.html, 404.html,             même page : renvoie vers la nouvelle adresse
//   confidentialite.html, privacy.html  (page équivalente, requête et FRAGMENT
//                                      conservés : le fragment « #p=… » porte le
//                                      secret d'appairage d'un QR code ; une
//                                      balise meta refresh le perdrait)
//   sw.js                             remplace l'ancien service worker : vide
//                                      ses caches et se désinstalle, pour que
//                                      les PWA installées cessent de servir
//                                      l'ancienne version
//   .nojekyll
//
// PWA installée ouverte SANS lien d'appairage : la page explique le
// déménagement (réinstaller depuis la nouvelle adresse ; les données locales
// ne suivent pas) au lieu d'ouvrir un autre site dans la fenêtre de l'app.
// Node 22, aucune dépendance.
// ════════════════════════════════════════════════════════════════════════════
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_TARGET = 'https://set-remote.itsi-app.com/';
export const DEFAULT_BASE = '/cine-light/';
export const PAGES = ['confidentialite.html', 'privacy.html'];

// https, ou http sur la machine locale (tests) ; « / » final
const TARGET_RE = /^(https:\/\/[a-z0-9.-]+(:\d+)?|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)(\/[\w.~%-]*)*\/$/i;

export function redirectPage(target = DEFAULT_TARGET, base = DEFAULT_BASE) {
  if (!TARGET_RE.test(target)) throw new Error('adresse cible invalide (https://…/ attendue) : ' + target);
  if (!/^\/([\w.~-]+\/)*$/.test(base)) throw new Error('chemin de base invalide : ' + base);
  const host = new URL(target).host;
  const cfg = JSON.stringify({ target, base, pages: PAGES });
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#000000">
<title>SetRemote a déménagé</title>
<link rel="canonical" href="${target}">
<noscript><meta http-equiv="refresh" content="0; url=${target}"></noscript>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #000; color: #f2f2f2; font: 16px/1.5 system-ui, -apple-system, sans-serif; }
  main { max-width: 30rem; padding: 2rem 1.5rem; text-align: center; }
  h1 { font-size: 1.4rem; margin: 0 0 1rem; }
  p { margin: 0 0 1rem; color: #c8c8c8; }
  a.go { display: inline-block; margin: .5rem 0 1.5rem; padding: .8rem 1.4rem; border-radius: 999px;
    background: #f2f2f2; color: #000; font-weight: 600; text-decoration: none; }
  .en { font-size: .9rem; color: #9a9a9a; border-top: 1px solid #333; padding-top: 1rem; }
  [hidden] { display: none; }
</style>
</head>
<body>
<main>
  <h1>SetRemote a déménagé</h1>
  <p id="wait">Ouverture de <strong>${host}</strong>…</p>
  <div id="moved" hidden>
    <p>Nouvelle adresse&nbsp;: <strong>${host}</strong>. Ouvrez-la dans votre navigateur, ajoutez-la à l'écran d'accueil, puis supprimez cette ancienne icône.</p>
    <p>Les mémoires, appels et SMS enregistrés, sonneries et écrans appairés de cette ancienne version ne sont pas transférés&nbsp;: refaites l'appairage depuis la nouvelle adresse.</p>
  </div>
  <a class="go" id="go" href="${target}" target="_blank" rel="noopener noreferrer">Ouvrir ${host}</a>
  <p class="en" lang="en">SetRemote has moved to <strong>${host}</strong>. Open it in your browser and add it to your home screen again; saved data does not carry over.</p>
</main>
<script>
(function () {
  var C = ${cfg};
  var path = location.pathname;
  var rest = path.indexOf(C.base) === 0 ? path.slice(C.base.length) : '';
  var dest = C.target + (C.pages.indexOf(rest) >= 0 ? rest : '') + location.search + location.hash;
  document.getElementById('go').href = dest;
  // Ancien service worker et ses caches : retirés (les données locales restent)
  function cleanup() {
    var jobs = [];
    try { if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })); } catch (e) {}
    try { if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })); } catch (e) {}
    var all = Promise.all(jobs).catch(function () {});
    return Promise.race([all, new Promise(function (r) { setTimeout(r, 800); })]);
  }
  var mm = function (q) { try { return window.matchMedia(q).matches; } catch (e) { return false; } };
  var installed = mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || navigator.standalone === true;
  if (installed && !location.hash) {
    // PWA installée : expliquer plutôt qu'ouvrir un autre site dans sa fenêtre
    document.getElementById('wait').hidden = true;
    document.getElementById('moved').hidden = false;
    cleanup();
    return;
  }
  cleanup().then(function () { location.replace(dest); });
})();
</script>
</body>
</html>
`;
}

export const REDIRECT_SW = `/* Service Worker — ancienne adresse de SetRemote (déménagée) :
   vide ses caches et se désinstalle. La page suivante est chargée depuis le
   réseau, c'est-à-dire la page de redirection. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.registration.unregister())
  );
});
`;

export function writeRedirectSite(out, { target = DEFAULT_TARGET, base = DEFAULT_BASE } = {}) {
  const html = redirectPage(target, base);
  mkdirSync(out, { recursive: true });
  const files = ['index.html', '404.html', ...PAGES];
  for (const f of files) writeFileSync(join(out, f), html);
  writeFileSync(join(out, 'sw.js'), REDIRECT_SW);
  writeFileSync(join(out, '.nojekyll'), '');
  return [...files, 'sw.js', '.nojekyll'];
}

function arg(argv, name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const argv = process.argv.slice(2);
    const out = arg(argv, '--out', null);
    if (!out) throw new Error('usage : node web/pages-redirect.mjs --out <dossier> [--target https://…/] [--base /cine-light/]');
    const files = writeRedirectSite(resolve(out), { target: arg(argv, '--target', DEFAULT_TARGET), base: arg(argv, '--base', DEFAULT_BASE) });
    console.log(`✓ Site de redirection : ${files.join(', ')} → ${out}`);
  } catch (e) { console.error('✗ ' + (e && e.message || e)); process.exit(1); }
}

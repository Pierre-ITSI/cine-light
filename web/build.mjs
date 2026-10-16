#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// SetRemote — assemblage de web/ vers index.html (Node 22, aucune dépendance)
//
//   web/index.template.html   balisage complet + 2 marqueurs de ligne :
//                             « /* @@STYLES@@ */ » et « /* @@SCRIPTS@@ */ »
//   web/styles/NN-*.css       concaténés dans l'ordre des noms → <style> unique
//   web/js/NN-*.js            scripts CLASSIQUES (pas de modules ES : l'app
//                             repose sur des globales et des onclick= inline),
//                             concaténés dans l'ordre des noms → <script> unique
//   packages/protocol/*.js    chiffrement de bout en bout + appairage (modules
//                             ES), assemblés par web/bundle-protocol.mjs en une
//                             IIFE qui expose la globale SRP, placée EN TÊTE du
//                             <script> (avant web/js). Déterministe.
//   packages/dmx/*.js         passerelle DMX (sACN / Art-Net : analyse, fusion,
//                             personnalités, patch, moteur), même assemblage →
//                             globale SRDMX, juste après SRP.
//
// Le fichier produit (index.html à la racine) reste l'artefact servi tel quel
// par GitHub Pages : aucune étape de build côté hébergement.
//
//   node web/build.mjs           (ré)écrit index.html
//   node web/build.mjs --check   vérifie que index.html est à jour (CI)
//   node web/build.mjs --out f   écrit ailleurs (comparaisons)
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundleProtocol, bundleDmx } from './bundle-protocol.mjs';

export const WEB_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(WEB_DIR, '..');
export const OUTPUT = join(ROOT_DIR, 'index.html');
export const HEADER = '<!-- GÉNÉRÉ par web/build.mjs — ne pas éditer, modifier web/ -->';

const STYLES_MARK = '/* @@STYLES@@ */\n';
const SCRIPTS_MARK = '/* @@SCRIPTS@@ */\n';

// Fragments d'un dossier, triés par nom (le préfixe NN- fixe l'ordre).
// Chaque fragment se termine par un saut de ligne : c'est la seule
// « couture » ajoutée entre deux fragments.
export function listFragments(sub, ext) {
  const dir = join(WEB_DIR, sub);
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext) && /^\d{2}-[a-z0-9-]+\.[a-z]+$/.test(f))
    .sort()
    .map((f) => ({ name: sub + '/' + f, text: readFileSync(join(dir, f), 'utf8') }));
}

function concat(frags) {
  return frags.map((f) => (f.text.endsWith('\n') ? f.text : f.text + '\n')).join('');
}

function replaceOnce(haystack, mark, value, label) {
  const i = haystack.indexOf(mark);
  if (i < 0 || haystack.indexOf(mark, i + 1) >= 0) {
    throw new Error(`build: marqueur ${label} absent ou dupliqué dans index.template.html`);
  }
  // Pas de String.replace : le JS contient des « $ » (gabarits `${…}`)
  return haystack.slice(0, i) + value + haystack.slice(i + mark.length);
}

export function build() {
  const tpl = readFileSync(join(WEB_DIR, 'index.template.html'), 'utf8');
  const cssFrags = listFragments('styles', '.css');
  const jsFrags = listFragments('js', '.js');
  if (!cssFrags.length || !jsFrags.length) throw new Error('build: fragments manquants');
  for (const f of cssFrags) {
    if (/<\/style/i.test(f.text)) throw new Error(`build: « </style » interdit dans ${f.name}`);
  }
  for (const f of jsFrags) {
    if (/<\/script/i.test(f.text)) throw new Error(`build: « </script » interdit dans ${f.name}`);
  }
  const protocol = bundleProtocol();
  const dmx = bundleDmx();
  let html = replaceOnce(tpl, STYLES_MARK, concat(cssFrags), 'STYLES');
  html = replaceOnce(html, SCRIPTS_MARK, protocol.code + dmx.code + concat(jsFrags), 'SCRIPTS');
  // En-tête juste après le doctype (le doctype reste la 1re ligne : aucun
  // risque de mode quirks).
  const nl = html.indexOf('\n');
  if (!/^<!DOCTYPE html>$/i.test(html.slice(0, nl))) throw new Error('build: le gabarit doit commencer par <!DOCTYPE html>');
  html = html.slice(0, nl + 1) + HEADER + '\n' + html.slice(nl + 1);
  return { html, cssFrags, jsFrags, protocol, dmx };
}

function main(argv) {
  const check = argv.includes('--check');
  const outIdx = argv.indexOf('--out');
  const out = outIdx >= 0 ? resolve(argv[outIdx + 1]) : OUTPUT;
  const { html, cssFrags, jsFrags, protocol, dmx } = build();
  if (check) {
    let current = '';
    try { current = readFileSync(out, 'utf8'); } catch (_) {}
    if (current !== html) {
      console.error('✗ index.html n\'est pas à jour : lancez « npm run build » puis committez.');
      process.exit(1);
    }
    console.log('✓ index.html à jour (' + cssFrags.length + ' CSS, ' + jsFrags.length + ' JS, paquet protocole '
      + protocol.modules.length + ' modules, passerelle DMX ' + dmx.modules.length + ' modules)');
    return;
  }
  writeFileSync(out, html);
  console.log('✓ ' + out + ' — ' + cssFrags.length + ' fragments CSS, ' + jsFrags.length
    + ' fragments JS, paquet protocole (' + protocol.modules.length + ' modules → SRP), passerelle DMX ('
    + dmx.modules.length + ' modules → SRDMX), '
    + Buffer.byteLength(html) + ' octets');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main(process.argv.slice(2));

#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// SetRemote : sélection et vérification des fichiers de la PWA avant mise en
// service sur le VPS (appelé par update-app.sh, dans un conteneur Node 22 sans
// réseau, en lecture seule, utilisateur non root).
//
//   node verify-app.mjs --src <dépôt extrait> --out <dossier vide> [--current <version en service>]
//
// 1. Copie dans --out UNIQUEMENT la liste blanche ci-dessous (jamais relay/,
//    tests/, docs/, expo-app/, web/, packages/, fichiers cachés…).
// 2. Vérifie que le paquet est complet et cohérent :
//    • index.html à jour avec web/ (même contrôle que « npm run check:build ») ;
//    • chaque ressource relative citée par index.html, confidentialite.html et
//      privacy.html existe (analyse de expo-app/scripts/embed-web.mjs, plus les
//      écrans de lancement iOS) ;
//    • chaque fichier précaché par sw.js existe, CACHE est défini ;
//    • manifest.webmanifest valide, icônes présentes ;
//    • un fichier versionné de vendor/ (nom-1.2.3.js, servi avec un cache d'un
//      an) n'a pas changé de contenu sous le même nom.
// Code de sortie 0 = paquet prêt ; sinon rien n'est mis en service.
//
// Node 22, aucune dépendance. La liste blanche et les vérifications sont
// importables (tests/hosting.test.mjs).
// ════════════════════════════════════════════════════════════════════════════
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Fichiers servis, relatifs à la racine du dépôt. */
export const APP_FILES = [
  'index.html', 'sw.js', 'manifest.webmanifest', 'confidentialite.html', 'privacy.html',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
];
/** Écrans de lancement de la PWA iOS (racine du dépôt). */
export const APP_PATTERNS = [/^splash-\d+x\d+\.png$/];
/** Dossiers servis entiers (sans fichiers cachés). */
export const APP_DIRS = ['vendor'];
/** Pages dont les références sont vérifiées. */
export const APP_PAGES = ['index.html', 'confidentialite.html', 'privacy.html'];
/** Fichiers versionnés, servis avec un cache d'un an (même motif que le Caddyfile). */
export const IMMUTABLE_RE = /^vendor\/[a-z0-9-]+-\d+\.\d+\.\d+(\.min)?\.js$/;

const toPosix = (p) => p.split(sep).join('/');

function listTree(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listTree(p, base));
    else out.push(toPosix(relative(base, p)));
  }
  return out.sort();
}

/** Liste des fichiers du paquet pour un dépôt extrait (chemins relatifs). */
export function selectAppFiles(src) {
  const files = [];
  for (const f of APP_FILES) {
    if (!existsSync(join(src, f))) throw new Error('fichier obligatoire absent du dépôt : ' + f);
    files.push(f);
  }
  for (const e of readdirSync(src)) if (APP_PATTERNS.some((re) => re.test(e))) files.push(e);
  for (const d of APP_DIRS) if (existsSync(join(src, d))) files.push(...listTree(join(src, d), src));
  return [...new Set(files)].sort();
}

/** Copie la liste blanche ; refuse liens symboliques et fichiers spéciaux. */
export function copyApp(src, out) {
  const files = selectAppFiles(src);
  for (const f of files) {
    const st = lstatSync(join(src, f));
    if (!st.isFile()) throw new Error('pas un fichier ordinaire (lien symbolique ?) : ' + f);
    mkdirSync(dirname(join(out, f)), { recursive: true });
    copyFileSync(join(src, f), join(out, f));
  }
  return files;
}

const isRelative = (u) => u !== '' && !u.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('//');

/** Références des écrans de lancement iOS (ignorées par pageRefs). */
export function startupImageRefs(html) {
  const refs = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel\s*=\s*["']apple-touch-startup-image["']/i.test(tag)) continue;
    const m = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (m) refs.push(m[1] ?? m[2]);
  }
  return refs;
}

/** Entrées précachées par sw.js (tableau SHELL). */
export function swShell(sw) {
  const m = /const SHELL\s*=\s*\[([\s\S]*?)\];/.exec(sw);
  if (!m) return null;
  return [...m[1].replace(/\/\/.*$/gm, '').matchAll(/'([^']*)'|"([^"]*)"/g)].map((x) => x[1] ?? x[2]);
}

/**
 * Vérifie le paquet `out` (déjà copié depuis `src`). `pageRefs` : analyseur
 * des références d'une page (celui de embed-web.mjs). `current` : version en
 * service (facultatif). Renvoie la liste des problèmes (vide = prêt).
 */
export function checkApp({ src, out, files, pageRefs, current = null, expectedHtml = null }) {
  const problems = [];
  const has = (rel) => { try { return lstatSync(join(out, rel)).isFile(); } catch (_) { return false; } };
  const read = (rel) => readFileSync(join(out, rel), 'utf8');
  for (const f of files) {
    if (!has(f)) problems.push('copie absente : ' + f);
    else if (!readFileSync(join(out, f)).equals(readFileSync(join(src, f)))) problems.push('copie différente de l\'original : ' + f);
  }
  const extra = listTree(out).filter((f) => !files.includes(f));
  if (extra.length) problems.push('fichiers hors liste blanche : ' + extra.join(', '));
  if (expectedHtml !== null && has('index.html') && read('index.html') !== expectedHtml) {
    problems.push('index.html n\'est pas à jour avec web/ (« npm run build » oublié avant le commit ?)');
  }
  for (const page of APP_PAGES) {
    if (!has(page)) continue;
    const html = read(page);
    for (const ref of [...pageRefs(html), ...startupImageRefs(html)]) {
      if (!isRelative(ref)) continue;
      const clean = decodeURI(ref.split(/[?#]/)[0]);
      if (clean === '') continue;
      const rel = toPosix(relative(out, resolve(out, dirname(page), clean)));
      if (rel.startsWith('..')) problems.push(`${page} : « ${ref} » sort du paquet`);
      else if (!has(rel)) problems.push(`${page} : « ${ref} » absent du paquet (liste blanche de verify-app.mjs à compléter ?)`);
    }
  }
  if (has('index.html') && read('index.html').length < 100_000) problems.push('index.html anormalement petit');
  if (has('sw.js')) {
    const sw = read('sw.js');
    if (!/const CACHE\s*=\s*'[^']+'/.test(sw)) problems.push('sw.js : CACHE introuvable');
    const shell = swShell(sw);
    if (!shell || !shell.length) problems.push('sw.js : liste SHELL introuvable');
    for (const u of shell || []) {
      const rel = u.replace(/^\.\//, '') || 'index.html';
      if (!has(rel)) problems.push(`sw.js : « ${u} » précaché mais absent du paquet`);
    }
  }
  if (has('manifest.webmanifest')) {
    try {
      const m = JSON.parse(read('manifest.webmanifest'));
      if (!m.name || !m.start_url || !Array.isArray(m.icons) || !m.icons.length) problems.push('manifest.webmanifest incomplet');
      for (const i of m.icons || []) if (!has(String(i.src).replace(/^\.\//, ''))) problems.push('manifest : icône absente ' + i.src);
    } catch (e) { problems.push('manifest.webmanifest : JSON invalide'); }
  }
  if (current && existsSync(current)) {
    for (const f of files.filter((x) => IMMUTABLE_RE.test(x))) {
      const prev = join(current, f);
      if (existsSync(prev) && !readFileSync(prev).equals(readFileSync(join(out, f)))) {
        problems.push(`${f} : contenu modifié sous le même nom (fichier versionné, en cache un an chez les visiteurs) : changer de nom`);
      }
    }
  }
  return problems;
}

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : null;
}

async function main(argv) {
  const src = arg(argv, '--src'), out = arg(argv, '--out'), current = arg(argv, '--current');
  if (!src || !out) throw new Error('usage : verify-app.mjs --src <dépôt> --out <dossier vide> [--current <version en service>]');
  if (existsSync(out) && readdirSync(out).length) throw new Error('--out doit être vide : ' + out);
  // 1. Copie par ce script (liste blanche) AVANT de charger du code du dépôt
  const files = copyApp(src, out);
  // 2. Code du dépôt téléchargé, exécuté ici seulement (conteneur sans réseau) :
  //    assemblage de web/ et analyseur des références de l'app native
  const { build } = await import(pathToFileURL(join(src, 'web', 'build.mjs')).href);
  const { pageRefs } = await import(pathToFileURL(join(src, 'expo-app', 'scripts', 'embed-web.mjs')).href);
  const problems = checkApp({ src, out, files, pageRefs, current, expectedHtml: build().html });
  if (problems.length) {
    console.error('✗ Paquet refusé :');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log(`✓ Paquet vérifié : ${files.length} fichiers, index.html à jour, toutes les références présentes`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).catch((e) => { console.error('✗ ' + (e && e.message || e)); process.exit(1); });
}

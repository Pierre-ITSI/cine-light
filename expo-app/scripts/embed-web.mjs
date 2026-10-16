#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// SetRemote — embarque l'interface web dans l'app native (iOS / Android)
//
// L'app ne charge plus son interface depuis GitHub Pages : la coque native
// (app/index.tsx) ouvre une copie locale (file://) livrée dans le binaire.
// Ce script prépare cette copie dans expo-app/web-embed/ (ignoré par git) :
//
//   index.html             généré par web/build.mjs, vérifié à jour avec web/
//   confidentialite.html   politique de confidentialité (FR), privacy.html (EN) :
//                          pages statiques ouvertes depuis Réglages (Apple 5.1.1,
//                          Google Play : lien obligatoire dans l'app)
//   manifest.webmanifest   + icon-192.png, icon-512.png, apple-touch-icon.png
//   vendor/                mqtt.js figé, polices et leurs licences
//
// puis vérifie que le paquet est complet : chaque ressource relative citée par
// ses pages (src, href, url() CSS, location.href) doit y figurer.
//
// Exclus volontairement : sw.js (aucun service worker dans l'app : son
// enregistrement échoue sans bruit en file://, et l'erreur est déjà absorbée
// par web/js/90-pwa.js), splash-*.png (écrans de lancement de la PWA iOS,
// ignorés par les WebView), brand/, docs/, tests/.
//
// Qui l'appelle :
//   • plugins/with-embedded-web.js, à chaque « expo prebuild » (local ou EAS),
//     juste avant de copier web-embed/ dans le projet natif ;
//   • le hook npm « eas-build-pre-install », en tout début de build EAS, pour
//     échouer tôt si index.html n'est pas à jour.
//
//   node scripts/embed-web.mjs              (ré)génère web-embed/ puis vérifie
//   node scripts/embed-web.mjs --check      vérifie seulement web-embed/
//   node scripts/embed-web.mjs --out <dir>  écrit ailleurs (tests)
//
// Node 22, aucune dépendance.
// ════════════════════════════════════════════════════════════════════════════
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, copyFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
export const EXPO_DIR = resolve(SCRIPTS_DIR, '..');
export const ROOT_DIR = resolve(EXPO_DIR, '..');
export const DEFAULT_OUT = join(EXPO_DIR, 'web-embed');

// Contenu du paquet, relatif à la racine du dépôt
export const FILES = ['index.html', 'confidentialite.html', 'privacy.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
export const DIRS = ['vendor'];
// Pages dont les références sont vérifiées
export const PAGES = ['index.html', 'confidentialite.html', 'privacy.html'];
// Références volontairement absentes du paquet (voir l'en-tête)
const EXCLUDED = new Set(['sw.js']);

// index.html doit correspondre exactement à web/ (même contrôle que
// « npm run check:build ») : on n'embarque jamais une interface périmée.
export async function assertIndexUpToDate() {
  const { build, OUTPUT } = await import(pathToFileURL(join(ROOT_DIR, 'web', 'build.mjs')).href);
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
  if (current !== build().html) {
    throw new Error('index.html n\'est pas à jour avec web/ : lancez « npm run build » à la racine du dépôt, puis committez.');
  }
}

export function embedWeb(outDir = DEFAULT_OUT) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const f of FILES) copyFileSync(join(ROOT_DIR, f), join(outDir, f));
  for (const d of DIRS) {
    // Pas de fichiers cachés (.DS_Store…) : aapt les ignorerait de toute façon
    cpSync(join(ROOT_DIR, d), join(outDir, d), { recursive: true, filter: (src) => !src.split(sep).pop().startsWith('.') });
  }
  return listFiles(outDir);
}

export function listFiles(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, base));
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out.sort();
}

// Références d'une page : attributs src/href, url() du CSS (<style> et
// style="…") et navigations location.href='…' (onclick), lus dans le balisage
// SANS le code des <script> inline, dont les gabarits et commentaires
// (`url(${…})`) produiraient de faux positifs ; plus l'enregistrement du
// service worker. Les écrans de lancement de la PWA iOS
// (apple-touch-startup-image) sont ignorés : les WebView ne les chargent pas.
export function pageRefs(html) {
  const refs = [];
  const markup = html.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2');
  for (const [tag] of markup.matchAll(/<[a-z][^>]*>/gi)) {
    if (/rel\s*=\s*["']apple-touch-startup-image["']/i.test(tag)) continue;
    for (const m of tag.matchAll(/\s(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) refs.push(m[1] ?? m[2]);
  }
  for (const m of markup.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^'")\s]+))\s*\)/g)) refs.push(m[1] ?? m[2] ?? m[3]);
  for (const m of markup.matchAll(/location\.href\s*=\s*(?:"([^"]+)"|'([^']+)')/g)) refs.push(m[1] ?? m[2]);
  for (const m of html.matchAll(/serviceWorker\.register\(\s*(?:"([^"]+)"|'([^']+)')/g)) refs.push(m[1] ?? m[2]);
  return refs;
}

const isRelative = (u) => u !== '' && !u.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith('//');

export function checkEmbed(outDir = DEFAULT_OUT) {
  const problems = [];
  const external = new Set();
  const local = new Set();
  if (!existsSync(outDir)) return { files: [], problems: ['dossier absent : ' + outDir], external: [], local: [] };
  const files = listFiles(outDir);
  for (const f of [...FILES, ...DIRS.flatMap((d) => listFiles(join(ROOT_DIR, d), ROOT_DIR))]) {
    if (!files.includes(f)) problems.push('fichier manquant : ' + f);
    else if (!readFileSync(join(outDir, f)).equals(readFileSync(join(ROOT_DIR, f)))) problems.push('copie différente de l\'original : ' + f);
  }
  for (const page of PAGES) {
    const html = readFileSync(join(outDir, page), 'utf8');
    for (const ref of pageRefs(html)) {
      if (/^https?:\/\//i.test(ref)) { external.add(ref); continue; }
      if (!isRelative(ref)) continue;
      const clean = decodeURI(ref.split(/[?#]/)[0]);
      if (EXCLUDED.has(clean)) continue;
      const target = resolve(outDir, dirname(page), clean);
      const rel = relative(outDir, target).split(sep).join('/');
      local.add(rel);
      if (rel.startsWith('..')) problems.push(`${page} : « ${ref} » sort du paquet`);
      else if (!existsSync(target) || !statSync(target).isFile()) problems.push(`${page} : « ${ref} » introuvable dans le paquet`);
    }
    if (/fonts\.(googleapis|gstatic)\.com/.test(html)) problems.push(page + ' : référence à Google Fonts');
  }
  return { files, problems, external: [...external].sort(), local: [...local].sort() };
}

async function main(argv) {
  const outIdx = argv.indexOf('--out');
  const outDir = outIdx >= 0 ? resolve(argv[outIdx + 1]) : DEFAULT_OUT;
  if (!argv.includes('--check')) {
    await assertIndexUpToDate();
    embedWeb(outDir);
  }
  const { files, problems, local } = checkEmbed(outDir);
  if (problems.length) {
    console.error('✗ Interface embarquée incomplète (' + relative(process.cwd(), outDir) + ') :');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  const bytes = files.reduce((s, f) => s + statSync(join(outDir, f)).size, 0);
  console.log(`✓ Interface embarquée : ${files.length} fichiers, ${Math.round(bytes / 1024)} Ko → ${relative(process.cwd(), outDir) || '.'}`
    + ` (${local.length} ressources locales référencées, toutes présentes)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).catch((e) => { console.error('✗ ' + (e && e.message || e)); process.exit(1); });
}
